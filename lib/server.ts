import type Config from './config.js';
import type { Server } from 'node:http';
import type { DJIBroker } from './mqtt.js';

export default class ServerManager {
    server: Server;
    config: Config;
    broker?: DJIBroker;

    constructor(server: Server, config: Config, broker?: DJIBroker) {
        this.server = server;
        this.config = config;
        this.broker = broker;
    }

    async close() {
        await Promise.allSettled([
            new Promise((resolve) => this.server.close(resolve)),
            this.broker ? this.broker.close() : Promise.resolve()
        ]);
    }
}
