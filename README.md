# Tabbycat

A guitar-tablature editor and player — an **Electron + Nuxt 4 (Vue 3) rewrite of [TuxGuitar](https://github.com/helge17/tuxguitar)**.

- **UI** — Nuxt 4 / Vue 3 single-page app running in Electron.
- **Notation** — custom TypeScript layout and SVG rendering for tablature, with [alphaTab](https://alphatab.net) (MPL-2.0) available as a comparison view.
- **Audio** — a self-contained **.NET 10 / C# sidecar** (MeltySynth + SDL2) synthesizes a SoundFont and streams device-queue playback positions back for cursor sync. Playback and writing are the scope; recording is not planned.
- **Platform** — macOS release configuration; Windows development, desktop editing, native audio, and an unsigned unpacked Windows build are tested. Signed installers and native macOS audio qualification remain open.

The original Java/SWT TuxGuitar is preserved under [`tuxguitar-java/`](tuxguitar-java/) as the reference implementation the rewrite ports from. The overall plan lives in [`MIGRATION.MD`](MIGRATION.MD).

## Status

Early and incomplete — version `0.0.1`. Today the app:

- opens the native **`.tg`** format through Open or drag and drop, and renders the score/tab,
- selects notes and rests, enters notes and chords, deletes notes, changes durations and dots, and undoes/redoes changes,
- selects individual string cells or ranges, and moves/duplicates rhythmic columns within a measure,
- offers wrapped/continuous tab, zoom and spacing controls, and an audio-driven playhead,
- saves and reopens edited `.tg` v2 files while preserving the original XML and additional archive entries,
- plays the edited song through the .NET sidecar when it is installed, with a progress bar.

Edit **inside existing measures**: click a note or rest, select a string, and type a fret number. Entering a fret on an empty string adds a note; using another string adds to the chord. Two digits entered within one second form one undo step. Tied-note fret changes apply to the whole tie. The inspector also exposes string, fret, duration and dots.

| Score shortcut | Action |
|---|---|
| ← / → | Previous / next beat, including rests |
| ↑ / ↓ | Previous / next string, including empty strings |
| Home / End | First / last beat in the measure |
| Shift + arrows | Extend a rectangular selection |
| Alt + ← / → | Move the selected columns past the adjacent column |
| Alt + Shift + ← / → | Duplicate the selected columns before / after |
| Delete / Backspace | Delete notes in the selected cells |
| R | Turn the selected columns into rests |
| + / − | Longer / shorter duration |
| . | Toggle dotted duration |
| Escape | Collapse the selection to the current cell |

Click or drag over the strings to select cells; click or drag in the rhythm rail to select whole columns. Empty cells have the same per-string cursor as occupied cells. Shortcuts act while the tab surface has focus. The inspector exposes the move/duplicate commands too.

Column moves carry their notes and durations; duplication consumes plain trailing rests without overwriting notes or extending the bar. These commands currently require a complete, single-voice measure without ties, slides, hammer-ons or let-ring connections. A range spanning measures is rejected. Each operation is one undo step, and stable editor identities keep the cursor attached to the moved/copied content.

Shortening a note fills the remaining space with rests. Lengthening consumes adjacent rests but cannot overlap later notes or cross the barline. Other voices keep their timing. Existing tuplets retain their ratio; creating new tuplet groups is not available yet.

Saving applies the requested note and rhythm changes directly to the original XML, preserving unrelated data and archive entries. Writes use a temporary file and atomic replacement, and refuse to overwrite a file changed outside the app. Save, Save As, undo and redo work from the toolbar, native menu and keyboard shortcuts. Opening another song, reloading or closing with unsaved changes offers Save / Discard / Cancel.

Drop one `.tg` file anywhere in the app to open it, including over an existing score. Drops use the same unsaved-change prompts as Open. Unsupported formats, multiple files, folders and invalid songs leave the current document intact.

The custom renderer is a **tab-only spike**: one track/voice at a time, fret numbers, tuning, barlines, rhythm symbols, dots and existing tuplet ratios. Technique/repeat data and other voices are retained, with notices directing you to the comparison renderer for their engraving. Full beaming/technique engraving, multi-voice layout, playback autoscroll, new songs/measures, cross-bar editing, new tuplet groups, other-format imports and general `.tg` serialization remain open. A dedicated accessibility pass follows the rendering engine. See [`MIGRATION.MD`](MIGRATION.MD).

## Requirements

- macOS or Windows for development
- [Node.js](https://nodejs.org) ≥ 22.12 (24 LTS recommended) and [pnpm](https://pnpm.io)
- To build audio: [.NET 10 SDK](https://dotnet.microsoft.com/download/dotnet/10.0). Published builds include their runtime.

## Getting started

```sh
pnpm install
pnpm dev          # launches Electron + the Nuxt dev server with HMR
```

The app runs without audio out of the box. To enable playback, build the sidecar once:

```sh
pnpm sidecar:build   # downloads GeneralUser GS (~32 MB) and publishes self-contained .NET audio
```

This produces `sidecar/bin/win-x64/tabbycat-audio.exe` on Windows x64 (or `mac-arm64/tabbycat-audio`, `mac-x64/tabbycat-audio`, etc.) with its runtime and SDL library, plus `sidecar/bin/GeneralUser.sf2`. These outputs are git-ignored. Keep the complete published directory together. Restart the app; the status bar should read `Audio ready`. Without the sidecar the editor still works; Play reports that audio is unavailable.

`node scripts/build-sidecar.mjs --runtime osx-arm64` can publish a different supported target. Electron packaging automatically builds audio for its target architecture and includes the runtime, native SDL library, and SoundFont. Cross-publishing does not validate audio on that operating system. Native AOT is not used.

The launch and audio build scripts are portable Node scripts. On macOS the dev launcher still shortens `TMPDIR` for Nuxt's socket path. It refuses to start if port 4399 is already in use, without terminating another session.

## Building a release

```sh
pnpm generate     # static SPA build → .output/public  (also: `pnpm build`)
pnpm preview      # run Electron against that build
pnpm dist         # package a signed-ready macOS .dmg via electron-builder → release/
```

> The renderer is served in production from a custom `app://` protocol, which requires a **static** build — that's why `build` maps to `nuxt generate`, not `nuxt build`.

## Tests

```sh
pnpm test         # Vitest (test/**/*.test.ts)
pnpm typecheck    # Vue, shared model and Electron TypeScript
pnpm test:e2e     # build, then run hidden Electron editing, rhythm and tab-engine tests
pnpm test:audio   # after sidecar:build: synth/timing checks and published-process protocol tests
```

Tests cover the bundled `china.tg`, note/chord/rest entry, rhythm integrity, history, ties, renderer mapping, archive preservation (including unknown XML, Unicode and different line endings), failed saves, external changes, and edited MIDI scheduling. Electron tests use temporary copies under `.cache/` and save screenshots there. They exercise real rendering, file drops, note/rest interaction, native commands, structural save/reopen, and cancellation/error recovery. When the sidecar binary exists, they also verify that the native audio clock reaches the edited measure and stops, using a silent fixture. Audible fidelity and opening saved files in the legacy Java app remain separate qualification steps.

Audio checks exercise tempo changes at multiple sample rates, actual SoundFont PCM, seek/controller state, load resets, malformed requests, stop/end events, startup failures, and EOF shutdown. The process tests use SDL's dummy driver by default; `TG_AUDIO_TEST_NATIVE=1` selects the real device with silent MIDI. The Electron rhythm test uses the real device. Progress measures frames consumed from SDL's queue; the final hardware buffer adds unmeasured latency. macOS/Linux device playback and listening comparisons against the old synth still need native qualification.

For an unsigned Windows package, run `pnpm exec electron-builder --win --dir --config.win.signAndEditExecutable=false` after `pnpm generate`. Setting `TG_TEST_PACKAGED_APP` to `release/win-unpacked/Tabbycat.exe` when running `node test/e2e/rhythm.mjs` exercises the packaged app's editing, saves and real-device playback. Optional screenshots are captured in the development run because the hidden packaged window can suspend capture.

The tab-engine suite also covers zoomed pointer input, rectangular selection, Alt shortcuts, stable identities, source-preserving column copies, wrapped/continuous layouts and a 500-measure fixture. Only nearby systems mount in the wrapped SVG. Local input-to-DOM timing observations are written to `performance.json`; they exclude display/paint latency because hidden Electron windows throttle animation frames. They are observations rather than hardware-independent performance guarantees.

## Project layout

| Path | What |
|---|---|
| `app/` | Nuxt renderer — Vue components, composables, app shell |
| `electron/` | Main process, typed preload bridge, sidecar supervisor |
| `shared/` | Song model, edit commands/history/identities, tab geometry, `.tg` IO, MIDI/alphaTab adapters, IPC types |
| `sidecar/` | .NET audio sidecar, frame scheduling, MeltySynth, SDL output, and audio checks |
| `packages/alphatab/` | Vendored alphaTab source |
| `scripts/` | Icon generation, dev gate, AI/`.tgx` tooling |
| `docs/` | `tgx-format.md`, `ai-features.md` |
| `tuxguitar-java/` | Legacy Java/SWT TuxGuitar — reference implementation |

For an architecture overview and contributor notes, see [`CLAUDE.md`](CLAUDE.md).

## AI & the TGX format (planned)

A text-based native format, **TGX** (`.tgx`, JSON) — lossless, git-diffable, and token-efficient — is being introduced so that AI-assisted editing can operate on a slice of measures as both the editable model and the prompt context. See [`docs/tgx-format.md`](docs/tgx-format.md) and [`docs/ai-features.md`](docs/ai-features.md).

## Acknowledgements & licensing

Tabbycat is a derivative of **TuxGuitar**, © 2005–2022 Julián Casadesús and 2023–2025 contributors, released under the **GNU LGPL**. The legacy Java sources under `tuxguitar-java/` retain that license.

Third-party components:

- **alphaTab** — notation rendering — MPL-2.0
- **GeneralUser GS** — SoundFont (downloaded at build time, not redistributed here) — see its own license
- **MeltySynth** — C# SoundFont synthesis — MIT
- **SDL2** (native binaries from Ultz.Native.SDL) — audio output — zlib
- **Electron**, **Nuxt**, **Vue**, **Tailwind CSS**

> A top-level `LICENSE` for the rewritten (non-legacy) code has not been added yet — TODO. Given the LGPL legacy base, the project license must be chosen with that in mind.
