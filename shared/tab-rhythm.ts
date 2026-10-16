import { PRECISE_FACTOR, WHOLE_PRECISE_DURATION, type TGMeasureHeader } from './model';
import type { TabColumn, TabMeasure } from './tab-layout';

export interface TabBeam { id: string; level: number; x1: number; x2: number; hook: boolean; columnIds: string[] }
export interface TabTuplet { id: string; x1: number; x2: number; label: string; bracket: boolean; columnIds: string[] }
export const RHYTHM_STEM_X = 4.5;
export const RHYTHM_STEM_HEIGHT = 25;
export const BEAM_GAP = 5;
export const BEAM_THICKNESS = 3;
const WHOLE = WHOLE_PRECISE_DURATION;
export const beamCount = (value: number) => Math.max(0, Math.min(4, Math.floor(Math.log2(value)) - 2));
const ratio = (c: TabColumn) => c.duration.division ?? { enters: 1, times: 1 };
const isTuplet = (c: TabColumn) => ratio(c).enters !== ratio(c).times;

/** Conservative metrical groups, in denominator units. Odd meters use 2+...+3. */
export function beatGroups(numerator: number, denominator: number): number[] {
  if (numerator > 3 && numerator % 3 === 0) return Array(numerator / 3).fill(3);
  if (denominator < 8) return Array(numerator).fill(1);
  const groups: number[] = [];
  for (let left = numerator; left > 0;) {
    const size = left === 3 ? 3 : Math.min(2, left);
    groups.push(size); left -= size;
  }
  return groups;
}

/** The TG format stores a ratio per duration, without explicit tuplet-group IDs. */
function tuplets(columns: TabColumn[]): TabTuplet[] {
  const groups: TabTuplet[] = [];
  for (let i = 0; i < columns.length;) {
    if (!isTuplet(columns[i])) { i++; continue; }
    const first = columns[i], r = ratio(first);
    const run = [first];
    for (i++; i < columns.length; i++) {
      const c = columns[i], next = ratio(c);
      if (next.enters !== r.enters || next.times !== r.times || c.start !== run.at(-1)!.end) break;
      run.push(c);
    }
    // Mixed written values share the shortest value as the group's base unit.
    const span = WHOLE / Math.max(...run.map(c => c.duration.value)) * r.times;
    let part: TabColumn[] = [];
    const finish = () => {
      if (!part.length) return;
      const id = `${part[0].id}:tuplet`;
      part.forEach(c => { c.tupletGroup = id; });
      const simple = [[2, 3], [3, 2], [4, 3], [5, 4], [6, 4], [7, 4], [9, 8]].some(([a, b]) => r.enters === a && r.times === b);
      groups.push({ id, x1: part[0].x - 7, x2: part.at(-1)!.x + 9, label: simple ? String(r.enters) : `${r.enters}:${r.times}`,
        bracket: true, columnIds: part.map(c => c.id) });
      part = [];
    };
    for (const c of run) {
      if (part.length && c.end > part[0].start + span) finish();
      part.push(c);
      if (c.end >= part[0].start + span) finish();
    }
    finish();
  }
  return groups;
}

/** Add beams after horizontal layout, without changing musical data or onsets. */
export function engraveRhythm(bar: TabMeasure, header: TGMeasureHeader): void {
  bar.tuplets = tuplets(bar.columns);
  const start = header.start * PRECISE_FACTOR;
  const unit = WHOLE / header.timeSignature.denominator;
  let offset = 0;
  const pulses = beatGroups(header.timeSignature.numerator, header.timeSignature.denominator).map(count => {
    const pulse = { start: start + offset, end: start + offset + count * unit, count };
    offset += count * unit;
    return pulse;
  });
  const pulseFor = (c: TabColumn) => pulses.findIndex(p => c.start >= p.start && c.start < p.end && c.end <= p.end);
  const groups: TabColumn[][] = [];
  let current: TabColumn[] = [];
  for (const c of bar.columns) {
    const previous = current.at(-1);
    const key = c.tupletGroup ?? `pulse:${pulseFor(c)}`;
    const previousKey = previous?.tupletGroup ?? (previous ? `pulse:${pulseFor(previous)}` : '');
    const eligible = c.notes.length > 0 && beamCount(c.duration.value) > 0 && (c.tupletGroup || pulseFor(c) >= 0);
    if (!eligible || previous && (c.start !== previous.end || key !== previousKey)) {
      if (current.length) groups.push(current);
      current = [];
    }
    if (eligible) current.push(c);
  }
  if (current.length) groups.push(current);
  for (const group of groups.filter(g => g.length > 1)) {
    const groupId = `${group[0].id}:beam`;
    group.forEach(c => { c.beamGroup = groupId; });
    const pulse = pulses[pulseFor(group[0])];
    const secondaryUnit = pulse?.count === 3 ? unit : Math.min(WHOLE / 4, pulse ? pulse.end - pulse.start : WHOLE / 4);
    for (let level = 1; level <= Math.max(...group.map(c => beamCount(c.duration.value))); level++) {
      let run: TabColumn[] = [];
      const finish = () => {
        if (!run.length) return;
        const first = run[0], last = run.at(-1)!;
        let x1 = first.x + RHYTHM_STEM_X, x2 = last.x + RHYTHM_STEM_X;
        if (run.length === 1) {
          const index = group.indexOf(first);
          const r = ratio(first), subdivision = WHOLE / 2 ** (level + 1) * r.times / r.enters;
          const onSubdivision = Math.abs((first.start - group[0].start) % subdivision) < 1;
          const direction = index === 0 ? 1 : index === group.length - 1 ? -1 : onSubdivision ? 1 : -1;
          const neighbor = group[index + direction];
          x2 += direction * Math.min(11, Math.abs(neighbor.x - first.x) * .4);
        }
        bar.beams.push({ id: `${groupId}:${level}:${first.id}`, level, x1: Math.min(x1, x2), x2: Math.max(x1, x2),
          hook: run.length === 1, columnIds: run.map(c => c.id) });
        run = [];
      };
      for (const c of group) {
        const subdivision = secondaryUnit / 2 ** Math.max(0, level - 2);
        const split = level > 1 && !c.tupletGroup && run.length &&
          Math.floor((c.start - start) / subdivision) !== Math.floor((run[0].start - start) / subdivision);
        if (beamCount(c.duration.value) < level || split) finish();
        if (beamCount(c.duration.value) >= level) run.push(c);
      }
      finish();
    }
  }
  for (const tuplet of bar.tuplets) {
    const members = bar.columns.filter(c => c.tupletGroup === tuplet.id);
    tuplet.bracket = !members[0]?.beamGroup || members.some(c => c.beamGroup !== members[0].beamGroup);
  }
}
