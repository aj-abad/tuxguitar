import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createEditor, setTabDesign, undoEdit, redoEdit, applySongEdits, setFret } from '../shared/editor';
import { createIdentities } from '../shared/editor-identities';
import { parseTgFile } from '../shared/tg-reader';
import { layoutTab, fitTimeSpacing, playbackPosition } from '../shared/tab-layout';
import { absorbTabRow, breakTabRow, captureTabDesign, resizeTabBoundary, validateTabDesign } from '../shared/tab-design';
import { PRECISE_FACTOR, PRECISE_STARTING_POINT, WHOLE_PRECISE_DURATION } from '../shared/model';

function score(count = 6) {
  const song = parseTgFile(readFileSync('china.tg')), header = song.measureHeaders[0];
  const measure = song.tracks[0].measures[0], voice = measure.beats[0].voices[0];
  song.measureHeaders = Array.from({ length: count }, (_, index) => ({ ...header, number: index + 1, start: 960 + index * 3840, lineBreak: false }));
  song.tracks[0].measures = song.measureHeaders.map((h, index) => ({ ...measure, beats: Array.from({ length: 4 }, (_, beat) => ({
    preciseStart: h.start * PRECISE_FACTOR + beat * WHOLE_PRECISE_DURATION / 4,
    voices: [{ ...voice, duration: { value: 4, dotted: false, doubleDotted: false }, notes: [{ ...voice.notes[0], value: 5 + index }] }],
  })) }));
  return song;
}
const draw = (song: ReturnType<typeof score>, options = {}) => layoutTab(song, 0, 0, createIdentities(song), options);

describe('manual tab design', () => {
  it('redistributes adjacent bars, clamps at readable minima, and leaves every other row unchanged', () => {
    const song = score(), view = draw(song), before = captureTabDesign(view);
    const design = resizeTabBoundary(view, 0, 0, 1e6);
    expect(design.rows[0][1]).toBeCloseTo(view.systems[0].measures[1].minWidth);
    expect(design.rows[0].reduce((a, b) => a + b)).toBeCloseTo(before.rows[0].reduce((a, b) => a + b));
    expect(design.rows.slice(1)).toEqual(before.rows.slice(1));
    song.tracks[0].tabLayout = design;
    const resized = draw(song, { width: 350, density: 1.25 });
    expect(resized.systems.map(row => row.measures.map(bar => bar.index))).toEqual(view.systems.map(row => row.measures.map(bar => bar.index)));
    expect(captureTabDesign(resized)).toEqual(design);
  });
  it('breaks after a chosen bar, then pulls exactly the first following bar into that row', () => {
    const song = score(), view = draw(song);
    song.tracks[0].tabLayout = breakTabRow(view, 0);
    const split = draw(song);
    expect(split.systems[0].measures.map(bar => bar.index)).toEqual([0]);
    expect(split.systems[1].measures[0].index).toBe(1);
    song.tracks[0].tabLayout = absorbTabRow(split, 0);
    const joined = draw(song);
    expect(joined.systems[0].measures.map(bar => bar.index)).toEqual([0, 1]);
    expect(joined.systems.slice(1).flatMap(row => row.measures.map(bar => bar.index))).toEqual([2, 3, 4, 5]);
    expect(() => breakTabRow(joined, 1)).toThrow('already ends');
  });
  it('refuses impossible row absorption and keeps oversized manual rows together', () => {
    const song = score(2);
    song.tracks[0].tabLayout = { rows: [[84], [84]] };
    const view = draw(song);
    expect(view.issues).toHaveLength(2);
    expect(view.systems).toHaveLength(2);
    expect(() => absorbTabRow(view, 0)).toThrow('readable');
  });
  it('saves layouts as atomic history commands without replacing note identities', () => {
    const song = score(), state = createEditor('id', 'song.tg', song), design = captureTabDesign(draw(song));
    const changed = setTabDesign(state, 0, design);
    expect(changed.identities).toBe(state.identities);
    expect(changed.signature).not.toBe('[]');
    expect(applySongEdits(song, changed.edits)).toEqual(changed.song);
    expect(undoEdit(changed).song).toBe(song);
    expect(redoEdit(undoEdit(changed)).song.tracks[0].tabLayout).toEqual(design);
    expect(setFret(changed, 12).song.tracks[0].tabLayout).toEqual(design);
    expect(setTabDesign(changed, 0, null).signature).toBe('[]');
    design.rows[0][0] = 999;
    expect(changed.song.tracks[0].tabLayout!.rows[0][0]).not.toBe(999);
  });
  it('validates width values and exactly one row placement per bar', () => {
    for (const rows of [[[NaN, 200]], [[-1, 200]], [[Infinity, 200]], [[200]], [[], [200, 200]]]) {
      expect(() => validateTabDesign({ rows }, 2)).toThrow('Invalid tab layout');
    }
  });
});

describe('duration spacing and playback', () => {
  it('compresses longer intervals first while keeping fast notes readable', () => {
    const durations = [.25, .25, 1, 2.5], minimum = [28, 28, 28, 28];
    const wide = fitTimeSpacing(durations, minimum, 400), tight = fitTimeSpacing(durations, minimum, 200);
    expect(wide.reduce((a, b) => a + b)).toBeCloseTo(400);
    expect(tight.reduce((a, b) => a + b)).toBeCloseTo(200);
    expect(tight.slice(0, 2)).toEqual([28, 28]);
    expect(tight[3]).toBeLessThan(wide[3] / 2);
  });
  it('reserves more space for dense bars and respects their stored manual width', () => {
    const song = score(2), simple = draw(song).systems[0].measures[0];
    const beat = song.tracks[0].measures[0].beats[0];
    song.tracks[0].measures[0].beats = Array.from({ length: 16 }, (_, index) => ({ ...beat,
      preciseStart: PRECISE_STARTING_POINT + index * WHOLE_PRECISE_DURATION / 16,
      voices: [{ ...beat.voices[0], duration: { value: 16, dotted: false, doubleDotted: false } }],
    }));
    const dense = draw(song).systems[0].measures[0];
    expect(dense.minWidth).toBeGreaterThan(simple.minWidth);
    expect(dense.width).toBeGreaterThan(simple.width);
    song.tracks[0].tabLayout = { rows: [[600], [736]] };
    expect(draw(song).systems[0].measures[0].width).toBe(600);
  });
  it('crosses note centers at their onsets and remains continuous between notes', () => {
    const view = draw(score()), [first, second] = view.columns;
    expect(playbackPosition(view, first.start)?.x).toBe(first.x);
    expect(playbackPosition(view, second.start)?.x).toBe(second.x);
    expect(playbackPosition(view, first.end - 1)!.x).toBeCloseTo(second.x, 3);
  });
});
