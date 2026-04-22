import mqtt from 'mqtt';
import type { MqttClient, IClientOptions, IClientPublishOptions } from 'mqtt';
import crypto from 'node:crypto';
import type Config from './config.js';
import { devices, domainToType, type DeviceDomain } from './devices.js';

/**
 * DJI Cloud API "Thing Model" topic conventions
 * (see DJI Cloud API docs - "Thing Model" / Pilot-to-Cloud and Dock-to-Cloud).
 *
 * Up (device -> server):
 *   sys/product/{gw_sn}/status            <- gateway topology (update_topo)
 *   thing/product/{gw_sn}/status          <- same, RC-Pro / Pilot-2 variant
 *   thing/product/{sn}/osd                <- high-frequency telemetry
 *   thing/product/{sn}/state              <- device state (live_capacity, etc)
 *   thing/product/{sn}/services_reply     <- async replies to invoked services
 *   thing/product/{sn}/events             <- async events (HMS, fileupload, ...)
 *   thing/product/{gw_sn}/requests        <- device-initiated requests
 *                                            (config, airport_bind_status,
 *                                             airport_organization_get,
 *                                             airport_organization_bind, ...)
 *
 * Down (server -> device):
 *   sys/product/{gw_sn}/status_reply      <- ack update_topo (REQUIRED)
 *   thing/product/{gw_sn}/status_reply    <- ack update_topo (RC-Pro variant)
 *   thing/product/{gw_sn}/requests_reply  <- ack device-initiated requests
 *   thing/product/{sn}/services           <- invoke a service (e.g. live_start_push)
 *
 * Without the *_reply publishes the Pilot/Dock will keep retrying the
 * handshake and never start pushing OSD frames. This is the most common
 * "drone connected but never appears" failure mode.
 */
const TOPIC_SUBSCRIBE = [
    'sys/product/+/status',
    'thing/product/+/status',
    'thing/product/+/osd',
    'thing/product/+/state',
    'thing/product/+/services_reply',
    'thing/product/+/events',
    'thing/product/+/requests'
];

/** Methods we auto-acknowledge on the requests topic with `result: 0`. */
const AUTO_ACK_REQUESTS = new Set([
    'config',
    'airport_bind_status',
    'airport_organization_get',
    'airport_organization_bind',
    'flighttask_progress'
]);

interface ServiceReplyWaiter {
    resolve: (value: unknown) => void;
    reject: (err: Error) => void;
    timer: NodeJS.Timeout;
}

export class DJIBroker {
    private client?: MqttClient;
    private waiters = new Map<string, ServiceReplyWaiter>();

    constructor(private config: Config) {}

    async connect(): Promise<void> {
        const opts: IClientOptions = {
            clientId: `cloudtak-dji-${crypto.randomBytes(4).toString('hex')}`,
            reconnectPeriod: 5000,
            connectTimeout: 10_000,
            username: this.config.MQTT_USERNAME,
            password: this.config.MQTT_PASSWORD
        };

        this.client = mqtt.connect(this.config.MQTT_URL, opts);

        this.client.on('connect', () => {
            if (!this.config.silent) console.error(`ok - mqtt connected: ${this.config.MQTT_URL}`);
            this.client!.subscribe(TOPIC_SUBSCRIBE, { qos: 1 }, (err) => {
                if (err) console.error('mqtt subscribe error:', err);
            });
        });

        this.client.on('error', (err) => console.error('mqtt error:', err));
        this.client.on('reconnect', () => {
            if (!this.config.silent) console.error('ok - mqtt reconnecting');
        });

        this.client.on('message', (topic, payload) => {
            try {
                this.dispatch(topic, payload);
            } catch (err) {
                console.error('mqtt dispatch error:', topic, err);
            }
        });
    }

    async close(): Promise<void> {
        if (this.client) {
            await new Promise<void>((resolve) => this.client!.end(false, {}, () => resolve()));
        }
    }

    /** Parse a topic like `thing/product/{sn}/osd` -> { sn, kind } */
    private parseTopic(topic: string): { ns: string; sn: string; kind: string } | null {
        const parts = topic.split('/');
        // sys/product/{sn}/status   OR   thing/product/{sn}/{kind}
        if (parts.length < 4 || parts[1] !== 'product') return null;
        return { ns: parts[0], sn: parts[2], kind: parts.slice(3).join('/') };
    }

    private dispatch(topic: string, payload: Buffer): void {
        const parsed = this.parseTopic(topic);
        if (!parsed) return;

        let body: Record<string, unknown>;
        try {
            body = JSON.parse(payload.toString('utf8')) as Record<string, unknown>;
        } catch {
            // payload is not JSON - ignore for these topics
            return;
        }

        // Gateway topology — published by the RC (Pilot 2) or Dock when it
        // comes online and whenever the connected sub-device set changes.
        // Both `sys/.../status` and `thing/.../status` are observed in the
        // wild; treat them identically. Without a reply on
        // `*/status_reply` Pilot will keep retrying and the aircraft never
        // begins streaming OSD.
        if ((parsed.ns === 'sys' || parsed.ns === 'thing') && parsed.kind === 'status') {
            const data = (body['data'] as Record<string, unknown> | undefined) ?? {};
            const gwDomain = String(data['domain'] ?? '2') as DeviceDomain;
            const gwModelKey = makeModelKey(gwDomain, data['type'], data['sub_type']);

            devices.upsert(parsed.sn, {
                type: domainToType(gwDomain),
                domain: gwDomain,
                model_key: gwModelKey,
                online: true,
                last_seen: new Date().toISOString()
            });
            devices.setOnline(parsed.sn, true, domainToType(gwDomain));

            const subDevices = (data['sub_devices'] as Array<Record<string, unknown>> | undefined)
                // legacy/dock1 spelled `sub_device`
                ?? (data['sub_device'] as Array<Record<string, unknown>> | undefined)
                ?? [];

            const subSnList: string[] = [];
            for (const sub of subDevices) {
                const subSn = typeof sub.sn === 'string' ? sub.sn : undefined;
                if (!subSn) continue;
                const subDomain = String(sub.domain ?? '0') as DeviceDomain;
                devices.upsert(subSn, {
                    type: domainToType(subDomain),
                    domain: subDomain,
                    model_key: makeModelKey(subDomain, sub.type, sub.sub_type),
                    parent_sn: parsed.sn,
                    index: typeof sub.index === 'string' ? sub.index : undefined,
                    online: true,
                    last_seen: new Date().toISOString()
                });
                devices.setOnline(subSn, true, domainToType(subDomain));
                subSnList.push(subSn);
            }

            // Mark previously-known children of this gateway that did not
            // appear in this topology frame as offline.
            for (const dev of devices.list()) {
                if (dev.parent_sn === parsed.sn && !subSnList.includes(dev.sn)) {
                    devices.setOnline(dev.sn, false, dev.type);
                }
            }

            // REQUIRED handshake reply. Pilot/Dock waits for this before
            // proceeding past organization-bind.
            const replyTopic = parsed.ns === 'sys'
                ? `sys/product/${parsed.sn}/status_reply`
                : `thing/product/${parsed.sn}/status_reply`;
            this.publishReply(replyTopic, body, 'update_topo', { result: 0 });
            return;
        }

        if (parsed.ns === 'thing' && parsed.kind === 'osd') {
            const data = (body['data'] as Record<string, unknown> | undefined) ?? body;
            devices.applyOsd(parsed.sn, {
                longitude: pickNumber(data, 'longitude'),
                latitude: pickNumber(data, 'latitude'),
                height: pickNumber(data, 'height'),
                elevation: pickNumber(data, 'elevation'),
                attitude_head: pickNumber(data, 'attitude_head'),
                horizontal_speed: pickNumber(data, 'horizontal_speed'),
                vertical_speed: pickNumber(data, 'vertical_speed'),
                mode_code: pickNumber(data, 'mode_code'),
                battery: extractBattery(data['battery'])
            });
            return;
        }

        if (parsed.ns === 'thing' && parsed.kind === 'state') {
            // `state` carries device property changes (live_capacity,
            // is_cloud_control_auth, etc). Stash the raw body so the
            // web UI / livestream code can see it; an explicit `state`
            // event is emitted by the registry.
            const data = (body['data'] as Record<string, unknown> | undefined) ?? {};
            devices.applyState(parsed.sn, data);
            return;
        }

        if (parsed.ns === 'thing' && parsed.kind === 'requests') {
            const method = String(body['method'] ?? '');
            if (AUTO_ACK_REQUESTS.has(method)) {
                this.publishReply(
                    `thing/product/${parsed.sn}/requests_reply`,
                    body,
                    method,
                    requestsReplyData(method, body)
                );
            } else if (!this.config.silent) {
                console.error(`mqtt: unhandled request method=${method} sn=${parsed.sn}`);
            }
            return;
        }

        if (parsed.ns === 'thing' && parsed.kind === 'services_reply') {
            const tid = String(body['tid'] ?? '');
            const waiter = this.waiters.get(tid);
            if (waiter) {
                clearTimeout(waiter.timer);
                this.waiters.delete(tid);
                waiter.resolve(body);
            }
            return;
        }
    }

    /**
     * Publish a `*_reply` envelope echoing the inbound `tid`/`bid`
     * (per DJI Thing Model). Used by the status_reply and requests_reply
     * handshakes — both REQUIRED for a Mavic to fully bind.
     */
    private publishReply(
        topic: string,
        inbound: Record<string, unknown>,
        method: string,
        data: Record<string, unknown>
    ): void {
        if (!this.client) return;
        const payload = {
            tid: String(inbound['tid'] ?? crypto.randomUUID()),
            bid: String(inbound['bid'] ?? crypto.randomUUID()),
            timestamp: Date.now(),
            method,
            data
        };
        this.client.publish(topic, JSON.stringify(payload), { qos: 1 }, (err) => {
            if (err) console.error('mqtt reply publish error:', topic, err);
        });
    }

    /**
     * Invoke a Thing-Model service on a device and await its reply.
     * Used to start/stop livestreams, take photos, etc.
     */
    async invokeService<T = unknown>(
        sn: string,
        method: string,
        data: Record<string, unknown>,
        timeoutMs = 10_000
    ): Promise<T> {
        if (!this.client) throw new Error('mqtt not connected');

        const tid = crypto.randomUUID();
        const bid = crypto.randomUUID();
        const topic = `thing/product/${sn}/services`;
        const payload = {
            tid,
            bid,
            timestamp: Date.now(),
            method,
            data
        };

        return new Promise<T>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.waiters.delete(tid);
                reject(new Error(`service ${method} timed out after ${timeoutMs}ms`));
            }, timeoutMs);

            this.waiters.set(tid, {
                resolve: (v) => resolve(v as T),
                reject,
                timer
            });

            const opts: IClientPublishOptions = { qos: 1 };
            this.client!.publish(topic, JSON.stringify(payload), opts, (err) => {
                if (err) {
                    clearTimeout(timer);
                    this.waiters.delete(tid);
                    reject(err);
                }
            });
        });
    }
}

let _broker: DJIBroker | undefined;
export function setBroker(b: DJIBroker): void { _broker = b; }
export function getBroker(): DJIBroker {
    if (!_broker) throw new Error('DJI broker not initialised');
    return _broker;
}

function pickNumber(obj: Record<string, unknown>, key: string): number | undefined {
    const val = obj[key];
    return typeof val === 'number' && Number.isFinite(val) ? val : undefined;
}

function extractBattery(raw: unknown): { capacity_percent?: number; voltage?: number; temperature?: number } | undefined {
    if (!raw || typeof raw !== 'object') return undefined;
    const obj = raw as Record<string, unknown>;
    return {
        capacity_percent: pickNumber(obj, 'capacity_percent'),
        voltage: pickNumber(obj, 'voltage'),
        temperature: pickNumber(obj, 'temperature')
    };
}

function makeModelKey(domain: unknown, type: unknown, subType: unknown): string | undefined {
    const d = domain == null ? '' : String(domain);
    const t = type == null ? '' : String(type);
    const s = subType == null ? '' : String(subType);
    if (!d || !t) return undefined;
    return `${d}-${t}-${s}`;
}

/**
 * Build the `data` payload for a `requests_reply` based on the inbound
 * method. DJI accepts `{result: 0}` for nearly every flow; some methods
 * additionally expect organization metadata that we synthesise here.
 */
function requestsReplyData(method: string, body: Record<string, unknown>): Record<string, unknown> {
    const inbound = (body['data'] as Record<string, unknown> | undefined) ?? {};
    if (method === 'airport_bind_status') {
        const reqDevices = (inbound['devices'] as Array<{ sn?: string }> | undefined) ?? [];
        return {
            result: 0,
            output: {
                bind_status_list: reqDevices.map((d) => ({
                    sn: d.sn,
                    is_bind: true,
                    bind_organization_id: 'cloudtak',
                    bind_organization_name: 'CloudTAK'
                }))
            }
        };
    }
    if (method === 'airport_organization_get') {
        return {
            result: 0,
            output: { organization_name: 'CloudTAK' }
        };
    }
    if (method === 'airport_organization_bind') {
        const bind = (inbound['bind_devices'] as Array<{ sn?: string; device_callsign?: string }> | undefined) ?? [];
        for (const b of bind) {
            if (b.sn) {
                devices.upsert(b.sn, {
                    callsign: b.device_callsign,
                    bound: true
                });
            }
        }
        return {
            result: 0,
            output: {
                bind_devices: bind.map((b) => ({ sn: b.sn, errCode: 0 }))
            }
        };
    }
    return { result: 0 };
}
