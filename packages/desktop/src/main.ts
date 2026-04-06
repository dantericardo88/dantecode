import { app, BrowserWindow, ipcMain, shell, Menu } from "electron";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";

// ---------------------------------------------------------------------------
// Agent subprocess management
// ---------------------------------------------------------------------------

let agentProcess: ChildProcess | null = null;
let agentRunning = false;
let agentModel = "default";
/** Buffered output from the agent subprocess, delivered to renderer via IPC. */
let outputListeners: Array<(data: string) => void> = [];

function findCliBinary(): string | null {
  // Try common locations
  const candidates = [
    join(process.cwd(), "node_modules", ".bin", "dantecode"),
    join(process.cwd(), "packages", "cli", "dist", "index.js"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  // Try global: check if dantecode is on PATH
  try {
    execFileSync("dantecode", ["--version"], { stdio: "pipe", timeout: 5000 });
    return "dantecode";
  } catch {
    // not found
  }
  return null;
}

function emitOutput(data: string): void {
  for (const listener of outputListeners) {
    try {
      listener(data);
    } catch {
      // Listener may be stale if window closed
    }
  }
}

function runAgentPrompt(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const cliBin = findCliBinary();
    if (!cliBin) {
      reject(
        new Error(
          "DanteCode CLI not found. Install with: npm install -g @dantecode/cli",
        ),
      );
      return;
    }

    // Kill any existing agent process
    abortAgent();

    const isJsFile = cliBin.endsWith(".js");
    const cmd = isJsFile ? "node" : cliBin;
    const args = isJsFile
      ? [cliBin, "--prompt", prompt]
      : ["--prompt", prompt];

    try {
      agentProcess = spawn(cmd, args, {
        cwd: process.cwd(),
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env },
      });
    } catch (err) {
      reject(
        new Error(
          `Failed to start DanteCode CLI: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
      return;
    }

    agentRunning = true;
    let output = "";

    agentProcess.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf-8");
      output += text;
      emitOutput(text);
    });

    agentProcess.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf-8");
      emitOutput(`[stderr] ${text}`);
    });

    agentProcess.on("close", (code) => {
      agentRunning = false;
      agentProcess = null;
      if (code === 0 || code === null) {
        resolve(output);
      } else {
        reject(new Error(`DanteCode CLI exited with code ${code}`));
      }
    });

    agentProcess.on("error", (err) => {
      agentRunning = false;
      agentProcess = null;
      reject(
        new Error(`DanteCode CLI process error: ${err.message}`),
      );
    });
  });
}

function abortAgent(): void {
  if (agentProcess && !agentProcess.killed) {
    agentProcess.kill("SIGTERM");
    // Give it a moment, then force kill
    setTimeout(() => {
      if (agentProcess && !agentProcess.killed) {
        agentProcess.kill("SIGKILL");
      }
    }, 3000);
  }
  agentRunning = false;
  agentProcess = null;
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

let mainWindow: BrowserWindow | null = null;

const WINDOW_CONFIG = {
  width: 1200,
  height: 800,
  minWidth: 800,
  minHeight: 600,
  title: "DanteCode",
  webPreferences: {
    preload: join(__dirname, "preload.js"),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  },
} as const;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    ...WINDOW_CONFIG,
    show: false,
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  const indexPath = join(__dirname, "..", "renderer", "index.html");
  if (existsSync(indexPath)) {
    mainWindow.loadFile(indexPath);
  } else {
    mainWindow.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(getDefaultHTML())}`,
    );
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// ---------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------

function createMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: "DanteCode",
      submenu: [
        { label: "About DanteCode", role: "about" },
        { type: "separator" },
        {
          label: "Settings",
          accelerator: "CmdOrCtrl+,",
          click: openSettings,
        },
        { type: "separator" },
        { label: "Quit", accelerator: "CmdOrCtrl+Q", role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { label: "Undo", accelerator: "CmdOrCtrl+Z", role: "undo" },
        {
          label: "Redo",
          accelerator: "Shift+CmdOrCtrl+Z",
          role: "redo",
        },
        { type: "separator" },
        { label: "Cut", accelerator: "CmdOrCtrl+X", role: "cut" },
        { label: "Copy", accelerator: "CmdOrCtrl+C", role: "copy" },
        { label: "Paste", accelerator: "CmdOrCtrl+V", role: "paste" },
        {
          label: "Select All",
          accelerator: "CmdOrCtrl+A",
          role: "selectAll",
        },
      ],
    },
    {
      label: "View",
      submenu: [
        { label: "Reload", accelerator: "CmdOrCtrl+R", role: "reload" },
        {
          label: "Toggle Developer Tools",
          accelerator: "F12",
          role: "toggleDevTools",
        },
        { type: "separator" },
        {
          label: "Actual Size",
          accelerator: "CmdOrCtrl+0",
          role: "resetZoom",
        },
        {
          label: "Zoom In",
          accelerator: "CmdOrCtrl+=",
          role: "zoomIn",
        },
        {
          label: "Zoom Out",
          accelerator: "CmdOrCtrl+-",
          role: "zoomOut",
        },
        { type: "separator" },
        {
          label: "Toggle Full Screen",
          accelerator: "F11",
          role: "togglefullscreen",
        },
      ],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "Documentation",
          click: () => shell.openExternal("https://dantecode.dev/docs"),
        },
        {
          label: "Report Issue",
          click: () =>
            shell.openExternal(
              "https://github.com/dantecode/dantecode/issues",
            ),
        },
        { type: "separator" },
        {
          label: "About",
          click: () => {
            mainWindow?.webContents.send("show-about");
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function openSettings(): void {
  mainWindow?.webContents.send("open-settings");
}

// ---------------------------------------------------------------------------
// IPC handlers
// ---------------------------------------------------------------------------

function setupIPC(): void {
  ipcMain.handle("get-version", () => app.getVersion());

  ipcMain.handle("get-platform", () => process.platform);

  ipcMain.handle("open-external", (_event, url: string) => {
    return shell.openExternal(url);
  });

  ipcMain.handle("get-cwd", () => process.cwd());

  // Agent operations
  ipcMain.handle("agent:run-prompt", async (_event, prompt: string) => {
    try {
      const result = await runAgentPrompt(prompt);
      return { success: true, output: result };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  ipcMain.handle("agent:get-status", () => {
    return { running: agentRunning, model: agentModel };
  });

  ipcMain.handle("agent:abort", () => {
    abortAgent();
    return { success: true };
  });

  // Output streaming: renderer registers once, we push data via webContents.send
  ipcMain.on("agent:subscribe-output", (event) => {
    const webContents = event.sender;
    const listener = (data: string) => {
      try {
        if (!webContents.isDestroyed()) {
          webContents.send("agent:output", data);
        }
      } catch {
        // Window may have closed
      }
    };
    outputListeners.push(listener);

    // Clean up when the window is destroyed
    webContents.on("destroyed", () => {
      outputListeners = outputListeners.filter((l) => l !== listener);
    });
  });
}

// ---------------------------------------------------------------------------
// Default HTML
// ---------------------------------------------------------------------------

function getDefaultHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DanteCode</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0d1117;
      color: #c9d1d9;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      flex-direction: column;
      gap: 24px;
    }
    .logo {
      font-size: 48px;
      font-weight: 700;
      background: linear-gradient(135deg, #58a6ff, #bc8cff);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .subtitle {
      font-size: 16px;
      color: #8b949e;
      text-align: center;
      max-width: 500px;
      line-height: 1.6;
    }
    .model-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 16px;
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 20px;
      font-size: 14px;
      color: #58a6ff;
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #3fb950;
    }
    .prompt-area {
      width: 100%;
      max-width: 600px;
      padding: 0 24px;
    }
    .prompt-input {
      width: 100%;
      padding: 14px 20px;
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 12px;
      color: #c9d1d9;
      font-size: 15px;
      outline: none;
      transition: border-color 0.2s;
    }
    .prompt-input:focus {
      border-color: #58a6ff;
    }
    .prompt-input::placeholder { color: #484f58; }
    .hint {
      font-size: 12px;
      color: #484f58;
      margin-top: 12px;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="logo">DanteCode</div>
  <div class="subtitle">
    Open-source, model-agnostic AI coding agent.<br>
    Powered by DanteForge quality gates.
  </div>
  <div class="model-badge">
    <span class="dot"></span>
    Default model: Grok-3
  </div>
  <div class="prompt-area">
    <input class="prompt-input" type="text" placeholder="What would you like to build?" autofocus>
    <div class="hint">Press Enter to send. DanteForge gates enforce zero stubs.</div>
  </div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

app.whenReady().then(() => {
  createMenu();
  setupIPC();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  abortAgent(); // Clean up agent subprocess
  if (process.platform !== "darwin") {
    app.quit();
  }
});
