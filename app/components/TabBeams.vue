<template>
  <g class="tab-rhythm" data-testid="tab-beams">
    <rect v-for="beam in measure.beams" :key="beam.id" :data-beam-level="beam.level" :data-beam-hook="beam.hook"
      :x="beam.x1" :y="y - RHYTHM_STEM_HEIGHT + (beam.level - 1) * BEAM_GAP"
      :width="beam.x2 - beam.x1" :height="BEAM_THICKNESS" />
    <g v-for="tuplet in measure.tuplets" :key="tuplet.id" data-testid="tab-tuplet" :data-bracket="tuplet.bracket">
      <path v-if="tuplet.bracket" :d="bracketPath(tuplet)" class="tab-tuplet-bracket" />
      <text :x="(tuplet.x1 + tuplet.x2) / 2" :y="y - 35" text-anchor="middle" class="tab-tuplet-label">{{ tuplet.label }}</text>
    </g>
  </g>
</template>

<script setup lang="ts">
import type { TabMeasure } from '~~/shared/tab-layout';
import { RHYTHM_STEM_HEIGHT, BEAM_GAP, BEAM_THICKNESS, type TabTuplet } from '~~/shared/tab-rhythm';
const { measure, y } = defineProps<{ measure: TabMeasure; y: number }>();
function bracketPath(tuplet: TabTuplet) {
  const middle = (tuplet.x1 + tuplet.x2) / 2, space = tuplet.label.length * 3.5 + 4;
  return `M ${tuplet.x1} ${y - 33} v -5 H ${middle - space} M ${middle + space} ${y - 38} H ${tuplet.x2} v 5`;
}
</script>
