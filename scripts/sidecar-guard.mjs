#!/usr/bin/env node
// Audio-sidecar gate. Runs before `nuxt dev` (see the "dev" script).
//
// Ensures the Rust audio sidecar binary exists before starting dev. If it's
// missing, build it once (sidecar/build.sh: downloads the ~32MB SoundFont +
// `cargo build --release`).
//
// Policy: NEVER block dev. The app runs fine without the sidecar (playback is
// just silent, status reports "not-found"). So every failure path here — no
// Rust toolchain, build error — warns and exits 0 so `nuxt dev` still starts.
// Set DEV_SKIP_SIDECAR=1 to skip the check entirely.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BIN = join(ROOT, 'sidecar', 'bin', 'tuxguitar-sidecar')
const BUILD = join(ROOT, 'sidecar', 'build.sh')

if (process.env.DEV_SKIP_SIDECAR === '1') {
  console.log('[dev] DEV_SKIP_SIDECAR=1 — skipping sidecar check')
  process.exit(0)
}

if (existsSync(BIN)) {
  console.log('[dev] audio sidecar present')
  process.exit(0)
}

// Missing — need cargo to build. Pre-check so we don't download 32MB then fail.
const cargo = spawnSync('cargo', ['--version'], { stdio: 'ignore' })
if (cargo.error || cargo.status !== 0) {
  console.warn(
    '[dev] audio sidecar not built and `cargo` not found — continuing WITHOUT audio.\n' +
    '      Install Rust (https://rustup.rs), then run `pnpm sidecar:build`.',
  )
  process.exit(0)
}

console.log('[dev] audio sidecar missing — building (first run downloads ~32MB SoundFont + compiles Rust)…')
const build = spawnSync('bash', [BUILD], { stdio: 'inherit' })
if (build.error || build.status !== 0) {
  console.warn('[dev] sidecar build failed — continuing WITHOUT audio. Fix with `pnpm sidecar:build`.')
  process.exit(0)
}

console.log('[dev] audio sidecar built')
process.exit(0)
