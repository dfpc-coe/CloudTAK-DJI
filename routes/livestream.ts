import Err from '@openaddresses/batch-error';
import { Type } from '@sinclair/typebox';
import Schema from '@openaddresses/batch-schema';
import Config from '../lib/config.js';
import { verify } from '../lib/auth.js';
import { devices } from '../lib/devices.js';
import { getBroker } from '../lib/mqtt.js';

function bearer(req: { headers: Record<string, unknown> }): string | undefined {
    const h = req.headers['authorization'];
    if (typeof h !== 'string' || !h.startsWith('Bearer ')) return undefined;
    return h.slice('Bearer '.length).trim();
}

const LivestreamStartReq = Type.Object({
    /** Where the device should push the stream. Defaults to a local RTMP relay. */
    url: Type.Optional(Type.String()),
    /** Stream "quality" - 0 self-adaptive, 1 smooth, 2 SD, 3 HD, 4 super-HD */
    video_quality: Type.Optional(Type.Integer({ minimum: 0, maximum: 4 })),
    /** rtmp | rtsp | gb28181 | webrtc - per DJI Cloud API spec */
    url_type: Type.Optional(Type.Union([
        Type.Literal('rtmp'),
        Type.Literal('rtsp'),
        Type.Literal('gb28181'),
        Type.Literal('webrtc')
    ])),
    /** Optional camera index, e.g. "39-0-7" for FPV/Wide/Zoom selection. */
    video_id: Type.Optional(Type.String())
});

const LivestreamRes = Type.Object({
    sn: Type.String(),
    active: Type.Boolean(),
    url: Type.Optional(Type.String()),
    kind: Type.Optional(Type.String()),
    raw: Type.Optional(Type.Any())
});

/**
 * Web-facing routes to start/stop a device livestream. Internally these
 * invoke the DJI `live_start_push` / `live_stop_push` Thing-Model services
 * over MQTT and await the corresponding services_reply.
 */
export default async function router(schema: Schema, config: Config) {
    await schema.post('/device/:sn/livestream', {
        name: 'Start Livestream',
        group: 'Livestream',
        params: Type.Object({ sn: Type.String() }),
        body: LivestreamStartReq,
        res: LivestreamRes
    }, async (req, res) => {
        try {
            const tok = bearer(req);
            if (!tok) throw new Err(401, null, 'Authentication Required');
            verify(config, tok);

            const dev = devices.get(req.params.sn);
            if (!dev) throw new Err(404, null, 'Device not found');
            if (!dev.online) throw new Err(409, null, 'Device offline');

            const url_type = req.body.url_type ?? 'rtmp';
            const url = req.body.url
                ?? `rtmp://${process.env.RTMP_HOST ?? 'media-infra'}:1935/live/${req.params.sn}`;

            const reply = await getBroker().invokeService<{ data?: { result?: number } }>(
                req.params.sn,
                'live_start_push',
                {
                    url_type,
                    url,
                    video_id: req.body.video_id ?? '',
                    video_quality: req.body.video_quality ?? 0
                }
            );

            const ok = (reply?.data?.result ?? 0) === 0;
            if (!ok) {
                throw new Err(502, null, `Device rejected live_start_push: ${JSON.stringify(reply)}`);
            }

            const updated = devices.applyLivestream(req.params.sn, {
                url, kind: url_type as 'rtmp' | 'rtsp' | 'webrtc' | 'gb28181', active: true
            });

            res.json({
                sn: req.params.sn,
                active: true,
                url: updated.livestream?.url,
                kind: updated.livestream?.kind,
                raw: reply
            });
        } catch (err) {
            Err.respond(err as Error, res);
        }
    });

    await schema.delete('/device/:sn/livestream', {
        name: 'Stop Livestream',
        group: 'Livestream',
        params: Type.Object({ sn: Type.String() }),
        res: LivestreamRes
    }, async (req, res) => {
        try {
            const tok = bearer(req);
            if (!tok) throw new Err(401, null, 'Authentication Required');
            verify(config, tok);

            const reply = await getBroker().invokeService(
                req.params.sn,
                'live_stop_push',
                {}
            );
            devices.applyLivestream(req.params.sn, { active: false });
            res.json({ sn: req.params.sn, active: false, raw: reply });
        } catch (err) {
            Err.respond(err as Error, res);
        }
    });
}
