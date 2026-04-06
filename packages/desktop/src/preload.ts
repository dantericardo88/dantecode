import { contextBridge, ipcRenderer } from "electron";

/**
 * Preload script: exposes a safe, typed API surface to the renderer process.
 *
 * Security:
 * - Only specific IPC channels are exposed — no raw ipcRenderer access
 * - No Node.js APIs leak to the renderer (contextIsolation: true, sandbox: true)
 * - Callbacks use one-way IPC (ipcRenderer.on), not invoke
 */
contextBridge.exposeInMainWorld("dantecode", {
  // --- Utility ---
  getVersion: (): Promise<string> => ipcRenderer.invoke("get-version"),
  getPlatform: (): Promise<string> => ipcRenderer.invoke("get-platform"),
  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke("open-external", url),
  getCwd: (): Promise<string> => ipcRenderer.invoke("get-cwd"),

  // --- Agent operations ---
  runPrompt: (prompt: string): Promise<{ success: boolean; output?: string; error?: string }> =>
    ipcRenderer.invoke("agent:run-prompt", prompt),
  getStatus: (): Promise<{ running: boolean; model: string }> =>
    ipcRenderer.invoke("agent:get-status"),
  abort: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke("agent:abort"),

  /**
   * Subscribe to streaming agent output. The callback fires each time
   * the agent subprocess writes to stdout/stderr.
   * Call this once; subsequent calls add additional listeners.
   */
  onOutput: (callback: (data: string) => void): void => {
    // Subscribe on the main process side
    ipcRenderer.send("agent:subscribe-output");
    // Listen for data pushed from main
    ipcRenderer.on("agent:output", (_event, data: string) => callback(data));
  },

  // --- UI events from main process ---
  onShowAbout: (callback: () => void): void => {
    ipcRenderer.on("show-about", () => callback());
  },
  onOpenSettings: (callback: () => void): void => {
    ipcRenderer.on("open-settings", () => callback());
  },
});
