<template>
  <g class="tab-techniques">
    <g v-for="technique in techniques" :key="technique.id" :data-technique="technique.kind"
      :data-technique-source="technique.sourceId" :data-technique-target="technique.targetId" :data-continuation="technique.continuation">
      <title>{{ technique.title }}</title>
      <path v-for="(path, index) in technique.paths" :key="index" :d="path.d" :data-technique-part="path.kind"
        class="tab-technique-line" :stroke-dasharray="path.kind === 'hold' ? '3 3' : undefined" />
      <text v-for="(label, index) in technique.labels" :key="index" :x="label.x" :y="label.y"
        text-anchor="middle" class="tab-technique-label">{{ label.text }}</text>
    </g>
  </g>
</template>

<script setup lang="ts">
import type { TabTechnique } from '~~/shared/tab-techniques';
defineProps<{ techniques: TabTechnique[] }>();
</script>
