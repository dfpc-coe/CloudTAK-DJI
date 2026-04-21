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
    CloudTAKConfigLoginRes
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

            const user = await upstream.typed(CloudTAKLoginRes);
            res.json(user);
        } catch (err) {
            Err.respond(err, res);
        }
    });
}
