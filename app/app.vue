<template>
  <div class="h-screen flex flex-col text-white select-none">
    <GlobalTitleBar />
    <TopBar />
    <!-- Song metadata strip -->
    <div
      v-if="song"
      class="bg-black/40 px-4 py-1.5 text-xs border-b border-white/10 shrink-0 flex gap-4 flex-wrap opacity-70">
      <span v-if="song.name">{{ song.name }}</span>
      <span v-if="song.artist">by {{ song.artist }}</span>
      <span v-if="song.album">• {{ song.album }}</span>
      <span>{{ song.tracks.length }} track{{ song.tracks.length !== 1 ? "s" : "" }}</span>
      <span>{{ song.measureHeaders.length }} measures</span>
      <span>{{ song.measureHeaders[0]?.tempo ?? 120 }} BPM</span>
    </div>

   

    <!-- Main content -->
    <main class="flex-1 overflow-hidden flex flex-col">
      <EmptyState v-if="!song" />
      <ScoreViewer v-else />
    </main>

    <!-- Status bar -->
    <footer
      class="bg-black/60 px-4 py-0.5 text-xs opacity-30 shrink-0 flex items-center gap-3 border-t border-white/5">
      <span v-if="sidecarStatus !== 'not-found'">sidecar: {{ sidecarStatus }}</span>
      <span class="grow" />
    </footer>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import type { SidecarStatus } from "~~/shared/ipc";

const { song } = useSong();
const { playbackProgress } = usePlayback();
const sidecarStatus = ref<SidecarStatus>("not-found");

onMounted(async () => {
  if (typeof window === "undefined" || !window.tg) return;
  sidecarStatus.value = await window.tg.getSidecarStatus();
});
</script>
