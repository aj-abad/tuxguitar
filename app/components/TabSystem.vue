<template>
  <g data-testid="tab-system" :data-system="system.index">
    <g v-for="string in system.strings" :key="string.number">
      <text x="44" :y="string.y + 3.5" text-anchor="end" class="tab-tuning">{{ string.label }}</text>
      <line x1="62" :x2="system.width" :y1="string.y" :y2="string.y" class="tab-string" />
    </g>
    <g v-for="measure in system.measures" :key="measure.index">
      <text :x="measure.x + 2" :y="system.y + 26" class="tab-measure-number">{{ measure.index + 1 }}</text>
      <text :x="measure.x + 26" :y="system.y + 26" class="tab-small">{{ measure.signature }}</text>
      <line :x1="measure.x" :x2="measure.x" :y1="system.top - 6" :y2="system.bottom + 6" class="tab-barline" />
      <g v-for="column in measure.columns" :key="column.id" :data-column-id="column.id" :data-measure="measure.index" :data-beat="column.address.beat">
        <line :x1="column.x" :x2="column.x" :y1="system.top - 7" :y2="system.bottom + 7" class="tab-guide" />
        <text v-if="column.annotation" :x="column.x" :y="system.y + 48" text-anchor="middle" class="tab-small">
          <title>{{ column.annotation }}</title>{{ column.annotation.slice(0, Math.max(3, Math.floor(column.width / 7))) }}
        </text>
        <g v-for="item in column.notes" :key="item.id" :data-note-id="item.id">
          <rect :x="column.x - noteWidth(item.note, fretSize) / 2" :y="item.y - fretSize * .63" :width="noteWidth(item.note, fretSize)" :height="fretSize * 1.26" rx="3" fill="var(--tab-paper)" />
          <text :x="column.x" :y="item.y" text-anchor="middle" dominant-baseline="central" :font-size="fretSize" class="tab-fret">{{ noteText(item.note) }}</text>
        </g>
        <TabRhythm :x="column.x" :y="system.rhythmY" :duration="column.duration" :rest="!column.notes.length" :beamed="!!column.beamGroup" />
      </g>
      <TabBeams :measure :y="system.rhythmY" />
    </g>
    <line :x1="system.width" :x2="system.width" :y1="system.top - 6" :y2="system.bottom + 6" class="tab-barline" />
    <TabTechniques :techniques="system.techniques" />
  </g>
</template>

<script setup lang="ts">
import type { TabSystem } from '~~/shared/tab-layout';
import { noteText, noteWidth } from '~~/shared/tab-techniques';
const { system, fretSize } = defineProps<{ system: TabSystem; fretSize: number }>();
</script>
