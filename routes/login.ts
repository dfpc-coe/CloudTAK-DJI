import fetch from '../lib/fetch.js'
import { Type } from '@sinclair/typebox'
import Config from '../lib/config.js'
import Schema from '@openaddresses/batch-schema'

export default async function router(schema: Schema, config: Config) {
    await schema.get('/login', {
        name: 'Get Login',
        group: 'Login',
        res: Type.Object({
            email: Type.String(),
            access: Type.String()
        })
    }, async (req, res) => {
        try {
            const res = await fetch(`${config.API_URL}/api/login`, {
                method: 'GET',
                headers: {
                    'Authorization': req.headers.authorization || ''
                }
            })

            const user = await res.typed(Type.Object({
                email: Type.String(),
                access: Type.Enum(AuthUserAccess)
            }));

            res.json(user);
        } catch (err) {
             Err.respond(err, res);
        }
    });
}
