import type { TGSong } from "./model";
import type { SongEdit } from "./editor";

export interface OpenDocument { id: string; fileName: string; song: TGSong }
export interface DocumentEdits { id: string; edits: SongEdit[] }
export type DocumentCommand = "open" | "save" | "saveAs" | "undo" | "redo" | "close" | "reload";
export interface DocumentMenuState { hasSong: boolean; dirty: boolean; busy: boolean; canUndo: boolean; canRedo: boolean }

export const IpcChannels = {
  // app
  appGetVersion: "app:getVersion",
  appPing: "app:ping",
  // file
  fileOpenDialog: "file:openDialog",
  fileOpenDropped: "file:openDropped",
  fileSave: "file:save",
  fileConfirmChanges: "file:confirmChanges",
  documentMenuState: "document:menuState",
  documentCommand: "document:command",
  windowClose: "window:close",
  windowReload: "window:reload",
  // menu events (main → renderer via webContents.send)
  // sidecar invoke (renderer → main)
  sidecarStatus: "sidecar:status",
  sidecarPlay: "sidecar:play",
  sidecarStop: "sidecar:stop",
  sidecarSeek: "sidecar:seek",
  // sidecar events (main → renderer via webContents.send)
  sidecarTick: "sidecar:tick",
  sidecarPlaybackEnded: "sidecar:playbackEnded",
} as const;

export type SidecarStatus = "not-found" | "starting" | "ready" | "error";

export interface TickEvent {
  tick: number;    // current playback position in WHOLE_PRECISE_DURATION units
  measure: number; // 1-based current measure
  bpm: number;     // current tempo in BPM
}

export interface TgBridge {
  platform: string;
  versions: { node: string; chrome: string; electron: string };
  getVersion(): Promise<string>;
  ping(): Promise<"pong">;
  openFileDialog(): Promise<OpenDocument | null>;
  openDroppedFile(file: File): Promise<OpenDocument>;
  saveFile(document: DocumentEdits, saveAs: boolean): Promise<{ fileName: string } | null>;
  confirmChanges(): Promise<"save" | "discard" | "cancel">;
  updateMenu(state: DocumentMenuState): void;
  onDocumentCommand(callback: (command: DocumentCommand) => void): () => void;
  closeWindow(): void;
  reloadWindow(): void;
  getSidecarStatus(): Promise<SidecarStatus>;
  play(document: DocumentEdits): Promise<void>;
  stop(): Promise<void>;
  seek(tick: number): Promise<void>;
  /** Register a tick event listener. Returns an unsubscribe function. */
  onTick(callback: (event: TickEvent) => void): () => void;
  /** Register a playback-ended listener. Returns an unsubscribe function. */
  onPlaybackEnded(callback: () => void): () => void;
}
