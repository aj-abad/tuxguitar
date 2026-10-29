import { describe, expect, it } from 'vitest';
import { unzipSync, zipSync } from 'fflate';
import { notationStudy } from './fixtures/notation-study.mjs';
import { applySongEdits, clearTechniques, createEditor, cursorNote, redoEdit, rearrangeColumns, selectEditorCursor, setBend, setFret,
  techniqueStates, toggleTechnique, undoEdit, type EditorCursor, type SongEdit } from '../shared/editor';
import { BEND_SHAPES, bendPreset, makeBend, techniqueNeighbor } from '../shared/technique-edits';
import { layoutTab } from '../shared/tab-layout';
import { parseTgFile } from '../shared/tg-reader';
import { writeTgFile } from '../shared/tg-writer';
import { exportMidi } from '../shared/midi-export';

const source = notationStudy({ techniques: false });
const editor = () => createEditor('id', 'writing.tg', parseTgFile(source));
const cursor = (beat = 0, string = 1, measure = 0): EditorCursor => ({ track: 0, voice: 0, measure, beat, string });
const select = (state: ReturnType<typeof editor>, beat = 0, string = 1, measure = 0) => selectEditorCursor(state, cursor(beat, string, measure));
const note = (state: ReturnType<typeof editor>) => cursorNote(state.song, state.selection!)!;
const roundTrip = (state: ReturnType<typeof editor>, input = source) => {
  expect(applySongEdits(state.original, state.edits)).toEqual(state.song);
  expect(parseTgFile(writeTgFile(input, state.edits))).toEqual(state.song);
};

describe('technique writing', () => {
  it('writes H/P, slides and bends, keeping timing, stable IDs and source data', () => {
    const original = editor();
    let state = toggleTechnique(original, 'hammer-on');
    state = toggleTechnique(select(state, 1), 'pull-off');
    state = toggleTechnique(select(state, 2), 'slide');
    state = toggleTechnique(select(state, 3), 'bend');
    expect(state.identities).toBe(original.identities);
    expect(state.past).toHaveLength(4);
    const glyphs = layoutTab(state.song, 0, 0, state.identities).systems.flatMap(s => s.techniques);
    expect(glyphs.map(g => g.kind)).toEqual(['hammer-on', 'pull-off', 'slide', 'bend']);
    expect(state.song.tracks[0].measures.map(m => m.beats.map(b => b.preciseStart)))
      .toEqual(original.song.tracks[0].measures.map(m => m.beats.map(b => b.preciseStart)));
    expect(note(original).effect.hammer).toBe(false);
    roundTrip(state);
    expect(redoEdit(undoEdit(state)).song).toEqual(state.song);
  });
  it('switches outgoing techniques atomically and toggles back to clean state', () => {
    const initial = editor(), hammered = toggleTechnique(initial, 'hammer-on');
    const slid = toggleTechnique(hammered, 'slide');
    expect(note(slid).effect).toMatchObject({ slide: true, hammer: false });
    expect(undoEdit(slid).song).toBe(hammered.song);
    expect(slid.past).toHaveLength(2);
    roundTrip(slid);
    const clean = toggleTechnique(slid, 'slide');
    expect(clean.signature).toBe('[]');
    expect(clean.edits).toEqual([]);
  });
  it('ties the destination, sustains playback, and supports tied fret changes', () => {
    const initial = select(editor(), 7, 3), tied = toggleTechnique(initial, 'tie');
    expect(note(tied).tiedNote).toBe(true);
    expect(exportMidi(tied.song).filter(e => e.type === 'note_on')).toHaveLength(exportMidi(initial.song).filter(e => e.type === 'note_on').length - 1);
    const edited = setFret(tied, 12);
    expect(cursorNote(edited.song, cursor(6, 3))?.value).toBe(12);
    expect(note(edited).value).toBe(12);
    roundTrip(edited);
    expect(toggleTechnique(tied, 'tie').signature).toBe('[]');
  });
  it('writes connections across bars and removes conflicting incoming effects when tying', () => {
    let state = toggleTechnique(select(editor(), 3, 3, 1), 'slide');
    expect(() => rearrangeColumns(select(state, 0, 3, 2), 1)).toThrow('plain columns');
    state = toggleTechnique(select(state, 0, 2, 3), 'tie');
    roundTrip(state);
    expect(techniqueNeighbor(state.song, cursor(0, 2, 3), -1)?.address.measure).toBe(2);
    const song = editor().song;
    cursorNote(song, cursor(6, 3))!.effect.slide = true;
    const before = select(createEditor('id', 'conflict.tg', song), 7, 3);
    const after = toggleTechnique(before, 'tie');
    expect(cursorNote(after.song, cursor(6, 3))!.effect.slide).toBe(false);
    expect(note(after).tiedNote).toBe(true);
    expect(after.past).toHaveLength(1);
    expect(undoEdit(after).song).toEqual(song);
  });
  it('rejects wrong directions, different-pitch ties, empty cells and ranges without history changes', () => {
    const initial = editor();
    expect(() => toggleTechnique(initial, 'pull-off')).toThrow('lower');
    expect(() => toggleTechnique(select(initial, 1), 'hammer-on')).toThrow('higher');
    expect(() => toggleTechnique(select(initial, 1), 'tie')).toThrow('same fret');
    expect(() => toggleTechnique(select(initial, 0, 6), 'bend')).toThrow('Select a note');
    expect(() => toggleTechnique(selectEditorCursor(initial, cursor(1), true), 'bend')).toThrow('one string cell');
    expect(() => toggleTechnique(selectEditorCursor(initial, cursor(), false, 'columns'), 'slide')).toThrow('one string cell');
    expect(initial.past).toEqual([]);
    expect(techniqueStates(select(initial, 1))['hammer-on'].reason).toContain('higher');
  });
  it('does not link through rests, timing gaps, other strings or another voice', () => {
    const state = editor();
    expect(techniqueNeighbor(state.song, cursor(4, 1, 2), 1)).toBeUndefined();
    expect(techniqueNeighbor(state.song, cursor(5, 2), 1)?.address).toMatchObject({ measure: 1, beat: 1, string: 2 });
    state.song.tracks[0].measures[0].beats[1].preciseStart += 1;
    expect(() => toggleTechnique(state, 'slide')).toThrow('following note');
    const voices = editor().song;
    const next = voices.tracks[0].measures[0].beats[1];
    next.voices[1] = { ...next.voices[0], notes: next.voices[0].notes.map(n => ({ ...n, value: 22 })) };
    next.voices[0].notes = next.voices[0].notes.map(n => ({ ...n, string: 2 }));
    expect(techniqueNeighbor(voices, cursor(), 1)?.address).toMatchObject({ beat: 2, voice: 0 });
  });
  it.each(BEND_SHAPES)('writes, updates and removes $label as separate undo steps', ({ id }) => {
    const initial = editor(), curve = makeBend(id, 6);
    const bent = setBend(initial, curve);
    curve.points[1].value = 1;
    expect(note(bent).effect.bend?.points[1].value).toBe(6);
    expect(bendPreset(note(bent).effect.bend!)).toEqual({ shape: id, amount: 6 });
    // The edit log must also own its payload, independently of the caller.
    roundTrip(bent);
    const adjusted = setBend(bent, makeBend(id, 2));
    roundTrip(adjusted);
    expect(undoEdit(adjusted).song).toEqual(bent.song);
    expect(setBend(adjusted, makeBend(id, 2))).toBe(adjusted);
    expect(setBend(adjusted, null).signature).toBe('[]');
  });
  it('clears the supported techniques in one undo step and keeps unrelated effects', () => {
    const song = editor().song;
    cursorNote(song, cursor())!.effect.vibrato = true;
    let state = createEditor('id', 'writing.tg', song);
    state = toggleTechnique(toggleTechnique(state, 'bend'), 'hammer-on');
    const cleared = clearTechniques(state);
    expect(note(cleared).effect).toMatchObject({ vibrato: true, hammer: false });
    expect(note(cleared).effect.bend).toBeUndefined();
    expect(cleared.past.length).toBe(state.past.length + 1);
    expect(undoEdit(cleared).song).toBe(state.song);
  });
  it('rejects malformed command payloads before save and preserves the original archive', () => {
    const invalid = [null, { points: [] }, { points: [{ position: 0, value: 0 }, { position: 12, value: 13 }] },
      { points: [{ position: 6, value: 4 }, { position: 0, value: 0 }] }];
    for (const bend of invalid.slice(1)) {
      expect(() => writeTgFile(source, [{ kind: 'technique.set', cursor: cursor(), technique: 'bend', bend } as SongEdit])).toThrow('bend needs');
    }
    expect(() => writeTgFile(source, [{ kind: 'technique.set', cursor: cursor(), technique: 'slide', enabled: 'yes' } as unknown as SongEdit])).toThrow('Invalid technique');
    expect(parseTgFile(source)).toEqual(editor().song);
  });
  it('keeps unknown bend metadata, other effects and archive entries when replacing a curve', () => {
    const entries = unzipSync(source);
    const xml = new TextDecoder().decode(entries['content.xml']).replace('future="retain">', 'future="retain"><vibrato/><unknown flag="yes"/><bend future="curve"><point position="0" value="0" future="point"/><point position="12" value="4"/><future-shape/></bend>');
    entries['content.xml'] = new TextEncoder().encode(xml);
    entries['unknown.bin'] = new Uint8Array([3, 8, 2]);
    const input = zipSync(entries), initial = createEditor('id', 'custom.tg', parseTgFile(input));
    const state = setBend(initial, makeBend('prebend-release', 2));
    roundTrip(state, input);
    const output = unzipSync(writeTgFile(input, state.edits)), saved = new TextDecoder().decode(output['content.xml']);
    for (const token of ['future="curve"', 'future="point"', '<future-shape/>', '<unknown flag="yes"/>', '<vibrato/>']) expect(saved).toContain(token);
    expect(output['unknown.bin']).toEqual(entries['unknown.bin']);
  });
  it('can fill an empty bend element without producing invalid XML', () => {
    const entries = unzipSync(source);
    entries['content.xml'] = new TextEncoder().encode(new TextDecoder().decode(entries['content.xml']).replace('future="retain">', 'future="retain"><bend future="empty"/>'));
    const input = zipSync(entries), state = setBend(createEditor('id', 'empty.tg', parseTgFile(input)), makeBend('bend', 4));
    roundTrip(state, input);
  });
});
