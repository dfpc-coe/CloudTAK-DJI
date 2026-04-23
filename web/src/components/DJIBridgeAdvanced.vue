<template>
    <div class='mt-3'>
        <a
            href='#'
            class='text-muted small cursor-pointer'
            @click.prevent='advancedOpen = !advancedOpen'
        >
            {{ advancedOpen ? '▾' : '▸' }} Advanced — DJI bridge diagnostics
        </a>
        <div
            v-if='advancedOpen'
            class='card card-sm mt-2 bg-dark text-light'
        >
            <div class='card-body p-2'>
                <div class='d-flex align-items-center mb-2 flex-wrap gap-2'>
                    <small>
                        window.djiBridge:
                        <strong :class='djiBridgeAvailable ? "text-success" : "text-warning"'>
                            {{ djiBridgeAvailable ? 'detected' : 'not present' }}
                        </strong>
                    </small>
                    <div class='ms-auto btn-list'>
                        <button
                            type='button'
                            class='btn btn-sm btn-outline-light'
                            :disabled='!djiBridgeAvailable'
                            @click='snapshotBridge'
                        >
                            Snapshot state
                        </button>
                        <button
                            v-if='allowRebootstrap'
                            type='button'
                            class='btn btn-sm btn-outline-warning'
                            :disabled='!djiBridgeAvailable || rebootstrapping'
                            @click='rebootstrap'
                        >
                            {{ rebootstrapping ? 'Re-running…' : 'Re-run bootstrap' }}
                        </button>
                        <button
                            type='button'
                            class='btn btn-sm btn-outline-light'
                            @click='clearLogs'
                        >
                            Clear
                        </button>
                        <button
                            type='button'
                            class='btn btn-sm btn-outline-light'
                            @click='copyLogs'
                        >
                            {{ copied ? 'Copied!' : 'Copy' }}
                        </button>
                    </div>
                </div>
                <pre
                    ref='logBox'
                    class='mb-0 small'
                    style='max-height: 240px; overflow: auto; white-space: pre-wrap; word-break: break-all;'
                ><template v-if='!bridgeLogs.length'>No bridge activity yet. Press "Snapshot state" to inspect the controller, or "Re-run bootstrap" to retry the Cloud Service handshake.</template><template
                    v-for='(entry, idx) in bridgeLogs'
                    :key='idx'
                >{{ entry.ts }} [{{ entry.level }}] {{ entry.message }}
</template></pre>
            </div>
        </div>
    </div>
</template>

<script setup lang='ts'>
import { ref, onMounted, onBeforeUnmount, nextTick, watch } from 'vue';
import {
    bootstrapDJIBridge,
    isDJIBridgeAvailable,
    subscribeDJIBridgeLogs,
    clearDJIBridgeLogs,
    captureDJIBridgeSnapshot,
    type DJIBridgeLogEntry
} from '../dji-bridge.ts';

withDefaults(defineProps<{
    /**
     * Show the "Re-run bootstrap" button. Useful on the post-login
     * Home view where the operator notices the Pilot Cloud tile is
     * still "Not Logged In" and wants to retry the handshake without
     * signing out. Hide it on the Login view since `createLogin`
     * already invokes the bootstrap.
     */
    allowRebootstrap?: boolean;
}>(), {
    allowRebootstrap: false
});

const advancedOpen = ref(false);
const djiBridgeAvailable = ref(isDJIBridgeAvailable());
const bridgeLogs = ref<readonly DJIBridgeLogEntry[]>([]);
const logBox = ref<HTMLElement | null>(null);
const rebootstrapping = ref(false);
const copied = ref(false);
let unsubscribeLogs: (() => void) | undefined;

onMounted(() => {
    djiBridgeAvailable.value = isDJIBridgeAvailable();
    unsubscribeLogs = subscribeDJIBridgeLogs((entries) => {
        bridgeLogs.value = entries;
        if (advancedOpen.value) {
            void nextTick(() => {
                if (logBox.value) logBox.value.scrollTop = logBox.value.scrollHeight;
            });
        }
    });
});

onBeforeUnmount(() => {
    if (unsubscribeLogs) unsubscribeLogs();
});

watch(advancedOpen, (open) => {
    if (open) {
        void nextTick(() => {
            if (logBox.value) logBox.value.scrollTop = logBox.value.scrollHeight;
        });
    }
});

function snapshotBridge() {
    captureDJIBridgeSnapshot();
}

function clearLogs() {
    clearDJIBridgeLogs();
    copied.value = false;
}

async function copyLogs() {
    const text = bridgeLogs.value
        .map((e) => `${e.ts} [${e.level}] ${e.message}`)
        .join('\n');
    try {
        await navigator.clipboard.writeText(text);
        copied.value = true;
        setTimeout(() => { copied.value = false; }, 1500);
    } catch (err) {
        console.error('Failed to copy logs:', err);
    }
}

async function rebootstrap() {
    rebootstrapping.value = true;
    try {
        await bootstrapDJIBridge();
    } catch (err) {
        // bootstrapDJIBridge already logs every failure into the
        // shared log buffer via pushLog, so the operator sees the
        // root cause inside this same panel. Re-throw to console
        // for completeness.
        console.error('Manual DJI bridge re-bootstrap failed:', err);
    } finally {
        rebootstrapping.value = false;
    }
}
</script>
