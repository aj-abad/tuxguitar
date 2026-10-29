# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Document selection (2026-10-17):** `TabEditor.vue` handles pointer input on the entire white document, including heading, margins and footer. A four-pixel drag threshold starts a document-relative rectangular marquee; pointer capture and edge scrolling continue outside the SVG and across virtualized rows. Every drag selects whole columns, including all strings on both endpoint rows and within a single row. `tab-selection.ts` combines the wrapped musical interval with whole columns whose fret numbers overlap the rectangle, using SVG coordinates and text extents without knockout padding. Preview caching includes the rectangle bounds so partial overlaps update even within the same snapped cell. Recomputing both parts makes dragging back shrink the selection. Pointer input always replaces selection; there are no Shift/Alt/Ctrl mouse selection operations or modifier snapshots. Keyboard Shift-arrow selection and Alt-arrow move/copy commands remain independent. Highlights merge adjacent cells without covering gaps. `editor.cellSelection` holds explicit coverage, follows column identities and participates in undo snapshots. The model checks the full coverage before allowing edits beyond Delete, even if an anchor exists. Clicks focus one cell and resume ordinary editing. `hitTestTab` selects the nearest row, then nearest column center/string, including empty cells; direct bend hits retain their note association. Design-mode bar handles retain their separate resize gesture. `test/tab-selection.test.ts` and the tab-engine desktop suite cover whole-column coverage, upward-right and partial-overlap drags, ignored pointer modifiers, gaps, history, whitespace starts, cancellation and scrolling.

**Document layout and TGX (2026-10-17):** The tab-only view uses a centered 860-unit white document and compact engraving. Windows 11 22H2+ uses native acrylic with translucent chrome. `tab-design.ts` captures explicit per-track rows/widths, clamps adjacent-bar redistribution to notation minima, and implements break-after/pull-from-next-row. `track.tabLayout.rows` is edited through `layout.set`, normal history, and dirty signatures; saved rows never reflow on resize or zoom. `tab-layout.ts` fits duration-weighted intervals, compressing long gaps first and preserving glyph/technique minima; playback crosses note centers at onsets. `shared/tgx.ts` validates TGX v2 (full model plus optional preserved TG archive). `SongDocument` opens/saves TGX and prompts TG imports with designs to save a TGX copy. V1 AI projections must be reconverted. Oversized notation expands a bar with a notice while retaining its row. `test/tab-design.test.ts`, `test/tgx.test.ts` and `test/e2e/tab-design.mjs` cover layout/history and save/reopen. Standard staff, multi-track systems and page pagination remain out of scope.

**Repeat engraving (2026-10-16):** `tab-structure.ts` resolves TG ending starts into spans, terminated by a repeat close, a different ending, a repeat start, or song end. Explicit identical markers merge; a repeat close resets the span. Wrapped continuations repeat the label in parentheses and omit false hooks; final endings stay open. One barline per boundary combines an adjacent repeat end/start within a system and splits them at a row break. Horizontal symbol margins and label minimum widths affect wrapping before columns are placed; dedicated ending/count bands adjust system height while strings stay uniform. `TabStructure` draws the resulting geometry. Native TG `repeatClose` is the number of additional passes; labels show total plays only above two (`2` becomes `×3`). Source headers remain unchanged through note edits/save. Repeat playback expansion remains open. The legacy `altRepeatLoop_20.tg` anchors semantics; the repeat desktop suite covers the rendering and save/reopen path.

**Repeat writing (2026-10-16):** `repeat-edits.ts` validates global measure-header commands and converts total plays (2–101) to TG additional repeats. `RepeatControls` and `[` / `]` / E share the command registry, reactive keymap and `useSong.runTabCommand`; ending checkboxes select passes 1–8. Controls act on the selected measure, including rests/empty cells and same-measure ranges; cross-measure ranges are rejected. Continuing endings identify their origin without changing the earlier marker. Clearing a measure is one history command. Header patches preserve runtime note identities, take part in dirty-state signatures and patch only the relevant XML children, retaining unrelated attributes, comments and extensions. Numeric repeat nodes are read through `tagText` to support such attributes. The alphaTab adapter uses total counts and resolved ending masks too. Save/reopen, history, malformed payloads, focus/repeat guards and source preservation have unit and desktop coverage. Playback still runs linearly.

**Current editing slice (2026-10-16):** `shared/score-edits.ts` validates and applies note/chord/rest/duration operations within existing measures. Its patch stream also drives the source-preserving writer (`tg-writer.ts`, `xml-source.ts`). `shared/editor.ts` owns immutable command history and a beat/voice/string cursor; `useSong` owns the open document state. Edit sequences replay against the original model for save and playback, so addresses refer to each operation's current model. Main retains original bytes and the file path (`electron/documents.ts`), checks external modifications, and writes atomically. Shorter durations fill space with rests; longer ones consume rests without moving later notes or other voices. Inactive beats retain source metadata. `AlphaTabViewer` serializes worker renders and coalesces rapid changes to prevent stale bounds. `electron/playback.ts` reloads MIDI from current edits before audio starts. `useEditorBindings` installs menu/keyboard/unload listeners once. `pnpm typecheck` and `pnpm test:e2e` supplement Vitest. Windows editing and native audio startup/playback are tested; audible fidelity, legacy-app round trips and packaging remain separate gates. New songs/measures, cross-bar editing and new tuplet groups remain open.

**Custom tab spike (2026-10-16):** `shared/tab-layout.ts` computes geometry directly from the TG model. `TabEditor.vue` uses that geometry for SVG drawing, scaled hit testing, per-string carets, rectangular/column ranges and the playback line. Wrapped views mount nearby systems; continuous views use one system. `editor-identities.ts` preserves runtime column/note identity across edits, while file operations still use validated model addresses. `tab-commands.ts` separates keyboard resolution from commands. `tab-columns.ts` moves column blocks with duration and duplicates them into trailing rest capacity; single-voice, complete measures only, with linked techniques and cross-bar ranges rejected. XML provenance clones the original beat nodes, including unknown fields. Other voices and unsupported engraving remain in the model/source. Accessibility is deferred to a dedicated pass after the rendering engine; do not treat this spike as full engraving or a11y parity.

**Rhythm and technique engraving (2026-10-16):** `tab-rhythm.ts` groups beams by meter/tuplet and computes secondary beams, hooks, numbers and brackets. Odd eighth-note meters default to pairs ending in three; `.tg` has no explicit tuplet-group identity, so groups are inferred from ratios and written durations. `tab-techniques.ts` resolves same-string connections, splits them at system breaks, and creates bend/pre-bend/hold/release glyphs. TG bend values are quarter-tone units (4 = full tone), positions 0–12; `hammer` belongs to the origin and H/P follows fret direction, `slide` belongs to the origin, and `tiedNote` belongs to the destination. Explicit rests/timing gaps stop links; invalid or unresolved techniques produce a notice without changing source data. Layout reserves horizontal bend space while keeping all string gaps uniform; compact bend heights and amount labels fit that spacing. Rhythm noteheads are slashes (hollow for half/whole notes). Range overlays merge to one rectangle per system and hide the cell caret; keyboard scrolling uses caret geometry even while its outline is hidden. `TabBeams` and `TabTechniques` only draw that geometry. Bend/slide playback now follows the stored data; the column-operation guards still apply.

**Technique writing (2026-10-16):** `technique-edits.ts` validates same-string neighbors, direction, tie pitch and bend points, and emits granular patches consumed by the reducer and source-preserving writer. Inspector buttons and B/S/H/P/T use the same `useSong.runTabCommand` dispatch; preset bend application and clearing are atomic history commands. This slice acts on one selected note, not ranges. Imported custom curves are preserved until explicitly replaced. `tab-commands.ts` owns stable IDs, metadata, declarative defaults, binding validation and resolution. `useTabKeymap` provides reactive overrides/reset and hints from the active map; no preferences UI or persistence yet. Never hard-code shortcut text in controls. Keys use `event.key` with exact modifiers; native document shortcuts, note entry/navigation and AltGr are reserved. IME, auto-repeat and inspector input focus cannot toggle techniques. Extend the shared validator/writer for future technique commands; do not mutate effects directly in Vue.

**Articulation playback (2026-10-16):** `midi-articulations.ts` plans same-string/same-voice timing, tied sustains, let-ring, linear TG bend curves, second-half slides and softer H/P destination attacks with 10 ms overlap. Rest/gap boundaries break links; unmarked tied notes hold the previous bend pitch. `midi-export.ts` allocates the 15 melodic MIDI channels dynamically, isolates bends/slides and overlapping unisons, configures explicit RPN bend range, and silences release tails before retuning a recycled channel. Percussion stays on channel 9. Channel exhaustion throws through the existing playback error UI; `songEndTick` only plans durations and cannot fail on allocation. Mute/solo apply during planning. No document-format, curve-editor or sidecar-protocol changes. Tests cover MIDI behavior, real SoundFont PCM pitch/channel isolation and native silent desktop playback. SoundFont legato is an approximation; audible guitar realism and native macOS/Linux qualification remain open.

**Tabbycat** is a guitar-tablature editor and player — an **Electron + Nuxt 4 (Vue 3) + TypeScript rewrite of TuxGuitar**. The renderer is a Nuxt SPA with custom **tab-only SVG rendering** and an **alphaTab comparison view**; audio playback runs in a separate **.NET 10 / C# sidecar** (MeltySynth + SDL2) driven over stdio JSON-RPC. The product scope is playback and writing, without recording. Release packaging currently targets macOS; the replacement needs native macOS qualification.

The original Java/SWT TuxGuitar lives under `tuxguitar-java/` as the **reference implementation** — it is not part of the Node build. See [Legacy Java tree](#legacy-java-tree).

> **`MIGRATION.MD`** records intent and phasing. The audio engine has moved from the early Rust implementation to self-contained .NET; model, editing, layout, and codecs remain TypeScript. Where the plan and code disagree, the code wins.

## Build & run

pnpm + Node ≥22.12 (24 LTS recommended), on macOS or Windows.

```sh
pnpm install            # postinstall builds vendored alphaTab + `nuxt prepare`
pnpm dev                # Nuxt dev server + Electron, with HMR (dev port 4399)
pnpm generate           # static SPA build → .output/public   (alias: `pnpm build`)
pnpm preview            # generate + run Electron against the build
pnpm dist               # generate + electron-builder → release/*.dmg
pnpm smoke              # generate + headless launch-and-exit boot check (TG_SMOKE=1)
```

- `pnpm dev` uses `scripts/dev.mjs` to check the port, generate icons where supported, and start Nuxt. It shortens `TMPDIR` on macOS to avoid the Unix-socket path limit. `nuxt-electron` compiles `electron/main.ts` + `electron/preload.ts` and launches Electron against the Vite dev server.
- **Nuxt-in-Electron constraint:** production is served from a custom `app://bundle` protocol and **must be built with `nuxt generate`** (static SPA), not `nuxt build` — this is why `build` is aliased to `generate`. `main.ts` serves `.output/public` over `app://` with a CSP.

### Audio sidecar

Playback needs the published .NET sidecar, which is **not** committed:

```sh
pnpm sidecar:build      # downloads GeneralUser GS SF2 (~32 MB) + self-contained dotnet publish
pnpm test:audio         # synth/timing checks + published-process protocol tests
```

Requires the .NET 10 SDK (`global.json` allows current .NET 10 feature bands). Outputs `sidecar/bin/<platform>-<arch>/tabbycat-audio` (`.exe` on Windows) with its runtime/native library and `sidecar/bin/GeneralUser.sf2`, all gitignored. Platform folders use `win`, `mac`, or `linux`; .NET RIDs use `osx` for macOS. `--runtime <RID>` supports cross-publishing. Packaged users need no separately installed .NET runtime. **If audio is absent the editor still works** and Play reports the unavailable sidecar. The electron-builder beforePack hook builds the matching target and extraResources includes the entire published directory plus SoundFont.

## Tests

Vitest, files under `test/**/*.test.ts`.

```sh
pnpm test               # vitest run
pnpm test:watch
pnpm typecheck          # shared/Electron/Vue types
pnpm test:e2e           # build + eight hidden Electron suites, including repeat-writing and technique-writing
```

Coverage includes reader/writer round trips, source preservation, document guards, note/rest/rhythm edits, ties, history, rendering and MIDI playback. The Electron tests use isolated profiles/files under `.cache/`; when the sidecar is present, a silent fixture exercises the real audio device clock and Stop control. Fixtures resolve relative to repo root — **keep `china.tg` at the root**.

## Layout

- `app/` — Nuxt 4 renderer (SPA, `ssr:false`): `app.vue`, `components/`, `composables/`, `assets/css`, `types/electron.d.ts` (types `window.tg`).
- `electron/` — main process (`main.ts`), typed preload (`preload.ts`), sidecar supervisor (`sidecar.ts`), `resources/` (`.icns`).
- `shared/` — TypeScript shared across main / renderer / sidecar-facing code:
  - `model.ts` — the song model (TS port of TuxGuitar's `TGSong → … → TGNote`).
  - `tg-reader.ts` — native `.tg` binary parser.
  - `midi-export.ts` — model → MIDI event stream for the sidecar.
  - `tab-layout.ts` — pure tab geometry, cells, hit testing and playback position.
  - `tab-selection.ts` — whole-column marquee coverage, wrapped intervals and highlight bands.
  - `tab-rhythm.ts`, `tab-techniques.ts`, `tab-structure.ts` — meter/tuplet beams, technique geometry and repeat/ending structure.
  - `technique-edits.ts` — validated technique writing, bend presets and command availability.
  - `repeat-edits.ts` — validated global repeat/ending commands and total-play conversion.
  - `tab-columns.ts`, `tab-commands.ts` — column operations and focus-scoped keymap.
  - `editor.ts`, `editor-identities.ts` — immutable history, selection and stable runtime IDs.
  - `tg-to-alphatab.ts` — model → alphaTab `Score` for the comparison renderer.
  - `ipc.ts` — `IpcChannels` names + `TgBridge` / `TickEvent` / `SidecarStatus` types.
- `sidecar/` — .NET audio: `Program.cs` (stdio protocol), `Schedule.cs` (tempo/frame math and validation), `SynthRenderer.cs` (MeltySynth scheduling), `PlaybackEngine.cs` (worker/queue clock), `SdlAudioDevice.cs` (native output), `tests/`.
- `packages/alphatab/` — vendored alphaTab source (pnpm workspace member; pinned, see git history).
- `scripts/` — `gen-icons.mjs` (`.icns`/png from `public/icon.svg`), `dev-guard.mjs`, `ai/` (`.tg`→`.tgx` tooling).
- `test/golden/` — Vitest golden tests. `docs/` — `tgx-format.md`, `ai-features.md`.
- `public/` — static renderer assets: `font/Leipzig.otf` (alphaTab SMuFL font), `icon.svg`, etc.
- `tuxguitar-java/` — legacy Java/SWT TuxGuitar (Maven). Reference only; not built by the Node toolchain.
- Config: `nuxt.config.ts`, `electron-builder.yml`, `tailwind.config.ts`, `tsconfig.json`, `vitest.config.ts`, `pnpm-workspace.yaml`.

Path alias `~~` → repo root (e.g. `~~/shared/model`). The package `name` is `tabbycat` (lowercase — npm rule); the display name "Tabbycat" is set in `main.ts` (`app.setName`) and electron-builder `productName`.

## Architecture

**Three processes.**
1. **Main** (`electron/main.ts`, Node/TS) — app lifecycle + single-instance lock, native menu (`buildAppMenu`; most items are stubs with `enabled:false`), the File-open dialog, `.tg` parsing, the `app://` bundle protocol + CSP, and the **sidecar lifecycle**. Owns every privileged operation.
2. **Renderer** (`app/`, Chromium + Vue) — the Nuxt SPA. No Node access: `contextIsolation:true`, `nodeIntegration:false`, `sandbox:true`. Reaches main only through the preload bridge.
3. **Sidecar** (`sidecar/`, C#/.NET) — audio synthesis, output, and the playback clock.

**Preload bridge (`window.tg`).** `electron/preload.ts` exposes one typed object via `contextBridge` — `TgBridge` in `shared/ipc.ts`: `openFileDialog`, `getSidecarStatus`, `play`/`stop`/`seek`, and `onTick`/`onPlaybackEnded`/`onMenuTriggerOpen` listeners (each returns an unsubscribe fn). All channel strings live in `IpcChannels`. **To add an IPC capability:** add the channel in `ipc.ts`, an `ipcMain.handle` in `main.ts`, and a bridge method in `preload.ts` (and the `TgBridge` type).

**Song model (`shared/model.ts`).** TS port of TuxGuitar's `TGSong → TGTrack → TGMeasure → TGBeat → TGVoice → TGNote` tree (with shared `TGMeasureHeader`s). Timing uses TuxGuitar's "precise" units: `WHOLE_PRECISE_DURATION = 11531520`, first beat at `PRECISE_STARTING_POINT`, quarter-ticks scaled by `PRECISE_FACTOR`. **Keep these constants and field names identical to the Java reference** — `.tg` files on disk and the sidecar both depend on them.

**File-open path.** Native dialog or a disk-backed dropped File → preload resolves the drop path → `main.ts` validates and opens a `SongDocument`. `.tg` and `.tgx` are supported; filters and drop validation share `shared/file-formats.ts`. `useSong()` holds the document/editor in Nuxt `useState`, checks unsaved changes, and preserves the current document on invalid input. Original paths/bytes remain in main. Playback resolves the current edit sequence against that original document before exporting MIDI.

**Rendering.** `ScoreViewer.vue` selects the custom `TabEditor` or `AlphaTabViewer` comparison view. The custom path is TG model → pure geometry → SVG (`TabSystem`, `TabRhythm`), with a separate caret/range/playhead overlay. It does not use alphaTab geometry or glyphs. The comparison view creates an `AlphaTabApi` and renders `tgSongToScore()` (`shared/tg-to-alphatab.ts`). It serializes worker renders and coalesces pending updates to avoid stale hit bounds. **alphaTab's own player/cursor are disabled** (`enablePlayer:false`). Its SMuFL font loads from `public/font/Leipzig.otf`.

**Playback & progress.** A dedicated worker owns MeltySynth and fills SDL's stereo PCM queue using reusable buffers (~100 ms queued). Progress is generated frames minus still-queued frames, with a 50 ms reporter producing `tick {qtick, bpm}` and `playbackEnded`. The final hardware buffer's latency is not measurable by this API. No managed audio callback or wall-clock playback fallback is used. A separate stdin thread prevents Console reads from blocking reports. Load/play/seek/stop acknowledgments follow worker application; startup only announces ready after both synth and device open. EOF closes the device. `SidecarManager` speaks newline-delimited JSON over stdio; `main.ts` converts quarter ticks to precise ticks. The renderer interpolates the playhead. Editing stops playback and Play loads current edits. Playback autoscroll remains open.

**Sidecar protocol (`sidecar/Program.cs`).** stdin requests `{id, method, params}`; stdout `{id, result}` / `{id, error}` / `{event, …}`. Methods: `synth.load {events, tpq}`, `synth.play {from_tick}`, `synth.stop`, `synth.seek {tick}`. Events: `ready`, `tick`, `playbackEnded`. SoundFont path is argv[1] (defaults to `GeneralUser.sf2` next to the binary). Invalid loads preserve the current schedule. Seek restores prior channel setup but does not retrigger notes that started before the seek position, matching the earlier sidecar. Tests use SDL dummy output unless `TG_AUDIO_TEST_NATIVE=1`; the Electron rhythm fixture uses a real device with silent MIDI. Native macOS/Linux playback and audible parity remain open.

**TGX + AI.** TGX v2 is a native save format containing the full song model, per-track designs and an optional preserved TG archive. `scripts/ai/tg-to-tgx.ts` converts `.tg`→`.tgx` (`pnpm ai:tgx [input.tg] [nBars]`, defaults `china.tg 2`); prompt context omits the archive. AI editing integration remains planned. See `docs/tgx-format.md` and `docs/ai-features.md`.

## Conventions

- TypeScript across the Node/web side; Vue 3 `<script setup>` + Composition API; **Tailwind v4** for styling. Shared reactive state is keyed Nuxt `useState(key, …)` singletons, not Pinia (yet — the migration plan names Pinia as a later step).
- Keep model field names and timing constants aligned with the Java reference in `tuxguitar-java/` — they define `.tg` on-disk semantics. Port codecs/managers *out* of the legacy tree into `shared/`; don't wire the running app to it.
- The window is frameless (`titleBarStyle:"hidden"` + vibrancy); the chrome is drawn by `components/Global/TitleBar.vue`.

## Legacy Java tree

`tuxguitar-java/` is the original multitrack TuxGuitar (Java, SWT/Cocoa, Maven multi-module; `groupId app.tuxguitar`, package root `app.tuxguitar`, classes prefixed `TG`). It is the **source of truth** for the rewrite: `.tg` format semantics, the song model, the file-format codecs (gp3/4/5, gpx, ptb, tef, musicxml, midi, lilypond, ascii, pdf), and the Gervill synth. `common/` is platform-independent (model + IO + codecs); `desktop/` is the app + SWT/Cocoa UI.

It is **not** built by the Node toolchain and has **no npm scripts**. Building it directly is a Maven job (JDK 17+, Maven 3.3+, a hand-installed Eclipse SWT for cocoa/macosx) under `tuxguitar-java/desktop/build-scripts/tuxguitar-macosx-swt-cocoa` — see `MIGRATION.MD §3` for the inventory. Treat it as a reference to read and port from, not a dependency.
