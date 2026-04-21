/*
 * DevicesStore - holds the live registry of DJI devices and a long-lived
 * SSE connection that streams updates from the server.
 */
import { defineStore } from 'pinia';
import type { DJIDevice, DeviceEvent } from '../types.ts';
import { stdurl } from '../std.ts';

interface DevicesState {
    items: Record<string, DJIDevice>;
    connected: boolean;
    error?: string;
    _es?: EventSource;
}

export const useDevicesStore = defineStore('devices', {
    state: (): DevicesState => ({
        items: {},
        connected: false,
        error: undefined,
        _es: undefined
    }),
    getters: {
        list(state): DJIDevice[] {
            return Object.values(state.items)
                .sort((a, b) => a.sn.localeCompare(b.sn));
        },
        get: (state) => (sn: string): DJIDevice | undefined => state.items[sn]
    },
    actions: {
        async refresh() {
            const res = await fetch('/api/device', {
                headers: { Authorization: `Bearer ${localStorage.token}` }
            });
            if (!res.ok) throw new Error(`Failed to list devices: ${res.status}`);
            const body = await res.json() as { items: DJIDevice[] };
            this.items = {};
            for (const d of body.items) this.items[d.sn] = d;
        },

        connect() {
            if (this._es) return;
            if (!localStorage.token) return;

            const url = stdurl('/api/sse/device');
            url.searchParams.set('token', localStorage.token);

            const es = new EventSource(url.toString());
            this._es = es;

            es.addEventListener('snapshot', (e) => {
                const data = JSON.parse((e as MessageEvent).data) as { items: DJIDevice[] };
                this.items = {};
                for (const d of data.items) this.items[d.sn] = d;
                this.connected = true;
                this.error = undefined;
            });

            const apply = (e: MessageEvent) => {
                const evt = JSON.parse(e.data) as DeviceEvent;
                if (evt.device) this.items[evt.sn] = evt.device;
            };

            for (const t of ['osd', 'state', 'online', 'offline', 'livestream']) {
                es.addEventListener(t, apply as EventListener);
            }

            es.onerror = () => {
                this.connected = false;
                this.error = 'SSE disconnected (auto-retrying)';
            };
            es.onopen = () => {
                this.connected = true;
                this.error = undefined;
            };
        },

        disconnect() {
            if (this._es) {
                this._es.close();
                this._es = undefined;
            }
            this.connected = false;
        },

        async startLivestream(sn: string, kind: 'rtmp' | 'rtsp' | 'webrtc' | 'gb28181' = 'rtmp'): Promise<void> {
            const res = await fetch(`/api/device/${encodeURIComponent(sn)}/livestream`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${localStorage.token}`
                },
                body: JSON.stringify({ url_type: kind })
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({})) as { message?: string };
                throw new Error(body.message ?? `Failed to start livestream: ${res.status}`);
            }
            const body = await res.json() as { url?: string; kind?: 'rtmp' | 'rtsp' | 'webrtc' | 'gb28181' };
            const dev = this.items[sn];
            if (dev) {
                this.items[sn] = {
                    ...dev,
                    livestream: { url: body.url, kind: body.kind, active: true }
                };
            }
        },

        async stopLivestream(sn: string): Promise<void> {
            await fetch(`/api/device/${encodeURIComponent(sn)}/livestream`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${localStorage.token}` }
            });
            const dev = this.items[sn];
            if (dev?.livestream) {
                this.items[sn] = { ...dev, livestream: { ...dev.livestream, active: false } };
            }
        }
    }
});
