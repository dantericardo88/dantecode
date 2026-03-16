// ============================================================================
// DanteCode VS Code Extension — Chat Sidebar Provider
// Implements the chat webview panel with message history, model selection,
// context file management, PDSE score display, and skill activation.
// ============================================================================

import * as vscode from "vscode";
import type {
  ModelConfig,
  ModelRouterConfig,
  PDSEScore,
  TodoItem,
  AuditEvent,
} from "@dantecode/config-types";
import { ModelRouterImpl, appendAuditEvent } from "@dantecode/core";
import { runLocalPDSEScorer } from "@dantecode/danteforge";

/**
 * Inbound message types sent from the webview to the extension host.
 */
interface WebviewInboundMessage {
  type: "chat_request" | "file_add" | "file_remove" | "model_change" | "skill_activate" | "ready";
  payload: Record<string, unknown>;
}

/**
 * Outbound message types sent from the extension host to the webview.
 */
interface WebviewOutboundMessage {
  type:
    | "chat_response"
    | "chat_response_chunk"
    | "chat_response_done"
    | "pdse_score"
    | "audit_event"
    | "todo_update"
    | "context_files_update"
    | "model_update"
    | "error";
  payload: Record<string, unknown>;
}

/**
 * ChatSidebarProvider implements the VS Code WebviewViewProvider interface
 * to deliver a full chat experience in the sidebar activity bar.
 *
 * The provider manages:
 * - A two-way message channel between the webview and the extension host
 * - Chat message history (user and assistant messages)
 * - Context file management (files added for reference in prompts)
 * - Model selection and switching
 * - PDSE score display for assistant responses
 * - Skill activation from the webview
 */
export class ChatSidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "dantecode.chatView";

  private view: vscode.WebviewView | undefined;
  private messages: Array<{ role: "user" | "assistant"; content: string }> = [];
  private contextFiles: string[] = [];
  private currentModel: string;
  private sessionId: string;

  constructor(private readonly extensionUri: vscode.Uri) {
    const config = vscode.workspace.getConfiguration("dantecode");
    this.currentModel = config.get<string>("defaultModel", "grok/grok-4.2");
    this.sessionId = `vscode-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * Called by VS Code when the webview view needs to be resolved (i.e. when
   * the sidebar panel becomes visible). Sets up the webview HTML, message
   * handlers, and initial state.
   */
  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(async (message: WebviewInboundMessage) => {
      await this.handleWebviewMessage(message);
    });

    // When the view becomes visible again, re-send context state
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this.sendContextFilesUpdate();
        this.sendModelUpdate();
      }
    });
  }

  /**
   * Routes an inbound webview message to the appropriate handler.
   */
  private async handleWebviewMessage(message: WebviewInboundMessage): Promise<void> {
    switch (message.type) {
      case "chat_request":
        await this.handleChatRequest(String(message.payload["text"] ?? ""));
        break;
      case "file_add":
        this.handleFileAdd(String(message.payload["filePath"] ?? ""));
        break;
      case "file_remove":
        this.handleFileRemove(String(message.payload["filePath"] ?? ""));
        break;
      case "model_change":
        await this.handleModelChange(String(message.payload["model"] ?? ""));
        break;
      case "skill_activate":
        await this.handleSkillActivate(String(message.payload["skillName"] ?? ""));
        break;
      case "ready":
        this.sendContextFilesUpdate();
        this.sendModelUpdate();
        break;
    }
  }

  /**
   * Handles a chat request from the user. Sends the user message and context
   * to the model router, streams the response back to the webview, and runs
   * a PDSE score on the assistant's response.
   */
  private async handleChatRequest(text: string): Promise<void> {
    if (text.trim().length === 0) {
      return;
    }

    // Add user message to history
    this.messages.push({ role: "user", content: text });

    // Build model configuration from VS Code settings
    const [provider, modelId] = this.parseModelString(this.currentModel);
    const modelConfig: ModelConfig = {
      provider: provider as ModelConfig["provider"],
      modelId,
      maxTokens: 8192,
      temperature: 0.1,
      contextWindow: 131072,
      supportsVision: false,
      supportsToolCalls: true,
    };

    const routerConfig: ModelRouterConfig = {
      default: modelConfig,
      fallback: [],
      overrides: {},
    };

    const projectRoot = this.getProjectRoot();
    const router = new ModelRouterImpl(routerConfig, projectRoot, this.sessionId);

    // Build the system prompt with context files
    const systemParts = [
      "You are DanteCode, an AI coding assistant integrated into VS Code.",
      "You help users write, review, and improve code with quality-first principles.",
      "Always provide complete, production-ready code. Never use stubs, TODOs, or placeholders.",
    ];

    if (this.contextFiles.length > 0) {
      systemParts.push("");
      systemParts.push("The user has added the following files to context:");
      for (const filePath of this.contextFiles) {
        try {
          const uri = vscode.Uri.file(filePath);
          const content = await vscode.workspace.fs.readFile(uri);
          const text = Buffer.from(content).toString("utf-8");
          systemParts.push(`\n--- ${filePath} ---\n${text}\n--- end ---`);
        } catch {
          systemParts.push(`\n--- ${filePath} --- (could not read file)`);
        }
      }
    }

    const systemPrompt = systemParts.join("\n");

    // Build the conversation messages for the model
    const conversationMessages = this.messages.map((msg) => ({
      role: msg.role as "user" | "assistant",
      content: msg.content,
    }));

    try {
      // Use streaming for real-time response delivery
      const streamResult = await router.stream(conversationMessages, {
        system: systemPrompt,
        maxTokens: 8192,
      });

      let fullResponse = "";

      // Stream chunks to the webview
      for await (const chunk of streamResult.textStream) {
        fullResponse += chunk;
        this.postMessage({
          type: "chat_response_chunk",
          payload: { chunk, partial: fullResponse },
        });
      }

      // Add complete assistant message to history
      this.messages.push({ role: "assistant", content: fullResponse });

      // Signal stream completion
      this.postMessage({
        type: "chat_response_done",
        payload: { text: fullResponse },
      });

      // Run PDSE score on the response if it contains code
      if (this.containsCode(fullResponse)) {
        try {
          const codeBlocks = this.extractCodeBlocks(fullResponse);
          for (const block of codeBlocks) {
            const score = runLocalPDSEScorer(block, projectRoot);
            this.postMessage({
              type: "pdse_score",
              payload: {
                overall: score.overall,
                completeness: score.completeness,
                correctness: score.correctness,
                clarity: score.clarity,
                consistency: score.consistency,
                passedGate: score.passedGate,
                violationCount: score.violations.length,
              },
            });
          }
        } catch {
          // PDSE scoring failure should not break the chat flow
        }
      }

      // Log the chat interaction as an audit event
      try {
        await appendAuditEvent(projectRoot, {
          sessionId: this.sessionId,
          timestamp: new Date().toISOString(),
          type: "session_start",
          payload: {
            action: "chat_message",
            userMessageLength: text.length,
            assistantMessageLength: fullResponse.length,
            model: this.currentModel,
            contextFileCount: this.contextFiles.length,
          },
          modelId: this.currentModel,
          projectRoot,
        });
      } catch {
        // Audit logging failure should not break the chat flow
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error occurred";
      this.postMessage({
        type: "error",
        payload: { message: errorMessage },
      });
    }
  }

  /**
   * Adds a file to the context list and notifies the webview.
   */
  private handleFileAdd(filePath: string): void {
    if (filePath.length === 0) {
      return;
    }
    if (!this.contextFiles.includes(filePath)) {
      this.contextFiles.push(filePath);
      this.sendContextFilesUpdate();
    }
  }

  /**
   * Removes a file from the context list and notifies the webview.
   */
  private handleFileRemove(filePath: string): void {
    const index = this.contextFiles.indexOf(filePath);
    if (index !== -1) {
      this.contextFiles.splice(index, 1);
      this.sendContextFilesUpdate();
    }
  }

  /**
   * Handles a model change request from the webview's model selector.
   */
  private async handleModelChange(model: string): Promise<void> {
    if (model.length === 0) {
      return;
    }
    this.currentModel = model;

    // Update VS Code settings to persist the model choice
    const config = vscode.workspace.getConfiguration("dantecode");
    await config.update("defaultModel", model, vscode.ConfigurationTarget.Global);

    this.sendModelUpdate();
  }

  /**
   * Handles a skill activation request from the webview.
   */
  private async handleSkillActivate(skillName: string): Promise<void> {
    if (skillName.length === 0) {
      return;
    }

    const projectRoot = this.getProjectRoot();

    try {
      await appendAuditEvent(projectRoot, {
        sessionId: this.sessionId,
        timestamp: new Date().toISOString(),
        type: "skill_activate",
        payload: { skillName },
        modelId: this.currentModel,
        projectRoot,
      });

      void vscode.window.showInformationMessage(`DanteCode: Activated skill "${skillName}"`);
    } catch {
      void vscode.window.showErrorMessage(`DanteCode: Failed to activate skill "${skillName}"`);
    }
  }

  /**
   * Adds a file to the context from an external command (e.g. right-click menu).
   */
  addFileToContext(filePath: string): void {
    this.handleFileAdd(filePath);

    // If the sidebar view exists, also send a notification so the webview
    // can update its UI
    if (this.view) {
      this.sendContextFilesUpdate();
    }
  }

  /**
   * Returns the current model identifier.
   */
  getCurrentModel(): string {
    return this.currentModel;
  }

  /**
   * Sends a PDSE score update to the webview.
   */
  sendPDSEScore(score: PDSEScore): void {
    this.postMessage({
      type: "pdse_score",
      payload: {
        overall: score.overall,
        completeness: score.completeness,
        correctness: score.correctness,
        clarity: score.clarity,
        consistency: score.consistency,
        passedGate: score.passedGate,
        violationCount: score.violations.length,
      },
    });
  }

  /**
   * Sends an audit event notification to the webview.
   */
  sendAuditEvent(event: AuditEvent): void {
    this.postMessage({
      type: "audit_event",
      payload: {
        id: event.id,
        type: event.type,
        timestamp: event.timestamp,
        payload: event.payload,
      },
    });
  }

  /**
   * Sends a todo list update to the webview.
   */
  sendTodoUpdate(todos: TodoItem[]): void {
    this.postMessage({
      type: "todo_update",
      payload: {
        todos: todos.map((t) => ({
          id: t.id,
          text: t.text,
          status: t.status,
        })),
      },
    });
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  /**
   * Posts a message to the webview if it is active.
   */
  private postMessage(message: WebviewOutboundMessage): void {
    if (this.view) {
      void this.view.webview.postMessage(message);
    }
  }

  /**
   * Sends the current context files list to the webview.
   */
  private sendContextFilesUpdate(): void {
    this.postMessage({
      type: "context_files_update",
      payload: { files: this.contextFiles },
    });
  }

  /**
   * Sends the current model identifier to the webview.
   */
  private sendModelUpdate(): void {
    this.postMessage({
      type: "model_update",
      payload: { model: this.currentModel },
    });
  }

  /**
   * Returns the project root from the first workspace folder, or an empty string.
   */
  private getProjectRoot(): string {
    const folders = vscode.workspace.workspaceFolders;
    return folders?.[0]?.uri.fsPath ?? "";
  }

  /**
   * Parses a model string like "grok/grok-3" into [provider, modelId].
   */
  private parseModelString(model: string): [string, string] {
    const slashIndex = model.indexOf("/");
    if (slashIndex >= 0) {
      return [model.substring(0, slashIndex), model.substring(slashIndex + 1)];
    }
    return ["grok", model];
  }

  /**
   * Heuristic check for whether a response contains code blocks.
   */
  private containsCode(text: string): boolean {
    return (
      text.includes("```") ||
      text.includes("function ") ||
      text.includes("const ") ||
      text.includes("class ")
    );
  }

  /**
   * Extracts fenced code blocks from a markdown response.
   */
  private extractCodeBlocks(text: string): string[] {
    const blocks: string[] = [];
    const regex = /```\w*\n([\s\S]*?)```/g;
    let match = regex.exec(text);
    while (match !== null) {
      if (match[1] !== undefined && match[1].trim().length > 0) {
        blocks.push(match[1]);
      }
      match = regex.exec(text);
    }
    // If no fenced blocks found but the text looks like code, use the whole thing
    if (blocks.length === 0 && this.containsCode(text)) {
      blocks.push(text);
    }
    return blocks;
  }

  // --------------------------------------------------------------------------
  // Webview HTML
  // --------------------------------------------------------------------------

  /**
   * Generates the full HTML content for the chat sidebar webview. The UI
   * includes a message list, input field with send button, model selector
   * dropdown, context file pills, and a PDSE score badge.
   *
   * The HTML is self-contained with inline CSS and JavaScript. It uses
   * the VS Code webview API for message passing and respects the active
   * color theme via CSS custom properties.
   */
  private getHtmlForWebview(_webview: vscode.Webview): string {
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <title>DanteCode Chat</title>
  <style nonce="${nonce}">
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
    }

    /* ---- Header ---- */
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px;
      border-bottom: 1px solid var(--vscode-panel-border);
      background: var(--vscode-sideBarSectionHeader-background);
      flex-shrink: 0;
    }

    .header-title {
      font-weight: 600;
      font-size: 13px;
      color: var(--vscode-sideBarSectionHeader-foreground);
    }

    .pdse-badge {
      display: none;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 11px;
      font-weight: 600;
    }

    .pdse-badge.visible {
      display: flex;
    }

    .pdse-badge.passed {
      background: var(--vscode-testing-iconPassed);
      color: #fff;
    }

    .pdse-badge.failed {
      background: var(--vscode-testing-iconFailed);
      color: #fff;
    }

    /* ---- Model Selector ---- */
    .model-bar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 12px;
      border-bottom: 1px solid var(--vscode-panel-border);
      background: var(--vscode-sideBar-background);
      flex-shrink: 0;
    }

    .model-bar label {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      white-space: nowrap;
    }

    .model-select {
      flex: 1;
      padding: 3px 6px;
      font-size: 12px;
      font-family: var(--vscode-font-family);
      color: var(--vscode-dropdown-foreground);
      background: var(--vscode-dropdown-background);
      border: 1px solid var(--vscode-dropdown-border);
      border-radius: 2px;
      outline: none;
    }

    .model-select:focus {
      border-color: var(--vscode-focusBorder);
    }

    /* ---- Context Files ---- */
    .context-bar {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      padding: 6px 12px;
      border-bottom: 1px solid var(--vscode-panel-border);
      min-height: 0;
      flex-shrink: 0;
    }

    .context-bar:empty {
      display: none;
    }

    .context-pill {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      font-size: 11px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      border-radius: 10px;
      max-width: 200px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .context-pill .remove-btn {
      cursor: pointer;
      opacity: 0.7;
      font-size: 12px;
      line-height: 1;
    }

    .context-pill .remove-btn:hover {
      opacity: 1;
    }

    /* ---- Message List ---- */
    .messages {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .message {
      display: flex;
      flex-direction: column;
      gap: 4px;
      max-width: 100%;
    }

    .message-header {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      font-weight: 600;
      color: var(--vscode-descriptionForeground);
    }

    .message-header .role-user {
      color: var(--vscode-textLink-foreground);
    }

    .message-header .role-assistant {
      color: var(--vscode-charts-green);
    }

    .message-body {
      font-size: 13px;
      line-height: 1.5;
      white-space: pre-wrap;
      word-wrap: break-word;
      padding: 8px 12px;
      border-radius: 6px;
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
    }

    .message.user .message-body {
      background: var(--vscode-editor-background);
      border-left: 3px solid var(--vscode-textLink-foreground);
    }

    .message.assistant .message-body {
      background: var(--vscode-editor-background);
      border-left: 3px solid var(--vscode-charts-green);
    }

    .message.error .message-body {
      background: var(--vscode-inputValidation-errorBackground);
      border-left: 3px solid var(--vscode-inputValidation-errorBorder);
      color: var(--vscode-errorForeground);
    }

    .message-body code {
      font-family: var(--vscode-editor-font-family);
      font-size: var(--vscode-editor-font-size);
      background: var(--vscode-textCodeBlock-background);
      padding: 1px 4px;
      border-radius: 3px;
    }

    .message-body pre {
      margin: 8px 0;
      padding: 8px;
      background: var(--vscode-textCodeBlock-background);
      border-radius: 4px;
      overflow-x: auto;
    }

    .message-body pre code {
      padding: 0;
      background: none;
    }

    .typing-indicator {
      display: none;
      padding: 8px 12px;
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
      font-style: italic;
    }

    .typing-indicator.visible {
      display: block;
    }

    /* ---- Welcome Screen ---- */
    .welcome {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 32px 16px;
      text-align: center;
      gap: 12px;
      color: var(--vscode-descriptionForeground);
    }

    .welcome h2 {
      font-size: 16px;
      font-weight: 600;
      color: var(--vscode-foreground);
    }

    .welcome p {
      font-size: 12px;
      line-height: 1.6;
      max-width: 280px;
    }

    .welcome kbd {
      padding: 2px 6px;
      font-size: 11px;
      font-family: var(--vscode-editor-font-family);
      background: var(--vscode-keybindingLabel-background);
      color: var(--vscode-keybindingLabel-foreground);
      border: 1px solid var(--vscode-keybindingLabel-border);
      border-radius: 3px;
    }

    /* ---- Input Area ---- */
    .input-area {
      display: flex;
      gap: 6px;
      padding: 8px 12px;
      border-top: 1px solid var(--vscode-panel-border);
      background: var(--vscode-sideBar-background);
      flex-shrink: 0;
    }

    .input-area textarea {
      flex: 1;
      padding: 8px 10px;
      font-family: var(--vscode-font-family);
      font-size: 13px;
      color: var(--vscode-input-foreground);
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border);
      border-radius: 4px;
      resize: none;
      outline: none;
      min-height: 36px;
      max-height: 120px;
      line-height: 1.4;
    }

    .input-area textarea:focus {
      border-color: var(--vscode-focusBorder);
    }

    .input-area textarea::placeholder {
      color: var(--vscode-input-placeholderForeground);
    }

    .send-btn {
      padding: 6px 14px;
      font-size: 13px;
      font-family: var(--vscode-font-family);
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
      border: none;
      border-radius: 4px;
      cursor: pointer;
      align-self: flex-end;
      white-space: nowrap;
    }

    .send-btn:hover {
      background: var(--vscode-button-hoverBackground);
    }

    .send-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  </style>
</head>
<body>
  <div class="header">
    <span class="header-title">DanteCode Chat</span>
    <span class="pdse-badge" id="pdse-badge">
      PDSE: <span id="pdse-score">--</span>
    </span>
  </div>

  <div class="model-bar">
    <label for="model-select">Model:</label>
    <select class="model-select" id="model-select">
      <optgroup label="xAI / Grok">
        <option value="grok/grok-4.2">Grok 4.2</option>
        <option value="grok/grok-4.2-fast">Grok 4.2 Fast</option>
      </optgroup>
      <optgroup label="Anthropic">
        <option value="anthropic/claude-opus-4-6">Claude Opus 4.6</option>
        <option value="anthropic/claude-sonnet-4-6">Claude Sonnet 4.6</option>
        <option value="anthropic/claude-haiku-4-5">Claude Haiku 4.5</option>
      </optgroup>
      <optgroup label="OpenAI">
        <option value="openai/gpt-5.4">GPT-5.4</option>
        <option value="openai/gpt-4.1">GPT-4.1</option>
        <option value="openai/o3-pro">o3-pro</option>
      </optgroup>
      <optgroup label="Google">
        <option value="google/gemini-2.5-pro">Gemini 2.5 Pro</option>
        <option value="google/gemini-2.5-flash">Gemini 2.5 Flash</option>
      </optgroup>
      <optgroup label="Local (Ollama)">
        <option value="ollama/llama4">Llama 4 (local)</option>
        <option value="ollama/codellama">CodeLlama (local)</option>
        <option value="ollama/deepseek-r2">DeepSeek-R2 (local)</option>
      </optgroup>
    </select>
  </div>

  <div class="context-bar" id="context-bar"></div>

  <div class="messages" id="messages">
    <div class="welcome" id="welcome">
      <h2>Welcome to DanteCode</h2>
      <p>Model-agnostic AI coding assistant with DanteForge quality gates.</p>
      <p>Type a message below to start, or use <kbd>Ctrl+Shift+A</kbd> to add files to context.</p>
    </div>
  </div>

  <div class="typing-indicator" id="typing-indicator">DanteCode is thinking...</div>

  <div class="input-area">
    <textarea
      id="input"
      placeholder="Ask DanteCode anything..."
      rows="1"
    ></textarea>
    <button class="send-btn" id="send-btn">Send</button>
  </div>

  <script nonce="${nonce}">
    (function() {
      const vscode = acquireVsCodeApi();

      // DOM references
      const messagesEl = document.getElementById('messages');
      const welcomeEl = document.getElementById('welcome');
      const inputEl = document.getElementById('input');
      const sendBtn = document.getElementById('send-btn');
      const modelSelect = document.getElementById('model-select');
      const contextBar = document.getElementById('context-bar');
      const typingIndicator = document.getElementById('typing-indicator');
      const pdseBadge = document.getElementById('pdse-badge');
      const pdseScoreEl = document.getElementById('pdse-score');

      let isStreaming = false;
      let currentAssistantEl = null;

      // ---- Send message ----
      function sendMessage() {
        const text = inputEl.value.trim();
        if (text.length === 0 || isStreaming) return;

        // Hide welcome screen
        welcomeEl.style.display = 'none';

        // Add user message to UI
        appendMessage('user', text);

        // Clear input
        inputEl.value = '';
        inputEl.style.height = 'auto';

        // Disable send and show typing
        isStreaming = true;
        sendBtn.disabled = true;
        typingIndicator.classList.add('visible');

        // Create empty assistant message element for streaming
        currentAssistantEl = appendMessage('assistant', '');

        // Send to extension host
        vscode.postMessage({ type: 'chat_request', payload: { text: text } });
      }

      sendBtn.addEventListener('click', sendMessage);

      inputEl.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendMessage();
        }
      });

      // Auto-resize textarea
      inputEl.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = Math.min(this.scrollHeight, 120) + 'px';
      });

      // ---- Model change ----
      modelSelect.addEventListener('change', function() {
        vscode.postMessage({
          type: 'model_change',
          payload: { model: this.value }
        });
      });

      // ---- Append a message to the UI ----
      function appendMessage(role, text) {
        const msgEl = document.createElement('div');
        msgEl.className = 'message ' + role;

        const headerEl = document.createElement('div');
        headerEl.className = 'message-header';

        const roleEl = document.createElement('span');
        roleEl.className = 'role-' + role;
        roleEl.textContent = role === 'user' ? 'You' : 'DanteCode';
        headerEl.appendChild(roleEl);

        const bodyEl = document.createElement('div');
        bodyEl.className = 'message-body';
        bodyEl.textContent = text;

        msgEl.appendChild(headerEl);
        msgEl.appendChild(bodyEl);
        messagesEl.appendChild(msgEl);

        // Scroll to bottom
        messagesEl.scrollTop = messagesEl.scrollHeight;

        return bodyEl;
      }

      // ---- Render context file pills ----
      function renderContextFiles(files) {
        contextBar.innerHTML = '';
        if (!files || files.length === 0) return;

        files.forEach(function(filePath) {
          var pill = document.createElement('span');
          pill.className = 'context-pill';

          // Show just the filename, not the full path
          var parts = filePath.replace(/\\\\/g, '/').split('/');
          var fileName = parts[parts.length - 1] || filePath;
          pill.textContent = fileName;

          var removeBtn = document.createElement('span');
          removeBtn.className = 'remove-btn';
          removeBtn.textContent = '\\u00d7';
          removeBtn.title = 'Remove from context';
          removeBtn.addEventListener('click', function() {
            vscode.postMessage({
              type: 'file_remove',
              payload: { filePath: filePath }
            });
          });

          pill.appendChild(removeBtn);
          contextBar.appendChild(pill);
        });
      }

      // ---- Handle messages from extension host ----
      window.addEventListener('message', function(event) {
        var message = event.data;

        switch (message.type) {
          case 'chat_response_chunk':
            if (currentAssistantEl) {
              currentAssistantEl.textContent = message.payload.partial || '';
              messagesEl.scrollTop = messagesEl.scrollHeight;
            }
            break;

          case 'chat_response_done':
            isStreaming = false;
            sendBtn.disabled = false;
            typingIndicator.classList.remove('visible');
            if (currentAssistantEl) {
              currentAssistantEl.textContent = message.payload.text || '';
            }
            currentAssistantEl = null;
            messagesEl.scrollTop = messagesEl.scrollHeight;
            break;

          case 'chat_response':
            // Non-streaming full response
            welcomeEl.style.display = 'none';
            appendMessage('assistant', message.payload.text || '');
            isStreaming = false;
            sendBtn.disabled = false;
            typingIndicator.classList.remove('visible');
            break;

          case 'pdse_score':
            var score = message.payload.overall;
            var passed = message.payload.passedGate;
            pdseScoreEl.textContent = score;
            pdseBadge.classList.add('visible');
            pdseBadge.classList.remove('passed', 'failed');
            pdseBadge.classList.add(passed ? 'passed' : 'failed');
            break;

          case 'error':
            isStreaming = false;
            sendBtn.disabled = false;
            typingIndicator.classList.remove('visible');
            currentAssistantEl = null;
            var errorEl = appendMessage('error', 'Error: ' + (message.payload.message || 'Unknown error'));
            break;

          case 'context_files_update':
            renderContextFiles(message.payload.files || []);
            break;

          case 'model_update':
            var model = message.payload.model || '';
            if (model) {
              modelSelect.value = model;
            }
            break;

          case 'todo_update':
            // Todo updates are displayed as a system notification in chat
            var todos = message.payload.todos || [];
            if (todos.length > 0) {
              var todoText = 'Task Update:\\n' + todos.map(function(t) {
                var icon = t.status === 'completed' ? '[done]' :
                           t.status === 'in_progress' ? '[...]' :
                           t.status === 'failed' ? '[fail]' : '[ ]';
                return icon + ' ' + t.text;
              }).join('\\n');
              appendMessage('assistant', todoText);
            }
            break;

          case 'audit_event':
            // Audit events are silently logged; they appear in the audit panel
            break;
        }
      });

      // ---- Notify extension that webview is ready ----
      vscode.postMessage({ type: 'ready', payload: {} });
    })();
  </script>
</body>
</html>`;
  }
}

/**
 * Generates a random nonce string for Content Security Policy script tags.
 * Uses a 32-character alphanumeric random string.
 */
function getNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
