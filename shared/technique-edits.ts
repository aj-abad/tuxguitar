import type { TGEffectPoints, TGNote, TGSong } from './model';
import { cursorNote, durationPrecise, validateCursor, voiceAt, type EditorCursor, type NoteAddress, type ScorePatch } from './score-edits';
import { modelSignature } from './model-signature';

export const TECHNIQUES = ['bend', 'slide', 'hammer-on', 'pull-off', 'tie'] as const;
export type Technique = typeof TECHNIQUES[number];
export type TechniqueEdit = { kind: 'technique.set'; cursor: EditorCursor } & (
  { technique: 'bend'; bend: TGEffectPoints | null } |
  { technique: Exclude<Technique, 'bend'>; enabled: boolean }
);
export const BEND_SHAPES = [
  { id: 'bend', label: 'Bend' }, { id: 'bend-release', label: 'Bend & release' },
  { id: 'prebend', label: 'Pre-bend' }, { id: 'prebend-release', label: 'Pre-bend & release' },
] as const;
export type BendShape = typeof BEND_SHAPES[number]['id'];
export const DEFAULT_BEND = { shape: 'bend' as BendShape, amount: 4 };

export function makeBend(shape: BendShape, amount: number): TGEffectPoints {
  if (!BEND_SHAPES.some(s => s.id === shape) || !Number.isInteger(amount) || amount < 1 || amount > 12) {
    throw new Error('Choose a bend amount from ¼ to 3 tones.');
  }
  const pre = shape.startsWith('prebend'), release = shape.endsWith('release');
  return { points: [{ position: 0, value: pre ? amount : 0 }, { position: 6, value: amount }, { position: 12, value: release ? 0 : amount }] };
}

/** Only exact preset matches are editable as presets; imported custom curves stay intact. */
export function bendPreset(bend: TGEffectPoints): { shape: BendShape; amount: number } | null {
  const amount = Math.max(...bend.points.map(p => p.value));
  if (!Number.isInteger(amount) || amount < 1 || amount > 12) return null;
  const shape = BEND_SHAPES.find(s => modelSignature(makeBend(s.id, amount)) === modelSignature(bend))?.id;
  return shape ? { shape, amount } : null;
}

export interface NeighborNote { address: NoteAddress; note: TGNote }
/** Same track, voice and string. A rest or uncovered time breaks the connection. */
export function techniqueNeighbor(song: TGSong, cursor: EditorCursor, direction: -1 | 1): NeighborNote | undefined {
  const measures = song.tracks[cursor.track].measures, current = measures[cursor.measure].beats[cursor.beat];
  let boundary: number;
  try { boundary = current.preciseStart + (direction > 0 ? durationPrecise(current.voices[cursor.voice].duration) : 0); } catch { return; }
  // Availability runs on every cursor move; avoid rebuilding a whole-song index.
  for (let measure = cursor.measure; measure >= 0 && measure < measures.length; measure += direction) {
    const beats = measures[measure].beats;
    const first = measure === cursor.measure ? cursor.beat + direction : direction > 0 ? 0 : beats.length - 1;
    for (let beat = first; beat >= 0 && beat < beats.length; beat += direction) {
      const column = beats[beat], voice = column.voices[cursor.voice];
      if (!voice || voice.empty) continue;
      let end: number;
      try { end = column.preciseStart + durationPrecise(voice.duration); } catch { return; }
      if (direction > 0 ? column.preciseStart !== boundary : end !== boundary) return;
      if (!voice.notes.length) return;
      const note = voice.notes.findIndex(n => n.string === cursor.string);
      if (note >= 0) return { address: { ...cursor, measure, beat, note }, note: voice.notes[note] };
      boundary = direction > 0 ? end : column.preciseStart;
    }
  }
}

export interface TechniqueState { active: boolean; reason: string | null }
export function inspectTechniques(song: TGSong, cursor: EditorCursor): Record<Technique, TechniqueState> {
  validateCursor(song, cursor);
  const note = cursorNote(song, cursor);
  const next = note && techniqueNeighbor(song, cursor, 1)?.note;
  const previous = note && techniqueNeighbor(song, cursor, -1)?.note;
  const base = !note ? 'Select a note on this string.' : note.effect.deadNote ? 'Dead notes cannot use this technique.' : null;
  const outgoing = base ?? (!next ? 'Add a following note on this string, without a rest between them.'
    : next.effect.deadNote ? 'The following note is a dead note.' : next.tiedNote ? 'Remove the tie on the following note first.' : null);
  const hammer = !!note?.effect.hammer;
  const falling = !!next && !!note && next.value < note.value;
  const active = { bend: !!note?.effect.bend, slide: !!note?.effect.slide, 'hammer-on': hammer && !falling,
    'pull-off': hammer && falling, tie: !!note?.tiedNote };
  const reasons: Record<Technique, string | null> = {
    bend: base,
    slide: outgoing ?? (next?.value === note?.value ? 'A slide needs a different destination fret.' : null),
    'hammer-on': outgoing ?? (next!.value <= note!.value ? 'The following fret must be higher for a hammer-on.' : null),
    'pull-off': outgoing ?? (next!.value >= note!.value ? 'The following fret must be lower for a pull-off.' : null),
    tie: base ?? (!previous ? 'Add a previous note on this string, without a rest between them.'
      : previous.effect.deadNote ? 'The previous note is a dead note.' : previous.value !== note!.value ? 'A tie needs the same fret as the previous note.' : null),
  };
  return Object.fromEntries(TECHNIQUES.map(kind => [kind, { active: active[kind], reason: active[kind] ? null : reasons[kind] }])) as Record<Technique, TechniqueState>;
}

export function techniquePatches(song: TGSong, edit: TechniqueEdit): ScorePatch[] {
  const cursor = edit.cursor;
  validateCursor(song, cursor);
  const note = cursorNote(song, cursor);
  if (!note) throw new Error('Select a note on this string.');
  if (!TECHNIQUES.includes(edit.technique)) throw new Error('Unknown technique.');
  const address = { ...cursor, note: voiceAt(song, cursor).notes.indexOf(note) };
  const patches: ScorePatch[] = [];
  const effect = (name: 'slide' | 'hammer', value: boolean, target: NeighborNote = { address, note }) => {
    if (target.note.effect[name] !== value) patches.push({ kind: 'note.effect', address: target.address, effect: name, value });
  };
  if (edit.technique === 'bend') {
    const bend = edit.bend;
    if (bend !== null) {
      if (note.effect.deadNote) throw new Error('Dead notes cannot use this technique.');
      if (!bend || !Array.isArray(bend.points) || bend.points.length < 2 || bend.points.length > 13 ||
        bend.points.some((p, i) => !p || !Number.isInteger(p.position) || p.position < 0 || p.position > 12 ||
          !Number.isInteger(p.value) || p.value < 0 || p.value > 12 || i > 0 && p.position <= bend.points[i - 1].position) ||
        bend.points[0].position !== 0 || bend.points.at(-1)!.position !== 12 || !bend.points.some(p => p.value > 0)) {
        throw new Error('A bend needs ordered points from 0 to 12 and amounts from 0 to 3 tones.');
      }
    }
    const value = bend ? { points: bend.points.map(p => ({ position: p.position, value: p.value })) } : undefined;
    if (modelSignature(note.effect.bend) !== modelSignature(value)) patches.push({ kind: 'note.bend', address, bend: value });
  } else {
    if (typeof edit.enabled !== 'boolean') throw new Error('Invalid technique state.');
    const status = inspectTechniques(song, cursor)[edit.technique];
    if (edit.enabled && !status.active && status.reason) throw new Error(status.reason);
    if (edit.technique === 'tie') {
      if (note.tiedNote !== edit.enabled) patches.push({ kind: 'note.tie', address, tied: edit.enabled });
      if (edit.enabled && !note.tiedNote) {
        const previous = techniqueNeighbor(song, cursor, -1)!;
        effect('slide', false, previous); effect('hammer', false, previous);
      }
    } else {
      effect(edit.technique === 'slide' ? 'slide' : 'hammer', edit.enabled);
      if (edit.enabled) effect(edit.technique === 'slide' ? 'hammer' : 'slide', false);
    }
  }
  return patches;
}
