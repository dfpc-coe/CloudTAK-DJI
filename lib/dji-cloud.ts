import express, { Router } from 'express';
import Err from '@openaddresses/batch-error';
import { fetch } from 'undici';
import crypto from 'node:crypto';
import type Config from './config.js';
import { sign } from './auth.js';
import { devices } from './devices.js';

/**
 * DJI Cloud API endpoints consumed by DJI Pilot 2 / RC Plus directly.
 *
 * Per DJI's "Cloud API" spec these live under `/manage/api/v1/*` and use
 * the response envelope `{code, message, data}`. We federate Pilot login
 * back to CloudTAK so a single set of credentials works in both surfaces,
 * then mint our own JWT (encapsulating the upstream CloudTAK token) and
 * hand MQTT credentials back to Pilot so it joins the same broker we
 * subscribe to in `lib/mqtt.ts`.
 *
 * Mounted by `index.ts` at `/manage/api/v1`.
 */
export default function djiCloudRouter(config: Config): Router {
    const router = express.Router();
    router.use(express.json({ limit: '5mb' }));

    /**
     * POST /manage/api/v1/iam/login
     *
     * Pilot calls this with credentials the user typed into the
     * "Cloud Server" QR code login screen.
     */
    router.post('/iam/login', async (req, res) => {
        try {
            const body = req.body as { username?: string; password?: string };
            if (!body || typeof body.username !== 'string' || typeof body.password !== 'string') {
                return res.json({ code: 100008, message: 'username and password required' });
            }

            const upstream = await fetch(`${config.API_URL}/api/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: body.username, password: body.password })
            });

            if (upstream.status === 401 || upstream.status === 403) {
                return res.json({ code: 100008, message: 'Invalid username or password' });
            }
            if (upstream.status >= 400) {
                return res.json({ code: 500000, message: `Upstream error: ${upstream.status}` });
            }

            const upstreamBody = await upstream.json() as {
                token: string; access?: string; email?: string;
            };

            const access_token = sign(config, {
                sub: upstreamBody.email || body.username,
                access: upstreamBody.access,
                cloudtak_token: upstreamBody.token
            });

            res.json({
                code: 0,
                message: 'success',
                data: {
                    access_token,
                    refresh_token: access_token,
                    user_id: crypto.createHash('sha1').update(upstreamBody.email || body.username).digest('hex'),
                    username: body.username,
                    workspace_id: config.WORKSPACE_ID,
                    mqtt_username: config.MQTT_USERNAME ?? body.username,
                    mqtt_password: config.MQTT_PASSWORD ?? '',
                    mqtt_addr: config.MQTT_PUBLIC_URL
                }
            });
        } catch (err) {
            Err.respond(err as Error, res);
        }
    });

    /** GET /manage/api/v1/workspaces/:workspace_id/devices */
    router.get('/workspaces/:workspace_id/devices', (req, res) => {
        const data = devices.list().map(d => ({
            device_sn: d.sn,
            device_name: d.callsign ?? d.model,
            online_status: d.online
        }));
        res.json({ code: 0, message: 'success', data });
    });

    /** POST /manage/api/v1/devices/:device_sn/binding */
    router.post('/devices/:device_sn/binding', (req, res) => {
        const body = (req.body ?? {}) as { device_callsign?: string };
        devices.upsert(req.params.device_sn, {
            callsign: body.device_callsign,
            type: 'aircraft',
            domain: '0'
        });
        // Emits a `bound` SSE event so the web UI shows the UAS
        // immediately, even before the first OSD frame arrives.
        devices.markBound(req.params.device_sn, body.device_callsign);
        res.json({ code: 0, message: 'success' });
    });

    /** GET /manage/api/v1/livestream/capacity */
    router.get('/livestream/capacity', (_req, res) => {
        const list = devices.list().filter(d => d.type === 'aircraft' || d.type === 'gateway');
        res.json({
            code: 0,
            message: 'success',
            data: {
                available_video_number: 4,
                coexist_video_number_max: 4,
                devices_list: list.map(d => ({
                    sn: d.sn,
                    online_status: d.online,
                    camera_list: [{
                        camera_index: '39-0-7',
                        available_video_number: 1,
                        coexist_video_number_max: 1,
                        videos_list: [{
                            video_index: '0',
                            video_type: 'normal',
                            switch_video_types: ['normal', 'wide', 'zoom']
                        }]
                    }]
                }))
            }
        });
    });

    return router;
}
