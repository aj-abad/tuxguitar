import {
  QUARTER_TIME,
  PRECISE_STARTING_POINT,
  STROKE_DOWN,
  TRIPLET_FEEL_EIGHTH,
  TRIPLET_FEEL_SIXTEENTH,
  type TGChannel,
  type TGDuration,
  type TGNote,
  type TGSong,
  type TGTrack,
  type TGVoice,
} from "./model";

export const TPQ = QUARTER_TIME; // 960

// PRECISE_FACTOR = WHOLE_PRECISE_DURATION / (QUARTER_TIME * 4) = 3003
const PRECISE_FACTOR = 3003;

// ---- public types ----------------------------------------------------------

export type MidiEvent =
  | { type: "tempo";      tick: number; usq: number }
  | { type: "program";    tick: number; ch: number; program: number }
  | { type: "control";    tick: number; ch: number; cc: number; value: number }
  | { type: "pitch_bend"; tick: number; ch: number; value: number }
  | { type: "note_on";    tick: number; ch: number; note: number; vel: number }
  | { type: "note_off";   tick: number; ch: number; note: number; vel: number };

// ---- helpers ---------------------------------------------------------------

const VEL_INCREMENT = 16;
const MIN_VEL = 15;
const PM_MS = 60;   // palm mute target duration in ms
const DEAD_MS = 30; // dead note target duration in ms

function clamp(v: number, lo = 0, hi = 127): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function durationTicks(d: TGDuration): number {
  let t = (4 * TPQ) / d.value;
  if (d.dotted) t += t / 2;
  else if (d.doubleDotted) t += t / 2 + t / 4;
  if (d.division) t = (t * d.division.times) / d.division.enters;
  return Math.round(t);
}

// ms duration → QT ticks at current bpm, capped at maxTicks
function staticTicks(ms: number, bpm: number, maxTicks: number): number {
  return Math.min(Math.round((ms * TPQ * bpm) / 60_000), maxTicks);
}

// Convert beat.preciseStart (WHOLE_PRECISE_DURATION units) to 0-based QT ticks.
// First beat of song = tick 0.
function preciseToQT(precise: number): number {
  return Math.round((precise - PRECISE_STARTING_POINT) / PRECISE_FACTOR);
}

// Map TGChannel.id (0-indexed GM channel) to actual MIDI channel, skipping 9
// unless it IS the percussion channel.
function midiCh(ch: TGChannel): number {
  if (ch.id === 9) return 9; // GM drums
  return ch.id < 9 ? ch.id : Math.min(ch.id + 1, 15);
}

// ---- main export -----------------------------------------------------------

export function exportMidi(song: TGSong): MidiEvent[] {
  const out: MidiEvent[] = [];
  const push = (e: MidiEvent) => out.push(e);

  const channelMap = new Map<number, TGChannel>(song.channels.map(c => [c.id, c]));

  // Channel setup at tick 0
  for (const ch of song.channels) {
    const mc = midiCh(ch);
    push({ type: "control", tick: 0, ch: mc, cc: 7,  value: clamp(ch.volume) });
    push({ type: "control", tick: 0, ch: mc, cc: 10, value: clamp(ch.balance) });
    push({ type: "control", tick: 0, ch: mc, cc: 91, value: clamp(ch.reverb) });
    push({ type: "control", tick: 0, ch: mc, cc: 93, value: clamp(ch.chorus) });
    push({ type: "program", tick: 0, ch: mc, program: clamp(ch.program) });
  }

  // Tempo events (0-normalized: header.start - QUARTER_TIME)
  let prevUsq = -1;
  for (const h of song.measureHeaders) {
    const usq = Math.round(60_000_000 / h.tempo);
    if (usq !== prevUsq) {
      push({ type: "tempo", tick: h.start - QUARTER_TIME, usq });
      prevUsq = usq;
    }
  }

  // Notes per track
  for (const track of song.tracks) {
    const ch = channelMap.get(track.channelId);
    if (!ch) continue;
    const mc = midiCh(ch);

    for (let mi = 0; mi < track.measures.length; mi++) {
      const measure = track.measures[mi];
      const header = song.measureHeaders[mi];
      if (!measure || !header) continue;

      const stroke = new Array<number>(track.strings.length + 1).fill(0);
      let prevBeat: (typeof measure.beats)[number] | null = null;

      for (let bi = 0; bi < measure.beats.length; bi++) {
        const beat = measure.beats[bi];
        if (!beat) continue;
        updateStroke(beat, prevBeat, stroke, track.strings.length);

        for (let vi = 0; vi < beat.voices.length; vi++) {
          const voice = beat.voices[vi];
          if (!voice || voice.empty || voice.notes.length === 0) continue;

          const beatTick = preciseToQT(beat.preciseStart);
          const voiceDur = durationTicks(voice.duration);
          const { start: tStart, duration: tDur } = applyTripletFeel(
            voice, bi, beatTick, voiceDur, header.tripletFeel,
          );

          for (const note of voice.notes) {
            if (note.tiedNote) continue;

            const pitch = clamp(track.offset + note.value + track.strings[note.string - 1]!.value);
            const delay = stroke[note.string] ?? 0;
            const noteStart = tStart + delay;
            const baseDur = Math.max(1, tDur - delay);

            let dur = realDuration(note, vi, baseDur, track, mi, bi, song);
            dur = applyDurEffects(note, header.tempo, dur);

            const vel = realVelocity(note, track, mi, bi, song);

            push({ type: "note_on",  tick: noteStart,        ch: mc, note: pitch, vel });
            push({ type: "note_off", tick: noteStart + Math.max(1, dur), ch: mc, note: pitch, vel: 0 });
          }
        }
        prevBeat = beat;
      }
    }
  }

  // Sort: by tick, note_off before note_on at same tick
  out.sort((a, b) => {
    if (a.tick !== b.tick) return a.tick - b.tick;
    const rank = (e: MidiEvent) => e.type === "note_off" ? 0 : e.type === "note_on" ? 2 : 1;
    return rank(a) - rank(b);
  });

  return out;
}

/**
 * Last tick (0-based QT) at which any note still sounds — the audible end of
 * the song. Derived from the same event stream the sidecar plays (so it honours
 * let-ring/tied durations and ignores trailing empty measures), keeping a
 * progress bar in sync with what's actually heard. Returns 0 for a silent song.
 */
export function songEndTick(song: TGSong): number {
  let max = 0;
  for (const e of exportMidi(song)) {
    if (e.type === "note_off" && e.tick > max) max = e.tick;
  }
  return max;
}

// ---- duration effects ------------------------------------------------------

function applyDurEffects(note: TGNote, bpm: number, dur: number): number {
  if (note.effect.deadNote) return staticTicks(DEAD_MS, bpm, dur);
  if (note.effect.palmMute) return staticTicks(PM_MS,   bpm, dur);
  if (note.effect.staccato) return Math.max(1, Math.round(dur * 0.5));
  return dur;
}

// ---- real duration (tied notes + let ring) ---------------------------------

function realDuration(
  note: TGNote,
  vIdx: number,
  baseDur: number,
  track: TGTrack,
  mi: number,
  bi: number,
  song: TGSong,
): number {
  const isLetRing = note.effect.letRing;
  if (!isLetRing) return baseDur;

  let dur = baseDur;
  let m = mi, b = bi + 1;

  outer:
  while (m < track.measures.length) {
    const measure = track.measures[m]!;
    while (b < measure.beats.length) {
      const nextBeat = measure.beats[b]!;
      const nextVoice: TGVoice | undefined = nextBeat.voices[vIdx];
      if (nextVoice && !nextVoice.empty && nextVoice.notes.length > 0) {
        const match = nextVoice.notes.find(n => n.string === note.string);
        if (match) {
          if (match.tiedNote) {
            dur += durationTicks(nextVoice.duration);
            if (!match.effect.letRing) break outer;
          } else if (match.effect.letRing) {
            dur += durationTicks(nextVoice.duration);
          } else {
            break outer;
          }
        } else if (!isLetRing) {
          break outer;
        }
      } else if (nextVoice && !nextVoice.empty) {
        break outer; // rest voice
      }
      b++;
    }
    m++; b = 0;
  }

  return dur;
}

// ---- velocity --------------------------------------------------------------

function realVelocity(
  note: TGNote,
  track: TGTrack,
  mi: number,
  bi: number,
  song: TGSong,
): number {
  let vel = note.velocity;

  if (note.effect.hammer) {
    const prev = prevNoteOnString(note, track, mi, bi);
    if (prev?.effect.hammer) vel = Math.max(MIN_VEL, vel - 25);
  }

  if      (note.effect.ghostNote)             vel = Math.max(MIN_VEL, vel - VEL_INCREMENT);
  else if (note.effect.accentuatedNote)       vel = Math.min(127, vel + VEL_INCREMENT);
  else if (note.effect.heavyAccentuatedNote)  vel = Math.min(127, vel + VEL_INCREMENT * 2);

  return clamp(vel);
}

function prevNoteOnString(note: TGNote, track: TGTrack, mi: number, bi: number): TGNote | null {
  for (let m = mi; m >= 0; m--) {
    const measure = track.measures[m]!;
    const endB = m === mi ? bi - 1 : measure.beats.length - 1;
    for (let b = endB; b >= 0; b--) {
      for (const voice of measure.beats[b]!.voices) {
        const n = voice.notes.find(n => n.string === note.string);
        if (n) return n;
      }
    }
  }
  return null;
}

// ---- stroke ----------------------------------------------------------------

function updateStroke(
  beat: TGSong["tracks"][0]["measures"][0]["beats"][0],
  prev: typeof beat | null,
  stroke: number[],
  stringCount: number,
): void {
  const dir = beat.stroke?.direction ?? 0;
  const prevDir = prev?.stroke?.direction ?? 0;
  if (!prev || !(dir === 0 && prevDir === 0)) {
    if (dir === 0) {
      stroke.fill(0);
    } else {
      let usedMask = 0, count = 0;
      for (const v of beat.voices) {
        for (const n of v.notes) {
          if (!n.tiedNote) { usedMask |= 1 << (n.string - 1); count++; }
        }
      }
      if (count > 0) {
        const sv = beat.stroke?.value ?? 0;
        const inc = sv > 0 ? Math.round(TPQ / sv) : 0;
        let move = 0;
        for (let i = 0; i < stringCount; i++) {
          const idx = dir === STROKE_DOWN ? stringCount - 1 - i : i;
          if (usedMask & (1 << idx)) { stroke[idx + 1] = move; move += inc; }
        }
      }
    }
  }
}

// ---- triplet feel ----------------------------------------------------------

function applyTripletFeel(
  voice: TGVoice,
  _bIdx: number,
  start: number,
  dur: number,
  feel: number,
): { start: number; duration: number } {
  if (feel === TRIPLET_FEEL_EIGHTH && voice.duration.value === 8) {
    const tripDur = durationTicks({ value: 8, dotted: false, doubleDotted: false, division: { enters: 3, times: 2 } });
    if (start % TPQ === 0)       return { start, duration: tripDur * 2 };
    if (start % (TPQ / 2) === 0) return { start: start - dur + tripDur * 2, duration: tripDur };
  } else if (feel === TRIPLET_FEEL_SIXTEENTH && voice.duration.value === 16) {
    const tripDur = durationTicks({ value: 16, dotted: false, doubleDotted: false, division: { enters: 3, times: 2 } });
    if (start % (TPQ / 2) === 0) return { start, duration: tripDur * 2 };
    if (start % (TPQ / 4) === 0) return { start: start - dur + tripDur * 2, duration: tripDur };
  }
  return { start, duration: dur };
}
