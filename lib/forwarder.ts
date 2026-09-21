import type Config from './config.js';
import type { SessionPayload } from './auth.js';
import fetch from './fetch.js';
import { devices, type DeviceEvent, type DeviceType, type DJIDevice } from './devices.js';

const FORWARD_INTERVAL_MS = 1000;
const STALE_MS = 20_000;

/**
 * Streams aircraft OSD positions into CloudTAK as CoTs submitted on behalf
 * of the operator that claimed the aircraft (or its gateway).
 */
export class CloudTAKForwarder {
    private tokens = new Map<string, string>();
    private sent = new Map<string, number>();
    private pending = new Set<string>();
    private onEvent = (evt: DeviceEvent) => {
        if (evt.type === 'osd' && evt.device) void this.forward(evt.device);
    };

    constructor(private config: Config) {}

    start(): void {
        devices.on('event', this.onEvent);
    }

    stop(): void {
        devices.off('event', this.onEvent);
    }

    /** Associate a device (aircraft or its gateway) with an operator session */
    claim(sn: string, session: SessionPayload, type?: DeviceType): DJIDevice {
        this.tokens.set(session.sub, session.cloudtak_token);
        return devices.claim(sn, session.sub, type);
    }

    private owner(dev: DJIDevice): string | undefined {
        if (dev.owner) return dev.owner;
        if (dev.parent_sn) return devices.get(dev.parent_sn)?.owner;
        return undefined;
    }

    private async forward(dev: DJIDevice): Promise<void> {
        if (dev.type !== 'aircraft') return;

        const feat = feature(dev);
        if (!feat) return;

        const owner = this.owner(dev);
        const token = owner ? this.tokens.get(owner) : undefined;
        if (!owner || !token) return;

        const now = Date.now();
        if (this.pending.has(dev.sn) || now - (this.sent.get(dev.sn) ?? 0) < FORWARD_INTERVAL_MS) return;

        this.pending.add(dev.sn);
        this.sent.set(dev.sn, now);

        try {
            const url = new URL('/api/profile/feature', this.config.API_URL);
            url.searchParams.set('archive', 'false');
            url.searchParams.set('submit', 'true');
            url.searchParams.set('broadcast', 'true');

            const res = await fetch(url, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify(feat)
            });

            if (res.status === 401 || res.status === 403) {
                this.tokens.delete(owner);
                console.error(`forwarder: CloudTAK session for ${owner} rejected (${res.status}) - login again to resume`);
            } else if (!res.ok) {
                console.error(`forwarder: CloudTAK rejected ${dev.sn}: ${res.status} ${await res.text()}`);
            }
        } catch (err) {
            console.error(`forwarder: failed to submit ${dev.sn}:`, err);
        } finally {
            this.pending.delete(dev.sn);
        }
    }
}

export function feature(dev: DJIDevice) {
    const osd = dev.osd;
    if (!osd || osd.longitude === undefined || osd.latitude === undefined) return null;
    // DJI reports 0,0 until the aircraft has a GPS fix
    if (osd.longitude === 0 && osd.latitude === 0) return null;

    const now = new Date();

    return {
        id: `DJI-${dev.sn}`,
        type: 'Feature' as const,
        path: '/',
        properties: {
            type: 'a-f-A-M-H-Q',
            how: 'm-g',
            callsign: dev.callsign || `UAS ${dev.sn.slice(-4)}`,
            time: now.toISOString(),
            start: now.toISOString(),
            stale: new Date(now.getTime() + STALE_MS).toISOString(),
            center: [osd.longitude, osd.latitude],
            remarks: `DJI ${dev.model ?? dev.model_key ?? 'UAS'} - SN: ${dev.sn}`,
            ...(osd.attitude_head !== undefined && { course: (osd.attitude_head + 360) % 360 }),
            ...(osd.horizontal_speed !== undefined && { speed: osd.horizontal_speed })
        },
        geometry: {
            type: 'Point' as const,
            coordinates: [osd.longitude, osd.latitude, osd.height ?? 0]
        }
    };
}

let _forwarder: CloudTAKForwarder | undefined;
export function setForwarder(f: CloudTAKForwarder): void { _forwarder = f; }
export function getForwarder(): CloudTAKForwarder {
    if (!_forwarder) throw new Error('CloudTAK forwarder not initialised');
    return _forwarder;
}
