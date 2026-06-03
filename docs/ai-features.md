# AI Features & Guardrails

Planned AI integration for TuxGuitar. The AI operates on the [TGX format](tgx-format.md) directly — a slice of measures is both the editable model and the prompt context.

Model: Claude (`claude-opus-4-8` for complex generation, `claude-sonnet-4-6` for fast/cheap edits). No specialized music model is required — see [Why not a specialized model](#why-not-a-specialized-model).

---

## Feature set

### 1. Autofill / continuation
"I've written 6 bars of a solo — fill in the next 2."

Provide preceding bars + key/scale + target bar count. AI returns bars that develop the phrase and resolve appropriately.

### 2. Section transformation
"Give this section some room to breathe." / "Make this heavier." / "Double-time this."

Select bars + natural-language instruction. AI rewrites the selection. It understands idiomatic intent: "room to breathe" → longer durations, more rests, less consecutive subdivision; "heavier" → lower register, palm mutes, power chords.

### 3. Variation / harmonization
"Give me 3 variations of this lick." / "Harmonize this in thirds."

### 4. Context-aware suggestion
Passive: given current cursor position and surrounding bars, offer the next phrase as a ghosted suggestion (accept/reject).

---

## Pipeline

Every AI request flows through the same pre/post-processing scaffold. The model call is the middle step, **not** the whole thing.

```
Selection (TGX measures)
        │
        ▼
┌─────────────────────────────┐
│ PRE-PROCESS (TS, deterministic)
│  - fret+string+tuning → MIDI → pitch names
│  - scale/mode detection  → "E Phrygian Dominant"
│  - genre hint            → "metal" (from artic + register + tempo)
│  - current hand position → anchor fret for playability
└─────────────────────────────┘
        │
        ▼
┌─────────────────────────────┐
│ CLAUDE (tool-use mode)
│  system: tuning, confirmed key/scale, genre, hand position, max span
│  user:   TGX slice + instruction
│  tools:  set_note / delete_note / add_rest / set_beat ...
└─────────────────────────────┘
        │
        ▼
┌─────────────────────────────┐
│ POST-PROCESS (TS, deterministic)
│  - playability validator
│     pass → apply to model
│     fail → retry w/ violation described, max N times
│  - schema/range validation
└─────────────────────────────┘
        │
        ▼
   Apply to TGSong → re-render → playable
```

The two deterministic ends are what make it reliable. The model is good at musical *intent*; it is bad at *spatial bookkeeping* and *self-consistency on hard constraints*. Code owns those.

---

## Pre-processing (required)

The model cannot reason about raw fret numbers. It needs pitches.

| Step | Why | Output |
|------|-----|--------|
| **Pitch resolution** | `{"s":6,"f":1}` is meaningless musically until you add tuning | pitch names / MIDI numbers per note |
| **Scale detection** | model identifies mode from pitch *classes*, not frets | e.g. `"E Phrygian Dominant"` |
| **Genre hint** | palm-muted 16ths + low register + tempo → metal | genre string passed as context |
| **Hand-position anchor** | playability needs a starting fret reference | anchor fret + current fretboard region |

### Scale detection caveats
- A riff using only 4–5 scale degrees is **ambiguous**. E Phrygian Dominant vs E Phrygian differ by one note (G# vs G); if that note isn't present, detection is a guess.
- **Always show the detected scale to the user and let them correct it.** Send the *confirmed* scale as input context — do not rely on inference alone.
- When the user already set a key signature, trust it over detection.

---

## Output: structured, not prose

The model must emit tool calls, **not** free text. "Play an F on the 6th string, 1st fret" is useless; `{"s":6,"f":1}` is applyable.

Enforce via tool use + JSON schema. The schema mirrors the [TGX note/beat shape](tgx-format.md#note). The model fills bars by calling tools; the harness validates each call at the tool layer and the model retries on mismatch.

Suggested tools:

```ts
set_note(bar, beat, string, fret, duration, articulations?, bend?, slide?)
delete_note(bar, beat, string)
add_rest(bar, beat, duration)
set_beat(bar, beat, duration, notes[])   // replace whole beat
set_bar_tempo(bar, bpm)
```

---

## Post-processing: playability validator (required)

**No model — Claude included — reliably respects physical-playability constraints out of the box.** It has no persistent spatial model of the fretting hand and will produce 7-fret stretches even when told not to. This MUST be enforced in code.

```ts
interface PlayabilityResult {
  ok: boolean
  violations: Violation[]   // human-readable, fed back to the model on retry
}

function validatePlayability(beats: Beat[], tuning: number[]): PlayabilityResult {
  // 1. Fret bounds         0 ≤ fret ≤ FRET_MAX (e.g. 24). No negative frets.
  // 2. Intra-beat span     fretted notes in one beat within MAX_HAND_SPAN (~4-5 frets)
  // 3. Inter-beat shift    position jump between consecutive beats ≤ MAX_SHIFT (flag big leaps in fast passages)
  // 4. String validity     1 ≤ string ≤ tuning.length
  // 5. One note per string  no two notes on same string in same beat
  // 6. Open-string sanity   capo-aware lower bound
}
```

### Retry loop
On failure, re-prompt with the specific violation, capped at N retries:

```
"The note at bar 2 beat 3 requires a 7-fret hand span.
 Compress it to stay within 4 frets of the 12th position."
```

If still failing after N tries, surface the best candidate to the user flagged as "may be hard to play" rather than silently applying or silently dropping.

### Tunable thresholds
| Constant | Default | Notes |
|----------|---------|-------|
| `FRET_MAX` | 24 | per-instrument |
| `MAX_HAND_SPAN` | 4 | frets within one beat; raise for advanced |
| `MAX_SHIFT` | 5 | position jump between beats; context-dependent on tempo |

Make these difficulty-configurable later (beginner = tighter spans).

---

## Worked example

Input: one bar of 16th-note palm-muted E's on the low string, 180 BPM.

1. **Pre-process** → pitches all `E2`; articulation `pm`; 16ths at 180 BPM; low register → genre hint **metal**; only one pitch class present → scale **ambiguous**, fall back to user's key sig or prompt.
2. **Context to model** → "Tremolo/palm-muted E pedal, metal, ~180 BPM. Scale: E Phrygian Dominant (user-confirmed). Tuning standard. Hand anchored at frets 0–3."
3. **Model** → suggests a pedal-point riff alternating the open E pedal with the characteristic b2 (F, 6th string fret 1) and b3/maj3 — all calls within frets 0–4.
4. **Post-process** → all frets 0–4, spans ≤ 4, no negatives → **passes** → applied.

The genre/scale reasoning is Claude's strength. The "frets 0–4, no leaps" guarantee is the validator's job — not Claude's.

---

## Why not a specialized model

| Capability | Specialized (Magenta, MusicTransformer, …) | Claude + scaffold |
|------------|--------------------------------------------|-------------------|
| Blind generation ("16 bars from scratch") | strong | good |
| Follow natural-language instructions | none | strong |
| Scale/genre *inference* | none | strong |
| Guitar-specific data (frets, bends, mutes) | not modeled | via TGX schema |
| Hosted API | mostly self-host | yes |
| Playability | none | code validator (same for both) |

Specialized models do pure note generation with no reasoning, no instruction-following, no guitar awareness, and mostly require self-hosting. They add nothing the scaffold doesn't already provide. Revisit only if blind from-scratch generation quality becomes a priority — even then, Claude can post-process their raw output.

The pre/post-processing is ~100–150 lines of TS. That scaffold — not the model choice — is what makes the feature reliable.
