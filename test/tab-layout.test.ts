import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createIdentities } from '../shared/editor-identities';
import { parseTgFile } from '../shared/tg-reader';
import { cellBounds, hitTestTab, layoutTab, playbackPosition } from '../shared/tab-layout';
import { PRECISE_FACTOR } from '../shared/model';

const song = () => parseTgFile(readFileSync('china.tg'));
describe('independent tab geometry', () => {
  it.each([4, 6, 7, 8])('gives all %s strings their own empty and occupied cell bounds', count => {
    const model = song();
    model.tracks[0].strings = Array.from({ length: count }, (_, i) => ({ number: i + 1, value: 64 - i * 5 }));
    const layout = layoutTab(model, 0, 0, createIdentities(model));
    for (let string = 1; string <= count; string++) {
      const cursor = { track: 0, measure: 0, beat: 0, voice: 0, string };
      const box = cellBounds(layout, cursor)!;
      expect(box.h).toBeLessThan(layout.stringSpacing);
      expect(hitTestTab(layout, box.x + box.w / 2, box.y + box.h / 2)).toEqual({ cursor, kind: 'cell' });
    }
    expect(layout.columns).toHaveLength(10);
  });

  it('wraps at measure boundaries and gives the continuous layout a single system', () => {
    const model = song(), ids = createIdentities(model);
    const wrapped = layoutTab(model, 0, 0, ids, { width: 430 });
    expect(wrapped.systems).toHaveLength(2);
    const continuous = layoutTab(model, 0, 0, ids, { width: 430, mode: 'continuous' });
    expect(continuous.systems).toHaveLength(1);
    expect(continuous.width).toBeGreaterThan(430);
    expect(wrapped.columns.map(c => c.id)).toEqual(continuous.columns.map(c => c.id));
    expect(wrapped.columns.map(c => c.start)).toEqual(continuous.columns.map(c => c.start));
  });

  it('uses layout geometry for duration/column selection and playback time', () => {
    const model = song();
    const layout = layoutTab(model, 0, 0, createIdentities(model));
    const system = layout.systems[0], column = layout.columns[0];
    expect(hitTestTab(layout, column.x, system.rhythmY)?.kind).toBe('columns');
    expect(playbackPosition(layout, column.start + (column.end - column.start) / 2)?.x).toBe(column.x);
    expect(hitTestTab(layout, -100, 100)).toBeNull();
    expect(cellBounds(layout, { ...column.address, string: 99 })).toBeNull();
  });

  it('keeps hit regions aligned through density, spacing, and font-size changes', () => {
    const model = song();
    const layout = layoutTab(model, 0, 0, createIdentities(model), { density: 1.4, stringSpacing: 34, fretSize: 20, width: 720 });
    for (const column of layout.columns) {
      const cursor = { ...column.address, string: 3 };
      const box = cellBounds(layout, cursor)!;
      expect(hitTestTab(layout, column.x, box.y + box.h / 2)?.cursor).toEqual(cursor);
      expect(column.width).toBeGreaterThan(box.w);
    }
  });

  it('lays out a 500-measure fixture with independent measure timing', () => {
    const model = song();
    const measure = model.tracks[0].measures[0];
    model.measureHeaders = Array.from({ length: 500 }, (_, i) => ({ ...model.measureHeaders[0], number: i + 1, start: 960 + 3840 * i }));
    model.tracks[0].measures = model.measureHeaders.map((_, i) => ({ ...measure, beats: measure.beats.map(b => ({ ...b, preciseStart: b.preciseStart + i * 3840 * PRECISE_FACTOR })) }));
    const start = performance.now();
    const layout = layoutTab(model, 0, 0, createIdentities(model), { width: 1000 });
    const elapsed = performance.now() - start;
    expect(layout.columns).toHaveLength(4500);
    expect(layout.byAddress.size).toBe(4500);
    expect(layout.systems.at(-1)!.measures.at(-1)!.index).toBe(499);
    console.log(`500 measures / 4,500 columns: identity + layout ${elapsed.toFixed(1)} ms`);
  });
});
