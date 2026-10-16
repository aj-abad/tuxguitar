<template>
  <div class="flex h-full flex-col items-center justify-center text-white">
    <PhMusicNote class="mb-5 size-16 text-white/30" />
    <button class="editor-button gap-2 px-4 py-2 text-sm" :disabled="loading" @click="openFile">Open a .tg file</button>
    <p class="mt-3 text-xs text-white/45">Or drop a {{ SONG_FILE_FORMATS }} file anywhere in this window.</p>
  </div>
</template>
<script setup lang="ts">
import { PhMusicNote } from "@phosphor-icons/vue";
import { SONG_FILE_FORMATS } from "~~/shared/file-formats";
const { openFile, loading } = useSong();
</script>
