# Tabbycat

A macOS guitar-tablature editor and player — an **Electron + Nuxt 4 (Vue 3) rewrite of [TuxGuitar](https://github.com/helge17/tuxguitar)**.

- **UI** — Nuxt 4 / Vue 3 single-page app running in Electron.
- **Notation** — tab/score rendering built on [alphaTab](https://alphatab.net) (MPL-2.0).
- **Audio** — a standalone **Rust sidecar** (`cpal` + `oxisynth`) synthesizes a SoundFont and streams playback-position events back for cursor sync.
- **Platform** — macOS only. (Electron makes Windows/Linux cheap later, but they are not a goal right now.)

The original Java/SWT TuxGuitar is preserved under [`tuxguitar-java/`](tuxguitar-java/) as the reference implementation the rewrite ports from. The overall plan lives in [`MIGRATION.MD`](MIGRATION.MD).

## Status

Early and incomplete — version `0.0.1`. Today the app:

- opens the native **`.tg`** format (parsed in TypeScript) and renders the score/tab,
- plays it back through the Rust sidecar with a synced cursor and progress bar.

Not yet implemented: editing, saving, and importing the other formats (GP3/4/5, GPX, PTB, TEF, MusicXML, MIDI) — these appear in the Open dialog but don't parse yet. See [`MIGRATION.MD`](MIGRATION.MD) for the phase plan.

## Requirements

- macOS
- [Node.js](https://nodejs.org) ≥ 18 and [pnpm](https://pnpm.io)
- For audio only: [Rust](https://rustup.rs) (`cargo`)

## Getting started

```sh
pnpm install
pnpm dev          # launches Electron + the Nuxt dev server with HMR
```

The app runs without audio out of the box. To enable playback, build the sidecar once:

```sh
pnpm sidecar:build   # downloads the GeneralUser GS SoundFont (~32 MB) and compiles the Rust binary
```

This produces `sidecar/bin/tuxguitar-sidecar` and `sidecar/bin/GeneralUser.sf2` (both git-ignored). Restart the app; the status bar should read `sidecar: ready`.

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
```

Golden tests parse the bundled `china.tg` sample. More fixtures will be captured from the legacy Java build as codecs are ported (see [`MIGRATION.MD` §8](MIGRATION.MD)).

## Project layout

| Path | What |
|---|---|
| `app/` | Nuxt renderer — Vue components, composables, app shell |
| `electron/` | Main process, typed preload bridge, sidecar supervisor |
| `shared/` | Song model + `.tg` reader + MIDI/alphaTab exporters + IPC types (shared across processes) |
| `sidecar/` | Rust audio sidecar (cpal + oxisynth) |
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
- **oxisynth**, **cpal** — Rust audio — MIT/Apache-2.0
- **Electron**, **Nuxt**, **Vue**, **Tailwind CSS**

> A top-level `LICENSE` for the rewritten (non-legacy) code has not been added yet — TODO. Given the LGPL legacy base, the project license must be chosen with that in mind.
