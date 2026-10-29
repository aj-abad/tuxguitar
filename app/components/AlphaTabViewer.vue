<template>
  <ScrollArea root-class="size-full score-scroll">
    <section
      ref="editorSurface"
      tabindex="0"
      aria-label="Tablature editor. Use left and right arrows for beats, up and down for strings, and number keys to enter a fret."
      class="m-4 mx-auto max-w-4xl min-h-256 rounded-xl bg-white p-4 text-zinc-900 shadow-lg outline-none focus-visible:ring-2 focus-visible:ring-sky-400 md:p-8"
      @keydown="editKey"
      @pointerdown="focusEditor">
      <h1 class="mb-6 text-3xl">{{ song?.name || fileName }}</h1>
      <div ref="surface" class="relative" data-testid="score-surface" :data-rendering="rendering">
        <div ref="container" />
        <div
          v-for="(box, index) in highlights"
          :key="index"
          data-testid="note-selection"
          aria-hidden="true"
          class="pointer-events-none absolute rounded-sm border-2 border-sky-500 bg-sky-400/20"
          :style="{ left: box.x + 'px', top: box.y + 'px', width: box.w + 'px', height: box.h + 'px' }" />
      </div>
      <p v-if="renderError" role="alert" class="mt-4 text-sm text-red-700">{{ renderError }}</p>
    </section>
  </ScrollArea>
</template>

<script setup lang="ts">
import * as alphaTab from "@coderline/alphatab";
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { tgSongToScore } from "~~/shared/tg-to-alphatab";
import { beatKey, type NoteAddress, type BeatAddress } from "~~/shared/editor";
import { resolveTabKey } from '~~/shared/tab-commands';

const { song, fileName, selection, loading, selectNote, selectBeat, selectCursor, enterDigit, navigate, runTabCommand } = useSong();
const { bindings } = useTabKeymap();
const editorSurface = ref<HTMLElement | null>(null);
const surface = ref<HTMLElement | null>(null);
const container = ref<HTMLElement | null>(null);
const highlights = ref<Array<{ x: number; y: number; w: number; h: number }>>([]);
const renderError = ref<string | null>(null);
const rendering = ref(true);
let api: alphaTab.AlphaTabApi | null = null;
let mounted = false;
let renderInFlight = false;
let renderQueued = false;
let noteMap = new Map<number, NoteAddress>();
let beatMap = new Map<number, BeatAddress>();
let renderedBeats = new Map<string, alphaTab.model.Beat>();

function focusEditor() {
  editorSurface.value?.focus({ preventScroll: true });
}

function editKey(event: KeyboardEvent) {
  if (loading.value || (event.target as HTMLElement)?.closest('input, textarea, select, [contenteditable]')) return;
  const action = resolveTabKey(event, bindings.value);
  if (!action) return;
  event.preventDefault();
  event.stopPropagation();
  // Comparison rendering has a single-cell highlight, so navigation stays single-cell.
  if (action.kind === 'navigate') navigate(action.direction);
  else if (action.kind === 'digit') { if (!event.repeat) enterDigit(action.digit); }
  else if (action.kind === 'command') { if (!event.repeat) runTabCommand(action.id); }
  else if (selection.value) selectCursor(selection.value);
}

function updateHighlights() {
  if (renderInFlight || renderQueued) { highlights.value = []; return; }
  const beat = selection.value ? renderedBeats.get(beatKey(selection.value)) : undefined;
  if (!beat || !api?.boundsLookup || !surface.value || !container.value) {
    highlights.value = [];
    return;
  }
  const canvas = container.value.querySelector(".at-surface") ?? container.value;
  const canvasRect = canvas.getBoundingClientRect();
  const surfaceRect = surface.value.getBoundingClientRect();
  const stringCount = song.value!.tracks[selection.value!.track]!.strings.length;
  const note = beat.notes.find(n => n.string === stringCount + 1 - selection.value!.string);
  const boxes = (api.boundsLookup.findBeats(beat) ?? []).map(bounds => {
    const head = bounds.notes?.find(n => n.note.id === note?.id)?.noteHeadBounds;
    // Empty strings and rests still have a time cursor, so keyboard entry is
    // possible without an existing note head to click or highlight.
    const b = head ?? { x: bounds.onNotesX - 3, y: bounds.visualBounds.y, w: 6, h: Math.max(18, bounds.visualBounds.h) };
    return {
      x: b.x + canvasRect.left - surfaceRect.left - 4,
      y: b.y + canvasRect.top - surfaceRect.top - 4,
      w: Math.max(b.w, 6) + 8, h: Math.max(b.h, 6) + 8,
    };
  });
  highlights.value = boxes;
}

onMounted(async () => {
  mounted = true;
  if (!container.value) return;
  await Promise.allSettled([
    new FontFace("alphaTab", "url(/font/Leipzig.otf)").load().then(font => document.fonts.add(font)),
  ]);
  if (!mounted || !container.value) return;
  api = new alphaTab.AlphaTabApi(container.value, {
    core: {
      includeNoteBounds: true,
      // The editing caret must appear together with the updated notation.
      enableLazyLoading: false,
      smuflFontSources: new Map([[alphaTab.FontFileFormat.OpenType, "/font/Leipzig.otf"]]),
    },
    display: {
      layoutMode: alphaTab.LayoutMode.Page, scale: 1, padding: [16, 16],
      resources: { staffLineColor: "rgba(0,0,0,0.25)" },
    },
    player: { enablePlayer: false, enableCursor: false, enableUserInteraction: false },
  });
  api.error.on(e => {
    renderError.value = e.message;
    renderInFlight = false;
    renderQueued = false;
    rendering.value = false;
  });
  api.renderStarted.on(() => { renderInFlight = true; rendering.value = true; highlights.value = []; });
  api.beatMouseDown.on(beat => {
    if (rendering.value) return;
    const address = beatMap.get(beat.id);
    if (address) selectBeat(address);
    focusEditor();
  });
  api.noteMouseDown.on(note => {
    if (rendering.value) return;
    const address = noteMap.get(note.id);
    if (address) selectNote(address);
    focusEditor();
  });
  api.postRenderFinished.on(() => {
    renderInFlight = false;
    if (renderQueued) {
      // The worker resolves its bounds against the most recently submitted
      // score. Never replace that score while its previous render is pending.
      // Collapse rapid edits into the newest state once this callback returns.
      queueMicrotask(renderSong);
    } else {
      updateHighlights();
      rendering.value = false;
    }
  });
  renderSong();
});

onBeforeUnmount(() => {
  mounted = false;
  api?.destroy();
  api = null;
});

watch(song, renderSong);
watch(selection, async () => {
  updateHighlights();
  await nextTick();
  if (document.activeElement === editorSurface.value) {
    surface.value?.querySelector('[data-testid="note-selection"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
}, { flush: "post" });

function renderSong() {
  if (!mounted || !api || !song.value) return;
  rendering.value = true;
  highlights.value = [];
  if (renderInFlight) { renderQueued = true; return; }
  renderQueued = false;
  try {
    renderError.value = null;
    renderInFlight = true;
    noteMap = new Map();
    beatMap = new Map();
    renderedBeats = new Map();
    const score = tgSongToScore(song.value, (note, address) => {
      noteMap.set(note.id, address);
    }, (beat, address) => {
      beatMap.set(beat.id, address);
      renderedBeats.set(beatKey(address), beat);
    });
    api.renderScore(score, score.tracks.map(track => track.index));
  } catch (e) {
    renderInFlight = false;
    rendering.value = false;
    renderError.value = String(e);
  }
}
</script>

<style scoped>
/* alphaTab measures its container. An intrinsic minimum width would retain
   the previous score width and prevent a narrower window from relayouting. */
.score-scroll :deep([data-reka-scroll-area-viewport] > div) {
  min-width: 0 !important;
}
</style>
