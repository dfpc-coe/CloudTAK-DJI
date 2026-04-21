import mqtt, { MqttClient, IClientOptions, IClientPublishOptions } from 'mqtt';
import crypto from 'node:crypto';
import type Config from './config.js';
import { devices } from './devices.js';

/**
 * DJI Cloud API "Thing Model" topic conventions
 * (see DJI Cloud API docs - "Thing Model").
 *
 * sys/product/{sn}/status            <- gateway online / offline / topo
 * thing/product/{sn}/osd             <- high-frequency telemetry
 * thing/product/{sn}/state           <- device state changes
 * thing/product/{sn}/services_reply  <- async replies to service invocations
 * thing/product/{sn}/events          <- async events (HMS, etc.)
 *
 * thing/product/{sn}/services        -> we publish here to invoke services
 *                                       (e.g. live_start_push)
 */
const TOPIC_SUBSCRIBE = [
    'sys/product/+/status',
    'thing/product/+/osd',
    'thing/product/+/state',
    'thing/product/+/services_reply',
    'thing/product/+/events'
];

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

        let body: Record<string, unknown> = {};
        try {
            body = JSON.parse(payload.toString('utf8')) as Record<string, unknown>;
        } catch {
            // payload is not JSON - ignore for these topics
            return;
        }

        if (parsed.ns === 'sys' && parsed.kind === 'status') {
            // DJI status payloads carry sub_type + sub-device topology;
            // for the basic case we treat any status frame as "online".
            devices.setOnline(parsed.sn, true, 'gateway');
            const subDevices = (body['sub_device'] as Array<{ sn?: string; type?: number }> | undefined) || [];
            for (const sub of subDevices) {
                if (sub.sn) devices.setOnline(sub.sn, true, 'aircraft');
            }
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
