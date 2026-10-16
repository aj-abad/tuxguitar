import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, protocol, shell } from "electron";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, extname, isAbsolute, join, normalize } from "node:path";
import {
  IpcChannels,
  type TickEvent,
  type DocumentCommand,
  type DocumentEdits,
  type DocumentMenuState,
  type OpenDocument,
} from "../shared/ipc";
import {
  PRECISE_FACTOR,
  PRECISE_STARTING_POINT,
  type TGSong,
} from "../shared/model";
import { SidecarManager } from "./sidecar";
import { SongDocument } from "./documents";
import { PlaybackSession } from "./playback";
import { isSupportedSongFile, SONG_FILE_EXTENSIONS, SONG_FILE_FORMATS } from "../shared/file-formats";

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

// ---- app state -------------------------------------------------------------

const sidecar = new SidecarManager();
let lastSong: TGSong | null = null;
let activeDocument: SongDocument | null = null;
const playback = new PlaybackSession(sidecar, song => { lastSong = song; });
let allowClose = false;
// Guards against stacking native open dialogs: while one is open, concurrent
// requests (menu + button + repeated triggers) coalesce onto the in-flight one.
let openDialogPromise: Promise<OpenDocument | null> | null = null;
let saveDialogPromise: Promise<{ fileName: string } | null> | null = null;

async function runOpenFileDialog(): Promise<OpenDocument | null> {
  const { canceled, filePaths } = await dialog.showOpenDialog(getWin()!, {
    filters: [{ name: "TuxGuitar Files", extensions: SONG_FILE_EXTENSIONS }],
    properties: ["openFile"],
  });
  if (canceled || filePaths.length === 0) return null;
  return openDocument(filePaths[0]);
}

async function openDocument(filePath: string): Promise<OpenDocument> {
  if (typeof filePath !== "string" || !isAbsolute(filePath)) throw new Error("Choose a file from your computer.");
  if (!isSupportedSongFile(filePath)) throw new Error(`Unsupported file type. Supported format: ${SONG_FILE_FORMATS}.`);
  if (!statSync(filePath).isFile()) throw new Error("Folders cannot be opened as songs.");
  const document = new SongDocument(filePath);
  await stopPlayback();
  activeDocument = document;
  lastSong = document.song;
  return document.snapshot();
}

function requireDocument(request: DocumentEdits): SongDocument {
  if (!activeDocument || request?.id !== activeDocument.id) throw new Error("This document is no longer open.");
  return activeDocument;
}

async function stopPlayback(): Promise<void> {
  await playback.stop();
}

async function runSave(request: DocumentEdits, saveAs: boolean) {
  const document = requireDocument(request);
  let path = document.path;
  if (saveAs) {
    const result = await dialog.showSaveDialog(getWin()!, {
      defaultPath: path,
      filters: [{ name: "TuxGuitar Files", extensions: ["tg"] }],
    });
    if (result.canceled || !result.filePath) return null;
    path = result.filePath;
    if (extname(path).toLowerCase() !== ".tg") throw new Error("Use a filename ending in .tg.");
  }
  requireDocument(request); // the same document must still be open after the dialog
  return document.save(path, request.edits);
}

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

function requestCommand(command: DocumentCommand): void {
  getWin()?.webContents.send(IpcChannels.documentCommand, command);
}

// ---- native menu -----------------------------------------------------------

function buildAppMenu(): void {
  const stub = { enabled: false };

  const template: Electron.MenuItemConstructorOptions[] = [
    // macOS app menu
    ...(process.platform === "darwin" ? [{
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
    } as Electron.MenuItemConstructorOptions] : []),

    // File
    {
      label: "File",
      submenu: [
        { label: "New", accelerator: "CmdOrCtrl+N", ...stub },
        {
          label: "Open…",
          accelerator: "CmdOrCtrl+O",
          click: () => requestCommand("open"),
        },
        { label: "Open Recent", submenu: [{ label: "(empty)", ...stub }] },
        { label: "Open Example", submenu: [{ label: "(empty)", ...stub }] },
        { label: "Back to Tabs", accelerator: "CmdOrCtrl+B", ...stub },
        { type: "separator" },
        { label: "Close", accelerator: "CmdOrCtrl+W", click: () => getWin()?.close() },
        { label: "Close All", accelerator: "Shift+CmdOrCtrl+W", ...stub },
        { id: "save", label: "Save", accelerator: "CmdOrCtrl+S", enabled: false, click: () => requestCommand("save") },
        { id: "saveAs", label: "Save As…", accelerator: "Shift+CmdOrCtrl+S", enabled: false, click: () => requestCommand("saveAs") },
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
        { id: "undo", label: "Undo Edit", accelerator: "CmdOrCtrl+Z", enabled: false, click: () => requestCommand("undo") },
        { id: "redo", label: "Redo Edit", accelerator: "CmdOrCtrl+Shift+Z", enabled: false, click: () => requestCommand("redo") },
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
          click: () => requestCommand("reload"),
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
    ...(process.platform === "darwin" ? { titleBarStyle: "hidden" as const, transparent: true } : {}),
    backgroundColor: process.platform === "darwin" ? "#00000000" : "#18181b",
    show: process.env.TG_SMOKE !== "1" && process.env.TG_HEADLESS !== "1",
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (process.platform === "darwin") win.setVibrancy("hud");
  win.on("close", event => {
    if (!allowClose && activeDocument) {
      event.preventDefault();
      requestCommand("close");
    }
  });
  win.on("closed", () => {
    activeDocument = null;
    lastSong = null;
    allowClose = false;
    void stopPlayback().catch(console.error);
  });

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
        let info: { rootHtmlLen: number; bodyText: string; hasTg: string } | undefined;
        // First dev boot may still be optimizing dependencies after the page
        // loads. Check actual UI readiness rather than accepting a blank page.
        for (let attempt = 0; attempt < 100; attempt++) {
          info = await win.webContents.executeJavaScript(
            `({ rootHtmlLen: (document.getElementById('__nuxt')?.innerHTML || '').length,` +
              ` bodyText: (document.body?.innerText || '').slice(0, 160),` +
              ` hasTg: typeof window.tg })`,
          );
          if (info && info.rootHtmlLen > 500 && info.bodyText.includes("Tabbycat")) break;
          await new Promise(r => setTimeout(r, 300));
        }
        console.log(`[smoke] ${JSON.stringify(info)}`);
        app.exit(info && info.rootHtmlLen > 500 && info.hasTg === "object" ? 0 : 1);
      } catch (err) {
        console.error(`[smoke] eval failed: ${String(err)}`);
        app.exit(1);
      }
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http:") || url.startsWith("https:")) void shell.openExternal(url);
    return { action: "deny" };
  });

  // Forward sidecar tick events — convert qtick (0-based QT ticks) → precise ticks
  const onTick = ({ qtick, bpm }: { qtick: number; bpm: number }) => {
    if (win.isDestroyed()) return;
    const preciseTick = PRECISE_STARTING_POINT + qtick * PRECISE_FACTOR;
    const tickEvent: TickEvent = {
      tick: preciseTick,
      measure: measureAtPrecise(preciseTick, lastSong),
      bpm,
    };
    win.webContents.send(IpcChannels.sidecarTick, tickEvent);
  };
  const onEnded = () => {
    if (!win.isDestroyed()) win.webContents.send(IpcChannels.sidecarPlaybackEnded);
  };
  sidecar.on("tick", onTick);
  sidecar.on("playbackEnded", onEnded);
  win.on("closed", () => {
    sidecar.off("tick", onTick);
    sidecar.off("playbackEnded", onEnded);
  });

  if (isDev) {
    void win.loadURL(DEV_URL!);
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

  ipcMain.handle(IpcChannels.fileOpenDialog, () => {
    // Only one open dialog at a time — return the in-flight promise if present.
    if (openDialogPromise) return openDialogPromise;
    openDialogPromise = runOpenFileDialog().finally(() => {
      openDialogPromise = null;
    });
    return openDialogPromise;
  });

  ipcMain.handle(IpcChannels.fileOpenDropped, (_event, filePath: string) => {
    if (openDialogPromise || saveDialogPromise) throw new Error("Finish the current file operation first.");
    openDialogPromise = openDocument(filePath).finally(() => { openDialogPromise = null; });
    return openDialogPromise;
  });

  ipcMain.handle(IpcChannels.fileSave, (_e, request: DocumentEdits, saveAs: boolean) => {
    if (saveDialogPromise) return saveDialogPromise;
    saveDialogPromise = runSave(request, saveAs === true).finally(() => { saveDialogPromise = null; });
    return saveDialogPromise;
  });
  ipcMain.handle(IpcChannels.fileConfirmChanges, async () => {
    const { response } = await dialog.showMessageBox(getWin()!, {
      type: "question", buttons: ["Save", "Discard", "Cancel"], defaultId: 0, cancelId: 2,
      message: "Save your changes?", detail: "Your changes will be lost if you discard them.",
    });
    return ["save", "discard", "cancel"][response] ?? "cancel";
  });
  ipcMain.on(IpcChannels.documentMenuState, (_e, state: DocumentMenuState) => {
    const menu = Menu.getApplicationMenu();
    for (const [id, enabled] of Object.entries({ save: state.hasSong, saveAs: state.hasSong,
      undo: state.canUndo, redo: state.canRedo })) {
      const item = menu?.getMenuItemById(id);
      if (item) item.enabled = enabled && !state.busy;
    }
    const win = getWin();
    win?.setTitle(`${activeDocument ? basename(activeDocument.path) : "Tabbycat"}${state.dirty ? " •" : ""} — Tabbycat`);
    if (process.platform === "darwin") win?.setDocumentEdited(state.dirty);
  });
  ipcMain.on(IpcChannels.windowClose, () => { allowClose = true; getWin()?.close(); });
  ipcMain.on(IpcChannels.windowReload, () => {
    void stopPlayback().catch(console.error).finally(() => {
      activeDocument = null;
      lastSong = null;
      getWin()?.webContents.reload();
    });
  });

  ipcMain.handle(IpcChannels.sidecarStatus, () => sidecar.status);

  // play — always restarts from the beginning
  ipcMain.handle(IpcChannels.sidecarPlay, async (_e, request: DocumentEdits) => {
    const song = requireDocument(request).editedSong(request.edits);
    await playback.play(song);
  });

  ipcMain.handle(IpcChannels.sidecarStop, stopPlayback);

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
  sidecar.kill();
});
