// Converts a TuxGuitar `.tg` binary into the text-based TGX format
// (see docs/tgx-format.md) and emits a ready-to-paste AI prompt that asks an
// LLM to extend the piece by N bars under the playability guardrails described
// in docs/ai-features.md.
//
//   node scripts/ai/run.mjs [input.tg] [nBars]      (defaults: china.tg, 2)
//
// Outputs (next to this script):
//   <base>.tgx                  the converted song
//   <base>-extend-prompt.txt    full prompt + TGX, copy-paste into Claude
//
// This is a test harness for the AI feature work, not production code: the .tg
// model is richer than TGX in a few spots and those lossy mappings are flagged
// with NOTE comments below.

import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseTgFile } from "../../shared/tg-reader.ts";
import {
  HARMONIC_NATURAL,
  HARMONIC_ARTIFICIAL,
  HARMONIC_PINCH,
  HARMONIC_TAPPED,
  STROKE_DOWN,
  STROKE_UP,
  type TGBeat,
  type TGDuration,
  type TGMeasure,
  type TGMeasureHeader,
  type TGNote,
  type TGSong,
  type TGTrack,
} from "../../shared/model.ts";

// ---- TGX shapes (loose; this is a serializer, not a validator) --------------

type TgxNote = Record<string, unknown>;
type TgxBeat = Record<string, unknown>;
type TgxMeasure = Record<string, unknown>;

// ---- duration ---------------------------------------------------------------

const DURATION_CODE: Record<number, string> = {
  1: "w",
  2: "h",
  4: "q",
  8: "e",
  16: "s",
  32: "t",
  64: "x",
};

function durationCode(d: TGDuration): string {
  let code = DURATION_CODE[d.value] ?? "q";
  if (d.dotted) code += ".";
  if (d.doubleDotted) code += "..";
  // TGX encodes a tuplet as the "enters" count (3 = triplet, 5 = quintuplet…).
  // A normal (1:1) division has enters === 1 and adds no suffix.
  const enters = d.division?.enters ?? 1;
  if (enters && enters !== 1) code += String(enters);
  return code;
}

// ---- key signature (best-effort major name) ---------------------------------

// .tg stores only the signature index, not the tonic or mode, so this is a
// best-effort major-key label. 0 (= C / no accidentals) is treated as "unset".
const KEY_NAMES: Record<number, string> = {
  1: "G", 2: "D", 3: "A", 4: "E", 5: "B", 6: "F#", 7: "C#",
  8: "F", 9: "Bb", 10: "Eb", 11: "Ab", 12: "Db", 13: "Gb", 14: "Cb",
};

// ---- notes ------------------------------------------------------------------

// Mutates `lastFret` (string -> last fret seen) so hammer flags can be split
// into hammer-on vs pull-off by comparing against the previous fret.
function noteToTgx(note: TGNote, lastFret: Record<number, number>): TgxNote {
  const out: TgxNote = { s: note.string, f: note.value };
  const e = note.effect;
  const art: string[] = [];

  if (e.palmMute) art.push("pm");
  if (e.letRing) art.push("lr");
  if (e.hammer) {
    const prev = lastFret[note.string];
    art.push(prev != null && note.value < prev ? "po" : "ho");
  }
  if (e.vibrato) art.push("vib");
  if (e.deadNote) art.push("dead");
  if (e.staccato) art.push("stac");
  if (e.tapping) art.push("tap");
  // NOTE: slapping/popping have no TGX articulation; dropped intentionally.
  if (art.length) out.art = art;

  if (e.ghostNote) out.dyn = "ghost";
  else if (e.heavyAccentuatedNote) out.dyn = "hacc";
  else if (e.accentuatedNote) out.dyn = "acc";

  if (note.tiedNote) out.tied = true;

  // NOTE: .tg only carries a boolean slide here; emit the generic legato slide.
  if (e.slide) out.slide = "ls";

  if (e.bend && e.bend.points.length) {
    // pos: 0..MAX_POSITION_LENGTH(12) -> 0..100 (% of note duration)
    // val: 1 unit = 1 semitone (SEMITONE_LENGTH) -> tone-hundredths (*50)
    out.bend = e.bend.points.map((p) => [
      Math.round((p.position * 100) / 12),
      Math.round(p.value * 50),
    ]);
  }

  if (e.harmonic) {
    switch (e.harmonic.type) {
      case HARMONIC_NATURAL: out.harm = "n"; break;
      case HARMONIC_ARTIFICIAL: out.harm = { a: e.harmonic.data }; break;
      case HARMONIC_PINCH: out.harm = "p"; break;
      case HARMONIC_TAPPED: out.harm = "t"; break;
      default: out.harm = "n"; break; // semi-harmonic has no TGX form
    }
  }

  lastFret[note.string] = note.value;
  return out;
}

// ---- beats ------------------------------------------------------------------

// Render one voice of a beat (a single rhythmic line). Beat-level decorations
// (chord/stroke/text/tremolo bar) are attached only when `decorate` is set, so
// multi-voice measures don't duplicate them across every voice.
function beatToTgx(
  beat: TGBeat,
  voiceIndex: number,
  lastFret: Record<number, number>,
  decorate: boolean,
): TgxBeat {
  const voice = beat.voices[voiceIndex];
  const out: TgxBeat = {};

  if (!voice || voice.notes.length === 0) {
    const dur = voice?.duration ?? beat.voices[0]?.duration;
    out.d = dur ? durationCode(dur) : "q";
    out.rest = true;
  } else {
    out.d = durationCode(voice.duration);
    out.notes = voice.notes.map((n) => noteToTgx(n, lastFret));
  }

  if (decorate) {
    if (beat.stroke && beat.stroke.direction !== 0) {
      const dir = beat.stroke.direction === STROKE_DOWN ? "d"
        : beat.stroke.direction === STROKE_UP ? "u" : "";
      if (dir) out.stroke = `${dir}${beat.stroke.value}`;
    }
    if (beat.chord) out.chord = beat.chord.name;
    if (beat.text) out.text = beat.text;
    // tremolo bar lives on a note effect in .tg; surface it at beat level (TGX)
    const trem = beat.voices.flatMap((v) => v.notes).find((n) => n.effect.tremoloBar);
    if (trem?.effect.tremoloBar) {
      out.tremBar = trem.effect.tremoloBar.points.map((p) => [
        Math.round((p.position * 100) / 12),
        Math.round(p.value * 50),
      ]);
    }
  }

  return out;
}

// ---- measures ---------------------------------------------------------------

interface RunState {
  ts?: [number, number];
  tempo?: number;
  ks?: string;
}

function measureToTgx(
  measure: TGMeasure,
  header: TGMeasureHeader,
  state: RunState,
  lastFret: Record<number, number>,
): TgxMeasure {
  const out: TgxMeasure = {};

  const ts: [number, number] = [
    header.timeSignature.numerator,
    header.timeSignature.denominator,
  ];
  if (!state.ts || state.ts[0] !== ts[0] || state.ts[1] !== ts[1]) {
    out.ts = ts;
    state.ts = ts;
  }

  if (state.tempo !== header.tempo) {
    out.tempo = header.tempo;
    state.tempo = header.tempo;
  }

  const ks = KEY_NAMES[measure.keySignature];
  if (ks && ks !== state.ks) {
    out.ks = ks;
    state.ks = ks;
  }

  if (header.marker) out.marker = header.marker.title;
  if (header.repeatOpen && header.repeatClose > 0) out.repeat = "closeOpen";
  else if (header.repeatOpen) out.repeat = "open";
  else if (header.repeatClose > 0) out.repeat = { close: header.repeatClose };

  // Which voice indices actually carry notes anywhere in this measure?
  const voiceCount = Math.max(0, ...measure.beats.map((b) => b.voices.length));
  const used: number[] = [];
  for (let v = 0; v < voiceCount; v++) {
    if (measure.beats.some((b) => b.voices[v]?.notes.length)) used.push(v);
  }

  if (used.length <= 1) {
    const v = used[0] ?? 0;
    out.beats = measure.beats.map((b) => beatToTgx(b, v, lastFret, true));
  } else {
    // Each voice becomes its own full beat stream; decorate only the first.
    out.voices = used.map((v, i) =>
      measure.beats.map((b) => beatToTgx(b, v, lastFret, i === 0)),
    );
  }

  return out;
}

// ---- track / song -----------------------------------------------------------

function trackToTgx(track: TGTrack, song: TGSong, headers: TGMeasureHeader[]): Record<string, unknown> {
  const channel = song.channels.find((c) => c.id === track.channelId);
  const out: Record<string, unknown> = {
    name: track.name,
    program: channel?.program ?? 0,
    channel: track.channelId,
    tuning: track.strings.map((s) => s.value),
  };
  if (track.offset) out.capo = track.offset;

  const state: RunState = {};
  const lastFret: Record<number, number> = {};
  out.measures = track.measures.map((m, i) =>
    measureToTgx(m, headers[i], state, lastFret),
  );
  return out;
}

function songToTgx(song: TGSong): Record<string, unknown> {
  const out: Record<string, unknown> = { v: 1 };
  if (song.name) out.title = song.name;
  if (song.artist) out.artist = song.artist;
  if (song.album) out.album = song.album;
  out.tempo = song.measureHeaders[0]?.tempo ?? 120;
  // song-level tempo seeds the per-measure carry so it isn't re-emitted on bar 1
  out.tracks = song.tracks.map((t) => {
    const tx = trackToTgx(t, song, song.measureHeaders);
    return tx;
  });
  return out;
}

// ---- compact serialization --------------------------------------------------

// Pretty-print that keeps small leaves (notes, tuning, [pos,val] pairs, a whole
// single-note beat) on one line, matching docs/tgx-format.md and keeping the
// token count low. Containers longer than the threshold expand one-per-line, so
// measures/beats stay diff-friendly (one beat per line).
const INLINE_MAX = 80;

function stringifyTgx(value: unknown, indent = 0): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);

  const compact = JSON.stringify(value);
  if (compact.length <= INLINE_MAX) return compact;

  const pad = "  ".repeat(indent);
  const pad1 = "  ".repeat(indent + 1);

  if (Array.isArray(value)) {
    const items = value.map((v) => pad1 + stringifyTgx(v, indent + 1));
    return `[\n${items.join(",\n")}\n${pad}]`;
  }

  const entries = Object.entries(value).map(
    ([k, v]) => `${pad1}${JSON.stringify(k)}: ${stringifyTgx(v, indent + 1)}`,
  );
  return `{\n${entries.join(",\n")}\n${pad}}`;
}

// ---- extend prompt ----------------------------------------------------------

// Self-contained prompt (condensed schema inlined) so it needs no extra files
// when pasted into Claude. Encodes the docs/ai-features.md guardrails.
function buildExtendPrompt(nBars: number, tgxJson: string): string {
  return `You are a guitar composition assistant working in the TGX format (a compact JSON
tablature format). Extend the song below by ${nBars} new measure(s) that continue it
naturally.

TGX QUICK REFERENCE
- Song: { v, title?, artist?, tempo, tracks[] }
- Track: { name, program, channel, tuning[hi..lo MIDI], capo?, measures[] }
- Measure: { ts?[num,den], tempo?, ks?, marker?, repeat?, beats[] | voices[][] }
    ts/tempo/ks appear ONLY when they change from the previous measure.
- Beat: { d, notes[]?, rest?, chord?, stroke?, tremBar? }
- Note: { s:string(1=high), f:fret, art?[], dyn?, tied?, bend?, slide?, harm? }
- Duration d: w h q e s t x  (whole..64th); suffix "." = dotted, digit = tuplet (e.g. "q3").
- art: pm lr ho po vib wvib dead stac tap   dyn: ghost acc hacc
- slide: ls ss siu sid sou sod
- bend: preset ("half" "full" "1h" "full-r" "pb" ...) OR curve [[pos0-100,val(100=1 tone)],...]
- harm: "n" natural, {"a":fret} artificial, "p" pinch, "t" tap

HARD CONSTRAINTS (must hold for every note you add)
1. Stay in the same key / scale / mode as the existing bars. Infer it from the notes
   (resolve fret+string against the track tuning to get pitches) and state it back.
2. Match the established feel, rhythmic vocabulary, register and genre.
3. Physically playable on a 6-string guitar:
   - 0 <= fret <= 24, never negative.
   - Fretted notes sounding together stay within a 4-fret hand span.
   - Avoid position jumps greater than 5 frets between consecutive beats.
   - One note per string per beat.
4. Continue the measure numbering; keep the same track/tuning.

OUTPUT
First, one short line: the detected key/scale/mode and the genre you inferred.
Then ONLY the ${nBars} new measure object(s) as a JSON array, in TGX measure shape,
ready to append to tracks[0].measures. No prose around the JSON.

SONG (TGX)
${tgxJson}
`;
}

// ---- main -------------------------------------------------------------------

function main(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = join(here, "..", "..");

  const [inputArg, nBarsArg] = process.argv.slice(2);
  const inputPath = inputArg ? join(repoRoot, inputArg) : join(repoRoot, "china.tg");
  const nBars = Number(nBarsArg) > 0 ? Math.floor(Number(nBarsArg)) : 2;

  const base = basename(inputPath).replace(/\.tg$/i, "");

  const song = parseTgFile(readFileSync(inputPath));
  const tgx = songToTgx(song);
  const tgxJson = stringifyTgx(tgx);

  const tgxPath = join(here, `${base}.tgx`);
  const promptPath = join(here, `${base}-extend-prompt.txt`);
  writeFileSync(tgxPath, tgxJson + "\n");
  writeFileSync(promptPath, buildExtendPrompt(nBars, tgxJson));

  const trackCount = (tgx.tracks as unknown[]).length;
  const measureCount = song.tracks[0]?.measures.length ?? 0;
  const approxTokens = Math.round(tgxJson.length / 4);

  console.log(`Converted ${basename(inputPath)} -> ${base}.tgx`);
  console.log(`  tracks: ${trackCount}  measures(track 1): ${measureCount}`);
  console.log(`  tgx size: ${tgxJson.length} chars (~${approxTokens} tokens)`);
  console.log(`  wrote: scripts/ai/${base}.tgx`);
  console.log(`  wrote: scripts/ai/${base}-extend-prompt.txt  (extend by ${nBars} bar(s))`);
}

main();
