<template>
  <button
    :disabled="!hasSong"
    class="p-1 rounded hover:bg-white/10 transition disabled:opacity-30 disabled:cursor-not-allowed"
    title="Restart"
    @click="stop">
    <PhStop weight="fill" class="size-4" />
  </button>

  <button
    :disabled="!hasSong"
    class="p-1.5 rounded hover:bg-white/10 transition disabled:opacity-30 disabled:cursor-not-allowed"
    :title="isPlaying ? 'Restart' : 'Play'"
    @click="play">
    <PhPlay weight="fill" class="size-5" />
  </button>
</template>
<script setup lang="ts">
import { PhFolderOpen, PhPlay, PhStop } from "@phosphor-icons/vue";
import { computed } from "vue";

const { song, loading, openFile } = useSong();
const { isPlaying, currentMeasure, play, stop } = usePlayback();

const hasSong = computed(() => song.value !== null);

if (typeof window !== "undefined") {
  window.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "o") {
      e.preventDefault();
      void openFile();
    }
    if (e.key === " " && hasSong.value) {
      e.preventDefault();
      play();
    }
  });
}
</script>
