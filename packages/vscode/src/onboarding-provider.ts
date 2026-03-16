// ============================================================================
// DanteCode VS Code Extension — Onboarding Webview
// First-run welcome screen with API key configuration and local model
// detection. Uses VS Code SecretStorage for secure key persistence.
// ============================================================================

import * as vscode from "vscode";

/** Provider model entry for the onboarding UI. */
export interface ModelEntry {
  id: string;
  label: string;
  provider: string;
  envVar: string;
}

/** The canonical list of frontier models DanteCode supports. */
export const FRONTIER_MODELS: ModelEntry[] = [
  // xAI / Grok (verified model IDs from docs.x.ai/developers/models)
  { id: "grok/grok-4.20-beta-0309-non-reasoning", label: "Grok 4.20 Beta", provider: "grok", envVar: "XAI_API_KEY" },
  { id: "grok/grok-4.20-beta-0309-reasoning", label: "Grok 4.20 Beta (Reasoning)", provider: "grok", envVar: "XAI_API_KEY" },
  { id: "grok/grok-4.20-multi-agent-beta-0309", label: "Grok 4.20 Multi-Agent", provider: "grok", envVar: "XAI_API_KEY" },
  { id: "grok/grok-4-0709", label: "Grok 4", provider: "grok", envVar: "XAI_API_KEY" },
  { id: "grok/grok-4-1-fast-reasoning", label: "Grok 4.1 Fast (Reasoning)", provider: "grok", envVar: "XAI_API_KEY" },
  { id: "grok/grok-4-1-fast-non-reasoning", label: "Grok 4.1 Fast", provider: "grok", envVar: "XAI_API_KEY" },
  { id: "grok/grok-4-fast-reasoning", label: "Grok 4 Fast (Reasoning)", provider: "grok", envVar: "XAI_API_KEY" },
  { id: "grok/grok-4-fast-non-reasoning", label: "Grok 4 Fast", provider: "grok", envVar: "XAI_API_KEY" },
  { id: "grok/grok-code-fast-1", label: "Grok Code Fast", provider: "grok", envVar: "XAI_API_KEY" },
  { id: "grok/grok-3", label: "Grok 3", provider: "grok", envVar: "XAI_API_KEY" },
  { id: "grok/grok-3-mini", label: "Grok 3 Mini", provider: "grok", envVar: "XAI_API_KEY" },
  // Anthropic
  { id: "anthropic/claude-opus-4-6", label: "Claude Opus 4.6", provider: "anthropic", envVar: "ANTHROPIC_API_KEY" },
  { id: "anthropic/claude-sonnet-4-6", label: "Claude Sonnet 4.6", provider: "anthropic", envVar: "ANTHROPIC_API_KEY" },
  { id: "anthropic/claude-haiku-4-5", label: "Claude Haiku 4.5", provider: "anthropic", envVar: "ANTHROPIC_API_KEY" },
  // OpenAI
  { id: "openai/gpt-4.1", label: "GPT-4.1", provider: "openai", envVar: "OPENAI_API_KEY" },
  { id: "openai/o3-pro", label: "o3-pro", provider: "openai", envVar: "OPENAI_API_KEY" },
  // Google
  { id: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro", provider: "google", envVar: "GOOGLE_API_KEY" },
  { id: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash", provider: "google", envVar: "GOOGLE_API_KEY" },
  // Local — Ollama (auto-discovered at runtime, these are common defaults)
  { id: "ollama/llama3.1:8b", label: "Llama 3.1 8B (local)", provider: "ollama", envVar: "" },
  { id: "ollama/qwen2.5-coder:7b", label: "Qwen 2.5 Coder 7B (local)", provider: "ollama", envVar: "" },
  { id: "ollama/mistral:7b", label: "Mistral 7B (local)", provider: "ollama", envVar: "" },
];

/** Unique provider groups that need API keys. */
export const API_PROVIDERS = [
  { id: "grok", label: "xAI / Grok", envVar: "XAI_API_KEY", placeholder: "xai-..." },
  { id: "anthropic", label: "Anthropic", envVar: "ANTHROPIC_API_KEY", placeholder: "sk-ant-..." },
  { id: "openai", label: "OpenAI", envVar: "OPENAI_API_KEY", placeholder: "sk-..." },
  { id: "google", label: "Google AI", envVar: "GOOGLE_API_KEY", placeholder: "AIza..." },
] as const;

/**
 * Manages the onboarding webview panel. Shows on first run or when
 * explicitly invoked via the "DanteCode: Setup API Keys" command.
 */
export class OnboardingProvider {
  private panel: vscode.WebviewPanel | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly secrets: vscode.SecretStorage,
    private readonly context: vscode.ExtensionContext,
  ) {}

  /** Show the onboarding panel (creates or reveals). */
  async show(): Promise<void> {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One);
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      "dantecode.onboarding",
      "DanteCode Setup",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this.extensionUri],
      },
    );

    // Load existing keys to pre-fill
    const existingKeys: Record<string, string> = {};
    for (const p of API_PROVIDERS) {
      const stored = await this.secrets.get(`dantecode.${p.id}ApiKey`);
      if (stored) existingKeys[p.id] = maskKey(stored);
    }

    // Detect Ollama
    const ollamaStatus = await detectOllama();

    this.panel.webview.html = this.getHtml(
      this.panel.webview,
      existingKeys,
      ollamaStatus,
    );

    this.panel.webview.onDidReceiveMessage(async (msg) => {
      if (msg.type === "save_keys") {
        await this.handleSaveKeys(msg.keys, msg.defaultModel);
      } else if (msg.type === "detect_ollama") {
        const status = await detectOllama();
        this.panel?.webview.postMessage({ type: "ollama_status", ...status });
      } else if (msg.type === "skip") {
        this.markOnboarded();
        this.panel?.dispose();
      }
    });

    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });
  }

  /** Save API keys to SecretStorage and set the default model. */
  private async handleSaveKeys(
    keys: Record<string, string>,
    defaultModel: string,
  ): Promise<void> {
    let savedCount = 0;

    for (const p of API_PROVIDERS) {
      const value = keys[p.id];
      if (value && !value.includes("***")) {
        await this.secrets.store(`dantecode.${p.id}ApiKey`, value);
        savedCount++;
      }
    }

    // Set default model in VS Code settings
    if (defaultModel) {
      const config = vscode.workspace.getConfiguration("dantecode");
      await config.update(
        "defaultModel",
        defaultModel,
        vscode.ConfigurationTarget.Global,
      );
    }

    this.markOnboarded();

    this.panel?.webview.postMessage({
      type: "save_result",
      success: true,
      message: `Saved ${savedCount} API key(s). Default model: ${defaultModel || "grok/grok-4.2"}`,
    });

    void vscode.window.showInformationMessage(
      `DanteCode: Setup complete. ${savedCount} API key(s) saved.`,
    );
  }

  /** Mark onboarding as completed so it doesn't show again. */
  private markOnboarded(): void {
    void this.context.globalState.update("dantecode.hasOnboarded", true);
  }

  /** Check if onboarding has been completed. */
  static hasOnboarded(context: vscode.ExtensionContext): boolean {
    return context.globalState.get<boolean>("dantecode.hasOnboarded") === true;
  }

  /** Generate the onboarding HTML. */
  private getHtml(
    _webview: vscode.Webview,
    existingKeys: Record<string, string>,
    ollamaStatus: OllamaStatus,
  ): string {
    const nonce = getNonce();

    const providerRows = API_PROVIDERS.map(
      (p) => `
      <div class="key-row">
        <label for="key-${p.id}">${p.label}</label>
        <div class="input-group">
          <input
            type="password"
            id="key-${p.id}"
            data-provider="${p.id}"
            placeholder="${p.placeholder}"
            value="${existingKeys[p.id] || ""}"
            autocomplete="off"
            spellcheck="false"
          />
          <button class="toggle-btn" data-for="key-${p.id}" title="Show/hide">
            &#x1f441;
          </button>
        </div>
        <span class="env-hint">env: ${p.envVar}</span>
      </div>`,
    ).join("\n");

    const ollamaSection = ollamaStatus.running
      ? `<div class="ollama-status connected">
           Ollama detected at ${ollamaStatus.url}
           ${ollamaStatus.models.length > 0 ? `<br/>Models: ${ollamaStatus.models.join(", ")}` : "<br/>No models pulled yet. Run: <code>ollama pull llama4</code>"}
         </div>`
      : `<div class="ollama-status disconnected">
           Ollama not detected. <a href="https://ollama.ai">Install Ollama</a> for local models.
           <br/><button id="retry-ollama" class="link-btn">Retry detection</button>
         </div>`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>DanteCode Setup</title>
  <style nonce="${nonce}">
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family, system-ui, sans-serif);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      padding: 40px;
      max-width: 640px;
      margin: 0 auto;
      line-height: 1.6;
    }

    .logo { font-size: 32px; font-weight: 700; margin-bottom: 4px; }
    .subtitle { color: var(--vscode-descriptionForeground); margin-bottom: 32px; font-size: 14px; }

    h2 {
      font-size: 16px;
      font-weight: 600;
      margin: 28px 0 12px 0;
      padding-bottom: 6px;
      border-bottom: 1px solid var(--vscode-widget-border, #333);
    }

    .key-row {
      margin-bottom: 16px;
    }
    .key-row label {
      display: block;
      font-weight: 600;
      font-size: 13px;
      margin-bottom: 4px;
    }
    .input-group {
      display: flex;
      gap: 4px;
    }
    .input-group input {
      flex: 1;
      padding: 8px 10px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, #444);
      border-radius: 4px;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 13px;
    }
    .input-group input:focus {
      outline: none;
      border-color: var(--vscode-focusBorder);
    }
    .toggle-btn {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border: 1px solid var(--vscode-input-border, #444);
      border-radius: 4px;
      cursor: pointer;
      padding: 4px 8px;
      font-size: 14px;
    }
    .env-hint {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      margin-top: 2px;
      display: block;
    }

    .model-section { margin: 24px 0; }
    .model-section select {
      width: 100%;
      padding: 8px 10px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, #444);
      border-radius: 4px;
      font-size: 13px;
    }
    .model-section select:focus {
      outline: none;
      border-color: var(--vscode-focusBorder);
    }

    .ollama-status {
      padding: 12px 16px;
      border-radius: 6px;
      font-size: 13px;
      margin: 12px 0;
    }
    .ollama-status.connected {
      background: color-mix(in srgb, var(--vscode-testing-iconPassed, #4caf50) 15%, transparent);
      border: 1px solid var(--vscode-testing-iconPassed, #4caf50);
    }
    .ollama-status.disconnected {
      background: color-mix(in srgb, var(--vscode-descriptionForeground) 8%, transparent);
      border: 1px solid var(--vscode-widget-border, #444);
    }
    .ollama-status a {
      color: var(--vscode-textLink-foreground);
    }
    .ollama-status code {
      background: var(--vscode-textCodeBlock-background, #1e1e1e);
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 12px;
    }

    .link-btn {
      background: none;
      border: none;
      color: var(--vscode-textLink-foreground);
      cursor: pointer;
      font-size: 13px;
      text-decoration: underline;
      padding: 0;
    }

    .actions {
      margin-top: 32px;
      display: flex;
      gap: 12px;
    }
    .btn-primary {
      padding: 10px 24px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 4px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
    }
    .btn-primary:hover { background: var(--vscode-button-hoverBackground); }
    .btn-secondary {
      padding: 10px 24px;
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border: none;
      border-radius: 4px;
      font-size: 14px;
      cursor: pointer;
    }
    .btn-secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }

    .result-msg {
      margin-top: 16px;
      padding: 10px 14px;
      border-radius: 4px;
      font-size: 13px;
      display: none;
    }
    .result-msg.success {
      display: block;
      background: color-mix(in srgb, var(--vscode-testing-iconPassed, #4caf50) 15%, transparent);
      border: 1px solid var(--vscode-testing-iconPassed, #4caf50);
    }

    .info-note {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
      margin-top: 8px;
    }
  </style>
</head>
<body>
  <div class="logo">DanteCode</div>
  <p class="subtitle">Model-agnostic AI coding agent with DanteForge quality gates</p>

  <h2>API Keys</h2>
  <p class="info-note">Keys are stored securely in your OS keychain via VS Code SecretStorage. Only add keys for providers you want to use.</p>
  ${providerRows}

  <h2>Local Models</h2>
  ${ollamaSection}

  <h2>Default Model</h2>
  <div class="model-section">
    <select id="default-model">
      <optgroup label="xAI / Grok">
        ${FRONTIER_MODELS.filter((m) => m.provider === "grok").map((m) => `<option value="${m.id}"${m.id === "grok/grok-4.2" ? " selected" : ""}>${m.label}</option>`).join("")}
      </optgroup>
      <optgroup label="Anthropic">
        ${FRONTIER_MODELS.filter((m) => m.provider === "anthropic").map((m) => `<option value="${m.id}">${m.label}</option>`).join("")}
      </optgroup>
      <optgroup label="OpenAI">
        ${FRONTIER_MODELS.filter((m) => m.provider === "openai").map((m) => `<option value="${m.id}">${m.label}</option>`).join("")}
      </optgroup>
      <optgroup label="Google">
        ${FRONTIER_MODELS.filter((m) => m.provider === "google").map((m) => `<option value="${m.id}">${m.label}</option>`).join("")}
      </optgroup>
      <optgroup label="Local (Ollama)">
        ${FRONTIER_MODELS.filter((m) => m.provider === "ollama").map((m) => `<option value="${m.id}">${m.label}</option>`).join("")}
      </optgroup>
    </select>
  </div>

  <div class="actions">
    <button class="btn-primary" id="save-btn">Save &amp; Start</button>
    <button class="btn-secondary" id="skip-btn">Skip for now</button>
  </div>

  <div class="result-msg" id="result-msg"></div>

  <script nonce="${nonce}">
    (function() {
      const vscode = acquireVsCodeApi();

      // Toggle password visibility
      document.querySelectorAll('.toggle-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const input = document.getElementById(btn.dataset.for);
          input.type = input.type === 'password' ? 'text' : 'password';
        });
      });

      // Retry Ollama detection
      const retryBtn = document.getElementById('retry-ollama');
      if (retryBtn) {
        retryBtn.addEventListener('click', () => {
          vscode.postMessage({ type: 'detect_ollama' });
        });
      }

      // Save keys
      document.getElementById('save-btn').addEventListener('click', () => {
        const keys = {};
        document.querySelectorAll('.key-row input').forEach(input => {
          const provider = input.dataset.provider;
          if (input.value && input.value.trim()) {
            keys[provider] = input.value.trim();
          }
        });

        const defaultModel = document.getElementById('default-model').value;
        vscode.postMessage({ type: 'save_keys', keys, defaultModel });
      });

      // Skip
      document.getElementById('skip-btn').addEventListener('click', () => {
        vscode.postMessage({ type: 'skip' });
      });

      // Handle messages from extension
      window.addEventListener('message', event => {
        const msg = event.data;
        if (msg.type === 'save_result' && msg.success) {
          const el = document.getElementById('result-msg');
          el.textContent = msg.message;
          el.className = 'result-msg success';
        } else if (msg.type === 'ollama_status') {
          // Could re-render the ollama section but for now just show a message
          if (msg.running) {
            const el = document.getElementById('result-msg');
            el.textContent = 'Ollama detected! Models: ' + (msg.models.join(', ') || 'none pulled');
            el.className = 'result-msg success';
          }
        }
      });
    })();
  </script>
</body>
</html>`;
  }
}

// ─── Ollama Detection ─────────────────────────────────────────────────────────

interface OllamaStatus {
  running: boolean;
  url: string;
  models: string[];
}

async function detectOllama(): Promise<OllamaStatus> {
  const url = "http://127.0.0.1:11434";
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${url}/api/tags`, { signal: controller.signal });
    clearTimeout(timeout);

    if (res.ok) {
      const data = (await res.json()) as { models?: Array<{ name: string }> };
      const models = (data.models || []).map((m) => m.name);
      return { running: true, url, models };
    }
    return { running: false, url, models: [] };
  } catch {
    return { running: false, url, models: [] };
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function getNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function maskKey(key: string): string {
  if (key.length <= 8) return "***";
  return key.slice(0, 4) + "***" + key.slice(-4);
}
