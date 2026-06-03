<template>
  <section
    class="text-white px-4 py-2 flex items-center gap-3 border-b border-white/5"
    style="-webkit-app-region: no-drag">
    <TopBarPlaybackControls />
    <TopBarPlaybackProgress />

    <span v-if="isPlaying" class="text-xs tabular-nums opacity-60 min-w-14">
      m{{ currentMeasure }}
    </span>
    <span v-else class="min-w-14" />

    <span class="grow" />
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";

const { song } = useSong();
const { isPlaying, currentMeasure, play } = usePlayback();

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
