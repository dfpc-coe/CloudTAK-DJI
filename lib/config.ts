import process from 'node:process';

interface ConfigArgs {
    silent: boolean,
}

export default class Config {
    silent: boolean;
    StackName: string;
    API_URL: string;

    constructor(init: {
        silent: boolean;
        StackName: string;
        API_URL: string;
    }) {
        this.silent = init.silent;
        this.StackName = init.StackName;
        this.API_URL = init.API_URL;
    }

    static async env(args: ConfigArgs): Promise<Config> {
        if (!process.env.AWS_REGION) {
            process.env.AWS_REGION = 'us-east-1';
        }

        let API_URL;
        if (!process.env.StackName || process.env.StackName === 'test') {
            process.env.StackName = 'test';

            API_URL = process.env.API_URL || 'http://localhost:5001';
        } else {
            if (!process.env.StackName) throw new Error('StackName env must be set');
            if (!process.env.API_URL) throw new Error('API_URL env must be set');

            API_URL = process.env.API_URL;
        }

        const config = new Config({
            silent: (args.silent || false),
            StackName: process.env.StackName,
            API_URL
        });

        if (!config.silent) {
            console.error('ok - set env AWS_REGION: us-east-1');
            console.error(`ok - StackName: ${config.StackName}`);
        }

        return config;
    }
}
