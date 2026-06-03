#!/usr/bin/env node
// Generate the macOS app icon (.icns + 1024² .png) from public/icon.svg.
//
// Frames the raw logo in Apple's Big Sur icon grid — an 824² rounded "squircle"
// body centered in a 1024² canvas (~100px transparent margin) — so the dock /
// Finder icon matches other macOS apps instead of being a full-bleed square.
//
// Two renderers, by capability:
//   • qlmanage (system WebKit) rasterizes the SVG. It handles gradients, CSS
//     `<style>` fills, filters, etc. — ImageMagick's built-in SVG renderer does
//     not (a gradient referenced from a CSS class renders solid black).
//   • ImageMagick only composites pixels (rounded-corner alpha mask, padding,
//     downscaling) — it never parses the SVG, so logo complexity can't break it.
//     qlmanage flattens alpha to white, so the corners must be cut here, after.
//
// macOS-only (qlmanage/iconutil). Skips gracefully without ImageMagick or off
// macOS, and no-ops when outputs are newer than the source — so the committed
// icons keep working without the toolchain.
import { execFileSync } from "node:child_process";
import {
  copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "public", "icon.svg");
const OUT_DIR = join(ROOT, "electron", "resources");
const ICNS = join(OUT_DIR, "icon.icns");
const PNG = join(OUT_DIR, "icon.png");

// Apple Big Sur icon grid (in a 1024² canvas).
const CANVAS = 1024;
const BODY = 824;                   // squircle body size
const RADIUS = 184;                 // ≈22.4% of body — matches the macOS corner

const run = (cmd, args) => execFileSync(cmd, args, { stdio: "ignore" });
const tool = (cands) => {
  for (const c of cands) {
    try { run(c, ["-version"]); return c; } catch { /* next */ }
  }
  return null;
};

if (process.platform !== "darwin") {
  console.warn("[icons] non-macOS host; skipping (needs qlmanage/iconutil).");
  process.exit(0);
}
if (!existsSync(SRC)) {
  console.warn(`[icons] ${SRC} not found; skipping.`);
  process.exit(0);
}

// No-op if both outputs are at least as new as the source.
const srcMtime = statSync(SRC).mtimeMs;
const fresh = (p) => existsSync(p) && statSync(p).mtimeMs >= srcMtime;
if (fresh(ICNS) && fresh(PNG)) {
  console.log("[icons] up to date.");
  process.exit(0);
}

const im = tool(["magick", "convert"]);
if (!im) {
  console.warn("[icons] ImageMagick not found; keeping existing icons. Install: brew install imagemagick");
  process.exit(0);
}

console.log("[icons] regenerating from public/icon.svg …");

const work = join(tmpdir(), "tabbycat-icons");
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

// 1. Rasterize the SVG faithfully (WebKit). qlmanage names output "<file>.png".
run("qlmanage", ["-t", "-s", String(BODY), "-o", work, SRC]);
const rendered = readdirSync(work).find((f) => f.endsWith(".png"));
if (!rendered) {
  console.error("[icons] qlmanage produced no output; aborting.");
  process.exit(1);
}

// 2. Normalize to an exact square body, then cut rounded corners with a drawn
//    mask, then pad onto a transparent canvas. ImageMagick only moves pixels.
const master = join(work, "master.png");
run(im, [
  join(work, rendered),
  "-resize", `${BODY}x${BODY}`, "-background", "none", "-gravity", "center", "-extent", `${BODY}x${BODY}`,
  "(", "-size", `${BODY}x${BODY}`, "xc:none", "-fill", "white",
  "-draw", `roundrectangle 0,0 ${BODY - 1},${BODY - 1} ${RADIUS},${RADIUS}`, ")",
  "-alpha", "off", "-compose", "CopyOpacity", "-composite",
  "-compose", "over", "-background", "none", "-gravity", "center", "-extent", `${CANVAS}x${CANVAS}`,
  master,
]);

// 3. Assemble the .iconset by downscaling the master (alpha preserved).
const iconset = join(work, "Tabbycat.iconset");
mkdirSync(iconset, { recursive: true });
const slots = [
  [16, "icon_16x16.png"], [32, "icon_16x16@2x.png"],
  [32, "icon_32x32.png"], [64, "icon_32x32@2x.png"],
  [128, "icon_128x128.png"], [256, "icon_128x128@2x.png"],
  [256, "icon_256x256.png"], [512, "icon_256x256@2x.png"],
  [512, "icon_512x512.png"], [1024, "icon_512x512@2x.png"],
];
for (const [size, name] of slots) {
  const dst = join(iconset, name);
  if (size === CANVAS) copyFileSync(master, dst);
  else run(im, [master, "-filter", "Lanczos", "-resize", `${size}x${size}`, dst]);
}

mkdirSync(OUT_DIR, { recursive: true });
run("iconutil", ["-c", "icns", iconset, "-o", ICNS]);
copyFileSync(master, PNG);

console.log(`[icons] wrote ${ICNS}`);
console.log(`[icons] wrote ${PNG}`);
