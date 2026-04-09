import { app, BrowserWindow, ipcMain, shell, Menu } from "electron";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { EXECUTION_TRUTH_RELATIVE_PATH, type ExecutionTruthPayload } from "@dantecode/core";

// ---------------------------------------------------------------------------
// Agent subprocess management
// ---------------------------------------------------------------------------

let agentProcess: ChildProcess | null = null;
let agentRunning = false;
const agentModel = "default";
/** Buffered output from the agent subprocess, delivered to renderer via IPC. */
let outputListeners: Array<(data: string) => void> = [];

function readExecutionTruthPayload(): ExecutionTruthPayload | null {
  try {
    const truthPath = join(process.cwd(), EXECUTION_TRUTH_RELATIVE_PATH);
    if (!existsSync(truthPath)) {
      return null;
    }
    return JSON.parse(readFileSync(truthPath, "utf8")) as ExecutionTruthPayload;
  } catch {
    return null;
  }
}

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
      reject(new Error("DanteCode CLI not found. Install with: npm install -g @dantecode/cli"));
      return;
    }

    // Kill any existing agent process
    abortAgent();

    const isJsFile = cliBin.endsWith(".js");
    const cmd = isJsFile ? "node" : cliBin;
    const args = isJsFile ? [cliBin, "--prompt", prompt] : ["--prompt", prompt];

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
      reject(new Error(`DanteCode CLI process error: ${err.message}`));
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
    mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(getDefaultHTML())}`);
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
    const truth = readExecutionTruthPayload();
    return {
      running: agentRunning,
      model: truth?.model ?? agentModel,
      provider: truth?.provider ?? null,
      mode: truth?.mode ?? null,
      changedFiles: truth?.changedFiles ?? [],
      mutationCount: truth?.mutationCount ?? 0,
      validationCount: truth?.validationCount ?? 0,
      gateStatus: truth?.gateStatus ?? "none",
      reasonCode: truth?.reasonCode ?? null,
      lastVerifiedAt: truth?.lastVerifiedAt ?? null,
    };
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
    /* Industrial Editorial — phosphor-green on near-black, monospace-first */
    :root {
      --dc-bg:       #0a0a0a;
      --dc-elevated: #111111;
      --dc-overlay:  #1a1a1a;
      --dc-text:     #e8e8e8;
      --dc-dim:      #8a8a8a;
      --dc-muted:    #3d3d3d;
      --dc-accent:   #00d97e;
      --dc-danger:   #ff4d4d;
      --dc-border:   rgba(255,255,255,0.06);
      --dc-font:     "JetBrains Mono","Cascadia Code","Fira Code","Consolas",monospace;
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: var(--dc-font);
      font-size: 13px;
      font-feature-settings: "ss01","ss02","cv01";
      background: var(--dc-bg);
      color: var(--dc-text);
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    /* Slow conic-gradient ambient — delayed 500ms, 12s cycle */
    body::before {
      content: "";
      position: fixed;
      inset: 0;
      background: conic-gradient(
        from 0deg at 20% 80%,
        rgba(0,217,126,0.03) 0deg,
        transparent 60deg,
        rgba(0,217,126,0.02) 180deg,
        transparent 240deg,
        rgba(0,217,126,0.03) 360deg
      );
      animation: ambient-rotate 12s linear infinite;
      animation-delay: 0.5s;
      pointer-events: none;
      z-index: 0;
    }

    @keyframes ambient-rotate {
      from { transform: rotate(0deg) scale(2); }
      to   { transform: rotate(360deg) scale(2); }
    }

    /* Top bar */
    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 32px;
      height: 40px;
      border-bottom: 1px solid var(--dc-border);
      background: var(--dc-elevated);
      position: relative;
      z-index: 1;
      flex-shrink: 0;
    }

    .topbar-brand {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--dc-accent);
    }

    .topbar-meta {
      display: flex;
      align-items: center;
      gap: 16px;
      font-size: 11px;
      color: var(--dc-muted);
    }

    .status-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--dc-accent);
      box-shadow: 0 0 6px var(--dc-accent);
      flex-shrink: 0;
    }

    /* Main layout — left-aligned, not centered */
    .main {
      flex: 1;
      display: flex;
      flex-direction: column;
      justify-content: flex-end;
      padding: 48px 64px 48px;
      position: relative;
      z-index: 1;
      max-width: 900px;
    }

    .headline {
      font-size: 36px;
      font-weight: 700;
      letter-spacing: -0.02em;
      line-height: 1.1;
      color: var(--dc-text);
      margin-bottom: 16px;
    }

    .headline em {
      color: var(--dc-accent);
      font-style: normal;
    }

    .descriptor {
      font-size: 13px;
      color: var(--dc-dim);
      line-height: 1.7;
      margin-bottom: 40px;
      max-width: 480px;
    }

    /* Input area */
    .input-row {
      display: flex;
      gap: 8px;
      align-items: stretch;
    }

    .prompt-input {
      flex: 1;
      padding: 12px 16px;
      background: var(--dc-elevated);
      border: 1px solid var(--dc-border);
      border-radius: 2px;
      color: var(--dc-text);
      font-family: var(--dc-font);
      font-size: 13px;
      outline: none;
      transition: border-color 80ms cubic-bezier(0.22,1,0.36,1);
    }

    .prompt-input:focus {
      border-color: var(--dc-accent);
    }

    .prompt-input::placeholder {
      color: var(--dc-muted);
    }

    .send-btn {
      padding: 12px 24px;
      background: var(--dc-accent);
      border: none;
      border-radius: 2px;
      color: #000;
      font-family: var(--dc-font);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      cursor: pointer;
      transition: background 80ms cubic-bezier(0.22,1,0.36,1);
    }

    .send-btn:hover { background: #00f090; }

    .meta-row {
      display: flex;
      align-items: center;
      gap: 24px;
      margin-top: 16px;
      font-size: 11px;
      color: var(--dc-muted);
    }

    .meta-item {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .meta-item strong { color: var(--dc-dim); }

    .meta-secondary {
      margin-top: 10px;
      color: var(--dc-dim);
      flex-wrap: wrap;
    }

    .status-reason {
      margin-top: 10px;
      font-size: 11px;
      color: var(--dc-dim);
      min-height: 16px;
    }

    .output-panel {
      margin-top: 24px;
      background: var(--dc-elevated);
      border: 1px solid var(--dc-border);
      border-radius: 2px;
      overflow: hidden;
      display: none;
    }

    .output-panel.visible {
      display: block;
    }

    .output-header {
      padding: 10px 14px;
      border-bottom: 1px solid var(--dc-border);
      font-size: 11px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--dc-accent);
    }

    .output-log {
      margin: 0;
      padding: 14px;
      max-height: 240px;
      overflow: auto;
      white-space: pre-wrap;
      word-break: break-word;
      line-height: 1.6;
      color: var(--dc-text);
    }

    /* PDSE badge in topbar */
    .pdse-chip {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--dc-accent);
    }

    .pdse-ring-sm {
      --score: 85;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background: conic-gradient(var(--dc-accent) calc(var(--score) * 1%), var(--dc-muted) 0);
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
    }

    .pdse-ring-sm::before {
      content: "";
      position: absolute;
      inset: 3px;
      border-radius: 50%;
      background: var(--dc-elevated);
    }
  </style>
</head>
<body>
  <div class="topbar">
    <span class="topbar-brand">DanteCode</span>
    <div class="topbar-meta">
      <span class="status-dot"></span>
      <span id="status-label">Ready</span>
      <div class="pdse-chip">
        <div class="pdse-ring-sm"></div>
        PDSE
      </div>
    </div>
  </div>

  <div class="main">
    <div class="headline">
      Build anything.<br>
      <em>Zero stubs. Zero drift.</em>
    </div>
    <p class="descriptor">
      Model-agnostic AI coding agent with DanteForge quality gates.<br>
      Every output is verified. Every iteration converges.
    </p>

    <div class="input-row">
      <input class="prompt-input" type="text" placeholder="What would you like to build?" autofocus>
      <button class="send-btn">Send</button>
    </div>

    <div class="meta-row">
      <span class="meta-item"><strong>Model</strong> <span id="model-value">Loading...</span></span>
      <span class="meta-item"><strong>Gate</strong> <span id="gate-value">Loading...</span></span>
      <span class="meta-item"><strong>Mode</strong> <span id="mode-value">Loading...</span></span>
    </div>

    <div class="meta-row meta-secondary">
      <span class="meta-item"><strong>Provider</strong> <span id="provider-value">-</span></span>
      <span class="meta-item"><strong>Mutations</strong> <span id="mutation-count">0</span></span>
      <span class="meta-item"><strong>Validations</strong> <span id="validation-count">0</span></span>
      <span class="meta-item"><strong>Files</strong> <span id="changed-files">None</span></span>
    </div>

    <div class="status-reason" id="reason-value"></div>

    <div class="output-panel" id="output-panel">
      <div class="output-header">Live Output</div>
      <pre class="output-log" id="output-log"></pre>
    </div>
  </div>

  <script>
    const promptInput = document.querySelector('.prompt-input');
    const sendButton = document.querySelector('.send-btn');
    const statusLabel = document.getElementById('status-label');
    const modelValue = document.getElementById('model-value');
    const providerValue = document.getElementById('provider-value');
    const modeValue = document.getElementById('mode-value');
    const gateValue = document.getElementById('gate-value');
    const mutationCount = document.getElementById('mutation-count');
    const validationCount = document.getElementById('validation-count');
    const changedFiles = document.getElementById('changed-files');
    const reasonValue = document.getElementById('reason-value');
    const outputPanel = document.getElementById('output-panel');
    const outputLog = document.getElementById('output-log');

    function formatGate(status) {
      if (status === 'passed') return 'Passed';
      if (status === 'failed') return 'Failed';
      if (status === 'pending') return 'Pending';
      return 'None';
    }

    function formatMode(mode) {
      return mode ? mode.charAt(0).toUpperCase() + mode.slice(1) : 'Unknown';
    }

    function updateStatus(status) {
      statusLabel.textContent = status.running ? 'Working' : 'Ready';
      modelValue.textContent = status.model || 'Unknown';
      providerValue.textContent = status.provider || '-';
      modeValue.textContent = formatMode(status.mode);
      gateValue.textContent = formatGate(status.gateStatus);
      mutationCount.textContent = String(status.mutationCount || 0);
      validationCount.textContent = String(status.validationCount || 0);
      changedFiles.textContent = status.changedFiles && status.changedFiles.length > 0
        ? status.changedFiles.slice(0, 3).join(', ')
        : 'None';

      if (status.reasonCode || status.lastVerifiedAt) {
        const parts = [];
        if (status.reasonCode) parts.push('Reason: ' + status.reasonCode);
        if (status.lastVerifiedAt) parts.push('Verified: ' + status.lastVerifiedAt);
        reasonValue.textContent = parts.join(' | ');
      } else {
        reasonValue.textContent = '';
      }
    }

    async function refreshStatus() {
      try {
        const status = await window.dantecode.getStatus();
        updateStatus(status);
      } catch (error) {
        reasonValue.textContent = 'Unable to load runtime status.';
      }
    }

    async function runPrompt() {
      const prompt = promptInput.value.trim();
      if (!prompt) return;

      sendButton.disabled = true;
      promptInput.disabled = true;
      outputPanel.classList.add('visible');
      outputLog.textContent = '';

      try {
        const result = await window.dantecode.runPrompt(prompt);
        if (!result.success && result.error) {
          outputLog.textContent += '[error] ' + result.error + '\\n';
        }
      } finally {
        sendButton.disabled = false;
        promptInput.disabled = false;
        promptInput.focus();
        await refreshStatus();
      }
    }

    sendButton.addEventListener('click', runPrompt);
    promptInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        void runPrompt();
      }
    });

    window.dantecode.onOutput((data) => {
      outputPanel.classList.add('visible');
      outputLog.textContent += data;
      outputLog.scrollTop = outputLog.scrollHeight;
      void refreshStatus();
    });

    void refreshStatus();
    setInterval(() => { void refreshStatus(); }, 2000);
  </script>
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
