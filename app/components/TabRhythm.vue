<template>
  <g :transform="`translate(${x},${y})`" class="tab-rhythm">
    <template v-if="rest">
      <rect v-if="duration.value <= 2" x="-6" :y="duration.value === 1 ? -3 : -7" width="12" height="5" />
      <path v-else-if="duration.value === 4" d="M-3 -18 L3 -12 L-3 -6 L3 0 Q-5 -3 -2 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" />
      <g v-else>
        <path :d="`M4 ${-15 - (flags - 1) * 5} L-2 6`" fill="none" stroke="currentColor" stroke-width="1.5" />
        <circle v-for="i in flags" :key="i" cx="-1" :cy="-14 - (i - 1) * 5" r="2.6" />
      </g>
    </template>
    <template v-else>
      <path d="M -6 7 L 1.5 -7 L 6 -7 L -1.5 7 Z" data-testid="tab-rhythm-slash"
        :fill="duration.value <= 2 ? 'var(--tab-paper)' : 'currentColor'" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" />
      <line v-if="duration.value > 1" :x1="RHYTHM_STEM_X" :x2="RHYTHM_STEM_X" y1="-7" :y2="-RHYTHM_STEM_HEIGHT" stroke="currentColor" stroke-width="1.3" />
      <path v-for="i in beamed ? 0 : flags" :key="i" data-testid="tab-flag" :d="`M4.5 ${-25 + (i - 1) * 5} Q17 ${-20 + (i - 1) * 5} 11 ${-12 + (i - 1) * 5}`" fill="none" stroke="currentColor" stroke-width="1.5" />
    </template>
    <circle v-for="i in dots" :key="i" :cx="9 + i * 4" cy="-2" r="1.6" />
  </g>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { TGDuration } from '~~/shared/model';
import { beamCount, RHYTHM_STEM_X, RHYTHM_STEM_HEIGHT } from '~~/shared/tab-rhythm';
const { x, y, duration, rest, beamed = false } = defineProps<{ x: number; y: number; duration: TGDuration; rest: boolean; beamed?: boolean }>();
const flags = computed(() => beamCount(duration.value));
const dots = computed(() => duration.doubleDotted ? 2 : duration.dotted ? 1 : 0);
</script>
