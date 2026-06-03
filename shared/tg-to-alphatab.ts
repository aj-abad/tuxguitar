import * as alphaTab from "@coderline/alphatab";
import type {
  TGBeat,
  TGDuration,
  TGMeasure,
  TGNote,
  TGSong,
  TGTrack,
  TGVoice,
} from "./model";
import { QUARTER_TIME } from "./model";

export function tgSongToScore(song: TGSong): alphaTab.model.Score {
  const score = new alphaTab.model.Score();
  score.title = song.name;
  score.artist = song.artist;
  score.album = song.album;
  score.music = song.author;
  score.words = song.writer;
  score.copyright = song.copyright;

  let prevTempo = -1;
  for (const header of song.measureHeaders) {
    const mb = new alphaTab.model.MasterBar();
    mb.timeSignatureNumerator = header.timeSignature.numerator;
    mb.timeSignatureDenominator = header.timeSignature.denominator;
    mb.isRepeatStart = header.repeatOpen;
    if (header.repeatClose > 0) {
      mb.repeatCount = header.repeatClose;
    }
    if (header.marker) {
      mb.section = new alphaTab.model.Section();
      mb.section.text = header.marker.title;
    }

    const tempoAuto = new alphaTab.model.Automation();
    tempoAuto.type = alphaTab.model.AutomationType.Tempo;
    tempoAuto.value = header.tempo;
    tempoAuto.isLinear = false;
    tempoAuto.ratioPosition = 0;
    tempoAuto.isVisible = header.tempo !== prevTempo;
    prevTempo = header.tempo;
    mb.tempoAutomations.push(tempoAuto);

    score.addMasterBar(mb);
  }

  for (const tgTrack of song.tracks) {
    const track = new alphaTab.model.Track();
    track.name = tgTrack.name;
    track.shortName = tgTrack.name.slice(0, 10);

    const pb = new alphaTab.model.PlaybackInformation();
    const channel = song.channels.find((c) => c.id === tgTrack.channelId);
    if (channel) {
      pb.program = channel.program;
      pb.primaryChannel = channel.id;
      pb.secondaryChannel = channel.id;
      pb.volume = channel.volume;
      pb.balance = channel.balance;
    }
    track.playbackInfo = pb;

    score.addTrack(track);

    const staff = new alphaTab.model.Staff();
    track.addStaff(staff);
    staff.showTablature = true;
    staff.showStandardNotation = true;
    staff.capo = 0;

    // TG string 1 = highest (thin e); alphaTab tuning[0] = top of tab = highest pitch.
    // Sort TG strings by number (1=highest) and map values directly.
    const sortedStrings = [...tgTrack.strings].sort((a, b) => a.number - b.number);
    staff.stringTuning.tunings = sortedStrings.map((s) => s.value);

    // Custom tuning label, e.g. "6-string guitar, E A D G B E".
    // tunings[] is high→low (string 1 = high e); reverse to low→high for display.
    // A non-empty name is preserved by Tuning.finish(); leaving it empty would
    // let alphaTab fill in its preset name ("Guitar Standard Tuning").
    const tuningNotes = [...staff.stringTuning.tunings]
      .reverse()
      .map((v) => alphaTab.model.Tuning.getTextForTuning(v, false))
      .join(" ");
    if (staff.stringTuning.tunings.length > 0) {
      staff.stringTuning.name = `${staff.stringTuning.tunings.length}-string guitar, ${tuningNotes}`;
    }

    addBarsForTrack(staff, tgTrack, song.measureHeaders.length);
  }

  score.finish(new alphaTab.Settings());
  return score;
}

function addBarsForTrack(
  staff: alphaTab.model.Staff,
  tgTrack: TGTrack,
  measureCount: number,
): void {
  for (let mi = 0; mi < Math.min(tgTrack.measures.length, measureCount); mi++) {
    const tgMeasure = tgTrack.measures[mi];
    const bar = new alphaTab.model.Bar();
    bar.clef =
      staff.stringTuning.tunings.length > 0 &&
      staff.stringTuning.tunings[staff.stringTuning.tunings.length - 1] < 40
        ? alphaTab.model.Clef.F4
        : alphaTab.model.Clef.G2;
    staff.addBar(bar);
    addVoicesForBar(bar, tgMeasure, staff.stringTuning.tunings.length);
  }
}

function addVoicesForBar(
  bar: alphaTab.model.Bar,
  tgMeasure: TGMeasure,
  stringCount: number,
): void {
  // TG: beats[] each has voices[]. Restructure to alphaTab: voices each have beats[].
  const voiceCount = tgMeasure.beats.length > 0 ? tgMeasure.beats[0].voices.length : 1;

  for (let vi = 0; vi < Math.min(voiceCount, 4); vi++) {
    const beatsForVoice = tgMeasure.beats.map((b) => ({ beat: b, voice: b.voices[vi] }));
    if (beatsForVoice.every(({ voice }) => !voice || voice.empty)) continue;

    const voice = new alphaTab.model.Voice();
    bar.addVoice(voice);

    for (const { beat: tgBeat, voice: tgVoice } of beatsForVoice) {
      if (!tgVoice) continue;
      addBeat(voice, tgBeat, tgVoice, stringCount);
    }
  }

  // alphaTab requires at least one voice per bar
  if (bar.voices.length === 0) {
    const emptyVoice = new alphaTab.model.Voice();
    bar.addVoice(emptyVoice);
    const restBeat = new alphaTab.model.Beat();
    restBeat.duration = alphaTab.model.Duration.Whole;
    emptyVoice.addBeat(restBeat);
  }
}

function addBeat(
  voice: alphaTab.model.Voice,
  tgBeat: TGBeat,
  tgVoice: TGVoice,
  stringCount: number,
): void {
  if (tgVoice.empty) return;

  const beat = new alphaTab.model.Beat();
  beat.duration = tgDuration(tgVoice.duration);
  if (tgVoice.duration.dotted) beat.dots = 1;
  if (tgVoice.duration.doubleDotted) beat.dots = 2;
  if (tgVoice.duration.division) {
    beat.tupletNumerator = tgVoice.duration.division.enters;
    beat.tupletDenominator = tgVoice.duration.division.times;
  }
  if (tgBeat.text) beat.text = tgBeat.text;

  for (const tgNote of tgVoice.notes) {
    addNote(beat, tgNote, stringCount);
  }

  voice.addBeat(beat);
}

function addNote(beat: alphaTab.model.Beat, tgNote: TGNote, stringCount: number): void {
  const note = new alphaTab.model.Note();
  note.fret = tgNote.value;
  // TG string 1 = highest; alphaTab string N = highest (where N = stringCount).
  note.string = stringCount + 1 - tgNote.string;
  note.isTieDestination = tgNote.tiedNote;
  note.isDead = tgNote.effect.deadNote;
  note.isGhost = tgNote.effect.ghostNote;
  note.isLetRing = tgNote.effect.letRing;
  note.isPalmMute = tgNote.effect.palmMute;
  note.isStaccato = tgNote.effect.staccato;
  note.isHammerPullOrigin = tgNote.effect.hammer;
  note.vibrato = tgNote.effect.vibrato
    ? alphaTab.model.VibratoType.Slight
    : alphaTab.model.VibratoType.None;
  if (tgNote.effect.slide) {
    note.slideOutType = alphaTab.model.SlideOutType.Shift;
  }
  beat.addNote(note);
}

function tgDuration(d: TGDuration): alphaTab.model.Duration {
  switch (d.value) {
    case 1:
      return alphaTab.model.Duration.Whole;
    case 2:
      return alphaTab.model.Duration.Half;
    case 4:
      return alphaTab.model.Duration.Quarter;
    case 8:
      return alphaTab.model.Duration.Eighth;
    case 16:
      return alphaTab.model.Duration.Sixteenth;
    case 32:
      return alphaTab.model.Duration.ThirtySecond;
    case 64:
      return alphaTab.model.Duration.SixtyFourth;
    default:
      return alphaTab.model.Duration.Quarter;
  }
}
