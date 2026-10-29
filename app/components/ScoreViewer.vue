<template>
  <div class="flex h-full min-h-0 flex-col">
    <div class="flex shrink-0 flex-wrap items-center gap-2 border-b border-white/10 bg-zinc-900/40 px-4 py-2 text-xs text-white/70">
      <select :value="trackIndex" aria-label="Track" class="tab-control mr-auto max-w-48" :disabled="loading" @change="selectTrack(Number(($event.target as HTMLSelectElement).value))">
        <option v-for="(track, index) in song?.tracks" :key="index" :value="index" :disabled="!track.strings.length">{{ track.name || `Track ${index + 1}` }}</option>
      </select>
      <select v-model="renderer" aria-label="Renderer" class="tab-control">
        <option value="tabbycat">Tabbycat</option><option value="alphatab">alphaTab · comparison</option>
      </select>
      <template v-if="renderer === 'tabbycat'">
        <button class="tab-control design-toggle" :aria-pressed="designMode" :disabled="loading" @click="toggleDesign">Design mode</button>
        <select v-model="mode" aria-label="Tab layout" class="tab-control" :disabled="designMode"><option value="wrap">Page</option><option value="continuous">Continuous</option></select>
        <select v-model.number="density" aria-label="Tab spacing" class="tab-control" :disabled="!!song?.tracks[trackIndex]?.tabLayout"><option :value=".85">Compact</option><option :value="1">Comfortable</option><option :value="1.25">Spacious</option></select>
        <select v-model.number="zoom" aria-label="Tab zoom" class="tab-control"><option :value=".75">75%</option><option :value="1">100%</option><option :value="1.25">125%</option><option :value="1.5">150%</option></select>
      </template>
    </div>
    <div class="min-h-0 min-w-0 flex-1">
      <TabEditor v-if="renderer === 'tabbycat'" :track-index="trackIndex" :voice-index="voiceIndex" :mode :zoom :density :design-mode="designMode" />
      <AlphaTabViewer v-else />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
const { song, selection, loading, selectTrack } = useSong();
const renderer = useState<'tabbycat' | 'alphatab'>('score:renderer', () => 'tabbycat');
const mode = ref<'wrap' | 'continuous'>('wrap');
const zoom = ref(1), density = ref(1);
const designMode = ref(false);
function toggleDesign() { designMode.value = !designMode.value; if (designMode.value) mode.value = 'wrap'; }
const trackIndex = computed(() => selection.value?.track ?? 0);
const voiceIndex = computed(() => selection.value?.voice ?? 0);
</script>

<style scoped>
.tab-control { padding: 5px 8px; border-radius: 5px; border: 1px solid #ffffff12; background: #ffffff08; color-scheme: dark; outline: none; }
.tab-control:focus { border-color: #38bdf8; }
.tab-control:disabled { opacity: .4; }
.design-toggle { cursor: pointer; }
.design-toggle[aria-pressed="true"] { background: #38bdf825; color: #bae6fd; border-color: #38bdf866; }
</style>
