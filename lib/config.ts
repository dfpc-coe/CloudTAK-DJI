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

        const config = new Config({
            silent: (args.silent || false),
            StackName: process.env.StackName,
            API_URL,
            SigningSecret,
            MQTT_URL,
            MQTT_USERNAME: process.env.MQTT_USERNAME,
            MQTT_PASSWORD: process.env.MQTT_PASSWORD,
            MQTT_PUBLIC_URL,
            WORKSPACE_ID
        });

        if (!config.silent) {
            console.error('ok - set env AWS_REGION: us-east-1');
            console.error(`ok - StackName: ${config.StackName}`);
            console.error(`ok - API_URL: ${config.API_URL}`);
            console.error(`ok - MQTT_URL: ${config.MQTT_URL}`);
        }

        return config;
    }
}
