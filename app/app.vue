<template>
  <div class="h-screen flex flex-col select-none">
    <div
      v-if="draggingFile"
      data-testid="file-drop-overlay"
      role="status"
      class="pointer-events-none fixed inset-3 z-50 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-sky-400 bg-zinc-950/90 text-white">
      <p class="text-lg font-medium">Drop to open</p>
      <p class="text-sm text-white/60">{{ SONG_FILE_FORMATS }} · One file at a time</p>
    </div>
    <GlobalTitleBar />
    <TopBar />
    <div v-if="error" role="alert" class="flex items-center gap-3 border-b border-red-400/20 bg-red-950/60 px-4 py-3 text-sm text-red-100">
      <span class="grow">{{ error }}</span>
      <button class="editor-button" aria-label="Dismiss error" @click="error = null">×</button>
    </div>
    <!-- Song metadata strip -->
    <div
      v-if="song"
      class="bg-black/40 text-white px-4 py-1.5 text-xs border-b border-white/10 shrink-0 flex gap-4 flex-wrap opacity-70">
      <span v-if="song.name">{{ song.name }}</span>
      <span v-if="song.artist">by {{ song.artist }}</span>
      <span v-if="song.album">• {{ song.album }}</span>
      <span>{{ song.tracks.length }} track{{ song.tracks.length !== 1 ? "s" : "" }}</span>
      <span>{{ song.measureHeaders.length }} measures</span>
      <span>{{ song.measureHeaders[0]?.tempo ?? 120 }} BPM</span>
    </div>

    <!-- Main content -->
    <main class="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
      <div class="min-h-0 min-w-0 flex-1">
        <EmptyState v-if="!song" />
        <ScoreViewer v-else />
      </div>
      <Sidebar v-if="song" />
    </main>

    <!-- Status bar -->
    <footer
      class="bg-black/40 px-4 py-1.5 text-xs text-white/50 shrink-0 flex items-center gap-3 border-t border-white/5">
      <span>{{ sidecarStatus === 'ready' ? 'Audio ready' : sidecarStatus === 'starting' ? 'Starting audio…' : 'Audio unavailable' }}</span>
      <span class="grow" />
    </footer>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import type { SidecarStatus } from "~~/shared/ipc";
import { SONG_FILE_FORMATS } from "~~/shared/file-formats";

const { song, error } = useSong();
useEditorBindings();
const { draggingFile } = useFileDrop();
const sidecarStatus = ref<SidecarStatus>("not-found");
let statusTimer: ReturnType<typeof setInterval> | undefined;

onMounted(async () => {
  if (typeof window === "undefined" || !window.tg) return;
  sidecarStatus.value = await window.tg.getSidecarStatus();
  statusTimer = setInterval(async () => {
    sidecarStatus.value = await window.tg.getSidecarStatus().catch(() => "error" as const);
  }, 2000);
});
onUnmounted(() => clearInterval(statusTimer));
</script>
