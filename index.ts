import fs from 'node:fs';
import path from 'node:path';
import cors from 'cors';
import express from 'express';
import type {Context} from 'connect-history-api-fallback';
import history from 'connect-history-api-fallback';
import { StandardResponse } from './lib/types.js'
import ServerManager from './lib/server.js';
import Schema from '@openaddresses/batch-schema';
import { parseArgs } from 'node:util';
import Config from './lib/config.js';
import process from 'node:process';
import { DJIBroker, setBroker } from './lib/mqtt.js';
import djiCloudRouter from './lib/dji-cloud.js';

const { values: args } = parseArgs({
    args: process.argv.slice(2),
    options: {
        silent: { type: 'boolean', default: false },  // Turn off logging as much as possible
        env:    { type: 'string' }                    // Load a non-default .env file --env local would read .env-local
    },
    strict: false
});

try {
    const dotfile = new URL(`.env${args.env ? '-' + args.env : ''}`, import.meta.url);

    fs.accessSync(dotfile);

    process.env = Object.assign(JSON.parse(String(fs.readFileSync(dotfile))), process.env);
} catch (err) {
    if (err instanceof Error && err.message.startsWith('ENOENT')) {
        console.log('ok - no .env file loaded - none found');
    } else {
        console.log('ok - no .env file loaded', err);
    }
}

const pkg = JSON.parse(String(fs.readFileSync(new URL('./package.json', import.meta.url))));

process.on('uncaughtExceptionMonitor', (exception, origin) => {
    console.trace('FATAL', exception, origin);
});

if (import.meta.url === `file://${process.argv[1]}`) {
    const config = await Config.env({
        silent: Boolean(args.silent) || false,
    });

    const sm = await server(config);
    console.log('Server started, listening:', sm.server.listening);
}

export default async function server(config: Config): Promise<ServerManager> {
    const app = express();

    const schema = new Schema(express.Router(), {
        prefix: '/api',
        logging: {
            skip: function (req, res) {
                return res.statusCode <= 399 && res.statusCode >= 200;
            }
        },
        limit: 50,
        error: {
            400: StandardResponse,
            401: StandardResponse,
            403: StandardResponse,
            404: StandardResponse,
            500: StandardResponse,
        },
        openapi: {
            info: {
                title: 'CloudTAK DJI Cloud API',
                version: pkg.version,
            },
            components: {
                securitySchemes: {
                    bearerAuth: {
                        type: 'http',
                        scheme: 'bearer',
                        bearerFormat: 'JWT'
                    }
                }
            },
            security: [{
                bearerAuth: []
            }],
        }
    });

    app.disable('x-powered-by');
    app.use(cors({
        origin: '*',
        exposedHeaders: [
            'Content-Disposition'
        ],
        allowedHeaders: [
            'Content-Type',
            'Content-Length',
            'User-Agent',
            'Authorization',
            'MissionAuthorization',
            'x-requested-with'
        ],
        credentials: true
    }));

    /**
     * @api {get} /api Get Metadata
     * @apiVersion 1.0.0
     * @apiName Server
     * @apiGroup Server
     * @apiPermission public
     *
     * @apiDescription
     *     Return basic metadata about server configuration
     *
     * @apiSchema {jsonschema=./schema/res.Server.json} apiSuccess
     */
    app.get('/api', (req, res) => {
        res.json({
            version: pkg.version
        });
    });

    app.use('/api', schema.router);

    // DJI Cloud API endpoints (consumed by DJI Pilot 2 / RC Plus directly).
    // Mounted outside the schema's /api prefix so paths match DJI's spec.
    app.use('/manage/api/v1', djiCloudRouter(config));

    await schema.api();

    await schema.load(
        new URL('./routes/', import.meta.url),
        config,
        {
            silent: !!config.silent
        }
    );

    app.use(history({
        rewrites: [{
            from: /.*\/js\/.*$/,
            to(context: Context) {
                if (!context.parsedUrl.pathname) context.parsedUrl.pathname = ''
                return context.parsedUrl.pathname.replace(/.*\/js\//, '/js/');
            }
        },{
            from: /.*$/,
            to(context: Context) {
                if (!context.parsedUrl.pathname) context.parsedUrl.pathname = ''
                if (!context.parsedUrl.path) context.parsedUrl.path = ''
                const parse = path.parse(context.parsedUrl.path);
                if (parse.ext) {
                    return context.parsedUrl.pathname;
                } else {
                    return '/';
                }
            }
        }]
    }));

    app.use(express.static('web/dist'));

    return new Promise((resolve) => {
        const srv = app.listen(5004, () => {
            if (!config.silent) {
                console.log('ok - http://localhost:5004');
            }
            console.log('Inside callback, listening:', srv.listening);
            console.log('Address:', srv.address());

            // Connect to MQTT broker for DJI Thing-Model topics. Failure to
            // connect is non-fatal; the broker auto-reconnects.
            const broker = new DJIBroker(config);
            setBroker(broker);
            broker.connect().catch((err) => {
                console.error('mqtt initial connect failed (will retry):', err);
            });

            const sm = new ServerManager(srv, config, broker);

            return resolve(sm);
        });

        srv.on('close', () => {
            console.log('Server closed');
        });

        srv.on('error', (err) => {
            console.error('Server error:', err);
        });
    });
}

