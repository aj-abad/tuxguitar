import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { applySongEdits, beatAddresses, createEditor, cursorNote, deleteNote, durationPrecise, moveSelection,
  redoEdit, setDuration, setFret, setRest, undoEdit, voiceAt, type EditorCursor, type SongEdit } from "../shared/editor";
import { PRECISE_FACTOR, WHOLE_PRECISE_DURATION, type TGDuration } from "../shared/model";
import { parseTgFile } from "../shared/tg-reader";
import { writeTgFile } from "../shared/tg-writer";
import { exportMidi } from "../shared/midi-export";
import { tgSongToScore } from "../shared/tg-to-alphatab";

const source = new Uint8Array(readFileSync(resolve(__dirname, "../china.tg")));
const start: EditorCursor = { track: 0, measure: 1, beat: 0, voice: 0, string: 1 };
const duration = (value: number, dots = 0, enters = 1, times = 1): TGDuration => ({ value, dotted: dots === 1, doubleDotted: dots === 2, division: { enters, times } });
const editor = () => ({ ...createEditor("id", "song.tg", parseTgFile(source)), selection: start });
const active = (state: ReturnType<typeof editor>) => state.song.tracks[0]!.measures[1]!.beats.filter(b => !b.voices[0]!.empty);
const text = (bytes: Uint8Array) => new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);

describe("note entry and rests", () => {
  it("enters a two-digit note into a rest as one undo step and replays it for save/playback", () => {
    const original = editor();
    const changed = setFret(setFret(original, 1, "digits"), 12, "digits");
    expect(changed.past).toHaveLength(1);
    expect(cursorNote(changed.song, start)?.value).toBe(12);
    expect(voiceAt(original.song, start).notes).toEqual([]);
    expect(undoEdit(changed).song).toBe(original.song);
    expect(redoEdit(undoEdit(changed)).song).toEqual(changed.song);
    expect(applySongEdits(original.original, changed.edits)).toEqual(changed.song);
    expect(parseTgFile(writeTgFile(source, changed.edits))).toEqual(changed.song);
    expect(exportMidi(changed.song)).toContainEqual({ type: "note_on", ch: 2, tick: 3840, note: 76, vel: 95 });
  });

  it("adds a chord, deletes one string, and converts the chord to a selectable rest", () => {
    let state = setFret(editor(), 7);
    state = { ...state, selection: { ...start, string: 2 } };
    state = setFret(state, 5);
    expect(voiceAt(state.song, start).notes.map(n => [n.string, n.value])).toEqual([[1, 7], [2, 5]]);
    const deleted = deleteNote(state);
    expect(voiceAt(deleted.song, start).notes.map(n => n.string)).toEqual([1]);
    expect(deleted.selection).toEqual(state.selection);
    expect(undoEdit(deleted).song).toEqual(state.song);
    const rest = setRest(state);
    expect(voiceAt(rest.song, start)).toMatchObject({ empty: false, notes: [] });
    expect(parseTgFile(writeTgFile(source, rest.edits))).toEqual(rest.song);
    expect(setRest(rest)).toBe(rest);
  });

  it("keeps saved-state tracking correct across structural undo, redo and branching", () => {
    let state = setFret(setDuration(editor(), duration(4)), 7);
    state = { ...state, savedSignature: state.signature };
    const undone = undoEdit(state);
    expect(undone.signature).not.toBe(state.savedSignature);
    expect(redoEdit(undone).signature).toBe(state.savedSignature);
    const branch = setFret(undone, 5);
    expect(branch.future).toEqual([]);
    expect(applySongEdits(branch.original, branch.edits)).toEqual(branch.song);
    expect(setFret(setFret(createEditor("id", "song.tg", parseTgFile(source)), 7), 15).signature).toBe("[]");
  });

  it("navigates across rests and every string, preserving the selected string", () => {
    const state = { ...editor(), selection: { ...start, measure: 0, beat: 8, string: 3 } };
    expect(moveSelection(state, "ArrowRight")).toEqual({ ...start, string: 3 });
    expect(moveSelection(state, "ArrowUp")?.string).toBe(2);
    expect(moveSelection(state, "ArrowDown")?.string).toBe(4);
  });

  it("repairs the next tie when its origin is deleted or separated by a new rest", () => {
    const song = parseTgFile(source);
    const first = { ...start, measure: 0 };
    song.tracks[0]!.measures[0]!.beats[1]!.voices[0]!.notes[0]!.tiedNote = true;
    const state = { ...createEditor("id", "song.tg", song), selection: first };
    expect(cursorNote(deleteNote(state).song, { ...first, beat: 1 })?.tiedNote).toBe(false);
    const shortened = setDuration(state, duration(32));
    expect(cursorNote(shortened.song, { ...first, beat: 2 })?.tiedNote).toBe(false);
    expect(undoEdit(shortened).song).toEqual(song);
  });
});

describe("duration and measure integrity", () => {
  it("splits a whole rest into quarters and grows a note into neighboring rest space", () => {
    const original = editor();
    const quarters = setDuration(original, duration(4));
    const position = original.song.measureHeaders[1]!.start * PRECISE_FACTOR;
    expect(active(quarters).map(b => b.preciseStart)).toEqual([0, 1, 2, 3].map(n => position + n * WHOLE_PRECISE_DURATION / 4));
    expect(quarters.song.tracks[0]!.measures[0]).toBe(original.song.tracks[0]!.measures[0]);
    const halves = setDuration(setFret(quarters, 7), duration(2));
    expect(active(halves).map(b => b.voices[0]!.duration.value)).toEqual([2, 2]);
    expect(voiceAt(halves.song, start).notes[0]!.value).toBe(7);
    expect(parseTgFile(writeTgFile(source, halves.edits))).toEqual(halves.song);
    const mapped: number[] = [];
    tgSongToScore(halves.song, undefined, (_beat, a) => { if (a.measure === 1) mapped.push(a.beat); });
    expect(mapped).toEqual([0, 2]);
    expect(undoEdit(quarters).song).toBe(original.song);
  });

  it.each([[4, 1, 1, 1], [4, 2, 1, 1], [4, 0, 3, 2], [8, 0, 5, 4], [64, 0, 1, 1]])(
    "fills the measure exactly for duration %s, dots %s, division %s:%s", (value, dots, enters, times) => {
      const state = setDuration(editor(), duration(value!, dots, enters, times));
      expect(active(state).reduce((sum, beat) => sum + durationPrecise(beat.voices[0]!.duration), 0)).toBe(WHOLE_PRECISE_DURATION);
      expect(parseTgFile(writeTgFile(source, state.edits))).toEqual(state.song);
    });

  it("rejects collisions and barline overflow without modifying history or the source", () => {
    const state = createEditor("id", "song.tg", parseTgFile(source));
    expect(() => setDuration(state, duration(8))).toThrow("overlap");
    expect(() => setDuration(editor(), duration(1, 1))).toThrow("barline");
    expect(state.past).toEqual([]);
    expect(state.edits).toEqual([]);
  });

  it("keeps an independent second voice and its MIDI timing unchanged", () => {
    const state = editor();
    const firstBeat = state.song.tracks[0]!.measures[1]!.beats[0]!;
    const note = { ...state.song.tracks[0]!.measures[0]!.beats[0]!.voices[0]!.notes[0]!, string: 6, value: 0 };
    firstBeat.voices[1] = { direction: 2, empty: false, duration: duration(1), notes: [note] };
    const changed = setDuration(state, duration(4));
    expect(changed.song.tracks[0]!.measures[1]!.beats[0]!.voices[1]).toBe(firstBeat.voices[1]);
    const lowEvents = (s: typeof state.song) => exportMidi(s).filter(e => 'note' in e && e.note === 40);
    expect(lowEvents(changed.song)).toEqual(lowEvents(state.song));
    expect(beatAddresses(changed.song).filter(a => a.measure === 1 && a.voice === 1)).toHaveLength(1);
  });

  it.each([0, 3, 128, NaN, Infinity])("rejects invalid duration %s across the IPC reducer", value => {
    expect(() => applySongEdits(editor().song, [{ kind: "duration.set", address: start, duration: duration(value) }])).toThrow();
  });
});

describe("structural source preservation", () => {
  it.each(["\n", "\r\n", "\r"])("preserves unknown markup, effects, attributes and archive data with %j lines", newline => {
    const entries = unzipSync(source);
    let xml = text(entries["content.xml"]!);
    xml = "\uFEFF" + xml.replace(/></g, ">" + newline + "<")
      .replace("<comments/>", '<comments><![CDATA[ <note value="88"/> café ]]></comments>')
      .replace('<note string="1" value="15" velocity="95"/>', '<note future="value=\'99\' >" string="1" value="15" velocity="95"><palmMute/><future keep="yes"/></note>')
      .replace('<voice empty="false">', '<voice future="preserve" empty="false"><unknown><!-- keep --></unknown>')
      .replace('</TGTrack>', '<unknown-track data="keep &amp; retain"/></TGTrack>');
    entries["content.xml"] = new TextEncoder().encode(xml);
    entries["attachments/opaque.bin"] = new Uint8Array([0, 255, 3, 7]);
    const input = zipSync(entries);
    let state = { ...createEditor("id", "song.tg", parseTgFile(input)), selection: start };
    state = setFret(setDuration(state, duration(4)), 7);
    const result = writeTgFile(input, state.edits);
    expect(parseTgFile(result)).toEqual(state.song);
    const output = unzipSync(result);
    const savedXml = text(output["content.xml"]!);
    expect(savedXml.slice(0, savedXml.indexOf('<voice future="preserve"'))).toBe(xml.slice(0, xml.indexOf('<voice future="preserve"')));
    expect(savedXml).toContain('<voice future="preserve" empty="false"><unknown><!-- keep --></unknown>');
    expect(savedXml).toContain('<unknown-track data="keep &amp; retain"/>');
    expect(output["attachments/opaque.bin"]).toEqual(entries["attachments/opaque.bin"]);
    expect(writeTgFile(input, undoEdit(undoEdit(state)).edits)).toEqual(input);
  });

  it("rejects malformed structural operations before any file can be saved", () => {
    const invalid = [
      { kind: "note.set", cursor: { ...start, string: 99 }, fret: 3 },
      { kind: "note.set", cursor: start, fret: -1 },
      { kind: "note.remove", cursor: { ...start, voice: 5 } },
      { kind: "duration.set", address: start, duration: { ...duration(4), division: { enters: 0, times: 1 } } },
      { kind: "anything", cursor: start },
    ];
    for (const edit of invalid) expect(() => writeTgFile(source, [edit as SongEdit])).toThrow();
  });
});
