<template>
    <div class='card'>
        <div class='card-header d-flex align-items-center'>
            <h3 class='card-title mb-0'>
                Live Video — {{ device.callsign || device.sn }}
            </h3>
            <div class='ms-auto btn-list'>
                <button
                    v-if='!device.livestream || !device.livestream.active'
                    class='btn btn-primary'
                    :disabled='busy || !device.online'
                    @click='start'
                >
                    Start Stream
                </button>
                <button
                    v-else
                    class='btn btn-outline-danger'
                    :disabled='busy'
                    @click='stop'
                >
                    Stop Stream
                </button>
            </div>
        </div>
        <div class='card-body p-0'>
            <video
                ref='videoEl'
                controls
                autoplay
                muted
                playsinline
                style='width: 100%; max-height: 60vh; background: #000;'
            />
        </div>
        <div
            v-if='message'
            class='card-footer small text-muted'
        >
            {{ message }}
        </div>
    </div>
</template>

<script setup lang='ts'>
import { ref, watch, onMounted, onBeforeUnmount } from 'vue';
import Hls from 'hls.js';
import type { DJIDevice } from '../types.ts';
import { useDevicesStore } from '../stores/devices.ts';

const props = defineProps<{ device: DJIDevice }>();
const devicesStore = useDevicesStore();

const videoEl = ref<HTMLVideoElement | null>(null);
const busy = ref(false);
const message = ref<string>('');
let hls: Hls | undefined;

/**
 * Translate the upstream RTMP/RTSP push URL into an HLS playback URL exposed
 * by the media-infra relay. The convention here mirrors media-infra's
 * mediamtx config: a stream named `live/{sn}` is republished as HLS at
 * `/live/{sn}/index.m3u8` on the same host that serves this UI.
 */
function hlsUrlFor(sn: string): string {
    const origin = window.location.origin.replace(/\/$/, '');
    return `${origin}/live/${encodeURIComponent(sn)}/index.m3u8`;
}

function attachPlayer(): void {
    if (!videoEl.value) return;
    const url = hlsUrlFor(props.device.sn);

    if (hls) {
        hls.destroy();
        hls = undefined;
    }

    if (Hls.isSupported()) {
        hls = new Hls({ lowLatencyMode: true, liveSyncDurationCount: 2 });
        hls.loadSource(url);
        hls.attachMedia(videoEl.value);
        hls.on(Hls.Events.ERROR, (_e, data) => {
            if (data.fatal) message.value = `HLS error: ${data.type}`;
        });
    } else if (videoEl.value.canPlayType('application/vnd.apple.mpegurl')) {
        videoEl.value.src = url;
    } else {
        message.value = 'Browser does not support HLS playback';
    }
}

function detachPlayer(): void {
    if (hls) { hls.destroy(); hls = undefined; }
    if (videoEl.value) videoEl.value.removeAttribute('src');
}

async function start(): Promise<void> {
    busy.value = true;
    message.value = '';
    try {
        await devicesStore.startLivestream(props.device.sn, 'rtmp');
        // Give media-infra a moment to publish the first HLS segment.
        setTimeout(attachPlayer, 1500);
    } catch (err) {
        message.value = err instanceof Error ? err.message : String(err);
    } finally {
        busy.value = false;
    }
}

async function stop(): Promise<void> {
    busy.value = true;
    try {
        await devicesStore.stopLivestream(props.device.sn);
        detachPlayer();
    } finally {
        busy.value = false;
    }
}

onMounted(() => {
    if (props.device.livestream?.active) attachPlayer();
});

onBeforeUnmount(detachPlayer);

watch(() => props.device.livestream?.active, (active) => {
    if (active) attachPlayer();
    else detachPlayer();
});
</script>
