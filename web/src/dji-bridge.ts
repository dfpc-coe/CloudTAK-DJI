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
const COMPONENT_LOAD_TIMEOUT_MS = 3000;
const COMPONENT_LOAD_POLL_MS = 100;

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

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
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
 *
 * Some bridge methods (`platformVerifyLicense`, `platformSetInformation`)
 * additionally encode success in `data`: a `{code:0, data:false}` envelope
 * means "the call was accepted but the underlying operation failed" —
 * which is exactly what happens when `appId` is supplied as a JSON Number
 * instead of a String. Use `requireDataTrue` for those.
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

    // Step 1: verify the platform license.
    //
    // CRITICAL: appId MUST be passed as a string. The native side
    // checks the type strictly; passing a JS Number causes the call to
    // return `{code:0, data:false}` ("envelope OK, license rejected")
    // and `platformIsVerified()` will then return false, leaving the
    // Pilot Cloud Service tile stuck on "Not Logged In" even though
    // every subsequent component "loads" successfully.
    // Source: dji-sdk/Cloud-API-Demo-Web src/api/pilot-bridge.ts.
    const appIdStr = String(cfg.app_id);
    pushLog('info', `platformVerifyLicense("${appIdStr}", "${cfg.app_key}", <license:${cfg.license.length}b>)`);
    const verifyRaw = bridge.platformVerifyLicense(appIdStr as unknown as number, cfg.app_key, cfg.license);
    pushLog('info', `platformVerifyLicense → ${verifyRaw}`);
    const verifyParsed = parseBridgeResult('platformVerifyLicense', verifyRaw);
    if (verifyParsed.data === false) {
        throw new Error(
            'platformVerifyLicense returned code:0 data:false. '
            + 'The most common cause is appId being passed as a number instead of a string, '
            + 'or the appId/appKey/license triple not matching the package signature DJI issued the license for.'
        );
    }

    const verified = bridge.platformIsVerified();
    pushLog('info', `platformIsVerified() → ${verified}`);
    if (!verified) {
        throw new Error('DJI controller rejected the supplied app license (platformIsVerified=false). Double-check appId/appKey/license and that the WebView origin matches the package the license was issued for.');
    }

    // Step 2: tell Pilot who we are RIGHT NOW. The Cloud Service tile
    // on Pilot's main page is driven by these two calls — they are
    // independent of MQTT/api/ws status. Calling them up front means
    // the tile flips as soon as the license is accepted; it will not
    // wait for the broker handshake and won't be reverted if a later
    // optional component fails to load. We re-issue them at the end of
    // bootstrap too, in case the user lands on Pilot home before the
    // bootstrap completes.
    setPilotPlatformInfo(bridge, cfg);

    // Step 3: register the `thing` component with MQTT broker coords.
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

    pushLog('info', 'waiting for thing component to finish loading');
    const loaded = await waitForComponentLoaded(bridge, 'thing');
    pushLog('info', `platformIsComponentLoaded("thing") → ${loaded}`);
    if (!loaded) {
        throw new Error('DJI bridge accepted platformLoadComponent(thing) but the thing module never reported loaded');
    }

    // Step 4: explicitly establish the MQTT connection. Some controller
    // firmwares auto-connect on `platformLoadComponent`, others require
    // the explicit `thingConnect` call shown in the DJI MVP.
    if (typeof bridge.thingConnect === 'function') {
        pushLog('info', `thingConnect("${cfg.mqtt.username}", <password>, "cloudtakDjiBridgeCallback")`);
        let connectRaw = bridge.thingConnect(
            cfg.mqtt.username,
            cfg.mqtt.password,
            'cloudtakDjiBridgeCallback'
        );
        pushLog('info', `thingConnect → ${connectRaw}`);

        try {
            parseBridgeResult('thingConnect', connectRaw);
        } catch (err) {
            if ((err as Error).message.includes('code 615011')) {
                pushLog('warn', 'thingConnect raced the controller component loader; waiting once and retrying');
                const retriedLoaded = await waitForComponentLoaded(bridge, 'thing');
                pushLog('info', `platformIsComponentLoaded("thing") after retry wait → ${retriedLoaded}`);
                if (!retriedLoaded) throw err;

                connectRaw = bridge.thingConnect(
                    cfg.mqtt.username,
                    cfg.mqtt.password,
                    'cloudtakDjiBridgeCallback'
                );
                pushLog('info', `thingConnect retry → ${connectRaw}`);
                parseBridgeResult('thingConnect retry', connectRaw);
            } else {
                throw err;
            }
        }
    } else {
        pushLog('warn', 'thingConnect is not exposed on this firmware; relying on auto-connect');
    }

    // Step 5: confirm the component is loaded and the MQTT connection is
    // live. `thingGetConnectState` returns a JSON string per DJI docs;
    // older firmwares omit it entirely so guard the call.
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

    // Step 6: load the `api` component so Pilot can call our REST API.
    // Failure here is non-fatal (older firmwares lack /manage/api/v1
    // dependencies), but most of the Cloud Service tile depends on it.
    // Per DJI's reference impl `host` MUST end with `/`.
    loadOptionalComponent(bridge, 'api', JSON.stringify({
        host: cfg.api.host.endsWith('/') ? cfg.api.host : cfg.api.host + '/',
        token: cfg.api.token
    }));

    // Step 7: load the `ws` component for realtime updates Pilot pushes
    // into the platform (binding completion, mission progress, etc.).
    // Per DJI's reference impl `host` is a complete websocket URL
    // including path (e.g. wss://host/api/v1/ws), not just an origin.
    loadOptionalComponent(bridge, 'ws', JSON.stringify({
        host: cfg.ws.host,
        token: cfg.ws.token,
        connectCallback: 'cloudtakDjiBridgeCallback'
    }));

    // Step 8: load `liveshare` so the Cloud-issued `live_start_push`
    // service can actually deliver video. `videoPublishType` strings
    // (per DJI docs):
    //   video-on-demand           — server-issued via thing model
    //   video-by-manual           — operator presses Live in Pilot
    //   video-demand-aux-manual   — both
    loadOptionalComponent(bridge, 'liveshare', JSON.stringify({
        videoPublishType: 'video-on-demand'
    }));

    // Step 9: re-issue platform info now that everything is loaded.
    // Some Pilot firmwares only refresh the tile after a component
    // load event; calling here ensures the tile reflects the live
    // session immediately after every bootstrap.
    setPilotPlatformInfo(bridge, cfg);

    pushLog('info', 'bootstrap complete');
}

async function waitForComponentLoaded(
    bridge: NonNullable<Window['djiBridge']>,
    name: string,
    timeoutMs = COMPONENT_LOAD_TIMEOUT_MS,
    intervalMs = COMPONENT_LOAD_POLL_MS
): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        if (bridge.platformIsComponentLoaded(name)) {
            return true;
        }

        await sleep(intervalMs);
    }

    return bridge.platformIsComponentLoaded(name);
}

/**
 * Apply `platformSetWorkspaceId` and `platformSetInformation`. These two
 * calls are what the Pilot main page reads when rendering the Cloud
 * Service tile. They are deliberately decoupled from component loading
 * so a transient MQTT/api/ws failure can't leave the user staring at
 * "Not Logged In" while every other indicator says we're connected.
 */
function setPilotPlatformInfo(bridge: NonNullable<Window['djiBridge']>, cfg: DJIBridgeConfig): void {
    if (typeof bridge.platformSetWorkspaceId === 'function') {
        try {
            if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cfg.workspace_id)) {
                pushLog('error', 'WORKSPACE_ID is not a UUID — Pilot rejects platformSetWorkspaceId with code 615000');
            } else {
            const raw = bridge.platformSetWorkspaceId(cfg.workspace_id);
            pushLog('info', `platformSetWorkspaceId("${cfg.workspace_id}") → ${raw}`);
            const parsed = parseBridgeResult('platformSetWorkspaceId', raw);
            if (parsed.data === false) {
                pushLog('warn', 'platformSetWorkspaceId returned data:false — Pilot may show "Not Logged In"');
            }
            }
        } catch (err) {
            pushLog('error', `platformSetWorkspaceId threw: ${(err as Error).message}`);
        }
    } else {
        pushLog('warn', 'platformSetWorkspaceId not exposed — Pilot tile may stay "Not Logged In"');
    }

    if (typeof bridge.platformSetInformation === 'function') {
        try {
            const raw = bridge.platformSetInformation(
                cfg.platform_name,
                cfg.workspace_name,
                cfg.workspace_desc
            );
            pushLog('info', `platformSetInformation("${cfg.platform_name}", "${cfg.workspace_name}", "${cfg.workspace_desc}") → ${raw}`);
            const parsed = parseBridgeResult('platformSetInformation', raw);
            if (parsed.data === false) {
                pushLog('warn', 'platformSetInformation returned data:false — Pilot may show "Not Logged In"');
            }
        } catch (err) {
            pushLog('error', `platformSetInformation threw: ${(err as Error).message}`);
        }
    } else {
        pushLog('warn', 'platformSetInformation not exposed — Pilot tile may stay "Not Logged In"');
    }
}

/**
 * Load a non-`thing` component (api / ws / liveshare). These components
 * are not exposed by every firmware revision; their absence should not
 * break the rest of the bootstrap, so we log + continue rather than
 * throw. The redacted JSON params are recorded for diagnostics.
 */
function loadOptionalComponent(bridge: NonNullable<Window['djiBridge']>, name: string, params: string): void {
    const redacted = params.replace(/("token"|"password")\s*:\s*"[^"]*"/g, '$1:"<redacted>"');
    try {
        const raw = bridge.platformLoadComponent(name, params);
        pushLog('info', `platformLoadComponent("${name}", ${redacted}) → ${raw}`);
        try {
            parseBridgeResult(`platformLoadComponent(${name})`, raw);
            pushLog('info', `platformIsComponentLoaded("${name}") → ${bridge.platformIsComponentLoaded(name)}`);
        } catch (err) {
            pushLog('warn', `optional component ${name} returned non-zero: ${(err as Error).message}`);
        }
    } catch (err) {
        pushLog('warn', `optional component ${name} threw: ${(err as Error).message}`);
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
    // Unload in reverse load order. Each call is best-effort because
    // logout must always succeed from the user's perspective.
    for (const name of ['liveshare', 'ws', 'api', 'thing']) {
        try {
            if (bridge.platformIsComponentLoaded(name)) {
                const raw = bridge.platformUnloadComponent(name);
                pushLog('info', `platformUnloadComponent("${name}") → ${raw}`);
                try {
                    parseBridgeResult(`platformUnloadComponent(${name})`, raw);
                } catch (err) {
                    pushLog('warn', `unload ${name} returned non-zero: ${(err as Error).message}`);
                }
            }
        } catch (err) {
            pushLog('error', `failed to unload ${name} component: ${(err as Error).message}`);
        }
    }

    // Reset the Pilot Cloud Service tile back to "Not Logged In" by
    // blanking platform info. Older firmwares may not expose these.
    try {
        if (typeof bridge.platformSetInformation === 'function') {
            bridge.platformSetInformation('', '', '');
        }
        if (typeof bridge.platformSetWorkspaceId === 'function') {
            bridge.platformSetWorkspaceId('');
        }
    } catch (err) {
        pushLog('warn', `failed to clear platform info: ${(err as Error).message}`);
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
