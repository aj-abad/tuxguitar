# TuxGuitar → Electron Migration Plan

> **Status:** Living plan — partially implemented. Core architecture decisions resolved 2026-06-03; **revised 2026-10-17** to match implemented state (see [§0 Current status](#0-current-status-2026-10-17) and [§14 Changelog](#14-changelog)).
> **Product:** **Tabbycat** — a rewrite of the TuxGuitar desktop app onto **Electron + Nuxt 4 (Vue 3) + TypeScript**, replacing the Java/SWT/Cocoa UI.
> **Audio:** a self-contained **.NET 10 sidecar** (`SDL2` + `MeltySynth`) — this *replaces* TuxGuitar's Java/Gervill sound engine (an evolution of the original "keep Java in a GraalVM sidecar" decision; see [D2](#d2--audio-self-contained-net-sidecar-)).
> **Platforms:** macOS release configuration and Windows development/runtime, including an unsigned unpacked Windows build. Signed installers, native macOS audio qualification, and Linux support remain open.

---

## 0. Current status (2026-10-17)

The tab view now uses a centered white document with fixed portrait width, compact engraving and Windows acrylic. Design mode saves per-track bar widths and explicit row membership in TGX v2: barline drags redistribute adjacent widths, and break-after/pull-from-next-row control reflow. Automatic bars expand for dense rhythms; fixed bars compress longer intervals first. Layout edits share normal history and dirty state. TGX v2 opens/saves the full model and preserved TG source; v1 AI projections must be reconverted. Staff notation, stacked tracks and print pagination remain separate work.

Document-wide marquee selection combines the wrapped musical range with columns whose fret numbers touch the rectangle. Every drag selects whole columns across all strings, within one row or across rows; dragging back shrinks both parts. Clicks focus one cell. Pointer input always replaces selection, with no Shift/Alt/Ctrl selection modifiers; keyboard shortcuts remain independent. Gapped selections support Delete only for now, with exact coverage restored by undo/redo. Selection itself remains runtime editor state rather than saved song data.

The editor now supports notes, chords, deletion, rests, durations and dots inside existing measures, alongside tied-note fret changes, undo/redo, Save/Save As, and unsaved-change guards. Shortening fills space with rests; lengthening consumes rests without overlapping later notes or changing other voices. The `.tg` writer patches original v2 XML tokens, preserving unrelated data. Playback reloads edited MIDI before starting. Windows editing and native audio startup/playback are tested; audible fidelity, legacy-app round trips and release packaging remain separate gates. New-song/measure creation, cross-bar editing and full codec parity remain open.

The custom **tab-only engine** is now the default view. Pure TS layout drives SVG, hit regions, empty-string cells, range selections and the audio playhead. It supports wrapped/continuous layout, zoom, spacing, stable editor IDs, and Alt-arrow move/duplicate commands. Meter-aware beams, tuplet numbers/brackets, bends, slides, H/P slurs and ties are implemented, including connections across wrapped systems. Repeat barlines/counts and alternate-ending spans now have reserved layout space and wrapped continuations, with inspector controls and configurable shortcuts for writing them. Column operations remain bounded to complete single-voice measures without linked techniques; copies consume trailing rests. alphaTab remains available for comparison and unsupported engraving. Further technique engraving, repeat playback, manual beam grouping, multi-voice layout and playback autoscroll remain open. Accessibility follows as a dedicated pass once the rendering engine is done.

What exists in the tree today. Legend: ✅ done · 🚧 in progress · ⬜ not started.

| Area | State | Notes |
|---|---|---|
| Electron + Nuxt 4 SPA skeleton | ✅ | `electron/` (main, preload, sidecar mgr) + `app/` (Nuxt renderer). `ssr:false`. |
| Security model | ✅ | `contextIsolation`+`sandbox`+`nodeIntegration:false`; typed `window.tg` preload bridge (`shared/ipc.ts`). |
| `app://` bundle protocol + CSP | ✅ | Prod served from `.output/public` via custom protocol; `build`→`nuxt generate`. |
| Native `.tg` **read** in TS | ✅ | `shared/tg-reader.ts` (`parseTgFile`). One golden test (`china.tg`). |
| Song model in TS | ✅ | `shared/model.ts` — `TGSong → … → TGNote`, precise-tick constants. |
| Score/tab rendering | 🚧 | Custom TS geometry → SVG tab editor; meter/tuplet beams, bends, slides, H/P, ties, repeat barlines/counts and alternate endings. Wrapped/continuous views, zoom, spacing and nearby-system rendering. alphaTab comparison retained; remaining techniques and multi-voice engraving stay open. |
| **.NET audio sidecar** | ✅ | `sidecar/` — SDL2 + MeltySynth; stdio JSON-RPC; `synth.load/play/stop/seek`; emits `ready`/`tick`/`playbackEnded`. |
| MIDI generation | ✅ | `shared/midi-export.ts` (TS) — model → MIDI events sent to the sidecar. |
| Playback progress | 🚧 | Sidecar tick events → `usePlayback()` interpolation → progress and custom-tab playhead. Playback autoscroll remains open. Missing audio reports an error. |
| Transport | 🚧 | play / stop / seek only. No pause, loop, count-in, metronome, per-track mute/solo. |
| Other-format import (GP*/GPX/PTB/TEF/MXML/MIDI) | ⬜ | Open and drag/drop accept `.tg` and `.tgx`; other formats produce an error. |
| Native `.tg` **write** | 🚧 | Source-preserving v2 note/rest/rhythm edits, atomic Save/Save As and round-trip tests. General model serialization remains open. |
| Editing / command bus / undo | 🚧 | Per-string cursor, cell/column ranges, stable IDs, note/rhythm/technique edits, Alt move/duplicate commands and atomic undo/redo. Technique links can cross bars; structural cross-bar operations and new songs/measures remain open. |
| Exporters | ⬜ | — |
| **TGX text format + AI** (new workstream) | 🚧 | TGX v2 native open/save, tab designs, validation and `.tg`→`.tgx` conversion work; AI features remain planned. See [§13](#13-tgx-text-format--ai-new-workstream). |
| Packaging | 🚧 | Target-specific .NET runtime/SDL/SoundFont resources; unsigned Windows unpacked build and behavioral playback checks. macOS audio cross-publishes for x64/arm64; native device checks, signing and notarization remain open. |
| Golden corpus harness | 🚧 | Single `.tg` fixture; full multi-format corpus from the Java build not captured yet. |
| Legacy Java | ✅ relocated | Moved to `tuxguitar-java/`; reference only, not built by the Node toolchain. |

**Net:** **open/drop `.tg` → enter notes/chords/rests → edit rhythm → undo/redo → save → reopen → play** is implemented inside existing measures and tested in Windows Electron. Native audio ticks reach the edited measure in the silent integration fixture. Song/measure creation and the format long tail remain.

---

## 1. TL;DR

This is a large undertaking: the legacy base is **~183K LOC of Java across 1,761 files and 39 Maven modules**, including a 29K-LOC software synthesizer (Gervill) and a suite of hand-tuned binary file-format codecs encoding years of reverse-engineered edge cases. Existing **Java test coverage is thin (~14 test classes)** — there is no safety net proving a rewrite preserves behavior.

**Approach: rewrite the UI to web, drive audio from a small native synth sidecar, and port the model/codecs to TypeScript incrementally — shipping something runnable early.**

1. **Rewrite the UI** as an Electron app with a **Nuxt 4 / Vue 3** renderer (SPA mode). Delete the SWT/Cocoa stack. ✅
2. **Own the tab writing/rendering engine.** Custom TS geometry + SVG provides tab-only editing with control over appearance and interaction. alphaTab remains a comparison renderer — see [D1](#d1--custom-tab-rendering-and-alphatab-comparison).
3. **Audio via a self-contained .NET sidecar.** A standalone .NET binary (`SDL2` + `MeltySynth`) loads a SoundFont, synthesizes MIDI events generated in TS, outputs PCM itself, and streams tick/position events back for cursor sync. ✅
4. **Port the model, editing, native `.tg` format, and exporters to TypeScript** incrementally, validated by **golden-file round-trip tests**. 🚧 (`.tg` read + model done; write/editing/exporters pending.)

**Consequence of the .NET synth:** the sidecar is **load-bearing and permanent** for audio — but it is *audio-only*. It does **not** read codecs and contains **no JVM**. The original plan kept TuxGuitar's Java engine (Gervill) behind a GraalVM sidecar and used that same sidecar as a transitional codec reader; both of those ideas were dropped in favor of a self-contained .NET synth plus TS/alphaTab codecs (see [§14](#14-changelog)).

**Rough order of magnitude:** multi-engineer effort, ~12–18 months to *full* parity (171 commands × 157 dialogs is the long tail). The read/play slice landed early; a v1 feature subset will be chosen later (parity remains the eventual bar).

---

## 2. Why migrate

- **Toolkit risk.** The legacy UI is bound to Eclipse SWT for Cocoa, not on Maven Central (hand-installed per build docs), tracking Eclipse's cadence, plus a JNI AudioUnit bridge built with Xcode CLI tools.
- **Distribution friction.** Shipping/signing/notarizing a JVM `.app` is heavier than the Electron path (`electron-builder` handles signing/notarization/auto-update).
- **Developer pool & ecosystem.** Web/TS/Vue talent and tooling (HMR, devtools, component libs, canvas/audio libs) vastly outnumber SWT/Cocoa-Java.
- **UI velocity.** Declarative Vue + CSS iterates faster than SWT widgets behind a custom toolkit abstraction.

### Non-goals

- **Release-platform expansion.** Windows development and runtime are now exercised; Windows installers and Linux support remain deferred.
- **Format / feature additions** beyond the new TGX format. Preserve the existing matrix and behavior. Parity first.

---

## 3. Legacy architecture inventory

Grounded in the actual legacy tree, now relocated under **`tuxguitar-java/`** (`common/` = platform-independent, `desktop/` = app + SWT/Cocoa).

| Subsystem | Where (under `tuxguitar-java/`) | ~LOC | Disposition |
|---|---|---|---|
| **Song model** (`TGSong→Track→Measure→Voice→Beat→Note`) | `common/TuxGuitar-lib/.../song/models` | part of 32K | **Ported to TS** (`shared/model.ts`). Editing source of truth. |
| **Tab layout / render logic** (`graphics/control`, `TG*Painter`) | `common/TuxGuitar-lib` | part of 32K | **Replaced** by custom TS/SVG tab geometry; alphaTab comparison. Painters are a layout reference only. |
| **GP3/4/5 codec** | `common/TuxGuitar-gtp` | 6.3K | Read via alphaTab import; **TS port later** if needed, golden-gated. |
| **GPX (GP6) codec** | `common/TuxGuitar-gpx` | 3.3K | Same as above. |
| **PowerTab (.ptb)** | `common/TuxGuitar-ptb` | 2.5K | **TS port later**; alphaTab where supported. |
| **TablEdit (.tef)** | `desktop/TuxGuitar-tef` | 6.3K | **TS port later**. |
| **MIDI read/write** | `common/TuxGuitar-midi` | 1.9K | **Port to TS** (well-specified). MIDI *generation* for playback already in TS (`shared/midi-export.ts`). |
| **MusicXML / LilyPond / ASCII / PDF / SVG writers** | `common/` + `desktop/` | ~6K | **Port to TS** incrementally. |
| **Native `.tg` format** (`TGStream`) | `common/TuxGuitar-lib` | part of 32K | **Crown jewel.** Reader **ported** (`tg-reader.ts`); writer pending; round-trip golden-gated. Never depends on the sidecar. |
| **Gervill software synth** | `desktop/gervill` | 29K | **Dropped.** Replaced by `MeltySynth` (C# SF2 synth) in the sidecar. |
| **Synth plumbing / player / sequencer** | `desktop/TuxGuitar-synth`, `player/*` | ~3K+ | **Dropped.** MIDI event generation is TS; scheduling + synth are the .NET sidecar. |
| **macOS AudioUnit MIDI bridge (JNI)** | `desktop/TuxGuitar-AudioUnit` | 8 native files | **Dropped.** The .NET synth outputs PCM via SDL2; native MIDI out not required. |
| **UI toolkit abstraction + SWT/Cocoa impl** | `desktop/TuxGuitar-ui-toolkit*` | ~11K | **Deleted (kept in `tuxguitar-java/` as reference).** The `ui.*` contract informs the Vue layer. |
| **Application** (actions, views, dialogs, editor, transport, undo, docking) | `desktop/TuxGuitar` | 52K | **Rewrite** as Nuxt renderer + TS command bus. 201 action classes (~171 IDs), 157 dialogs, 258 view classes. |
| **Plugins (Java SPI)** | 28 `TGPlugin` services | — | **Replace** with a TS module-registration registry. |
| **i18n** | `messages*.properties` | — | **Port** to JSON later. Not started. |

### Architectural assets we can still exploit

- **Editor uses a command bus.** Behavior dispatches by **string action IDs** through `TGActionManager`. ~171 IDs enumerate the full command surface and port cleanly to a TS command registry — keep the IDs identical so menus/keybindings map 1:1.
- **Service container, not globals.** Managers are context-scoped singletons via `TGContext` → maps to module-scoped singletons / Nuxt `useState` (and Pinia later if needed) in TS.
- **UI is already abstracted.** Legacy app code targets `app.tuxguitar.ui.*`, a ready-made spec for the Vue component layer.

### Architectural liabilities

- **Thin legacy tests (~14 classes).** No behavioral safety net → build golden files *before* porting each codec ([§8](#8-testing--validation-strategy)).
- **Binary codecs encode tacit knowledge.** GP/GPX/PTB/TEF carry years of vendor-quirk fixes. Rewrites must be validated against a large real-world corpus.
- **Two song models in play.** TuxGuitar's model (TS, editing source of truth) vs. alphaTab's model (rendering). Currently bridged by an adapter (`tgSongToScore`) — see [D1](#d1--custom-tab-rendering-and-alphatab-comparison).

---

## 4. Target architecture (Electron + Nuxt 4 + .NET sidecar)

```
┌─────────────────────────────────────────────────────────────────┐
│ Electron Main process (Node + TypeScript)                        │
│  • App lifecycle, single-instance lock, file-open events         │
│  • Native menu (Electron Menu), Dock, app:// bundle protocol     │
│  • Filesystem IO, .tg parsing (TS), MIDI generation (TS)         │
│  • IPC broker  +  Sidecar manager (spawn / supervise / IPC)      │
└───────▲───────────────────────────────────────────▲──────────────┘
        │ contextBridge (typed preload,             │ stdio
        │ contextIsolation, sandbox)                │ newline-delimited JSON-RPC
        │                                           │
┌───────▼───────────────────────────────┐  ┌────────▼───────────────────────┐
│ Renderer  (Chromium + Nuxt 4 / Vue 3) │  │ .NET audio sidecar             │
│  SPA mode (ssr:false)                  │  │ (SDL2 + MeltySynth)             │
│                                        │  │                                 │
│  • App shell: toolbar, transport,      │  │  • Loads SoundFont (SF2)        │
│    track strip, dialogs (TODO)         │  │  • Synthesizes scheduled MIDI   │
│  • Song model + editing/history (TS)  │  │    events → PCM output         │
│                                        │  │    via native SDL2              │
│  • Custom tab geometry → SVG          │◀─┤  • Emits tick/position events   │
│  • usePlayback(): interpolated cursor  │  │    + playbackEnded over stdout  │
└────────────────────────────────────────┘  └─────────────────────────────────┘
```

### Process & security model

- Renderer: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. All privileged ops (fs, spawn, native dialogs, sidecar) go through a **typed preload bridge** (`window.tg`, `shared/ipc.ts`) with a narrow, validated surface. No raw Node in the renderer.
- Main owns fs, native dialogs/menus, `.tg` parsing, MIDI generation, and the **sidecar lifecycle**.
- Sidecar is a plain child process; the protocol is newline-delimited JSON over stdio (no native MIDI, no shared memory).

### Nuxt-in-Electron integration notes

- Nuxt runs as a **client-only SPA** (`ssr: false`), **prerendered with `nuxt generate`** (not `nuxt build`), loaded via a custom `app://bundle` protocol (correct routing/CSP; `file://` avoided). `nuxt-electron` wires the main/preload builds + dev HMR.
- **Nitro/SSR is unused at runtime** — Electron's main process is the Node backend.
- Current stack in code: **Nuxt `useState`** for shared reactive state (Pinia not adopted yet), **Tailwind v4** for styling, **Phosphor** icons. A headless component lib (Reka UI / Nuxt UI) and `@nuxtjs/i18n` remain *planned*, not present.

### Technology choices

| Concern | Choice | Status |
|---|---|---|
| Shell | **Electron** | ✅ `electron-builder` for `.dmg`. |
| Language | **TypeScript** | ✅ Shared types across main/preload/renderer. |
| UI | **Nuxt 4 / Vue 3** (SPA) | ✅ `useState` + Tailwind v4 + Phosphor. Pinia / component lib / i18n deferred. |
| Tab render + comparison | **Custom TS/SVG**; alphaTab vendored in `packages/alphatab` | Tab-only spike; alphaTab comparison retained. GP import not wired yet. |
| Audio | **.NET sidecar — SDL2 + MeltySynth** | ✅ Replaces Gervill/Java. |
| Sidecar runtime | **Self-contained .NET executable (dotnet publish)** | ✅ No JVM, no GraalVM. |
| Build | **Vite** (via Nuxt) + `nuxt-electron` | ✅ |
| Packaging | **electron-builder** | 🚧 `.dmg` + hardened runtime; notarization unverified. |
| Tests | **Vitest** (+ Playwright later) | 🚧 golden harness for `.tg`. |

---

## 5. Strategic decisions

### D1 — Custom tab rendering and alphaTab comparison

- **Revised 2026-10-16:** the default editor now uses our own **tab-only geometry and SVG renderer**, reading the TS TG model directly. Layout, hit testing, caret/range bounds and playback geometry share one result. No alphaTab primitives or font are used on this path. Rendering and selection do not change musical timing.
- **alphaTab is retained for comparison.** `tgSongToScore()` (`shared/tg-to-alphatab.ts`) projects the TG model onto alphaTab's `Score`; its player/cursor remain disabled. This preserves a reference while the remaining techniques and multi-voice tab are being implemented. Standard staff notation is outside the current custom-engine scope.
- `tab-structure.ts` resolves TG ending starts through their following unmarked measures and draws repeat starts/ends, combined boundaries, total-play counts and alternate-ending brackets. Wrapping includes symbol margins and label widths; separate bands reserve room above the strings. Brackets continue across systems without false hooks, with parenthesized continuation labels. The legacy repeat fixture anchors the format semantics. Inspector controls and `[` / `]` / E write global header markers, total plays and ending passes 1–8 with validation, undo/redo and source-preserving save. Repeat playback expansion remains open.
- `tab-rhythm.ts` groups beams by meter/tuplet, with partial hooks and tuplet brackets. Compound meters group in threes; odd eighth-note meters default to pairs ending in three. Custom groupings/manual beam breaks remain open. Tuplet groups are inferred because TG stores ratios per duration without group IDs.
- `tab-techniques.ts` resolves same-string slide/H/P/tie links and creates bend/pre-bend/hold/release geometry. TG bend values use quarter-tone units (4 = full tone). Links continue across wrapped systems; explicit rests and timing gaps stop them. Bend spacing is shared by drawing and hit testing. `technique-edits.ts` now supplies validated authoring commands through inspector controls and B/S/H/P/T. Preset curves, link changes and clearing use atomic history and source-preserving patches. Current TG bend curves, slides, softer H/P attacks and tied sustains now play through the native synth. Richer curve editing and articulation modeling remain open.
- Stable command IDs are separate from declarative default bindings. `useTabKeymap` exposes validated overrides/reset and drives both dispatch and displayed hints. Preferences UI/persistence remain open; native document shortcuts and note-entry/navigation keys are reserved.
- Runtime column/note IDs belong to editor history, not the `.tg` schema. Validated commands produce model patches and source provenance; undo and source-preserving save use the same operations. Full accessibility is explicitly deferred to its own pass after rendering.
- **License:** alphaTab is MPL-2.0 (weak, file-level copyleft). Using its public APIs is fine. alphaTab is **vendored as source** under `packages/alphatab` (pinned); if we modify its files, those files stay MPL — isolate and publish such changes. Prefer extension over modification.

### D2 — Audio: self-contained .NET sidecar ✅

- **Revised 2026-10-16:** replaced the early Rust sidecar with C# on .NET 10. Playback and writing are the product scope; recording is not planned. The TypeScript model/editor/codecs and Electron/Vue UI retain their existing ownership. `dotnet publish` bundles the runtime (not Native AOT); the package hook includes target-specific runtime/native files and GeneralUser GS.

- Audio runs in a standalone **.NET** binary (`sidecar/`): **`MeltySynth`** (SoundFont2 software synth) + **`SDL2`** (native audio output). The renderer/main render the song to a MIDI event stream **in TS** (`shared/midi-export.ts`) and send it via `synth.load`; the sidecar schedules events to audio frames at the device sample rate, **outputs PCM itself**, and **streams `tick {qtick,bpm}` events** (~20 Hz) for cursor follow. Reusable buffers feed about 100 ms of SDL audio; progress is generated frames minus queued frames, with unmeasured final hardware-buffer latency. A separate stdin thread leaves reporting responsive. Seek restores channel setup without retriggering earlier notes.
- **What changed from the original plan:** Gervill and the Java player/sequencer are **dropped**, not kept; there is **no GraalVM native-image** and **no JVM** in the sidecar. The bundled SoundFont is **GeneralUser GS** (downloaded at build time), not TuxGuitar's Magic Sound Font.
- **AudioUnit JNI bridge:** dropped (PCM out via SDL2; native MIDI out not needed).
- **Web synth** (alphaSynth / WASM SF2 / Web Audio) remains a possible *future* swap that would let audio move into the renderer and retire the sidecar entirely.

### D3 — Codecs: TS + alphaTab, no codec sidecar ✅

- The sidecar is **audio-only** and never reads song formats. `.tg` is parsed **in TS today** (`tg-reader.ts`). Other formats are read via **alphaTab import** and/or **TS ports**, each golden-gated before it's trusted. There is **no Java sidecar fallback** for reads.

### D4 — UI framework: Nuxt 4 / Vue 3 ✅

- SPA mode in Electron. The command bus and model live in TS modules, not in Vue components. State is currently keyed `useState` singletons; Pinia is optional and deferred.

### D5 — Native `.tg` format: TS, first, never sidecar ✅ (read done, write pending)

- Primary save format; must work offline and round-trip perfectly. **Reader ported** (`parseTgFile`); **writer pending**. Byte/round-trip golden tests (incl. legacy versions via the old `TuxGuitar-compat` logic) gate the writer.

---

## 6. Migration strategy

**Principles**

1. **Capture behavior before changing it** — golden fixtures from the Java build before porting each codec ([§8](#8-testing--validation-strategy)).
2. **Vertical slices, runnable early** — read-only viewer → playback → editing → writers → dialog long tail. (The read/play slice already runs.)
3. **Preserve identifiers** — keep action IDs, format IDs, and `.tg` semantics identical so menus, keybindings, and files carry 1:1.
4. **Parity is the eventual bar** — track the 171 commands / 157 dialogs as an explicit checklist; v1 ships a chosen subset, full parity follows.

---

## 7. Phases, milestones & exit criteria

> Durations are relative effort, not calendar promises. Status reflects 2026-06-03.

### Phase 0 — Foundations & safety net  🚧 (mostly done)
- ✅ Electron + Nuxt 4 SPA skeleton via `nuxt-electron`: main/preload/renderer, contextIsolation/sandbox, typed IPC bridge, `app://` protocol.
- ✅ Self-contained **.NET sidecar** exposing `synth.load/play/stop/seek` + `ready`/`tick`/`playbackEnded`. (Originally specified as a GraalVM native-image of the Java core — superseded by D2.)
- 🚧 **Golden-file harness** — only one `.tg` fixture so far; the full multi-format corpus from the Java build is not captured yet.
- ✅ **Spike 0a — audio-sync de-risking.** The sidecar owns Core Audio output; the renderer owns the cursor. Implemented: sidecar emits high-res tick events; `usePlayback()` interpolates between them with `requestAnimationFrame`. Perceived offset is acceptable on the sample; a constant offset can be calibrated out. (No-go fallbacks from the original plan unused.)
- 🚧 **Exit:** app launches on macOS ✅; sidecar plays a `.tg` ✅; Spike 0a met ✅; **remaining:** full golden harness, CI, signing/notarization verification.

### Phase 1 — Read-only viewer  🚧
- ✅ alphaTab renderer renders an open `.tg` (score + tab) to canvas.
- ⬜ Open GP3–7 / MusicXML / MIDI (dialog filters present; parsing returns `null`). ⬜ Track table, richer navigation/scroll.
- **Exit:** open GP3–7, MusicXML, MIDI, `.tg` and render faithfully vs. golden screenshots.

### Phase 2 — Playback (.NET sidecar)  🚧
- ✅ play / stop with progress driven by sidecar ticks; seek protocol exists. Native Windows clock/start/stop checked with silent audio.
- ✅ Audio-driven playhead in the custom tab renderer.
- ⬜ Playback autoscroll and audible fidelity comparison.
- ⬜ pause, count-in, loop, per-track mute/solo/volume, metronome.
- **Exit:** transport complete; timing/mix matches the Java app on the corpus (within tolerance).

### Phase 3 — Native `.tg` read/write in TS  🚧
- ✅ `TGStream` **reader** ported (`tg-reader.ts`).
- 🚧 Source-preserving v2 writer for note/rest/rhythm edits. General serialization and legacy versions remain open.
- **Exit:** byte/canonical-model round-trip golden tests pass for the full `.tg` corpus incl. legacy versions.

### Phase 4 — Editing core  🚧
- ✅ Notes/chords/rests, duration/dots within existing measures, string/beat navigation, ties, undo/redo and safe save/reopen.
- ✅ Tab-only engine spike: shared layout/hit geometry, stable identities, cell/column/range selection, Alt-arrow column moves/copies, wrapped/continuous SVG and comparison view. Tests include 500 measures, zoomed input and source-preserving copies.
- ⬜ New songs/measures, shifting notes across bars, tuplets/effects and broader command coverage.
- Port the edit managers (`TGSongManager`/`TrackManager`/`MeasureManager`), the **command bus** (string IDs preserved), and **undo/redo**. Highest-traffic commands first.
- **Exit:** create → edit → save `.tg` → reopen is lossless; top ~40 commands done.

### Phase 5 — Writers / exporters  ⬜
- MIDI write, MusicXML write, ASCII, LilyPond, PDF (Chromium print-to-PDF or a TS lib), SVG/PNG. Audio export = offline render via the sidecar.
- **Exit:** each exporter matches golden fixtures; GP *write* decided (port vs. document as unsupported).

### Phase 6 — Dialog & command long tail  ⬜
- ~157 dialogs + remaining commands; i18n strings; menus/keybindings from preserved action IDs; replace 28 SPI plugins with a TS module registry.
- **Exit:** parity checklist (171 commands / 157 dialogs) accounted for; v1 subset shippable.

### Phase 7 — Harden & ship  ⬜  (reframed)
- The original Phase 7 was "shrink the sidecar / retire the JVM" — **already true**: the audio-only sidecar now uses self-contained .NET, so there is no JVM to retire and no codec role to remove.
- Remaining: performance pass (large scores, scroll/render latency, audio-sync jitter), accessibility, auto-update, crash reporting, final notarization. Decide whether to **delete** `tuxguitar-java/` once all needed ports land (currently kept as reference).
- **Exit:** shipped macOS `.app`; parity + performance accepted.

---

## 8. Testing & validation strategy

The legacy suite (~14 classes) cannot anchor a rewrite. **Build the safety net first.** (Current: one `.tg` golden test — the rest below is still TODO.)

1. **Golden corpus (cornerstone).** Collect real `.tg`/`.gp*`/`.ptb`/`.tef`/`.mxml`/`.mid` files. Using the *Java build* under `tuxguitar-java/`, emit per file: (a) a canonical serialization of the parsed model, and (b) a re-export in each writer format. Freeze as fixtures.
2. **Round-trip invariants.** `read → write → read` model-stable; `.tg` byte-stable (or canonical-model-stable where byte-stability is impractical).
3. **Differential testing.** Where alphaTab and a TS codec both read a format, diff the resulting models in CI; discrepancies block trusting the TS port.
4. **Visual regression.** Render the corpus with alphaTab, perceptual-diff vs. screenshots of the Java renderer (tolerance).
5. **Playback regression.** Compare the sidecar's event/timing stream against the legacy player; optionally fingerprint offline-rendered audio.
6. **.NET audio checks.** `pnpm test:audio` covers sample-rate/tempo math, real SoundFont PCM, seek/channel state, invalid requests, startup failures, and EOF cleanup. Process tests use SDL dummy output by default; the Electron rhythm fixture uses the real device with silent MIDI. Native macOS/Linux playback, audible synth comparisons, and signed release packaging remain open.
7. **E2E (Playwright + Electron).** Open → edit → save → reopen, transport, a sampling of dialogs.

---

## 9. Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Binary codec fidelity (GP/GPX/PTB/TEF) | High | alphaTab reads first; differential + golden tests on a large corpus before trusting any TS port. |
| Thin existing tests | High | Capture the golden corpus from `tuxguitar-java/` before porting each codec. |
| **Audio sync across the process boundary** | High→Med | **Spike 0a implemented** (tick events + renderer interpolation; audio stays in the sidecar, no raw PCM over IPC). Watch jitter under load / long playback. |
| **alphaTab adapter drift** (TG model vs. alphaTab `Score`) | Medium | One explicit comparison adapter (`tgSongToScore`), golden-tested; default custom tab reads the TG model directly. |
| `MeltySynth` fidelity / SoundFont quality vs. Gervill | Medium | GeneralUser GS is broad-coverage; A/B against the Java mix; web-synth swap remains a fallback. |
| Nuxt-in-Electron (unused SSR, routing/CSP, `generate`-only) | Medium | `ssr:false` + `nuxt generate` + `app://` + `nuxt-electron`; `build`→`generate` enforced. |
| Shipping the native sidecar (build, soundfont size, startup) | Medium | Bundle the .NET runtime, native SDL library, and SoundFont; report unavailable audio while preserving editing. |
| Long-tail scope (171 cmds / 157 dialogs) | Medium | Explicit parity checklist; prioritize by usage; conscious drops with sign-off. |
| macOS signing/notarization | Low–Med | Validate early (Phase 0 packaging), not at the end. |

---

## 10. What gets deleted vs. kept

**Replaced by the web UI / .NET sidecar** (retained under `tuxguitar-java/` as reference, deleted from the product):
- `desktop/TuxGuitar-ui-toolkit-swt` + the `ui-toolkit` abstraction; `TuxGuitar-cocoa-integration-swt`, `TuxGuitar-tray-swt`, `TuxGuitar-image-swt`, `TuxGuitar-awt-graphics`
- The Maven reactor, the SWT-install step, and the `build-scripts/tuxguitar-macosx-swt-cocoa` assembly
- `desktop/gervill`, `TuxGuitar-synth*`, the player/sequencer — **dropped** (.NET `MeltySynth` replaces them)
- `desktop/TuxGuitar-AudioUnit` + native bridge — **dropped**

**Kept as reference (port from, don't ship):**
- The Java `common/` codecs and `.tg`/`TGStream` logic — the reference implementations, ported to TS per-format and golden-gated.

The Java *core* remains the reference implementation throughout; the renderer/editor/model/`.tg`/exporters move to TS, and audio is a self-contained .NET synth with native SDL output.

---

## 11. Build skeleton (as built)

- `electron/` — main + preload (TS), IPC contract (`shared/ipc.ts`), `SidecarManager`
- `app/` — Nuxt 4 renderer (SPA): components, composables (`useSong`, `usePlayback`), `ScoreViewer` with custom tab and alphaTab comparison
- `shared/` — `model.ts`, `tg-reader.ts`, `midi-export.ts`, `tg-to-alphatab.ts`, `ipc.ts`
- `sidecar/` — .NET audio sidecar (SDL2 + MeltySynth); `scripts/build-sidecar.mjs` fetches the SoundFont and publishes the runtime/native library for each target
- `packages/alphatab/` — vendored alphaTab source
- `test/golden/` — Vitest fixtures + harness (currently `.tg`)
- `docs/` — `tgx-format.md`, `ai-features.md`
- `electron-builder.yml` — macOS `.dmg`, hardened runtime
- `tuxguitar-java/` — relocated legacy reference

---

## 12. Decisions resolved (2026-06-03)

| # | Question | Decision |
|---|---|---|
| 1 | Rendering | **Custom tab-only TS/SVG engine**; alphaTab retained as a comparison view. |
| 2 | Sidecar runtime | **Self-contained .NET executable** (dotnet publish). *(Was: GraalVM native-image of the Java core — superseded.)* |
| 3 | UI framework | **Nuxt 4** (Vue 3, SPA). `useState` + Tailwind today; Pinia/component-lib/i18n deferred. |
| 4 | Parity bar | **Full parity is the eventual goal.** v1 subset chosen later. |
| 5 | v1 scope | Deferred — see #4. |
| 6 | Audio engine | **.NET `MeltySynth` + `SDL2`.** Gervill/Java player **dropped**. *(Was: keep Gervill in the sidecar — superseded.)* |
| 7 | Codec sidecar | **None.** `.tg` in TS; other formats via alphaTab / TS ports. *(Was: transitional Java codec reads — superseded.)* |
| 8 | Native text format + AI | **TGX (`.tgx`, JSON) added** as a native text format and AI context substrate — see [§13](#13-tgx-text-format--ai-new-workstream). |
| 9 | Product name | **Tabbycat.** |
| 10 | Cross-platform | **macOS only for now**; revisit later. |

### Still open
- **Custom tab engine:** remaining technique engraving/authoring, repeat playback, custom bend-curve editing, custom beam grouping, multi-voice layout, playback autoscroll and a dedicated accessibility pass. Further playback expression and shortcut preferences UI/persistence remain open. alphaTab retirement depends on those remaining needs.
- **GP write:** port a writer vs. document as unsupported (Phase 5).
- **State lib:** adopt Pinia or stay on `useState` as the store layer grows.
- **v1 feature subset:** which of the 171 commands / 157 dialogs ship first.
- **`tuxguitar-java/` deletion:** when (or whether) to drop the reference tree.

---

## 13. TGX text format + AI (new workstream)

Not in the original plan; added during the rewrite. See `docs/tgx-format.md` and `docs/ai-features.md`.

- **TGX v2 (`.tgx`)** stores the full song model and tab designs as JSON, with an optional preserved TG archive. A slice of the musical model can be used as AI prompt context without the archive payload.
- **AI features (designed, not wired):** autofill/continuation, section transformation ("make this heavier"), variation/harmonization, context-aware suggestion. Model: **Claude** (`claude-opus-4-8` for generation, `claude-sonnet-4-6` for fast edits) in tool-use mode, wrapped in a **deterministic TS pre/post-process scaffold** (pitch/scale/genre/hand-position analysis in; playability/validity checks out).
- **Tooling today:** `scripts/ai/tg-to-tgx.ts` converts `.tg`→`.tgx` (`pnpm ai:tgx [input.tg] [nBars]`, defaults `china.tg 2`).
- **Implemented:** `.tgx` is a native editable save format; manual designs use it. Existing `.tg` source-preserving saves remain available without manual layouts.

---

## 14. Changelog

- **2026-10-16 (repeat writing):** Added inspector controls and configurable `[` / `]` / E commands for repeat starts, ends and alternate-ending starts. Total plays use the native 2–101 range; ending checkboxes support passes 1–8 and identify inherited spans. Shared validation targets one global measure header, including rest/empty-cell selections, and rejects cross-measure ranges. Repeat-only edits now participate in dirty tracking, atomic history and source-preserving save/reopen; numeric nodes retain extension attributes/comments. The comparison adapter uses resolved ending masks and total counts. Unit and desktop tests cover controls, shortcuts, guards, history and file preservation. Repeat playback remains a future slice.
- **2026-10-16 (.NET audio pivot):** Replaced Rust/cpal/oxisynth with a .NET 10 C# playback sidecar using MeltySynth and SDL2. Retained stdio load/play/stop/seek and ready/tick/end events. Added device-queue progress, startup/error/EOF handling, self-contained publishing and package resources, and synth/protocol regression checks. Fixed vendored alphaTab build metadata lookup for Git worktrees. The editor and codecs remain TypeScript; native macOS/Linux and audible fidelity qualification remain open.
- **2026-10-16 (repeat engraving):** Added repeat barlines, combined end/start boundaries, total-play counts and multi-measure alternate endings with wrapped continuations. Horizontal margins and label minimum widths participate in wrapping; separate vertical bands keep brackets/counts clear of annotations and techniques. TG ending/count semantics are checked against the legacy regression file; a desktop study covers narrow/zoomed/continuous views, note hits and header-preserving save/reopen. Repeat authoring and playback expansion remain future slices.
- **2026-10-16 (tab notation refinement):** Replaced round rhythm heads with slashes, retaining hollow half/whole heads and existing beams/flags/dots/rests. Selection is one enclosing box per wrapped row, with the cell caret hidden during ranges and keyboard scrolling preserved. Removed system-wide bend/legato string-gap expansion; bend curves now fit uniform string spacing with pitch amount labels. Updated geometry and desktop regression checks, including reverse drags and wrapped ranges.
- **2026-10-16 (articulation playback):** Added linear playback of TG bend points with correct quarter-tone units, pre-bends/holds/releases, slides into same-string destinations, softer H/P attacks with brief overlap, and cross-bar ties without re-picking. Tied segments retain bend pitch and can release it. Dynamic MIDI allocation isolates changing pitches and overlapping unisons; explicit bend-range setup and recycled-channel resets prevent detuning other notes. Percussion, mute/solo, tempo, short-note effects and rest/gap boundaries are preserved. Channel exhaustion reports a playback error. Added MIDI regressions, measured SoundFont PCM checks, and a native silent Electron edit/undo/replay suite. No format or advanced articulation-model changes.
- **2026-10-16 (technique writing and keymap foundation):** Added single-note inspector controls and B/S/H/P/T for bends, slides, hammer-ons, pull-offs and ties. Bend presets cover pre-bends, releases and quarter-tone amounts. Shared validation rejects missing/incompatible neighbors and protects linked columns; effect changes save through granular XML patches and undo atomically. Added stable command metadata, declarative bindings, conflict/reserved-key validation and reactive overrides with generated hints; settings UI/storage remain future work. Unit and Electron coverage checks authoring, input focus/repeat, history, source preservation and tie playback.
- **2026-10-16 (rhythm and technique engraving):** Added meter-aware beams through 64ths, partial hooks, grouped tuplet numbers/brackets, bends/pre-bends/holds/releases, slides, H/P slurs and ties. Connections use stable note identities and continue across bars/systems; geometry reserves bend space and retains per-string selection. Added pure-geometry tests and a nine-measure Electron study covering fret edits/undo, source-preserving save/reopen, zoom, narrow/wrapped/continuous layouts and comparison switching. Rendering follows existing TG technique data; technique authoring, pitch articulation, remaining engraving and accessibility stay open.
- **2026-10-16 (custom tab engine spike):** Added independent TS layout and SVG tab rendering, precise empty-cell hit/caret bounds, rectangular/column ranges, stable runtime IDs, command/keymap separation, single-measure column moves/copies and source-preserving XML provenance. Added zoom/spacing/wrapping, nearby-system rendering and an audio playhead. alphaTab remains a comparison renderer. Integration coverage includes native Alt keys, range deletion, atomic undo/save/reopen and 500-measure input/render observations. Full engraving and the dedicated accessibility pass remain open.
- **2026-10-16 (note/rhythm milestone):** Added note/chord entry, deletion, rests, duration/dots and empty-string/rest navigation within existing measures. The shared reducer preserves bar length and other-voice timing; its patch stream updates original XML tokens. Extended Electron tests cover structural save/reopen, render concurrency and the native audio clock/Stop control with a silent fixture. New-song/measure creation, cross-bar operations and full format parity remain open.
- **2026-10-16 (first editing slice):** Added existing-note fret changes, source-preserving `.tg` v2 saves, shared undo/redo, native command/close guards, drag/drop and playback from current edits. Added Windows dev/runtime handling, unit/round-trip tests, scoped type checking and Electron integration checks.

- **2026-06-03 (revision):** Updated to implemented state.
  - **Audio engine switched Java/Gervill (GraalVM sidecar) → Rust (`cpal` + `oxisynth`).** Gervill, the Java player/sequencer, the GraalVM native-image, and the AudioUnit bridge are all dropped (D2). MIDI generation moved to TS (`shared/midi-export.ts`).
  - **Codec sidecar role removed** (D3): the sidecar is audio-only; `.tg` reads in TS, other formats via alphaTab/TS.
  - **D1 resolved (in practice) to (b):** TG-model → alphaTab `Score` adapter.
  - Recorded **progress** ([§0](#0-current-status-2026-06-03), per-phase markers in [§7](#7-phases-milestones--exit-criteria)): read-`.tg` + render + play slice working; writer/editing/other-formats/transport-extras pending.
  - **Added TGX text format + AI workstream** ([§13](#13-tgx-text-format--ai-new-workstream)).
  - Legacy Java **relocated to `tuxguitar-java/`**; product **named Tabbycat**.
- **2026-06-03 (original):** Initial high-level plan; core architecture decisions resolved.

---

*Living plan. Phase durations are relative effort estimates, not commitments. Where this document and the code disagree, the code is ground truth — update this file when decisions change.*
