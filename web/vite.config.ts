import { defineConfig } from 'vite'
import path from 'node:path';
import vue from '@vitejs/plugin-vue'
import type { IncomingMessage, ServerResponse } from 'node:http';

export default defineConfig(({ mode }) => {
    const res = {
        plugins: [
            vue(),
        ],
        optimizeDeps: {
            include: ["showdown", "@tak-ps/vue-tabler"],
        },
        build: {
            manifest: true,
            rollupOptions: {
                input: {
                    main: path.resolve(__dirname, 'index.html'),
                },
            },
        },
        server: {
            port: 8080,
            proxy: {
                '/api': {
                    ws: true,
                    target: 'http://localhost:5003',
                    changeOrigin: true,
                }
            }
        },
    }

    return res;
})

