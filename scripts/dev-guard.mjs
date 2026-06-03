#!/usr/bin/env node
// Single-instance dev gate. Runs before `nuxt dev` (see the "dev" script).
//
// Kills any prior dev process started from THIS repo's node_modules — the Nuxt
// dev server, vite-node workers, esbuild, and the Electron it spawned — so only
// one `pnpm dev` runs at a time and nothing is left holding the dev port 4399.
//
// NB: this does NOT fix the EINVAL-500 blank-window bug. That one is the
// macOS 104-char Unix-socket limit: os.tmpdir() (/var/folders/.../T) + Nuxt's
// vite-node socket name > 104 → libuv UV_EINVAL. Fixed by `TMPDIR=/tmp` in the
// "dev" script, which shrinks os.tmpdir() so the socket path fits.
//
// Policy: auto-kill and replace (default). Set DEV_LOCK=abort to refuse instead.
import { execSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const NEEDLE = join(ROOT, 'node_modules') // dev binaries all live here
const MODE = process.env.DEV_LOCK === 'abort' ? 'abort' : 'kill'

const sh = (cmd) => {
  try { return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString() } catch { return '' }
}
const alive = (pid) => {
  try { process.kill(pid, 0); return true } catch { return false }
}
// Sync sleep without a busy loop (predev is a one-shot gate).
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)

// Never signal our own ancestor chain (this script → pnpm → shell → …).
const keep = new Set()
for (let pid = process.pid, i = 0; pid > 1 && i < 50; i++) {
  keep.add(pid)
  pid = Number(sh(`ps -o ppid= -p ${pid}`).trim()) || 0
}

const victims = [...new Set(
  sh(`pgrep -f ${JSON.stringify(NEEDLE)}`)
    .split('\n')
    .map((s) => Number(s.trim()))
    .filter(Boolean),
)].filter((pid) => !keep.has(pid))

if (!victims.length) {
  console.log('[dev] no existing dev session — starting fresh')
  process.exit(0)
}

if (MODE === 'abort') {
  console.error(`[dev] a dev session is already running (pids ${victims.join(', ')}). Stop it, or unset DEV_LOCK to auto-replace.`)
  process.exit(1)
}

console.log(`[dev] replacing existing dev session — killing ${victims.length} process(es): ${victims.join(', ')}`)
for (const pid of victims) { try { process.kill(pid, 'SIGTERM') } catch {} }
for (let i = 0; i < 20 && victims.some(alive); i++) sleep(150)
for (const pid of victims) { if (alive(pid)) { try { process.kill(pid, 'SIGKILL') } catch {} } }
process.exit(0)
