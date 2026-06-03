#!/usr/bin/env bash
# Build the TuxGuitar Rust sidecar.
# Requires: rustup/cargo, and a soundfont SF2 at sidecar/bin/GeneralUser.sf2
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SIDECAR_DIR="$ROOT/sidecar"
OUT_DIR="$SIDECAR_DIR/bin"

mkdir -p "$OUT_DIR"

SF2="$OUT_DIR/GeneralUser.sf2"
SF2_URL="https://raw.githubusercontent.com/mrbumpy409/GeneralUser-GS/main/GeneralUser-GS.sf2"
if [ ! -f "$SF2" ]; then
  echo "==> Downloading GeneralUser GS soundfont (~32 MB)..."
  curl -fSL "$SF2_URL" -o "$SF2"
  # Sanity check: must be a RIFF soundfont, not an HTML error page.
  if ! head -c 4 "$SF2" | grep -q "RIFF"; then
    echo "ERROR: downloaded soundfont is not a valid RIFF file" >&2
    rm -f "$SF2"
    exit 1
  fi
fi

echo "==> Building Rust sidecar..."
cd "$SIDECAR_DIR"
cargo build --release

cp "target/release/tuxguitar-sidecar" "$OUT_DIR/tuxguitar-sidecar"
chmod +x "$OUT_DIR/tuxguitar-sidecar"

echo "Done: $OUT_DIR/tuxguitar-sidecar ($(du -sh "$OUT_DIR/tuxguitar-sidecar" | cut -f1)), soundfont $(du -sh "$SF2" | cut -f1)"
