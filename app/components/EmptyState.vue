<template>
  <div
    class="h-full flex flex-col items-center justify-center opacity-40 cursor-pointer hover:opacity-60 transition-opacity"
    @click="openFile">
    <PhMusicNote class="size-20 mb-4" />
    <p class="mb-1">Open a file to get started</p>
    <p class="text-sm">⌘O or File → Open</p>
  </div>
</template>

<script setup lang="ts">
import { PhMusicNote } from "@phosphor-icons/vue";

const { openFile } = useSong();
</script>
