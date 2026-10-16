<template>
  <!-- Playback progress bar -->
  <div class="h-1 bg-white/10 grow relative rounded-full overflow-hidden" role="progressbar" aria-label="Playback progress" :aria-valuenow="Math.round(playbackProgress * 100)" aria-valuemin="0" aria-valuemax="100">
    <div
      class="absolute inset-y-0 left-0 bg-white/70 transition-none"
      :style="{ width: `${playbackProgress * 100}%` }" />
  </div>
</template>

<script setup lang="ts">
const { playbackProgress } = usePlayback();
</script>
