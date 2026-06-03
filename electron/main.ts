import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, protocol, shell } from "electron";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import {
  IpcChannels,
  type TickEvent,
} from "../shared/ipc";
import {
  PRECISE_FACTOR,
  PRECISE_STARTING_POINT,
  WHOLE_PRECISE_DURATION,
  type TGMeasureHeader,
  type TGSong,
} from "../shared/model";
import { exportMidi, TPQ } from "../shared/midi-export";
import { parseTgFile, validateFirstBeatPreciseStart } from "../shared/tg-reader";
import { SidecarManager } from "./sidecar";

const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const isDev = !!DEV_URL;

const RENDERER_DIST = normalize(join(__dirname, "../.output/public"));
const APP_SCHEME = "app";
const APP_ORIGIN = `${APP_SCHEME}://bundle`;

// Branding. Drives the macOS app menu, the "About Tabbycat" item, and the
// dock/menu-bar name. package.json's `name` must stay lowercase (npm rule),
// so set the display name explicitly here. Packaged builds also get this from
// electron-builder's productName (CFBundleName); this covers `electron .` dev.
const APP_NAME = "Tabbycat";
app.setName(APP_NAME);

// Path to the raster app icon, used for the dev dock tile (packaged builds use
// the bundle's .icns). __dirname is dist-electron/ at runtime.
const ICON_PATH = join(__dirname, "..", "electron", "resources", "icon.png");

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".eot": "application/vnd.ms-fontobject",
  ".map": "application/json",
};

// 'unsafe-inline' for script-src is required because Nuxt generates an
// inline window.__NUXT__ config block whose hash changes every build.
// The renderer has no Node access (nodeIntegration:false, sandbox:true)
// so the practical risk of inline scripts here is low.
const PROD_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self'",
].join("; ");

function serveBundle(pathname: string): Response {
  let rel = decodeURIComponent(pathname);
  if (rel === "/" || rel === "") rel = "/index.html";
  let file = normalize(join(RENDERER_DIST, rel));
  if (!file.startsWith(RENDERER_DIST)) file = join(RENDERER_DIST, "index.html");
  if (!existsSync(file)) file = join(RENDERER_DIST, "index.html");
  const body = readFileSync(file);
  const type = MIME[extname(file).toLowerCase()] ?? "application/octet-stream";
  return new Response(body, {
    headers: { "content-type": type, "content-security-policy": PROD_CSP },
  });
}

// ---- PlaybackClock ----------------------------------------------------------
// In-process tick emitter for Spike 0a and until the real GraalVM sidecar is
// built. Emits one tick per beat (quarter note) at the song's tempo.
// When the real sidecar is ready, replace this with the sidecar's tick stream.

class PlaybackClock {
  private timer: ReturnType<typeof setInterval> | null = null;
  private beatsEmitted = 0;
  private totalBeats = 0;
  private bpm = 120;
  private ticksPerBeat = WHOLE_PRECISE_DURATION / 4;
  private measureStarts: Array<{ number: number; preciseTick: number }> = [];

  start(song: TGSong, win: BrowserWindow): void {
    this.stop();

    this.bpm = song.measureHeaders[0]?.tempo ?? 120;
    this.beatsEmitted = 0;

    // Total quarter-note beats in the song
    this.totalBeats = song.measureHeaders.reduce(
      (sum, h) => sum + h.timeSignature.numerator * (4 / h.timeSignature.denominator),
      0,
    );

    this.measureStarts = song.measureHeaders.map((h: TGMeasureHeader) => ({
      number: h.number,
      preciseTick: h.start * PRECISE_FACTOR,
    }));

    const beatMs = 60000 / this.bpm;

    const emit = () => {
      if (this.beatsEmitted >= this.totalBeats) {
        this.stop();
        if (!win.isDestroyed()) {
          win.webContents.send(IpcChannels.sidecarPlaybackEnded);
        }
        return;
      }

      const tick: TickEvent = {
        tick: PRECISE_STARTING_POINT + this.beatsEmitted * this.ticksPerBeat,
        measure: this.measureAtTick(PRECISE_STARTING_POINT + this.beatsEmitted * this.ticksPerBeat),
        bpm: this.bpm,
      };
      if (!win.isDestroyed()) {
        win.webContents.send(IpcChannels.sidecarTick, tick);
      }
      this.beatsEmitted++;
    };

    emit(); // first tick immediately
    this.timer = setInterval(emit, beatMs);
  }

  private measureAtTick(preciseTick: number): number {
    let m = 1;
    for (const ms of this.measureStarts) {
      if (preciseTick >= ms.preciseTick) m = ms.number;
      else break;
    }
    return m;
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.beatsEmitted = 0;
  }

  get running(): boolean {
    return this.timer !== null;
  }
}

// ---- app state -------------------------------------------------------------

const sidecar = new SidecarManager();
const clock = new PlaybackClock();
let lastSong: TGSong | null = null;

function measureAtPrecise(preciseTick: number, song: TGSong | null): number {
  if (!song) return 1;
  let m = 1;
  for (const h of song.measureHeaders) {
    if (preciseTick >= h.start * PRECISE_FACTOR) m = h.number;
    else break;
  }
  return m;
}

function getWin(): BrowserWindow | undefined {
  return BrowserWindow.getAllWindows()[0];
}

// ---- native menu -----------------------------------------------------------

function buildAppMenu(): void {
  const stub = { enabled: false };

  const template: Electron.MenuItemConstructorOptions[] = [
    // macOS app menu
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },

    // File
    {
      label: "File",
      submenu: [
        { label: "New", accelerator: "CmdOrCtrl+N", ...stub },
        {
          label: "Open…",
          accelerator: "CmdOrCtrl+O",
          click: () => {
            const win = getWin();
            if (win) win.webContents.send(IpcChannels.menuTriggerOpen);
          },
        },
        { label: "Open Recent", submenu: [{ label: "(empty)", ...stub }] },
        { label: "Open Example", submenu: [{ label: "(empty)", ...stub }] },
        { label: "Back to Tabs", accelerator: "CmdOrCtrl+B", ...stub },
        { type: "separator" },
        { label: "Close", accelerator: "CmdOrCtrl+W", ...stub },
        { label: "Close All", accelerator: "Shift+CmdOrCtrl+W", ...stub },
        { label: "Save", accelerator: "CmdOrCtrl+S", ...stub },
        { label: "Save As…", accelerator: "Shift+CmdOrCtrl+S", ...stub },
        { label: "Save As Template…", ...stub },
        { label: "Open Containing Folder", ...stub },
        { type: "separator" },
        { label: "Import", submenu: [{ label: "(empty)", ...stub }] },
        { label: "Export", submenu: [{ label: "(empty)", ...stub }] },
        { label: "Batch Converter…", ...stub },
        { type: "separator" },
        { label: "Print…", accelerator: "CmdOrCtrl+P", ...stub },
        { type: "separator" },
        { label: "Lock/Unlock…", ...stub },
        { label: "Stylesheet…", accelerator: "F7", ...stub },
      ],
    },

    // Edit
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },

    // View
    {
      label: "View",
      submenu: [
        {
          label: "Force Reload",
          accelerator: "CmdOrCtrl+R",
          click: () => getWin()?.webContents.reloadIgnoringCache(),
        },
        ...(isDev
          ? [
              { role: "toggleDevTools" as const },
              { type: "separator" as const },
            ]
          : []),
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
      ],
    },

    // Window
    {
      label: "Window",
      role: "window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        { type: "separator" },
        { role: "front" },
      ],
    },

    // Help
    {
      role: "help",
      submenu: [
        { label: "Tabbycat on GitHub", ...stub },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---- window ----------------------------------------------------------------

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    titleBarStyle: "hidden",
    transparent: true,
    backgroundColor: "#00000000",
    show: process.env.TG_SMOKE !== "1",
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.setVibrancy("hud");

  win.webContents.on("console-message", (e: any, level?: any, message?: any) => {
    const text = e && typeof e === "object" && "message" in e ? e.message : message;
    if (text) console.log(`[renderer] ${text}`);
  });
  win.webContents.on("render-process-gone", (_e, details) => {
    console.error(`[main] render-process-gone: ${details.reason}`);
  });
  win.webContents.on("did-fail-load", (_e, code, desc, url) => {
    console.error(`[main] did-fail-load ${code} ${desc} ${url}`);
    if (process.env.TG_SMOKE === "1") app.exit(1);
  });
  win.webContents.on("did-finish-load", async () => {
    console.log(`[main] loaded ${win.webContents.getURL()}`);
    if (process.env.TG_SMOKE === "1") {
      try {
        await new Promise((r) => setTimeout(r, 2000));
        const info = await win.webContents.executeJavaScript(
          `({ rootHtmlLen: (document.getElementById('__nuxt')?.innerHTML || '').length,` +
            ` bodyText: (document.body?.innerText || '').slice(0, 160),` +
            ` hasTg: typeof window.tg })`,
        );
        console.log(`[smoke] ${JSON.stringify(info)}`);
      } catch (err) {
        console.error(`[smoke] eval failed: ${String(err)}`);
      }
      app.exit(0);
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http:") || url.startsWith("https:")) void shell.openExternal(url);
    return { action: "deny" };
  });

  // When sidecar finishes initializing and a song is already open, send its MIDI events.
  sidecar.on("status", (s: string) => {
    if (s === "ready" && lastSong) {
      const events = exportMidi(lastSong);
      sidecar.load(events, TPQ).catch(e => console.error("[main] sidecar load on ready:", e));
    }
  });

  // Forward sidecar tick events — convert qtick (0-based QT ticks) → precise ticks
  sidecar.on("tick", ({ qtick, bpm }: { qtick: number; bpm: number }) => {
    if (win.isDestroyed()) return;
    const preciseTick = PRECISE_STARTING_POINT + qtick * PRECISE_FACTOR;
    const tickEvent: TickEvent = {
      tick: preciseTick,
      measure: measureAtPrecise(preciseTick, lastSong),
      bpm,
    };
    win.webContents.send(IpcChannels.sidecarTick, tickEvent);
  });
  sidecar.on("playbackEnded", () => {
    if (!win.isDestroyed()) win.webContents.send(IpcChannels.sidecarPlaybackEnded);
  });

  if (isDev) {
    void win.loadURL(DEV_URL!);
    if (process.env.TG_SMOKE !== "1") win.webContents.openDevTools({ mode: "detach" });
  } else {
    void win.loadURL(`${APP_ORIGIN}/`);
  }
}

if (!isDev && !app.requestSingleInstanceLock()) {
  app.quit();
} else if (!isDev) {
  app.on("second-instance", () => {
    const win = getWin();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}

void app.whenReady().then(() => {
  if (!isDev) {
    protocol.handle(APP_SCHEME, (request) => serveBundle(new URL(request.url).pathname));
  }

  ipcMain.handle(IpcChannels.appGetVersion, () => app.getVersion());
  ipcMain.handle(IpcChannels.appPing, () => "pong" as const);

  ipcMain.handle(IpcChannels.fileOpenDialog, async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      filters: [
        { name: "TuxGuitar Files", extensions: ["tg"] },
        {
          name: "All Supported",
          extensions: ["tg", "gp3", "gp4", "gp5", "gp", "gpx", "ptb", "tef", "mxml", "xml", "mid", "midi"],
        },
      ],
      properties: ["openFile"],
    });
    if (canceled || filePaths.length === 0) return null;
    const filePath = filePaths[0];

    if (filePath.endsWith(".tg")) {
      try {
        const bytes = readFileSync(filePath);
        const song = parseTgFile(new Uint8Array(bytes));
        validateFirstBeatPreciseStart(song);
        lastSong = song;
        if (sidecar.status === "ready") {
          const events = exportMidi(song);
          sidecar.load(events, TPQ).catch(e => console.error("[main] sidecar load failed:", e));
        }
        return song;
      } catch (err) {
        console.error(`[main] failed to parse .tg: ${String(err)}`);
        return null;
      }
    }
    return null;
  });

  ipcMain.handle(IpcChannels.sidecarStatus, () => sidecar.status);

  // play — always restarts from the beginning
  ipcMain.handle(IpcChannels.sidecarPlay, (_e) => {
    const win = getWin();
    if (!win) return;
    clock.stop();
    if (sidecar.status === "ready") {
      void sidecar.play(0).catch(console.error);
    } else if (lastSong) {
      clock.start(lastSong, win);
    }
  });

  ipcMain.handle(IpcChannels.sidecarStop, () => {
    clock.stop();
    if (sidecar.status === "ready") void sidecar.stop().catch(() => {});
  });

  ipcMain.handle(IpcChannels.sidecarSeek, (_e, tick: number) => {
    if (sidecar.status === "ready") void sidecar.seek(tick).catch(() => {});
  });

  app.setAboutPanelOptions({
    applicationName: APP_NAME,
    applicationVersion: app.getVersion(),
  });

  // Dock icon for unpackaged dev runs; packaged .app uses its bundle icon.
  if (process.platform === "darwin" && !app.isPackaged && app.dock && existsSync(ICON_PATH)) {
    app.dock.setIcon(nativeImage.createFromPath(ICON_PATH));
  }

  buildAppMenu();
  sidecar.start();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => {
  clock.stop();
  sidecar.kill();
});
