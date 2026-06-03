import { contextBridge, ipcRenderer } from "electron";
import { IpcChannels, type TgBridge, type TickEvent } from "../shared/ipc";

const bridge: TgBridge = {
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron,
  },

  getVersion: () => ipcRenderer.invoke(IpcChannels.appGetVersion),
  ping: () => ipcRenderer.invoke(IpcChannels.appPing),

  openFileDialog: () => ipcRenderer.invoke(IpcChannels.fileOpenDialog),

  getSidecarStatus: () => ipcRenderer.invoke(IpcChannels.sidecarStatus),

  play: () => ipcRenderer.invoke(IpcChannels.sidecarPlay),

  stop: () => ipcRenderer.invoke(IpcChannels.sidecarStop),

  seek: (tick: number) => ipcRenderer.invoke(IpcChannels.sidecarSeek, tick),

  onTick: (callback: (event: TickEvent) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, event: TickEvent) =>
      callback(event);
    ipcRenderer.on(IpcChannels.sidecarTick, handler);
    return () => ipcRenderer.removeListener(IpcChannels.sidecarTick, handler);
  },

  onPlaybackEnded: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on(IpcChannels.sidecarPlaybackEnded, handler);
    return () => ipcRenderer.removeListener(IpcChannels.sidecarPlaybackEnded, handler);
  },

  onMenuTriggerOpen: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on(IpcChannels.menuTriggerOpen, handler);
    return () => ipcRenderer.removeListener(IpcChannels.menuTriggerOpen, handler);
  },
};

contextBridge.exposeInMainWorld("tg", bridge);
