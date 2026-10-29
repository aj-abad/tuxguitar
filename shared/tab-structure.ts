import type { TGMeasureHeader } from './model';
import type { Rect, TabMeasure, TabSystem } from './tab-layout';

export interface TabEndingSpan {
  start: number; end: number; mask: number; label: string; closed: boolean;
}
export interface TabBarline {
  id: string; kind: 'single' | 'repeat-start' | 'repeat-end' | 'repeat-both'; x: number;
  top: number; bottom: number; lines: Array<{ x: number; width: number }>;
  dots: Array<{ x: number; y: number }>; bounds: Rect;
}
export interface TabEnding {
  id: string; startMeasure: number; endMeasure: number; label: string;
  continuation: 'none' | 'start' | 'middle' | 'end'; leftHook: boolean; rightHook: boolean;
  x1: number; x2: number; y: number; height: number; labelX: number; labelY: number;
}
export interface TabRepeatCount { measure: number; text: string; title: string; x: number; y: number }

const ENDING_HEIGHT = 18, ENDING_SPACE = 32, COUNT_SPACE = 24;
const labelWidth = (text: string) => text.length * 12 * .62;

/** TG stores ending starts, not explicit end positions. A repeat close ends the
 * current ending; a new ending/repeat start or the song end bounds an open one.
 * See the legacy MidiRepeatController and altRepeatLoop_20.tg fixture. */
export function resolveEndings(headers: TGMeasureHeader[]): TabEndingSpan[] {
  const spans: TabEndingSpan[] = [];
  let active: TabEndingSpan | undefined;
  headers.forEach((header, index) => {
    if (active && (header.repeatOpen || header.repeatAlternative && header.repeatAlternative !== active.mask)) active = undefined;
    if (!active && header.repeatAlternative > 0) {
      // TG has eight ending bits. Arithmetic also handles unsigned masks cleanly.
      const numbers = Array.from({ length: 8 }, (_, bit) => bit + 1)
        .filter(number => Math.floor(header.repeatAlternative / 2 ** (number - 1)) % 2 === 1);
      if (numbers.length) {
        active = { start: index, end: index, mask: header.repeatAlternative, label: `${numbers.join(', ')}.`, closed: false };
        spans.push(active);
      }
    }
    if (active) {
      active.end = index;
      if (header.repeatClose > 0) { active.closed = true; active = undefined; }
    }
  });
  return spans;
}

/** Margins belong to the measure, so line wrapping and note hit regions agree. */
export function repeatSpacing(header: TGMeasureHeader, ending?: TabEndingSpan) {
  const left = 12 + (header.repeatOpen ? 18 : 0), right = 12 + (header.repeatClose > 0 ? 18 : 0);
  // Any measure may begin a wrapped continuation, which repeats the label in parentheses.
  const endingWidth = ending ? labelWidth(`(${ending.label})`) + 24 : 0;
  const countWidth = header.repeatClose > 1 ? labelWidth(`×${header.repeatClose + 1}`) + 24 : 0;
  return { left, right, minWidth: Math.max(84, endingWidth, countWidth) };
}

export function structureHeight(measures: TabMeasure[]): number {
  return (measures.some(m => m.ending) ? ENDING_SPACE : 0) + (measures.some(m => m.repeatClose > 1) ? COUNT_SPACE : 0);
}

/** Paint-ready geometry, after the system's string positions are known. */
export function engraveStructure(system: TabSystem, stringSpacing: number): void {
  const { measures, top, bottom } = system;
  const middle = (top + bottom) / 2, dotOffset = Math.min(6, stringSpacing / 4);
  for (let boundary = 0; boundary <= measures.length; boundary++) {
    const before = measures[boundary - 1], after = measures[boundary];
    const open = !!after?.repeatOpen, close = (before?.repeatClose ?? 0) > 0;
    const x = after?.x ?? system.width;
    const lines = open || close ? [{ x, width: 4 }] : [{ x, width: 1 }];
    const dots: TabBarline['dots'] = [];
    for (const direction of [...(close ? [-1] : []), ...(open ? [1] : [])]) {
      lines.push({ x: x + direction * 7, width: 1.3 });
      dots.push({ x: x + direction * 14, y: middle - dotOffset }, { x: x + direction * 14, y: middle + dotOffset });
    }
    const left = x - (close ? 17 : 2), right = x + (open ? 17 : 2);
    system.barlines.push({ id: `${system.index}:${boundary}`, x,
      kind: open ? close ? 'repeat-both' : 'repeat-start' : close ? 'repeat-end' : 'single',
      top, bottom, lines, dots, bounds: { x: left, y: top, w: right - left, h: bottom - top } });
  }
  const endingY = system.y + 38;
  const spans = new Set(measures.flatMap(m => m.ending ? [m.ending] : []));
  for (const span of spans) {
    const bars = measures.filter(m => m.index >= span.start && m.index <= span.end);
    const first = bars[0], last = bars.at(-1)!;
    const fromPrevious = span.start < first.index, toNext = span.end > last.index;
    system.endings.push({ id: `ending:${span.start}:${system.index}`, startMeasure: span.start, endMeasure: span.end,
      label: fromPrevious ? `(${span.label})` : span.label,
      continuation: fromPrevious ? toNext ? 'middle' : 'end' : toNext ? 'start' : 'none',
      leftHook: !fromPrevious, rightHook: !toNext && span.closed,
      x1: first.x + 3, x2: last.x + last.width - 3, y: endingY, height: ENDING_HEIGHT,
      labelX: first.x + 9, labelY: endingY + 14 });
  }
  const countY = endingY + (spans.size ? ENDING_SPACE : 0) + 8;
  for (const bar of measures) if (bar.repeatClose > 1) {
    // TG repeatClose counts additional passes (1 = play twice), not total plays.
    const plays = bar.repeatClose + 1;
    system.repeatCounts.push({ measure: bar.index, text: `×${plays}`, title: `Play ${plays} times`, x: bar.x + bar.width - 6, y: countY });
  }
}
