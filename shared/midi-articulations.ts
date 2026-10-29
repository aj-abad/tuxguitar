import { PRECISE_FACTOR, PRECISE_STARTING_POINT, QUARTER_TIME, STROKE_DOWN,
  TRIPLET_FEEL_EIGHTH, TRIPLET_FEEL_SIXTEENTH,
  type TGChannel, type TGDuration, type TGNote, type TGSong } from './model';

// Playback-only timing; the document and .tg bend representation stay unchanged.
interface NoteRef {
  note: TGNote; channel: TGChannel; pitch: number; start: number; end: number;
  ringEnd: number; bpm: number; previous?: NoteRef; next?: NoteRef;
}
export interface PitchPoint { tick: number; semitones: number }
export interface SoundingNote {
  channel: TGChannel; pitch: number; velocity: number; start: number; end: number;
  pitchPoints: PitchPoint[];
}
const clamp = (value: number, low = 0, high = 127) => Math.max(low, Math.min(high, value));
const ticks = (duration: TGDuration) => 4 * QUARTER_TIME / duration.value *
  (duration.dotted ? 1.5 : duration.doubleDotted ? 1.75 : 1) *
  (duration.division ? duration.division.times / duration.division.enters : 1);
const qt = (precise: number) => Math.round((precise - PRECISE_STARTING_POINT) / PRECISE_FACTOR);
const shortNote = (note: TGNote) => note.effect.deadNote || note.effect.palmMute || note.effect.staccato;

function swung(start: number, duration: number, value: number, feel: number) {
  const unit = feel === TRIPLET_FEEL_EIGHTH && value === 8 ? QUARTER_TIME
    : feel === TRIPLET_FEEL_SIXTEENTH && value === 16 ? QUARTER_TIME / 2 : 0;
  if (unit && duration === unit / 2) {
    if (start % unit === 0) return { start, duration: Math.round(unit * 2 / 3) };
    if (start % unit === unit / 2) return { start: start + Math.round(unit / 6), duration: Math.round(unit / 3) };
  }
  return { start, duration };
}

/** Resolve same-string links only through contiguous, non-rest frames in one voice. */
function noteTimeline(song: TGSong): NoteRef[] {
  const notes: NoteRef[] = [], channels = new Map(song.channels.map(channel => [channel.id, channel]));
  const solo = song.tracks.some(track => track.solo && !track.mute);
  for (const track of song.tracks) {
    const channel = channels.get(track.channelId);
    if (!channel || track.mute || solo && !track.solo) continue;
    const voices = new Map<number, { last: Map<number, NoteRef>; preciseEnd: number; end: number }>();
    const stroke = new Array<number>(track.strings.length + 1).fill(0);
    let previousStroke = 0;
    for (let mi = 0; mi < track.measures.length; mi++) {
      const header = song.measureHeaders[mi];
      if (!header) continue;
      stroke.fill(0); previousStroke = 0;
      for (const beat of track.measures[mi].beats) {
        const direction = beat.stroke?.direction ?? 0;
        if (direction || previousStroke) {
          stroke.fill(0);
          if (direction) {
            const strings = [...new Set(beat.voices.flatMap(voice => voice.notes.filter(note => !note.tiedNote).map(note => note.string)))];
            strings.sort((a, b) => direction === STROKE_DOWN ? b - a : a - b);
            const increment = beat.stroke!.value > 0 ? Math.round(QUARTER_TIME / beat.stroke!.value) : 0;
            strings.forEach((string, index) => { stroke[string] = index * increment; });
          }
        }
        previousStroke = direction;
        beat.voices.forEach((voice, vi) => {
          if (voice.empty) return;
          const state = voices.get(vi) ?? { last: new Map<number, NoteRef>(), preciseEnd: -1, end: 0 };
          voices.set(vi, state);
          if (state.preciseEnd !== beat.preciseStart || !voice.notes.length) {
            for (const last of state.last.values()) last.ringEnd = state.end;
            state.last.clear();
          }
          const rawDuration = ticks(voice.duration);
          const timing = swung(qt(beat.preciseStart), Math.round(rawDuration), voice.duration.value, header.tripletFeel);
          state.preciseEnd = beat.preciseStart + Math.round(rawDuration * PRECISE_FACTOR);
          state.end = timing.start + timing.duration;
          for (const note of voice.notes) {
            const tuning = track.strings[note.string - 1];
            if (!tuning) continue;
            const start = timing.start + Math.min(stroke[note.string] ?? 0, Math.max(0, timing.duration - 1));
            const ref: NoteRef = { note, channel, pitch: clamp(track.offset + tuning.value + note.value),
              start, end: state.end, ringEnd: state.end, bpm: header.tempo, previous: state.last.get(note.string) };
            if (ref.previous) ref.previous.next = ref;
            state.last.set(note.string, ref);
            notes.push(ref);
          }
        });
      }
    }
    for (const state of voices.values()) for (const last of state.last.values()) last.ringEnd = state.end;
  }
  return notes;
}

function bendPoints(ref: NoteRef): PitchPoint[] {
  const points = ref.note.effect.bend?.points;
  if (!points?.length || points.some(point => !Number.isFinite(point.position) || point.position < 0 || point.position > 12 ||
    !Number.isInteger(point.value) || point.value < 0 || point.value > 12)) return [];
  const sorted = [...points].sort((a, b) => a.position - b.position);
  // A .tg bend unit is a quarter tone (50 cents), not a semitone.
  const result = sorted.map(point => ({ tick: Math.round(ref.start + (ref.end - ref.start) * point.position / 12), semitones: point.value / 2 }));
  if (result[0].tick > ref.start) result.unshift({ ...result[0], tick: ref.start });
  if (result.at(-1)!.tick < ref.end) result.push({ ...result.at(-1)!, tick: ref.end });
  return result;
}

export function pitchAt(points: PitchPoint[], tick: number): number {
  let previous = points[0];
  if (!previous) return 0;
  for (let index = 1; index < points.length; index++) {
    const point = points[index];
    if (point.tick > tick) return previous.semitones + (point.semitones - previous.semitones) *
      clamp((tick - previous.tick) / (point.tick - previous.tick), 0, 1);
    previous = point;
  }
  return previous.semitones;
}

/** Current .tg techniques translated into attacks, durations and linear pitch ramps. */
export function soundingNotes(song: TGSong): SoundingNote[] {
  const result: SoundingNote[] = [], consumed = new Set<NoteRef>();
  for (const first of noteTimeline(song)) {
    if (consumed.has(first)) continue;
    const chain = [first];
    let last = first;
    while (last.next?.note.tiedNote && last.next.pitch === first.pitch && !last.note.effect.deadNote && !last.next.note.effect.deadNote) {
      last = last.next; chain.push(last); consumed.add(last);
    }
    let end = last.note.effect.letRing ? Math.max(last.end, last.next?.start ?? last.ringEnd) : last.end;
    const target = last.next;
    const connected = first.channel.id !== 9 && target && !target.note.tiedNote && !target.note.effect.deadNote &&
      !shortNote(last.note) && target.pitch !== last.pitch;
    const slide = connected && last.note.effect.slide;
    const hammer = connected && !slide && last.note.effect.hammer;
    if (slide) end = target.start;
    if (hammer) end = Math.max(end, target.start + Math.max(1, Math.min(
      Math.round(QUARTER_TIME * target.bpm / 6000), Math.floor((target.end - target.start) / 8))));
    const duration = end - first.start;
    if (first.note.effect.deadNote || first.note.effect.palmMute) {
      const ms = first.note.effect.deadNote ? 30 : 60;
      end = first.start + Math.min(duration, Math.round(ms * QUARTER_TIME * first.bpm / 60_000));
    } else if (first.note.effect.staccato) end = first.start + Math.round(duration / 2);
    end = Math.max(first.start + 1, end);

    let points: PitchPoint[] = [{ tick: first.start, semitones: 0 }];
    if (first.channel.id !== 9 && !first.note.effect.deadNote) {
      for (const segment of chain) {
        const curve = bendPoints(segment);
        if (curve.length) points.push(...curve);
        // An unmarked tied segment continues at the preceding bend's final pitch.
        else points.push({ tick: segment.end, semitones: points.at(-1)!.semitones });
      }
      if (slide) {
        // Hold the source for half its written duration, then glide into the target.
        const glideStart = Math.round(last.start + (target.start - last.start) / 2);
        const from = pitchAt(points, glideStart);
        points = points.filter(point => point.tick < glideStart);
        points.push({ tick: glideStart, semitones: from }, { tick: target.start, semitones: target.pitch - first.pitch });
      }
    }
    const finalPitch = pitchAt(points, end);
    // Coincident points express a pitch jump, including pre-bends before attack.
    points = points.filter(point => point.tick < end);
    points.push({ tick: end, semitones: finalPitch });
    const previous = first.previous;
    let velocity = first.note.velocity;
    if (first.channel.id !== 9 && previous?.note.effect.hammer && !previous.note.effect.slide &&
      !shortNote(previous.note) && !first.note.tiedNote && !first.note.effect.deadNote && previous.pitch !== first.pitch) {
      velocity = Math.max(15, velocity - 25);
    }
    if (first.note.effect.ghostNote) velocity = Math.max(15, velocity - 16);
    else if (first.note.effect.accentuatedNote) velocity += 16;
    else if (first.note.effect.heavyAccentuatedNote) velocity += 32;
    result.push({ channel: first.channel, pitch: first.pitch, velocity: clamp(velocity), start: first.start, end,
      pitchPoints: points.some(point => point.semitones !== 0) ? points : [] });
  }
  return result;
}
