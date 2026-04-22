import process from 'node:process';
import crypto from 'node:crypto';

interface ConfigArgs {
    silent: boolean,
}

export default class Config {
    silent: boolean;
    StackName: string;
    API_URL: string;

    /** Secret used to sign JWTs minted by this server. */
    SigningSecret: string;

    /** MQTT broker reachable by this service. */
    MQTT_URL: string;
    MQTT_USERNAME?: string;
    MQTT_PASSWORD?: string;

    /** Public-facing URL Pilot should be told to dial for MQTT. */
    MQTT_PUBLIC_URL: string;

    /** Default workspace handed back to Pilot in IAM responses. */
    WORKSPACE_ID: string;

    /**
     * Base RTMP URL of the operator-supplied media server (e.g.
     * `rtmp://media.example.com:1935/live`). When set, livestream
     * starts will publish to `${MEDIA_URL}/{sn}`. When unset, the
     * `/api/device/:sn/livestream` route requires an explicit `url`
     * in the request body and otherwise rejects with 412.
     */
    MEDIA_URL?: string;

    /**
     * DJI Pilot/RC Pro Cloud-API license. These are issued by DJI to the
     * deploying organisation per app and must be passed into the
     * `window.djiBridge.platformVerifyLicense(appId, appKey, license)` call
     * the controller's web-view runs after sign-in. Without them the Cloud
     * tile in DJI Fly stays "Not Logged In" and no devices appear.
     */
    DJI_APP_ID?: number;
    DJI_APP_KEY?: string;
    DJI_APP_LICENSE?: string;

    constructor(init: {
        silent: boolean;
        StackName: string;
        API_URL: string;
        SigningSecret: string;
        MQTT_URL: string;
        MQTT_USERNAME?: string;
        MQTT_PASSWORD?: string;
        MQTT_PUBLIC_URL: string;
        WORKSPACE_ID: string;
        MEDIA_URL?: string;
        DJI_APP_ID?: number;
        DJI_APP_KEY?: string;
        DJI_APP_LICENSE?: string;
    }) {
        this.silent = init.silent;
        this.StackName = init.StackName;
        this.API_URL = init.API_URL;
        this.SigningSecret = init.SigningSecret;
        this.MQTT_URL = init.MQTT_URL;
        this.MQTT_USERNAME = init.MQTT_USERNAME;
        this.MQTT_PASSWORD = init.MQTT_PASSWORD;
        this.MQTT_PUBLIC_URL = init.MQTT_PUBLIC_URL;
        this.WORKSPACE_ID = init.WORKSPACE_ID;
        this.MEDIA_URL = init.MEDIA_URL;
        this.DJI_APP_ID = init.DJI_APP_ID;
        this.DJI_APP_KEY = init.DJI_APP_KEY;
        this.DJI_APP_LICENSE = init.DJI_APP_LICENSE;
    }

    static async env(args: ConfigArgs): Promise<Config> {
        if (!process.env.AWS_REGION) {
            process.env.AWS_REGION = 'us-east-1';
        }

        let API_URL: string;
        if (!process.env.StackName || process.env.StackName === 'test') {
            process.env.StackName = 'test';
            API_URL = process.env.API_URL || 'http://localhost:5001';
        } else {
            if (!process.env.API_URL) throw new Error('API_URL env must be set');
            API_URL = process.env.API_URL;
        }

        const SigningSecret = process.env.SigningSecret
            || (process.env.StackName === 'test'
                ? 'dev-only-do-not-use-in-prod'
                : crypto.randomBytes(32).toString('hex'));

        const MQTT_URL = process.env.MQTT_URL || 'mqtt://localhost:1883';
        const MQTT_PUBLIC_URL = process.env.MQTT_PUBLIC_URL || MQTT_URL;
        const WORKSPACE_ID = process.env.WORKSPACE_ID || 'default-workspace';
        const MEDIA_URL = process.env.MEDIA_URL
            ? process.env.MEDIA_URL.replace(/\/+$/, '')
            : undefined;

        let DJI_APP_ID: number | undefined;
        if (process.env.DJI_APP_ID) {
            const parsed = Number(process.env.DJI_APP_ID);
            if (!Number.isInteger(parsed) || parsed <= 0) {
                throw new Error(`DJI_APP_ID must be a positive integer (got ${process.env.DJI_APP_ID})`);
            }
            DJI_APP_ID = parsed;
        }

        const config = new Config({
            silent: (args.silent || false),
            StackName: process.env.StackName,
            API_URL,
            SigningSecret,
            MQTT_URL,
            MQTT_USERNAME: process.env.MQTT_USERNAME,
            MQTT_PASSWORD: process.env.MQTT_PASSWORD,
            MQTT_PUBLIC_URL,
            WORKSPACE_ID,
            MEDIA_URL,
            DJI_APP_ID,
            DJI_APP_KEY: process.env.DJI_APP_KEY || undefined,
            DJI_APP_LICENSE: process.env.DJI_APP_LICENSE || undefined
        });

        if (!config.silent) {
            console.error('ok - set env AWS_REGION: us-east-1');
            console.error(`ok - StackName: ${config.StackName}`);
            console.error(`ok - API_URL: ${config.API_URL}`);
            console.error(`ok - MQTT_URL: ${config.MQTT_URL}`);
            console.error(`ok - MEDIA_URL: ${config.MEDIA_URL ?? '(unset)'}`);
            console.error(`ok - DJI_APP_ID: ${config.DJI_APP_ID ?? '(unset)'}`);
            console.error(`ok - DJI_APP_KEY: ${config.DJI_APP_KEY ? '(set)' : '(unset)'}`);
            console.error(`ok - DJI_APP_LICENSE: ${config.DJI_APP_LICENSE ? '(set)' : '(unset)'}`);
        }

        return config;
    }
}
