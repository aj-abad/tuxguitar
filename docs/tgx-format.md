# TGX Format Specification

TGX (`.tgx`) is TuxGuitar's native text-based song format. It is JSON, designed to be:

- **Lossless** for all guitar-specific data (fret positions, bend curves, articulations)
- **Token-efficient** for direct use as AI context (slice a range of measures and send as-is)
- **Git-diffable** — meaningful diffs at the note level
- **Human-readable** in a text editor

---

## Structure

```
Song → tracks[] → measures[] → beats[] (or voices[][]) → notes[]
```

---

## Song

```json
{
  "v": 1,
  "title": "...",
  "artist": "...",
  "album": "...",
  "tempo": 120,
  "tracks": []
}
```

All fields except `v` and `tracks` are optional.

---

## Track

```json
{
  "name": "Guitar",
  "program": 25,
  "channel": 1,
  "tuning": [64, 59, 55, 50, 45, 40],
  "capo": 0,
  "measures": []
}
```

- `program` — MIDI program number (0-based)
- `tuning` — MIDI note numbers, string 1 (highest) to N (lowest). Standard E = `[64,59,55,50,45,40]`
- `capo` — fret number; omit or 0 if none

---

## Measure

```json
{
  "ts": [4, 4],
  "tempo": 140,
  "ks": "Am",
  "repeat": "open",
  "marker": "Chorus",
  "beats": []
}
```

All fields optional. Omit `ts`, `tempo`, and `ks` if unchanged from previous measure — they only appear on change.

- `ts` — time signature as `[numerator, denominator]`
- `ks` — key signature as key name, e.g. `"C"`, `"Am"`, `"F#"`, `"Bbm"`
- `repeat` — `"open"` | `"close"` | `{"close": 3}` (repeat count) | `"closeOpen"`
- `beats` — shorthand when only one voice is used
- `voices` — array of beat arrays; use instead of `beats` when multiple voices are needed: `"voices": [[...], [...]]`

---

## Beat

```json
{
  "d": "q",
  "notes": [],
  "rest": true,
  "chord": "Am",
  "stroke": "d8",
  "text": "...",
  "tremBar": [[0, 0], [50, -100], [100, 0]]
}
```

- `d` — duration (required); see Duration Codes below
- `notes` — omit for rests; set `rest: true` for an explicit rest beat
- `chord` — chord name annotation displayed above the beat
- `stroke` — strum: direction (`d`/`u`) + duration code, e.g. `"d8"` = downstroke eighth
- `tremBar` — tremolo bar curve; same `[pos, val]` format as bend curves (val 100 = 1 full tone down)

---

## Duration Codes

Base values:

| Code | Duration |
|------|----------|
| `"w"` | whole |
| `"h"` | half |
| `"q"` | quarter |
| `"e"` | eighth |
| `"s"` | sixteenth |
| `"t"` | thirty-second |
| `"x"` | sixty-fourth |

Suffixes (combinable):

| Suffix | Meaning |
|--------|---------|
| `"."` | dotted |
| `"3"` | triplet |
| `"5"` `"6"` `"7"` | other tuplets |

Examples: `"e."` = dotted eighth · `"q3"` = quarter triplet · `"s3"` = 16th triplet

---

## Note

```json
{
  "s": 1,
  "f": 12,
  "art": ["ho", "lr"],
  "dyn": "ghost",
  "tied": true,
  "bend": "full",
  "slide": "ls",
  "harm": "n"
}
```

- `s` — string number (1 = highest)
- `f` — fret number (0 = open)
- All other fields optional; omit if not applicable

---

## Articulation Flags (`art`)

Array of strings. Omit the `art` field entirely if none apply.

| Flag | Meaning |
|------|---------|
| `"pm"` | palm mute |
| `"lr"` | let ring |
| `"ho"` | hammer-on |
| `"po"` | pull-off |
| `"vib"` | vibrato |
| `"wvib"` | wide vibrato |
| `"dead"` | dead/muted note (x) |
| `"stac"` | staccato |
| `"tap"` | right-hand tap |

---

## Dynamics (`dyn`)

Omit if normal/default velocity.

| Value | Meaning |
|-------|---------|
| `"ghost"` | ghost note (very soft) |
| `"acc"` | accent |
| `"hacc"` | heavy accent |

---

## Slides (`slide`)

Single string or array of strings when combining slide types.

| Code | Meaning |
|------|---------|
| `"ls"` | legato slide |
| `"ss"` | shift slide |
| `"siu"` | slide in from above |
| `"sid"` | slide in from below |
| `"sou"` | slide out upward |
| `"sod"` | slide out downward |

Example combining: `"slide": ["ss", "sod"]`

---

## Bends (`bend`)

### Named presets

Cover the vast majority of cases. Value unit: 100 = 1 full tone (2 semitones).

| Preset | Shape |
|--------|-------|
| `"half"` | bend up 1 semitone, hold |
| `"full"` | bend up 1 tone, hold |
| `"1h"` | bend up 1.5 tones, hold |
| `"full-r"` | full bend and release |
| `"half-r"` | half bend and release |
| `"pb"` | prebend (start already bent 1 tone) |
| `"pb-r"` | prebend and release |
| `"gentle"` | quarter-tone rise/dip |

### Custom curves

Array of `[pos, val]` pairs. `pos` is 0–100 (note duration), `val` is tone-hundredths (100 = 1 tone up, -100 = 1 tone down). Add `"v"` as a third element to mark vibrato at that point.

```json
"bend": [[0, 0], [33, 100], [66, 100], [100, 0]]
```

```json
"bend": [[0, 0], [50, 100, "v"], [100, 100, "v"]]
```

---

## Harmonics (`harm`)

| Value | Meaning |
|-------|---------|
| `"n"` | natural harmonic (fret implied by `f`) |
| `{"a": 12}` | artificial harmonic, touch-point fret |
| `"p"` | pinch harmonic |
| `"t"` | tap harmonic |

---

## Complete Example

```json
{
  "v": 1,
  "title": "Example",
  "artist": "Example Artist",
  "tempo": 120,
  "tracks": [
    {
      "name": "Guitar",
      "program": 25,
      "tuning": [64, 59, 55, 50, 45, 40],
      "measures": [
        {
          "ts": [4, 4],
          "ks": "Am",
          "beats": [
            {"d": "q", "notes": [{"s": 1, "f": 12}]},
            {"d": "q", "notes": [{"s": 1, "f": 14, "art": ["ho"]}]},
            {"d": "q", "notes": [{"s": 1, "f": 15, "art": ["vib"]}]},
            {"d": "q", "notes": [{"s": 1, "f": 14, "bend": "full-r"}]}
          ]
        },
        {
          "beats": [
            {"d": "e", "notes": [{"s": 2, "f": 9, "art": ["pm"]}]},
            {"d": "e", "notes": [{"s": 2, "f": 9, "art": ["pm"]}]},
            {"d": "e", "notes": [{"s": 2, "f": 9, "art": ["pm"]}]},
            {"d": "e", "notes": [{"s": 2, "f": 9, "art": ["pm"]}]},
            {"d": "h",  "notes": [{"s": 1, "f": 17, "art": ["lr"], "slide": "ls"}]}
          ]
        }
      ]
    }
  ]
}
```

---

## AI Context Usage

For AI requests, slice the relevant measures plus surrounding context and stringify directly:

```ts
const context = JSON.stringify(
  song.tracks[0].measures.slice(Math.max(0, targetBar - 2), targetBar + numBars + 2)
)
```

No translation layer needed — the slice is the prompt context.

Token budget (approximate, one track):
- 1 simple note: ~5 tokens
- 1 complex note (bend + art + slide): ~20 tokens
- 1 typical bar (4 beats, single notes): ~80–120 tokens
- 4-bar phrase: ~400 tokens
- 32-bar song: ~2,000–3,000 tokens
