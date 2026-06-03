// TypeScript port of app.tuxguitar.song.models.*

// Timing constants (see TGDuration.java)
// WHOLE_PRECISE_DURATION = lcm(64, all tuplet enters) * 4
export const WHOLE_PRECISE_DURATION = 11531520;
export const QUARTER_TIME = 960;
// First beat of first measure starts here (in precise units)
export const PRECISE_STARTING_POINT = WHOLE_PRECISE_DURATION / 4; // 2882880
// Converts QUARTER_TIME ticks → precise ticks: precise = qt * PRECISE_FACTOR
export const PRECISE_FACTOR = WHOLE_PRECISE_DURATION / (QUARTER_TIME * 4); // 3003

export const CLEF_TREBLE = 1;
export const CLEF_BASS = 2;
export const CLEF_TENOR = 3;
export const CLEF_ALTO = 4;

export const TRIPLET_FEEL_NONE = 0;
export const TRIPLET_FEEL_EIGHTH = 1;
export const TRIPLET_FEEL_SIXTEENTH = 2;

export const STROKE_NONE = 0;
export const STROKE_UP = 1;
export const STROKE_DOWN = 2;

export const PICK_STROKE_UP = 1;
export const PICK_STROKE_DOWN = 2;

export const DIRECTION_UP = 1;
export const DIRECTION_DOWN = 2;

export const HARMONIC_NATURAL = 1;
export const HARMONIC_ARTIFICIAL = 2;
export const HARMONIC_PINCH = 3;
export const HARMONIC_SEMI = 4;
export const HARMONIC_TAPPED = 5;

export const GRACE_TRANSITION_NONE = 0;
export const GRACE_TRANSITION_SLIDE = 1;
export const GRACE_TRANSITION_BEND = 2;
export const GRACE_TRANSITION_HAMMER = 3;

export interface TGSong {
  name: string;
  artist: string;
  album: string;
  author: string;
  date: string;
  copyright: string;
  writer: string;
  transcriber: string;
  comments: string;
  channels: TGChannel[];
  measureHeaders: TGMeasureHeader[];
  tracks: TGTrack[];
}

export interface TGChannel {
  id: number;
  bank: number;
  program: number;
  volume: number;
  balance: number;
  chorus: number;
  reverb: number;
  phaser: number;
  tremolo: number;
  name: string;
  parameters: TGChannelParameter[];
}

export interface TGChannelParameter {
  key: string;
  value: string;
}

export interface TGMeasureHeader {
  number: number;
  start: number; // in QUARTER_TIME ticks
  timeSignature: { numerator: number; denominator: number };
  tempo: number;
  tempoBase: number; // duration value (4 = quarter, 8 = eighth, etc.)
  tempoDotted: boolean;
  repeatOpen: boolean;
  repeatClose: number; // 0 = not closing; >0 = close after N times
  repeatAlternative: number; // bitmask of alternative numbers
  marker?: { title: string; color: { r: number; g: number; b: number } };
  tripletFeel: number;
  lineBreak: boolean;
}

export interface TGTrack {
  number: number;
  name: string;
  channelId: number;
  maxFret: number;
  solo: boolean;
  mute: boolean;
  offset: number;
  color: { r: number; g: number; b: number };
  strings: TGString[];
  lyrics: { from: number; text: string };
  measures: TGMeasure[];
}

export interface TGString {
  number: number;
  value: number; // MIDI pitch of open string
}

export interface TGMeasure {
  clef: number;
  keySignature: number;
  beats: TGBeat[];
}

export interface TGBeat {
  preciseStart: number; // in WHOLE_PRECISE_DURATION units
  stroke?: { direction: number; value: number };
  pickStroke?: number;
  chord?: TGChord;
  text?: string;
  voices: TGVoice[];
}

export interface TGChord {
  name: string;
  firstFret: number;
  frets: number[]; // -1 = string not played
}

export interface TGVoice {
  direction: number;
  empty: boolean;
  duration: TGDuration;
  notes: TGNote[];
}

export interface TGDuration {
  value: number; // 1=whole 2=half 4=quarter 8=eighth 16=16th 32=32nd 64=64th
  dotted: boolean;
  doubleDotted: boolean;
  division?: { enters: number; times: number };
}

export interface TGNote {
  value: number; // fret number
  string: number; // 1-based string number
  velocity: number;
  tiedNote: boolean;
  effect: TGNoteEffect;
  altEnharmonic: boolean;
}

export interface TGNoteEffect {
  vibrato: boolean;
  deadNote: boolean;
  slide: boolean;
  hammer: boolean;
  ghostNote: boolean;
  accentuatedNote: boolean;
  heavyAccentuatedNote: boolean;
  palmMute: boolean;
  staccato: boolean;
  tapping: boolean;
  slapping: boolean;
  popping: boolean;
  fadeIn: boolean;
  letRing: boolean;
  bend?: TGEffectPoints;
  tremoloBar?: TGEffectPoints;
  harmonic?: { type: number; data: number };
  grace?: TGEffectGrace;
  trill?: { fret: number; duration: number };
  tremoloPicking?: { duration: number };
}

export interface TGEffectPoints {
  points: Array<{ position: number; value: number }>;
}

export interface TGEffectGrace {
  fret: number;
  duration: number;
  dynamic: number;
  transition: number;
  onBeat: boolean;
  dead: boolean;
}
