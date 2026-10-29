import { QUARTER_TIME, type TGChannel, type TGSong } from './model';
import { soundingNotes, type SoundingNote } from './midi-articulations';

export const TPQ = QUARTER_TIME;
export type MidiEvent =
  | { type: 'tempo'; tick: number; usq: number }
  | { type: 'program'; tick: number; ch: number; program: number }
  | { type: 'control'; tick: number; ch: number; cc: number; value: number }
  | { type: 'pitch_bend'; tick: number; ch: number; value: number }
  | { type: 'note_on'; tick: number; ch: number; note: number; vel: number }
  | { type: 'note_off'; tick: number; ch: number; note: number; vel: number };

const clamp = (value: number, high = 127) => Math.max(0, Math.min(high, Math.round(value)));
const preferredChannel = (channel: TGChannel) => channel.id < 9 ? channel.id : Math.min(channel.id + 1, 15);
interface ChannelState { ch: number; source?: TGChannel; bent: boolean; active: SoundingNote[] }

function setup(out: MidiEvent[], source: TGChannel, ch: number, tick: number, range: number, recycle: boolean) {
  const control = (cc: number, value: number) => out.push({ type: 'control', tick, ch, cc, value: clamp(value) });
  // Silence release tails before changing a recycled channel's tuning/program.
  if (recycle) control(120, 0);
  control(0, source.bank);
  control(7, source.volume); control(10, source.balance);
  control(91, source.reverb); control(93, source.chorus);
  out.push({ type: 'program', tick, ch, program: clamp(source.program) });
  if (ch !== 9) {
    // RPN 0: explicitly set pitch-bend sensitivity in semitones and cents.
    control(101, 0); control(100, 0); control(6, range); control(38, 0);
    control(101, 127); control(100, 127);
    out.push({ type: 'pitch_bend', tick, ch, value: 8192 });
  }
}

function pitchEvents(out: MidiEvent[], note: SoundingNote, ch: number, range: number, step: number) {
  let lastValue = -1;
  const point = (tick: number, semitones: number) => {
    const value = clamp(8192 + semitones * 8192 / range, 16383);
    if (value !== lastValue) out.push({ type: 'pitch_bend', tick, ch, value });
    lastValue = value;
  };
  note.pitchPoints.forEach((to, index, points) => {
    const from = points[index - 1];
    if (from && from.semitones !== to.semitones) {
      const length = to.tick - from.tick;
      // Also bound pitch steps to five cents for fast or wide slides.
      const count = Math.min(length, Math.max(Math.ceil(length / step), Math.ceil(Math.abs(to.semitones - from.semitones) * 20)));
      for (let index = 1; index < count; index++) {
        const tick = Math.round(from.tick + length * index / count);
        point(tick, from.semitones + (to.semitones - from.semitones) * (tick - from.tick) / (to.tick - from.tick));
      }
    }
    point(to.tick, to.semitones);
  });
}

export function exportMidi(song: TGSong): MidiEvent[] {
  const out: MidiEvent[] = [];
  let previousTempo = -1;
  for (const header of song.measureHeaders) {
    const usq = Math.round(60_000_000 / header.tempo);
    if (usq !== previousTempo) out.push({ type: 'tempo', tick: header.start - TPQ, usq });
    previousTempo = usq;
  }
  const channels: ChannelState[] = Array.from({ length: 16 }, (_, ch) => ({ ch, bent: false, active: [] }));
  // At most 5 ms between pitch updates at the slowest tempo (one tick minimum).
  const minTempo = song.measureHeaders.reduce((bpm, header) => Math.min(bpm, header.tempo), 120);
  const step = Math.max(1, Math.floor(TPQ * minTempo / 12_000));
  const notes = soundingNotes(song).sort((a, b) => a.start - b.start || Number(!!a.pitchPoints.length) - Number(!!b.pitchPoints.length));
  for (const note of notes) {
    for (const channel of channels) channel.active = channel.active.filter(active => active.end > note.start);
    const bent = !!note.pitchPoints.length;
    const melodic = channels.filter(channel => channel.ch !== 9);
    // Plain chord notes share a channel; changing pitches and overlapping unisons
    // need independent channels until note-off.
    let channel = note.channel.id === 9 ? channels[9] : !bent ? melodic.find(channel =>
      channel.source === note.channel && !channel.bent && !channel.active.some(active => active.pitch === note.pitch)) : undefined;
    channel ??= melodic.find(channel => !channel.active.length && channel.ch === preferredChannel(note.channel))
      ?? melodic.find(channel => !channel.active.length && !channel.source)
      ?? melodic.find(channel => !channel.active.length);
    if (!channel) throw new Error('Playback needs more than 15 independent melodic channels at once. Reduce overlapping bends or slides, or mute a track.');
    const range = Math.max(12, ...note.pitchPoints.map(point => Math.ceil(Math.abs(point.semitones))));
    if (channel.source !== note.channel || channel.bent || bent) {
      setup(out, note.channel, channel.ch, note.start, range, !!channel.source && !channel.active.length);
    }
    channel.source = note.channel; channel.bent = bent; channel.active.push(note);
    pitchEvents(out, note, channel.ch, range, step);
    out.push({ type: 'note_on', tick: note.start, ch: channel.ch, note: note.pitch, vel: note.velocity });
    out.push({ type: 'note_off', tick: note.end, ch: channel.ch, note: note.pitch, vel: 0 });
  }
  // Preserve channel update order: old endpoint, reset, new pre-bend, attack.
  const rank = (event: MidiEvent) => event.type === 'note_off' ? 0 : event.type === 'note_on' ? 2 : 1;
  out.sort((a, b) => a.tick - b.tick || rank(a) - rank(b));
  return out;
}

/** Duration planning does not allocate channels or generate dense pitch events. */
export function songEndTick(song: TGSong): number {
  return soundingNotes(song).reduce((end, note) => Math.max(end, note.end), 0);
}
