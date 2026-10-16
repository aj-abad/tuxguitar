import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createEditor, moveSelection, noteAt, redoEdit, selectedColumns, selectEditorCursor, setFret, undoEdit, type NoteAddress, type EditorCursor } from "../shared/editor";
import { parseTgFile } from "../shared/tg-reader";
import { tgSongToScore } from "../shared/tg-to-alphatab";
import { exportMidi } from "../shared/midi-export";

const sample = () => parseTgFile(readFileSync(resolve(__dirname, "../china.tg")));
const first: NoteAddress = { track: 0, measure: 0, beat: 0, voice: 0, note: 0 };
const cursor: EditorCursor = { track: 0, measure: 0, beat: 0, voice: 0, string: 1 };

describe("fret editing", () => {
  it("changes one note immutably and groups two digit entry into one undo step", () => {
    const song = sample();
    let state = createEditor("id", "song.tg", song);
    state = setFret(state, 1, "digits");
    state = setFret(state, 12, "digits");
    expect(noteAt(song, first).value).toBe(15);
    expect(noteAt(state.song, first).value).toBe(12);
    expect(state.past).toHaveLength(1);
    expect(state.song.measureHeaders).toBe(song.measureHeaders);
    const undone = undoEdit(state);
    expect(undone.song).toEqual(song);
    expect(undone.signature).toBe(undone.savedSignature);
    expect(redoEdit(undone).song).toEqual(state.song);
  });

  it("tracks the saved state through undo, redo and branching", () => {
    let state = setFret(createEditor("id", "song.tg", sample()), 7);
    state = { ...state, savedSignature: state.signature };
    const undone = undoEdit(state);
    expect(undone.signature).not.toBe(undone.savedSignature);
    expect(redoEdit(undone).signature).toBe(state.savedSignature);
    const branch = setFret(undone, 9);
    expect(branch.future).toEqual([]);
    expect(redoEdit(branch)).toBe(branch);
  });

  it.each([-1, 30, 1.5, NaN, Infinity])("rejects invalid fret %s", fret => {
    const state = createEditor("id", "song.tg", sample());
    expect(() => setFret(state, fret)).toThrow("fret from 0 to 29");
    expect(state.past).toEqual([]);
  });

  it("changes every member of a tie as one command", () => {
    const song = sample();
    const beats = song.tracks[0]!.measures[0]!.beats;
    beats[1]!.voices[0]!.notes[0]!.tiedNote = true;
    beats[2]!.voices[0]!.notes[0]!.tiedNote = true;
    const state = { ...createEditor("id", "song.tg", song), selection: { ...cursor, beat: 1 } };
    const changed = setFret(state, 3);
    expect([0, 1, 2, 3].map(beat => noteAt(changed.song, { ...first, beat }).value)).toEqual([3, 3, 3, 15]);
    expect(undoEdit(changed).song).toEqual(song);
    expect(undoEdit(changed).selection).toEqual(state.selection);
  });

  it("navigates beats and empty strings without using renderer indices", () => {
    const song = sample();
    song.tracks[0]!.measures[0]!.beats[0]!.voices[0]!.notes.push({ ...noteAt(song, first), string: 3 });
    const state = createEditor("id", "song.tg", song);
    expect(moveSelection(state, "ArrowRight")).toEqual({ ...cursor, beat: 1 });
    expect(moveSelection(state, "ArrowDown")).toEqual({ ...cursor, string: 2 });
    expect(moveSelection(state, "ArrowLeft")).toEqual(cursor);
  });

  it("skips inactive columns and empty measures without switching voice, and selects ranges in either direction", () => {
    const song = sample();
    song.tracks[0].measures[0].beats[1].voices[0].empty = true;
    song.tracks[0].measures.splice(1, 0, { beats: [] });
    let state = createEditor('id', 'song.tg', song);
    expect(moveSelection(state, 'ArrowRight')).toEqual({ ...cursor, beat: 2 });
    state = selectEditorCursor(state, { ...cursor, beat: 8 });
    expect(moveSelection(state, 'ArrowRight')).toEqual({ ...cursor, measure: 2 });
    state = selectEditorCursor(state, { ...cursor, measure: 2 });
    expect(moveSelection(state, 'ArrowLeft')).toEqual({ ...cursor, beat: 8 });
    expect(moveSelection(state, 'ArrowRight')).toEqual(state.selection);
    state = selectEditorCursor(state, cursor, true);
    expect(selectedColumns(state)).toHaveLength(9);
    expect(selectedColumns(state).every(a => a.voice === 0 && a.measure !== 1)).toBe(true);
    state = selectEditorCursor(state, cursor);
    state = selectEditorCursor(state, { ...cursor, measure: 2 }, true);
    expect(selectedColumns(state)).toHaveLength(9);
    state = selectEditorCursor(state, { ...cursor, beat: 2 });
    expect(moveSelection(state, 'Home')).toEqual(cursor);
    expect(moveSelection(state, 'End')).toEqual({ ...cursor, beat: 8 });
  });

  it("maps alphaTab notes back to TG voices after empty voices are skipped", () => {
    const song = sample();
    const beats = song.tracks[0]!.measures[0]!.beats;
    for (const beat of beats) beat.voices.reverse();
    const addresses: NoteAddress[] = [];
    const score = tgSongToScore(song, (_note, address) => addresses.push(address));
    expect(score.tracks[0]!.staves[0]!.bars[0]!.voices[0]!.beats[0]!.notes[0]!.fret).toBe(15);
    expect(addresses[0]).toEqual({ ...first, voice: 1 });
    expect(addresses).toHaveLength(9);
  });

  it("generates playback from the edited model and restores it on undo", () => {
    const song = sample();
    const state = setFret(createEditor("id", "song.tg", song), 4);
    expect(exportMidi(state.song)).not.toEqual(exportMidi(song));
    expect(exportMidi(undoEdit(state).song)).toEqual(exportMidi(song));
  });
});
