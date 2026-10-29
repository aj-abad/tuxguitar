<template>
  <div class="tab-editor-shell">
    <div v-if="designMode" class="tab-design-tools" role="toolbar" aria-label="Tab design">
      <span class="tab-design-label">Bar {{ designMeasure + 1 }}</span>
      <label>Width <input aria-label="Bar width" type="number" step="4" :value="Math.round(selectedBar?.width ?? 0)"
        :min="Math.ceil(selectedBar?.minWidth ?? 48)" :disabled="!canResize || loading" @change="setBarWidth" /></label>
      <button :disabled="!canBreak || loading" @click="designAction('break')">Break after bar</button>
      <button :disabled="!canAbsorb || loading" @click="designAction('absorb')">Pull bar from next row</button>
      <button :disabled="!track?.tabLayout || loading" @click="changeTabDesign(trackIndex, null)">Automatic layout</button>
      <span class="tab-design-hint">Drag a barline to redistribute space.</span>
    </div>
  <div ref="viewport" class="tab-workspace" @scroll="onScroll">
    <section ref="surface" tabindex="0" aria-label="Tablature editor" class="tab-document" :class="{ 'tab-designing': designMode }"
      :style="{ width: `${paperWidth * zoom}px`, padding: `${TAB_PAPER_INSET * zoom}px`, minHeight: `${paperWidth * 1.414 * zoom}px` }" @keydown="editKey"
      @pointerdown="pointerDown" @pointermove="pointerMove" @pointerup="pointerUp" @pointercancel="cancelPointer" @lostpointercapture="cancelPointer">
      <div class="tab-heading" :style="{ fontSize: `${zoom}px`, paddingLeft: `${40 * zoom}px` }">
        <h1 :style="{ marginRight: `${40 * zoom}px` }">{{ song?.name || fileName.replace(/\.(tgx|tg)$/i, '') }}</h1>
        <p v-if="song?.artist" class="tab-artist" :style="{ marginRight: `${40 * zoom}px` }">{{ song.artist }}</p>
        <div class="tab-track-heading"><p>{{ track?.name }}</p><p>{{ tuning }}</p><p class="tab-tempo">♩ = {{ song?.measureHeaders[0]?.tempo }}</p></div>
      </div>
      <div v-if="notices.length" class="tab-notices"><p v-for="notice in notices" :key="notice" class="tab-notice">{{ notice }}</p></div>
      <div data-testid="score-surface" data-rendering="false" :data-layout-columns="layout?.columns.length">
        <svg v-if="layout" ref="drawing" :width="layout.width * zoom" :height="layout.height * zoom"
          :viewBox="`0 0 ${layout.width} ${layout.height}`" class="tab-drawing">
          <TabSystem v-for="system in visibleSystems" :key="system.index" :system :fret-size="layout.fretSize" />
          <g v-if="designMode" class="tab-design-overlay">
            <template v-for="system in visibleSystems" :key="system.index">
              <rect v-for="bar in system.measures" :key="bar.index" :x="bar.x" :y="system.top - 6" :width="bar.width" :height="system.bottom - system.top + 12"
                :class="['tab-design-bar', { selected: bar.index === designMeasure }]" :data-design-measure="bar.index" />
              <g v-for="(bar, index) in system.measures.slice(0, -1)" :key="bar.index"
                :data-resize-row="system.index" :data-resize-boundary="index" class="tab-design-handle" role="slider" tabindex="0"
                :aria-label="`Resize bars ${bar.index + 1} and ${bar.index + 2}`" :aria-valuenow="Math.round(bar.width)"
                :aria-valuemin="Math.ceil(bar.minWidth)" :aria-valuemax="Math.floor(bar.width + system.measures[index + 1].width - system.measures[index + 1].minWidth)"
                @keydown.stop="resizeKey($event, system.index, index)">
                <rect :x="bar.x + bar.width - 7" :y="system.top - 14" width="14" :height="system.bottom - system.top + 28" fill="transparent" />
                <line :x1="bar.x + bar.width" :x2="bar.x + bar.width" :y1="system.top - 10" :y2="system.bottom + 10" />
                <rect :x="bar.x + bar.width - 3" :y="system.top - 17" width="6" height="10" rx="2" />
              </g>
            </template>
          </g>
          <g class="tab-overlay" pointer-events="none">
            <rect v-for="(box, i) in selectionRects" :key="i" v-bind="rectAttrs(box)" rx="3" class="tab-range" data-testid="tab-selection-range" />
            <rect v-if="caret && !hasRange && !designMode" v-bind="rectAttrs(caret)" rx="2" class="tab-caret" data-testid="note-selection" />
            <line v-if="playhead" :x1="playhead.x" :x2="playhead.x" :y1="playhead.y" :y2="playhead.y + playhead.height" class="tab-playhead" />
          </g>
        </svg>
      </div>
      <p v-if="!layout?.columns.length" class="tab-notice">No editable columns in this voice. Use the comparison view to inspect this track.</p>
      <div v-if="marquee" class="tab-marquee" data-testid="tab-selection-marquee" aria-hidden="true"
        :style="{ left: `${marquee.x}px`, top: `${marquee.y}px`, width: `${marquee.w}px`, height: `${marquee.h}px` }" />
    </section>
  </div>
  </div>
</template>

<script setup lang="ts">
import { computed, markRaw, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue';
import { beatKey, cursorKey, selectedColumns, type EditorCursor } from '~~/shared/editor';
import { cellBounds, columnBounds, hitTestTab, layoutTab, playbackPosition, tabNotices, tuningLabel, TAB_PAPER_WIDTH, TAB_PAPER_INSET, type Rect, type TabLayout } from '~~/shared/tab-layout';
import { resolveTabKey } from '~~/shared/tab-commands';
import { absorbTabRow, breakTabRow, resizeTabBoundary } from '~~/shared/tab-design';
import { includeMarqueeColumns, tabCellSelectionRects, wrappedTabCells } from '~~/shared/tab-selection';
import type { TGTabLayout } from '~~/shared/model';

const { trackIndex, voiceIndex, mode, zoom, density, designMode = false } = defineProps<{
  trackIndex: number; voiceIndex: number; mode: 'wrap' | 'continuous'; zoom: number; density: number; designMode?: boolean;
}>();
const { editor, song, selection, fileName, loading, selectCursor, selectCells, enterDigit, navigate, runTabCommand, changeTabDesign, reportError } = useSong();
const { isPlaying, playbackTick } = usePlayback();
const { bindings } = useTabKeymap();
const viewport = useTemplateRef<HTMLDivElement>('viewport');
const surface = useTemplateRef<HTMLElement>('surface');
const drawing = useTemplateRef<SVGSVGElement>('drawing');
const height = ref(800), scrollTop = ref(0);
const marquee = ref<Rect | null>(null);
const draftDesign = ref<TGTabLayout>();
const designMeasure = ref(selection.value?.measure ?? 0);
const identities = computed(() => editor.value?.identities);
const track = computed(() => song.value?.tracks[trackIndex]);
const layout = computed(() => song.value && identities.value ? markRaw(layoutTab(song.value, trackIndex, voiceIndex, identities.value,
  { width: TAB_PAPER_WIDTH - TAB_PAPER_INSET * 2, mode, density, design: draftDesign.value })) : null);
const paperWidth = computed(() => Math.max(TAB_PAPER_WIDTH, (layout.value?.width ?? 0) + TAB_PAPER_INSET * 2));
const tuning = computed(() => {
  const pitches = track.value?.strings.map(s => s.value) ?? [];
  return pitches.join() === '64,59,55,50,45,40' ? 'Standard tuning' : pitches.map(tuningLabel).join(' · ');
});
const designRow = computed(() => layout.value?.systems.find(row => row.measures.some(bar => bar.index === designMeasure.value)));
const selectedBar = computed(() => designRow.value?.measures.find(bar => bar.index === designMeasure.value));
const canResize = computed(() => designRow.value && selectedBar.value !== designRow.value.measures.at(-1));
const canBreak = canResize;
const canAbsorb = computed(() => designRow.value && layout.value?.systems[designRow.value.index + 1]);
const notices = computed(() => song.value ? [...tabNotices(song.value, trackIndex, voiceIndex), ...layout.value?.issues ?? []] : []);
const visibleSystems = computed(() => layout.value?.systems.filter(s =>
  (s.y + s.height) * zoom >= scrollTop.value - 300 && s.y * zoom <= scrollTop.value + height.value + 300) ?? []);
const caret = computed(() => layout.value && selection.value ? cellBounds(layout.value, selection.value) : null);
const hasRange = computed(() => !!editor.value?.anchor || editor.value?.selectionMode === 'columns' ||
  editor.value?.cellSelection != null && editor.value.cellSelection.length !== 1);
const playhead = computed(() => isPlaying.value && layout.value ? playbackPosition(layout.value, playbackTick.value) : null);
const selectionRects = computed(() => {
  if (designMode) return [];
  const state = editor.value, view = layout.value;
  if (!state?.selection || !view || !hasRange.value) return [];
  if (state.cellSelection !== null) return tabCellSelectionRects(view, state.cellSelection, visibleSystems.value);
  const visible = new Set(visibleSystems.value.map(s => s.index));
  const first = Math.min(state.selection.string, state.anchor?.string ?? state.selection.string);
  const last = Math.max(state.selection.string, state.anchor?.string ?? state.selection.string);
  const boxes = new Map<number, Rect>();
  for (const address of selectedColumns(state)) {
    const found = view.byAddress.get(beatKey(address));
    if (!found || !visible.has(found.system.index)) continue;
    const cells = state.selectionMode === 'columns' ? [columnBounds(view, address)!]
      : found.system.strings.filter(s => s.number >= first && s.number <= last)
        .map(s => cellBounds(view, { ...address, string: s.number })!);
    for (const cell of cells) {
      const current = boxes.get(found.system.index);
      if (!current) boxes.set(found.system.index, { ...cell });
      else {
        const x = Math.min(current.x, cell.x), y = Math.min(current.y, cell.y);
        boxes.set(found.system.index, { x, y, w: Math.max(current.x + current.w, cell.x + cell.w) - x,
          h: Math.max(current.y + current.h, cell.y + cell.h) - y });
      }
    }
  }
  return [...boxes.values()];
});
const rectAttrs = (r: Rect) => ({ x: r.x, y: r.y, width: r.w, height: r.h });
let observer: ResizeObserver | undefined;
let dragFrame = 0;
let pointer = { x: 0, y: 0 };
let selectionDrag: {
  pointerId: number; start: { x: number; y: number }; origin: { x: number; y: number }; clientStart: { x: number; y: number };
  anchor: EditorCursor; preview?: string;
} | undefined;
let designDrag: { layout: TabLayout; row: number; boundary: number; startX: number; pointerId: number } | undefined;

function selectDesignBar(measure: number) {
  designMeasure.value = measure;
  if (selection.value?.measure === measure && selection.value.track === trackIndex) return;
  const column = layout.value?.systems.flatMap(row => row.measures).find(bar => bar.index === measure)?.columns[0];
  const string = selection.value?.track === trackIndex ? selection.value.string : track.value?.strings[0]?.number;
  if (column && string) selectCursor({ ...column.address, string });
}
function designAction(action: 'break' | 'absorb') {
  if (!layout.value || !designRow.value || loading.value) return;
  try { changeTabDesign(trackIndex, action === 'break' ? breakTabRow(layout.value, designMeasure.value) : absorbTabRow(layout.value, designRow.value.index)); }
  catch (e) { reportError(e); }
}
function resizeBoundary(row: number, boundary: number, delta: number) {
  if (!layout.value || loading.value) return;
  try { changeTabDesign(trackIndex, resizeTabBoundary(layout.value, row, boundary, delta)); }
  catch (e) { reportError(e); }
}
function resizeKey(event: KeyboardEvent, row: number, boundary: number) {
  if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
  event.preventDefault();
  const bar = layout.value?.systems[row]?.measures[boundary];
  if (bar) selectDesignBar(bar.index);
  resizeBoundary(row, boundary, (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 20 : 4));
}
function setBarWidth(event: Event) {
  const input = event.target as HTMLInputElement, width = Number(input.value);
  if (!selectedBar.value || !designRow.value || !input.value || !Number.isFinite(width)) return;
  resizeBoundary(designRow.value.index, designRow.value.measures.indexOf(selectedBar.value), width - selectedBar.value.width);
  input.value = String(Math.round(selectedBar.value.width));
}
function svgPoint(event: { clientX: number; clientY: number }) {
  const matrix = drawing.value?.getScreenCTM();
  return matrix ? new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse()) : null;
}
function documentPoint(event: { clientX: number; clientY: number }) {
  const box = surface.value?.getBoundingClientRect();
  return box ? { x: Math.max(0, Math.min(box.width, event.clientX - box.left)),
    y: Math.max(0, Math.min(box.height, event.clientY - box.top)) } : null;
}

function onScroll() {
  if (viewport.value && drawing.value) scrollTop.value = viewport.value.getBoundingClientRect().top - drawing.value.getBoundingClientRect().top;
}
function hit(event: { clientX: number; clientY: number }) {
  const point = svgPoint(event);
  return point && layout.value ? hitTestTab(layout.value, point.x, point.y) : null;
}
function pointerDown(event: PointerEvent) {
  if (event.button !== 0 || loading.value || selectionDrag || designDrag) return;
  if (designMode) {
    const point = svgPoint(event), target = event.target as Element;
    const handle = target.closest('[data-resize-boundary]');
    if (handle && point && layout.value) {
      const row = Number(handle.getAttribute('data-resize-row')), boundary = Number(handle.getAttribute('data-resize-boundary'));
      designDrag = { layout: layout.value, row, boundary, startX: point.x, pointerId: event.pointerId };
      selectDesignBar(layout.value.systems[row].measures[boundary].index);
      surface.value?.setPointerCapture(event.pointerId);
    } else {
      const bar = target.closest('[data-design-measure]');
      if (bar) selectDesignBar(Number(bar.getAttribute('data-design-measure')));
    }
    event.preventDefault(); surface.value?.focus({ preventScroll: true });
    return;
  }
  const target = hit(event), start = documentPoint(event), origin = svgPoint(event);
  if (!target || !start || !origin || !editor.value) return;
  event.preventDefault();
  surface.value?.focus({ preventScroll: true });
  pointer = { x: event.clientX, y: event.clientY };
  selectionDrag = { pointerId: event.pointerId, start, origin, clientStart: { ...pointer }, anchor: target.cursor };
  previewSelection(target.cursor);
  surface.value?.setPointerCapture(event.pointerId);
}
function pointerMove(event: PointerEvent) {
  if (designDrag) {
    if (event.pointerId !== designDrag.pointerId) return;
    const point = svgPoint(event);
    if (point) draftDesign.value = resizeTabBoundary(designDrag.layout, designDrag.row, designDrag.boundary, point.x - designDrag.startX);
    return;
  }
  if (!selectionDrag || event.pointerId !== selectionDrag.pointerId) return;
  pointer = { x: event.clientX, y: event.clientY };
  if (!marquee.value) {
    if (Math.hypot(pointer.x - selectionDrag.clientStart.x, pointer.y - selectionDrag.clientStart.y) < 4) {
      previewSelection(selectionDrag.anchor); return;
    }
    dragFrame = requestAnimationFrame(scrollDrag);
  }
  extendDrag();
}
function extendDrag() {
  const point = documentPoint({ clientX: pointer.x, clientY: pointer.y });
  if (!selectionDrag || !point) return;
  const start = selectionDrag.start;
  marquee.value = { x: Math.min(start.x, point.x), y: Math.min(start.y, point.y),
    w: Math.abs(start.x - point.x), h: Math.abs(start.y - point.y) };
  const target = hit({ clientX: pointer.x, clientY: pointer.y });
  if (target) previewSelection(target.cursor);
}
function previewSelection(focus: EditorCursor) {
  const drag = selectionDrag, view = layout.value;
  if (!drag || !view) return;
  const point = marquee.value && svgPoint({ clientX: pointer.x, clientY: pointer.y });
  const rectangle = point ? { x: Math.min(drag.origin.x, point.x), y: Math.min(drag.origin.y, point.y),
    w: Math.abs(drag.origin.x - point.x), h: Math.abs(drag.origin.y - point.y) } : null;
  // Crossing a fret's edge must refresh coverage even if the closest cell stays the same.
  const preview = `${cursorKey(focus)}:${rectangle && [rectangle.x, rectangle.y, rectangle.w, rectangle.h].join(':')}`;
  if (drag.preview === preview) return;
  drag.preview = preview;
  if (!marquee.value) { selectCursor(drag.anchor); return; }
  const wrapped = wrappedTabCells(view, drag.anchor, focus);
  selectCells(rectangle ? includeMarqueeColumns(view, wrapped, rectangle) : wrapped, focus);
}
function scrollDrag() {
  if (!selectionDrag || !marquee.value || !viewport.value) return;
  const box = viewport.value.getBoundingClientRect();
  const speed = (value: number, min: number, max: number) => value < min + 30 ? -12 : value > max - 30 ? 12 : 0;
  viewport.value.scrollBy(speed(pointer.x, box.left, box.right), speed(pointer.y, box.top, box.bottom));
  extendDrag();
  dragFrame = requestAnimationFrame(scrollDrag);
}
function pointerUp(event: PointerEvent) {
  if (event.pointerId !== (designDrag?.pointerId ?? selectionDrag?.pointerId)) return;
  pointerMove(event);
  const draft = designDrag ? draftDesign.value : undefined;
  cancelPointer(event);
  if (draft) changeTabDesign(trackIndex, draft);
}
function cancelPointer(event?: PointerEvent) {
  const activePointer = designDrag?.pointerId ?? selectionDrag?.pointerId;
  if (event && event.pointerId !== activePointer) return;
  designDrag = undefined; draftDesign.value = undefined; selectionDrag = undefined; marquee.value = null;
  cancelAnimationFrame(dragFrame);
  if (activePointer !== undefined && surface.value?.hasPointerCapture(activePointer)) surface.value.releasePointerCapture(activePointer);
}
function editKey(event: KeyboardEvent) {
  if (designMode) { if (event.key === 'Escape') cancelPointer(); return; }
  if (loading.value || (event.target as HTMLElement)?.closest('input, textarea, select, [contenteditable]')) return;
  const action = resolveTabKey(event, bindings.value);
  if (!action) return;
  event.preventDefault();
  event.stopPropagation();
  cancelPointer();
  if (action.kind === 'navigate') navigate(action.direction, action.extend);
  else if (action.kind === 'digit') { if (!event.repeat) enterDigit(action.digit); }
  else if (action.kind === 'command') { if (!event.repeat) runTabCommand(action.id); }
  else if (selection.value) selectCursor(selection.value);
}
watch(selection, async () => {
  await nextTick();
  if (selectionDrag || designMode || document.activeElement !== surface.value || !viewport.value) return;
  const matrix = drawing.value?.getScreenCTM(), cell = caret.value;
  if (!matrix || !cell) return;
  // A range hides the cell outline; its active end still drives keyboard scrolling.
  const from = new DOMPoint(cell.x, cell.y).matrixTransform(matrix);
  const to = new DOMPoint(cell.x + cell.w, cell.y + cell.h).matrixTransform(matrix);
  const target = { left: from.x, top: from.y, right: to.x, bottom: to.y };
  const box = viewport.value.getBoundingClientRect();
  const dx = target.left < box.left + 24 ? target.left - box.left - 24 : target.right > box.right - 24 ? target.right - box.right + 24 : 0;
  const dy = target.top < box.top + 24 ? target.top - box.top - 24 : target.bottom > box.bottom - 24 ? target.bottom - box.bottom + 24 : 0;
  viewport.value.scrollBy(dx, dy);
}, { flush: 'post' });
onMounted(() => {
  observer = new ResizeObserver(() => { if (viewport.value) { height.value = viewport.value.clientHeight; onScroll(); } });
  if (viewport.value) observer.observe(viewport.value);
});
watch([() => editor.value?.id, () => trackIndex, () => voiceIndex, () => mode, () => zoom, () => density, () => designMode], () => {
  cancelPointer(); designMeasure.value = selection.value?.measure ?? 0;
});
watch(() => editor.value?.song, () => cancelPointer());
watch([layout, () => zoom], async () => { await nextTick(); onScroll(); });
onBeforeUnmount(() => { observer?.disconnect(); cancelPointer(); });
</script>

<style>
.tab-editor-shell { height: 100%; min-height: 0; display: flex; flex-direction: column; }
.tab-workspace { --tab-paper: #fff; --tab-ink: #171717; flex: 1; min-height: 0; overflow: auto; padding: 28px 32px 48px; background: #45475054; color: var(--tab-ink); scrollbar-color: #85868d #303139; }
.tab-document { position: relative; box-sizing: border-box; margin: 0 auto; background: var(--tab-paper); box-shadow: 0 2px 12px #0003, 0 0 0 1px #0001; outline: none; touch-action: none; user-select: none; }
.tab-document:focus-visible .tab-caret { stroke-width: 2; }
.tab-heading { padding-top: 18em; padding-bottom: 12em; font-family: Georgia, 'Times New Roman', serif; }
.tab-heading h1 { font-size: 23em; font-weight: 600; line-height: 1.3; text-align: center; }
.tab-heading .tab-artist { font-size: 13em; line-height: 1.6; text-align: center; }
.tab-track-heading { margin-top: 26em; }
.tab-track-heading p { font-size: 12em; line-height: 1.6; }
.tab-track-heading .tab-tempo { margin-top: 6px; font-size: 15em; font-weight: bold; }
.tab-notices { border-left: 2px solid #d4d4d8; margin: 8px 40px 16px; }
.tab-notice { padding: 3px 10px; max-width: 72ch; font: 11px/1.5 system-ui, sans-serif; color: #71717a; }
.tab-drawing { display: block; touch-action: none; user-select: none; overflow: visible; }
.tab-string { stroke: #aaa; stroke-width: .65; }
.tab-barline { stroke: #333; stroke-width: .85; }
.tab-guide { stroke: transparent; }
.tab-fret { font-family: Arial, Helvetica, sans-serif; font-weight: 400; fill: var(--tab-ink); }
.tab-clef { font: 16px Arial, sans-serif; fill: var(--tab-ink); paint-order: stroke; stroke: white; stroke-width: 3px; }
.tab-time-signature { font: bold 22px Georgia, serif; fill: var(--tab-ink); paint-order: stroke; stroke: white; stroke-width: 4px; }
.tab-tuning { font-family: ui-monospace, Consolas, monospace; fill: #85858e; font-size: 10px; }
.tab-small { font-size: 10px; fill: #85858e; }
.tab-measure-number { font-family: Georgia, serif; font-size: 10px; fill: #777; }
.tab-rhythm { color: #27272a; fill: currentColor; }
.tab-tuplet-bracket { fill: none; stroke: currentColor; stroke-width: 1; }
.tab-tuplet-label { font-size: 11px; font-style: italic; }
.tab-technique-line { fill: none; stroke: #27272a; stroke-width: 1; stroke-linecap: round; stroke-linejoin: round; }
.tab-technique-label { font-family: Georgia, serif; font-size: 10px; font-weight: 400; fill: #171717; paint-order: stroke; stroke: var(--tab-paper); stroke-width: 3; stroke-linejoin: round; }
.tab-bend-label { font-size: 11px; }
.tab-caret { fill: #e5bc4b33; stroke: #957328; stroke-width: 1; }
.tab-range { fill: #0ea5e91a; stroke: #0ea5e944; stroke-width: 1; }
.tab-marquee { position: absolute; box-sizing: border-box; pointer-events: none; border: 1px solid #0284c7; background: #0ea5e910; }
.tab-playhead { stroke: #10b981; stroke-width: 2; }
.tab-design-tools { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding: 8px 16px; border-bottom: 1px solid #ffffff12; background: #18181b50; color: #e4e4e7; font-size: 11px; }
.tab-design-tools label { display: flex; align-items: center; gap: 6px; }
.tab-design-tools input { width: 64px; padding: 5px; background: #ffffff0a; border: 1px solid #ffffff20; border-radius: 4px; }
.tab-design-tools button { padding: 5px 8px; border: 1px solid #ffffff20; border-radius: 4px; cursor: pointer; }
.tab-design-tools button:hover:not(:disabled) { background: #ffffff15; }
.tab-design-tools :disabled { opacity: .35; cursor: default; }
.tab-design-tools :focus-visible { outline: 2px solid #38bdf8; outline-offset: 2px; }
.tab-design-label { font-weight: 600; min-width: 44px; }
.tab-design-hint { color: #a1a1aa; }
.tab-design-bar { fill: transparent; stroke: none; cursor: pointer; }
.tab-design-bar.selected { fill: #38bdf810; stroke: #0284c740; stroke-width: 1; }
.tab-design-handle { cursor: col-resize; outline: none; }
.tab-design-handle line { stroke: #0284c7; stroke-width: 1; opacity: .5; }
.tab-design-handle rect:last-child { fill: #0284c7; }
.tab-design-handle:hover line, .tab-design-handle:focus-visible line { opacity: 1; stroke-width: 3; }
</style>
