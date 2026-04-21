import Err from '@openaddresses/batch-error';
import { Type } from '@sinclair/typebox';
import Schema from '@openaddresses/batch-schema';
import Config from '../lib/config.js';
import { verify } from '../lib/auth.js';
import { devices, type DeviceEvent } from '../lib/devices.js';
import { DJIDevice } from '../lib/types.js';

function bearer(req: { headers: Record<string, unknown> }): string | undefined {
    const h = req.headers['authorization'];
    if (typeof h !== 'string' || !h.startsWith('Bearer ')) return undefined;
    return h.slice('Bearer '.length).trim();
}

/**
 * Web-facing routes the CloudTAK-DJI UI uses to enumerate UAS and
 * receive live (Server-Sent Events) telemetry updates.
 */
export default async function router(schema: Schema, config: Config) {
    await schema.get('/device', {
        name: 'List Devices',
        group: 'Device',
        res: Type.Object({
            total: Type.Integer(),
            items: Type.Array(DJIDevice)
        })
    }, async (req, res) => {
        try {
            const tok = bearer(req);
            if (!tok) throw new Err(401, null, 'Authentication Required');
            verify(config, tok);

            const items = devices.list();
            res.json({ total: items.length, items });
        } catch (err) {
            Err.respond(err as Error, res);
        }
    });

    await schema.get('/device/:sn', {
        name: 'Get Device',
        group: 'Device',
        params: Type.Object({ sn: Type.String() }),
        res: DJIDevice
    }, async (req, res) => {
        try {
            const tok = bearer(req);
            if (!tok) throw new Err(401, null, 'Authentication Required');
            verify(config, tok);

            const dev = devices.get(req.params.sn);
            if (!dev) throw new Err(404, null, 'Device not found');
            res.json(dev);
        } catch (err) {
            Err.respond(err as Error, res);
        }
    });

    /**
     * Server-Sent Events stream of device updates.
     *
     * Browsers cannot set custom headers on EventSource, so the JWT may be
     * passed via `?token=`. Tokens are short-lived JWTs minted by /login.
     */
    schema.router.get('/sse/device', (req, res) => {
        const token = (typeof req.query.token === 'string' ? req.query.token : undefined)
            ?? bearer(req as unknown as { headers: Record<string, unknown> });

        if (!token) {
            return Err.respond(new Err(401, null, 'Authentication Required'), res);
        }

        try {
            verify(config, token);
        } catch (err) {
            return Err.respond(err as Error, res);
        }

        res.status(200).set({
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no'
        });
        res.flushHeaders();

        const snapshot = JSON.stringify({ type: 'snapshot', items: devices.list() });
        res.write(`event: snapshot\ndata: ${snapshot}\n\n`);

        const onEvent = (evt: DeviceEvent) => {
            res.write(`event: ${evt.type}\ndata: ${JSON.stringify(evt)}\n\n`);
        };
        devices.on('event', onEvent);

        const heartbeat = setInterval(() => res.write(': ping\n\n'), 15_000);

        req.on('close', () => {
            clearInterval(heartbeat);
            devices.off('event', onEvent);
        });
    });
}
