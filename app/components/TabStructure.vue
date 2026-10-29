<template>
  <g class="tab-structure">
    <g v-for="barline in system.barlines" :key="barline.id" data-testid="tab-barline" :data-barline="barline.kind"
      :class="barline.kind === 'single' ? 'tab-barline' : 'tab-repeat-barline'">
      <line v-for="(line, index) in barline.lines" :key="index" :x1="line.x" :x2="line.x"
        :y1="barline.top" :y2="barline.bottom" :stroke-width="line.width" />
      <circle v-for="(dot, index) in barline.dots" :key="`dot:${index}`" :cx="dot.x" :cy="dot.y" r="2.1" />
    </g>
    <g v-for="ending in system.endings" :key="ending.id" data-testid="tab-ending" :data-ending-start="ending.startMeasure"
      :data-ending-end="ending.endMeasure" :data-continuation="ending.continuation">
      <path :d="`${ending.leftHook ? `M ${ending.x1} ${ending.y + ending.height} L` : 'M'} ${ending.x1} ${ending.y} H ${ending.x2}${ending.rightHook ? ` V ${ending.y + ending.height}` : ''}`"
        class="tab-ending-bracket" />
      <text :x="ending.labelX" :y="ending.labelY" class="tab-structure-label">{{ ending.label }}</text>
    </g>
    <text v-for="count in system.repeatCounts" :key="count.measure" :x="count.x" :y="count.y" text-anchor="end"
      class="tab-structure-label" data-testid="tab-repeat-count" :data-repeat-measure="count.measure">
      <title>{{ count.title }}</title>{{ count.text }}
    </text>
  </g>
</template>

<script setup lang="ts">
import type { TabSystem } from '~~/shared/tab-layout';
const { system } = defineProps<{ system: TabSystem }>();
</script>

<style>
.tab-repeat-barline { stroke: #52525b; fill: #52525b; }
.tab-repeat-barline circle { stroke: none; }
.tab-ending-bracket { stroke: #52525b; stroke-width: 1.2; stroke-linejoin: round; fill: none; }
.tab-structure-label { font-family: 'Geist Mono', ui-monospace, monospace; font-size: 12px; font-weight: 500; fill: #52525b; }
</style>
