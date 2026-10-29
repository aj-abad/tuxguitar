import { describe, expect, it } from 'vitest';
import { unzipSync, zipSync } from 'fflate';
import { notationStudy } from './fixtures/notation-study.mjs';
import { repeatStudy } from './fixtures/repeat-study.mjs';
import { applySongEdits, clearRepeats, createEditor, redoEdit, repeatState, selectEditorCursor, setEndingNumbers,
  setFret, setRepeatPlays, toggleRepeat, undoEdit, type EditorCursor, type SongEdit } from '../shared/editor';
import { parseTgFile } from '../shared/tg-reader';
import { writeTgFile } from '../shared/tg-writer';
import { layoutTab } from '../shared/tab-layout';
import { tgSongToScore } from '../shared/tg-to-alphatab';

const source = notationStudy();
const editor = (bytes = source) => createEditor('id', 'repeats.tg', parseTgFile(bytes));
const cursor = (measure = 0, beat = 0, string = 1): EditorCursor => ({ track: 0, voice: 0, measure, beat, string });
const select = (state: ReturnType<typeof editor>, measure = 0, beat = 0, string = 1) => selectEditorCursor(state, cursor(measure, beat, string));
const xml = (bytes: Uint8Array) => new TextDecoder('utf-8', { ignoreBOM: true }).decode(unzipSync(bytes)['content.xml']);
const roundTrip = (state: ReturnType<typeof editor>, bytes = source) => {
  expect(applySongEdits(state.original, state.edits)).toEqual(state.song);
  expect(parseTgFile(writeTgFile(bytes, state.edits))).toEqual(state.song);
};

describe('repeat and alternate-ending writing', () => {
  it('marks header-only edits dirty, preserves identities and timing, and saves across undo/redo', () => {
    const initial = editor();
    const opened = toggleRepeat(initial, 'start');
    expect(opened.signature).not.toBe('[]');
    expect(opened.song.tracks).toBe(initial.song.tracks);
    expect(opened.identities).toBe(initial.identities);
    expect(opened.selection).toEqual(initial.selection);
    expect(initial.song.measureHeaders[0].repeatOpen).toBe(false);
    roundTrip(opened);
    const saved = { ...opened, savedSignature: opened.signature };
    const undone = undoEdit(saved);
    expect(undone.signature).toBe('[]');
    expect(undone.signature).not.toBe(undone.savedSignature);
    expect(writeTgFile(source, undone.edits)).toEqual(source);
    const redone = redoEdit(undone);
    expect(redone.signature).toBe(redone.savedSignature);
    roundTrip(redone);
    const reverted = toggleRepeat(opened, 'start');
    expect(reverted.signature).toBe('[]');
    expect(reverted.edits).toEqual([]);
    expect(reverted.song).toBe(initial.song);
  });

  it('authors first/second endings and repeat counts through the shared command history', () => {
    let state = toggleRepeat(editor(), 'start');
    state = toggleRepeat(select(state, 1), 'ending');
    state = toggleRepeat(select(state, 2), 'end');
    expect(repeatState(state).inherited).toEqual({ measure: 1, label: '1.' });
    state = setEndingNumbers(select(state, 3), [3, 2]);
    state = setRepeatPlays(select(state, 4), 4);
    roundTrip(state);
    expect(state.past).toHaveLength(5);
    expect(state.song.measureHeaders[4].repeatClose).toBe(3);
    expect(repeatState(state).plays).toBe(4);
    const view = layoutTab(state.song, 0, 0, state.identities, { mode: 'continuous' });
    expect(view.systems[0].endings.map(e => [e.startMeasure, e.endMeasure, e.label])).toEqual([[1, 2, '1.'], [3, 4, '2, 3.']]);
    expect(view.systems[0].repeatCounts[0].text).toBe('×4');
    const comparison = tgSongToScore(state.song);
    expect(comparison.masterBars[4].repeatCount).toBe(4);
    expect(comparison.masterBars.slice(1, 5).map(bar => bar.alternateEndings)).toEqual([1, 1, 6, 6]);
  });

  it('edits empty string cells and rests, allows ranges within a measure, and rejects cross-bar ranges', () => {
    const initial = select(editor(), 0, 0, 6);
    expect(toggleRepeat(initial, 'start').song.measureHeaders[0].repeatOpen).toBe(true);
    const rest = select(editor(), 2, 4);
    expect(toggleRepeat(rest, 'end').song.measureHeaders[2].repeatClose).toBe(1);
    const within = selectEditorCursor(initial, cursor(0, 3, 2), true);
    expect(toggleRepeat(within, 'ending').song.measureHeaders[0].repeatAlternative).toBe(1);
    const across = selectEditorCursor(initial, cursor(1), true);
    expect(repeatState(across).reason).toContain('one measure');
    for (const action of [() => toggleRepeat(across, 'start'), () => setRepeatPlays(across, 3),
      () => setEndingNumbers(across, [2]), () => clearRepeats(across)]) expect(action).toThrow('one measure');
    expect(across.past).toEqual([]);
  });

  it('treats repeat headers as global and keeps both tracks and their metadata intact', () => {
    const model = editor().song;
    model.tracks.push({ ...structuredClone(model.tracks[0]), number: 2, name: 'Second guitar' });
    const initial = createEditor('id', 'tracks.tg', model);
    const state = toggleRepeat(selectEditorCursor(initial, { ...cursor(1), track: 1 }), 'ending');
    expect(state.song.tracks).toBe(initial.song.tracks);
    for (const track of [0, 1]) {
      const view = layoutTab(state.song, track, 0, state.identities, { mode: 'continuous' });
      expect(view.systems[0].endings[0].startMeasure).toBe(1);
    }
  });

  it('clears all local repeat fields atomically without clearing neighboring or inherited markers', () => {
    let state = toggleRepeat(editor(), 'start');
    state = setRepeatPlays(state, 6);
    state = setEndingNumbers(state, [1, 3, 8]);
    const before = state;
    const cleared = clearRepeats(state);
    expect(cleared.past).toHaveLength(before.past.length + 1);
    expect(cleared.signature).toBe('[]');
    expect(undoEdit(cleared).song).toBe(before.song);
    roundTrip(undoEdit(cleared));
    const imported = select(editor(repeatStudy()), 2);
    const withoutClose = clearRepeats(imported);
    expect(withoutClose.song.measureHeaders[1].repeatAlternative).toBe(1);
    expect(withoutClose.song.measureHeaders[3].repeatAlternative).toBe(6);
    expect(withoutClose.song.measureHeaders[2].repeatClose).toBe(0);
    roundTrip(withoutClose, repeatStudy());
  });

  it('owns number arrays, ignores no-op edits and mixes repeat edits with note edits in save order', () => {
    const numbers = [2, 8], initial = editor();
    let state = setEndingNumbers(initial, numbers);
    numbers[0] = 7;
    expect(repeatState(state).numbers).toEqual([2, 8]);
    expect(setEndingNumbers(state, [8, 2])).toBe(state);
    state = setFret(state, 12);
    state = setRepeatPlays(state, 101);
    expect(setRepeatPlays(state, 101)).toBe(state);
    roundTrip(state);
    const reopened = editor(writeTgFile(source, state.edits));
    expect(repeatState(reopened)).toMatchObject({ plays: 101, numbers: [2, 8] });
    expect(reopened.signature).toBe('[]');
  });

  it('rejects malformed header payloads before saving', () => {
    const invalid: unknown[] = [
      { kind: 'repeat.start', measure: -1, enabled: true }, { kind: 'repeat.start', measure: 999, enabled: true },
      { kind: 'repeat.start', measure: 0, enabled: 'true' }, { kind: 'repeat.end', measure: 0, plays: 1 },
      { kind: 'repeat.end', measure: 0, plays: 102 }, { kind: 'repeat.end', measure: 0, plays: 2.5 },
      { kind: 'repeat.end', measure: 0, plays: NaN }, { kind: 'repeat.end', measure: 0, plays: '3' },
      { kind: 'repeat.ending', measure: 0, numbers: [0] }, { kind: 'repeat.ending', measure: 0, numbers: [9] },
      { kind: 'repeat.ending', measure: 0, numbers: [1, 1] }, { kind: 'repeat.ending', measure: 0, numbers: null },
      { kind: 'repeat.ending', measure: 0, numbers: ['1'] }, { kind: 'repeat.ending', measure: 0.5, numbers: [1] },
    ];
    for (const edit of invalid) expect(() => writeTgFile(source, [edit as SongEdit])).toThrow();
    expect(editor().past).toEqual([]);
  });

  it('preserves extension attributes, comments, unrelated header/track XML and other archive entries', () => {
    const entries = unzipSync(source);
    const original = xml(source).replace('<TGMeasureHeader>', '<TGMeasureHeader future="header">\r\n<!--keep--><futureHeader/>')
      .replace('</TGMeasureHeader>', '<repeatOpen future="open"/><repeatClose future="close">2<!--count--><futureCount/></repeatClose><repeatAlternative future="ending"><alternative future="pass">1</alternative><!--passes--><futureEnding/></repeatAlternative></TGMeasureHeader>');
    entries['content.xml'] = new TextEncoder().encode(original);
    entries['other.bin'] = new Uint8Array([5, 10, 42]);
    const input = zipSync(entries);
    let state = editor(input);
    expect(repeatState(state)).toMatchObject({ start: true, plays: 3, numbers: [1] });
    state = setRepeatPlays(state, 5);
    state = setEndingNumbers(state, [2, 3, 8]);
    roundTrip(state, input);
    const output = writeTgFile(input, state.edits), saved = xml(output);
    for (const token of ['future="header"', '\r\n<!--keep-->', '<futureHeader/>', 'future="open"', 'future="close"', '<!--count-->',
      '<futureCount/>', 'future="ending"', 'future="pass"', '<!--passes-->', '<futureEnding/>']) expect(saved).toContain(token);
    expect(saved.match(/<TGTrack\b.*?<\/TGTrack>/gs)).toEqual(original.match(/<TGTrack\b.*?<\/TGTrack>/gs));
    expect(saved.match(/<TGMeasureHeader\b.*?<\/TGMeasureHeader>/gs)!.slice(1)).toEqual(original.match(/<TGMeasureHeader\b.*?<\/TGMeasureHeader>/gs)!.slice(1));
    expect(unzipSync(output)['other.bin']).toEqual(entries['other.bin']);
  });

  it('fills self-closing repeat elements and removes them without disturbing other fields', () => {
    const entries = unzipSync(source);
    entries['content.xml'] = new TextEncoder().encode(xml(source).replace('</TGMeasureHeader>',
      '<repeatClose future="empty"/><repeatAlternative future="empty"/></TGMeasureHeader>'));
    const input = zipSync(entries);
    let state = setEndingNumbers(setRepeatPlays(editor(input), 3), [8]);
    roundTrip(state, input);
    state = clearRepeats(state);
    roundTrip(state, input);
  });
});
