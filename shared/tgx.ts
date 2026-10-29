import type { TGSong } from './model';
import { durationPrecise } from './score-edits';
import { validateTabDesign } from './tab-design';
import { parseTgFile, validateFirstBeatPreciseStart } from './tg-reader';
import { modelSignature } from './model-signature';

export interface TgxDocument { v: 2; song: TGSong; sourceTg?: string }
type ObjectValue = Record<string, any>;
const invalid = () => new Error('Invalid TGX song data.');
function object(value: unknown): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  return value as ObjectValue;
}
function list(value: unknown, max = 100_000): any[] {
  if (!Array.isArray(value) || value.length > max) throw invalid();
  return value;
}
function numbers(value: ObjectValue, fields: string[]) {
  if (fields.some(key => !Number.isFinite(value[key]))) throw invalid();
}
function strings(value: ObjectValue, fields: string[]) {
  if (fields.some(key => typeof value[key] !== 'string')) throw invalid();
}
function booleans(value: ObjectValue, fields: string[]) {
  if (fields.some(key => typeof value[key] !== 'boolean')) throw invalid();
}
function points(value: unknown) {
  for (const point of list(object(value).points, 1024)) numbers(object(point), ['position', 'value']);
}

/** Validate at the file boundary before renderer, history or audio sees the song. */
export function validateTgxSong(value: unknown): asserts value is TGSong {
  const song = object(value);
  strings(song, ['name', 'artist', 'album', 'author', 'date', 'copyright', 'writer', 'transcriber', 'comments']);
  const channels = list(song.channels, 256), headers = list(song.measureHeaders), tracks = list(song.tracks, 256);
  if (!headers.length || !tracks.length) throw invalid();
  for (const channel of channels) {
    const c = object(channel);
    numbers(c, ['id', 'bank', 'program', 'volume', 'balance', 'chorus', 'reverb', 'phaser', 'tremolo']);
    strings(c, ['name']);
    for (const parameter of list(c.parameters, 4096)) strings(object(parameter), ['key', 'value']);
  }
  let previousStart = -Infinity;
  for (const header of headers) {
    const h = object(header), signature = object(h.timeSignature);
    numbers(h, ['number', 'start', 'tempo', 'tempoBase', 'repeatClose', 'repeatAlternative', 'tripletFeel']);
    numbers(signature, ['numerator', 'denominator']);
    booleans(h, ['tempoDotted', 'repeatOpen', 'lineBreak']);
    if (h.start <= previousStart || h.tempo <= 0 || signature.numerator <= 0 || signature.denominator <= 0) throw invalid();
    previousStart = h.start;
    if (h.marker !== undefined) { strings(object(h.marker), ['title']); numbers(object(h.marker.color), ['r', 'g', 'b']); }
  }
  let beatCount = 0;
  for (const track of tracks) {
    const t = object(track);
    strings(t, ['name']); numbers(t, ['number', 'channelId', 'maxFret', 'offset']); booleans(t, ['solo', 'mute']);
    numbers(object(t.color), ['r', 'g', 'b']);
    strings(object(t.lyrics), ['text']); numbers(t.lyrics, ['from']);
    const tuning = list(t.strings, 24);
    for (const string of tuning) numbers(object(string), ['number', 'value']);
    if (tuning.some(s => !Number.isInteger(s.number) || s.number < 1) || new Set(tuning.map(s => s.number)).size !== tuning.length) throw invalid();
    const measures = list(t.measures);
    if (measures.length !== headers.length) throw invalid();
    if (t.tabLayout !== undefined) validateTabDesign(t.tabLayout, measures.length);
    for (const measure of measures) {
      const m = object(measure); numbers(m, ['clef', 'keySignature']);
      let previousBeat = -Infinity;
      for (const beat of list(m.beats, 4096)) {
        if (++beatCount > 1_000_000) throw invalid();
        const b = object(beat); numbers(b, ['preciseStart']);
        if (b.preciseStart <= previousBeat) throw invalid();
        previousBeat = b.preciseStart;
        if (b.text !== undefined) strings(b, ['text']);
        if (b.stroke !== undefined) numbers(object(b.stroke), ['direction', 'value']);
        if (b.pickStroke !== undefined) numbers(b, ['pickStroke']);
        if (b.chord !== undefined) {
          strings(object(b.chord), ['name']); numbers(b.chord, ['firstFret']);
          if (list(b.chord.frets, 24).some(n => !Number.isFinite(n))) throw invalid();
        }
        for (const voice of list(b.voices, 16)) {
          const v = object(voice); numbers(v, ['direction']); booleans(v, ['empty']); durationPrecise(v.duration);
          for (const note of list(v.notes, 128)) {
            const n = object(note), effect = object(n.effect);
            numbers(n, ['value', 'string', 'velocity']); booleans(n, ['tiedNote', 'altEnharmonic']);
            booleans(effect, ['vibrato', 'deadNote', 'slide', 'hammer', 'ghostNote', 'accentuatedNote', 'heavyAccentuatedNote',
              'palmMute', 'staccato', 'tapping', 'slapping', 'popping', 'fadeIn', 'letRing']);
            for (const name of ['bend', 'tremoloBar']) if (effect[name] !== undefined) points(effect[name]);
            if (effect.harmonic !== undefined) numbers(object(effect.harmonic), ['type', 'data']);
            if (effect.grace !== undefined) {
              numbers(object(effect.grace), ['fret', 'duration', 'dynamic', 'transition']); booleans(effect.grace, ['onBeat', 'dead']);
            }
            if (effect.trill !== undefined) numbers(object(effect.trill), ['fret', 'duration']);
            if (effect.tremoloPicking !== undefined) numbers(object(effect.tremoloPicking), ['duration']);
          }
        }
      }
    }
  }
  validateFirstBeatPreciseStart(song as TGSong);
}

const musicalSignature = (song: TGSong) => modelSignature({ ...song, tracks: song.tracks.map(({ tabLayout, ...track }) => track) });

export function parseTgxFile(bytes: Uint8Array): { song: TGSong; sourceTg?: Uint8Array } {
  if (bytes.byteLength > 64 * 1024 * 1024) throw new Error('TGX files must be smaller than 64 MB.');
  const document = object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  if (document.v !== 2) throw new Error('This TGX version is not supported. Reconvert the original .tg file to TGX v2.');
  validateTgxSong(document.song);
  let sourceTg: Uint8Array | undefined;
  if (document.sourceTg !== undefined) {
    if (typeof document.sourceTg !== 'string') throw invalid();
    sourceTg = Uint8Array.from(atob(document.sourceTg), c => c.charCodeAt(0));
    if (musicalSignature(parseTgFile(sourceTg)) !== musicalSignature(document.song)) throw new Error('The TGX song and preserved TG source disagree.');
  }
  return { song: document.song, sourceTg };
}

export function writeTgxFile(song: TGSong, sourceTg?: Uint8Array): Uint8Array {
  validateTgxSong(song);
  const document: TgxDocument = { v: 2, song };
  if (sourceTg) {
    // Chunking avoids overflowing the argument stack on large source archives.
    let binary = '';
    for (let i = 0; i < sourceTg.length; i += 8192) binary += String.fromCharCode(...sourceTg.subarray(i, i + 8192));
    document.sourceTg = btoa(binary);
  }
  const bytes = new TextEncoder().encode(JSON.stringify(document, null, 2) + '\n');
  const reopened = parseTgxFile(bytes);
  if (modelSignature(reopened.song) !== modelSignature(song)) throw new Error('TGX save verification failed.');
  return bytes;
}
