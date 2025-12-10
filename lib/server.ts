import type Config from './config.js';
import type { Server } from 'node:http';

export default class ServerManager {
    server: Server;
    config: Config;

    constructor(
        server: Server,
        config: Config
    ) {
        this.server = server;
        this.config = config;
    }

    async close() {
        await Promise.allSettled([
            new Promise((resolve) => {
                this.server.close(resolve);
            }),
        ]);
    }
}

