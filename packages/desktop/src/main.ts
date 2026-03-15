import { app, BrowserWindow, ipcMain, shell, Menu } from "electron";
import { join } from "node:path";
import { existsSync } from "node:fs";

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
    mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(getDefaultHTML())}`);
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function createMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: "DanteCode",
      submenu: [
        { label: "About DanteCode", role: "about" },
        { type: "separator" },
        { label: "Settings", accelerator: "CmdOrCtrl+,", click: openSettings },
        { type: "separator" },
        { label: "Quit", accelerator: "CmdOrCtrl+Q", role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { label: "Undo", accelerator: "CmdOrCtrl+Z", role: "undo" },
        { label: "Redo", accelerator: "Shift+CmdOrCtrl+Z", role: "redo" },
        { type: "separator" },
        { label: "Cut", accelerator: "CmdOrCtrl+X", role: "cut" },
        { label: "Copy", accelerator: "CmdOrCtrl+C", role: "copy" },
        { label: "Paste", accelerator: "CmdOrCtrl+V", role: "paste" },
        { label: "Select All", accelerator: "CmdOrCtrl+A", role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { label: "Reload", accelerator: "CmdOrCtrl+R", role: "reload" },
        { label: "Toggle Developer Tools", accelerator: "F12", role: "toggleDevTools" },
        { type: "separator" },
        { label: "Actual Size", accelerator: "CmdOrCtrl+0", role: "resetZoom" },
        { label: "Zoom In", accelerator: "CmdOrCtrl+=", role: "zoomIn" },
        { label: "Zoom Out", accelerator: "CmdOrCtrl+-", role: "zoomOut" },
        { type: "separator" },
        { label: "Toggle Full Screen", accelerator: "F11", role: "togglefullscreen" },
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
          click: () => shell.openExternal("https://github.com/dantecode/dantecode/issues"),
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

function setupIPC(): void {
  ipcMain.handle("get-version", () => app.getVersion());

  ipcMain.handle("get-platform", () => process.platform);

  ipcMain.handle("open-external", (_event, url: string) => {
    return shell.openExternal(url);
  });

  ipcMain.handle("get-cwd", () => process.cwd());
}

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
  if (process.platform !== "darwin") {
    app.quit();
  }
});
