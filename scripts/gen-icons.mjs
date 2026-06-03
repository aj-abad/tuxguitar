#!/usr/bin/env node
// Generate the dev-only Dock raster (electron/resources/icon.png) from the Icon
// Composer source (electron/resources/icon.icon), so the unpackaged `pnpm dev`
// Dock tile matches the shipped Liquid-Glass app icon.
//
// Packaging does NOT use this file: electron-builder (≥26.8) compiles icon.icon
// itself via actool into the bundle's .icns + Liquid-Glass Assets.car — see
// electron-builder.yml. This script exists only to feed main.ts's
// `app.dock.setIcon(icon.png)`, which runs for dev runs (guarded `!app.isPackaged`).
//
// Pipeline (macOS + Xcode 26 `actool`):
//   actool icon.icon → icon.icns   Apple's own render — gradient + glass baked in
//   iconutil -c iconset            extract the 256² representation
//   ImageMagick upscale 256 → 1024 Lanczos; soft at full size, but the Dock only
//                                  ever renders it small, and 1024 keeps drop-in
//                                  parity with the previous icon.png dimensions.
//
// Degrades gracefully: off macOS, or without actool (Xcode) / ImageMagick, it
// keeps the committed icon.png so dev still has a Dock tile.
import { execFileSync } from "node:child_process";
import {
  copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "electron", "resources", "icon.icon");
const PNG = join(ROOT, "electron", "resources", "icon.png");

const run = (cmd, args) => execFileSync(cmd, args, { stdio: "ignore" });
const tool = (cands) => {
  for (const c of cands) {
    try { run(c, ["-version"]); return c; } catch { /* next */ }
  }
  return null;
};

if (process.platform !== "darwin") {
  console.warn("[icons] non-macOS host; skipping (needs actool/iconutil).");
  process.exit(0);
}
if (!existsSync(SRC)) {
  console.warn(`[icons] ${SRC} not found; skipping.`);
  process.exit(0);
}

// Newest mtime anywhere inside the .icon bundle (icon.json + Assets/*).
const newestMtime = (path) => {
  const st = statSync(path);
  if (!st.isDirectory()) return st.mtimeMs;
  let m = st.mtimeMs;
  for (const e of readdirSync(path)) m = Math.max(m, newestMtime(join(path, e)));
  return m;
};

// No-op if icon.png is at least as new as every file in the source bundle.
const srcMtime = newestMtime(SRC);
if (existsSync(PNG) && statSync(PNG).mtimeMs >= srcMtime) {
  console.log("[icons] up to date.");
  process.exit(0);
}

// actool ships with Xcode (`--version` exits 0 and prints a version plist).
let hasActool = false;
try { execFileSync("actool", ["--version"], { stdio: "ignore" }); hasActool = true; } catch { /* absent */ }
if (!hasActool) {
  console.warn("[icons] actool not found (needs Xcode 26+); keeping existing icon.png.");
  process.exit(0);
}

console.log("[icons] regenerating icon.png from electron/resources/icon.icon …");

const work = join(tmpdir(), "tabbycat-icon-png");
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

// 1. Compile the Icon Composer file to an .icns (mirrors electron-builder's
//    actool invocation). actool names the output after `--app-icon`.
const outDir = join(work, "out");
mkdirSync(outDir, { recursive: true });
run("actool", [
  SRC,
  "--compile", outDir,
  "--output-format", "human-readable-text",
  "--app-icon", "icon",
  "--include-all-app-icons",
  "--minimum-deployment-target", "26.0",
  "--platform", "macosx",
  "--target-device", "mac",
  "--output-partial-info-plist", join(outDir, "partial.plist"),
]);
const icns = join(outDir, "icon.icns");
if (!existsSync(icns)) {
  console.error("[icons] actool produced no icns; keeping existing icon.png.");
  process.exit(1);
}

// 2. Extract the 256² representation (the largest the new-format icns carries).
const iconset = join(work, "icon.iconset");
run("iconutil", ["-c", "iconset", icns, "-o", iconset]);
const rep = join(iconset, "icon_128x128@2x.png"); // 256×256
if (!existsSync(rep)) {
  console.error("[icons] expected 256² rep missing; keeping existing icon.png.");
  process.exit(1);
}

// 3. Upscale 256 → 1024 (Lanczos). Without ImageMagick, ship the 256² as-is.
const im = tool(["magick", "convert"]);
if (im) run(im, [rep, "-filter", "Lanczos", "-resize", "1024x1024", PNG]);
else {
  console.warn("[icons] ImageMagick not found; writing 256² icon.png (install: brew install imagemagick).");
  copyFileSync(rep, PNG);
}

console.log(`[icons] wrote ${PNG}`);
