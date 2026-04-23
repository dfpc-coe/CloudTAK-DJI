import express, { Router } from 'express';
import Err from '@openaddresses/batch-error';
import { fetch } from 'undici';
import crypto from 'node:crypto';
import type Config from './config.js';
import { sign, verify } from './auth.js';
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
     * DJI Pilot sends `x-auth-token: <access_token>` (the JWT we minted
     * during /iam/login) on every subsequent call. Validate it on all
     * non-login routes so a leaked workspace_id cannot be used to enumerate
     * the device fleet or trigger binds.
     */
    function requirePilot(req: express.Request, _res: express.Response, next: express.NextFunction): void {
        const tok = req.headers['x-auth-token'];
        const value = Array.isArray(tok) ? tok[0] : tok;
        if (typeof value !== 'string' || !value) {
            return next(new Err(401, null, 'Missing x-auth-token'));
        }
        try {
            const session = verify(config, value);
            // Stash the verified session so route handlers can read
            // `sub` (username/email) without re-parsing the JWT. This
            // is what `/users/current` and `/workspaces/current` need
            // to render the Pilot Cloud Service tile.
            (req as express.Request & { djiSession: { sub: string; access?: string; cloudtak_token: string } }).djiSession = session;
            return next();
        } catch (err) {
            return next(err);
        }
    }

    /**
     * Stable user_id derived from the verified email/username. We don't
     * have a real user table; Pilot only needs a stable opaque id so it
     * can correlate WebSocket pushes with the logged-in session.
     */
    function userIdFor(sub: string): string {
        return crypto.createHash('sha1').update(sub).digest('hex');
    }

    /**
     * GET /manage/api/v1/users/current
     *
     * Pilot calls this IMMEDIATELY after `platformLoadComponent('api', …)`
     * to verify the supplied bearer token actually works. If this 404s
     * or returns `code !== 0`, Pilot rolls back the api component and the
     * Cloud Service tile reverts to "Not Logged In" — even though
     * `platformVerifyLicense` succeeded and MQTT is fully connected.
     *
     * Mirrors `UserController#getCurrentUserInfo` in DJI's Java demo.
     */
    router.get('/users/current', requirePilot, (req, res) => {
        const session = (req as express.Request & { djiSession: { sub: string; access?: string } }).djiSession;
        res.json({
            code: 0,
            message: 'success',
            data: {
                user_id: userIdFor(session.sub),
                username: session.sub,
                user_type: 2, // 1=WEB, 2=PILOT — Pilot's UI only renders the tile for type=2
                workspace_id: config.WORKSPACE_ID,
                mqtt_addr: config.MQTT_PUBLIC_URL,
                mqtt_username: config.MQTT_USERNAME ?? '',
                mqtt_password: config.MQTT_PASSWORD ?? ''
            }
        });
    });

    /**
     * GET /manage/api/v1/workspaces/current
     *
     * Drives the text shown on the Pilot main-page Cloud Service tile.
     * The DJI demo's `WorkspaceController#getCurrentWorkspace` returns
     * the WorkspaceDTO directly under `data`. Field names MUST be
     * snake_case and MUST include `platform_name` — that string is what
     * Pilot renders as the tile heading once "logged in".
     */
    router.get('/workspaces/current', requirePilot, (_req, res) => {
        res.json({
            code: 0,
            message: 'success',
            data: {
                workspace_id: config.WORKSPACE_ID,
                workspace_name: config.WORKSPACE_NAME,
                workspace_desc: config.WORKSPACE_DESC,
                platform_name: config.PLATFORM_NAME,
                bind_code: ''
            }
        });
    });

    /**
     * POST /manage/api/v1/login
     *
     * DJI's reference uses bare `/login` (not `/iam/login`). Pilot's
     * "Cloud Server" QR code login form posts here. We keep `/iam/login`
     * as the historical alias and route both to the same handler.
     */
    async function loginHandler(req: express.Request, res: express.Response): Promise<void> {
        try {
            const body = req.body as { username?: string; password?: string };
            if (!body || typeof body.username !== 'string' || typeof body.password !== 'string') {
                res.json({ code: 100008, message: 'username and password required' });
                return;
            }

            const upstream = await fetch(`${config.API_URL}/api/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: body.username, password: body.password })
            });

            if (upstream.status === 401 || upstream.status === 403) {
                res.json({ code: 100008, message: 'Invalid username or password' });
                return;
            }
            if (upstream.status >= 400) {
                res.json({ code: 500000, message: `Upstream error: ${upstream.status}` });
                return;
            }

            const upstreamBody = await upstream.json() as {
                token: string; access?: string; email?: string;
            };

            const sub = upstreamBody.email || body.username;
            const access_token = sign(config, {
                sub,
                access: upstreamBody.access,
                cloudtak_token: upstreamBody.token
            });

            res.json({
                code: 0,
                message: 'success',
                data: {
                    access_token,
                    refresh_token: access_token,
                    user_id: userIdFor(sub),
                    username: body.username,
                    user_type: 2,
                    workspace_id: config.WORKSPACE_ID,
                    mqtt_username: config.MQTT_USERNAME ?? body.username,
                    mqtt_password: config.MQTT_PASSWORD ?? '',
                    mqtt_addr: config.MQTT_PUBLIC_URL
                }
            });
        } catch (err) {
            Err.respond(err as Error, res);
        }
    }
    router.post('/login', loginHandler);
    router.post('/iam/login', loginHandler);

    /**
     * POST /manage/api/v1/token/refresh
     *
     * Pilot refreshes its bearer ~5 minutes before expiry. Re-issue the
     * same JWT contents with a fresh `exp` so subsequent api/ws calls
     * keep working without forcing the operator back through QR login.
     */
    router.post('/token/refresh', (req, res) => {
        const tok = req.headers['x-auth-token'] ?? req.headers['authorization'];
        const value = Array.isArray(tok) ? tok[0] : tok;
        const raw = typeof value === 'string' ? value.replace(/^Bearer\s+/i, '') : '';
        if (!raw) {
            res.status(401).json({ code: 100008, message: 'Missing token' });
            return;
        }
        try {
            const session = verify(config, raw);
            const access_token = sign(config, {
                sub: session.sub,
                access: session.access,
                cloudtak_token: session.cloudtak_token
            });
            res.json({
                code: 0,
                message: 'success',
                data: {
                    access_token,
                    refresh_token: access_token,
                    user_id: userIdFor(session.sub),
                    username: session.sub,
                    workspace_id: config.WORKSPACE_ID
                }
            });
        } catch (err) {
            Err.respond(err as Error, res);
        }
    });

    /**
     * POST /manage/api/v1/iam/login (legacy alias)
     *
     * Historical name from earlier scaffolding. The DJI Java demo
     * uses bare `/login`; both paths route to `loginHandler` above.
     */

    /** GET /manage/api/v1/workspaces/:workspace_id/devices */
    router.get('/workspaces/:workspace_id/devices', requirePilot, (req, res) => {
        const data = devices.list().map(d => ({
            device_sn: d.sn,
            device_name: d.callsign ?? d.model,
            online_status: d.online
        }));
        res.json({ code: 0, message: 'success', data });
    });

    /**
     * GET /manage/api/v1/workspaces/:workspace_id/devices/topologies
     *
     * TSA endpoint. Pilot calls this on first connect (and again every
     * time it receives a `device_online`/`device_offline` WS push) to
     * populate the UAS Fleet view. Without it the fleet list stays
     * empty even when MQTT is delivering OSD frames. Mirrors
     * `TopologyController#obtainDeviceTopologyList` in the DJI demo.
     */
    router.get('/workspaces/:workspace_id/devices/topologies', requirePilot, (req, res) => {
        // Group children under their parent gateways so the response
        // matches DJI's `TopologyResponse` shape `{list: [{hosts: [...]}]}`.
        // Each `host` is a top-level gateway (RC or dock); `children`
        // hangs the aircraft/payloads under it.
        const all = devices.list();
        const gateways = all.filter(d => d.type === 'gateway' || d.type === 'dock');
        const hosts = gateways.map(gw => {
            const children = all
                .filter(c => c.parent_sn === gw.sn)
                .map(c => ({
                    sn: c.sn,
                    device_callsign: c.callsign,
                    device_model: { domain: Number(c.domain ?? 0), device_model_key: c.model_key },
                    online_status: c.online,
                    bound_status: Boolean(c.bound),
                    index: c.index ?? 'A'
                }));
            return {
                sn: gw.sn,
                device_callsign: gw.callsign,
                device_model: { domain: Number(gw.domain ?? 2), device_model_key: gw.model_key },
                online_status: gw.online,
                bound_status: Boolean(gw.bound),
                children
            };
        });
        res.json({
            code: 0,
            message: 'success',
            data: { list: [{ workspace_id: req.params.workspace_id, hosts }] }
        });
    });

    /**
     * GET /manage/api/v1/devices/:workspace_id/devices/bound
     *
     * Pagination of devices that have been bound to this workspace.
     * Pilot uses this on the device-management page after login.
     */
    router.get('/devices/:workspace_id/devices/bound', requirePilot, (req, res) => {
        const all = devices.list().filter(d => d.bound);
        res.json({
            code: 0,
            message: 'success',
            data: {
                list: all.map(d => ({
                    device_sn: d.sn,
                    device_name: d.callsign ?? d.model,
                    online_status: d.online,
                    bound_status: true,
                    domain: Number(d.domain ?? 0)
                })),
                pagination: { page: 1, page_size: all.length, total: all.length }
            }
        });
    });

    /** POST /manage/api/v1/devices/:device_sn/binding */
    router.post('/devices/:device_sn/binding', requirePilot, (req, res) => {
        const body = (req.body ?? {}) as { device_callsign?: string };
        const sn = String(req.params.device_sn);
        devices.upsert(sn, {
            callsign: body.device_callsign,
            type: 'aircraft',
            domain: '0'
        });
        // Emits a `bound` SSE event so the web UI shows the UAS
        // immediately, even before the first OSD frame arrives.
        devices.markBound(sn, body.device_callsign);
        res.json({ code: 0, message: 'success' });
    });

    /**
     * Liveshare capacity. The DJI demo route is `/live/capacity` (under
     * `/manage/api/v1`); we expose both that and the historical
     * `/livestream/capacity` so older firmware paths still work.
     */
    function liveCapacity(_req: express.Request, res: express.Response): void {
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
    }
    router.get('/live/capacity', requirePilot, liveCapacity);
    router.get('/livestream/capacity', requirePilot, liveCapacity);

    return router;
}
