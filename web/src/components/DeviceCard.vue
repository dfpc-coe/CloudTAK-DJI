<template>
    <div
        class='card cursor-pointer hover'
        @click='$emit("select", device.sn)'
    >
        <div class='card-body py-2'>
            <div class='d-flex align-items-center'>
                <div>
                    <TablerBadge
                        class='me-2'
                        :background-color='device.online ? "rgba(47, 179, 68, 0.2)" : "rgba(130, 130, 130, 0.15)"'
                        :border-color='device.online ? "rgba(47, 179, 68, 0.5)" : "rgba(130, 130, 130, 0.4)"'
                        :text-color='device.online ? "#2fb344" : "#888"'
                    >
                        {{ device.online ? 'ONLINE' : 'OFFLINE' }}
                    </TablerBadge>
                    <strong>{{ device.callsign || device.sn }}</strong>
                    <span class='text-muted ms-2'>{{ device.type }}</span>
                </div>
                <div
                    v-if='device.livestream && device.livestream.active'
                    class='ms-auto'
                >
                    <TablerBadge
                        background-color='rgba(214, 57, 57, 0.2)'
                        border-color='rgba(214, 57, 57, 0.5)'
                        text-color='#d63939'
                    >
                        LIVE
                    </TablerBadge>
                </div>
            </div>

            <div
                v-if='device.osd'
                class='mt-2 small text-muted'
            >
                <span v-if='hasFix'>
                    {{ device.osd.latitude!.toFixed(5) }},
                    {{ device.osd.longitude!.toFixed(5) }}
                </span>
                <span
                    v-if='device.osd.height !== undefined'
                    class='ms-2'
                >alt {{ device.osd.height.toFixed(1) }}m</span>
                <span
                    v-if='device.osd.battery && device.osd.battery.capacity_percent !== undefined'
                    class='ms-2'
                >batt {{ device.osd.battery.capacity_percent }}%</span>
                <span
                    v-if='device.osd.horizontal_speed !== undefined'
                    class='ms-2'
                >gs {{ device.osd.horizontal_speed.toFixed(1) }}m/s</span>
            </div>
        </div>
    </div>
</template>

<script setup lang='ts'>
import { computed } from 'vue';
import { TablerBadge } from '@tak-ps/vue-tabler';
import type { DJIDevice } from '../types.ts';

const props = defineProps<{ device: DJIDevice }>();
defineEmits<{ (e: 'select', sn: string): void }>();

const hasFix = computed(() =>
    typeof props.device.osd?.latitude === 'number'
    && typeof props.device.osd?.longitude === 'number'
);
</script>
