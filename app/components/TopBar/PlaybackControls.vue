<template>
  <button class="editor-button" :disabled="!song || loading || (!isPlaying && !isStarting)" title="Stop" aria-label="Stop playback" @click="stop">
    <PhStop weight="fill" class="size-4" />
  </button>
  <button class="editor-button" :disabled="!song || loading || isStarting" :title="isPlaying ? 'Restart playback' : 'Play'" aria-label="Play" @click="play">
    <PhPlay weight="fill" class="size-5" />
  </button>
</template>

<script setup lang="ts">
import { PhPlay, PhStop } from "@phosphor-icons/vue";
const { song, loading } = useSong();
const { isPlaying, isStarting, play, stop } = usePlayback();
</script>
