<template>
  <div ref="viewport" class="tab-workspace" @scroll="onScroll">
    <section ref="surface" tabindex="0" aria-label="Tablature editor" class="tab-document" @keydown="editKey">
      <div class="tab-heading">
        <h1>{{ song?.name || fileName }}</h1>
        <p>{{ track?.name }} · {{ track?.strings.length }} strings</p>
      </div>
      <p v-for="notice in notices" :key="notice" class="tab-notice">{{ notice }}</p>
      <div data-testid="score-surface" data-rendering="false" :data-layout-columns="layout?.columns.length">
        <svg v-if="layout" ref="drawing" :width="layout.width * zoom" :height="layout.height * zoom"
          :viewBox="`0 0 ${layout.width} ${layout.height}`" class="tab-drawing"
          @pointerdown="pointerDown" @pointermove="pointerMove" @pointerup="pointerUp" @pointercancel="pointerUp">
          <TabSystem v-for="system in visibleSystems" :key="system.index" :system :fret-size="layout.fretSize" />
          <g class="tab-overlay" pointer-events="none">
            <rect v-for="(box, i) in selectionRects" :key="i" v-bind="rectAttrs(box)" rx="3" class="tab-range" data-testid="tab-selection-range" />
            <rect v-if="caret" v-bind="rectAttrs(caret)" rx="4" class="tab-caret" data-testid="note-selection" />
            <line v-if="playhead" :x1="playhead.x" :x2="playhead.x" :y1="playhead.y" :y2="playhead.y + playhead.height" class="tab-playhead" />
          </g>
        </svg>
      </div>
      <p v-if="!layout?.columns.length" class="tab-notice">No editable columns in this voice. Use the comparison view to inspect this track.</p>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, markRaw, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue';
import { beatKey, cursorKey, selectedColumns } from '~~/shared/editor';
import { cellBounds, columnBounds, hitTestTab, layoutTab, playbackPosition, tabNotices, type Rect } from '~~/shared/tab-layout';
import { resolveTabKey } from '~~/shared/tab-commands';

const { trackIndex, voiceIndex, mode, zoom, density } = defineProps<{
  trackIndex: number; voiceIndex: number; mode: 'wrap' | 'continuous'; zoom: number; density: number;
}>();
const { editor, song, selection, fileName, loading, selectCursor, enterDigit, navigate, runTabCommand } = useSong();
const { isPlaying, playbackTick } = usePlayback();
const viewport = useTemplateRef<HTMLDivElement>('viewport');
const surface = useTemplateRef<HTMLElement>('surface');
const drawing = useTemplateRef<SVGSVGElement>('drawing');
const width = ref(900), height = ref(800), scrollTop = ref(0);
const identities = computed(() => editor.value?.identities);
const track = computed(() => song.value?.tracks[trackIndex]);
const layout = computed(() => song.value && identities.value ? markRaw(layoutTab(song.value, trackIndex, voiceIndex, identities.value,
  { width: Math.max(240, (width.value - 48) / zoom), mode, density })) : null);
const notices = computed(() => song.value ? [...tabNotices(song.value, trackIndex, voiceIndex), ...layout.value?.issues ?? []] : []);
const visibleSystems = computed(() => layout.value?.systems.filter(s =>
  (s.y + s.height) * zoom >= scrollTop.value - 300 && s.y * zoom <= scrollTop.value + height.value + 300) ?? []);
const caret = computed(() => layout.value && selection.value ? cellBounds(layout.value, selection.value) : null);
const playhead = computed(() => isPlaying.value && layout.value ? playbackPosition(layout.value, playbackTick.value) : null);
const selectionRects = computed(() => {
  const state = editor.value, view = layout.value;
  if (!state?.selection || !view || (!state.anchor && state.selectionMode === 'cell')) return [];
  const visible = new Set(visibleSystems.value.map(s => s.index));
  const first = Math.min(state.selection.string, state.anchor?.string ?? state.selection.string);
  const last = Math.max(state.selection.string, state.anchor?.string ?? state.selection.string);
  return selectedColumns(state).flatMap(address => {
    const found = view.byAddress.get(beatKey(address));
    if (!found || !visible.has(found.system.index)) return [];
    if (state.selectionMode === 'columns') return [columnBounds(view, address)!];
    return found.system.strings.filter(s => s.number >= first && s.number <= last).map(s => cellBounds(view, { ...address, string: s.number })!);
  });
});
const rectAttrs = (r: Rect) => ({ x: r.x, y: r.y, width: r.w, height: r.h });
let observer: ResizeObserver | undefined;
let dragging = false;
let dragFrame = 0;
let pointer = { x: 0, y: 0 };

function onScroll() { scrollTop.value = viewport.value?.scrollTop ?? 0; }
function hit(event: { clientX: number; clientY: number }) {
  const matrix = drawing.value?.getScreenCTM();
  if (!matrix || !layout.value) return null;
  const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
  return hitTestTab(layout.value, point.x, point.y);
}
function pointerDown(event: PointerEvent) {
  if (event.button !== 0 || loading.value) return;
  const target = hit(event);
  if (!target) return;
  event.preventDefault();
  surface.value?.focus({ preventScroll: true });
  if (target.kind === 'columns' && selection.value?.track === trackIndex) target.cursor.string = selection.value.string;
  selectCursor(target.cursor, event.shiftKey, target.kind);
  drawing.value?.setPointerCapture(event.pointerId);
  dragging = true;
  pointer = { x: event.clientX, y: event.clientY };
  dragFrame = requestAnimationFrame(scrollDrag);
}
function pointerMove(event: PointerEvent) {
  if (!dragging) return;
  pointer = { x: event.clientX, y: event.clientY };
  extendDrag();
}
function extendDrag() {
  const target = hit({ clientX: pointer.x, clientY: pointer.y });
  if (target && selection.value && cursorKey(target.cursor) !== cursorKey(selection.value)) selectCursor(target.cursor, true);
}
function scrollDrag() {
  if (!dragging || !viewport.value) return;
  const box = viewport.value.getBoundingClientRect();
  const speed = (value: number, min: number, max: number) => value < min + 30 ? -12 : value > max - 30 ? 12 : 0;
  viewport.value.scrollBy(speed(pointer.x, box.left, box.right), speed(pointer.y, box.top, box.bottom));
  extendDrag();
  dragFrame = requestAnimationFrame(scrollDrag);
}
function pointerUp(event: PointerEvent) {
  dragging = false;
  cancelAnimationFrame(dragFrame);
  if (drawing.value?.hasPointerCapture(event.pointerId)) drawing.value.releasePointerCapture(event.pointerId);
}
function editKey(event: KeyboardEvent) {
  if (loading.value) return;
  const action = resolveTabKey(event);
  if (!action) return;
  event.preventDefault();
  event.stopPropagation();
  if (action.kind === 'navigate') navigate(action.direction, action.extend);
  else if (action.kind === 'digit') { if (!event.repeat) enterDigit(action.digit); }
  else if (action.kind === 'command') { if (!event.repeat) runTabCommand(action.id); }
  else if (selection.value) selectCursor(selection.value);
}
watch(selection, async () => {
  await nextTick();
  if (dragging || document.activeElement !== surface.value || !viewport.value) return;
  const target = drawing.value?.querySelector('[data-testid="note-selection"]')?.getBoundingClientRect();
  const box = viewport.value.getBoundingClientRect();
  if (!target) return;
  const dx = target.left < box.left + 24 ? target.left - box.left - 24 : target.right > box.right - 24 ? target.right - box.right + 24 : 0;
  const dy = target.top < box.top + 24 ? target.top - box.top - 24 : target.bottom > box.bottom - 24 ? target.bottom - box.bottom + 24 : 0;
  viewport.value.scrollBy(dx, dy);
}, { flush: 'post' });
onMounted(() => {
  observer = new ResizeObserver(() => { if (viewport.value) { width.value = viewport.value.clientWidth; height.value = viewport.value.clientHeight; } });
  if (viewport.value) observer.observe(viewport.value);
});
onBeforeUnmount(() => { observer?.disconnect(); cancelAnimationFrame(dragFrame); });
</script>

<style>
.tab-workspace { --tab-paper: #fafaf9; --tab-ink: #27272a; height: 100%; overflow: auto; background: var(--tab-paper); color: var(--tab-ink); scrollbar-color: #bbb #fafaf9; }
.tab-document { min-height: 100%; width: max-content; min-width: 100%; padding: 28px 24px; outline: none; }
.tab-document:focus-visible .tab-caret { stroke-width: 2; }
.tab-heading { margin: 0 0 16px 38px; }
.tab-heading h1 { font-size: 22px; font-weight: 600; letter-spacing: -.5px; }
.tab-heading p { margin-top: 4px; font-size: 12px; color: #71717a; }
.tab-notice { margin: 8px 38px; max-width: 60ch; font-size: 12px; color: #71717a; }
.tab-drawing { display: block; touch-action: none; user-select: none; overflow: visible; }
.tab-string { stroke: #c7c7cc; stroke-width: 1; }
.tab-barline { stroke: #a1a1aa; stroke-width: 1; }
.tab-guide { stroke: #d4d4d8; stroke-width: 1; stroke-dasharray: 2 5; opacity: .3; }
.tab-fret { font-family: 'Geist Mono', ui-monospace, Consolas, monospace; font-weight: 500; fill: var(--tab-ink); }
.tab-tuning { font-family: ui-monospace, Consolas, monospace; fill: #85858e; font-size: 10px; }
.tab-small { font-size: 10px; fill: #85858e; }
.tab-measure-number { font-family: ui-monospace, Consolas, monospace; font-size: 12px; font-weight: 600; fill: #52525b; }
.tab-rhythm { color: #71717a; fill: currentColor; }
.tab-tuplet-bracket { fill: none; stroke: currentColor; stroke-width: 1; }
.tab-tuplet-label { font-size: 11px; font-style: italic; }
.tab-technique-line { fill: none; stroke: #52525b; stroke-width: 1.35; stroke-linecap: round; stroke-linejoin: round; }
.tab-technique-label { font-family: 'Geist Mono', ui-monospace, monospace; font-size: 10px; font-weight: 500; fill: #52525b; paint-order: stroke; stroke: var(--tab-paper); stroke-width: 4; stroke-linejoin: round; }
.tab-caret { fill: #0ea5e922; stroke: #0284c7; stroke-width: 1.5; }
.tab-range { fill: #0ea5e91a; stroke: #0ea5e944; stroke-width: 1; }
.tab-playhead { stroke: #10b981; stroke-width: 2; }
</style>
