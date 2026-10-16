import { readFileSync } from "node:fs";
import { unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { applySongEdits, beatKey, createEditor, cursorNote, deleteNote, durationPrecise, rearrangeColumns, redoEdit,
  selectEditorCursor, selectedColumns, setDuration, setFret, undoEdit, type EditorCursor } from "../shared/editor";
import { parseTgFile } from "../shared/tg-reader";
import { writeTgFile } from "../shared/tg-writer";
import { exportMidi } from "../shared/midi-export";
import { WHOLE_PRECISE_DURATION } from "../shared/model";
import { resolveTabKey } from "../shared/tab-commands";

const source = new Uint8Array(readFileSync('china.tg'));
const cursor: EditorCursor = { track: 0, measure: 1, beat: 0, voice: 0, string: 1 };
const quarter = { value: 4, dotted: false, doubleDotted: false, division: { enters: 1, times: 1 } };
function fixture() {
  let state = selectEditorCursor(createEditor('test', 'song.tg', parseTgFile(source)), cursor);
  state = setFret(setDuration(state, quarter), 7);
  state = setFret(selectEditorCursor(state, { ...cursor, beat: 1 }), 9);
  return selectEditorCursor(state, cursor);
}
const active = (state: ReturnType<typeof fixture>) => state.song.tracks[0].measures[1].beats.filter(b => !b.voices[0].empty);
const frets = (state: ReturnType<typeof fixture>) => active(state).map(b => b.voices[0].notes[0]?.value ?? null);
function roundTrip(state: ReturnType<typeof fixture>, input = source) {
  expect(parseTgFile(writeTgFile(input, state.edits))).toEqual(state.song);
  expect(applySongEdits(state.original, state.edits)).toEqual(state.song);
}

describe('column transactions', () => {
  it('moves a column, its duration and identities together and restores selection on undo', () => {
    let state = fixture();
    const columnId = state.identities.columns[beatKey(cursor)];
    const noteId = state.identities.notes[`${beatKey(cursor)}:0`];
    const moved = rearrangeColumns(state, 1);
    expect(frets(moved)).toEqual([9, 7, null, null]);
    expect(moved.selection?.beat).toBe(1);
    expect(moved.identities.columns[beatKey(moved.selection!)]).toBe(columnId);
    expect(moved.identities.notes[`${beatKey(moved.selection!)}:0`]).toBe(noteId);
    expect(moved.past.length).toBe(state.past.length + 1);
    expect(undoEdit(moved).song).toEqual(state.song);
    expect(undoEdit(moved).selection).toEqual(cursor);
    expect(redoEdit(undoEdit(moved)).selection).toEqual(moved.selection);
    roundTrip(moved);
  });

  it('duplicates into trailing rest space, selects the fresh identity and preserves the original', () => {
    const state = fixture();
    const copied = rearrangeColumns(state, 1, true);
    expect(frets(copied)).toEqual([7, 7, 9, null]);
    expect(copied.selection?.beat).toBe(1);
    expect(copied.identities.columns[beatKey(copied.selection!)]).not.toBe(state.identities.columns[beatKey(cursor)]);
    expect(copied.identities.columns[beatKey(cursor)]).toBe(state.identities.columns[beatKey(cursor)]);
    expect(active(copied).reduce((n, b) => n + durationPrecise(b.voices[0].duration), 0)).toBe(WHOLE_PRECISE_DURATION);
    const movedCopy = rearrangeColumns(copied, -1);
    expect(movedCopy.selection?.beat).toBe(0);
    expect(movedCopy.identities.columns[beatKey(movedCopy.selection!)]).toBe(copied.identities.columns[beatKey(copied.selection!)]);
    roundTrip(movedCopy);
    expect(exportMidi(copied.song).filter(e => e.type === 'note_on')).toHaveLength(12);
  });

  it('moves and duplicates a selected range as one transaction', () => {
    let state = selectEditorCursor(fixture(), { ...cursor, beat: 1 }, true);
    expect(selectedColumns(state)).toHaveLength(2);
    const moved = rearrangeColumns(state, 1);
    expect(frets(moved)).toEqual([null, 7, 9, null]);
    expect(moved.anchor?.beat).toBe(1);
    expect(moved.selection?.beat).toBe(2);
    roundTrip(moved);
    const copied = rearrangeColumns(state, -1, true);
    expect(frets(copied)).toEqual([7, 9, 7, 9]);
    expect(copied.anchor?.beat).toBe(0);
    expect(copied.selection?.beat).toBe(1);
    roundTrip(copied);
  });

  it('keeps variable durations attached during movement and splits a partially consumed rest', () => {
    let state = fixture();
    state = selectEditorCursor(state, { ...cursor, beat: 1 });
    state = setDuration(state, { ...quarter, value: 2 });
    const moved = rearrangeColumns(state, -1);
    expect(active(moved).map(b => b.voices[0].duration.value)).toEqual([2, 4, 4]);
    expect(frets(moved)).toEqual([9, 7, null]);
    roundTrip(moved);
    let short = selectEditorCursor(createEditor('test', 'song.tg', parseTgFile(source)), cursor);
    short = setFret(setDuration(short, { ...quarter, value: 8 }), 12);
    roundTrip(rearrangeColumns(short, -1, true));
  });

  it('rejects insufficient space, cross-bar ranges, multiple voices and linked notes atomically', () => {
    const state = fixture();
    expect(rearrangeColumns(state, -1)).toBe(state);
    const filled = rearrangeColumns(rearrangeColumns(state, 1, true), 1, true);
    expect(() => rearrangeColumns(filled, 1, true)).toThrow('trailing rest');
    const across = selectEditorCursor(state, { ...cursor, measure: 0 }, true);
    expect(() => rearrangeColumns(across, 1)).toThrow('one measure');
    const multi = fixture();
    multi.song.tracks[0].measures[1].beats[0].voices[1].empty = false;
    expect(() => rearrangeColumns(multi, 1)).toThrow('one voice');
    const tied = fixture();
    tied.song.tracks[0].measures[1].beats[1].voices[0].notes[0].tiedNote = true;
    expect(() => rearrangeColumns(tied, 1)).toThrow('Ties');
    expect(frets(state)).toEqual([7, 9, null, null]);
  });

  it('clears a rectangular cell range without touching other strings, with one undo step', () => {
    let state = fixture();
    state = setFret(selectEditorCursor(state, { ...cursor, string: 2 }), 5);
    state = selectEditorCursor(state, cursor);
    state = selectEditorCursor(state, { ...cursor, beat: 1 }, true);
    const cleared = deleteNote(state);
    expect(cursorNote(cleared.song, cursor)).toBeUndefined();
    expect(cursorNote(cleared.song, { ...cursor, beat: 1 })).toBeUndefined();
    expect(cursorNote(cleared.song, { ...cursor, string: 2 })?.value).toBe(5);
    expect(cleared.past.length).toBe(state.past.length + 1);
    expect(undoEdit(cleared).song).toEqual(state.song);
    roundTrip(cleared);
  });

  it('preserves opaque note/beat/measure data when moving and duplicating source XML', () => {
    const entries = unzipSync(writeTgFile(source, fixture().edits));
    const text = new TextDecoder().decode(entries['content.xml']).replace('string="1" value="7" velocity="95"', 'string="1" value="7" velocity="95" future="keep &amp; clone"')
      .replace('</TGSong>', '<future-song keep="yes"/></TGSong>');
    entries['content.xml'] = new TextEncoder().encode(text);
    entries['future.bin'] = new Uint8Array([4, 7, 255]);
    const input = zipSync(entries);
    let state = selectEditorCursor(createEditor('test', 'song.tg', parseTgFile(input)), cursor);
    state = rearrangeColumns(rearrangeColumns(state, 1, true), 1);
    roundTrip(state, input);
    const output = unzipSync(writeTgFile(input, state.edits));
    expect(new TextDecoder().decode(output['content.xml']).match(/future="keep &amp; clone"/g)).toHaveLength(2);
    expect(output['future.bin']).toEqual(entries['future.bin']);
    const undone = undoEdit(undoEdit(state));
    expect(writeTgFile(input, undone.edits)).toEqual(input);
  });
});

describe('tab keymap', () => {
  const key = (key: string, extra = {}) => resolveTabKey({ key, altKey: false, shiftKey: false, ctrlKey: false, metaKey: false, isComposing: false, ...extra });
  it('distinguishes navigation, selection extension, moves and duplicates', () => {
    expect(key('ArrowLeft')).toMatchObject({ kind: 'navigate', extend: false });
    expect(key('ArrowLeft', { shiftKey: true })).toMatchObject({ kind: 'navigate', extend: true });
    expect(key('ArrowLeft', { altKey: true })).toEqual({ kind: 'command', id: 'column.left' });
    expect(key('ArrowRight', { altKey: true, shiftKey: true })).toEqual({ kind: 'command', id: 'column.copyRight' });
    expect(key('7')).toEqual({ kind: 'digit', digit: '7' });
    expect(key('z', { ctrlKey: true })).toBeNull();
    expect(key('7', { isComposing: true })).toBeNull();
  });
});
