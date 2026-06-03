import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CLEF_TREBLE,
  PRECISE_STARTING_POINT,
  TRIPLET_FEEL_NONE,
} from "../../shared/model";
import { parseTgFile, validateFirstBeatPreciseStart } from "../../shared/tg-reader";

const fixture = (name: string) =>
  new Uint8Array(readFileSync(resolve(__dirname, "../../", name)));

describe("parseTgFile — china.tg", () => {
  const song = parseTgFile(fixture("china.tg"));

  it("parses without throwing", () => {
    expect(song).toBeTruthy();
  });

  it("passes preciseStart validation", () => {
    expect(() => validateFirstBeatPreciseStart(song)).not.toThrow();
  });

  describe("song metadata", () => {
    it("has empty metadata fields", () => {
      expect(song.name).toBe("");
      expect(song.artist).toBe("");
      expect(song.album).toBe("");
    });
  });

  describe("channels", () => {
    it("has 2 channels", () => {
      expect(song.channels).toHaveLength(2);
    });

    it("channel 1 is DrumKit", () => {
      const ch = song.channels[0];
      expect(ch.id).toBe(1);
      expect(ch.bank).toBe(128);
      expect(ch.program).toBe(0);
      expect(ch.volume).toBe(127);
      expect(ch.balance).toBe(64);
      expect(ch.name).toBe("DrumKit");
    });

    it("channel 2 is Steel String Acoustic Guitar", () => {
      const ch = song.channels[1];
      expect(ch.id).toBe(2);
      expect(ch.bank).toBe(0);
      expect(ch.program).toBe(25);
      expect(ch.name).toBe("Steel String Acoustic Guitar 1");
    });
  });

  describe("measure headers", () => {
    it("has 2 measure headers", () => {
      expect(song.measureHeaders).toHaveLength(2);
    });

    it("header 1 is 4/4 at 120 BPM", () => {
      const h = song.measureHeaders[0];
      expect(h.number).toBe(1);
      expect(h.timeSignature.numerator).toBe(4);
      expect(h.timeSignature.denominator).toBe(4);
      expect(h.tempo).toBe(120);
      expect(h.repeatOpen).toBe(false);
      expect(h.tripletFeel).toBe(TRIPLET_FEEL_NONE);
    });

    it("header 1 starts at QUARTER_TIME (960)", () => {
      expect(song.measureHeaders[0].start).toBe(960);
    });

    it("header 2 starts after a 4/4 measure (960 + 3840 = 4800)", () => {
      // 4 * 960 = 3840 ticks per 4/4 measure
      expect(song.measureHeaders[1].start).toBe(960 + 3840);
    });
  });

  describe("tracks", () => {
    it("has 1 track", () => {
      expect(song.tracks).toHaveLength(1);
    });

    it("track 1 is a 6-string guitar", () => {
      const t = song.tracks[0];
      expect(t.number).toBe(1);
      expect(t.name).toBe("Track 1");
      expect(t.channelId).toBe(2);
      expect(t.maxFret).toBe(29);
      expect(t.solo).toBe(false);
      expect(t.mute).toBe(false);
      expect(t.color).toEqual({ r: 255, g: 0, b: 0 });
      expect(t.strings).toHaveLength(6);
    });

    it("track strings are standard guitar tuning (high to low)", () => {
      const pitches = song.tracks[0].strings.map((s) => s.value);
      expect(pitches).toEqual([64, 59, 55, 50, 45, 40]);
    });

    it("track has 2 measures", () => {
      expect(song.tracks[0].measures).toHaveLength(2);
    });
  });

  describe("measure 1 beats", () => {
    const measure = song.tracks[0].measures[0];

    it("has clef treble", () => {
      expect(measure.clef).toBe(CLEF_TREBLE);
    });

    it("has 9 beats", () => {
      expect(measure.beats).toHaveLength(9);
    });

    it("first beat starts at PRECISE_STARTING_POINT", () => {
      expect(measure.beats[0].preciseStart).toBe(PRECISE_STARTING_POINT);
    });

    it("first beat has 2 voices", () => {
      expect(measure.beats[0].voices).toHaveLength(2);
    });

    it("voice 0 of beat 0 has a note on string 1 fret 15", () => {
      const voice = measure.beats[0].voices[0];
      expect(voice.empty).toBe(false);
      expect(voice.notes).toHaveLength(1);
      expect(voice.notes[0].value).toBe(15);
      expect(voice.notes[0].string).toBe(1);
      expect(voice.notes[0].velocity).toBe(95);
    });

    it("voice 1 of beat 0 is empty", () => {
      expect(measure.beats[0].voices[1].empty).toBe(true);
    });
  });

  describe("measure 2 beats", () => {
    const measure = song.tracks[0].measures[1];

    it("has 1 beat (whole rest)", () => {
      expect(measure.beats).toHaveLength(1);
    });

    it("beat 0 voice 0 is empty=false (whole note, no notes)", () => {
      // In the XML: voice empty="false" but no <note> children
      const voice = measure.beats[0].voices[0];
      expect(voice.empty).toBe(false);
      expect(voice.notes).toHaveLength(0);
    });
  });
});
