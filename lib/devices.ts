import { EventEmitter } from 'node:events';

export type DeviceType = 'aircraft' | 'gateway' | 'dock';

export interface DJIOsd {
    longitude?: number;
    latitude?: number;
    height?: number;
    elevation?: number;
    attitude_head?: number;
    horizontal_speed?: number;
    vertical_speed?: number;
    battery?: {
        capacity_percent?: number;
        voltage?: number;
        temperature?: number;
    };
    mode_code?: number;
    received_at: string;
}

export interface DJIDevice {
    sn: string;
    callsign?: string;
    type: DeviceType;
    model?: string;
    online: boolean;
    last_seen?: string;
    osd?: DJIOsd;
    livestream?: {
        url?: string;
        kind?: 'rtmp' | 'rtsp' | 'hls' | 'webrtc' | 'gb28181';
        active: boolean;
    };
}

export interface DeviceEvent {
    type: 'snapshot' | 'osd' | 'state' | 'online' | 'offline' | 'livestream';
    sn: string;
    device?: DJIDevice;
    osd?: DJIOsd;
}

/**
 * In-memory device registry. Keyed by serial number.
 *
 * Real deployments should back this with Postgres (mirroring CloudTAK's
 * batch-generic patterns). For a "basic" scaffold, in-memory is sufficient
 * and deterministic for tests.
 */
export class DeviceRegistry extends EventEmitter {
    private devices = new Map<string, DJIDevice>();

    list(): DJIDevice[] {
        return Array.from(this.devices.values());
    }

    get(sn: string): DJIDevice | undefined {
        return this.devices.get(sn);
    }

    upsert(sn: string, patch: Partial<DJIDevice>): DJIDevice {
        const existing = this.devices.get(sn);
        const next: DJIDevice = {
            type: patch.type ?? existing?.type ?? 'aircraft',
            online: patch.online ?? existing?.online ?? false,
            ...existing,
            ...patch,
            sn
        };

        this.devices.set(sn, next);
        return next;
    }

    setOnline(sn: string, online: boolean, type: DeviceType = 'gateway'): DJIDevice {
        const dev = this.upsert(sn, {
            online,
            type,
            last_seen: new Date().toISOString()
        });
        this.emit('event', { type: online ? 'online' : 'offline', sn, device: dev } as DeviceEvent);
        return dev;
    }

    applyOsd(sn: string, osd: Omit<DJIOsd, 'received_at'>): DJIDevice {
        const stamped: DJIOsd = { ...osd, received_at: new Date().toISOString() };
        const dev = this.upsert(sn, {
            osd: stamped,
            last_seen: stamped.received_at,
            online: true
        });
        this.emit('event', { type: 'osd', sn, device: dev, osd: stamped } as DeviceEvent);
        return dev;
    }

    applyLivestream(sn: string, ls: DJIDevice['livestream']): DJIDevice {
        const dev = this.upsert(sn, { livestream: ls });
        this.emit('event', { type: 'livestream', sn, device: dev } as DeviceEvent);
        return dev;
    }
}

/** Singleton accessible to both routes and the MQTT subscriber. */
export const devices = new DeviceRegistry();
