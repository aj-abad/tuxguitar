<template>
  <g data-testid="tab-system" :data-system="system.index">
    <g v-for="string in system.strings" :key="string.number">
      <line :x1="TAB_STAFF_LEFT" :x2="system.width" :y1="string.y" :y2="string.y" class="tab-string" />
    </g>
    <text :x="TAB_STAFF_LEFT + 10" :y="(system.top + system.bottom) / 2 - 15" class="tab-clef" text-anchor="middle">
      <tspan :x="TAB_STAFF_LEFT + 10">T</tspan><tspan :x="TAB_STAFF_LEFT + 10" dy="15">A</tspan><tspan :x="TAB_STAFF_LEFT + 10" dy="15">B</tspan>
    </text>
    <TabStructure :system />
    <g v-for="measure in system.measures" :key="measure.index">
      <text :x="measure.x + 2" :y="system.top - 30" class="tab-measure-number">{{ measure.index + 1 }}</text>
      <text v-if="measure.showSignature" :x="measure.x + (measure === system.measures[0] ? 38 : 14)" :y="(system.top + system.bottom) / 2 - 6" text-anchor="middle" class="tab-time-signature">
        <tspan>{{ measure.signature.split('/')[0] }}</tspan><tspan :x="measure.x + (measure === system.measures[0] ? 38 : 14)" dy="20">{{ measure.signature.split('/')[1] }}</tspan>
      </text>
      <g v-for="column in measure.columns" :key="column.id" :data-column-id="column.id" :data-measure="measure.index" :data-beat="column.address.beat">
        <line :x1="column.x" :x2="column.x" :y1="system.top - 7" :y2="system.bottom + 7" class="tab-guide" />
        <text v-if="column.annotation" :x="column.x" :y="system.y + 16" text-anchor="middle" class="tab-small">
          <title>{{ column.annotation }}</title>{{ column.annotation.slice(0, Math.max(3, Math.floor(column.width / 7))) }}
        </text>
        <g v-for="item in column.notes" :key="item.id" :data-note-id="item.id">
          <rect :x="column.x - noteWidth(item.note, fretSize) / 2" :y="item.y - fretSize * .55" :width="noteWidth(item.note, fretSize)" :height="fretSize * 1.1" fill="var(--tab-paper)" />
          <text :x="column.x" :y="item.y" text-anchor="middle" dominant-baseline="central" :font-size="fretSize" class="tab-fret">{{ noteText(item.note) }}</text>
        </g>
        <TabRhythm :x="column.x" :y="system.rhythmY" :duration="column.duration" :rest="!column.notes.length" :beamed="!!column.beamGroup" />
      </g>
      <TabBeams :measure :y="system.rhythmY" />
    </g>
    <TabTechniques :techniques="system.techniques" />
  </g>
</template>

<script setup lang="ts">
import { TAB_STAFF_LEFT, type TabSystem } from '~~/shared/tab-layout';
import { noteText, noteWidth } from '~~/shared/tab-techniques';
const { system, fretSize } = defineProps<{ system: TabSystem; fretSize: number }>();
</script>
