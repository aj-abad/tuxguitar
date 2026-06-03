<template>
  <!-- Playback progress bar -->
  <div class="h-1 bg-white/10 grow relative rounded-full overflow-hidden">
    <div
      class="absolute inset-y-0 left-0 bg-white/70 transition-none"
      :style="{ width: `${playbackProgress * 100}%` }" />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

const { song } = useSong();
const { isPlaying, currentMeasure, playbackProgress, play } = usePlayback();

const hasSong = computed(() => song.value !== null);

if (typeof window !== "undefined") {
  window.addEventListener("keydown", (e) => {
    if (e.key === " " && hasSong.value) {
      e.preventDefault();
      play();
    }
  });
}
</script>