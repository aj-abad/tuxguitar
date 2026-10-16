import { contextBridge, ipcRenderer, webUtils } from "electron";
import { IpcChannels, type TgBridge, type TickEvent, type DocumentCommand } from "../shared/ipc";

const bridge: TgBridge = {
  platform: process.platform,
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron,
  },

  getVersion: () => ipcRenderer.invoke(IpcChannels.appGetVersion),
  ping: () => ipcRenderer.invoke(IpcChannels.appPing),

  openFileDialog: () => ipcRenderer.invoke(IpcChannels.fileOpenDialog),
  openDroppedFile: async file => {
    // Resolve native File objects here; neither Node nor file paths need to be
    // exposed to the renderer, and JS-created files have no filesystem path.
    const path = webUtils.getPathForFile(file);
    if (!path) throw new Error("Drop a file from your computer.");
    return ipcRenderer.invoke(IpcChannels.fileOpenDropped, path);
  },
  saveFile: (document, saveAs) => ipcRenderer.invoke(IpcChannels.fileSave, document, saveAs),
  confirmChanges: () => ipcRenderer.invoke(IpcChannels.fileConfirmChanges),
  updateMenu: state => ipcRenderer.send(IpcChannels.documentMenuState, state),
  closeWindow: () => ipcRenderer.send(IpcChannels.windowClose),
  reloadWindow: () => ipcRenderer.send(IpcChannels.windowReload),
  onDocumentCommand: callback => {
    const handler = (_e: Electron.IpcRendererEvent, command: DocumentCommand) => callback(command);
    ipcRenderer.on(IpcChannels.documentCommand, handler);
    return () => ipcRenderer.removeListener(IpcChannels.documentCommand, handler);
  },

  getSidecarStatus: () => ipcRenderer.invoke(IpcChannels.sidecarStatus),

  play: document => ipcRenderer.invoke(IpcChannels.sidecarPlay, document),

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

};

contextBridge.exposeInMainWorld("tg", bridge);
