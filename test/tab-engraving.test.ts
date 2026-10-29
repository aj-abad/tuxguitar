import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseTgFile } from '../shared/tg-reader';
import { createEditor, durationPrecise, selectEditorCursor, setFret, undoEdit } from '../shared/editor';
import { createIdentities } from '../shared/editor-identities';
import { cellBounds, hitTestTab, layoutTab, tabNotices } from '../shared/tab-layout';
import { bendAmount, bendProfile, noteText, noteWidth } from '../shared/tab-techniques';
import { PRECISE_FACTOR, PRECISE_STARTING_POINT, type TGNote } from '../shared/model';

interface Spec { value?: number; fret?: number; string?: number; rest?: boolean; dotted?: boolean; ratio?: [number, number];
  effect?: Partial<TGNote['effect']>; tied?: boolean; notes?: Array<Partial<TGNote> & { effect?: Partial<TGNote['effect']> }> }
function score(bars: Spec[][], meters = bars.map(() => [4, 4])) {
  const song = parseTgFile(readFileSync('china.tg'));
  const header = song.measureHeaders[0], measure = song.tracks[0].measures[0], voice = measure.beats[0].voices[0], note = voice.notes[0];
  song.measureHeaders = [];
  let position = PRECISE_STARTING_POINT;
  song.tracks[0].measures = bars.map((specs, index) => {
    const [numerator, denominator] = meters[index];
    song.measureHeaders.push({ ...header, number: index + 1, start: position / PRECISE_FACTOR, timeSignature: { numerator, denominator } });
    const beats = specs.map(spec => {
      const duration = { value: spec.value ?? 8, dotted: spec.dotted ?? false, doubleDotted: false,
        division: { enters: spec.ratio?.[0] ?? 1, times: spec.ratio?.[1] ?? 1 } };
      const notes = spec.rest ? [] : spec.notes?.map(n => ({ ...note, ...n, effect: { ...note.effect, ...n.effect } })) ??
        [{ ...note, value: spec.fret ?? 5, string: spec.string ?? 1, tiedNote: !!spec.tied, effect: { ...note.effect, ...spec.effect } }];
      const beat = { preciseStart: position, voices: [{ ...voice, duration, notes }] };
      position += durationPrecise(duration);
      return beat;
    });
    return { ...measure, beats };
  });
  return song;
}
const notes = (n: number, spec: Spec = {}) => Array.from({ length: n }, () => ({ ...spec }));
const draw = (song: ReturnType<typeof score>, options = {}) => layoutTab(song, 0, 0, createIdentities(song), options);
const glyphs = (view: ReturnType<typeof draw>) => view.systems.flatMap(s => s.techniques);

describe('metrical rhythm engraving', () => {
  it('beams eighth notes on quarter beats in 4/4 without changing score data', () => {
    const song = score([notes(8)]), original = structuredClone(song), view = draw(song);
    expect(view.systems[0].measures[0].beams.map(b => b.columnIds.length)).toEqual([2, 2, 2, 2]);
    expect(view.columns.every(c => !!c.beamGroup)).toBe(true);
    expect(song).toEqual(original);
  });
  it.each([6, 9, 12])('groups %s/8 in dotted-quarter pulses', numerator => {
    const view = draw(score([notes(numerator)], [[numerator, 8]]));
    expect(view.systems[0].measures[0].beams.map(b => b.columnIds.length)).toEqual(Array(numerator / 3).fill(3));
  });
  it.each([
    { meter: [3, 8], count: 3, groups: [3] }, { meter: [2, 2], count: 8, groups: [4, 4] },
    { meter: [5, 8], count: 5, groups: [2, 3] }, { meter: [7, 8], count: 7, groups: [2, 2, 3] },
  ])('uses the declared meter $meter', ({ meter, count, groups }) => {
    expect(draw(score([notes(count)], [meter])).systems[0].measures[0].beams.map(b => b.columnIds.length)).toEqual(groups);
  });
  it('draws secondary beams and inward hooks for mixed and dotted values', () => {
    const view = draw(score([[{ value: 8 }, { value: 16 }, { value: 16 }, { value: 8, dotted: true }, { value: 16 },
      { value: 16 }, { value: 8 }, { value: 16 }, { value: 4 }]]));
    const beams = view.systems[0].measures[0].beams;
    expect(beams.filter(b => b.level === 1).map(b => b.columnIds.length)).toEqual([3, 2, 3]);
    expect(beams.filter(b => b.level === 2).map(b => [b.hook, b.columnIds.length])).toEqual([[false, 2], [true, 1], [true, 1], [true, 1]]);
    const dottedHook = beams.find(b => b.level === 2 && b.columnIds[0] === view.columns[4].id)!;
    expect(dottedHook.x2).toBe(view.columns[4].x + 4.5);
    const forwardHook = beams.find(b => b.level === 2 && b.columnIds[0] === view.columns[5].id)!;
    expect(forwardHook.x1).toBe(view.columns[5].x + 4.5);
  });
  it.each([32, 64])('subdivides the extra beam levels on %sth notes', value => {
    const view = draw(score([[...notes(value / 4, { value }), ...notes(3, { value: 4 })]]));
    const beams = view.systems[0].measures[0].beams;
    expect(beams.filter(b => b.level === Math.log2(value) - 2).map(b => b.columnIds.length)).toEqual(Array(value / 16).fill(4));
    expect(beams.every(b => b.x2 > b.x1 && !b.hook)).toBe(true);
  });
  it('breaks beams at rests, gaps and barlines, and updates at meter changes', () => {
    const song = score([[{}, { rest: true }, {}, {}, ...notes(2, { value: 4 })], notes(6)], [[4, 4], [6, 8]]);
    const view = draw(song, { mode: 'continuous' });
    expect(view.systems[0].measures.map(m => m.beams.filter(b => b.level === 1).map(b => b.columnIds.length))).toEqual([[2], [3, 3]]);
    song.tracks[0].measures[0].beats[3].preciseStart += 10;
    expect(draw(song).systems[0].measures[0].beams).toHaveLength(0);
  });
  it('labels triplets/quintuplets once per group and brackets rests or unbeamed mixed tuplets', () => {
    const view = draw(score([[...notes(3, { ratio: [3, 2] }), { value: 4, rest: true },
      ...notes(5, { value: 16, ratio: [5, 4] }), { value: 4 }]]));
    expect(view.systems[0].measures[0].tuplets.map(t => [t.label, t.bracket])).toEqual([['3', false], ['5', false]]);
    const withRest = draw(score([[{ ratio: [3, 2] }, { ratio: [3, 2], rest: true }, { ratio: [3, 2] },
      { value: 4, ratio: [3, 2] }, { ratio: [3, 2] }, { value: 2, rest: true }]]));
    expect(withRest.systems[0].measures[0].tuplets.map(t => [t.label, t.bracket])).toEqual([['3', true], ['3', true]]);
  });
});

describe('tab technique engraving', () => {
  it('distinguishes rising/falling legato, slides and destination-marked ties', () => {
    const view = draw(score([[{ fret: 5, effect: { hammer: true } }, { fret: 7, effect: { hammer: true } },
      { fret: 5, effect: { slide: true } }, { fret: 9 }, { value: 4, rest: true },
      { string: 2, fret: 7 }, { string: 2, fret: 7, tied: true }]]));
    expect(glyphs(view).map(g => g.kind)).toEqual(['hammer-on', 'pull-off', 'slide', 'tie']);
    expect(glyphs(view).flatMap(g => g.labels.map(l => l.text))).toEqual(['H', 'P']);
    expect(noteText(view.columns.at(-1)!.notes[0].note)).toBe('(7)');
    const tied = view.columns.at(-1)!;
    const caret = cellBounds(view, { ...tied.address, string: 2 })!;
    expect(caret.w).toBeGreaterThanOrEqual(noteWidth(tied.notes[0].note, view.fretSize));
    expect(caret.h).toBeLessThan(view.stringSpacing);
    expect(view.issues).toEqual([]);
  });
  it.each(['hammer-on', 'pull-off', 'slide', 'tie'] as const)('continues a %s across barlines and wrapped systems', kind => {
    const fret = kind === 'pull-off' ? 9 : 5;
    const target = kind === 'tie' ? fret : kind === 'pull-off' ? 5 : 9;
    const song = score([[...notes(3, { value: 4, string: 1 }), { value: 4, string: 2, fret,
      effect: { hammer: kind.includes('on') || kind.includes('off'), slide: kind === 'slide' } }],
    [{ value: 4, string: 2, fret: target, tied: kind === 'tie' }, ...notes(3, { value: 4, rest: true })]]);
    const wrapped = draw(song, { width: 400 });
    const spans = glyphs(wrapped);
    expect(wrapped.systems).toHaveLength(2);
    expect(spans.map(g => [g.kind, g.continuation])).toEqual([[kind, 'start'], [kind, 'end']]);
    expect(spans[0].sourceId).toBe(spans[1].sourceId);
    expect(spans[0].targetId).toBe(spans[1].targetId);
    expect(spans.every(g => g.bounds.w > 0 && !g.paths[0].d.includes('NaN'))).toBe(true);
    expect(glyphs(draw(song, { mode: 'continuous' })).map(g => g.continuation)).toEqual(['none']);
  });
  it('does not invent connections across rests, missing strings, mismatched ties or timing gaps', () => {
    const song = score([[{ effect: { hammer: true } }, { rest: true }, { fret: 9 }, { fret: 11, tied: true },
      { effect: { slide: true }, string: 2 }, { fret: 9, string: 3 }, { fret: 7, effect: { hammer: true } }, { fret: 9 }]]);
    song.tracks[0].measures[0].beats[7].preciseStart += 10;
    const view = draw(song);
    expect(glyphs(view)).toHaveLength(0);
    expect(view.issues).toHaveLength(1);
  });
  it('changes H to P after a fret edit and restores the connection and selection on undo', () => {
    const song = score([[{ fret: 5, effect: { hammer: true } }, { fret: 7 }, ...notes(6)]]);
    const state = selectEditorCursor(createEditor('test', 'study.tg', song), { track: 0, measure: 0, beat: 1, voice: 0, string: 1 });
    const edited = setFret(state, 3);
    const view = layoutTab(edited.song, 0, 0, edited.identities);
    expect(glyphs(view)[0].kind).toBe('pull-off');
    expect(cellBounds(view, edited.selection!)!.x).toBeLessThan(view.columns[1].x);
    const restored = undoEdit(edited);
    expect(glyphs(layoutTab(restored.song, 0, 0, restored.identities))[0].kind).toBe('hammer-on');
    expect(restored.selection).toEqual(state.selection);
  });
  it('uses TG quarter-tone bend values and retains pre-bends, holds and releases', () => {
    expect([1, 2, 3, 4, 6, 8].map(bendAmount)).toEqual(['¼', '½', '¾', 'full', '1½', '2']);
    const bend = { points: [{ position: 0, value: 4 }, { position: 6, value: 4 }, { position: 12, value: 0 }] };
    const original = structuredClone(bend);
    const view = draw(score([[{ value: 1, effect: { bend } }]]));
    const glyph = glyphs(view)[0];
    expect(glyph.title).toBe('Pre-bend full and release');
    expect(glyph.paths.filter(p => p.kind === 'arrow')).toHaveLength(2);
    expect(glyph.paths.filter(p => p.kind === 'hold')).toHaveLength(1);
    expect(glyph.labels.map(l => l.text)).toEqual(['full']);
    expect(bend).toEqual(original);
  });
  it('keeps simultaneous bends compact, with uniform strings and aligned label/cell hits', () => {
    const song = score([[{ value: 1, notes: Array.from({ length: 6 }, (_, i) => ({ string: i + 1, value: 7,
      effect: { bend: { points: [{ position: 0, value: 0 }, { position: 6, value: 2 * (i + 1) }, { position: 12, value: 0 }] } } })) }]]);
    const view = draw(song, { density: .85, fretSize: 20 });
    const system = view.systems[0];
    expect(glyphs(view)).toHaveLength(6);
    expect(system.strings.slice(1).map((string, index) => string.y - system.strings[index].y))
      .toEqual(Array(5).fill(view.stringSpacing));
    for (const glyph of glyphs(view)) {
      const label = glyph.labels[0];
      const cursor = { ...view.columns[0].address, string: glyph.cursor.string };
      expect(hitTestTab(view, label.x, label.y)?.cursor).toEqual(cursor);
      const cell = cellBounds(view, cursor)!;
      expect(hitTestTab(view, cell.x + cell.w / 2, cell.y + cell.h / 2)?.cursor).toEqual(cursor);
      expect(label.y).toBeGreaterThan(system.strings.find(s => s.number === cursor.string)!.y - view.stringSpacing);
      expect(glyph.bounds.x + glyph.bounds.w).toBeLessThan(view.columns[0].left + view.columns[0].width + 8);
    }
  });
  it('reports invalid bend data without invalid SVG geometry or changing the source', () => {
    expect(bendProfile({ points: [{ position: 0, value: 0 }, { position: 13, value: 4 }] })).toBeNull();
    const song = score([[{ value: 1, effect: { bend: { points: [{ position: 0, value: -1 }] } } }]]);
    const view = draw(song);
    expect(glyphs(view)).toHaveLength(0);
    expect(view.issues[0]).toContain('invalid points');
    expect(song.tracks[0].measures[0].beats[0].voices[0].notes[0].effect.bend!.points[0].value).toBe(-1);
  });
  it('removes the old unsupported-technique notice only for the newly engraved techniques', () => {
    const song = score([[{ effect: { hammer: true, bend: { points: [{ position: 0, value: 2 }] } } }, { fret: 7 }]]);
    expect(tabNotices(song, 0, 0)).toEqual([]);
    song.tracks[0].measures[0].beats[0].voices[0].notes[0].effect.vibrato = true;
    expect(tabNotices(song, 0, 0)).toHaveLength(1);
  });
});
