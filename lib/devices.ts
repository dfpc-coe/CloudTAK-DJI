import { EventEmitter } from 'node:events';

export type DeviceType = 'aircraft' | 'gateway' | 'dock' | 'payload';

/**
 * DJI Cloud API "domain" enum (gateway-device topology).
 *  '0' = aircraft, '1' = payload, '2' = remote controller, '3' = dock.
 */
export type DeviceDomain = '0' | '1' | '2' | '3';

export function domainToType(domain: DeviceDomain | string): DeviceType {
    switch (String(domain)) {
        case '0': return 'aircraft';
        case '1': return 'payload';
        case '2': return 'gateway';
        case '3': return 'dock';
        default: return 'aircraft';
    }
}

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
    /** DJI domain code (`0`=aircraft, `2`=RC, `3`=dock, ...). */
    domain?: DeviceDomain;
    /** Cached DJI product enum, e.g. `0-77-0` for Mavic 3E. */
    model_key?: string;
    /** Parent gateway SN for sub-devices (aircraft -> RC/dock). */
    parent_sn?: string;
    /** Slot index reported by gateway (e.g. "A"). */
    index?: string;
    model?: string;
    online: boolean;
    /** True once the device has been bound to an organization. */
    bound?: boolean;
    last_seen?: string;
    osd?: DJIOsd;
    /** Last raw `state` payload (live_capacity, is_cloud_control_auth, ...). */
    state?: Record<string, unknown>;
    livestream?: {
        url?: string;
        kind?: 'rtmp' | 'rtsp' | 'hls' | 'webrtc' | 'gb28181';
        active: boolean;
    };
}

export interface DeviceEvent {
    type: 'snapshot' | 'osd' | 'state' | 'online' | 'offline' | 'livestream' | 'bound';
    sn: string;
    device?: DJIDevice;
    osd?: DJIOsd;
    state?: Record<string, unknown>;
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

    applyState(sn: string, state: Record<string, unknown>): DJIDevice {
        const merged = { ...(this.devices.get(sn)?.state ?? {}), ...state };
        const dev = this.upsert(sn, {
            state: merged,
            last_seen: new Date().toISOString(),
            online: true
        });
        this.emit('event', { type: 'state', sn, device: dev, state: merged } as DeviceEvent);
        return dev;
    }

    markBound(sn: string, callsign?: string): DJIDevice {
        const dev = this.upsert(sn, { bound: true, callsign });
        this.emit('event', { type: 'bound', sn, device: dev } as DeviceEvent);
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
