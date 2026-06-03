# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Tabbycat** is a macOS guitar-tablature editor and player — an **Electron + Nuxt 4 (Vue 3) + TypeScript rewrite of TuxGuitar**. The renderer is a Nuxt SPA; tab/score rendering is built on **alphaTab**; audio playback runs in a separate **Rust sidecar** (cpal + oxisynth) driven over stdio JSON-RPC. macOS only.

The original Java/SWT TuxGuitar lives under `tuxguitar-java/` as the **reference implementation** — it is not part of the Node build. See [Legacy Java tree](#legacy-java-tree).

> **`MIGRATION.MD`** is the original migration plan and remains useful for intent and phasing, but some decisions have since changed in code. Most notably the audio engine is now a **Rust** sidecar (cpal + oxisynth), *not* the Java/Gervill engine behind a GraalVM `native-image` that the plan describes. Where the plan and the code disagree, the code wins.

## Build & run

pnpm + Node ≥18, on macOS.

```sh
pnpm install            # postinstall runs `nuxt prepare`
pnpm dev                # Nuxt dev server + Electron, with HMR (dev port 4399)
pnpm generate           # static SPA build → .output/public   (alias: `pnpm build`)
pnpm preview            # generate + run Electron against the build
pnpm dist               # generate + electron-builder → release/*.dmg
pnpm smoke              # generate + headless launch-and-exit boot check (TG_SMOKE=1)
```

- `pnpm dev` chains `scripts/dev-guard.mjs` (single-instance dev gate; also forces `TMPDIR=/tmp` to dodge the macOS 104-char Unix-socket limit that blanks the window) → `gen-icons` → `nuxt dev`. `nuxt-electron` compiles `electron/main.ts` + `electron/preload.ts` and launches Electron against the Vite dev server.
- **Nuxt-in-Electron constraint:** production is served from a custom `app://bundle` protocol and **must be built with `nuxt generate`** (static SPA), not `nuxt build` — this is why `build` is aliased to `generate`. `main.ts` serves `.output/public` over `app://` with a CSP.

### Audio sidecar

Playback needs the Rust sidecar binary, which is **not** committed:

```sh
pnpm sidecar:build      # downloads GeneralUser GS SF2 (~32 MB) + `cargo build --release`
```

Outputs `sidecar/bin/tuxguitar-sidecar` and `sidecar/bin/GeneralUser.sf2` (both gitignored). Needs `cargo`/rustup. **If the binary is absent the app still launches and renders** — sidecar status reports `not-found` and playback is silent.

## Tests

Vitest, files under `test/**/*.test.ts`.

```sh
pnpm test               # vitest run
pnpm test:watch
```

Current coverage: `test/golden/tg-reader.test.ts` parses `china.tg` (the repo-root sample song, also the default `ai:tgx` input). Fixtures resolve relative to repo root — **keep `china.tg` at the root**.

## Layout

- `app/` — Nuxt 4 renderer (SPA, `ssr:false`): `app.vue`, `components/`, `composables/`, `assets/css`, `types/electron.d.ts` (types `window.tg`).
- `electron/` — main process (`main.ts`), typed preload (`preload.ts`), sidecar supervisor (`sidecar.ts`), `resources/` (`.icns`).
- `shared/` — TypeScript shared across main / renderer / sidecar-facing code:
  - `model.ts` — the song model (TS port of TuxGuitar's `TGSong → … → TGNote`).
  - `tg-reader.ts` — native `.tg` binary parser.
  - `midi-export.ts` — model → MIDI event stream for the sidecar.
  - `tg-to-alphatab.ts` — model → alphaTab `Score` for rendering.
  - `ipc.ts` — `IpcChannels` names + `TgBridge` / `TickEvent` / `SidecarStatus` types.
- `sidecar/` — Rust audio sidecar: `src/main.rs` (JSON-RPC loop + scheduling), `src/audio.rs` (cpal + oxisynth, tick↔frame math), `src/protocol.rs` (wire types), `build.sh`, `bin/`.
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
3. **Sidecar** (`sidecar/`, Rust) — audio synthesis, output, and the playback clock.

**Preload bridge (`window.tg`).** `electron/preload.ts` exposes one typed object via `contextBridge` — `TgBridge` in `shared/ipc.ts`: `openFileDialog`, `getSidecarStatus`, `play`/`stop`/`seek`, and `onTick`/`onPlaybackEnded`/`onMenuTriggerOpen` listeners (each returns an unsubscribe fn). All channel strings live in `IpcChannels`. **To add an IPC capability:** add the channel in `ipc.ts`, an `ipcMain.handle` in `main.ts`, and a bridge method in `preload.ts` (and the `TgBridge` type).

**Song model (`shared/model.ts`).** TS port of TuxGuitar's `TGSong → TGTrack → TGMeasure → TGBeat → TGVoice → TGNote` tree (with shared `TGMeasureHeader`s). Timing uses TuxGuitar's "precise" units: `WHOLE_PRECISE_DURATION = 11531520`, first beat at `PRECISE_STARTING_POINT`, quarter-ticks scaled by `PRECISE_FACTOR`. **Keep these constants and field names identical to the Java reference** — `.tg` files on disk and the sidecar both depend on them.

**File-open path.** Native dialog → `main.ts` reads the file → **only `.tg` is parsed today** (TS `parseTgFile`); the other extensions in the dialog filter (gp3/4/5, gpx, ptb, tef, mxml, mid…) currently return `null`. The resulting `TGSong` is returned to the renderer over IPC, and `exportMidi(song)` is pushed to the sidecar. `useSong()` holds the open song in Nuxt `useState`.

**Rendering (alphaTab).** `app/components/ScoreViewer.vue` creates an `AlphaTabApi` and renders the `Score` produced by `tgSongToScore()` (`shared/tg-to-alphatab.ts`), which projects the TG model onto alphaTab's model. **alphaTab's own player/cursor are disabled** (`enablePlayer:false`) — it is a renderer only; audio and cursor come from the sidecar path below. The SMuFL font loads from `public/font/Leipzig.otf`.

**Playback & cursor sync.** The sidecar loads the MIDI schedule, synthesizes through oxisynth, outputs via cpal, and emits `tick {qtick, bpm}` events (~20 Hz, from a 50 ms reporter thread) plus `playbackEnded`. `SidecarManager` (`electron/sidecar.ts`) speaks **newline-delimited JSON-RPC over the child's stdio**. `main.ts` converts `qtick` → precise ticks and forwards to the renderer; `usePlayback()` interpolates between ticks with `requestAnimationFrame` for a smooth cursor / progress bar. When the sidecar isn't `ready`, `main.ts`'s in-process `PlaybackClock` emits one tick/beat as a fallback (Spike 0a scaffolding — replace when the sidecar is the only clock).

**Sidecar protocol (`sidecar/src/protocol.rs`).** stdin requests `{id, method, params}`; stdout `{id, result}` / `{id, error}` / `{event, …}`. Methods: `synth.load {events, tpq}` (schedules MIDI events to audio frames at the device sample rate; tempo segments handle tick↔frame), `synth.play {from_tick}`, `synth.stop`, `synth.seek {tick}`. Events: `ready`, `tick`, `playbackEnded`. Soundfont path is argv[1] (defaults to a `.sf2` next to the binary).

**TGX + AI (planned / in progress).** `.tgx` is a JSON text twin of the model — lossless, token-efficient, git-diffable — designed to be sliced and handed to Claude as context. `scripts/ai/tg-to-tgx.ts` converts `.tg`→`.tgx` (`pnpm ai:tgx [input.tg] [nBars]`, defaults `china.tg 2`). AI edits run a deterministic TS pre/post-process scaffold around the model call. See `docs/tgx-format.md` and `docs/ai-features.md`.

## Conventions

- TypeScript across the Node/web side; Vue 3 `<script setup>` + Composition API; **Tailwind v4** for styling. Shared reactive state is keyed Nuxt `useState(key, …)` singletons, not Pinia (yet — the migration plan names Pinia as a later step).
- Keep model field names and timing constants aligned with the Java reference in `tuxguitar-java/` — they define `.tg` on-disk semantics. Port codecs/managers *out* of the legacy tree into `shared/`; don't wire the running app to it.
- The window is frameless (`titleBarStyle:"hidden"` + vibrancy); the chrome is drawn by `components/Global/TitleBar.vue`.

## Legacy Java tree

`tuxguitar-java/` is the original multitrack TuxGuitar (Java, SWT/Cocoa, Maven multi-module; `groupId app.tuxguitar`, package root `app.tuxguitar`, classes prefixed `TG`). It is the **source of truth** for the rewrite: `.tg` format semantics, the song model, the file-format codecs (gp3/4/5, gpx, ptb, tef, musicxml, midi, lilypond, ascii, pdf), and the Gervill synth. `common/` is platform-independent (model + IO + codecs); `desktop/` is the app + SWT/Cocoa UI.

It is **not** built by the Node toolchain and has **no npm scripts**. Building it directly is a Maven job (JDK 17+, Maven 3.3+, a hand-installed Eclipse SWT for cocoa/macosx) under `tuxguitar-java/desktop/build-scripts/tuxguitar-macosx-swt-cocoa` — see `MIGRATION.MD §3` for the inventory. Treat it as a reference to read and port from, not a dependency.
