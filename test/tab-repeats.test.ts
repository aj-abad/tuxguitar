import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createIdentities } from '../shared/editor-identities';
import { cellBounds, hitTestTab, layoutTab, tabNotices } from '../shared/tab-layout';
import { resolveEndings } from '../shared/tab-structure';
import { parseTgFile } from '../shared/tg-reader';
import { PRECISE_FACTOR, type TGMeasureHeader } from '../shared/model';
import { repeatStudy } from './fixtures/repeat-study.mjs';

const legacy = () => parseTgFile(readFileSync('tuxguitar-java/common/TuxGuitar-lib/src/test/resources/altRepeatLoop_20.tg'));
function score(headers: Array<Partial<TGMeasureHeader>>) {
  const model = parseTgFile(readFileSync('china.tg'));
  const header = model.measureHeaders[0], measure = model.tracks[0].measures[1];
  model.measureHeaders = headers.map((h, index) => ({ ...header, number: index + 1, start: 960 + index * 3840, ...h }));
  model.tracks[0].measures = headers.map((_, index) => ({ ...structuredClone(measure), beats: measure.beats.map(beat => ({
    ...structuredClone(beat), preciseStart: beat.preciseStart + (index - 1) * 3840 * PRECISE_FACTOR,
  })) }));
  return model;
}
const draw = (model: ReturnType<typeof score>, options = {}) => layoutTab(model, 0, 0, createIdentities(model), options);

describe('repeat structure engraving', () => {
  it('resolves implicit multi-measure endings from the legacy TG regression fixture', () => {
    const model = legacy(), original = structuredClone(model);
    expect(resolveEndings(model.measureHeaders)).toEqual([
      { start: 1, end: 2, mask: 1, label: '1.', closed: true },
      { start: 3, end: 4, mask: 6, label: '2, 3.', closed: true },
      { start: 5, end: 6, mask: 8, label: '4.', closed: false },
    ]);
    const view = draw(model, { mode: 'continuous' });
    expect(view.systems[0].endings.map(e => [e.label, e.leftHook, e.rightHook])).toEqual([
      ['1.', true, true], ['2, 3.', true, true], ['4.', true, false],
    ]);
    // The native fixture plays bars 8–9 three times; TG stores two repeats.
    expect(view.systems[0].repeatCounts).toMatchObject([{ measure: 8, text: '×3' }]);
    expect(model).toEqual(original);
    expect(tabNotices(model, 0, 0).some(n => n.includes('Repeat'))).toBe(false);
  });

  it('merges repeated ending markers but splits at changes, closes, and new repeat starts', () => {
    const model = score([{ repeatAlternative: 1 }, { repeatAlternative: 1 }, {},
      { repeatAlternative: 5, repeatClose: 1 }, { repeatAlternative: 5 }, { repeatOpen: true },
      { repeatAlternative: 128 }]);
    expect(resolveEndings(model.measureHeaders).map(e => [e.start, e.end, e.label, e.closed])).toEqual([
      [0, 2, '1.', false], [3, 3, '1, 3.', true], [4, 4, '1, 3.', false], [6, 6, '8.', false],
    ]);
  });

  it('draws adjacent repeat ends/starts once and separates them correctly at a system break', () => {
    const model = score([{ repeatOpen: true, repeatClose: 1 }, { repeatOpen: true, repeatClose: 3 }]);
    const view = draw(model, { mode: 'continuous' });
    expect(view.systems[0].barlines.map(b => [b.kind, b.lines.length, b.dots.length])).toEqual([
      ['repeat-start', 2, 2], ['repeat-both', 3, 4], ['repeat-end', 2, 2],
    ]);
    expect(view.systems[0].repeatCounts.map(c => c.text)).toEqual(['×4']);
    model.measureHeaders[1].lineBreak = true;
    const wrapped = draw(model, { width: 900 });
    expect(wrapped.systems.map(s => s.barlines.map(b => b.kind))).toEqual([
      ['repeat-start', 'repeat-end'], ['repeat-start', 'repeat-end'],
    ]);
  });

  it('continues a long ending across rows without adding false end hooks', () => {
    const model = score([{ repeatAlternative: 1 }, { lineBreak: true }, { lineBreak: true, repeatClose: 1 },
      { lineBreak: true, repeatAlternative: 2 }]);
    const endings = draw(model).systems.flatMap(s => s.endings);
    expect(endings.map(e => [e.label, e.continuation, e.leftHook, e.rightHook])).toEqual([
      ['1.', 'start', true, false], ['(1.)', 'middle', false, false], ['(1.)', 'end', false, true],
      ['2.', 'none', true, false],
    ]);
    expect(draw(model, { mode: 'continuous' }).systems[0].endings.map(e => e.continuation)).toEqual(['none', 'none']);
  });

  it('reserves symbol margins before wrapping without changing column identity or musical time', () => {
    const model = score([{}, {}]);
    const plain = draw(model, { mode: 'continuous' });
    model.measureHeaders[0].repeatOpen = true;
    model.measureHeaders[0].repeatClose = 1;
    const marked = draw(model, { mode: 'continuous' });
    const plainBar = plain.systems[0].measures[0], markedBar = marked.systems[0].measures[0];
    expect(markedBar.width).toBeGreaterThan(plainBar.width);
    expect(markedBar.columns[0].left - plainBar.columns[0].left).toBe(18);
    const tail = (bar: typeof markedBar) => bar.x + bar.width - (bar.columns.at(-1)!.left + bar.columns.at(-1)!.width);
    expect(tail(markedBar) - tail(plainBar)).toBe(18);
    expect(marked.columns.map(c => [c.id, c.start, c.end])).toEqual(plain.columns.map(c => [c.id, c.start, c.end]));
    const width = plain.systems[0].width + 20;
    expect(draw(model, { width }).systems).toHaveLength(2);
    model.measureHeaders[0].repeatOpen = false;
    model.measureHeaders[0].repeatClose = 0;
    expect(draw(model, { width }).systems).toHaveLength(1);
  });

  it.each([.85, 1, 1.25])('keeps notes and bends clear of repeat symbols at density %s', density => {
    const model = parseTgFile(repeatStudy()), original = structuredClone(model);
    const view = draw(model, { density, width: 480, fretSize: 20 });
    for (const system of view.systems) {
      expect(system.strings.slice(1).map((s, i) => s.y - system.strings[i].y)).toEqual(Array(5).fill(view.stringSpacing));
      for (const bar of system.measures) {
        const opening = system.barlines.find(b => b.x === bar.x)!;
        const closing = system.barlines.find(b => Math.abs(b.x - bar.x - bar.width) < .001)!;
        for (const column of bar.columns) {
          const cursor = { ...column.address, string: 1 }, box = cellBounds(view, cursor)!;
          expect(box.x).toBeGreaterThan(opening.bounds.x + opening.bounds.w);
          expect(box.x + box.w).toBeLessThan(closing.bounds.x);
          expect(hitTestTab(view, column.x, system.top)?.cursor).toEqual(cursor);
        }
      }
      for (const ending of system.endings) {
        expect(ending.y).toBeGreaterThan(system.y + 16); // chord/text annotation baseline
        expect(ending.y + ending.height).toBeLessThan(system.top - 24);
        expect(ending.x2).toBeGreaterThan(ending.labelX + ending.label.length * 12 * .62);
        for (const bend of system.techniques.filter(t => t.kind === 'bend')) expect(bend.bounds.y).toBeGreaterThan(ending.y + ending.height);
      }
    }
    expect(model).toEqual(original);
  });

  it('fits long ending labels and count labels in empty-voice measures and adds only required vertical space', () => {
    const model = score([{ repeatAlternative: 255, repeatClose: 99 }, { repeatOpen: true, lineBreak: true }]);
    for (const measure of model.tracks[0].measures) for (const beat of measure.beats) beat.voices[0].empty = true;
    const [marked, plain] = draw(model, { width: 240 }).systems;
    expect(marked.columns).toHaveLength(0);
    expect(marked.endings[0].label).toBe('1, 2, 3, 4, 5, 6, 7, 8.');
    expect(marked.endings[0].labelX + marked.endings[0].label.length * 12 * .62).toBeLessThan(marked.endings[0].x2);
    expect(marked.repeatCounts[0].y).toBeGreaterThan(marked.endings[0].y + marked.endings[0].height);
    expect(marked.repeatCounts[0].text).toBe('×100');
    expect(marked.top - marked.y).toBeGreaterThan(plain.top - plain.y);
    expect(plain.top - plain.y).toBe(56);
  });
});
