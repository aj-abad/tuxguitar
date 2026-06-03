import type { TGSong } from "./model";

export const IpcChannels = {
  // app
  appGetVersion: "app:getVersion",
  appPing: "app:ping",
  // file
  fileOpenDialog: "file:openDialog",
  // menu events (main → renderer via webContents.send)
  menuTriggerOpen: "menu:triggerOpen",
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
  versions: { node: string; chrome: string; electron: string };
  getVersion(): Promise<string>;
  ping(): Promise<"pong">;
  openFileDialog(): Promise<TGSong | null>;
  getSidecarStatus(): Promise<SidecarStatus>;
  play(): Promise<void>;
  stop(): Promise<void>;
  seek(tick: number): Promise<void>;
  /** Register a tick event listener. Returns an unsubscribe function. */
  onTick(callback: (event: TickEvent) => void): () => void;
  /** Register a playback-ended listener. Returns an unsubscribe function. */
  onPlaybackEnded(callback: () => void): () => void;
  /** Register a listener for menu-triggered file open. Returns an unsubscribe function. */
  onMenuTriggerOpen(callback: () => void): () => void;
}
