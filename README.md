# TuxGuitar (macOS)

## Description

TuxGuitar is an open source multitrack guitar tablature editor and player written in Java.

**This fork builds the macOS (SWT/Cocoa) version only.** All other platform targets
(Linux, Windows, FreeBSD, Android) have been removed.

## Download

This fork does not publish prebuilt packages — see [Build from source](#build-from-source-macos) below.

Ready-to-use installation packages for the original multi-platform project (Linux, Windows,
macOS, FreeBSD, Android) are available on the upstream
[releases](https://github.com/helge17/tuxguitar/releases/) page.

## Build from source (macOS)

### Prerequisites

- JDK 17 or higher (CI uses 21)
- Maven 3.3 or higher
- Eclipse SWT 4.37 (cocoa/macosx)

On macOS you need [Homebrew](https://brew.sh) to install the build tools:

```sh
$ brew install openjdk maven wget
```

### Install SWT for macOS

Eclipse SWT is not on Maven Central, so install it into your local Maven repo first:

```sh
$ TUX_ARCH=`uname -m | sed 's/arm64/aarch64/'`
$ wget https://download.eclipse.org/eclipse/downloads/drops4/R-4.37-202509050730/swt-4.37-cocoa-macosx-${TUX_ARCH}.zip
$ mkdir swt-4.37-cocoa-macosx-${TUX_ARCH}
$ cd swt-4.37-cocoa-macosx-${TUX_ARCH}
$ unzip ../swt-4.37-cocoa-macosx-${TUX_ARCH}.zip
$ mvn install:install-file -Dfile=swt.jar -DgroupId=org.eclipse.swt -DartifactId=org.eclipse.swt.cocoa.macosx -Dpackaging=jar -Dversion=4.37
$ cd ..
```

### Build and start TuxGuitar

The buildable assembly module is `desktop/build-scripts/tuxguitar-macosx-swt-cocoa`, which
aggregates every other module into a macOS `.app` bundle:

```sh
$ cd desktop/build-scripts/tuxguitar-macosx-swt-cocoa
$ mvn -e clean verify                 # matches CI (.github/workflows/macos-maven.yml)
$ cd -
```

The application is now located at
`desktop/build-scripts/tuxguitar-macosx-swt-cocoa/target/tuxguitar-9.99-SNAPSHOT-macosx-swt-cocoa.app`.
Start TuxGuitar by double-clicking it.

To additionally compile the native AudioUnit MIDI bridge
(`desktop/TuxGuitar-AudioUnit`), add the `native-modules` profile. This requires the
Xcode command line tools (`make`):

```sh
$ mvn -e clean verify -P native-modules
```

### Troubleshooting

There may be some cases where the build fails. A few examples (not an exhaustive list):

- TuxGuitar sources have been placed in a folder whose absolute path contains non-ASCII characters
- During development of a feature some unit tests are broken
- other configuration-specific issues

In these cases it is possible to build TuxGuitar without running the unit tests by adding
the `-DskipTests` flag to the build command:

```sh
$ mvn -e clean verify -DskipTests
```

Note that disabling unit tests is **not recommended**.

## Contribute

Issues and pull requests are welcome on the
[project's GitHub repository](https://github.com/helge17/tuxguitar).

## License

TuxGuitar is released under the GNU Lesser General Public License.

Copyright (C) 2005-2022 Julián Casadesús
              2023-2025 guiv42, helge17

## Third party products

TuxGuitar includes the following third party products:

* SWT (Standard Widget Toolkit): https://www.eclipse.org/swt/
* Gervill (Java Software Synthesizer)
* iText (Free Java-PDF library): https://itextpdf.com/
* Magic Sound Font v2.0 - Contributed by Dennis Deutschmann
