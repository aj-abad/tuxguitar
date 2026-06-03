# TuxGuitar → Electron Migration Plan

> **Status:** Living plan — partially implemented. Core architecture decisions resolved 2026-06-03; **revised 2026-06-03** to match implemented state (see [§0 Current status](#0-current-status-2026-06-03) and [§14 Changelog](#14-changelog)).
> **Product:** **Tabbycat** — a rewrite of the TuxGuitar desktop app onto **Electron + Nuxt 4 (Vue 3) + TypeScript**, replacing the Java/SWT/Cocoa UI.
> **Audio:** a native **Rust sidecar** (`cpal` + `oxisynth`) — this *replaces* TuxGuitar's Java/Gervill sound engine (an evolution of the original "keep Java in a GraalVM sidecar" decision; see [D2](#d2--audio-native-rust-sidecar-)).
> **Primary platform:** macOS (this fork). Windows/Linux deferred — see [Non-goals](#non-goals).

---

## 0. Current status (2026-06-03)

What exists in the tree today. Legend: ✅ done · 🚧 in progress · ⬜ not started.

| Area | State | Notes |
|---|---|---|
| Electron + Nuxt 4 SPA skeleton | ✅ | `electron/` (main, preload, sidecar mgr) + `app/` (Nuxt renderer). `ssr:false`. |
| Security model | ✅ | `contextIsolation`+`sandbox`+`nodeIntegration:false`; typed `window.tg` preload bridge (`shared/ipc.ts`). |
| `app://` bundle protocol + CSP | ✅ | Prod served from `.output/public` via custom protocol; `build`→`nuxt generate`. |
| Native `.tg` **read** in TS | ✅ | `shared/tg-reader.ts` (`parseTgFile`). One golden test (`china.tg`). |
| Song model in TS | ✅ | `shared/model.ts` — `TGSong → … → TGNote`, precise-tick constants. |
| Score/tab rendering | 🚧 | `ScoreViewer.vue` renders via alphaTab (`tgSongToScore`). `.tg` only; layout MVP. |
| **Rust audio sidecar** | ✅ | `sidecar/` — cpal + oxisynth; stdio JSON-RPC; `synth.load/play/stop/seek`; emits `ready`/`tick`/`playbackEnded`. |
| MIDI generation | ✅ | `shared/midi-export.ts` (TS) — model → MIDI events sent to the sidecar. |
| Playback + cursor sync (Spike 0a) | ✅ | Sidecar tick events → `usePlayback()` raf interpolation. In-process `PlaybackClock` fallback when sidecar absent. |
| Transport | 🚧 | play / stop / seek only. No pause, loop, count-in, metronome, per-track mute/solo. |
| Other-format import (GP*/GPX/PTB/TEF/MXML/MIDI) | ⬜ | In the Open dialog filter but return `null`. |
| Native `.tg` **write** | ⬜ | No writer yet. |
| Editing / command bus / undo | ⬜ | — |
| Exporters | ⬜ | — |
| **TGX text format + AI** (new workstream) | 🚧 | Format spec + `.tg`→`.tgx` converter exist; AI features designed, not wired. See [§13](#13-tgx-text-format--ai-new-workstream). |
| Packaging | 🚧 | `electron-builder` `.dmg`, hardened runtime configured; smoke test (`TG_SMOKE`). Signing/notarization unverified. |
| Golden corpus harness | 🚧 | Single `.tg` fixture; full multi-format corpus from the Java build not captured yet. |
| Legacy Java | ✅ relocated | Moved to `tuxguitar-java/`; reference only, not built by the Node toolchain. |

**Net:** a usable **open-`.tg` → render → play** vertical slice is working end-to-end. Editing, writing, and the format long tail remain.

---

## 1. TL;DR

This is a large undertaking: the legacy base is **~183K LOC of Java across 1,761 files and 39 Maven modules**, including a 29K-LOC software synthesizer (Gervill) and a suite of hand-tuned binary file-format codecs encoding years of reverse-engineered edge cases. Existing **Java test coverage is thin (~14 test classes)** — there is no safety net proving a rewrite preserves behavior.

**Approach: rewrite the UI to web, drive audio from a small native synth sidecar, and port the model/codecs to TypeScript incrementally — shipping something runnable early.**

1. **Rewrite the UI** as an Electron app with a **Nuxt 4 / Vue 3** renderer (SPA mode). Delete the SWT/Cocoa stack. ✅
2. **Render tab/score on alphaTab.** alphaTab ([MPL-2.0, free](https://alphatab.net)) provides notation rendering, music fonts/glyphs, and Guitar Pro import. ✅ (currently via alphaTab's high-level `Score` model — see [D1](#d1--rendering-on-alphatab-)).
3. **Audio via a native Rust sidecar.** A standalone Rust binary (`cpal` + `oxisynth`) loads a SoundFont, synthesizes MIDI events generated in TS, outputs PCM itself, and streams tick/position events back for cursor sync. ✅
4. **Port the model, editing, native `.tg` format, and exporters to TypeScript** incrementally, validated by **golden-file round-trip tests**. 🚧 (`.tg` read + model done; write/editing/exporters pending.)

**Consequence of the Rust synth:** the sidecar is **load-bearing and permanent** for audio — but it is *audio-only*. It does **not** read codecs and contains **no JVM**. The original plan kept TuxGuitar's Java engine (Gervill) behind a GraalVM sidecar and used that same sidecar as a transitional codec reader; both of those ideas were dropped in favor of a self-contained Rust synth plus TS/alphaTab codecs (see [§14](#14-changelog)).

**Rough order of magnitude:** multi-engineer effort, ~12–18 months to *full* parity (171 commands × 157 dialogs is the long tail). The read/play slice landed early; a v1 feature subset will be chosen later (parity remains the eventual bar).

---

## 2. Why migrate

- **Toolkit risk.** The legacy UI is bound to Eclipse SWT for Cocoa, not on Maven Central (hand-installed per build docs), tracking Eclipse's cadence, plus a JNI AudioUnit bridge built with Xcode CLI tools.
- **Distribution friction.** Shipping/signing/notarizing a JVM `.app` is heavier than the Electron path (`electron-builder` handles signing/notarization/auto-update).
- **Developer pool & ecosystem.** Web/TS/Vue talent and tooling (HMR, devtools, component libs, canvas/audio libs) vastly outnumber SWT/Cocoa-Java.
- **UI velocity.** Declarative Vue + CSS iterates faster than SWT widgets behind a custom toolkit abstraction.

### Non-goals

- **Cross-platform expansion.** macOS only for now. Electron *enables* Windows/Linux cheaply, but we won't invest in, test, or support them during this migration. (Revisit later — explicitly deferred, not refused.)
- **Format / feature additions** beyond the new TGX format. Preserve the existing matrix and behavior. Parity first.

---

## 3. Legacy architecture inventory

Grounded in the actual legacy tree, now relocated under **`tuxguitar-java/`** (`common/` = platform-independent, `desktop/` = app + SWT/Cocoa).

| Subsystem | Where (under `tuxguitar-java/`) | ~LOC | Disposition |
|---|---|---|---|
| **Song model** (`TGSong→Track→Measure→Voice→Beat→Note`) | `common/TuxGuitar-lib/.../song/models` | part of 32K | **Ported to TS** (`shared/model.ts`). Editing source of truth. |
| **Tab layout / render logic** (`graphics/control`, `TG*Painter`) | `common/TuxGuitar-lib` | part of 32K | **Replaced** by alphaTab rendering. Painters are a layout reference only. |
| **GP3/4/5 codec** | `common/TuxGuitar-gtp` | 6.3K | Read via alphaTab import; **TS port later** if needed, golden-gated. |
| **GPX (GP6) codec** | `common/TuxGuitar-gpx` | 3.3K | Same as above. |
| **PowerTab (.ptb)** | `common/TuxGuitar-ptb` | 2.5K | **TS port later**; alphaTab where supported. |
| **TablEdit (.tef)** | `desktop/TuxGuitar-tef` | 6.3K | **TS port later**. |
| **MIDI read/write** | `common/TuxGuitar-midi` | 1.9K | **Port to TS** (well-specified). MIDI *generation* for playback already in TS (`shared/midi-export.ts`). |
| **MusicXML / LilyPond / ASCII / PDF / SVG writers** | `common/` + `desktop/` | ~6K | **Port to TS** incrementally. |
| **Native `.tg` format** (`TGStream`) | `common/TuxGuitar-lib` | part of 32K | **Crown jewel.** Reader **ported** (`tg-reader.ts`); writer pending; round-trip golden-gated. Never depends on the sidecar. |
| **Gervill software synth** | `desktop/gervill` | 29K | **Dropped.** Replaced by `oxisynth` (Rust SF2 synth) in the sidecar. |
| **Synth plumbing / player / sequencer** | `desktop/TuxGuitar-synth`, `player/*` | ~3K+ | **Dropped.** MIDI event generation is TS; scheduling + synth are the Rust sidecar. |
| **macOS AudioUnit MIDI bridge (JNI)** | `desktop/TuxGuitar-AudioUnit` | 8 native files | **Dropped.** The Rust synth outputs PCM via cpal; native MIDI out not required. |
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
- **Two song models in play.** TuxGuitar's model (TS, editing source of truth) vs. alphaTab's model (rendering). Currently bridged by an adapter (`tgSongToScore`) — see [D1](#d1--rendering-on-alphatab-).

---

## 4. Target architecture (Electron + Nuxt 4 + Rust sidecar)

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
│ Renderer  (Chromium + Nuxt 4 / Vue 3) │  │ Rust audio sidecar              │
│  SPA mode (ssr:false)                  │  │ (cpal + oxisynth)               │
│                                        │  │                                 │
│  • App shell: toolbar, transport,      │  │  • Loads SoundFont (SF2)        │
│    track strip, dialogs (TODO)         │  │  • Synthesizes scheduled MIDI   │
│  • Song model + managers (TS) (TODO    │  │    events → PCM out (Core Audio │
│    edit/undo)                          │  │    via cpal)                    │
│  • alphaTab renderer → <canvas>        │◀─┤  • Emits tick/position events   │
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
| Score/tab render + GP import | **alphaTab** (vendored, `packages/alphatab`) | ✅ rendering; GP import not wired yet. |
| Audio | **Rust sidecar — cpal + oxisynth** | ✅ Replaces Gervill/Java. |
| Sidecar runtime | **Native Rust binary (cargo)** | ✅ No JVM, no GraalVM. |
| Build | **Vite** (via Nuxt) + `nuxt-electron` | ✅ |
| Packaging | **electron-builder** | 🚧 `.dmg` + hardened runtime; notarization unverified. |
| Tests | **Vitest** (+ Playwright later) | 🚧 golden harness for `.tg`. |

---

## 5. Strategic decisions

### D1 — Rendering on alphaTab ✅

- We render tab/score with **alphaTab**. **Model boundary (resolved in practice to option b):** the TS port of TuxGuitar's model is the **editing source of truth**, and `tgSongToScore()` (`shared/tg-to-alphatab.ts`) **projects it onto alphaTab's `Score` model** for rendering (two models, one adapter). alphaTab's own player/cursor are disabled (`enablePlayer:false`) — it is a *renderer only*.
- Option (a) — drawing directly from the TG model via alphaTab's low-level primitives (one model, no adapter) — remains a possible future move if the adapter drifts or limits editing feedback.
- **License:** alphaTab is MPL-2.0 (weak, file-level copyleft). Using its public APIs is fine. alphaTab is **vendored as source** under `packages/alphatab` (pinned); if we modify its files, those files stay MPL — isolate and publish such changes. Prefer extension over modification.

### D2 — Audio: native Rust sidecar ✅

- Audio runs in a standalone **Rust** binary (`sidecar/`): **`oxisynth`** (SoundFont2 software synth) + **`cpal`** (Core Audio output). The renderer/main render the song to a MIDI event stream **in TS** (`shared/midi-export.ts`) and send it via `synth.load`; the sidecar schedules events to audio frames at the device sample rate, **outputs PCM itself**, and **streams `tick {qtick,bpm}` events** (~20 Hz) for cursor follow.
- **What changed from the original plan:** Gervill and the Java player/sequencer are **dropped**, not kept; there is **no GraalVM native-image** and **no JVM** in the sidecar. The bundled SoundFont is **GeneralUser GS** (downloaded at build time), not TuxGuitar's Magic Sound Font.
- **AudioUnit JNI bridge:** dropped (PCM out via cpal; native MIDI out not needed).
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
- ✅ Native **Rust sidecar** exposing `synth.load/play/stop/seek` + `ready`/`tick`/`playbackEnded`. (Originally specified as a GraalVM native-image of the Java core — superseded by D2.)
- 🚧 **Golden-file harness** — only one `.tg` fixture so far; the full multi-format corpus from the Java build is not captured yet.
- ✅ **Spike 0a — audio-sync de-risking.** The sidecar owns Core Audio output; the renderer owns the cursor. Implemented: sidecar emits high-res tick events; `usePlayback()` interpolates between them with `requestAnimationFrame`. Perceived offset is acceptable on the sample; a constant offset can be calibrated out. (No-go fallbacks from the original plan unused.)
- 🚧 **Exit:** app launches on macOS ✅; sidecar plays a `.tg` ✅; Spike 0a met ✅; **remaining:** full golden harness, CI, signing/notarization verification.

### Phase 1 — Read-only viewer  🚧
- ✅ alphaTab renderer renders an open `.tg` (score + tab) to canvas.
- ⬜ Open GP3–7 / MusicXML / MIDI (dialog filters present; parsing returns `null`). ⬜ Track table, richer navigation/scroll.
- **Exit:** open GP3–7, MusicXML, MIDI, `.tg` and render faithfully vs. golden screenshots.

### Phase 2 — Playback (Rust sidecar)  🚧
- ✅ play / stop / seek with **cursor follow** driven by sidecar tick events.
- ⬜ pause, count-in, loop, per-track mute/solo/volume, metronome.
- **Exit:** transport complete; timing/mix matches the Java app on the corpus (within tolerance).

### Phase 3 — Native `.tg` read/write in TS  🚧
- ✅ `TGStream` **reader** ported (`tg-reader.ts`).
- ⬜ `TGStream` **writer**; remove any remaining gaps.
- **Exit:** byte/canonical-model round-trip golden tests pass for the full `.tg` corpus incl. legacy versions.

### Phase 4 — Editing core  ⬜
- Port the edit managers (`TGSongManager`/`TrackManager`/`MeasureManager`), the **command bus** (string IDs preserved), and **undo/redo**. Highest-traffic commands first.
- **Exit:** create → edit → save `.tg` → reopen is lossless; top ~40 commands done.

### Phase 5 — Writers / exporters  ⬜
- MIDI write, MusicXML write, ASCII, LilyPond, PDF (Chromium print-to-PDF or a TS lib), SVG/PNG. Audio export = offline render via the sidecar.
- **Exit:** each exporter matches golden fixtures; GP *write* decided (port vs. document as unsupported).

### Phase 6 — Dialog & command long tail  ⬜
- ~157 dialogs + remaining commands; i18n strings; menus/keybindings from preserved action IDs; replace 28 SPI plugins with a TS module registry.
- **Exit:** parity checklist (171 commands / 157 dialogs) accounted for; v1 subset shippable.

### Phase 7 — Harden & ship  ⬜  (reframed)
- The original Phase 7 was "shrink the sidecar / retire the JVM" — **already true**: the sidecar has been Rust (audio-only) from the start, so there is no JVM to retire and no codec role to remove.
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
6. **E2E (Playwright + Electron).** Open → edit → save → reopen, transport, a sampling of dialogs.

---

## 9. Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Binary codec fidelity (GP/GPX/PTB/TEF) | High | alphaTab reads first; differential + golden tests on a large corpus before trusting any TS port. |
| Thin existing tests | High | Capture the golden corpus from `tuxguitar-java/` before porting each codec. |
| **Audio sync across the process boundary** | High→Med | **Spike 0a implemented** (tick events + renderer interpolation; audio stays in the sidecar, no raw PCM over IPC). Watch jitter under load / long playback. |
| **alphaTab adapter drift** (TG model vs. alphaTab `Score`) | Medium | One explicit adapter (`tgSongToScore`), golden-tested; fall back to D1(a) low-level drawing if it limits editing. |
| `oxisynth` fidelity / SoundFont quality vs. Gervill | Medium | GeneralUser GS is broad-coverage; A/B against the Java mix; web-synth swap remains a fallback. |
| Nuxt-in-Electron (unused SSR, routing/CSP, `generate`-only) | Medium | `ssr:false` + `nuxt generate` + `app://` + `nuxt-electron`; `build`→`generate` enforced. |
| Shipping the native sidecar (build, soundfont size, startup) | Medium | Small Rust binary; supervise/restart from main; app degrades gracefully to silent when absent. |
| Long-tail scope (171 cmds / 157 dialogs) | Medium | Explicit parity checklist; prioritize by usage; conscious drops with sign-off. |
| macOS signing/notarization | Low–Med | Validate early (Phase 0 packaging), not at the end. |

---

## 10. What gets deleted vs. kept

**Replaced by the web UI / Rust sidecar** (retained under `tuxguitar-java/` as reference, deleted from the product):
- `desktop/TuxGuitar-ui-toolkit-swt` + the `ui-toolkit` abstraction; `TuxGuitar-cocoa-integration-swt`, `TuxGuitar-tray-swt`, `TuxGuitar-image-swt`, `TuxGuitar-awt-graphics`
- The Maven reactor, the SWT-install step, and the `build-scripts/tuxguitar-macosx-swt-cocoa` assembly
- `desktop/gervill`, `TuxGuitar-synth*`, the player/sequencer — **dropped** (Rust `oxisynth` replaces them)
- `desktop/TuxGuitar-AudioUnit` + native bridge — **dropped**

**Kept as reference (port from, don't ship):**
- The Java `common/` codecs and `.tg`/`TGStream` logic — the reference implementations, ported to TS per-format and golden-gated.

The Java *core* remains the reference implementation throughout; the renderer/editor/model/`.tg`/exporters move to TS, and audio is a self-contained Rust synth.

---

## 11. Build skeleton (as built)

- `electron/` — main + preload (TS), IPC contract (`shared/ipc.ts`), `SidecarManager`
- `app/` — Nuxt 4 renderer (SPA): components, composables (`useSong`, `usePlayback`), alphaTab `ScoreViewer`
- `shared/` — `model.ts`, `tg-reader.ts`, `midi-export.ts`, `tg-to-alphatab.ts`, `ipc.ts`
- `sidecar/` — Rust audio sidecar (cpal + oxisynth); `build.sh` fetches the SoundFont + `cargo build --release`
- `packages/alphatab/` — vendored alphaTab source
- `test/golden/` — Vitest fixtures + harness (currently `.tg`)
- `docs/` — `tgx-format.md`, `ai-features.md`
- `electron-builder.yml` — macOS `.dmg`, hardened runtime
- `tuxguitar-java/` — relocated legacy reference

---

## 12. Decisions resolved (2026-06-03)

| # | Question | Decision |
|---|---|---|
| 1 | alphaTab adoption | **Render on alphaTab** via a TG-model→`Score` adapter (D1b); custom low-level drawing (D1a) deferred. |
| 2 | Sidecar runtime | **Native Rust binary** (cargo). *(Was: GraalVM native-image of the Java core — superseded.)* |
| 3 | UI framework | **Nuxt 4** (Vue 3, SPA). `useState` + Tailwind today; Pinia/component-lib/i18n deferred. |
| 4 | Parity bar | **Full parity is the eventual goal.** v1 subset chosen later. |
| 5 | v1 scope | Deferred — see #4. |
| 6 | Audio engine | **Rust `oxisynth` + `cpal`.** Gervill/Java player **dropped**. *(Was: keep Gervill in the sidecar — superseded.)* |
| 7 | Codec sidecar | **None.** `.tg` in TS; other formats via alphaTab / TS ports. *(Was: transitional Java codec reads — superseded.)* |
| 8 | Native text format + AI | **TGX (`.tgx`, JSON) added** as a native text format and AI context substrate — see [§13](#13-tgx-text-format--ai-new-workstream). |
| 9 | Product name | **Tabbycat.** |
| 10 | Cross-platform | **macOS only for now**; revisit later. |

### Still open
- **D1 model boundary:** stay on the alphaTab `Score` adapter (b) vs. move to low-level primitives (a).
- **GP write:** port a writer vs. document as unsupported (Phase 5).
- **State lib:** adopt Pinia or stay on `useState` as the store layer grows.
- **v1 feature subset:** which of the 171 commands / 157 dialogs ship first.
- **`tuxguitar-java/` deletion:** when (or whether) to drop the reference tree.

---

## 13. TGX text format + AI (new workstream)

Not in the original plan; added during the rewrite. See `docs/tgx-format.md` and `docs/ai-features.md`.

- **TGX (`.tgx`)** is a JSON text twin of the song model — **lossless** for guitar-specific data, **token-efficient**, **git-diffable**, and human-readable. A slice of measures doubles as the editable model and as AI prompt context.
- **AI features (designed, not wired):** autofill/continuation, section transformation ("make this heavier"), variation/harmonization, context-aware suggestion. Model: **Claude** (`claude-opus-4-8` for generation, `claude-sonnet-4-6` for fast edits) in tool-use mode, wrapped in a **deterministic TS pre/post-process scaffold** (pitch/scale/genre/hand-position analysis in; playability/validity checks out).
- **Tooling today:** `scripts/ai/tg-to-tgx.ts` converts `.tg`→`.tgx` (`pnpm ai:tgx [input.tg] [nBars]`, defaults `china.tg 2`).
- **Open:** whether `.tgx` becomes a co-equal save format alongside `.tg`, or stays an interchange/AI-context format.

---

## 14. Changelog

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
