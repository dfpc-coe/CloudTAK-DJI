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

/**
 * Bootstrap payload returned by `/api/config/dji`. Surfaces the DJI Pilot
 * Cloud-API app credentials plus MQTT coordinates to the controller's
 * web view so it can call `window.djiBridge.platformVerifyLicense` and
 * `platformLoadComponent('thing', ...)` after sign-in.
 */
export interface DJIBridgeConfig {
    configured: boolean;
    app_id?: number;
    app_key?: string;
    license?: string;
    workspace_id: string;
    /** Display name of the platform shown on the Pilot Cloud Service tile. */
    platform_name: string;
    /** Display name of the workspace shown on the Pilot Cloud Service tile. */
    workspace_name: string;
    /** Optional description shown on the Pilot Cloud Service tile. */
    workspace_desc: string;
    /** Bearer token for the api/ws components and HTTP base URL. */
    api: {
        host: string;
        token: string;
    };
    ws: {
        host: string;
        token: string;
    };
    mqtt: {
        host: string;
        username: string;
        password: string;
    };
}

/**
 * Subset of the `window.djiBridge` interface the controller's web view
 * exposes. Defined here so we can guard usage inside a regular browser
 * (where `djiBridge` is undefined) without fighting the type system.
 */
export interface DJIBridge {
    platformVerifyLicense(appId: number, appKey: string, license: string): string;
    platformIsVerified(): boolean;
    platformLoadComponent(name: string, params: string): string;
    platformIsComponentLoaded(name: string): boolean;
    platformUnloadComponent(name: string): string;
    /**
     * Tell the controller which workspace this session belongs to.
     * Required for the Pilot main-page "Cloud Service" tile to flip
     * away from "Not Logged In".
     */
    platformSetWorkspaceId?(workspaceId: string): string;
    /**
     * Tell the controller the human-friendly platform name shown on
     * the Pilot main-page Cloud Service tile. Without this call Pilot
     * keeps the tile in its default "Not Logged In" state even when
     * the `thing` MQTT component is fully connected.
     */
    platformSetInformation?(platformName: string, workspaceName: string, desc: string): string;
    /** Returns the workspace id currently set, JSON-encoded. */
    platformGetWorkspaceId?(): string;
    /** Returns the platform/workspace info currently set, JSON-encoded. */
    platformGetInformation?(): string;
    thingGetConnectState?(): string;
    thingConnect?(username: string, password: string, callback: string): string;
}

declare global {
    interface Window {
        djiBridge?: DJIBridge;
    }
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
