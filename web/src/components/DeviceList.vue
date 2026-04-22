<template>
    <div class='card bg-accent text-white h-100'>
        <div class='card-header d-flex align-items-center'>
            <h3 class='card-title mb-0'>
                <IconDrone
                    size='24'
                    stroke='1.5'
                />
                <span class='mx-2'>UAS Fleet</span>
            </h3>
            <TablerBadge
                class='ms-auto'
                :background-color='devicesStore.connected ? "rgba(47, 179, 68, 0.2)" : "rgba(245, 159, 0, 0.2)"'
                :border-color='devicesStore.connected ? "rgba(47, 179, 68, 0.5)" : "rgba(245, 159, 0, 0.5)"'
                :text-color='devicesStore.connected ? "#2fb344" : "#f59f00"'
            >
                {{ devicesStore.connected ? 'live' : 'offline' }}
            </TablerBadge>
        </div>
        <div
            class='list-group list-group-flush'
            style='overflow-y: auto;'
        >
            <div
                v-if='!devicesStore.list.length'
                class='p-4 text-center text-muted'
            >
                No devices have reported yet.<br>
                <small>Bind a DJI dock or aircraft via DJI Pilot to see it here.</small>
            </div>
            <a
                v-for='dev in devicesStore.list'
                :key='dev.sn'
                class='list-group-item list-group-item-action cursor-pointer bg-accent text-white'
                :class='{ active: selected === dev.sn }'
                @click='$emit("select", dev.sn)'
            >
                <div class='d-flex align-items-center'>
                    <span
                        class='status-dot me-2'
                        :class='dev.online ? "status-dot-animated bg-success" : "bg-secondary"'
                    />
                    <div class='flex-grow-1'>
                        <div
                            class='fw-bold'
                            v-text='dev.callsign || dev.sn'
                        />
                        <small
                            class='text-muted'
                            v-text='dev.sn'
                        />
                    </div>
                    <div
                        class='text-end'
                        style='min-width: 80px;'
                    >
                        <small v-if='dev.osd?.battery?.capacity_percent !== undefined'>
                            <IconBattery
                                size='16'
                                stroke='1.5'
                            />
                            {{ dev.osd.battery.capacity_percent }}%
                        </small>
                    </div>
                </div>
            </a>
        </div>
    </div>
</template>

<script setup lang='ts'>
import { useDevicesStore } from '../stores/devices.ts';
import { IconDrone, IconBattery } from '@tabler/icons-vue';
import { TablerBadge } from '@tak-ps/vue-tabler';

defineProps<{ selected?: string }>();
defineEmits<{ (e: 'select', sn: string): void }>();

const devicesStore = useDevicesStore();
</script>
