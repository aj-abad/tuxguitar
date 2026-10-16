<template>
  <section class="flex shrink-0 flex-wrap items-center gap-2 border-b border-white/10 px-4 py-2 text-white" style="-webkit-app-region: no-drag">
    <button class="editor-button" :disabled="loading" title="Open (Ctrl/Cmd+O)" aria-label="Open file" @click="openFile">
      <PhFolderOpen class="size-4" />
    </button>
    <button class="editor-button" :disabled="!song || loading" title="Save (Ctrl/Cmd+S)" aria-label="Save file" @click="save">
      <PhFloppyDisk class="size-4" />
    </button>
    <button class="editor-button text-xs" :disabled="!song || loading" @click="saveAs">Save As…</button>
    <span class="mx-1 h-5 border-l border-white/15" />
    <button class="editor-button" :disabled="!canUndo || loading" title="Undo edit (Ctrl/Cmd+Z)" aria-label="Undo edit" @click="undo">
      <PhArrowCounterClockwise class="size-4" />
    </button>
    <button class="editor-button" :disabled="!canRedo || loading" title="Redo edit (Ctrl/Cmd+Shift+Z)" aria-label="Redo edit" @click="redo">
      <PhArrowClockwise class="size-4" />
    </button>
    <span class="mx-1 h-5 border-l border-white/15" />
    <TopBarPlaybackControls />
    <div class="min-w-20 max-w-56 flex-1"><TopBarPlaybackProgress /></div>
    <span v-if="isPlaying" class="text-xs tabular-nums text-white/60">m{{ currentMeasure }}</span>
    <span class="grow" />
    <span class="max-w-60 truncate text-xs text-white/65" :title="fileName">{{ fileName }}</span>
    <span v-if="dirty" class="text-xs text-sky-300" role="status">Unsaved</span>
    <span v-if="loading" class="text-xs text-white/50" role="status">Working…</span>
    <p v-if="playbackError" role="alert" class="w-full text-xs text-amber-300">{{ playbackError }}</p>
  </section>
</template>

<script setup lang="ts">
import { PhFolderOpen, PhFloppyDisk, PhArrowCounterClockwise, PhArrowClockwise } from "@phosphor-icons/vue";
const { song, fileName, dirty, loading, canUndo, canRedo, openFile, save, saveAs, undo, redo } = useSong();
const { isPlaying, currentMeasure, playbackError } = usePlayback();
</script>
