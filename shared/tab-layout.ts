import { WHOLE_PRECISE_DURATION, type TGDuration, type TGNote, type TGSong, type TGTabLayout } from "./model";
import { beatKey, durationPrecise, type BeatAddress, type EditorCursor } from "./score-edits";
import type { EditorIdentities } from "./editor-identities";
import { engraveRhythm, type TabBeam, type TabTuplet } from './tab-rhythm';
import { bendExtraWidth, engraveTechniques, noteWidth, resolveConnections, type TabTechnique } from './tab-techniques';
import { engraveStructure, repeatSpacing, resolveEndings, structureHeight, type TabBarline, type TabEnding, type TabEndingSpan, type TabRepeatCount } from './tab-structure';
import { fitBarWidths } from './tab-design';

export interface Rect { x: number; y: number; w: number; h: number }
export interface TabNote { id: string; note: TGNote; y: number }
export interface TabColumn {
  id: string; address: BeatAddress; x: number; left: number; width: number; start: number; end: number;
  duration: TGDuration; notes: TabNote[]; beamGroup?: string; tupletGroup?: string;
  ordinal: number; annotation: string;
}
export interface TabMeasure {
  index: number; x: number; width: number; minWidth: number; signature: string; showSignature: boolean; columns: TabColumn[]; beams: TabBeam[]; tuplets: TabTuplet[];
  repeatOpen: boolean; repeatClose: number; ending?: TabEndingSpan;
}
export interface TabSystem {
  index: number; y: number; height: number; top: number; bottom: number; rhythmY: number; width: number;
  strings: Array<{ number: number; label: string; y: number }>; measures: TabMeasure[]; columns: TabColumn[];
  techniques: TabTechnique[]; barlines: TabBarline[]; endings: TabEnding[]; repeatCounts: TabRepeatCount[];
}
export interface TabLayout {
  width: number; height: number; systems: TabSystem[]; columns: TabColumn[];
  byAddress: Map<string, { column: TabColumn; system: TabSystem }>;
  stringSpacing: number; fretSize: number; issues: string[];
}
export interface TabLayoutOptions { width: number; mode: "wrap" | "continuous"; density: number; stringSpacing: number; fretSize: number; design?: TGTabLayout | null }
export const TAB_PAPER_WIDTH = 860, TAB_PAPER_INSET = 32, TAB_STAFF_LEFT = 40;
export const TAB_LAYOUT_DEFAULTS: TabLayoutOptions = { width: TAB_PAPER_WIDTH - TAB_PAPER_INSET * 2, mode: "wrap", density: 1, stringSpacing: 18, fretSize: 13 };

/** Short intervals keep their engraving minimum. Reducing the scale takes space
 * from long durations first, until every interval reaches its readable floor. */
export function fitTimeSpacing(durations: number[], minimum: number[], available: number): number[] {
  if (!durations.length) return [];
  const floor = minimum.reduce((sum, width) => sum + width, 0);
  if (available <= floor) return [...minimum];
  let low = 0, high = available / Math.min(...durations);
  for (let step = 0; step < 50; step++) {
    const scale = (low + high) / 2;
    if (durations.reduce((sum, duration, i) => sum + Math.max(minimum[i], duration * scale), 0) > available) high = scale;
    else low = scale;
  }
  return durations.map((duration, i) => Math.max(minimum[i], duration * low));
}

export function tuningLabel(pitch: number): string {
  return ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"][pitch % 12] + (Math.floor(pitch / 12) - 1);
}

/** Pure geometry: drawing, pointer hit testing and the caret share these bounds. */
export function layoutTab(song: TGSong, trackIndex: number, voiceIndex: number, ids: EditorIdentities, options: Partial<TabLayoutOptions> = {}): TabLayout {
  const config = { ...TAB_LAYOUT_DEFAULTS, ...options };
  const width = Math.max(240, config.width);
  const track = song.tracks[trackIndex];
  const strings = [...track.strings].sort((a, b) => a.number - b.number);
  const systems: TabSystem[] = [];
  const columns: TabColumn[] = [];
  const byAddress: TabLayout['byAddress'] = new Map();
  if (!strings.length) return { width, height: 100, systems, columns, byAddress, stringSpacing: config.stringSpacing, fretSize: config.fretSize, issues: [] };
  const endings = new Map<number, TabEndingSpan>();
  for (const span of resolveEndings(song.measureHeaders)) for (let index = span.start; index <= span.end; index++) endings.set(index, span);
  const left = TAB_STAFF_LEFT, rowWidth = width - left - 20;
  const issues: string[] = [];
  const newSystem = (): TabSystem => {
    const system: TabSystem = { index: systems.length, y: 0, top: 0, bottom: 0,
      rhythmY: 0, height: 0, width: left, measures: [], columns: [], techniques: [], barlines: [], endings: [], repeatCounts: [],
      strings: strings.map(s => ({ number: s.number, label: tuningLabel(s.value), y: 0 })) };
    systems.push(system);
    return system;
  };
  const metrics = track.measures.map((measure, mi) => {
    const header = song.measureHeaders[mi];
    const active = measure.beats.map((beat, bi) => ({ beat, bi, voice: beat.voices[voiceIndex] })).filter(c => c.voice && !c.voice.empty);
    const durations = active.map(({ voice }) => {
      try { return durationPrecise(voice.duration) / (WHOLE_PRECISE_DURATION / 4); } catch { return 1; }
    });
    const noteWidths = active.map(({ voice }) => Math.max(22, ...voice.notes.map(note => noteWidth(note, config.fretSize))) + 6);
    const minimum = active.map(({ voice }, index) => noteWidths[index] + Math.max(0, ...voice.notes.map(bendExtraWidth)));
    const ending = endings.get(mi), spacing = repeatSpacing(header, ending);
    const previous = song.measureHeaders[mi - 1];
    const showSignature = !previous || previous.timeSignature.numerator !== header.timeSignature.numerator || previous.timeSignature.denominator !== header.timeSignature.denominator;
    if (showSignature) spacing.left += 24;
    // Reserve the TAB clef on any potential row start. Keeping this in the
    // measure minimum means an explicit break never puts a fret under it.
    spacing.left += 24;
    const minWidth = Math.max(spacing.minWidth, minimum.reduce((sum, value) => sum + value, 0) + spacing.left + spacing.right);
    // Dense passages establish a faster spatial pulse for this bar. Cap long
    // gaps, then fit the bar to the page without squeezing any glyphs.
    const pulse = Math.min(240, Math.max(54, 32 / Math.min(1, ...durations))) * config.density;
    const natural = durations.reduce((sum, duration, i) => sum + Math.max(minimum[i], duration * pulse), 0) + spacing.left + spacing.right;
    return { mi, header, active, durations, noteWidths, minimum, ending, spacing, showSignature, minWidth,
      naturalWidth: Math.max(minWidth, config.mode === 'wrap' ? Math.min(rowWidth, natural) : natural) };
  });
  const design = config.design === undefined ? track.tabLayout : config.design;
  let rows: Array<Array<{ metric: typeof metrics[number]; width: number }>> = [];
  if (design && config.mode === 'wrap') {
    let index = 0;
    rows = design.rows.map(row => row.map(requested => {
      const metric = metrics[index++];
      if (requested < metric.minWidth - .01) issues.push(`Bar ${metric.mi + 1} needs more room for its notation. Its row is kept; widen the bar or move a bar to another row.`);
      return { metric, width: Math.max(requested, metric.minWidth) };
    }));
  } else {
    let row: typeof rows[number] = [], used = 0;
    for (const metric of metrics) {
      if (config.mode === 'wrap' && row.length && (metric.header.lineBreak || used + metric.naturalWidth > rowWidth)) {
        rows.push(row); row = []; used = 0;
      }
      row.push({ metric, width: metric.naturalWidth }); used += metric.naturalWidth;
    }
    if (row.length) rows.push(row);
    if (config.mode === 'wrap') rows.forEach(row => {
      const widths = fitBarWidths(row.map(bar => bar.width), row.map(bar => bar.metric.minWidth), Math.max(rowWidth, row.reduce((sum, bar) => sum + bar.width, 0)));
      row.forEach((bar, i) => { bar.width = widths[i]; });
    });
  }
  for (const row of rows) {
    const system = newSystem();
    for (const { metric, width: barWidth } of row) {
      const { mi, header, active, durations, noteWidths, minimum, ending, spacing, showSignature, minWidth } = metric;
      const bar: TabMeasure = { index: mi, x: system.width, width: barWidth, minWidth, showSignature,
        repeatOpen: header.repeatOpen, repeatClose: header.repeatClose, ending,
        signature: `${header.timeSignature.numerator}/${header.timeSignature.denominator}`, columns: [], beams: [], tuplets: [] };
      const cellWidths = fitTimeSpacing(durations, minimum, barWidth - spacing.left - spacing.right);
      let x = bar.x + spacing.left;
      active.forEach(({ beat, bi, voice }, ci) => {
        const address = { track: trackIndex, measure: mi, beat: bi, voice: voiceIndex };
        const columnWidth = cellWidths[ci];
        let duration = WHOLE_PRECISE_DURATION / 4;
        try { duration = durationPrecise(voice.duration); } catch { /* keep the source visible */ }
        const column: TabColumn = { id: ids.columns[beatKey(address)] ?? beatKey(address), address,
          x: x + noteWidths[ci] / 2, left: x, width: columnWidth, start: beat.preciseStart, end: beat.preciseStart + duration,
          duration: voice.duration, ordinal: ci + 1, annotation: [beat.chord?.name, beat.text].filter(Boolean).join(" · "),
          notes: voice.notes.map((note, ni) => ({ id: ids.notes[`${beatKey(address)}:${ni}`] ?? `${beatKey(address)}:${ni}`, note, y: 0 })) };
        bar.columns.push(column); system.columns.push(column); columns.push(column);
        byAddress.set(beatKey(address), { column, system });
        x += columnWidth;
      });
      system.measures.push(bar);
      system.width += barWidth;
      engraveRhythm(bar, header);
    }
  }
  const resolved = resolveConnections(columns);
  let y = 0;
  for (const row of systems) {
    const bent = new Set(row.columns.flatMap(c => c.notes.filter(n => bendExtraWidth(n.note) > 0).map(n => n.note.string)));
    row.y = y;
    row.top = y + (bent.has(strings[0].number) ? 76 : 56) + structureHeight(row.measures);
    let stringY = row.top;
    row.strings.forEach((s, index) => {
      if (index) stringY += config.stringSpacing;
      s.y = stringY;
    });
    row.bottom = stringY;
    row.rhythmY = row.bottom + 52;
    row.height = row.rhythmY - row.y + 30;
    for (const c of row.columns) for (const item of c.notes) item.y = row.strings.find(s => s.number === item.note.string)?.y ?? row.top;
    engraveStructure(row, config.stringSpacing);
    y += row.height + 24;
  }
  const layout: TabLayout = { width: Math.max(width, ...systems.map(s => s.width + 20)), height: Math.max(100, y - 8),
    systems, columns, byAddress, stringSpacing: config.stringSpacing, fretSize: config.fretSize, issues: [...issues, ...resolved.issues] };
  engraveTechniques(layout, resolved.connections);
  return layout;
}

export function cellBounds(layout: TabLayout, cursor: EditorCursor): Rect | null {
  const found = layout.byAddress.get(beatKey(cursor));
  const string = found?.system.strings.find(s => s.number === cursor.string);
  if (!found || !string) return null;
  const note = found.column.notes.find(item => item.note.string === cursor.string)?.note;
  const w = Math.max(26, layout.fretSize * 1.8, note ? noteWidth(note, layout.fretSize) : 0);
  return { x: found.column.x - w / 2, y: string.y - layout.stringSpacing * .43, w, h: layout.stringSpacing * .86 };
}

export function columnBounds(layout: TabLayout, address: BeatAddress): Rect | null {
  const found = layout.byAddress.get(beatKey(address));
  return found ? { x: found.column.left, y: found.system.top - 18, w: found.column.width, h: found.system.bottom - found.system.top + 36 } : null;
}

export function hitTestTab(layout: TabLayout, x: number, y: number): { cursor: EditorCursor; kind: 'cell' } | null {
  let system: TabSystem | undefined, distance = Infinity;
  for (const candidate of layout.systems) {
    if (!candidate.columns.length || !candidate.strings.length) continue;
    const verticalDistance = Math.max(candidate.top - y, 0, y - candidate.bottom);
    if (verticalDistance < distance) { system = candidate; distance = verticalDistance; }
  }
  if (!system) return null;
  const bend = system.techniques.find(t => t.kind === 'bend' && x >= t.bounds.x && x <= t.bounds.x + t.bounds.w &&
    y >= t.bounds.y && y <= t.bounds.y + t.bounds.h && y < system.strings.find(s => s.number === t.cursor.string)!.y - layout.stringSpacing / 2);
  if (bend) return { cursor: { ...bend.cursor }, kind: 'cell' };
  // Stay on the nearest row, then compare note centers rather than duration-sized slots.
  const column = system.columns.reduce((best, c) => Math.abs(c.x - x) < Math.abs(best.x - x) ? c : best);
  const string = system.strings.reduce((best, s) => Math.abs(s.y - y) < Math.abs(best.y - y) ? s : best);
  return { cursor: { ...column.address, string: string.number }, kind: 'cell' };
}

export function playbackPosition(layout: TabLayout, preciseTick: number): { x: number; y: number; height: number } | null {
  const column = layout.columns.find(c => preciseTick >= c.start && preciseTick < c.end);
  if (!column) return null;
  const { system } = layout.byAddress.get(beatKey(column.address))!;
  const index = system.columns.indexOf(column), next = system.columns[index + 1];
  const endX = next && next.start === column.end ? next.x : column.left + column.width;
  return { x: column.x + (preciseTick - column.start) / (column.end - column.start) * (endX - column.x),
    y: system.top - 18, height: system.bottom - system.top + 36 };
}

export function tabNotices(song: TGSong, track: number, voice: number): string[] {
  const notes = new Set<string>();
  for (const measure of song.tracks[track].measures) for (const beat of measure.beats) {
    if (beat.voices.some((v, i) => i !== voice && !v.empty)) notes.add(`Showing voice ${voice + 1}; other voices are retained.`);
    for (const note of beat.voices[voice]?.notes ?? []) {
      if (Object.entries(note.effect).some(([key, value]) => !['deadNote', 'bend', 'hammer', 'slide'].includes(key) && !!value)) {
        notes.add("Some technique markings are not drawn yet; their data is retained.");
      }
    }
  }
  return [...notes];
}
