<template>
    <div class='container-xl py-3'>
        <div class='row g-3'>
            <div class='col-md-4'>
                <DeviceList
                    :selected='selectedSn'
                    :debug='debugOpen'
                    @select='selectedSn = $event'
                    @toggle-debug='debugOpen = !debugOpen'
                />
            </div>
            <div class='col-md-8'>
                <div
                    v-if='!selected'
                    class='card bg-accent text-white'
                >
                    <div class='card-body p-5 text-center'>
                        <IconDrone
                            size='64'
                            stroke='1'
                        />
                        <h3 class='mt-3'>
                            Select a device to view live telemetry & video
                        </h3>
                        <p class='text-muted mb-0'>
                            Logged in as <strong>{{ user.email }}</strong>.
                        </p>
                    </div>
                </div>
                <template v-else>
                    <DeviceCard :device='selected' />
                    <div class='mt-3'>
                        <DevicePlayer :device='selected' />
                    </div>
                </template>
            </div>
        </div>

        <TablerModal
            v-if='debugOpen'
            size='lg'
        >
            <div class='modal-header'>
                <div>
                    <h3 class='modal-title mb-0'>
                        DJI Bridge Diagnostics
                    </h3>
                    <div class='text-muted small'>
                        Bridge bootstrap, callbacks, and live controller logs.
                    </div>
                </div>
                <button
                    type='button'
                    class='btn-close'
                    aria-label='Close'
                    @click='debugOpen = false'
                />
            </div>
            <div class='modal-body debug-modal-body'>
                <DJIBridgeAdvanced
                    embedded
                    modal
                    :allow-rebootstrap='true'
                />
            </div>
        </TablerModal>
    </div>
</template>

<script setup lang='ts'>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { storeToRefs } from 'pinia';
import { useDevicesStore } from '../stores/devices.ts';
import DeviceList from './DeviceList.vue';
import DeviceCard from './DeviceCard.vue';
import DevicePlayer from './DevicePlayer.vue';
import DJIBridgeAdvanced from './DJIBridgeAdvanced.vue';
import { IconDrone } from '@tabler/icons-vue';
import { TablerModal } from '@tak-ps/vue-tabler';

defineProps<{
    user: { email: string; access?: string };
}>();

const devicesStore = useDevicesStore();
const { items } = storeToRefs(devicesStore);

const selectedSn = ref<string | undefined>();
const debugOpen = ref(false);
const selected = computed(() => selectedSn.value ? items.value[selectedSn.value] : undefined);

onMounted(async () => {
    try {
        await devicesStore.refresh();
    } catch (err) {
        console.error('Failed initial device refresh:', err);
    }
    devicesStore.connect();
});

onBeforeUnmount(() => devicesStore.disconnect());
</script>

<style scoped>
.debug-modal-body {
    max-height: calc(100vh - 12rem);
    overflow-y: auto;
    overscroll-behavior: contain;
}
</style>
