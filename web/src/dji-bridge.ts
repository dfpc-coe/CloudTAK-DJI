/*
 * DJI Pilot 2 / RC Pro web-view bridge integration.
 *
 * The controller exposes a `window.djiBridge` interface that lets the
 * embedded HTML register its license + MQTT broker so the in-app "Cloud
 * Service" tile flips to "Logged In" and devices start reporting through
 * the Cloud API. Without `platformVerifyLicense` the Cloud tile in DJI
 * Fly stays "Not Logged In" and no UAS reach the fleet view.
 *
 * Mirrors the minimal flow documented at
 * https://github.com/pktiuk/DJI_Cloud_API_minimal/blob/master/couldhtml/login.html
 */
import { std } from './std.ts';
import type { DJIBridgeConfig } from './types.ts';

declare global {
    interface Window {
        cloudtakDjiBridgeCallback?: (...args: unknown[]) => void;
    }
}

let installedCallback = false;
let lastConnectCallback: { code?: number; message?: string; data?: unknown } | undefined;

function installCallback(): void {
    if (installedCallback) return;
    window.cloudtakDjiBridgeCallback = function (...args: unknown[]) {
        // DJI delivers the connect-status payload as the first argument,
        // typically a JSON string `{code, message, data}`. We retain the
        // most recent value so subsequent diagnostics can read it.
        const first = args[0];
        if (typeof first === 'string') {
            try {
                lastConnectCallback = JSON.parse(first);
            } catch {
                lastConnectCallback = { message: first };
            }
        } else if (first && typeof first === 'object') {
            lastConnectCallback = first as { code?: number; message?: string; data?: unknown };
        }
        console.log('[djiBridge] callback', ...args);
    };
    installedCallback = true;
}

/**
 * Returns true when running inside the DJI Pilot/RC Pro web view, where
 * the host injects `window.djiBridge`. In any other browser we no-op so
 * the desktop UI works unchanged.
 */
export function isDJIBridgeAvailable(): boolean {
    return typeof window !== 'undefined' && typeof window.djiBridge !== 'undefined';
}

/**
 * Parse the `{code, message, data}` envelope DJI bridge methods return
 * as a JSON string. A non-zero `code` indicates failure; we throw a
 * descriptive Error so the Login view can surface it via its existing
 * error pipeline (TablerError modal).
 */
function parseBridgeResult(step: string, raw: string): { code: number; message: string; data?: unknown } {
    let parsed: { code?: number; message?: string; data?: unknown };
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new Error(`DJI bridge step "${step}" returned non-JSON: ${raw}`);
    }
    if (typeof parsed.code !== 'number') {
        throw new Error(`DJI bridge step "${step}" returned no result code: ${raw}`);
    }
    if (parsed.code !== 0) {
        throw new Error(`DJI bridge step "${step}" failed (code ${parsed.code}): ${parsed.message ?? 'unknown error'}`);
    }
    return { code: parsed.code, message: parsed.message ?? 'success', data: parsed.data };
}

/**
 * Verify the DJI app license, load the `thing` component, and start the
 * MQTT connection — every step the DJI MVP exercises, with full error
 * surfacing. Throws on any failure so the Login view can show the
 * operator a useful error.
 */
export async function bootstrapDJIBridge(): Promise<void> {
    if (!isDJIBridgeAvailable()) return;

    const cfg = await std('/api/config/dji') as DJIBridgeConfig;
    if (!cfg.configured || !cfg.app_id || !cfg.app_key || !cfg.license) {
        throw new Error('DJI Cloud API credentials are not configured on this CloudTAK-DJI server');
    }

    const bridge = window.djiBridge!;
    installCallback();

    // Step 1: verify the platform license. Both the parsed result code
    // AND the synchronous `platformIsVerified()` getter must agree.
    const verifyRaw = bridge.platformVerifyLicense(cfg.app_id, cfg.app_key, cfg.license);
    parseBridgeResult('platformVerifyLicense', verifyRaw);

    if (!bridge.platformIsVerified()) {
        throw new Error('DJI controller rejected the supplied app license (platformIsVerified=false)');
    }

    // Step 2: register the `thing` component with MQTT broker coords.
    const registerParams = JSON.stringify({
        host: cfg.mqtt.host,
        connectCallback: 'cloudtakDjiBridgeCallback',
        username: cfg.mqtt.username,
        password: cfg.mqtt.password
    });
    const loadRaw = bridge.platformLoadComponent('thing', registerParams);
    parseBridgeResult('platformLoadComponent(thing)', loadRaw);

    // Step 3: explicitly establish the MQTT connection. Some controller
    // firmwares auto-connect on `platformLoadComponent`, others require
    // the explicit `thingConnect` call shown in the DJI MVP.
    if (typeof bridge.thingConnect === 'function') {
        const connectRaw = bridge.thingConnect(
            cfg.mqtt.username,
            cfg.mqtt.password,
            'cloudtakDjiBridgeCallback'
        );
        parseBridgeResult('thingConnect', connectRaw);
    }

    // Step 4: confirm the component is loaded and the MQTT connection is
    // live. `thingGetConnectState` returns a JSON string per DJI docs;
    // older firmwares omit it entirely so guard the call.
    if (!bridge.platformIsComponentLoaded('thing')) {
        throw new Error('DJI bridge loaded the `thing` component but platformIsComponentLoaded(thing)=false');
    }

    if (typeof bridge.thingGetConnectState === 'function') {
        const stateRaw = bridge.thingGetConnectState();
        const state = parseBridgeResult('thingGetConnectState', stateRaw);
        const data = state.data as { connectState?: boolean } | undefined;
        // `data.connectState` is `true` once MQTT CONNACK has been
        // received. Surface a clear message if the broker rejected us so
        // the operator knows the license was fine but auth/network is not.
        if (data && data.connectState === false) {
            const cb = lastConnectCallback
                ? ` (callback: code=${lastConnectCallback.code ?? '?'} ${lastConnectCallback.message ?? ''})`
                : '';
            throw new Error(`DJI thing component is not connected to MQTT yet${cb}`);
        }
    }
}

/**
 * Tear down the `thing` component on the controller. Invoked from the
 * web UI logout flow so DJI Fly's "Cloud Service" tile flips back to
 * "Not Logged In" and the controller stops publishing OSD frames against
 * a session that no longer has a valid CloudTAK token.
 *
 * The DJI bridge does not emit a "user pressed logout" event into the
 * web view — logout is always initiated from our UI. This call is
 * idempotent and safe to invoke when the component was never loaded.
 */
export function teardownDJIBridge(): void {
    if (!isDJIBridgeAvailable()) return;

    const bridge = window.djiBridge!;
    try {
        if (bridge.platformIsComponentLoaded('thing')) {
            const raw = bridge.platformUnloadComponent('thing');
            // Best-effort parse — log but do not throw, because logout
            // should always succeed from the user's perspective.
            try {
                parseBridgeResult('platformUnloadComponent(thing)', raw);
            } catch (err) {
                console.warn('[djiBridge] unload returned non-zero result:', err);
            }
        }
    } catch (err) {
        console.error('[djiBridge] failed to unload thing component:', err);
    }
    lastConnectCallback = undefined;
}
