/*
 * Shared web-side type definitions
 */

export enum AuthUserAccess {
    USER = 'user',
    ADMIN = 'admin',
    DISABLED = 'disabled'
}

export interface Login {
    email: string;
    access: AuthUserAccess | string;
}

export interface Login_Create {
    username: string;
    password: string;
}

export interface Login_CreateRes {
    token: string;
    access?: AuthUserAccess | string;
    email?: string;
}

export interface LoginConfig {
    name?: string;
    logo?: string;
    forgot?: string;
    signup?: string;
}

/* DJI Cloud API surfaced types (subset) */

export interface DJIDevice {
    sn: string;                 // gateway / aircraft serial
    callsign?: string;          // friendly name
    type: 'aircraft' | 'gateway' | 'dock' | 'payload';
    /** DJI domain code: '0'=aircraft, '2'=RC, '3'=dock. */
    domain?: string;
    /** DJI product enum, e.g. `0-77-0` for Mavic 3E. */
    model_key?: string;
    /** Parent gateway SN for sub-devices. */
    parent_sn?: string;
    index?: string;
    model?: string;
    online: boolean;
    bound?: boolean;
    last_seen?: string;         // ISO timestamp
    osd?: DJIOsd;
    state?: Record<string, unknown>;
    livestream?: {
        url?: string;
        kind?: 'rtmp' | 'rtsp' | 'hls' | 'webrtc' | 'gb28181';
        active: boolean;
    }
}

export interface DJIOsd {
    longitude?: number;
    latitude?: number;
    height?: number;             // meters AGL
    elevation?: number;          // meters ASL
    attitude_head?: number;      // degrees true
    horizontal_speed?: number;   // m/s
    vertical_speed?: number;     // m/s
    battery?: {
        capacity_percent?: number;
        voltage?: number;
        temperature?: number;
    };
    mode_code?: number;
    received_at: string;         // ISO timestamp injected server-side
}

export interface DeviceEvent {
    type: 'snapshot' | 'osd' | 'state' | 'online' | 'offline' | 'livestream' | 'bound';
    sn: string;
    device?: DJIDevice;
    osd?: DJIOsd;
    state?: Record<string, unknown>;
}
