<template>
  <header
    class="text-white pr-4 py-2 flex items-center gap-4 select-none"
    :class="isMac ? 'pl-20' : 'pl-4'"
    style="-webkit-app-region: drag">
    <span class="text-sm">Tabbycat v{{ appVersion }}</span>
  </header>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";

const versions = ref<{ node: string; chrome: string; electron: string } | null>(null);
const appVersion = ref("—");
const isMac = typeof window !== "undefined" && window.tg?.platform === "darwin";

onMounted(async () => {
  if (typeof window === "undefined" || !window.tg) return;
  versions.value = window.tg.versions;
  appVersion.value = await window.tg.getVersion();
});
</script>
