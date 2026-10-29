import { describe, expect, it } from 'vitest';
import { notationStudy } from './fixtures/notation-study.mjs';
import { parseTgFile } from '../shared/tg-reader';
import { exportMidi, songEndTick, TPQ, type MidiEvent } from '../shared/midi-export';
import { soundingNotes, pitchAt } from '../shared/midi-articulations';
import { PRECISE_FACTOR, PRECISE_STARTING_POINT, type TGNote, type TGNoteEffect } from '../shared/model';
import { createEditor, setBend, undoEdit } from '../shared/editor';
import { makeBend } from '../shared/technique-edits';

const template = parseTgFile(notationStudy({ techniques: false }));
const note = (fret = 0, effect: Partial<TGNoteEffect> = {}, string = 1, tied = false): TGNote => ({
  ...structuredClone(template.tracks[0].measures[0].beats[0].voices[0].notes[0]),
  value: fret, string, tiedNote: tied, velocity: 100,
  effect: { ...template.tracks[0].measures[0].beats[0].voices[0].notes[0].effect, ...effect },
});
function score(...frames: TGNote[][]) {
  const song = structuredClone(template), track = song.tracks[0];
  song.channels = [{ ...song.channels[0], id: 0, bank: 0, volume: 110, balance: 32, reverb: 0, chorus: 0, program: 25 }];
  song.tracks = [track]; track.channelId = 0;
  track.strings.forEach(string => { string.value = 60; });
  song.measureHeaders = []; track.measures = [];
  for (let offset = 0; offset < frames.length; offset += 4) {
    song.measureHeaders.push({ ...template.measureHeaders[0], number: offset / 4 + 1, start: TPQ + offset * TPQ,
      tempo: 120, timeSignature: { numerator: 4, denominator: 4 } });
    track.measures.push({ clef: 1, keySignature: 0, beats: frames.slice(offset, offset + 4).map((notes, index) => ({
      preciseStart: PRECISE_STARTING_POINT + (offset + index) * TPQ * PRECISE_FACTOR,
      voices: [{ empty: false, direction: 0, duration: { value: 4, dotted: false, doubleDotted: false }, notes }],
    })) });
  }
  return song;
}
const on = (events: MidiEvent[]) => events.filter(event => event.type === 'note_on');
const off = (events: MidiEvent[]) => events.filter(event => event.type === 'note_off');
const bends = (events: MidiEvent[], ch = 0) => events.filter(event => event.type === 'pitch_bend' && event.ch === ch);
const lastBend = (events: MidiEvent[], tick: number, ch = 0) => bends(events, ch).filter(event => event.tick <= tick).at(-1)!.value;
const wheel = (semitones: number, range = 12) => Math.min(16383, Math.round(8192 + semitones * 8192 / range));

describe('articulation playback', () => {
  it('uses quarter-tone units and interpolates a full bend before holding it', () => {
    const song = score([note(0, { bend: makeBend('bend', 4) })]), before = structuredClone(song);
    const events = exportMidi(song);
    expect(lastBend(events, 0)).toBe(8192);
    expect(lastBend(events, 240)).toBe(wheel(1));
    expect(lastBend(events, 480)).toBe(wheel(2));
    expect(lastBend(events, 959)).toBe(wheel(2));
    expect(events).toContainEqual({ type: 'control', tick: 0, ch: 0, cc: 6, value: 12 });
    expect(on(events)).toEqual([{ type: 'note_on', tick: 0, ch: 0, note: 60, vel: 100 }]);
    expect(song).toEqual(before);
  });
  it.each([1, 2, 6, 12])('plays a %s quarter-tone pre-bend before the attack, then releases', amount => {
    const events = exportMidi(score([note(0, { bend: makeBend('prebend-release', amount) })]));
    expect(lastBend(events, 0)).toBe(wheel(amount / 2));
    expect(lastBend(events, 720)).toBe(wheel(amount / 4));
    expect(lastBend(events, 960)).toBe(8192);
    const attack = events.findIndex(event => event.type === 'note_on');
    expect(events.slice(0, attack).at(-1)).toMatchObject({ type: 'pitch_bend', value: wheel(amount / 2) });
  });
  it('plays imported multi-stage curves without replacing their timing', () => {
    const curve = { points: [[0, 0], [3, 4], [6, 4], [9, 2], [12, 6]].map(([position, value]) => ({ position, value })) };
    const events = exportMidi(score([note(0, { bend: curve })]));
    expect([240, 480, 720, 960].map(tick => lastBend(events, tick))).toEqual([wheel(2), wheel(2), wheel(1), wheel(3)]);
  });
  it('isolates two simultaneous bends from each other and an unbent chord note', () => {
    const events = exportMidi(score([note(0, { bend: makeBend('bend', 4) }), note(4, { bend: makeBend('bend-release', 2) }, 2), note(7, {}, 3)]));
    const attacks = on(events), first = attacks.find(event => event.note === 60)!, second = attacks.find(event => event.note === 64)!, plain = attacks.find(event => event.note === 67)!;
    expect(new Set(attacks.map(event => event.ch)).size).toBe(3);
    expect(lastBend(events, 480, first.ch)).toBe(wheel(2));
    expect(lastBend(events, 480, second.ch)).toBe(wheel(1));
    expect(bends(events, plain.ch).every(event => event.value === 8192)).toBe(true);
    for (const attack of attacks) {
      expect(events).toContainEqual({ type: 'program', tick: 0, ch: attack.ch, program: 25 });
      expect(events).toContainEqual({ type: 'control', tick: 0, ch: attack.ch, cc: 7, value: 110 });
      expect(events).toContainEqual({ type: 'control', tick: 0, ch: attack.ch, cc: 10, value: 32 });
    }
  });
  it('resets a reused bend channel before an ordinary note and preserves same-tick ordering', () => {
    const events = exportMidi(score([note(0, { bend: makeBend('bend', 4) })], [note(2)]));
    const boundary = events.filter(event => event.tick === 960);
    expect(boundary[0].type).toBe('note_off');
    expect(boundary.at(-1)!.type).toBe('note_on');
    expect(lastBend(events, 960)).toBe(8192);
    expect(boundary).toContainEqual({ type: 'control', tick: 960, ch: 0, cc: 120, value: 0 });
  });
  it.each([7, -5, 36])('slides by %s semitones without clipping, then attacks the destination in tune', distance => {
    const events = exportMidi(score([note(5, { slide: true })], [note(5 + distance)]));
    const source = on(events)[0], range = Math.max(12, Math.abs(distance));
    expect(lastBend(events, 480, source.ch)).toBe(8192);
    expect(lastBend(events, 720, source.ch)).toBe(wheel(distance / 2, range));
    const atEnd = bends(events, source.ch).filter(event => event.tick === 960);
    expect(atEnd[0].value).toBe(wheel(distance, range));
    expect(atEnd.at(-1)!.value).toBe(8192);
    expect(on(events)[1]).toMatchObject({ tick: 960, note: 65 + distance });
  });
  it('softens the destination of H/P and overlaps briefly, including the last note of a chain', () => {
    const events = exportMidi(score([note(0, { hammer: true })], [note(4, { hammer: true })], [note(0)]));
    expect(on(events).map(event => event.vel)).toEqual([100, 75, 75]);
    expect(off(events).map(event => event.tick)).toEqual([979, 1939, 2880]);
    expect(bends(events).every(event => event.value === 8192)).toBe(true);
  });
  it('extends ties across a bar without let-ring or additional attacks', () => {
    const song = score([], [], [], [note(5)], [note(5, {}, 1, true)], [note(5, {}, 1, true)]);
    expect(on(exportMidi(song))).toHaveLength(1);
    expect(off(exportMidi(song))).toEqual([{ type: 'note_off', ch: 0, note: 65, vel: 0, tick: 5760 }]);
    expect(songEndTick(song)).toBe(5760);
  });
  it('continues bend pitch through a tie and applies a release written on the tied destination', () => {
    const held = score([note(0, { bend: makeBend('bend', 4) })], [note(0, {}, 1, true)], [note(0, { bend: makeBend('prebend-release', 4) }, 1, true)]);
    const events = exportMidi(held);
    expect(on(events)).toHaveLength(1);
    expect(lastBend(events, 1920)).toBe(wheel(2));
    expect(lastBend(events, 2640)).toBe(wheel(1));
    expect(lastBend(events, 2880)).toBe(8192);
  });
  it('does not slide, soften, or tie across rests, time gaps, or voices', () => {
    for (const effect of [{ slide: true }, { hammer: true }]) {
      const song = score([note(0, effect)], [], [note(4)]);
      expect(on(exportMidi(song)).map(event => event.vel)).toEqual([100, 100]);
      expect(bends(exportMidi(song)).every(event => event.value === 8192)).toBe(true);
      song.tracks[0].measures[0].beats.splice(1, 1);
      expect(soundingNotes(song)[0].end).toBe(960);
      const separate = score([note(0, effect)], [note(4)]);
      separate.tracks[0].measures[0].beats[1].voices.unshift({ empty: true, direction: 0, notes: [], duration: { value: 4, dotted: false, doubleDotted: false } });
      expect(soundingNotes(separate)[1].velocity).toBe(100);
      expect(soundingNotes(separate)[0].pitchPoints).toEqual([]);
    }
    expect(on(exportMidi(score([note()], [], [note(0, {}, 1, true)])))).toHaveLength(2);
  });
  it('does not tie changed pitches or hide an orphan tied note', () => {
    expect(on(exportMidi(score([note(0, {}, 1, true)], [note(4, {}, 1, true)])))).toHaveLength(2);
  });
  it('lets a string ring under other strings until its next attack or a rest', () => {
    const song = score([note(0, { letRing: true })], [note(7, {}, 2)], [note(2)]);
    expect(soundingNotes(song)[0].end).toBe(1920);
    song.tracks[0].measures[0].beats[2].voices[0].notes = [];
    expect(soundingNotes(song)[0].end).toBe(1920);
  });
  it('handles swing, dotted and tuplet durations and clips pitch ramps to short notes', () => {
    const song = score([note(0, { bend: makeBend('bend', 4) })], [note(0, {}, 1, true)]);
    const beats = song.tracks[0].measures[0].beats;
    beats.forEach(beat => { beat.voices[0].duration.value = 8; });
    beats[1].preciseStart = PRECISE_STARTING_POINT + 480 * PRECISE_FACTOR;
    song.measureHeaders[0].tripletFeel = 1;
    expect(songEndTick(song)).toBe(960);
    expect(lastBend(exportMidi(song), 320)).toBe(wheel(2));
    song.measureHeaders[0].tripletFeel = 0;
    beats.splice(1);
    beats[0].voices[0].duration.dotted = true;
    expect(songEndTick(song)).toBe(720);
    beats[0].voices[0].duration.dotted = false;
    beats[0].voices[0].duration.division = { enters: 3, times: 2 };
    expect(songEndTick(song)).toBe(320);
    beats[0].voices[0].notes[0].effect.palmMute = true;
    expect(songEndTick(song)).toBe(115);
    expect(Math.max(...bends(exportMidi(song)).map(event => event.tick))).toBeLessThanOrEqual(115);
  });
  it('keeps drum notes on channel 10 and does not pitch-bend percussion', () => {
    const song = score([note(0, { bend: makeBend('bend', 4), slide: true, hammer: true })], [note(4)]);
    song.channels[0].id = 9; song.tracks[0].channelId = 9;
    const events = exportMidi(song);
    expect(on(events).every(event => event.ch === 9 && event.vel === 100)).toBe(true);
    expect(events.filter(event => event.type === 'pitch_bend')).toEqual([]);
  });
  it('separates overlapping unisons, reuses idle channels, and reports exhaustion without retuning notes', () => {
    const song = score([note(), note(0, {}, 2)]);
    expect(new Set(on(exportMidi(song)).map(event => event.ch)).size).toBe(2);
    song.tracks[0].strings = Array.from({ length: 16 }, (_, index) => ({ number: index + 1, value: 60 }));
    song.tracks[0].measures[0].beats[0].voices[0].notes = Array.from({ length: 16 }, (_, index) => note(0, { bend: makeBend('bend', 4) }, index + 1));
    expect(() => exportMidi(song)).toThrow('15 independent melodic channels');
    expect(songEndTick(song)).toBe(960);
    song.tracks[0].mute = true;
    expect(on(exportMidi(song))).toEqual([]);
  });
  it('loads edited bends and returns to clean MIDI after undo', () => {
    const editor = createEditor('id', 'playback.tg', score([note()]));
    const bent = setBend(editor, makeBend('bend-release', 4));
    expect(lastBend(exportMidi(bent.song), 480)).toBe(wheel(2));
    expect(exportMidi(undoEdit(bent).song)).toEqual(exportMidi(editor.song));
  });
  it('keeps a pre-bend on a tied segment from becoming an earlier ramp', () => {
    const planned = soundingNotes(score([note()], [note(0, { bend: makeBend('prebend', 4) }, 1, true)]))[0];
    expect(pitchAt(planned.pitchPoints, 959)).toBe(0);
    expect(pitchAt(planned.pitchPoints, 960)).toBe(2);
  });
});
