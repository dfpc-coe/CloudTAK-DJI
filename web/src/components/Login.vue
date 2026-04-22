<template>
    <div
        class='page page-center cloudtak-gradient position-relative'
        style='overflow: auto;'
    >
        <img
            class='position-absolute d-none d-md-inline user-select-none'
            draggable='false'
            style='
                height: 48px;
                bottom: 24px;
                left: 24px;
            '
            src='/CloudTAKLogoText.svg'
            alt='CloudTAK Logo'
        >

        <div class='container container-normal py-4'>
            <div class='row align-items-center g-4'>
                <div class='col-lg'>
                    <div class='container-tight'>
                        <TablerInlineAlert
                            v-if='!djiBridgeAvailable'
                            class='mb-3'
                            severity='warning'
                            title='No DJI controller detected'
                            description='This page is not running inside a DJI Pilot/RC Pro web view, so no DJI device can be bound to this session. Sign-in will still work for monitoring, but the controller-side Cloud Service handshake will be skipped.'
                        />
                        <div class='card card-md'>
                            <div
                                v-if='!brandStore || !brandStore.loaded'
                                class='card-body'
                                style='height: 400px;'
                            >
                                <div class='col-12 d-flex justify-content-center pb-4'>
                                    <img
                                        class='user-select-none'
                                        draggable='false'
                                        style='
                                            height: 64px;
                                        '
                                        src='/CloudTAKLogo.svg'
                                        alt='CloudTAK Logo'
                                    >
                                </div>
                                <div class='col-12 d-flex justify-content-center pb-4'>
                                    <h2 class='h2 text-center mb-4'>
                                        Loading CloudTAK
                                    </h2>
                                </div>
                                <TablerLoading />
                            </div>
                            <div
                                v-else
                                class='card-body'
                            >
                                <div
                                    class='text-center'
                                    style='margin-bottom: 24px;'
                                >
                                    <img
                                        :src='brandStore.login && brandStore.login.logo ? brandStore.login.logo : "/CloudTAKLogo.svg"'
                                        style='height: 150px;'
                                        draggable='false'
                                        class='user-select-none'
                                        alt='CloudTAK System Logo'
                                    >
                                </div>
                                <h2 class='h2 text-center mb-4'>
                                    Login to your account
                                </h2>
                                <TablerLoading
                                    v-if='loading'
                                    desc='Logging in'
                                />
                                <template v-else>
                                    <div class='mb-3'>
                                        <TablerInput
                                            v-model='body.username'
                                            icon='user'
                                            label='Username or Email'
                                            placeholder='your@email.com'
                                            @keyup.enter='createLogin'
                                        />
                                    </div>
                                    <div class='mb-2'>
                                        <div class='d-flex'>
                                            <label class='form-label mb-0'>
                                                Password
                                            </label>
                                            <span class='ms-auto'>
                                                <a
                                                    v-if='brandStore.login && brandStore.login.forgot'
                                                    tabindex='-1'
                                                    class='cursor-pointer'
                                                    :href='brandStore.login.forgot'
                                                >Forgot Password</a>
                                            </span>
                                        </div>
                                        <TablerInput
                                            v-model='body.password'
                                            icon='lock'
                                            type='password'
                                            placeholder='Your password'
                                            @keyup.enter='createLogin'
                                        />
                                    </div>
                                    <div class='form-footer'>
                                        <button
                                            type='submit'
                                            class='btn btn-primary w-100'
                                            @click='createLogin'
                                        >
                                            Sign In
                                        </button>
                                    </div>
                                </template>
                            </div>
                        </div>
                        <div
                            v-if='brandStore.login && brandStore.login.signup'
                            class='text-center text-muted mt-3'
                        >
                            Don't have an account yet?
                            <a
                                tabindex='-1'
                                class='cursor-pointer'
                                :href='brandStore.login.signup'
                            >Sign Up</a>
                        </div>

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
                                    <div class='d-flex align-items-center mb-2'>
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
                                                @click='snapshotBridge'
                                            >
                                                Snapshot state
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
                                                Copy
                                            </button>
                                        </div>
                                    </div>
                                    <pre
                                        ref='logBox'
                                        class='mb-0 small'
                                        style='max-height: 240px; overflow: auto; white-space: pre-wrap; word-break: break-all;'
                                    ><template v-if='!bridgeLogs.length'>No bridge activity yet. Sign in or press "Snapshot state".</template><template
                                        v-for='(entry, idx) in bridgeLogs'
                                        :key='idx'
                                    >{{ entry.ts }} [{{ entry.level }}] {{ entry.message }}
</template></pre>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang='ts'>
import type { Login_Create, Login_CreateRes } from '../types.ts'
import { ref, onMounted, onBeforeUnmount, nextTick, watch } from 'vue';
import { useBrandStore } from '../stores/brand.ts';
import { useRouter, useRoute } from 'vue-router'
import { std } from '../std.ts';
import {
    bootstrapDJIBridge,
    isDJIBridgeAvailable,
    subscribeDJIBridgeLogs,
    clearDJIBridgeLogs,
    captureDJIBridgeSnapshot,
    type DJIBridgeLogEntry
} from '../dji-bridge.ts';
import {
    TablerLoading,
    TablerInlineAlert,
    TablerInput
} from '@tak-ps/vue-tabler'

const emit = defineEmits([ 'login' ]);

const route = useRoute();
const router = useRouter();
const brandStore = useBrandStore();

const loading = ref(false);
const djiBridgeAvailable = ref(isDJIBridgeAvailable());
const advancedOpen = ref(false);
const bridgeLogs = ref<readonly DJIBridgeLogEntry[]>([]);
const logBox = ref<HTMLElement | null>(null);
let unsubscribeLogs: (() => void) | undefined;
const body = ref<Login_Create>({
    username: '',
    password: ''
});

onMounted(async () => {
    await brandStore.init();

    // Some controllers inject `window.djiBridge` after the initial document
    // load; re-check once the page has settled so the warning banner is
    // accurate when running inside DJI Pilot/RC Pro.
    djiBridgeAvailable.value = isDJIBridgeAvailable();

    unsubscribeLogs = subscribeDJIBridgeLogs((entries) => {
        bridgeLogs.value = entries;
        if (advancedOpen.value) {
            void nextTick(() => {
                if (logBox.value) logBox.value.scrollTop = logBox.value.scrollHeight;
            });
        }
    });

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then((registrations) => {
            for (const registration of registrations) {
                registration.update();
            }
        });
    }

    const deleteDB = indexedDB.deleteDatabase('CloudTAK');

    deleteDB.onerror = (event) => {
        console.error('Failed to delete existing database', event);
    };
})

async function createLogin() {
    loading.value = true;

    try {
        const login = await std('/api/login', {
            method: 'POST',
            body: {
                username: body.value.username,
                password: body.value.password
             }
        }) as Login_CreateRes

        localStorage.token = login.token;

        // When the page is hosted inside the DJI Pilot/RC Pro web view, hand
        // the controller its app license + MQTT coordinates so the in-app
        // "Cloud Service" tile flips to "Logged In" and devices begin to
        // report into the fleet view. Failures here are surfaced via the
        // global TablerError modal and abort the sign-in so the operator
        // can correct the controller-side problem before proceeding.
        if (isDJIBridgeAvailable()) {
            try {
                await bootstrapDJIBridge();
            } catch (bridgeErr) {
                console.error('DJI bridge bootstrap failed:', bridgeErr);
                // Roll back the partial sign-in so the user can retry
                // cleanly once the bridge issue is fixed.
                delete localStorage.token;
                throw bridgeErr;
            }
        }

        emit('login');

        if (route.query.redirect && !String(route.query.redirect).includes('/login')) {
            router.push(String(route.query.redirect));
        } else {
            router.push("/");
        }
    } catch (err) {
        loading.value = false;
        throw err;
    }
}

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
}

async function copyLogs() {
    const text = bridgeLogs.value
        .map((e) => `${e.ts} [${e.level}] ${e.message}`)
        .join('\n');
    try {
        await navigator.clipboard.writeText(text);
    } catch (err) {
        console.error('Failed to copy logs:', err);
    }
}
</script>
