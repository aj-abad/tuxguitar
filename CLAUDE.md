# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

TuxGuitar is a multitrack guitar tablature editor and player written in Java. **This fork builds the macOS (SWT/Cocoa) version only.**

## Build & run

Maven multi-module project. Requires **JDK 17+** (CI uses 21), **Maven 3.3+**, and **Eclipse SWT 4.37 for cocoa/macosx** installed into the local Maven repo first (it is not on Maven Central):

```sh
TUX_ARCH=`uname -m | sed 's/arm64/aarch64/'`
wget https://download.eclipse.org/eclipse/downloads/drops4/R-4.37-202509050730/swt-4.37-cocoa-macosx-${TUX_ARCH}.zip
# unzip, then:
mvn install:install-file -Dfile=swt.jar -DgroupId=org.eclipse.swt -DartifactId=org.eclipse.swt.cocoa.macosx -Dpackaging=jar -Dversion=4.37
```

The buildable assembly module is **not** the reactor root — it is `desktop/build-scripts/tuxguitar-macosx-swt-cocoa`, which aggregates every other module into a macOS `.app` bundle:

```sh
cd desktop/build-scripts/tuxguitar-macosx-swt-cocoa
mvn -e clean verify                      # matches CI (.github/workflows/macos-maven.yml)
mvn -e clean verify -P native-modules    # also builds the native AudioUnit MIDI bridge (needs Xcode CLI tools / make)
```

Output: `target/tuxguitar-9.99-SNAPSHOT-macosx-swt-cocoa.app`. Launch by double-clicking. The bundled launcher passes `-XstartOnFirstThread` (required by SWT/Cocoa) — needed if you ever run `app.tuxguitar.app.TGMainSingleton` directly.

## Tests

JUnit 5 (Jupiter). Test classes use the **`Test*` prefix** convention (e.g. `TestTrackManager`), not the `*Test` suffix. Most live under `common/*/src/test`.

```sh
mvn test                          # run from a module dir, or the assembly module to cover the reactor
mvn test -Dtest=TestTrackManager  # single test class
mvn -e clean verify -DskipTests   # skip tests (not recommended; verify runs them)
```

## Layout

- `common/` — platform-independent modules: the song model, file IO, and format codecs (gtp/gpx/ptb/tef/musicxml/midi/ascii/lilypond/pdf).
- `desktop/` — the desktop application, the SWT UI toolkit implementation, and macOS integration (cocoa, tray, AudioUnit).
- `desktop/pom.xml` — reactor parent (`groupId app.tuxguitar`, version `9.99-SNAPSHOT`); declares dependency versions for all modules.
- `desktop/build-scripts/` — assembly module + native modules + bundle resources (incl. the `.app` launcher script).

Java package root is `app.tuxguitar`. Compiler targets `--release 9` with `-Xlint:all`, even though the build JDK is 17+. Classes are conventionally prefixed `TG`.

## Architecture

**Service container (`TGContext`).** There is no static global state for managers. A `TGContext` is created once per application (`TuxGuitar.getInstance().getContext()`) and every manager is a context-scoped singleton obtained via `XxxManager.getInstance(context)` (implemented with `TGSingletonUtil`/`TGSingletonFactory`). When you need a manager, look it up through the context — do not cache it statically.

**Command bus (`TGActionManager`).** Editor behavior is dispatched as actions keyed by **String IDs**, not direct method calls. `execute(id, TGActionContext)` runs the action; `TGActionContext` is an attribute bag carrying inputs (e.g. the current `TGSongManager`). Each execution fires pre/post/error events and passes through registered interceptors. To add behavior: subclass `TGActionBase` (in `TuxGuitar-editor-utils`), register it with `mapAction(id, action)`, and invoke it via `TGActionProcessor`. UI menus/keybindings ultimately resolve to action IDs.

**Events (`TGEventManager`).** Pub/sub keyed by event type; managers fire events (e.g. file-format availability, action lifecycle) that listeners subscribe to. This is how UI stays in sync with model/state changes.

**Song model.** Pure data tree in `common/TuxGuitar-lib/.../song/models`: `TGSong → TGTrack → TGMeasure` (with shared `TGMeasureHeader`) `→ TGVoice → TGBeat → TGNote`. Never mutate the tree directly — go through `TGSongManager`, `TGTrackManager`, `TGMeasureManager`. Model objects are created via `TGFactory` (overridable so alternate backends can supply their own node types).

**File formats (`TGFileFormatManager`).** Central registry of readers, writers, importers, exporters, and detectors. The native format is `.tg` (`TGStream.TG_FORMAT`); all other formats (gp3/4/5, gpx, ptb, tef, musicxml, midi, …) are contributed by their respective modules, which register a reader/writer here at startup. Detection routes an incoming file to the right reader.

**Plugins (Java SPI).** Modules extend the app by shipping `share/META-INF/services/app.tuxguitar.util.plugin.TGPlugin`. `TGPluginManager` discovers these via `ServiceLoader` at startup and initializes them (early-init plugins run before the UI). A module's `share/` directory holds its plugin descriptors and runtime resources and is placed on the classpath. Adding a format/exporter/tool generally means: new module → implement the plugin interface → declare it in `share/META-INF/services` → add the module to the assembly pom.

**UI toolkit abstraction.** Application code does **not** call SWT directly. `TuxGuitar-ui-toolkit` defines a toolkit-agnostic UI API under `app.tuxguitar.ui.*` (widgets, layout, menus, events, resources); `TuxGuitar-ui-toolkit-swt` implements that API on SWT/Cocoa under `app.tuxguitar.ui.swt.*`. Write UI against the abstraction; only the `-swt` module knows about SWT types.

**Playback / MIDI.** `player/base` (`MidiPlayer`, channels, controllers) drives playback; the sequencer implementation is in `player/impl/sequencer`. Sound is produced by a software synth: `tuxguitar-synth` + the Gervill synth (`tuxguitar-synth-gervill`). On macOS, native MIDI output goes through `TuxGuitar-AudioUnit`, a JNI bridge compiled only under the `native-modules` profile.

**Startup flow.** `TGMainSingleton.main()` enforces single-instance behavior via a lockfile + a temp "url" drop folder (a second launch writes the file/URL there for the running instance to pick up), then calls `TuxGuitar.getInstance().createApplication(url)`. That builds the main context (thread, resource, error, properties managers) and then the UI context (early-init plugins, then the main `TGWindow`).
