import { describe, it, expect, vi, beforeEach } from "vitest";

type EventHandler = (...args: unknown[]) => unknown;

// ---------------------------------------------------------------------------
// Mock electron module before import
// ---------------------------------------------------------------------------

const mockWindowOn = vi.fn();
const mockWindowOnce = vi.fn();
const mockWindowLoadFile = vi.fn();
const mockWindowLoadURL = vi.fn();
const mockWindowShow = vi.fn();
const mockWebContents = { send: vi.fn() };

const mockBrowserWindowInstance = {
  on: mockWindowOn,
  once: mockWindowOnce,
  loadFile: mockWindowLoadFile,
  loadURL: mockWindowLoadURL,
  show: mockWindowShow,
  webContents: mockWebContents,
};

const MockBrowserWindow = vi.fn(() => mockBrowserWindowInstance) as unknown as {
  new (): typeof mockBrowserWindowInstance;
  getAllWindows: ReturnType<typeof vi.fn>;
};
(MockBrowserWindow as unknown as { getAllWindows: ReturnType<typeof vi.fn> }).getAllWindows = vi
  .fn()
  .mockReturnValue([]);

const mockApp = {
  whenReady: vi.fn().mockResolvedValue(undefined),
  on: vi.fn(),
  quit: vi.fn(),
  getVersion: vi.fn().mockReturnValue("1.0.0"),
};

const mockIpcMain = {
  handle: vi.fn(),
};

const mockShell = {
  openExternal: vi.fn().mockResolvedValue(undefined),
};

const mockMenu = {
  buildFromTemplate: vi.fn().mockReturnValue({}),
  setApplicationMenu: vi.fn(),
};

vi.mock("electron", () => ({
  app: mockApp,
  BrowserWindow: MockBrowserWindow,
  ipcMain: mockIpcMain,
  shell: mockShell,
  Menu: mockMenu,
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn().mockReturnValue(false),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Desktop App", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the whenReady mock to return a fresh resolved promise
    mockApp.whenReady.mockResolvedValue(undefined);
  });

  describe("Module loading", () => {
    it("calls app.whenReady on module import", async () => {
      vi.resetModules();
      // Re-register mocks after module reset
      vi.doMock("electron", () => ({
        app: mockApp,
        BrowserWindow: MockBrowserWindow,
        ipcMain: mockIpcMain,
        shell: mockShell,
        Menu: mockMenu,
      }));
      vi.doMock("node:fs", () => ({
        existsSync: vi.fn().mockReturnValue(false),
      }));

      await import("./main.js");
      expect(mockApp.whenReady).toHaveBeenCalledTimes(1);
    }, 10000);

    it("registers window-all-closed handler", async () => {
      vi.resetModules();
      vi.doMock("electron", () => ({
        app: mockApp,
        BrowserWindow: MockBrowserWindow,
        ipcMain: mockIpcMain,
        shell: mockShell,
        Menu: mockMenu,
      }));
      vi.doMock("node:fs", () => ({
        existsSync: vi.fn().mockReturnValue(false),
      }));

      await import("./main.js");
      const onCalls = mockApp.on.mock.calls as [string, EventHandler][];
      const windowAllClosedCall = onCalls.find((c) => c[0] === "window-all-closed");
      expect(windowAllClosedCall).toBeDefined();
    });
  });

  describe("IPC handlers", () => {
    it("sets up all 4 IPC handlers after ready", async () => {
      vi.resetModules();
      vi.doMock("electron", () => ({
        app: mockApp,
        BrowserWindow: MockBrowserWindow,
        ipcMain: mockIpcMain,
        shell: mockShell,
        Menu: mockMenu,
      }));
      vi.doMock("node:fs", () => ({
        existsSync: vi.fn().mockReturnValue(false),
      }));

      await import("./main.js");
      // Wait for the whenReady promise to resolve and .then() to run
      await new Promise((r) => setTimeout(r, 10));

      expect(mockIpcMain.handle).toHaveBeenCalledTimes(4);
    });

    it("registers get-version handler", async () => {
      vi.resetModules();
      vi.doMock("electron", () => ({
        app: mockApp,
        BrowserWindow: MockBrowserWindow,
        ipcMain: mockIpcMain,
        shell: mockShell,
        Menu: mockMenu,
      }));
      vi.doMock("node:fs", () => ({
        existsSync: vi.fn().mockReturnValue(false),
      }));

      await import("./main.js");
      await new Promise((r) => setTimeout(r, 10));

      const handleCalls = mockIpcMain.handle.mock.calls as [string, EventHandler][];
      const channels = handleCalls.map((c) => c[0]);
      expect(channels).toContain("get-version");
    });

    it("registers get-platform handler", async () => {
      vi.resetModules();
      vi.doMock("electron", () => ({
        app: mockApp,
        BrowserWindow: MockBrowserWindow,
        ipcMain: mockIpcMain,
        shell: mockShell,
        Menu: mockMenu,
      }));
      vi.doMock("node:fs", () => ({
        existsSync: vi.fn().mockReturnValue(false),
      }));

      await import("./main.js");
      await new Promise((r) => setTimeout(r, 10));

      const handleCalls = mockIpcMain.handle.mock.calls as [string, EventHandler][];
      const channels = handleCalls.map((c) => c[0]);
      expect(channels).toContain("get-platform");
    });

    it("registers open-external handler", async () => {
      vi.resetModules();
      vi.doMock("electron", () => ({
        app: mockApp,
        BrowserWindow: MockBrowserWindow,
        ipcMain: mockIpcMain,
        shell: mockShell,
        Menu: mockMenu,
      }));
      vi.doMock("node:fs", () => ({
        existsSync: vi.fn().mockReturnValue(false),
      }));

      await import("./main.js");
      await new Promise((r) => setTimeout(r, 10));

      const handleCalls = mockIpcMain.handle.mock.calls as [string, EventHandler][];
      const channels = handleCalls.map((c) => c[0]);
      expect(channels).toContain("open-external");
    });

    it("registers get-cwd handler", async () => {
      vi.resetModules();
      vi.doMock("electron", () => ({
        app: mockApp,
        BrowserWindow: MockBrowserWindow,
        ipcMain: mockIpcMain,
        shell: mockShell,
        Menu: mockMenu,
      }));
      vi.doMock("node:fs", () => ({
        existsSync: vi.fn().mockReturnValue(false),
      }));

      await import("./main.js");
      await new Promise((r) => setTimeout(r, 10));

      const handleCalls = mockIpcMain.handle.mock.calls as [string, EventHandler][];
      const channels = handleCalls.map((c) => c[0]);
      expect(channels).toContain("get-cwd");
    });

    it("get-version handler returns app version", async () => {
      vi.resetModules();
      vi.doMock("electron", () => ({
        app: mockApp,
        BrowserWindow: MockBrowserWindow,
        ipcMain: mockIpcMain,
        shell: mockShell,
        Menu: mockMenu,
      }));
      vi.doMock("node:fs", () => ({
        existsSync: vi.fn().mockReturnValue(false),
      }));

      await import("./main.js");
      await new Promise((r) => setTimeout(r, 10));

      const handleCalls = mockIpcMain.handle.mock.calls as [string, EventHandler][];
      const versionHandler = handleCalls.find((c) => c[0] === "get-version");
      expect(versionHandler).toBeDefined();
      const result = versionHandler![1]();
      expect(result).toBe("1.0.0");
    });
  });

  describe("Menu", () => {
    it("builds menu from template after ready", async () => {
      vi.resetModules();
      vi.doMock("electron", () => ({
        app: mockApp,
        BrowserWindow: MockBrowserWindow,
        ipcMain: mockIpcMain,
        shell: mockShell,
        Menu: mockMenu,
      }));
      vi.doMock("node:fs", () => ({
        existsSync: vi.fn().mockReturnValue(false),
      }));

      await import("./main.js");
      await new Promise((r) => setTimeout(r, 10));

      expect(mockMenu.buildFromTemplate).toHaveBeenCalledTimes(1);
      expect(mockMenu.setApplicationMenu).toHaveBeenCalledTimes(1);
    });

    it("menu template has 4 top-level menus", async () => {
      vi.resetModules();
      vi.doMock("electron", () => ({
        app: mockApp,
        BrowserWindow: MockBrowserWindow,
        ipcMain: mockIpcMain,
        shell: mockShell,
        Menu: mockMenu,
      }));
      vi.doMock("node:fs", () => ({
        existsSync: vi.fn().mockReturnValue(false),
      }));

      await import("./main.js");
      await new Promise((r) => setTimeout(r, 10));

      const template = mockMenu.buildFromTemplate.mock.calls[0]![0] as Array<{
        label: string;
      }>;
      expect(template).toHaveLength(4);
      expect(template.map((m) => m.label)).toEqual(["DanteCode", "Edit", "View", "Help"]);
    });
  });

  describe("Window", () => {
    it("creates BrowserWindow after ready", async () => {
      vi.resetModules();
      vi.doMock("electron", () => ({
        app: mockApp,
        BrowserWindow: MockBrowserWindow,
        ipcMain: mockIpcMain,
        shell: mockShell,
        Menu: mockMenu,
      }));
      vi.doMock("node:fs", () => ({
        existsSync: vi.fn().mockReturnValue(false),
      }));

      await import("./main.js");
      await new Promise((r) => setTimeout(r, 10));

      expect(MockBrowserWindow).toHaveBeenCalledTimes(1);
    });

    it("BrowserWindow config includes correct dimensions", async () => {
      vi.resetModules();
      vi.doMock("electron", () => ({
        app: mockApp,
        BrowserWindow: MockBrowserWindow,
        ipcMain: mockIpcMain,
        shell: mockShell,
        Menu: mockMenu,
      }));
      vi.doMock("node:fs", () => ({
        existsSync: vi.fn().mockReturnValue(false),
      }));

      await import("./main.js");
      await new Promise((r) => setTimeout(r, 10));

      const config = (MockBrowserWindow as unknown as ReturnType<typeof vi.fn>).mock
        .calls[0]![0] as Record<string, unknown>;
      expect(config.width).toBe(1200);
      expect(config.height).toBe(800);
      expect(config.minWidth).toBe(800);
      expect(config.minHeight).toBe(600);
    });

    it("BrowserWindow config enables context isolation", async () => {
      vi.resetModules();
      vi.doMock("electron", () => ({
        app: mockApp,
        BrowserWindow: MockBrowserWindow,
        ipcMain: mockIpcMain,
        shell: mockShell,
        Menu: mockMenu,
      }));
      vi.doMock("node:fs", () => ({
        existsSync: vi.fn().mockReturnValue(false),
      }));

      await import("./main.js");
      await new Promise((r) => setTimeout(r, 10));

      const config = (MockBrowserWindow as unknown as ReturnType<typeof vi.fn>).mock
        .calls[0]![0] as Record<string, unknown>;
      const webPrefs = config.webPreferences as Record<string, unknown>;
      expect(webPrefs.contextIsolation).toBe(true);
      expect(webPrefs.nodeIntegration).toBe(false);
      expect(webPrefs.sandbox).toBe(true);
    });

    it("window is hidden initially (show: false)", async () => {
      vi.resetModules();
      vi.doMock("electron", () => ({
        app: mockApp,
        BrowserWindow: MockBrowserWindow,
        ipcMain: mockIpcMain,
        shell: mockShell,
        Menu: mockMenu,
      }));
      vi.doMock("node:fs", () => ({
        existsSync: vi.fn().mockReturnValue(false),
      }));

      await import("./main.js");
      await new Promise((r) => setTimeout(r, 10));

      const config = (MockBrowserWindow as unknown as ReturnType<typeof vi.fn>).mock
        .calls[0]![0] as Record<string, unknown>;
      expect(config.show).toBe(false);
    });

    it("loads data URL when index.html does not exist", async () => {
      vi.resetModules();
      vi.doMock("electron", () => ({
        app: mockApp,
        BrowserWindow: MockBrowserWindow,
        ipcMain: mockIpcMain,
        shell: mockShell,
        Menu: mockMenu,
      }));
      vi.doMock("node:fs", () => ({
        existsSync: vi.fn().mockReturnValue(false),
      }));

      await import("./main.js");
      await new Promise((r) => setTimeout(r, 10));

      expect(mockWindowLoadURL).toHaveBeenCalledTimes(1);
      const url = mockWindowLoadURL.mock.calls[0]![0] as string;
      expect(url).toContain("data:text/html");
      expect(url).toContain("DanteCode");
    });

    it("default HTML includes branding elements", async () => {
      vi.resetModules();
      vi.doMock("electron", () => ({
        app: mockApp,
        BrowserWindow: MockBrowserWindow,
        ipcMain: mockIpcMain,
        shell: mockShell,
        Menu: mockMenu,
      }));
      vi.doMock("node:fs", () => ({
        existsSync: vi.fn().mockReturnValue(false),
      }));

      await import("./main.js");
      await new Promise((r) => setTimeout(r, 10));

      const url = mockWindowLoadURL.mock.calls[0]![0] as string;
      const decoded = decodeURIComponent(url.replace("data:text/html;charset=utf-8,", ""));
      expect(decoded).toContain("DanteCode");
      expect(decoded).toContain("DanteForge");
      expect(decoded).toContain("Grok-3");
      expect(decoded).toContain("prompt-input");
    });

    it("registers ready-to-show handler", async () => {
      vi.resetModules();
      vi.doMock("electron", () => ({
        app: mockApp,
        BrowserWindow: MockBrowserWindow,
        ipcMain: mockIpcMain,
        shell: mockShell,
        Menu: mockMenu,
      }));
      vi.doMock("node:fs", () => ({
        existsSync: vi.fn().mockReturnValue(false),
      }));

      await import("./main.js");
      await new Promise((r) => setTimeout(r, 10));

      expect(mockWindowOnce).toHaveBeenCalledWith("ready-to-show", expect.anything());
    });

    it("registers closed handler", async () => {
      vi.resetModules();
      vi.doMock("electron", () => ({
        app: mockApp,
        BrowserWindow: MockBrowserWindow,
        ipcMain: mockIpcMain,
        shell: mockShell,
        Menu: mockMenu,
      }));
      vi.doMock("node:fs", () => ({
        existsSync: vi.fn().mockReturnValue(false),
      }));

      await import("./main.js");
      await new Promise((r) => setTimeout(r, 10));

      const onCalls = mockWindowOn.mock.calls as [string, EventHandler][];
      const closedCall = onCalls.find((c) => c[0] === "closed");
      expect(closedCall).toBeDefined();
    });
  });
});
