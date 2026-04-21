<template>
    <div class='container-xl py-3'>
        <div class='row g-3'>
            <div class='col-md-4'>
                <DeviceList
                    :selected='selectedSn'
                    @select='selectedSn = $event'
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
    </div>
</template>

<script setup lang='ts'>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { storeToRefs } from 'pinia';
import { useDevicesStore } from '../stores/devices.ts';
import DeviceList from './DeviceList.vue';
import DeviceCard from './DeviceCard.vue';
import DevicePlayer from './DevicePlayer.vue';
import { IconDrone } from '@tabler/icons-vue';

defineProps<{
    user: { email: string; access?: string };
}>();

const devicesStore = useDevicesStore();
const { items } = storeToRefs(devicesStore);

const selectedSn = ref<string | undefined>();
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
