import { unzipSync } from "fflate";
import { XMLParser } from "fast-xml-parser";
import {
  CLEF_TREBLE,
  DIRECTION_UP,
  GRACE_TRANSITION_NONE,
  HARMONIC_NATURAL,
  PICK_STROKE_UP,
  PICK_STROKE_DOWN,
  PRECISE_STARTING_POINT,
  QUARTER_TIME,
  STROKE_NONE,
  STROKE_UP,
  STROKE_DOWN,
  TRIPLET_FEEL_NONE,
  type TGBeat,
  type TGChannel,
  type TGChannelParameter,
  type TGChord,
  type TGDuration,
  type TGEffectGrace,
  type TGEffectPoints,
  type TGMeasure,
  type TGMeasureHeader,
  type TGNote,
  type TGNoteEffect,
  type TGSong,
  type TGString,
  type TGTrack,
  type TGVoice,
} from "./model";

// Tags that must always be arrays regardless of count in the document
const ARRAY_TAGS = new Set([
  "TGChannel",
  "TGChannelParameter",
  "TGMeasureHeader",
  "TGTrack",
  "TGString",
  "TGMeasure",
  "TGBeat",
  "voice",
  "note",
  "point",
  "alternative",
  "string",
]);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  parseAttributeValue: true,
  allowBooleanAttributes: true,
  trimValues: true,
  textNodeName: "#text",
  isArray: (tagName: string) => ARRAY_TAGS.has(tagName),
});

// ---- helpers ----------------------------------------------------------------

function str(v: unknown): string {
  if (v == null || v === "") return "";
  return String(v);
}

function num(v: unknown, def = 0): number {
  if (v == null) return def;
  const n = Number(v);
  return isNaN(n) ? def : n;
}

function arr<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function has(node: Record<string, unknown>, key: string): boolean {
  return key in node && node[key] != null;
}

// A tag can be plain text (number/string) OR an object with @attrs + #text
function tagText(v: unknown): unknown {
  if (v == null) return undefined;
  if (typeof v === "object" && !Array.isArray(v)) {
    return (v as Record<string, unknown>)["#text"];
  }
  return v;
}

// ---- version.txt ------------------------------------------------------------

function parseVersion(text: string): { major: number; minor: number } {
  const [prefix, ver] = text.trim().split(" ");
  if (prefix !== "TuxGuitar_file_format" || !ver) {
    throw new Error(`Unrecognised version header: ${text.trim()}`);
  }
  const parts = ver.split(".").map(Number);
  return { major: parts[0] ?? 0, minor: parts[1] ?? 0 };
}

// ---- top-level --------------------------------------------------------------

export function parseTgFile(bytes: Uint8Array): TGSong {
  const entries = unzipSync(bytes);
  const versionEntry = entries["version.txt"];
  const contentEntry = entries["content.xml"];
  if (!versionEntry || !contentEntry) {
    throw new Error("Invalid .tg file: missing version.txt or content.xml");
  }

  const { major } = parseVersion(new TextDecoder().decode(versionEntry));
  if (major !== 2) {
    throw new Error(`Unsupported .tg format major version: ${major}`);
  }

  const xml = new TextDecoder("utf-8").decode(contentEntry);
  const doc = parser.parse(xml) as Record<string, unknown>;
  const root = doc["TuxGuitarFile"] as Record<string, unknown>;
  if (!root) throw new Error("Missing TuxGuitarFile root element");
  const songNode = root["TGSong"] as Record<string, unknown>;
  if (!songNode) throw new Error("Missing TGSong element");

  return parseSong(songNode);
}

// ---- song -------------------------------------------------------------------

function parseSong(node: Record<string, unknown>): TGSong {
  return {
    name: str(node["name"]),
    artist: str(node["artist"]),
    album: str(node["album"]),
    author: str(node["author"]),
    date: str(node["date"]),
    copyright: str(node["copyright"]),
    writer: str(node["writer"]),
    transcriber: str(node["transcriber"]),
    comments: str(node["comments"]),
    channels: arr(node["TGChannel"] as unknown[]).map((c) =>
      parseChannel(c as Record<string, unknown>)
    ),
    measureHeaders: parseMeasureHeaders(
      arr(node["TGMeasureHeader"] as unknown[])
    ),
    tracks: arr(node["TGTrack"] as unknown[]).map((t, i) =>
      parseTrack(t as Record<string, unknown>, i + 1)
    ),
  };
}

// ---- channels ---------------------------------------------------------------

function parseChannel(node: Record<string, unknown>): TGChannel {
  return {
    id: num(node["id"]),
    bank: num(node["bank"]),
    program: num(node["program"]),
    volume: num(node["volume"]),
    balance: num(node["balance"]),
    chorus: num(node["chorus"]),
    reverb: num(node["reverb"]),
    phaser: num(node["phaser"]),
    tremolo: num(node["tremolo"]),
    name: str(node["name"]),
    parameters: arr(node["TGChannelParameter"] as unknown[]).map((p) =>
      parseChannelParameter(p as Record<string, unknown>)
    ),
  };
}

function parseChannelParameter(
  node: Record<string, unknown>
): TGChannelParameter {
  return { key: str(node["@key"]), value: str(node["@value"]) };
}

// ---- measure headers --------------------------------------------------------

function parseMeasureHeaders(nodes: unknown[]): TGMeasureHeader[] {
  // Java carries forward tempo/timeSig when absent; we do the same
  let tsSig = { numerator: 4, denominator: 4 };
  let tempoValue = 120;
  let tempoBase = 4; // QUARTER
  let tempoDotted = false;
  let start = QUARTER_TIME;

  return nodes.map((raw, i) => {
    const node = raw as Record<string, unknown>;

    const tsNode = node["timeSignature"] as Record<string, unknown> | undefined;
    if (tsNode) {
      tsSig = {
        numerator: num(tsNode["@numerator"]),
        denominator: num(tsNode["@denominator"]),
      };
    }

    const tempoRaw = node["tempo"];
    if (tempoRaw != null) {
      if (typeof tempoRaw === "object" && !Array.isArray(tempoRaw)) {
        const t = tempoRaw as Record<string, unknown>;
        tempoValue = num(t["#text"], tempoValue);
        if (t["@base"] != null) tempoBase = num(t["@base"]);
        else tempoBase = 4;
        if (t["@dotted"] != null) tempoDotted = t["@dotted"] === "true";
        else tempoDotted = false;
      } else {
        tempoValue = num(tempoRaw, tempoValue);
        tempoBase = 4;
        tempoDotted = false;
      }
    }

    let repeatAlternative = 0;
    const raNode = node["repeatAlternative"] as
      | Record<string, unknown>
      | undefined;
    if (raNode) {
      for (const alt of arr(raNode["alternative"] as unknown[])) {
        repeatAlternative += Math.pow(2, num(alt) - 1);
      }
    }

    let marker: TGMeasureHeader["marker"];
    const markerNode = node["marker"] as Record<string, unknown> | undefined;
    if (markerNode) {
      marker = {
        title: str(tagText(markerNode) ?? markerNode["#text"]),
        color: {
          r: num(markerNode["@R"]),
          g: num(markerNode["@G"]),
          b: num(markerNode["@B"]),
        },
      };
    }

    // measure length in QUARTER_TIME ticks
    const measureLength =
      Math.round((tsSig.numerator * QUARTER_TIME * 4) / tsSig.denominator);
    const header: TGMeasureHeader = {
      number: i + 1,
      start,
      timeSignature: { ...tsSig },
      tempo: tempoValue,
      tempoBase,
      tempoDotted,
      repeatOpen: has(node, "repeatOpen"),
      repeatClose: num(node["repeatClose"], 0),
      repeatAlternative,
      marker,
      tripletFeel: parseTripletFeel(str(node["tripletFeel"])),
      lineBreak: has(node, "lineBreak"),
    };
    start += measureLength;
    return header;
  });
}

const TRIPLET_FEEL_MAP: Record<string, number> = {
  none: 0,
  eighth: 1,
  sixteenth: 2,
};

function parseTripletFeel(v: string): number {
  return TRIPLET_FEEL_MAP[v] ?? TRIPLET_FEEL_NONE;
}

// ---- tracks -----------------------------------------------------------------

function parseTrack(node: Record<string, unknown>, number: number): TGTrack {
  const colorNode = node["color"] as Record<string, unknown> | undefined;
  const lyricNode = node["TGLyric"] as Record<string, unknown> | undefined;
  const strings = arr(node["TGString"] as unknown[]);

  const soloMute = str(node["soloMute"]);

  return {
    number,
    name: str(node["name"]),
    channelId: num(node["channelId"]),
    maxFret: num(node["@maxFret"], 24),
    solo: soloMute === "solo",
    mute: soloMute === "mute",
    offset: num(node["offset"], 0),
    color: {
      r: num(colorNode?.["@R"]),
      g: num(colorNode?.["@G"]),
      b: num(colorNode?.["@B"]),
    },
    strings: strings.map((v, i) => ({
      number: i + 1,
      value: num(v),
    })) as TGString[],
    lyrics: lyricNode
      ? { from: num(lyricNode["@from"], 1), text: str(tagText(lyricNode)) }
      : { from: 1, text: "" },
    measures: arr(node["TGMeasure"] as unknown[]).map((m) =>
      parseMeasure(m as Record<string, unknown>)
    ),
  };
}

// ---- measures ---------------------------------------------------------------

const CLEF_MAP: Record<string, number> = {
  treble: 1,
  bass: 2,
  tenor: 3,
  alto: 4,
};

function parseMeasure(node: Record<string, unknown>): TGMeasure {
  const clefStr = str(node["clef"]);
  return {
    clef: CLEF_MAP[clefStr] ?? CLEF_TREBLE,
    keySignature: num(node["keySignature"], 0),
    beats: arr(node["TGBeat"] as unknown[]).map((b) =>
      parseBeat(b as Record<string, unknown>)
    ),
  };
}

// ---- beats ------------------------------------------------------------------

const STROKE_MAP: Record<string, number> = {
  none: STROKE_NONE,
  up: STROKE_UP,
  down: STROKE_DOWN,
};

const PICK_STROKE_MAP: Record<string, number> = {
  up: PICK_STROKE_UP,
  down: PICK_STROKE_DOWN,
};

function parseBeat(node: Record<string, unknown>): TGBeat {
  const strokeNode = node["stroke"] as Record<string, unknown> | undefined;
  const pickStrokeNode = node["pickStroke"];
  const chordNode = node["chord"] as Record<string, unknown> | undefined;

  const preciseStart = num(node["preciseStart"]);

  const beat: TGBeat = {
    preciseStart,
    voices: arr(node["voice"] as unknown[]).map((v) =>
      parseVoice(v as Record<string, unknown>)
    ),
  };

  if (strokeNode) {
    beat.stroke = {
      direction: STROKE_MAP[str(strokeNode["@direction"])] ?? STROKE_NONE,
      value: num(strokeNode["@value"]),
    };
  }

  if (pickStrokeNode != null) {
    beat.pickStroke =
      PICK_STROKE_MAP[str(tagText(pickStrokeNode))] ?? PICK_STROKE_UP;
  }

  if (chordNode) beat.chord = parseChord(chordNode);

  const textNode = node["text"];
  if (textNode != null) beat.text = str(tagText(textNode));

  return beat;
}

function parseChord(node: Record<string, unknown>): TGChord {
  const stringFrets = arr(node["string"] as unknown[]).map((v) =>
    v === "" || v == null ? -1 : num(v)
  );
  return {
    name: str(node["name"]),
    firstFret: num(node["firstFret"]),
    frets: stringFrets,
  };
}

// ---- voices -----------------------------------------------------------------

const DIRECTION_MAP: Record<string, number> = {
  up: DIRECTION_UP,
  down: 2,
};

function parseVoice(node: Record<string, unknown>): TGVoice {
  const notes = arr(node["note"] as unknown[]).map((n) =>
    parseNote(n as Record<string, unknown>)
  );

  const emptyAttr = node["@empty"];
  const empty =
    emptyAttr != null ? emptyAttr === "true" || emptyAttr === true : notes.length === 0;

  const durNode = node["duration"] as Record<string, unknown> | undefined;
  const duration = parseDuration(durNode);

  const dirAttr = node["@direction"];
  const direction = dirAttr ? (DIRECTION_MAP[str(dirAttr)] ?? DIRECTION_UP) : DIRECTION_UP;

  return { direction, empty, duration, notes };
}

function parseDuration(node: Record<string, unknown> | undefined): TGDuration {
  if (!node) return { value: 4, dotted: false, doubleDotted: false };

  const value = num(node["@value"], 4);
  const dottedAttr = str(node["@dotted"]);
  const dotted = dottedAttr === "dotted";
  const doubleDotted = dottedAttr === "doubleDotted";

  const divNode = node["divisionType"] as Record<string, unknown> | undefined;
  const division = divNode
    ? { enters: num(divNode["@enters"], 1), times: num(divNode["@times"], 1) }
    : undefined;

  return { value, dotted, doubleDotted, division };
}

// ---- notes ------------------------------------------------------------------

function parseNote(node: Record<string, unknown>): TGNote {
  return {
    value: num(node["@value"]),
    string: num(node["@string"]),
    velocity: num(node["@velocity"], 95),
    tiedNote: node["@tiedNote"] === "true" || node["@tiedNote"] === true,
    effect: parseNoteEffect(node),
    altEnharmonic: has(node, "alternativeEnharmonic"),
  };
}

function parseNoteEffect(node: Record<string, unknown>): TGNoteEffect {
  const effect: TGNoteEffect = {
    vibrato: has(node, "vibrato"),
    deadNote: has(node, "deadNote"),
    slide: has(node, "slide"),
    hammer: has(node, "hammer"),
    ghostNote: has(node, "ghostNote"),
    accentuatedNote: has(node, "accentuatedNote"),
    heavyAccentuatedNote: has(node, "heavyAccentuatedNote"),
    palmMute: has(node, "palmMute"),
    staccato: has(node, "staccato"),
    tapping: has(node, "tapping"),
    slapping: has(node, "slapping"),
    popping: has(node, "popping"),
    fadeIn: has(node, "fadeIn"),
    letRing: has(node, "letRing"),
  };

  const bendNode = node["bend"] as Record<string, unknown> | undefined;
  if (bendNode) effect.bend = parseEffectPoints(bendNode);

  const tbNode = node["tremoloBar"] as Record<string, unknown> | undefined;
  if (tbNode) effect.tremoloBar = parseEffectPoints(tbNode);

  const harmNode = node["harmonic"] as Record<string, unknown> | undefined;
  if (harmNode) {
    const HARMONIC_MAP: Record<string, number> = {
      "N.H.": HARMONIC_NATURAL,
      "A.H.": 2,
      "P.H.": 3,
      "S.H.": 4,
      "T.H.": 5,
    };
    effect.harmonic = {
      type: HARMONIC_MAP[str(harmNode["@type"])] ?? HARMONIC_NATURAL,
      data: num(harmNode["@data"]),
    };
  }

  const graceNode = node["grace"] as Record<string, unknown> | undefined;
  if (graceNode) effect.grace = parseGrace(graceNode);

  const trillNode = node["trill"] as Record<string, unknown> | undefined;
  if (trillNode) {
    effect.trill = { fret: num(trillNode["@fret"]), duration: num(trillNode["@duration"]) };
  }

  const tpNode = node["tremoloPicking"] as Record<string, unknown> | undefined;
  if (tpNode) effect.tremoloPicking = { duration: num(tpNode["@duration"]) };

  return effect;
}

function parseEffectPoints(node: Record<string, unknown>): TGEffectPoints {
  return {
    points: arr(node["point"] as unknown[]).map((p) => {
      const pt = p as Record<string, unknown>;
      return { position: num(pt["@position"]), value: num(pt["@value"]) };
    }),
  };
}

const GRACE_TRANSITION_MAP: Record<string, number> = {
  none: GRACE_TRANSITION_NONE,
  slide: 1,
  bend: 2,
  hammer: 3,
};

// Grace duration in XML is TGDuration.value (64, 32, 16) → maps to DURATION_* enum
const GRACE_DURATION_MAP: Record<number, number> = { 64: 1, 32: 2, 16: 3 };

function parseGrace(node: Record<string, unknown>): TGEffectGrace {
  const dur = num(node["@duration"]);
  return {
    fret: num(node["@fret"]),
    duration: GRACE_DURATION_MAP[dur] ?? 1,
    dynamic: num(node["@dynamic"]),
    transition: GRACE_TRANSITION_MAP[str(node["@transition"])] ?? GRACE_TRANSITION_NONE,
    onBeat: node["@onBeat"] === "true" || node["@onBeat"] === true,
    dead: node["@dead"] === "true" || node["@dead"] === true,
  };
}

// Validate that the first beat of the first measure has the expected preciseStart
export function validateFirstBeatPreciseStart(song: TGSong): void {
  const firstBeat = song.tracks[0]?.measures[0]?.beats[0];
  if (firstBeat && firstBeat.preciseStart !== PRECISE_STARTING_POINT) {
    throw new Error(
      `Incompatible .tg snapshot: expected preciseStart=${PRECISE_STARTING_POINT}, got ${firstBeat.preciseStart}`
    );
  }
}
