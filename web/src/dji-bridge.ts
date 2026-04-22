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

export interface DJIBridgeLogEntry {
    ts: string;
    level: 'info' | 'warn' | 'error';
    message: string;
}

const logs: DJIBridgeLogEntry[] = [];
const subscribers = new Set<(entries: readonly DJIBridgeLogEntry[]) => void>();
const MAX_LOG_ENTRIES = 200;

function pushLog(level: DJIBridgeLogEntry['level'], message: string): void {
    const entry: DJIBridgeLogEntry = {
        ts: new Date().toISOString(),
        level,
        message
    };
    logs.push(entry);
    if (logs.length > MAX_LOG_ENTRIES) logs.shift();
    const snapshot = Object.freeze(logs.slice());
    for (const fn of subscribers) {
        try { fn(snapshot); } catch (err) { console.error('[djiBridge] subscriber threw', err); }
    }
    const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    sink('[djiBridge]', message);
}

/** Subscribe to live log updates. Returns an unsubscribe function. */
export function subscribeDJIBridgeLogs(fn: (entries: readonly DJIBridgeLogEntry[]) => void): () => void {
    subscribers.add(fn);
    fn(Object.freeze(logs.slice()));
    return () => { subscribers.delete(fn); };
}

/** Snapshot of current debug log (for one-shot consumers). */
export function getDJIBridgeLogs(): readonly DJIBridgeLogEntry[] {
    return Object.freeze(logs.slice());
}

/** Clear the log buffer (used between login attempts). */
export function clearDJIBridgeLogs(): void {
    logs.length = 0;
    const snapshot = Object.freeze(logs.slice());
    for (const fn of subscribers) fn(snapshot);
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
        pushLog('info', `connectCallback ${JSON.stringify(args)}`);
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
        const err = new Error(`DJI bridge step "${step}" returned non-JSON: ${raw}`);
        pushLog('error', err.message);
        throw err;
    }
    if (typeof parsed.code !== 'number') {
        const err = new Error(`DJI bridge step "${step}" returned no result code: ${raw}`);
        pushLog('error', err.message);
        throw err;
    }
    if (parsed.code !== 0) {
        const err = new Error(`DJI bridge step "${step}" failed (code ${parsed.code}): ${parsed.message ?? 'unknown error'}`);
        pushLog('error', err.message);
        throw err;
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
    if (!isDJIBridgeAvailable()) {
        pushLog('warn', 'window.djiBridge is not present — skipping bootstrap');
        return;
    }

    pushLog('info', 'GET /api/config/dji');
    const cfg = await std('/api/config/dji') as DJIBridgeConfig;
    pushLog('info', `config: configured=${cfg.configured} workspace=${cfg.workspace_id} mqttHost=${cfg.mqtt.host} mqttUser=${cfg.mqtt.username}`);

    if (!cfg.configured || !cfg.app_id || !cfg.app_key || !cfg.license) {
        throw new Error('DJI Cloud API credentials are not configured on this CloudTAK-DJI server');
    }

    // The DJI thing component speaks plain MQTT. AWS IoT Core's custom
    // authorizer endpoint requires `mqtts://…:443` with ALPN protocol
    // negotiation, which the controller's bridge does NOT implement.
    // Warn loudly so operators stop chasing the wrong cause when nothing
    // shows up in the AWS IoT console.
    if (cfg.mqtt.host.startsWith('mqtts://') || cfg.mqtt.host.includes(':443')) {
        pushLog(
            'warn',
            `MQTT host "${cfg.mqtt.host}" looks like an AWS IoT Core custom-authorizer endpoint. The DJI bridge cannot perform ALPN negotiation; point MQTT_PUBLIC_URL at a tcp:// or ssl:// (port 8883) broker (e.g. the bundled mosquitto bridge).`
        );
    }

    const bridge = window.djiBridge!;
    installCallback();

    // Step 1: verify the platform license. Both the parsed result code
    // AND the synchronous `platformIsVerified()` getter must agree.
    pushLog('info', `platformVerifyLicense(${cfg.app_id}, "${cfg.app_key}", <license:${cfg.license.length}b>)`);
    const verifyRaw = bridge.platformVerifyLicense(cfg.app_id, cfg.app_key, cfg.license);
    pushLog('info', `platformVerifyLicense → ${verifyRaw}`);
    parseBridgeResult('platformVerifyLicense', verifyRaw);

    const verified = bridge.platformIsVerified();
    pushLog('info', `platformIsVerified() → ${verified}`);
    if (!verified) {
        throw new Error('DJI controller rejected the supplied app license (platformIsVerified=false)');
    }

    // Step 2: register the `thing` component with MQTT broker coords.
    const registerParams = JSON.stringify({
        host: cfg.mqtt.host,
        connectCallback: 'cloudtakDjiBridgeCallback',
        username: cfg.mqtt.username,
        password: cfg.mqtt.password
    });
    pushLog('info', `platformLoadComponent("thing", ${registerParams.replace(cfg.mqtt.password || '__none__', '<redacted>')})`);
    const loadRaw = bridge.platformLoadComponent('thing', registerParams);
    pushLog('info', `platformLoadComponent(thing) → ${loadRaw}`);
    parseBridgeResult('platformLoadComponent(thing)', loadRaw);

    // Step 3: explicitly establish the MQTT connection. Some controller
    // firmwares auto-connect on `platformLoadComponent`, others require
    // the explicit `thingConnect` call shown in the DJI MVP.
    if (typeof bridge.thingConnect === 'function') {
        pushLog('info', `thingConnect("${cfg.mqtt.username}", <password>, "cloudtakDjiBridgeCallback")`);
        const connectRaw = bridge.thingConnect(
            cfg.mqtt.username,
            cfg.mqtt.password,
            'cloudtakDjiBridgeCallback'
        );
        pushLog('info', `thingConnect → ${connectRaw}`);
        parseBridgeResult('thingConnect', connectRaw);
    } else {
        pushLog('warn', 'thingConnect is not exposed on this firmware; relying on auto-connect');
    }

    // Step 4: confirm the component is loaded and the MQTT connection is
    // live. `thingGetConnectState` returns a JSON string per DJI docs;
    // older firmwares omit it entirely so guard the call.
    const loaded = bridge.platformIsComponentLoaded('thing');
    pushLog('info', `platformIsComponentLoaded("thing") → ${loaded}`);
    if (!loaded) {
        throw new Error('DJI bridge loaded the `thing` component but platformIsComponentLoaded(thing)=false');
    }

    if (typeof bridge.thingGetConnectState === 'function') {
        const stateRaw = bridge.thingGetConnectState();
        pushLog('info', `thingGetConnectState() → ${stateRaw}`);
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
    } else {
        pushLog('warn', 'thingGetConnectState is not exposed on this firmware');
    }

    pushLog('info', 'bootstrap complete');
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
            pushLog('info', `platformUnloadComponent("thing") → ${raw}`);
            // Best-effort parse — log but do not throw, because logout
            // should always succeed from the user's perspective.
            try {
                parseBridgeResult('platformUnloadComponent(thing)', raw);
            } catch (err) {
                pushLog('warn', `unload returned non-zero result: ${(err as Error).message}`);
            }
        }
    } catch (err) {
        pushLog('error', `failed to unload thing component: ${(err as Error).message}`);
    }
    lastConnectCallback = undefined;
}

/**
 * Capture a one-shot diagnostic snapshot of the bridge state without
 * mutating it. Safe to call from a user-triggered "Refresh" button on
 * the debug panel.
 */
export function captureDJIBridgeSnapshot(): void {
    if (!isDJIBridgeAvailable()) {
        pushLog('warn', 'snapshot: window.djiBridge not present');
        return;
    }
    const bridge = window.djiBridge!;
    try {
        pushLog('info', `snapshot: platformIsVerified()=${bridge.platformIsVerified()}`);
        pushLog('info', `snapshot: platformIsComponentLoaded("thing")=${bridge.platformIsComponentLoaded('thing')}`);
        if (typeof bridge.thingGetConnectState === 'function') {
            pushLog('info', `snapshot: thingGetConnectState()=${bridge.thingGetConnectState()}`);
        } else {
            pushLog('info', 'snapshot: thingGetConnectState() not available on this firmware');
        }
        if (lastConnectCallback) {
            pushLog('info', `snapshot: lastConnectCallback=${JSON.stringify(lastConnectCallback)}`);
        }
    } catch (err) {
        pushLog('error', `snapshot threw: ${(err as Error).message}`);
    }
}
