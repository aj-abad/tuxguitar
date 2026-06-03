# TuxGuitar → Electron Migration Plan

> **Status:** Proposal / high-level plan. Core architecture decisions resolved 2026-06-03 (see [§12](#12-decisions-resolved-2026-06-03)).
> **Target:** A rewrite of the TuxGuitar desktop app onto **Electron + Nuxt 4 (Vue 3) + TypeScript**, replacing the Java/SWT/Cocoa UI, with TuxGuitar's existing Java sound engine retained behind a native sidecar.
> **Primary platform:** macOS (this fork). Windows/Linux deferred — see [Non-goals](#non-goals).

---

## 1. TL;DR

This is a large undertaking: **~183K LOC of Java across 1,761 files and 39 Maven modules**, including a 29K-LOC software synthesizer (Gervill) and a suite of hand-tuned binary file-format codecs encoding years of reverse-engineered edge cases. Existing **test coverage is thin (~14 test classes)** — there is no safety net proving a rewrite preserves behavior.

**Approach: rewrite the UI to web, keep the proven Java engine behind a sidecar, and port the rest incrementally — shipping something runnable early.**

1. **Rewrite the UI** as an Electron app with a **Nuxt 4 / Vue 3** renderer (SPA mode). Delete the SWT/Cocoa stack.
2. **Build a custom tab rendering engine on top of alphaTab.** alphaTab ([MPL-2.0, free](https://alphatab.net)) provides the music-notation rendering primitives, music fonts/glyphs, and Guitar Pro import — we build our own renderer and editor interaction layer on those foundations rather than adopting it wholesale.
3. **Keep TuxGuitar's native sound engine for now**, running the existing Java player + Gervill synth headless in a **native sidecar** (GraalVM `native-image`). The renderer drives transport over IPC and gets playback-position events back for cursor sync. The same sidecar doubles as a fallback for binary codec *reads* until their TS ports are trusted.
4. **Port the model, editing, native `.tg` format, and exporters to TypeScript** incrementally, validated by **golden-file round-trip tests** captured from the current Java build before porting starts.

**Consequence of keeping the Java sound engine:** the native sidecar is **load-bearing**, not purely transitional. Codec reads migrate to TS over time, but the audio engine stays in the sidecar until/unless we later choose to replace it with a web synth. "Retire the JVM entirely" is no longer an end-state goal — see [§7 Phase 7](#phase-7--harden--shrink-the-sidecar).

**Rough order of magnitude:** multi-engineer effort, ~12–18 months to *full* parity (171 commands × 157 dialogs is the long tail). A *usable* read/play/basic-edit build lands far sooner. A v1 feature subset will be chosen later (parity remains the eventual bar).

---

## 2. Why migrate

- **Toolkit risk.** The UI is bound to Eclipse SWT for Cocoa, not on Maven Central (hand-installed per build docs), tracking Eclipse's cadence, plus a JNI AudioUnit bridge built with Xcode CLI tools.
- **Distribution friction.** Shipping/signing/notarizing a JVM `.app` is heavier than the Electron path (`electron-builder` handles signing/notarization/auto-update).
- **Developer pool & ecosystem.** Web/TS/Vue talent and tooling (HMR, devtools, component libs, canvas/audio libs) vastly outnumber SWT/Cocoa-Java.
- **UI velocity.** Declarative Vue + CSS iterates faster than SWT widgets behind a custom toolkit abstraction.

### Non-goals

- **Cross-platform expansion.** macOS only for now. Electron *enables* Windows/Linux cheaply, but we won't invest in, test, or support them during this migration. (Revisit later — explicitly deferred, not refused.)
- **Replacing the sound engine.** Out of scope for now — we keep TuxGuitar's native engine. A web synth is a possible *future* swap, not part of this migration.
- **Format / feature additions.** Preserve the existing matrix and behavior. Parity first.

---

## 3. Current architecture inventory

Grounded in the actual tree (`common/` = platform-independent, `desktop/` = app + SWT/Cocoa).

| Subsystem | Where | ~LOC | Disposition |
|---|---|---|---|
| **Song model** (`TGSong→Track→Measure→Voice→Beat→Note`) | `common/TuxGuitar-lib/.../song/models` | part of 32K | **Port to TS.** Source of truth for editing in the renderer. |
| **Tab layout / render logic** (`graphics/control`, `TG*Painter`) | `common/TuxGuitar-lib` | part of 32K | **Replace** with a custom TS renderer built on alphaTab. Existing painters are a layout reference only. |
| **GP3/4/5 codec** | `common/TuxGuitar-gtp` | 6.3K | Read via alphaTab and/or sidecar; **TS port later**, golden-gated. |
| **GPX (GP6) codec** | `common/TuxGuitar-gpx` | 3.3K | Same as above. |
| **PowerTab (.ptb)** | `common/TuxGuitar-ptb` | 2.5K | Sidecar read first; **TS port later**. |
| **TablEdit (.tef)** | `desktop/TuxGuitar-tef` | 6.3K | Sidecar read first; **TS port later**. |
| **MIDI read/write** | `common/TuxGuitar-midi` | 1.9K | **Port to TS** (well-specified). |
| **MusicXML / LilyPond / ASCII / PDF / SVG writers** | `common/` + `desktop/` | ~6K | **Port to TS** incrementally. |
| **Native `.tg` format** (`TGStream`) | `common/TuxGuitar-lib` | part of 32K | **Crown jewel — port to TS first**, byte/round-trip golden-tested. Never depends on the sidecar long-term. |
| **Gervill software synth** | `desktop/gervill` | 29K | **Keep in the sidecar** (native-image). Not ported. |
| **Synth plumbing** (`TuxGuitar-synth`) | `desktop/TuxGuitar-synth` | 2.9K | **Keep in the sidecar.** |
| **Player / sequencer / MIDI routing** | `player/*`, `MidiPlayer` | — | **Keep in the sidecar**; expose transport over IPC. |
| **macOS AudioUnit MIDI bridge (JNI)** | `desktop/TuxGuitar-AudioUnit` + native | 8 native files | Likely **drop** (software synth outputs PCM via Java Sound). Keep only if the sidecar needs native MIDI out. |
| **UI toolkit abstraction** | `desktop/TuxGuitar-ui-toolkit` | 3.4K | A spec for the new Vue components; the abstraction itself is **deleted**. |
| **SWT/Cocoa toolkit impl** | `desktop/TuxGuitar-ui-toolkit-swt` | 7.3K | **Delete.** |
| **Application** (actions, views, dialogs, editor, transport, undo, docking) | `desktop/TuxGuitar` | 52K | **Rewrite** as Nuxt renderer + TS command bus. 201 action classes (~171 IDs), 157 dialogs, 258 view classes. |
| **Plugins (Java SPI)** | 28 `TGPlugin` services | — | **Replace** with a TS module-registration registry. |
| **i18n** | `messages*.properties` | — | **Port** to JSON (e.g. `@nuxtjs/i18n` / i18next). |

### Architectural assets we can exploit

- **Drawing is already abstracted.** All tab rendering goes through the `UIPainter` interface (SWT/AWT/PDF/SVG impls). Layout/measurement is independent of the paint surface — a clean reference for the new renderer's layout math even though the surface becomes canvas-on-alphaTab.
- **UI is already abstracted.** App code targets `app.tuxguitar.ui.*`, not SWT. That contract (widgets, layout, menus, events) is a ready-made spec for the Vue component layer.
- **Editor uses a command bus.** Behavior dispatches by **string action IDs** through `TGActionManager` with pre/post/error events + interceptors. ~171 IDs enumerate the full command surface and port cleanly to a TS command registry — keep the IDs identical so menus/keybindings map 1:1.
- **Service container, not globals.** Managers are context-scoped singletons via `TGContext` → maps to Pinia stores / module-scoped singletons in TS.

### Architectural liabilities

- **Thin tests (~14 classes).** No behavioral safety net → build golden files *before* porting ([§8](#8-testing--validation-strategy)).
- **Binary codecs encode tacit knowledge.** GP/GPX/PTB/TEF carry years of vendor-quirk fixes. Rewrites must be validated against a large real-world corpus.
- **Two song models in play.** TuxGuitar's model (TS port, editing source of truth) vs. alphaTab's model (rendering). Needs one clear boundary — see [D1](#d1--rendering-custom-engine-on-alphatab-).

---

## 4. Target architecture (Electron + Nuxt 4)

```
┌─────────────────────────────────────────────────────────────────┐
│ Electron Main process (Node + TypeScript)                        │
│  • App lifecycle, single-instance lock, file-open events         │
│  • Native menus (Electron Menu), Dock, printing                  │
│  • Filesystem IO (open/save), recent files, preferences store    │
│  • IPC broker  +  Sidecar manager (spawn / supervise / IPC)      │
└───────▲───────────────────────────────────────────▲──────────────┘
        │ contextBridge (typed preload,             │ stdio / local socket
        │ contextIsolation, sandbox)                │ (JSON or binary protocol)
        │                                           │
┌───────▼───────────────────────────────┐  ┌────────▼───────────────────────┐
│ Renderer  (Chromium + Nuxt 4 / Vue 3) │  │ Native sidecar                  │
│  SPA mode (ssr:false), Pinia state    │  │ (GraalVM native-image of the    │
│                                        │  │  existing Java core)            │
│  • App shell: toolbar, transport,      │  │                                 │
│    track table, ~157 dialogs           │  │  • TuxGuitar sound engine:      │
│  • Command bus (TS, same string IDs)   │  │    player + sequencer + Gervill │
│  • Song model + managers (TS) + undo   │  │    → audio out (Core Audio)     │
│  • Custom tab renderer  ── alphaTab    │  │  • Emits playback tick/position │
│    (glyphs, music font, layout prims,  │◀─┤  • [transitional] codec reads   │
│    GP import) drawing to <canvas>      │  │    (GP/GPX/PTB/TEF → model)     │
└────────────────────────────────────────┘  └─────────────────────────────────┘
```

### Process & security model

- Renderer: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. All privileged ops (fs, spawn, native dialogs, sidecar) go through a **typed preload bridge** with a narrow, validated surface. No raw Node in the renderer.
- Main owns fs, native dialogs/menus, printing, and the **sidecar lifecycle**.

### Nuxt-in-Electron integration notes

- Run Nuxt as a **client-only SPA** (`ssr: false`) or prerendered static (`nuxt generate`), loaded into the `BrowserWindow` via a custom `app://` protocol (preferred over `file://` for correct routing/CSP).
- **Nitro/SSR is unused at runtime** — Electron's main process is the Node backend. Disable server routes; don't introduce a runtime Nitro dependency. Use a tool like `nuxt-electron` (Vite-based) to wire main/preload builds + dev HMR.
- Stack: **Pinia** (state), **VueUse** (utilities), a headless component lib (**Reka UI**) or **Nuxt UI** for dialogs/menus, **@nuxtjs/i18n** for strings. File-based routing maps to the single editor view + optional routes for large dialogs.

### Technology choices

| Concern | Choice | Notes |
|---|---|---|
| Shell | **Electron** | `electron-builder` for signing/notarization/auto-update. |
| Language | **TypeScript** (strict) | Shared types across main/preload/renderer. |
| UI | **Nuxt 4 / Vue 3** (SPA) | Pinia, VueUse, Reka UI / Nuxt UI. |
| Score/tab render + GP import | **Custom engine on alphaTab** | Own the renderer; reuse alphaTab glyphs/fonts/layout + importer. |
| Audio | **TuxGuitar native engine in sidecar** | Java player + Gervill, driven over IPC. Web synth deferred. |
| Sidecar runtime | **GraalVM `native-image`** | No full JVM to ship; fast start. JVM fallback acceptable if native-image blocks. |
| Build | **Vite** (via Nuxt) + `nuxt-electron` | Fast HMR. |
| Packaging | **electron-builder** | macOS `.dmg`/`.app`, hardened runtime, notarization. |
| Tests | **Vitest** + **Playwright** (Electron) | Plus golden-file round-trip harness. |

---

## 5. Strategic decisions (resolved)

### D1 — Rendering: custom engine on alphaTab ✅

- We **do not adopt alphaTab wholesale**; we build a **custom rendering engine** on its primitives (music font/glyph rendering, notation layout helpers) plus its Guitar Pro importer, drawing to `<canvas>`.
- **Model boundary (sub-decision, pick early):** the TS port of TuxGuitar's model is the **editing source of truth**. Either (a) draw directly from it using alphaTab's low-level drawing primitives (one model, no sync), or (b) project it to alphaTab's model for rendering (two models, one adapter). **(a) preferred** to avoid dual-model drift; fall back to (b) if alphaTab's high-level layout is too valuable to bypass.
- **License:** alphaTab is MPL-2.0 (weak, file-level copyleft). Using its public APIs in our proprietary app is fine. If we **fork/modify alphaTab's own source files**, those files stay MPL — isolate any such forks and publish their changes. Prefer extension over modification.

### D2 — Audio: keep TuxGuitar's native sound engine (for now) ✅

- The existing **Java player + Gervill synth run in the native sidecar.** The renderer sends the song (or a rendered MIDI sequence) + transport commands (play/pause/seek/tempo/mute/solo) over IPC; the sidecar synthesizes and **outputs audio itself** (Core Audio via Java Sound) and **streams back tick/position events** for cursor follow.
- **Rejected for now:** alphaSynth / WASM SF2 / Web Audio synth. Kept as a documented *future* option (would let the sidecar shrink to codecs only).
- **AudioUnit JNI bridge:** likely **dropped** — the software synth emits PCM through Java Sound, so native MIDI-out isn't required. Keep only if external MIDI out is needed.

### D3 — Risky codecs: native sidecar, retired per-format ✅

- For GP/GPX/PTB/TEF **reading**, before TS ports are trusted, run the **existing Java code** in the same native-image sidecar (the renderer can't tell sidecar reads from TS reads — identical IPC result shape).
- As each TS codec passes its golden corpus, flip it on and drop that sidecar read path. The sidecar's **codec role** is transitional; its **audio role** is not (D2).

### D4 — UI framework: Nuxt 4 / Vue 3 ✅

- SPA mode in Electron (see integration notes). Pinia for the manager/store layer; the command bus and model live in TS modules, not in Vue components.

### D5 — Native `.tg` format: TS, first, never sidecar long-term ✅

- Primary save format; must work offline without the sidecar and round-trip perfectly. Port `TGStream` read+write to TS in an early phase, byte/round-trip golden-tested (incl. legacy versions via `TuxGuitar-compat`).

---

## 6. Migration strategy

**Principles**

1. **Capture behavior before changing it** — golden fixtures from the current Java build first ([§8](#8-testing--validation-strategy)).
2. **Vertical slices, runnable early** — read-only viewer → playback → editing → writers → dialog long tail. No multi-month big bang.
3. **Strangle, don't stop the world** — the sidecar keeps the app useful while codecs port over.
4. **Preserve identifiers** — keep action IDs, format IDs, and `.tg` semantics identical so menus, keybindings, and files carry 1:1.
5. **Parity is the eventual bar** — track the 171 commands / 157 dialogs as an explicit checklist; v1 ships a chosen subset, full parity follows.

The `UIPainter`/`ui.*` abstractions plus the string-ID command bus mean the *contracts* are already written down — the rewrite re-implements known interfaces rather than reverse-engineering intent.

---

## 7. Phases, milestones & exit criteria

> Durations are relative effort, not calendar promises.

### Phase 0 — Foundations & safety net
- Electron + **Nuxt 4 SPA** skeleton via `nuxt-electron`: main/preload/renderer, contextIsolation/sandbox, typed IPC bridge, `app://` protocol, electron-builder signing/notarization smoke test.
- Stand up the **GraalVM native-image sidecar** from the Java core, exposing two IPC capabilities: `read file → canonical model` and a `play/stop` stub.
- Build the **golden-file harness** from the current Java app (see §8): open every supported format → dump canonical model + re-export → freeze fixtures.
- **Spike 0a — audio-sync de-risking (gates the D2 architecture).** This is the riskiest seam: the sidecar owns Core Audio output while the renderer owns the playback cursor. Validate *before* committing to it. Build a throwaway: sidecar plays a fixed `.tg`, emits high-res tick/position events over IPC; renderer draws a cursor that interpolates between events.
  - **Measure:** end-to-end audio→visual offset, IPC event cadence, jitter, and offset stability over a multi-minute playback (and under load — large score scrolling).
  - **Threshold (go):** perceived cursor-to-audio offset within ~1 frame (~16 ms) and *stable* (no visible drift/stutter); a fixed offset can be calibrated out, jitter cannot.
  - **No-go fallbacks (in order):** (1) calibrate a constant offset + renderer-side interpolation; (2) sidecar renders PCM and exposes a shared playback clock the renderer samples; (3) pull audio into the renderer earlier than planned (Web Audio + WASM SF2), demoting the sidecar to codecs-only. Pick the cheapest that hits the threshold.
- **Exit:** signed app launches on macOS; sidecar reads a `.gp5` and plays a `.tg`; **Spike 0a meets the threshold or a fallback is chosen and recorded**; CI runs Vitest + Playwright + the golden harness.

### Phase 1 — Read-only viewer
- Custom tab renderer MVP on alphaTab: load a model, render score + tab to canvas, track table, navigation/scroll.
- Open via native dialog / Finder "Open With" / drag-drop → main → (sidecar or alphaTab import) → renderer.
- **Exit:** open GP3–7, MusicXML, MIDI, `.tg` and render faithfully vs. golden screenshots.

### Phase 2 — Playback (native sidecar)
- Wire the sidecar sound engine: play/pause/stop, seek, tempo, count-in, loop, per-track mute/solo/volume, metronome; **cursor follow** driven by the sidecar's position events.
- Define the audio-sync protocol (high-res tick events; renderer interpolates between them); measure cross-process latency early.
- **Exit:** playback matches the Java app's timing/mix on the corpus (within tolerance); transport complete.

### Phase 3 — Native `.tg` read/write in TS
- Port `TGStream` reader+writer to TS; remove `.tg` from the sidecar read path.
- **Exit:** byte/canonical-model round-trip golden tests pass for the full `.tg` corpus incl. legacy versions.

### Phase 4 — Editing core
- Port the edit managers (`TGSongManager`/`TrackManager`/`MeasureManager`), the **command bus** (string IDs preserved), and **undo/redo**.
- Implement the highest-traffic commands first (note entry, durations, effects, measures/bars, copy/paste).
- **Exit:** create → edit → save `.tg` → reopen is lossless; top ~40 commands done.

### Phase 5 — Writers / exporters
- Port MIDI write, MusicXML write, ASCII, LilyPond, PDF (Chromium print-to-PDF or a TS PDF lib), SVG/PNG export. Audio export can reuse the sidecar (offline render to WAV).
- **Exit:** each exporter matches golden fixtures; GP *write* decided (port vs. document as unsupported, matching current capability).

### Phase 6 — Dialog & command long tail
- Reproduce the ~157 dialogs + remaining commands: tuning, chord editor, scales, channel/instrument settings, markers, lyrics, tempo, time signature, transpose, preferences, etc.
- Port i18n strings; rebuild menus/keybindings from the preserved action IDs; replace 28 SPI plugins with a TS module registry.
- **Exit:** parity checklist (171 commands / 157 dialogs) fully accounted for; v1 subset shippable.

### Phase 7 — Harden & shrink the sidecar
- Confirm every codec has a trusted TS port → remove the sidecar's **codec** role. The **audio** role remains (D2) unless a web-synth swap is later chosen.
- Performance pass (large scores, scroll/render latency, audio-sync jitter), accessibility, auto-update, crash reporting, final notarization.
- Delete the SWT/Cocoa modules.
- **Exit:** shipped macOS `.app`; sidecar reduced to the sound engine; parity + performance accepted.

---

## 8. Testing & validation strategy

The current suite (~14 classes) cannot anchor a rewrite. **Build the safety net first.**

1. **Golden corpus (cornerstone).** Collect a large set of real `.tg`/`.gp*`/`.ptb`/`.tef`/`.mxml`/`.mid` files. Using the *current Java build*, emit per file: (a) a canonical serialization of the parsed model, and (b) a re-export in each writer format. Freeze as fixtures. The TS port must reproduce them.
2. **Round-trip invariants.** `read → write → read` model-stable; `.tg` byte-stable (or canonical-model-stable where byte-stability is impractical).
3. **Differential testing during transition.** While the sidecar reads, run the TS codec and the Java sidecar on the same input and diff models in CI; discrepancies block promoting that codec.
4. **Visual regression.** Render the corpus with the new engine, perceptual-diff vs. screenshots of the Java renderer (tolerance).
5. **Playback regression.** Compare the sidecar's event/timing stream against the legacy player; optionally fingerprint offline-rendered audio.
6. **E2E (Playwright + Electron).** Open → edit → save → reopen, transport, a sampling of dialogs.
7. **Coverage targets.** New TS codecs/managers ship with meaningfully higher coverage than the legacy baseline.

---

## 9. Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Binary codec fidelity (GP/GPX/PTB/TEF) | High | alphaTab/sidecar reads first; differential + golden tests on a large corpus before trusting any TS port. |
| Thin existing tests | High | Phase 0 golden harness captures behavior *before* porting. |
| **Audio sync across the process boundary** (cursor follow, latency/jitter) | High | **Phase 0 Spike 0a** validates this before the D2 architecture is committed (threshold + no-go fallbacks). High-res tick events + renderer interpolation; keep audio output in the sidecar (don't stream raw PCM over IPC). |
| **Custom renderer effort** (owning layout/draw) | High | Build on alphaTab glyphs/fonts/layout instead of from scratch; lock model boundary (D1a) early; visual-regression gate. |
| **Dual model** (TG model vs. alphaTab model) | Medium | Prefer D1(a): draw from the TS TG model via alphaTab primitives; if (b), one explicit adapter, golden-tested. |
| **Nuxt-in-Electron** (unused SSR/Nitro, routing/CSP) | Medium | `ssr:false` SPA or static generate; `app://` protocol; disable server routes; use `nuxt-electron`; treat main as the only backend. |
| Shipping/maintaining the native sidecar (size, startup, build) | Medium | GraalVM native-image (no full JVM); supervise/restart from main; health checks. |
| alphaTab MPL on modified files | Low–Med | Use public APIs; isolate & publish any forked alphaTab files. |
| GP *write* unsupported by alphaTab | Medium | Decide in Phase 5: port writer or document as unsupported (don't silently regress). |
| Long-tail scope (171 cmds / 157 dialogs) | Medium | Explicit parity checklist; prioritize by usage; conscious drops with sign-off. |
| Scope creep into cross-platform | Low–Med | Non-goal for now; reject Windows/Linux-only work during migration. |
| macOS signing/notarization | Low–Med | Validate in Phase 0, not at the end. |

---

## 10. What gets deleted vs. kept

**Deleted** (replaced by the web UI):
- `desktop/TuxGuitar-ui-toolkit-swt` (SWT/Cocoa UI impl) and the `desktop/TuxGuitar-ui-toolkit` abstraction
- `desktop/TuxGuitar-cocoa-integration-swt`, `TuxGuitar-tray-swt`, `TuxGuitar-image-swt`, `TuxGuitar-awt-graphics`
- The Maven reactor, the SWT-install step, and the `build-scripts/tuxguitar-macosx-swt-cocoa` assembly
- `desktop/TuxGuitar-AudioUnit` + native bridge — *likely* (keep only if external MIDI out is needed)

**Kept (in the native sidecar):**
- `desktop/gervill`, `TuxGuitar-synth`, `TuxGuitar-synth-gervill`, the player/sequencer — the sound engine (D2)
- The Java `common/` codecs — as the transitional read fallback and the reference implementation, retired per-format as TS ports land

The Java *core* remains the reference implementation throughout; the renderer/editor/model/`.tg`/exporters move to TS, the sound engine stays Java for now.

---

## 11. Initial build skeleton (Phase 0 deliverables)

- `electron/` — main + preload (TS), IPC contract, sidecar manager
- `app/` — Nuxt 4 renderer (SPA): Pinia stores, command bus, model, custom renderer module
- `sidecar/` — native-image build of the Java core (audio + transitional codec reads)
- `test/golden/` — fixtures + harness generated from the current Java build
- `electron-builder` config — signed/notarized macOS `.dmg`

---

## 12. Decisions resolved (2026-06-03)

| # | Question | Decision |
|---|---|---|
| 1 | alphaTab adoption | **Use alphaTab as the basis for a *custom* rendering engine** (not wholesale adoption). |
| 2 | Transitional native sidecar | **Allowed.** GraalVM native-image. |
| 3 | UI framework | **Nuxt 4** (Vue 3, SPA mode in Electron). |
| 4 | Parity bar | **Full parity is the eventual goal.** v1 subset to be chosen later. |
| 5 | v1 scope | Deferred — see #4. |
| 6 | Audio engine | **Keep TuxGuitar's native sound engine for now** (Gervill + player in the sidecar). Web synth = possible future swap. |
| 7 | Cross-platform | **macOS only for now**; revisit later. |

### Still open (lower-level, decide during Phase 0–1)
- **D1 model boundary:** draw directly from the TS TG model (preferred) vs. project to alphaTab's model.
- **Native MIDI out:** keep the AudioUnit bridge or drop it (depends on whether external MIDI out is needed).
- **GP write:** port a writer vs. document as unsupported (Phase 5).
- **v1 feature subset:** which of the 171 commands / 157 dialogs ship first.

---

*High-level migration plan. Phase durations are relative effort estimates, not commitments; refine after the Phase 0 golden harness reveals real codec fidelity gaps and the renderer model-boundary (D1) is settled.*
