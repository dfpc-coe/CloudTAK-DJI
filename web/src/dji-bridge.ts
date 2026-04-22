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

function installCallback(): void {
    if (installedCallback) return;
    window.cloudtakDjiBridgeCallback = function (...args: unknown[]) {
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
 * Verify the DJI app license and load the `thing` component so the
 * controller can publish to MQTT. Throws on misconfiguration so the
 * Login view can surface a useful error to the operator.
 */
export async function bootstrapDJIBridge(): Promise<void> {
    if (!isDJIBridgeAvailable()) return;

    const cfg = await std('/api/config/dji') as DJIBridgeConfig;
    if (!cfg.configured || !cfg.app_id || !cfg.app_key || !cfg.license) {
        throw new Error('DJI Cloud API credentials are not configured on this CloudTAK-DJI server');
    }

    const bridge = window.djiBridge!;
    installCallback();

    bridge.platformVerifyLicense(cfg.app_id, cfg.app_key, cfg.license);
    if (!bridge.platformIsVerified()) {
        throw new Error('DJI controller rejected the supplied app license');
    }

    const params = JSON.stringify({
        host: cfg.mqtt.host,
        connectCallback: 'cloudtakDjiBridgeCallback',
        username: cfg.mqtt.username,
        password: cfg.mqtt.password
    });

    bridge.platformLoadComponent('thing', params);
}
