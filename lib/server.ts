import type Config from './config.js';
import type { Server } from 'node:http';
import type { DJIBroker } from './mqtt.js';
import type { CloudTAKForwarder } from './forwarder.js';

export default class ServerManager {
    server: Server;
    config: Config;
    broker?: DJIBroker;
    forwarder?: CloudTAKForwarder;

    constructor(server: Server, config: Config, broker?: DJIBroker, forwarder?: CloudTAKForwarder) {
        this.server = server;
        this.config = config;
        this.broker = broker;
        this.forwarder = forwarder;
    }

    async close() {
        if (this.forwarder) this.forwarder.stop();

        await Promise.allSettled([
            new Promise((resolve) => this.server.close(resolve)),
            this.broker ? this.broker.close() : Promise.resolve()
        ]);
    }
}
