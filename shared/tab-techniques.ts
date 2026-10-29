import type { TGEffectPoints, TGNote } from './model';
import { beatKey, type EditorCursor } from './score-edits';
import type { Rect, TabColumn, TabLayout, TabNote, TabSystem } from './tab-layout';

export type TechniqueKind = 'tie' | 'slide' | 'hammer-on' | 'pull-off' | 'bend';
export interface TabTechnique {
  id: string; kind: TechniqueKind; sourceId: string; targetId?: string; title: string;
  continuation: 'none' | 'start' | 'middle' | 'end'; cursor: EditorCursor; bounds: Rect;
  paths: Array<{ d: string; kind: 'curve' | 'hold' | 'arrow' }>;
  labels: Array<{ x: number; y: number; text: string }>;
}
interface NoteRef { column: TabColumn; item: TabNote }
export interface TabConnection { kind: Exclude<TechniqueKind, 'bend'>; source: NoteRef; target: NoteRef }
interface BendSegment { from: { position: number; value: number }; to: { position: number; value: number }; direction: number }

export function noteText(note: TGNote): string {
  const value = note.effect.deadNote ? '×' : String(note.value);
  return note.tiedNote ? `(${value})` : value;
}
export const noteWidth = (note: TGNote, size: number) => Math.max(size, noteText(note).length * size * .62) + 8;

// TG's stored bend amplitudes are quarter tones: 4 is a full-tone bend.
// See TGNoteImpl.paintBend's amplitude table; positions span 0..12.
export function bendAmount(value: number): string {
  if (value === 4) return 'full';
  const whole = Math.floor(value / 4), fraction = ['', '¼', '½', '¾'][value % 4];
  return `${whole || ''}${fraction}` || '0';
}
export function bendProfile(bend: TGEffectPoints): { start: number; segments: BendSegment[] } | null {
  if (!bend.points.length || bend.points.some(p => !Number.isFinite(p.position) || p.position < 0 || p.position > 12 ||
    !Number.isInteger(p.value) || p.value < 0 || p.value > 12)) return null;
  const points = bend.points.map(p => ({ ...p })).sort((a, b) => a.position - b.position);
  if (points[0].position > 0) points.unshift({ position: 0, value: points[0].value });
  if (points.at(-1)!.position < 12) points.push({ position: 12, value: points.at(-1)!.value });
  const segments: BendSegment[] = [];
  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1], to = points[i];
    if (from.position === to.position && from.value === to.value) continue;
    const direction = Math.sign(to.value - from.value);
    const previous = segments.at(-1);
    if (previous?.direction === direction) previous.to = to;
    else segments.push({ from, to, direction });
  }
  return { start: points[0].value, segments };
}
export function bendExtraWidth(note: TGNote): number {
  const profile = note.effect.bend && bendProfile(note.effect.bend);
  return profile ? Math.max(52, profile.segments.length * 30 + 16) : 0;
}

/** Resolve within one track/voice. Explicit rests and timing gaps break connections. */
export function resolveConnections(columns: TabColumn[]): { connections: TabConnection[]; issues: string[] } {
  const previous = new Map<number, NoteRef>();
  const connections: TabConnection[] = [], origins = new Set<string>(), resolved = new Set<string>();
  let lastEnd: number | undefined, missing = false;
  for (const column of columns) {
    if (lastEnd !== undefined && column.start !== lastEnd || !column.notes.length) previous.clear();
    lastEnd = column.end;
    for (const item of column.notes) {
      const source = previous.get(item.note.string), target = { column, item };
      if (item.note.effect.hammer || item.note.effect.slide) origins.add(item.id);
      if (item.note.tiedNote) {
        if (source && source.item.note.value === item.note.value && !source.item.note.effect.deadNote && !item.note.effect.deadNote) {
          connections.push({ kind: 'tie', source, target });
        } else missing = true;
      } else if (source && !source.item.note.effect.deadNote && !item.note.effect.deadNote) {
        const effect = source.item.note.effect;
        if ((effect.slide || effect.hammer) && source.item.note.value !== item.note.value) {
          connections.push({ kind: effect.slide ? 'slide' : source.item.note.value < item.note.value ? 'hammer-on' : 'pull-off', source, target });
          resolved.add(source.item.id);
          if (effect.slide && effect.hammer) missing = true;
        }
      }
      previous.set(item.note.string, target);
    }
  }
  return { connections, issues: missing || [...origins].some(id => !resolved.has(id))
    ? ['Some technique connections have no compatible destination on the same string. Their data is retained.'] : [] };
}

function connectionSegments(layout: TabLayout, link: TabConnection): void {
  const sourceSystem = layout.byAddress.get(beatKey(link.source.column.address))!.system;
  const targetSystem = layout.byAddress.get(beatKey(link.target.column.address))!.system;
  const string = link.source.item.note.string;
  for (let index = sourceSystem.index; index <= targetSystem.index; index++) {
    const system = layout.systems[index];
    const fromPrevious = index !== sourceSystem.index, toNext = index !== targetSystem.index;
    // Anchor beside the painted digits, not the wider paper masks behind them.
    const inset = (note: TGNote) => noteText(note).length * layout.fretSize * .62 / 2 + 3;
    const x1 = fromPrevious ? system.measures[0].x + 4 : link.source.column.x + inset(link.source.item.note);
    const x2 = toNext ? system.width - 4 : link.target.column.x - inset(link.target.item.note);
    const y = system.strings.find(s => s.number === string)!.y;
    const label = link.kind === 'hammer-on' ? 'H' : link.kind === 'pull-off' ? 'P' : '';
    const paths: TabTechnique['paths'] = [];
    if (link.kind === 'slide') {
      const direction = Math.sign(link.target.item.note.value - link.source.item.note.value);
      paths.push({ kind: 'curve', d: `M ${x1} ${y + direction * 5} L ${x2} ${y - direction * 5}` });
    } else {
      const direction = link.kind === 'tie' ? 1 : -1;
      const y1 = y + direction * (fromPrevious ? 10 : 2), y2 = y + direction * (toNext ? 10 : 2);
      const height = direction * Math.min(layout.stringSpacing * .55, (x2 - x1) * .35 + 5);
      paths.push({ kind: 'curve', d: `M ${x1} ${y1} C ${x1 + (x2 - x1) * .25} ${y + height} ${x2 - (x2 - x1) * .25} ${y + height} ${x2} ${y2}` });
    }
    const anchor = fromPrevious ? link.target : link.source;
    system.techniques.push({ id: `${link.source.item.id}:${link.target.item.id}:${link.kind}:${index}`, kind: link.kind,
      sourceId: link.source.item.id, targetId: link.target.item.id,
      title: link.kind === 'tie' ? 'Tie — sustain without picking again' : `${link.kind === 'hammer-on' ? 'Hammer-on' : link.kind === 'pull-off' ? 'Pull-off' : 'Slide'} ${link.source.item.note.value} → ${link.target.item.note.value}`,
      continuation: fromPrevious ? toNext ? 'middle' : 'end' : toNext ? 'start' : 'none',
      cursor: { ...anchor.column.address, string }, paths,
      bounds: { x: x1, y: y - (label ? 27 : 7), w: Math.max(0, x2 - x1), h: label ? 29 : link.kind === 'tie' ? 24 : 14 },
      labels: label ? [{ x: (x1 + x2) / 2, y: system.top - 12, text: label }] : [] });
  }
}

function bendGlyph(layout: TabLayout, column: TabColumn, item: TabNote, system: TabSystem): boolean {
  const profile = bendProfile(item.note.effect.bend!);
  if (!profile) return false;
  if (!profile.start && profile.segments.every(s => !s.from.value && !s.to.value)) return true;
  const amount = Math.max(profile.start, ...profile.segments.map(s => s.to.value));
  // Fit the gesture between evenly spaced strings; the label carries its pitch.
  const rise = Math.max(10, Math.min(22, layout.stringSpacing - 10));
  const yAt = (value: number) => item.y - (value ? 6 + value / amount * (rise - 6) : 2);
  // Keep pre-bend labels past every fret in a chord, including wider tied frets.
  let x = column.x + Math.max(...column.notes.map(n => noteWidth(n.note, layout.fretSize))) / 2 + 10;
  const endX = column.left + column.width - 10, startX = x;
  const paths: TabTechnique['paths'] = [], labels: TabTechnique['labels'] = [];
  const arrow = (x: number, y: number, direction: number) => {
    paths.push({ kind: 'arrow', d: `M ${x - 3} ${y + direction * 4} L ${x} ${y} L ${x + 3} ${y + direction * 4}` });
  };
  if (profile.start > 0) {
    paths.push({ kind: 'curve', d: `M ${x} ${yAt(0)} L ${x} ${yAt(profile.start)}` });
    arrow(x, yAt(profile.start), 1);
    labels.push({ x, y: yAt(profile.start) - 7, text: bendAmount(profile.start) });
  }
  const minimum = Math.min(24, (endX - x) / Math.max(1, profile.segments.length));
  const extra = Math.max(0, endX - x - minimum * profile.segments.length);
  for (const segment of profile.segments) {
    const nextX = x + minimum + extra * (segment.to.position - segment.from.position) / 12;
    const y1 = yAt(segment.from.value), y2 = yAt(segment.to.value);
    if (segment.direction) {
      paths.push({ kind: 'curve', d: `M ${x} ${y1} C ${x + (nextX - x) * .65} ${y1} ${nextX} ${y1} ${nextX} ${y2}` });
      arrow(nextX, y2, segment.direction);
      if (segment.to.value) labels.push({ x: nextX, y: y2 - 7, text: bendAmount(segment.to.value) });
    } else if (segment.to.value) paths.push({ kind: 'hold', d: `M ${x} ${y1} L ${nextX} ${y2}` });
    x = nextX;
  }
  system.techniques.push({ id: `${item.id}:bend`, kind: 'bend', sourceId: item.id,
    title: `${profile.start ? 'Pre-bend' : 'Bend'} ${bendAmount(amount)}${profile.segments.some(s => s.direction < 0) ? ' and release' : ''}`,
    continuation: 'none', cursor: { ...column.address, string: item.note.string },
    paths, labels, bounds: { x: startX - 8, y: yAt(amount) - 19, w: endX - startX + 20, h: item.y - yAt(amount) + 20 } });
  return true;
}

export function engraveTechniques(layout: TabLayout, connections: TabConnection[]): void {
  for (const link of connections) connectionSegments(layout, link);
  let invalid = false;
  for (const system of layout.systems) for (const column of system.columns) for (const item of column.notes) {
    if (item.note.effect.bend && !bendGlyph(layout, column, item, system)) invalid = true;
  }
  if (invalid) layout.issues.push('Some bends have invalid points and could not be drawn. Their data is retained.');
}
