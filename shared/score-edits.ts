import { PRECISE_FACTOR, WHOLE_PRECISE_DURATION, type TGBeat, type TGDuration, type TGEffectPoints, type TGNote, type TGSong, type TGVoice, type TGTabLayout } from "./model";
import { validateTabDesign } from './tab-design';
import { modelSignature } from "./model-signature";
import { changeColumns, type ColumnSource } from "./tab-columns";
import { techniquePatches, type TechniqueEdit } from './technique-edits';
import { repeatPatches, type RepeatEdit } from './repeat-edits';

/** Indices belong to the current TG model, never compacted renderer indices. */
export interface BeatAddress { track: number; measure: number; beat: number; voice: number }
export interface NoteAddress extends BeatAddress { note: number }
export interface EditorCursor extends BeatAddress { string: number }
export interface FretEdit { address: NoteAddress; fret: number }
export type SongEdit = FretEdit | TechniqueEdit | RepeatEdit
  | { kind: 'layout.set'; track: number; layout: TGTabLayout | null }
  | { kind: "note.set"; cursor: EditorCursor; fret: number }
  | { kind: "note.remove"; cursor: EditorCursor }
  | { kind: "voice.rest"; address: BeatAddress }
  | { kind: "duration.set"; address: BeatAddress; duration: TGDuration }
  | { kind: "column.move" | "column.duplicate"; address: BeatAddress; lastBeat: number; direction: -1 | 1 };

/** Validated changes also drive the source-preserving XML writer. */
export type ScorePatch =
  | { kind: 'track.layout'; track: number; layout: TGTabLayout | undefined }
  | { kind: 'header.repeat'; measure: number; field: 'repeatOpen'; value: boolean }
  | { kind: 'header.repeat'; measure: number; field: 'repeatClose' | 'repeatAlternative'; value: number }
  | { kind: "note.fret"; address: NoteAddress; fret: number }
  | { kind: "note.untie"; address: NoteAddress }
  | { kind: "note.tie"; address: NoteAddress; tied: boolean }
  | { kind: "note.effect"; address: NoteAddress; effect: 'slide' | 'hammer'; value: boolean }
  | { kind: "note.bend"; address: NoteAddress; bend: TGEffectPoints | undefined }
  | { kind: "note.add"; address: NoteAddress; note: TGNote }
  | { kind: "note.remove"; address: NoteAddress }
  | { kind: "voice.duration"; address: BeatAddress; duration: TGDuration }
  | { kind: "voice.empty"; address: BeatAddress; empty: boolean }
  | { kind: "voice.add"; address: BeatAddress; voice: TGVoice }
  | { kind: "beat.add"; address: BeatAddress; beat: TGBeat }
  | { kind: "measure.columns"; address: BeatAddress; columns: ColumnSource[] };

export const DURATION_VALUES = [1, 2, 4, 8, 16, 32, 64];
export const beatKey = (a: BeatAddress) => `${a.track}:${a.measure}:${a.beat}:${a.voice}`;
export const noteKey = (a: NoteAddress) => `${beatKey(a)}:${a.note}`;
export const cursorKey = (a: EditorCursor) => `${beatKey(a)}:s${a.string}`;

export function voiceAt(song: TGSong, a: BeatAddress): TGVoice {
  if (!a || ![a.track, a.measure, a.beat, a.voice].every(n => Number.isInteger(n) && n >= 0)) throw new Error("Invalid beat selection.");
  const voice = song.tracks[a.track]?.measures[a.measure]?.beats[a.beat]?.voices[a.voice];
  if (!voice) throw new Error("The selected beat no longer exists.");
  return voice;
}

export function noteAt(song: TGSong, a: NoteAddress): TGNote {
  const voice = voiceAt(song, a);
  const note = Number.isInteger(a.note) && a.note >= 0 ? voice.notes[a.note] : undefined;
  if (!note) throw new Error("The selected note no longer exists.");
  return note;
}

export function cursorNote(song: TGSong, cursor: EditorCursor): TGNote | undefined {
  return voiceAt(song, cursor).notes.find(note => note.string === cursor.string);
}

export function beatAddresses(song: TGSong): BeatAddress[] {
  const result: BeatAddress[] = [];
  song.tracks.forEach((t, track) => t.measures.forEach((m, measure) => m.beats.forEach((b, beat) =>
    b.voices.forEach((v, voice) => { if (!v.empty) result.push({ track, measure, beat, voice }); }))));
  return result;
}

export function noteAddresses(song: TGSong): NoteAddress[] {
  return beatAddresses(song).flatMap(a => voiceAt(song, a).notes.map((_, note) => ({ ...a, note })));
}

export function validateCursor(song: TGSong, cursor: EditorCursor): void {
  if (voiceAt(song, cursor).empty) throw new Error("Select a note or rest first.");
  if (!song.tracks[cursor.track]!.strings.some(s => s.number === cursor.string)) throw new Error("Select a fretted string.");
}

function validateFretValue(song: TGSong, cursor: EditorCursor, fret: number): void {
  validateCursor(song, cursor);
  const max = song.tracks[cursor.track]!.maxFret;
  if (!Number.isInteger(fret) || fret < 0 || fret > max) throw new Error(`Enter a fret from 0 to ${max}.`);
}

export function durationPrecise(duration: TGDuration): number {
  if (!duration || !DURATION_VALUES.includes(duration.value) || typeof duration.dotted !== "boolean" ||
      typeof duration.doubleDotted !== "boolean" || (duration.dotted && duration.doubleDotted)) throw new Error("Choose a duration from whole to 64th notes.");
  const { enters = 1, times = 1 } = duration.division ?? {};
  if (![enters, times].every(n => Number.isInteger(n) && n > 0 && n <= 64)) throw new Error("Invalid tuplet duration.");
  const length = WHOLE_PRECISE_DURATION / duration.value * (duration.doubleDotted ? 1.75 : duration.dotted ? 1.5 : 1) * times / enters;
  if (!Number.isSafeInteger(length) || length <= 0) throw new Error("This rhythm cannot be represented exactly.");
  return length;
}

function blankVoice(): TGVoice {
  return { direction: 1, empty: true, duration: { value: 4, dotted: false, doubleDotted: false }, notes: [] };
}

function newNote(string: number, fret: number): TGNote {
  return { string, value: fret, velocity: 95, tiedNote: false, altEnharmonic: false,
    effect: { vibrato: false, deadNote: false, slide: false, hammer: false, ghostNote: false,
      accentuatedNote: false, heavyAccentuatedNote: false, palmMute: false, staccato: false,
      tapping: false, slapping: false, popping: false, fadeIn: false, letRing: false } };
}

function applyPatch(song: TGSong, patch: ScorePatch): TGSong {
  if (patch.kind === 'track.layout') {
    const tracks = song.tracks.slice();
    tracks[patch.track] = { ...tracks[patch.track], tabLayout: patch.layout };
    return { ...song, tracks };
  }
  if (patch.kind === 'header.repeat') {
    const measureHeaders = song.measureHeaders.slice();
    measureHeaders[patch.measure] = { ...measureHeaders[patch.measure], [patch.field]: patch.value };
    return { ...song, measureHeaders };
  }
  const a = patch.address;
  const tracks = song.tracks.slice();
  const track = { ...tracks[a.track]!, measures: tracks[a.track]!.measures.slice() };
  tracks[a.track] = track;
  const measure = { ...track.measures[a.measure]!, beats: track.measures[a.measure]!.beats.slice() };
  track.measures[a.measure] = measure;
  if (patch.kind === "measure.columns") measure.beats = patch.columns.map(column => column.beat);
  else if (patch.kind === "beat.add") measure.beats.splice(a.beat, 0, patch.beat);
  else {
    const beat = { ...measure.beats[a.beat]!, voices: measure.beats[a.beat]!.voices.slice() };
    measure.beats[a.beat] = beat;
    if (patch.kind === "voice.add") beat.voices.splice(a.voice, 0, patch.voice);
    else {
      const voice = { ...beat.voices[a.voice]!, notes: beat.voices[a.voice]!.notes.slice() };
      beat.voices[a.voice] = voice;
      switch (patch.kind) {
        case "voice.duration": voice.duration = patch.duration; break;
        case "voice.empty": voice.empty = patch.empty; break;
        case "note.add": voice.notes.splice(patch.address.note, 0, patch.note); break;
        case "note.remove": voice.notes.splice(patch.address.note, 1); break;
        case "note.fret": voice.notes[patch.address.note] = { ...voice.notes[patch.address.note]!, value: patch.fret }; break;
        case "note.untie": voice.notes[patch.address.note] = { ...voice.notes[patch.address.note]!, tiedNote: false }; break;
        case "note.tie": voice.notes[patch.address.note] = { ...voice.notes[patch.address.note]!, tiedNote: patch.tied }; break;
        case "note.effect": case "note.bend": {
          const note = voice.notes[patch.address.note]!;
          voice.notes[patch.address.note] = { ...note, effect: { ...note.effect,
            ...(patch.kind === 'note.bend' ? { bend: patch.bend } : { [patch.effect]: patch.value }) } };
          break;
        }
      }
    }
  }
  return { ...song, tracks };
}

function sameStringNotes(song: TGSong, cursor: EditorCursor): NoteAddress[] {
  return noteAddresses(song).filter(a => a.track === cursor.track && a.voice === cursor.voice && noteAt(song, a).string === cursor.string);
}

export function applySongEdits(song: TGSong, edits: SongEdit[], onPatch?: (patch: ScorePatch) => void): TGSong {
  if (!Array.isArray(edits) || edits.length > 100_000) throw new Error("Invalid song edits.");
  let result = song;
  const emit = (patch: ScorePatch) => { result = applyPatch(result, patch); onPatch?.(patch); };
  const untieNext = (cursor: EditorCursor) => {
    const next = sameStringNotes(result, cursor).find(a => a.measure > cursor.measure || (a.measure === cursor.measure && a.beat > cursor.beat));
    if (next && noteAt(result, next).tiedNote) emit({ kind: "note.untie", address: next });
  };
  for (const edit of edits) {
    if (!edit || typeof edit !== "object") throw new Error("Invalid song edit.");
    if (!("kind" in edit)) {
      const note = noteAt(result, edit.address);
      validateFretValue(result, { ...edit.address, string: note.string }, edit.fret);
      if (note.value !== edit.fret) emit({ kind: "note.fret", address: edit.address, fret: edit.fret });
    } else if (edit.kind === "note.set") {
      const a = edit.cursor;
      validateFretValue(result, a, edit.fret);
      if (cursorNote(result, a)) {
        const notes = sameStringNotes(result, a);
        let start = notes.findIndex(n => beatKey(n) === beatKey(a));
        let end = start + 1;
        while (start > 0 && noteAt(result, notes[start]!).tiedNote) start--;
        while (end < notes.length && noteAt(result, notes[end]!).tiedNote) end++;
        for (const address of notes.slice(start, end)) {
          if (noteAt(result, address).value !== edit.fret) emit({ kind: "note.fret", address, fret: edit.fret });
        }
      } else {
        untieNext(a);
        const notes = voiceAt(result, a).notes;
        const index = notes.findIndex(note => note.string > a.string);
        emit({ kind: "note.add", address: { ...a, note: index < 0 ? notes.length : index }, note: newNote(a.string, edit.fret) });
        emit({ kind: "voice.empty", address: a, empty: false });
      }
    } else if (edit.kind === "note.remove" || edit.kind === "voice.rest") {
      const a = edit.kind === "note.remove" ? edit.cursor : edit.address;
      const voice = voiceAt(result, a);
      if (edit.kind === "note.remove") validateCursor(result, edit.cursor);
      const notes = voice.notes.map((note, index) => ({ note, index })).filter(({ note }) => edit.kind === "voice.rest" || note.string === edit.cursor.string);
      for (const { note, index } of notes.reverse()) {
        untieNext({ ...a, string: note.string });
        emit({ kind: "note.remove", address: { ...a, note: index } });
      }
      // Explicit empty=false distinguishes a rest from an absent voice in .tg.
      if (notes.length) emit({ kind: "voice.empty", address: a, empty: false });
    } else if (edit.kind === "duration.set") {
      const a = edit.address;
      const voice = voiceAt(result, a);
      if (voice.empty) throw new Error("Select a note or rest first.");
      const length = durationPrecise(edit.duration);
      const oldLength = durationPrecise(voice.duration);
      if (modelSignature(voice.duration) === modelSignature(edit.duration)) continue;
      const measure = result.tracks[a.track]!.measures[a.measure]!;
      const header = result.measureHeaders[a.measure];
      if (!header) throw new Error("This measure has no time signature.");
      const measureStart = header.start * PRECISE_FACTOR;
      const measureEnd = measureStart + WHOLE_PRECISE_DURATION * header.timeSignature.numerator / header.timeSignature.denominator;
      const start = measure.beats[a.beat]!.preciseStart;
      let previousEnd = measureStart;
      for (const beat of measure.beats) {
        const v = beat.voices[a.voice];
        if (!v || v.empty) continue;
        const end = beat.preciseStart + durationPrecise(v.duration);
        if (beat.preciseStart < previousEnd || end > measureEnd) throw new Error("Fix overlapping or overflowing rhythms before changing this measure.");
        previousEnd = end;
      }
      let boundary = measureEnd;
      const rests: BeatAddress[] = [];
      for (let bi = a.beat + 1; bi < measure.beats.length; bi++) {
        const beat = measure.beats[bi]!;
        const v = beat.voices[a.voice];
        if (!v || v.empty) continue;
        if (v.notes.length || beat.text || beat.chord || beat.stroke || beat.pickStroke) { boundary = beat.preciseStart; break; }
        rests.push({ ...a, beat: bi });
      }
      if (start + length > boundary) throw new Error("That duration would overlap another note or cross the barline.");
      const restDurations = splitRests(boundary - start - length, edit.duration);
      emit({ kind: "voice.duration", address: a, duration: edit.duration });
      if (length < oldLength) for (const note of voice.notes) untieNext({ ...a, string: note.string });
      for (const address of rests) emit({ kind: "voice.empty", address, empty: true });
      let position = start + length;
      for (const duration of restDurations) {
        const beats = result.tracks[a.track]!.measures[a.measure]!.beats;
        let bi = beats.findIndex(b => b.preciseStart === position);
        if (bi < 0) {
          bi = beats.findIndex(b => b.preciseStart > position);
          if (bi < 0) bi = beats.length;
          const voices = Array.from({ length: Math.max(2, a.voice + 1) }, blankVoice);
          voices[a.voice] = { ...blankVoice(), empty: false, duration };
          emit({ kind: "beat.add", address: { ...a, beat: bi }, beat: { preciseStart: position, voices } });
        } else {
          const address = { ...a, beat: bi };
          while (result.tracks[a.track]!.measures[a.measure]!.beats[bi]!.voices.length <= a.voice) {
            const index = result.tracks[a.track]!.measures[a.measure]!.beats[bi]!.voices.length;
            emit({ kind: "voice.add", address: { ...address, voice: index }, voice: blankVoice() });
          }
          emit({ kind: "voice.duration", address, duration });
          emit({ kind: "voice.empty", address, empty: false });
        }
        position += durationPrecise(duration);
      }
    } else if (edit.kind === 'layout.set') {
      if (!Number.isInteger(edit.track) || !result.tracks[edit.track]) throw new Error('Select a track to design.');
      const track = result.tracks[edit.track];
      const layout = edit.layout === null ? undefined : validateTabDesign(edit.layout, track.measures.length);
      if (modelSignature(layout ?? null) !== modelSignature(track.tabLayout ?? null)) emit({ kind: 'track.layout', track: edit.track, layout });
    } else if (edit.kind === 'technique.set') {
      for (const patch of techniquePatches(result, edit)) emit(patch);
    } else if (edit.kind === 'repeat.start' || edit.kind === 'repeat.end' || edit.kind === 'repeat.ending') {
      for (const patch of repeatPatches(result, edit)) emit(patch);
    } else if (edit.kind === "column.move" || edit.kind === "column.duplicate") {
      const columns = changeColumns(result, edit);
      if (columns) emit({ kind: "measure.columns", address: edit.address, columns });
    } else throw new Error("Unsupported song edit.");
  }
  return result;
}

export function splitRests(length: number, preferred: TGDuration): TGDuration[] {
  const maximum = durationPrecise(preferred);
  const candidates = DURATION_VALUES.flatMap(value => [0, 1, 2].map(dots => ({
    value, dotted: dots === 1, doubleDotted: dots === 2, division: preferred.division,
  }))).filter(d => { try { return durationPrecise(d) <= maximum; } catch { return false; } })
    .sort((a, b) => durationPrecise(b) - durationPrecise(a));
  const result: TGDuration[] = [];
  while (length > 0) {
    const duration = candidates.find(d => durationPrecise(d) <= length);
    if (!duration || result.length >= 4096) throw new Error("The remaining space cannot be filled with this rhythm. Choose a shorter duration.");
    result.push(duration);
    length -= durationPrecise(duration);
  }
  return result;
}

/** Compatibility helper for an unordered set of original-note fret patches. */
export function applyFretEdits(song: TGSong, edits: FretEdit[]): TGSong {
  if (!Array.isArray(edits)) throw new Error("Invalid fret edits.");
  const keys = edits.map(edit => noteKey(edit.address));
  if (new Set(keys).size !== keys.length) throw new Error("Duplicate fret edit.");
  return applySongEdits(song, edits);
}
