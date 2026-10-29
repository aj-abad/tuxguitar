import { PRECISE_FACTOR, WHOLE_PRECISE_DURATION, type TGBeat, type TGDuration, type TGSong } from "./model";
import { durationPrecise, splitRests, voiceAt, type BeatAddress } from "./score-edits";
import { techniqueNeighbor } from './technique-edits';

/** Source provenance lets XML and editor identities follow the same operation. */
export interface ColumnSource { source: number; clone: boolean; beat: TGBeat }
interface ColumnChange { kind: "column.move" | "column.duplicate"; address: BeatAddress; lastBeat: number; direction: -1 | 1 }

function withDuration(beat: TGBeat, voice: number, duration: TGDuration): TGBeat {
  return { ...beat, voices: beat.voices.map((v, i) => i === voice ? { ...v, duration } : v) };
}
function plainRest(beat: TGBeat, voice: number): boolean {
  return !beat.voices[voice].notes.length && !beat.text && !beat.chord && !beat.stroke && !beat.pickStroke;
}

/** A column carries its duration. Moves exchange neighbors; copies use trailing rests. */
export function changeColumns(song: TGSong, change: ColumnChange): ColumnSource[] | null {
  const a = change.address;
  voiceAt(song, a);
  if (![1, -1].includes(change.direction) || !Number.isInteger(change.lastBeat) || change.lastBeat < a.beat) throw new Error("Invalid column selection.");
  const track = song.tracks[a.track];
  const measure = track.measures[a.measure];
  const header = song.measureHeaders[a.measure];
  if (!header) throw new Error("This measure has no time signature.");
  if (measure.beats.some(b => b.voices.some((v, i) => i !== a.voice && !v.empty))) {
    throw new Error("Column movement currently supports measures with one voice.");
  }
  const active = measure.beats.map((beat, source) => ({ beat, source, clone: false }))
    .filter(c => c.beat.voices[a.voice] && !c.beat.voices[a.voice].empty);
  const first = active.findIndex(c => c.source === a.beat);
  const last = active.findIndex(c => c.source === change.lastBeat);
  if (first < 0 || last < first) throw new Error("Select active columns in one measure.");
  const linked = (beat: TGBeat) => beat.voices[a.voice]?.notes.some(n => n.tiedNote || n.effect.slide || n.effect.hammer || n.effect.letRing);
  const next = track.measures[a.measure + 1]?.beats.find(b => b.voices[a.voice] && !b.voices[a.voice].empty);
  const incoming = active.some(c => c.beat.voices[a.voice].notes.some(note => {
    const previous = techniqueNeighbor(song, { ...a, beat: c.source, string: note.string }, -1);
    return previous && previous.address.measure < a.measure && (previous.note.effect.slide || previous.note.effect.hammer);
  }));
  if (incoming || active.some(c => linked(c.beat)) || next?.voices[a.voice]?.notes.some(n => n.tiedNote)) {
    throw new Error("Move or duplicate plain columns first. Ties, slides, hammer-ons and let-ring connections are not supported by these commands yet.");
  }
  const start = header.start * PRECISE_FACTOR;
  const end = start + WHOLE_PRECISE_DURATION * header.timeSignature.numerator / header.timeSignature.denominator;
  let position = start;
  for (const column of active) {
    if (column.beat.preciseStart !== position) throw new Error("Column movement needs a complete measure without gaps or overlaps.");
    position += durationPrecise(column.beat.voices[a.voice].duration);
  }
  if (position !== end) throw new Error("Column movement needs a complete measure without gaps or overlaps.");
  const dormant = measure.beats.map((beat, source) => ({ beat, source, clone: false }))
    .filter(c => !c.beat.voices[a.voice] || c.beat.voices[a.voice].empty);
  if (change.kind === "column.move") {
    const neighbor = change.direction < 0 ? first - 1 : last + 1;
    if (neighbor < 0 || neighbor >= active.length) return null;
    const [column] = active.splice(neighbor, 1);
    active.splice(change.direction < 0 ? last : first, 0, column);
  } else {
    const copies = active.slice(first, last + 1).map(c => ({ ...c, clone: true }));
    let required = copies.reduce((sum, c) => sum + durationPrecise(c.beat.voices[a.voice].duration), 0);
    // Only rests after the source selection can fund an insertion. The source
    // itself is never shortened or overwritten by duplication.
    for (let i = active.length - 1; i > last && required > 0; i--) {
      const column = active[i];
      if (!plainRest(column.beat, a.voice)) break;
      const length = durationPrecise(column.beat.voices[a.voice].duration);
      if (length <= required) {
        required -= length;
        active.splice(i, 1);
        dormant.push({ ...column, beat: { ...column.beat, voices: column.beat.voices.map((v, vi) => vi === a.voice ? { ...v, empty: true } : v) } });
      } else {
        const durations = splitRests(length - required, column.beat.voices[a.voice].duration);
        active.splice(i, 1, ...durations.map((duration, index) => ({ ...column, clone: index > 0, beat: withDuration(column.beat, a.voice, duration) })));
        required = 0;
      }
    }
    if (required) throw new Error("Not enough trailing rest space to duplicate these columns in this measure.");
    active.splice(change.direction < 0 ? first : last + 1, 0, ...copies);
  }
  position = start;
  const result = active.map(column => {
    const beat = { ...column.beat, preciseStart: position };
    position += durationPrecise(beat.voices[a.voice].duration);
    return { ...column, beat };
  });
  // Inactive source beats can contain extensions we do not understand. Retain
  // them without adding any active voice or changing the measure's timing.
  return [...result, ...dormant].sort((x, y) => x.beat.preciseStart - y.beat.preciseStart || Number(x.beat.voices[a.voice]?.empty) - Number(y.beat.voices[a.voice]?.empty));
}
