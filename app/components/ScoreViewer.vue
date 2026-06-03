<template>
  <ScrollArea root-class="size-full">
    <div class="w-[21cm] min-h-[29.7cm] flex mx-auto my-4 bg-white rounded-xl shadow-lg p-8">
      <div class="flex-1 relative overflow-hidden" ref="container" />
    </div>
  </ScrollArea>
</template>

<script setup lang="ts">
import * as alphaTab from "@coderline/alphatab";
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { tgSongToScore } from "~~/shared/tg-to-alphatab";

const { song } = useSong();

const container = ref<HTMLElement | null>(null);
let api: alphaTab.AlphaTabApi | null = null;

onMounted(async () => {
  if (!container.value) return;
  console.log(
    "[ScoreViewer] mounting, container size:",
    container.value.offsetWidth,
    "x",
    container.value.offsetHeight,
  );

  await Promise.allSettled([
    new FontFace("alphaTab", "url(/font/Leipzig.otf)").load().then((f) => document.fonts.add(f)),
  ]);

  api = new alphaTab.AlphaTabApi(container.value, {
    core: {
      logLevel: alphaTab.LogLevel.Info,
      smuflFontSources: new Map([[alphaTab.FontFileFormat.OpenType, "/font/Leipzig.otf"]]),
    },
    display: {
      layoutMode: alphaTab.LayoutMode.Page,
      scale: 0.9,
      padding: [16, 16],
    },
    player: {
      enablePlayer: false,
      enableCursor: false,
    },
  });

  api.error.on((e) => {
    console.error("[alphaTab] error:", e.message, (e as any).inner);
  });

  api.postRenderFinished.on(() => {
    console.log("[alphaTab] render finished");
  });

  if (song.value) renderSong();
});

onBeforeUnmount(() => {
  api?.destroy();
  api = null;
});

watch(song, (v) => {
  if (v) renderSong();
});

function renderSong() {
  if (!api || !song.value) return;
  try {
    console.log("[ScoreViewer] converting song:", song.value.tracks.length, "tracks");
    const score = tgSongToScore(song.value);
    console.log("[ScoreViewer] score built, calling renderScore");
    api.renderScore(score);
  } catch (e) {
    console.error("[ScoreViewer] conversion failed:", e);
  }
}
</script>
