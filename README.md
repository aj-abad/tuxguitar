# Tabbycat

A guitar-tablature editor and player — an **Electron + Nuxt 4 (Vue 3) rewrite of [TuxGuitar](https://github.com/helge17/tuxguitar)**.

- **UI** — Nuxt 4 / Vue 3 single-page app running in Electron.
- **Notation** — custom TypeScript layout and SVG rendering for tablature, with [alphaTab](https://alphatab.net) (MPL-2.0) available as a comparison view.
- **Audio** — a self-contained **.NET 10 / C# sidecar** (MeltySynth + SDL2) synthesizes a SoundFont and streams device-queue playback positions back for cursor sync. Playback and writing are the scope; recording is not planned.
- **Platform** — macOS release configuration; Windows development, desktop editing, native audio, and an unsigned unpacked Windows build are tested. Signed installers and native macOS audio qualification remain open.

The original Java/SWT TuxGuitar is preserved under [`tuxguitar-java/`](tuxguitar-java/) as the reference implementation the rewrite ports from. The overall plan lives in [`MIGRATION.MD`](MIGRATION.MD).

## Status

Early and incomplete — version `0.0.1`. Today the app:

- opens **`.tg` and `.tgx`** through Open or drag and drop, and renders tablature,
- selects notes and rests, enters notes and chords, deletes notes, changes durations and dots, and undoes/redoes changes,
- selects individual string cells or ranges, and moves/duplicates rhythmic columns within a measure,
- offers a centered white document or continuous tab, zoom and spacing controls, and an audio-driven playhead,
- designs per-track rows with draggable barlines, explicit row breaks and pulling a bar from the next row,
- engraves meter-aware beams, tuplets, bends, slides, hammer-ons, pull-offs and ties,
- writes bends, slides, hammer-ons, pull-offs and ties with inspector controls and keyboard shortcuts,
- writes repeat barlines, total-play counts and alternate endings with inspector controls and shortcuts,
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
| B | Toggle a full-tone bend |
| S | Toggle a slide to the following note |
| H / P | Toggle a hammer-on / pull-off to the following note |
| T | Toggle a tie to the previous note |
| [ / ] | Toggle repeat start / end on the selected measure |
| E | Toggle an alternate-ending start on the selected measure |
| Escape | Collapse the selection to the current cell |

Click anywhere on the white document to focus the nearest editable string-and-beat position, including empty cells. Focus stays on the nearest row, even in a long blank gap after its final note. Drag from anywhere on the document to draw a rectangular marquee and select whole columns, including every string, both within one row and across rows. The selection combines the musical interval between the endpoints with the entire column of any fret number touched by the rectangle. Dragging back shrinks both parts of the selection. Highlights join adjacent selected columns without filling gaps. The marquee scrolls at the canvas edges and disappears on release; Escape ends a drag and collapses the range. Empty cells have the same per-string cursor as occupied cells. Shortcuts act while the tab surface has focus. The inspector exposes the move/duplicate commands too.

Every click or drag replaces the selection; Shift, Alt and Ctrl do not alter mouse selection. Keyboard shortcuts, including Shift + arrows and Alt + arrows, retain their existing behavior. Selections with gaps currently support **Delete only**; fret, rhythm, technique, repeat and column edits require a cell or regular range. Delete removes only selected notes as one undo step, retaining the gaps and selection through undo/redo. Selection changes do not mark the song as unsaved.

Column moves carry their notes and durations; duplication consumes plain trailing rests without overwriting notes or extending the bar. These commands currently require a complete, single-voice measure without ties, slides, hammer-ons or let-ring connections. A range spanning measures is rejected. Each operation is one undo step, and stable editor identities keep the cursor attached to the moved/copied content.

Shortening a note fills the remaining space with rests. Lengthening consumes adjacent rests but cannot overlap later notes or cross the barline. Other voices keep their timing. Existing tuplets retain their ratio; creating new tuplet groups is not available yet.

Saving applies the requested note, rhythm and repeat changes directly to the original XML, preserving unrelated data and archive entries. Writes use a temporary file and atomic replacement, and refuse to overwrite a file changed outside the app. Save, Save As, undo and redo work from the toolbar, native menu and keyboard shortcuts. Opening another song, reloading or closing with unsaved changes offers Save / Discard / Cancel.

Drop one `.tg` or `.tgx` file anywhere in the app to open it, including over an existing score. Drops use the same unsaved-change prompts as Open. Unsupported formats, multiple files, folders and invalid songs leave the current document intact.

**Design mode** keeps one selected track on a fixed-width white document. Click a bar, drag an internal barline, or enter its width to redistribute space with the following bar. Focus a handle and use Left/Right (4 units) or Shift+Left/Right (20 units) for keyboard resizing. Row edges stay fixed. **Break after bar** starts a new row; **Pull bar from next row** moves exactly its first bar into the current row, if it fits legibly. **Automatic layout** removes that track's overrides. Every design change can be undone. Widths and rows are saved in **TGX v2**; saving a designed `.tg` import prompts for a `.tgx` copy. Zoom and window resizing do not reflow saved rows.

Automatic bars expand for dense passages. Fixed bars compress longer-duration spaces first, keeping minimum room for fret numbers, bends, repeat symbols and legibility. A musical edit that exceeds a fixed bar's minimum displays a notice and expands that bar without moving it to another row. The playhead crosses fret centers at note onsets. Windows 11 22H2 and newer use native acrylic behind the translucent application chrome, while the document remains opaque white; older Windows uses a solid fallback.

The custom renderer shows **tablature for one track/voice at a time**: fret numbers, tuning, barlines, rhythm, dots and existing tuplets. Beams follow meter groups, break at rests and barlines, and include secondary beams and partial hooks through 64th notes. Tuplets share a number, with brackets when a shared beam cannot show the group. Compound meters group in threes; odd eighth-note meters default to pairs ending in three (5/8 = 2+3, 7/8 = 2+2+3). Custom beat groupings and manual beam breaks are not available yet. The `.tg` format stores tuplet ratios per duration without group IDs, so their boundaries are inferred.

The rhythm row uses slash heads, with hollow slashes for half and whole notes; stems, flags, beams, dots and rests retain their duration meanings. Bends draw amounts, pre-bends, holds and releases using compact curves beside the frets. String spacing stays uniform, including on rows with bends and H/P slurs. Slides, H/P slurs and ties connect notes on the same string across bars and wrapped systems; tied destinations use parenthesized frets. These markings follow fret edits and undo. Other techniques and other voices remain in the source, with notices for unsupported engraving.

Repeat starts/ends use dotted barlines, combining adjacent end/start repeats on the same row. Alternate endings support multiple numbers and multi-measure spans, with open continuations at row breaks and a closing hook at a repeat end. TG ending starts carry through unmarked measures until a repeat close, another ending, a new repeat start, or the song end. Wrapped continuations repeat the numbers in parentheses. Symbol margins participate in line wrapping; ending brackets and repeat counts have space above the strings, below chord/text annotations. Counts above two total plays are shown as `×N` (TG stores additional repeats, so a stored 2 means `×3`). Following repeats during playback remains future work.

Use the **Repeats** inspector controls or `[` / `]` / **E** to toggle a repeat start, repeat end or alternate-ending start. These markings apply to the selected measure across all tracks. An end defaults to two total plays; its count accepts 2–101. An ending defaults to pass 1; select any combination of passes 1–8. Inside a continuing ending, the inspector identifies its starting measure. Controls always edit the current measure's markers, and **Clear measure repeats** removes all three in one undo step. Notes, rests, empty string cells and ranges within one measure are supported; ranges across measures are rejected. Repeat-only edits participate in unsaved-change tracking, undo/redo and source-preserving save/reopen.

Select one note to use the **Techniques** controls or the B/S/H/P/T shortcuts while the tab has focus. Bend settings offer bend, bend-and-release, pre-bend and pre-bend-and-release shapes, with amounts from ¼ to 3 tones; **Apply bend** commits the chosen preset. Imported custom curves remain intact until explicitly replaced. Slide/H/P need a following note on the same string, with a different/higher/lower fret respectively. Tie acts on the destination and requires a previous note at the same fret. Rests and timing gaps stop connections. Unavailable controls explain the reason on hover; shortcuts report the same validation. Switching between slide and H/P replaces the outgoing technique in one undo step. **Clear techniques** removes these five supported markings from the selected note in one step. Save/reopen retains other effects and unrelated XML. Playback follows the stored bend points, including quarter-tone amounts, pre-bends, holds and releases. Slides glide during the second half of the source note; H/P destinations have a softer attack with a short overlap. Ties sustain across bars without re-picking, including bend holds and releases on tied notes. These are SoundFont approximations of guitar articulations. Pitch-changing notes use separate MIDI channels so other chord notes stay in tune; playback reports an error if more than 15 independent melodic channels are needed at once. Custom bend curves and a richer articulation model remain future work.

Command IDs, default bindings and key resolution are separate in `shared/tab-commands.ts`. `useTabKeymap()` shares the active bindings with the editor and shortcut hints, supports validated replacements/aliases/unbinding and reset, and reserves note-entry/navigation and native document shortcuts. A preferences screen and persistent shortcut storage are future work.

Remaining work includes further technique engraving, repeat playback, multi-voice layout, playback autoscroll, new songs/measures, cross-bar editing, new tuplet groups, other-format imports and general `.tg` serialization. A dedicated accessibility pass follows the rendering engine. See [`MIGRATION.MD`](MIGRATION.MD).

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
pnpm test:e2e     # build, then run eight hidden Electron suites, including repeat and technique writing
pnpm test:audio   # after sidecar:build: synth/timing checks and published-process protocol tests
```

Tests cover the bundled `china.tg`, note/chord/rest entry, rhythm integrity, history, ties, renderer mapping, archive preservation (including unknown XML, Unicode and different line endings), failed saves, external changes, and edited MIDI scheduling. Electron tests use temporary copies under `.cache/` and save screenshots there. They exercise real rendering, file drops, note/rest interaction, native commands, structural save/reopen, and cancellation/error recovery. When the sidecar binary exists, they also verify that the native audio clock reaches the edited measure and stops, using a silent fixture. Audible fidelity and opening saved files in the legacy Java app remain separate qualification steps.

Audio checks exercise tempo changes at multiple sample rates, actual SoundFont PCM, seek/controller state, load resets, malformed requests, stop/end events, startup failures, and EOF shutdown. The process tests use SDL's dummy driver by default; `TG_AUDIO_TEST_NATIVE=1` selects the real device with silent MIDI. The Electron rhythm test uses the real device. Progress measures frames consumed from SDL's queue; the final hardware buffer adds unmeasured latency. macOS/Linux device playback and listening comparisons against the old synth still need native qualification.

For an unsigned Windows package, run `pnpm exec electron-builder --win --dir --config.win.signAndEditExecutable=false` after `pnpm generate`. Setting `TG_TEST_PACKAGED_APP` to `release/win-unpacked/Tabbycat.exe` when running `node test/e2e/rhythm.mjs` exercises the packaged app's editing, saves and real-device playback. Optional screenshots are captured in the development run because the hidden packaged window can suspend capture.

The tab-engine suite also covers document-wide pointer input, whole-column selection within and across rows, partial fret overlaps, shrinking ranges, modifier-independent pointer selection, Delete/undo, keyboard Shift/Alt shortcuts, stable identities, source-preserving column copies, wrapped/continuous layouts and a 500-measure fixture. Unit tests retain coverage for gapped deletion and edit guards. Only nearby systems mount in the wrapped SVG. Local input-to-DOM timing observations are written to `performance.json`; they exclude display/paint latency because hidden Electron windows throttle animation frames. They are observations rather than hardware-independent performance guarantees.

The engraving suite generates a nine-measure `Rhythm and techniques.tg` study under its `.cache/engraving-e2e-*` directory. It checks beam groups, H/P changes after fret edits, undo, wrapped connections, bend spacing, scaled pointer input, tuplets, narrow/continuous layouts, comparison switching and technique-preserving save/reopen, with screenshots for visual review. The study can also be opened or dropped into the app.

The repeat suite creates `Repeats and endings.tg` under `.cache/repeats-e2e-*`, covering implicit ending spans, multiple ending numbers, combined repeat barlines, counts, reserved layout space, wrapped/continuous/narrow views, scaled note hits, and source-preserving save/reopen. Unit tests also use the legacy `altRepeatLoop_20.tg` fixture to verify TG ending and count semantics.

The repeat-writing suite starts with unmarked headers, then writes repeats, total-play counts and multiple ending numbers through buttons and native key events. It checks header-only dirty state, saved-state undo/redo, inherited ending hints, held-key/input-focus guards, range validation, save/reopen, removal, comparison shortcuts and narrow controls. Unit tests cover configurable bindings, global headers across tracks, malformed commands and preservation of unknown header XML and archive entries.

The technique-writing suite starts with a plain version of that score, authors markings through buttons and native key events, adjusts bend presets, and verifies undo/redo, save/reopen, removal, held-key suppression and inspector-input focus. Unit tests also cover invalid connections/payloads, tie playback, custom curve metadata and keymap overrides/conflicts.

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

## TGX documents and AI context

**TGX v2** (`.tgx`, JSON) stores the complete song model and per-track tab designs. Imported TG archive data is retained for source preservation. It replaces the earlier v1 AI projection; reconvert original files with `pnpm ai:tgx`. The converter's AI prompt includes musical JSON without the archive payload. See [`docs/tgx-format.md`](docs/tgx-format.md) for the current format and [`docs/ai-features.md`](docs/ai-features.md) for future AI workflows.

## Acknowledgements & licensing

Tabbycat is a derivative of **TuxGuitar**, © 2005–2022 Julián Casadesús and 2023–2025 contributors, released under the **GNU LGPL**. The legacy Java sources under `tuxguitar-java/` retain that license.

Third-party components:

- **alphaTab** — notation rendering — MPL-2.0
- **GeneralUser GS** — SoundFont (downloaded at build time, not redistributed here) — see its own license
- **MeltySynth** — C# SoundFont synthesis — MIT
- **SDL2** (native binaries from Ultz.Native.SDL) — audio output — zlib
- **Electron**, **Nuxt**, **Vue**, **Tailwind CSS**

> A top-level `LICENSE` for the rewritten (non-legacy) code has not been added yet — TODO. Given the LGPL legacy base, the project license must be chosen with that in mind.
