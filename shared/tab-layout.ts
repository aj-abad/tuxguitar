import { WHOLE_PRECISE_DURATION, type TGDuration, type TGNote, type TGSong } from "./model";
import { beatKey, durationPrecise, type BeatAddress, type EditorCursor } from "./score-edits";
import type { EditorIdentities } from "./editor-identities";
import { engraveRhythm, type TabBeam, type TabTuplet } from './tab-rhythm';
import { bendExtraWidth, engraveTechniques, noteText, resolveConnections, type TabTechnique } from './tab-techniques';

export interface Rect { x: number; y: number; w: number; h: number }
export interface TabNote { id: string; note: TGNote; y: number }
export interface TabColumn {
  id: string; address: BeatAddress; x: number; left: number; width: number; start: number; end: number;
  duration: TGDuration; notes: TabNote[]; beamGroup?: string; tupletGroup?: string;
  ordinal: number; annotation: string;
}
export interface TabMeasure { index: number; x: number; width: number; signature: string; columns: TabColumn[]; beams: TabBeam[]; tuplets: TabTuplet[] }
export interface TabSystem {
  index: number; y: number; height: number; top: number; bottom: number; rhythmY: number; width: number;
  strings: Array<{ number: number; label: string; y: number }>; measures: TabMeasure[]; columns: TabColumn[];
  techniques: TabTechnique[];
}
export interface TabLayout {
  width: number; height: number; systems: TabSystem[]; columns: TabColumn[];
  byAddress: Map<string, { column: TabColumn; system: TabSystem }>;
  stringSpacing: number; fretSize: number; issues: string[];
}
export interface TabLayoutOptions { width: number; mode: "wrap" | "continuous"; density: number; stringSpacing: number; fretSize: number }
export const TAB_LAYOUT_DEFAULTS: TabLayoutOptions = { width: 900, mode: "wrap", density: 1, stringSpacing: 26, fretSize: 16 };

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
  const left = 62;
  const newSystem = (): TabSystem => {
    const system: TabSystem = { index: systems.length, y: 0, top: 0, bottom: 0,
      rhythmY: 0, height: 0, width: left, measures: [], columns: [], techniques: [],
      strings: strings.map(s => ({ number: s.number, label: tuningLabel(s.value), y: 0 })) };
    systems.push(system);
    return system;
  };
  let system = newSystem();
  for (const [mi, measure] of track.measures.entries()) {
    const header = song.measureHeaders[mi];
    if (!header) continue;
    const active = measure.beats.map((beat, bi) => ({ beat, bi, voice: beat.voices[voiceIndex] })).filter(c => c.voice && !c.voice.empty);
    const noteWidths = active.map(({ voice }) => {
      let beats = 1;
      try { beats = durationPrecise(voice.duration) / (WHOLE_PRECISE_DURATION / 4); } catch { /* malformed source remains visible */ }
      const digits = Math.max(2, ...voice.notes.map(n => noteText(n).length));
      return Math.max(digits * config.fretSize * 0.62 + 22, 46 * Math.sqrt(beats)) * config.density;
    });
    const cellWidths = active.map(({ voice }, index) => noteWidths[index] + Math.max(0, ...voice.notes.map(bendExtraWidth)) * Math.max(.85, config.density));
    const naturalWidth = Math.max(148, cellWidths.reduce((sum, value) => sum + value, 0) + 42);
    if (config.mode === "wrap" && system.measures.length && (header.lineBreak || system.width + naturalWidth + 20 > width)) system = newSystem();
    const bar: TabMeasure = { index: mi, x: system.width, width: naturalWidth,
      signature: `${header.timeSignature.numerator}/${header.timeSignature.denominator}`, columns: [], beams: [], tuplets: [] };
    const available = naturalWidth - 42;
    const total = cellWidths.reduce((sum, value) => sum + value, 0) || 1;
    let x = bar.x + 24;
    active.forEach(({ beat, bi, voice }, ci) => {
      const address = { track: trackIndex, measure: mi, beat: bi, voice: voiceIndex };
      const columnWidth = available * cellWidths[ci] / total;
      let duration = WHOLE_PRECISE_DURATION / 4;
      try { duration = durationPrecise(voice.duration); } catch { /* keep the source visible */ }
      const column: TabColumn = { id: ids.columns[beatKey(address)] ?? beatKey(address), address,
        x: x + available * noteWidths[ci] / total / 2, left: x, width: columnWidth, start: beat.preciseStart, end: beat.preciseStart + duration,
        duration: voice.duration, ordinal: ci + 1, annotation: [beat.chord?.name, beat.text].filter(Boolean).join(" · "),
        notes: voice.notes.map((note, ni) => ({ id: ids.notes[`${beatKey(address)}:${ni}`] ?? `${beatKey(address)}:${ni}`, note,
          y: 0 })) };
      bar.columns.push(column); system.columns.push(column); columns.push(column);
      byAddress.set(beatKey(address), { column, system });
      x += columnWidth;
    });
    system.measures.push(bar);
    system.width += naturalWidth;
    engraveRhythm(bar, header);
  }
  const resolved = resolveConnections(columns);
  const legatoStrings = new Map<number, Set<number>>();
  for (const link of resolved.connections.filter(c => c.kind === 'hammer-on' || c.kind === 'pull-off')) {
    const from = byAddress.get(beatKey(link.source.column.address))!.system.index;
    const to = byAddress.get(beatKey(link.target.column.address))!.system.index;
    for (let index = from; index <= to; index++) {
      if (!legatoStrings.has(index)) legatoStrings.set(index, new Set());
      legatoStrings.get(index)!.add(link.source.item.note.string);
    }
  }
  let y = 0;
  for (const row of systems) {
    const bent = new Set(row.columns.flatMap(c => c.notes.filter(n => bendExtraWidth(n.note) > 0).map(n => n.note.string)));
    row.y = y;
    row.top = y + (bent.has(strings[0].number) ? 128 : 76);
    let stringY = row.top;
    row.strings.forEach((s, index) => {
      if (index) stringY += Math.max(config.stringSpacing, bent.has(s.number) ? 76 : legatoStrings.get(row.index)?.has(s.number) ? 36 : 0);
      s.y = stringY;
    });
    row.bottom = stringY;
    row.rhythmY = row.bottom + 64;
    row.height = row.rhythmY - row.y + 30;
    for (const c of row.columns) for (const item of c.notes) item.y = row.strings.find(s => s.number === item.note.string)?.y ?? row.top;
    y += row.height + 24;
  }
  const layout: TabLayout = { width: Math.max(width, ...systems.map(s => s.width + 24)), height: y - 8,
    systems, columns, byAddress, stringSpacing: config.stringSpacing, fretSize: config.fretSize, issues: resolved.issues };
  engraveTechniques(layout, resolved.connections);
  return layout;
}

export function cellBounds(layout: TabLayout, cursor: EditorCursor): Rect | null {
  const found = layout.byAddress.get(beatKey(cursor));
  const string = found?.system.strings.find(s => s.number === cursor.string);
  if (!found || !string) return null;
  const w = Math.max(26, layout.fretSize * 1.8);
  return { x: found.column.x - w / 2, y: string.y - layout.stringSpacing * .43, w, h: layout.stringSpacing * .86 };
}

export function columnBounds(layout: TabLayout, address: BeatAddress): Rect | null {
  const found = layout.byAddress.get(beatKey(address));
  return found ? { x: found.column.left, y: found.system.top - 18, w: found.column.width, h: found.system.bottom - found.system.top + 36 } : null;
}

export function hitTestTab(layout: TabLayout, x: number, y: number): { cursor: EditorCursor; kind: "cell" | "columns" } | null {
  const system = layout.systems.find(s => y >= s.y + 30 && y <= s.y + s.height);
  if (!system?.columns.length || !system.strings.length) return null;
  const bend = system.techniques.find(t => t.kind === 'bend' && x >= t.bounds.x && x <= t.bounds.x + t.bounds.w &&
    y >= t.bounds.y && y <= t.bounds.y + t.bounds.h && y < system.strings.find(s => s.number === t.cursor.string)!.y - layout.stringSpacing / 2);
  if (bend) return { cursor: { ...bend.cursor }, kind: 'cell' };
  const column = system.columns.find(c => x >= c.left && x < c.left + c.width);
  if (!column) return null;
  const string = system.strings.reduce((best, s) => Math.abs(s.y - y) < Math.abs(best.y - y) ? s : best);
  return { cursor: { ...column.address, string: string.number },
    kind: y < system.top - layout.stringSpacing / 2 || y > system.bottom + layout.stringSpacing / 2 ? "columns" : "cell" };
}

export function playbackPosition(layout: TabLayout, preciseTick: number): { x: number; y: number; height: number } | null {
  const column = layout.columns.find(c => preciseTick >= c.start && preciseTick < c.end);
  if (!column) return null;
  const { system } = layout.byAddress.get(beatKey(column.address))!;
  return { x: column.left + (preciseTick - column.start) / (column.end - column.start) * column.width,
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
  if (song.measureHeaders.some(h => h.repeatOpen || h.repeatClose || h.repeatAlternative)) notes.add("Repeat data is retained; repeat engraving is available in the comparison view.");
  return [...notes];
}
