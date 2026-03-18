import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("dantecode", {
  getVersion: (): Promise<string> => ipcRenderer.invoke("get-version"),
  getPlatform: (): Promise<string> => ipcRenderer.invoke("get-platform"),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke("open-external", url),
  getCwd: (): Promise<string> => ipcRenderer.invoke("get-cwd"),
  onShowAbout: (callback: () => void): void => {
    ipcRenderer.on("show-about", () => callback());
  },
  onOpenSettings: (callback: () => void): void => {
    ipcRenderer.on("open-settings", () => callback());
  },
});
