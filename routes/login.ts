import fetch from '../lib/fetch.js'
import Err from '@openaddresses/batch-error'
import { Type } from '@sinclair/typebox'
import Config from '../lib/config.js'
import Schema from '@openaddresses/batch-schema'
import { sign, verify } from '../lib/auth.js'
import {
    CloudTAKLoginRes,
    CloudTAKLoginCreate,
    CloudTAKLoginCreateRes,
    CloudTAKConfigLoginRes,
    CloudTAKConfigDJIRes
} from '../lib/types.js'

/**
 * The web/admin UI authenticates against this server (not directly against
 * CloudTAK). We forward credentials to CloudTAK, then mint our own JWT that
 * encapsulates the upstream CloudTAK bearer token. This keeps a single token
 * surface for the browser and lets the same flow back the DJI Pilot login.
 */
export default async function router(schema: Schema, config: Config) {
    await schema.get('/config/login', {
        name: 'Get Login Config',
        group: 'Login',
        res: CloudTAKConfigLoginRes
    }, async (req, res) => {
        try {
            const upstream = await fetch(`${config.API_URL}/api/config/login`);
            const body = await upstream.typed(CloudTAKConfigLoginRes);
            res.json(body);
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.get('/config/dji', {
        name: 'Get DJI Bridge Config',
        group: 'Login',
        res: CloudTAKConfigDJIRes
    }, async (req, res) => {
        try {
            const header = req.headers['authorization'];
            if (!header || !header.startsWith('Bearer ')) {
                throw new Err(401, null, 'Authentication Required');
            }
            // Validate session before exposing license material.
            verify(config, header.slice('Bearer '.length).trim());

            const configured = Boolean(
                config.DJI_APP_ID && config.DJI_APP_KEY && config.DJI_APP_LICENSE
            );

            res.json({
                configured,
                app_id: config.DJI_APP_ID,
                app_key: config.DJI_APP_KEY,
                license: config.DJI_APP_LICENSE,
                workspace_id: config.WORKSPACE_ID,
                mqtt: {
                    host: config.MQTT_PUBLIC_URL,
                    username: config.MQTT_USERNAME ?? '',
                    password: config.MQTT_PASSWORD ?? ''
                }
            });
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.post('/login', {
        name: 'Create Session',
        group: 'Login',
        body: CloudTAKLoginCreate,
        res: CloudTAKLoginCreateRes
    }, async (req, res) => {
        try {
            const upstream = await fetch(`${config.API_URL}/api/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(req.body)
            });

            if (upstream.status === 401 || upstream.status === 403) {
                throw new Err(401, null, 'Invalid credentials');
            }

            if (upstream.status >= 400) {
                const upstreamBody = await upstream.json().catch(() => null) as {
                    message?: string;
                } | null;

                throw new Err(
                    upstream.status,
                    null,
                    upstreamBody?.message || `CloudTAK login failed: ${upstream.status}`
                );
            }

            const upstreamBody = await upstream.typed(Type.Object({
                token: Type.String(),
                access: Type.Optional(Type.String()),
                email: Type.Optional(Type.String())
            }));

            const sessionToken = sign(config, {
                sub: upstreamBody.email || req.body.username,
                access: upstreamBody.access,
                cloudtak_token: upstreamBody.token
            });

            res.json({
                token: sessionToken,
                access: upstreamBody.access,
                email: upstreamBody.email
            });
        } catch (err) {
            Err.respond(err, res);
        }
    });

    await schema.get('/login', {
        name: 'Get Session',
        group: 'Login',
        res: CloudTAKLoginRes
    }, async (req, res) => {
        try {
            const header = req.headers['authorization'];
            if (!header || !header.startsWith('Bearer ')) {
                throw new Err(401, null, 'Authentication Required');
            }

            const session = verify(config, header.slice('Bearer '.length).trim());

            const upstream = await fetch(`${config.API_URL}/api/login`, {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${session.cloudtak_token}` }
            });

            if (upstream.status === 401) {
                throw new Err(401, null, 'CloudTAK session expired');
            }

            if (upstream.status >= 400) {
                const upstreamBody = await upstream.json().catch(() => null) as {
                    message?: string;
                } | null;

                throw new Err(
                    upstream.status,
                    null,
                    upstreamBody?.message || `CloudTAK session lookup failed: ${upstream.status}`
                );
            }

            const user = await upstream.typed(CloudTAKLoginRes);
            res.json(user);
        } catch (err) {
            Err.respond(err, res);
        }
    });
}
