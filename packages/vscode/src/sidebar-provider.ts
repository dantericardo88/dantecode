// ============================================================================
// DanteCode VS Code Extension — Chat Sidebar Provider
// Implements the chat webview panel with message history, model selection,
// context file management, PDSE score display, settings panel, chat history,
// and skill activation.
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

// ─── Types ────────────────────────────────────────────────────────────────────

/** A persisted chat session for history. */
interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  model: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}

/** Inbound message types sent from the webview to the extension host. */
interface WebviewInboundMessage {
  type:
    | "chat_request"
    | "file_add"
    | "file_remove"
    | "model_change"
    | "skill_activate"
    | "ready"
    | "new_chat"
    | "load_history"
    | "select_chat"
    | "delete_chat"
    | "stop_generation"
    | "open_settings"
    | "save_api_key"
    | "load_settings"
    | "pick_file"
    | "pick_image"
    | "remove_attachment"
    | "paste_image";
  payload: Record<string, unknown>;
}

/** Outbound message types sent from the extension host to the webview. */
interface WebviewOutboundMessage {
  type:
    | "chat_response"
    | "chat_response_chunk"
    | "chat_response_done"
    | "chat_restore"
    | "pdse_score"
    | "audit_event"
    | "todo_update"
    | "context_files_update"
    | "model_update"
    | "error"
    | "chat_history"
    | "settings_data"
    | "key_saved"
    | "generation_stopped"
    | "file_attached"
    | "image_attached"
    | "ollama_models";
  payload: Record<string, unknown>;
}

/** Maps model provider names to SecretStorage key names. */
const PROVIDER_SECRET_KEYS: Record<string, string> = {
  grok: "dantecode.grokApiKey",
  anthropic: "dantecode.anthropicApiKey",
  openai: "dantecode.openaiApiKey",
  google: "dantecode.googleApiKey",
};

/** Provider metadata for the settings panel. */
const SETTINGS_PROVIDERS = [
  { id: "grok", label: "xAI / Grok", placeholder: "xai-...", url: "https://console.x.ai/" },
  { id: "anthropic", label: "Anthropic", placeholder: "sk-ant-...", url: "https://console.anthropic.com/" },
  { id: "openai", label: "OpenAI", placeholder: "sk-...", url: "https://platform.openai.com/api-keys" },
  { id: "google", label: "Google AI", placeholder: "AIza...", url: "https://aistudio.google.com/apikey" },
];

// ─── Provider ─────────────────────────────────────────────────────────────────

/**
 * ChatSidebarProvider implements the VS Code WebviewViewProvider interface
 * to deliver a full chat experience in the sidebar activity bar.
 *
 * Features:
 * - Two-way message channel between webview and extension host
 * - Chat message history with persistence
 * - Context file management
 * - Model selection and switching
 * - API key management via inline settings panel
 * - Chat history with new chat / restore / delete
 * - PDSE score display
 * - Markdown rendering with code copy buttons
 * - Stop generation support
 * - Skill activation from the webview
 */
export class ChatSidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "dantecode.chatView";

  private view: vscode.WebviewView | undefined;
  private messages: Array<{ role: "user" | "assistant"; content: string }> = [];
  private contextFiles: string[] = [];
  private currentModel: string;
  private sessionId: string;
  private currentChatId: string;
  private stopRequested = false;
  private pendingImages: string[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly secrets: vscode.SecretStorage,
    private readonly globalState: vscode.Memento,
  ) {
    const config = vscode.workspace.getConfiguration("dantecode");
    this.currentModel = config.get<string>("defaultModel", "grok/grok-4.2");
    this.sessionId = `vscode-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.currentChatId = this.generateChatId();
  }

  /**
   * Called by VS Code when the webview view needs to be resolved.
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

    webviewView.webview.onDidReceiveMessage(async (message: WebviewInboundMessage) => {
      await this.handleWebviewMessage(message);
    });

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this.sendContextFilesUpdate();
        this.sendModelUpdate();
      }
    });
  }

  // --------------------------------------------------------------------------
  // Message routing
  // --------------------------------------------------------------------------

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
      case "new_chat":
        await this.handleNewChat();
        break;
      case "load_history":
        await this.handleLoadHistory();
        break;
      case "select_chat":
        await this.handleSelectChat(String(message.payload["chatId"] ?? ""));
        break;
      case "delete_chat":
        await this.handleDeleteChat(String(message.payload["chatId"] ?? ""));
        break;
      case "stop_generation":
        this.handleStopGeneration();
        break;
      case "open_settings":
        await this.handleOpenSettings();
        break;
      case "save_api_key":
        await this.handleSaveApiKey(
          String(message.payload["provider"] ?? ""),
          String(message.payload["key"] ?? ""),
        );
        break;
      case "load_settings":
        await this.handleLoadSettings();
        break;
      case "pick_file":
        await this.handlePickFile();
        break;
      case "pick_image":
        await this.handlePickImage();
        break;
      case "remove_attachment":
        this.handleFileRemove(String(message.payload["filePath"] ?? ""));
        break;
      case "paste_image":
        // Image data comes as base64 from the webview; store for next request
        this.pendingImages.push(String(message.payload["data"] ?? ""));
        break;
      case "ready":
        this.sendContextFilesUpdate();
        this.sendModelUpdate();
        void this.scanOllamaModels();
        break;
    }
  }

  // --------------------------------------------------------------------------
  // Chat request handler (with API key retrieval)
  // --------------------------------------------------------------------------

  private async handleChatRequest(text: string): Promise<void> {
    if (text.trim().length === 0) {
      return;
    }

    this.messages.push({ role: "user", content: text });
    this.stopRequested = false;

    // Build model configuration — retrieve API key from SecretStorage
    const [provider, modelId] = this.parseModelString(this.currentModel);
    const secretKey = PROVIDER_SECRET_KEYS[provider];
    let apiKey: string | undefined;
    if (secretKey) {
      const stored = await this.secrets.get(secretKey);
      if (stored) {
        apiKey = stored;
      }
    }

    // Validate that cloud providers have an API key before attempting a request
    if (provider !== "ollama" && !apiKey) {
      const providerMeta = SETTINGS_PROVIDERS.find((p) => p.id === provider);
      const label = providerMeta?.label ?? provider;
      const url = providerMeta?.url ?? "";
      this.postMessage({
        type: "error",
        payload: {
          message:
            `No API key configured for ${label}.\n` +
            `Open the settings panel (gear icon) to add your ${label} API key.` +
            (url ? `\nGet your key at: ${url}` : ""),
        },
      });
      // Remove the user message we just pushed since we can't send
      this.messages.pop();
      return;
    }

    const modelConfig: ModelConfig = {
      provider: provider as ModelConfig["provider"],
      modelId,
      apiKey,
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

    // Build system prompt with workspace context
    const systemParts = [
      "You are DanteCode, a model-agnostic AI coding assistant.",
      "You help users write, review, and improve code with quality-first principles.",
      "Always provide complete, production-ready code. Never use stubs, TODOs, or placeholders.",
    ];

    // Inject workspace context so the model knows about the open project
    const workspaceFolders = vscode.workspace.workspaceFolders;
    const wsFolder = workspaceFolders?.[0];
    if (wsFolder) {
      const projectName = wsFolder.name;
      const projectPath = wsFolder.uri.fsPath;
      systemParts.push("");
      systemParts.push("## Current Workspace");
      systemParts.push(`- Project: ${projectName}`);
      systemParts.push(`- Path: ${projectPath}`);

      // Detect IDE name from environment
      const ideName = vscode.env.appName || "VS Code";
      systemParts.push(`- IDE: ${ideName}`);

      // List open editor tabs for additional context
      const openEditors = vscode.window.tabGroups.all
        .flatMap((g) => g.tabs)
        .filter((tab) => tab.input && typeof (tab.input as { uri?: vscode.Uri }).uri !== "undefined")
        .map((tab) => (tab.input as { uri: vscode.Uri }).uri.fsPath)
        .slice(0, 20);

      if (openEditors.length > 0) {
        systemParts.push("");
        systemParts.push("## Open Files in Editor");
        for (const editorPath of openEditors) {
          // Show relative path if possible
          const relative = editorPath.startsWith(projectPath)
            ? editorPath.substring(projectPath.length + 1).replace(/\\/g, "/")
            : editorPath;
          systemParts.push(`- ${relative}`);
        }
      }
    }

    // Include files the user explicitly added to context
    if (this.contextFiles.length > 0) {
      systemParts.push("");
      systemParts.push("## Context Files (user-selected)");
      systemParts.push("The user has added the following files to context:");
      for (const filePath of this.contextFiles) {
        try {
          const uri = vscode.Uri.file(filePath);
          const content = await vscode.workspace.fs.readFile(uri);
          const fileText = Buffer.from(content).toString("utf-8");
          systemParts.push(`\n--- ${filePath} ---\n${fileText}\n--- end ---`);
        } catch {
          systemParts.push(`\n--- ${filePath} --- (could not read file)`);
        }
      }
    }

    const systemPrompt = systemParts.join("\n");

    const conversationMessages = this.messages.map((msg) => ({
      role: msg.role as "user" | "assistant",
      content: msg.content,
    }));

    try {
      const streamResult = await router.stream(conversationMessages, {
        system: systemPrompt,
        maxTokens: 8192,
      });

      let fullResponse = "";

      for await (const chunk of streamResult.textStream) {
        if (this.stopRequested) {
          break;
        }
        fullResponse += chunk;
        this.postMessage({
          type: "chat_response_chunk",
          payload: { chunk, partial: fullResponse },
        });
      }

      if (this.stopRequested) {
        // Add partial response to history
        if (fullResponse.length > 0) {
          this.messages.push({ role: "assistant", content: fullResponse + "\n\n_(generation stopped)_" });
        }
        this.postMessage({
          type: "generation_stopped",
          payload: { text: fullResponse },
        });
      } else if (fullResponse.trim().length === 0) {
        // Empty response — likely model not found or connection issue
        const hint = provider === "ollama"
          ? `The model "${modelId}" may not be installed. Run: ollama pull ${modelId}`
          : `The model "${modelId}" returned an empty response.`;
        this.postMessage({
          type: "error",
          payload: { message: `No response from ${this.currentModel}. ${hint}` },
        });
      } else {
        this.messages.push({ role: "assistant", content: fullResponse });
        this.postMessage({
          type: "chat_response_done",
          payload: { text: fullResponse },
        });
      }

      // Auto-save current chat to history
      await this.saveChatToHistory();

      // Run PDSE score on code responses
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

      // Audit log
      try {
        await appendAuditEvent(projectRoot, {
          sessionId: this.sessionId,
          timestamp: new Date().toISOString(),
          type: "session_start",
          payload: {
            action: "chat_message",
            chatId: this.currentChatId,
            userMessageLength: text.length,
            assistantMessageLength: fullResponse.length,
            model: this.currentModel,
            contextFileCount: this.contextFiles.length,
            stopped: this.stopRequested,
          },
          modelId: this.currentModel,
          projectRoot,
        });
      } catch {
        // Audit failure is non-critical
      }
    } catch (err: unknown) {
      const rawMessage = err instanceof Error ? err.message : String(err);

      // Build a diagnostic error message with provider context
      let diagnostic = `Error with ${this.currentModel}: ${rawMessage}`;
      if (provider !== "ollama" && !apiKey) {
        diagnostic += `\n\nNo API key was found for "${provider}". Open settings (gear icon) to configure it.`;
      } else if (provider !== "ollama") {
        diagnostic += `\n\nAPI key is configured for "${provider}" — this may be an authentication or model name issue.`;
      } else {
        diagnostic += `\n\nCheck that Ollama is running locally (http://localhost:11434).`;
      }

      this.postMessage({
        type: "error",
        payload: { message: diagnostic },
      });
    }
  }

  // --------------------------------------------------------------------------
  // Chat management handlers
  // --------------------------------------------------------------------------

  private async handleNewChat(): Promise<void> {
    // Save current conversation if non-empty
    if (this.messages.length > 0) {
      await this.saveChatToHistory();
    }

    this.messages = [];
    this.currentChatId = this.generateChatId();
    this.contextFiles = [];
    this.pendingImages = [];
    this.sendContextFilesUpdate();
  }

  private async handleLoadHistory(): Promise<void> {
    const sessions = this.globalState.get<ChatSession[]>("dantecode.chatHistory", []);
    this.postMessage({
      type: "chat_history",
      payload: {
        sessions: sessions.map((s) => ({
          id: s.id,
          title: s.title,
          createdAt: s.createdAt,
          model: s.model,
          messageCount: s.messages.length,
        })),
        currentChatId: this.currentChatId,
      },
    });
  }

  private async handleSelectChat(chatId: string): Promise<void> {
    if (chatId.length === 0) {
      return;
    }

    // Save current conversation first
    if (this.messages.length > 0) {
      await this.saveChatToHistory();
    }

    const sessions = this.globalState.get<ChatSession[]>("dantecode.chatHistory", []);
    const session = sessions.find((s) => s.id === chatId);
    if (session) {
      this.currentChatId = session.id;
      this.messages = [...session.messages];
      this.currentModel = session.model;

      this.postMessage({
        type: "chat_restore",
        payload: { messages: this.messages },
      });
      this.sendModelUpdate();
    }
  }

  private async handleDeleteChat(chatId: string): Promise<void> {
    if (chatId.length === 0) {
      return;
    }

    const sessions = this.globalState.get<ChatSession[]>("dantecode.chatHistory", []);
    const filtered = sessions.filter((s) => s.id !== chatId);
    await this.globalState.update("dantecode.chatHistory", filtered);

    // If we deleted the current chat, start fresh
    if (chatId === this.currentChatId) {
      this.messages = [];
      this.currentChatId = this.generateChatId();
    }

    // Send updated history
    await this.handleLoadHistory();
  }

  private handleStopGeneration(): void {
    this.stopRequested = true;
  }

  // --------------------------------------------------------------------------
  // Settings handlers
  // --------------------------------------------------------------------------

  private async handleOpenSettings(): Promise<void> {
    await this.handleLoadSettings();
  }

  private async handleLoadSettings(): Promise<void> {
    const configured: Record<string, boolean> = {};
    for (const p of SETTINGS_PROVIDERS) {
      const stored = await this.secrets.get(PROVIDER_SECRET_KEYS[p.id] ?? "");
      configured[p.id] = Boolean(stored);
    }

    this.postMessage({
      type: "settings_data",
      payload: {
        providers: SETTINGS_PROVIDERS.map((p) => ({
          ...p,
          configured: configured[p.id] ?? false,
        })),
        currentModel: this.currentModel,
      },
    });
  }

  private async handleSaveApiKey(provider: string, key: string): Promise<void> {
    const secretKey = PROVIDER_SECRET_KEYS[provider];
    if (!secretKey) {
      return;
    }

    if (key.trim().length === 0) {
      // Delete the key
      await this.secrets.delete(secretKey);
    } else {
      await this.secrets.store(secretKey, key.trim());
    }

    this.postMessage({
      type: "key_saved",
      payload: { provider, success: true },
    });
  }

  // --------------------------------------------------------------------------
  // File picker & image attachment handlers
  // --------------------------------------------------------------------------

  private async handlePickFile(): Promise<void> {
    const result = await vscode.window.showOpenDialog({
      canSelectMany: true,
      canSelectFolders: false,
      openLabel: "Attach to Chat",
      title: "Select files to add to DanteCode context",
    });

    if (result && result.length > 0) {
      for (const uri of result) {
        if (!this.contextFiles.includes(uri.fsPath)) {
          this.contextFiles.push(uri.fsPath);
        }
      }
      this.sendContextFilesUpdate();
    }
  }

  private async handlePickImage(): Promise<void> {
    const result = await vscode.window.showOpenDialog({
      canSelectMany: false,
      canSelectFolders: false,
      openLabel: "Attach Image",
      title: "Select image or screenshot",
      filters: {
        Images: ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"],
      },
    });

    if (result && result.length > 0) {
      try {
        const uri = result[0]!;
        const fileData = await vscode.workspace.fs.readFile(uri);
        const base64 = Buffer.from(fileData).toString("base64");
        const ext = uri.fsPath.split(".").pop()?.toLowerCase() ?? "png";
        const mimeMap: Record<string, string> = {
          png: "image/png",
          jpg: "image/jpeg",
          jpeg: "image/jpeg",
          gif: "image/gif",
          webp: "image/webp",
          svg: "image/svg+xml",
          bmp: "image/bmp",
        };
        const mime = mimeMap[ext] ?? "image/png";
        const dataUrl = `data:${mime};base64,${base64}`;
        this.pendingImages.push(dataUrl);

        this.postMessage({
          type: "image_attached",
          payload: {
            dataUrl,
            fileName: uri.fsPath.split(/[\\/]/).pop() ?? "image",
          },
        });
      } catch {
        this.postMessage({
          type: "error",
          payload: { message: "Failed to read image file" },
        });
      }
    }
  }

  // --------------------------------------------------------------------------
  // Ollama auto-discovery
  // --------------------------------------------------------------------------

  /**
   * Scans the local Ollama server for installed models and sends
   * the list to the webview so the model selector can be updated dynamically.
   */
  private async scanOllamaModels(): Promise<void> {
    const baseUrl = process.env["OLLAMA_BASE_URL"]
      ? process.env["OLLAMA_BASE_URL"].replace(/\/v1\/?$/, "")
      : "http://127.0.0.1:11434";

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(`${baseUrl}/api/tags`, { signal: controller.signal });
      clearTimeout(timeout);

      if (!res.ok) {
        return;
      }

      const data = (await res.json()) as {
        models?: Array<{
          name: string;
          details?: { parameter_size?: string; family?: string };
        }>;
      };

      const models = (data.models ?? []).map((m) => {
        const size = m.details?.parameter_size ?? "";
        const family = m.details?.family ?? "";
        const label = size ? `${m.name} (${size})` : m.name;
        return {
          id: `ollama/${m.name}`,
          name: m.name,
          label,
          family,
        };
      });

      this.postMessage({
        type: "ollama_models",
        payload: { models, running: true },
      });
    } catch {
      // Ollama not running — send empty list so UI shows placeholder
      this.postMessage({
        type: "ollama_models",
        payload: { models: [], running: false },
      });
    }
  }

  // --------------------------------------------------------------------------
  // File, model, and skill handlers (existing)
  // --------------------------------------------------------------------------

  private handleFileAdd(filePath: string): void {
    if (filePath.length === 0) {
      return;
    }
    if (!this.contextFiles.includes(filePath)) {
      this.contextFiles.push(filePath);
      this.sendContextFilesUpdate();
    }
  }

  private handleFileRemove(filePath: string): void {
    const index = this.contextFiles.indexOf(filePath);
    if (index !== -1) {
      this.contextFiles.splice(index, 1);
      this.sendContextFilesUpdate();
    }
  }

  private async handleModelChange(model: string): Promise<void> {
    if (model.length === 0) {
      return;
    }
    this.currentModel = model;
    const config = vscode.workspace.getConfiguration("dantecode");
    await config.update("defaultModel", model, vscode.ConfigurationTarget.Global);
    this.sendModelUpdate();
  }

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

  // --------------------------------------------------------------------------
  // Public methods (used by extension.ts)
  // --------------------------------------------------------------------------

  addFileToContext(filePath: string): void {
    this.handleFileAdd(filePath);
    if (this.view) {
      this.sendContextFilesUpdate();
    }
  }

  getCurrentModel(): string {
    return this.currentModel;
  }

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

  private postMessage(message: WebviewOutboundMessage): void {
    if (this.view) {
      void this.view.webview.postMessage(message);
    }
  }

  private sendContextFilesUpdate(): void {
    this.postMessage({
      type: "context_files_update",
      payload: { files: this.contextFiles },
    });
  }

  private sendModelUpdate(): void {
    this.postMessage({
      type: "model_update",
      payload: { model: this.currentModel },
    });
  }

  private getProjectRoot(): string {
    const folders = vscode.workspace.workspaceFolders;
    return folders?.[0]?.uri.fsPath ?? "";
  }

  private parseModelString(model: string): [string, string] {
    const slashIndex = model.indexOf("/");
    if (slashIndex >= 0) {
      return [model.substring(0, slashIndex), model.substring(slashIndex + 1)];
    }
    return ["grok", model];
  }

  private containsCode(text: string): boolean {
    return (
      text.includes("```") ||
      text.includes("function ") ||
      text.includes("const ") ||
      text.includes("class ")
    );
  }

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
    if (blocks.length === 0 && this.containsCode(text)) {
      blocks.push(text);
    }
    return blocks;
  }

  private generateChatId(): string {
    return `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * Generates a title from the first user message in the conversation.
   */
  private generateChatTitle(): string {
    const firstUserMsg = this.messages.find((m) => m.role === "user");
    if (!firstUserMsg) {
      return "New Chat";
    }
    const title = firstUserMsg.content.slice(0, 60).trim();
    return title.length < firstUserMsg.content.length ? title + "..." : title;
  }

  /**
   * Persists the current chat session to globalState history.
   */
  private async saveChatToHistory(): Promise<void> {
    if (this.messages.length === 0) {
      return;
    }

    const sessions = this.globalState.get<ChatSession[]>("dantecode.chatHistory", []);

    // Update existing session or create new one
    const existingIndex = sessions.findIndex((s) => s.id === this.currentChatId);
    const session: ChatSession = {
      id: this.currentChatId,
      title: this.generateChatTitle(),
      createdAt: existingIndex >= 0 ? sessions[existingIndex]!.createdAt : new Date().toISOString(),
      model: this.currentModel,
      messages: [...this.messages],
    };

    if (existingIndex >= 0) {
      sessions[existingIndex] = session;
    } else {
      sessions.unshift(session); // Most recent first
    }

    // Keep only the last 50 chats
    const trimmed = sessions.slice(0, 50);
    await this.globalState.update("dantecode.chatHistory", trimmed);
  }

  // --------------------------------------------------------------------------
  // Webview HTML
  // --------------------------------------------------------------------------

  private getHtmlForWebview(_webview: vscode.Webview): string {
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; img-src data: blob:;">
  <title>DanteCode Chat</title>
  <style nonce="${nonce}">
    * { margin: 0; padding: 0; box-sizing: border-box; }

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

    .header-left {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .header-title {
      font-weight: 600;
      font-size: 13px;
      color: var(--vscode-sideBarSectionHeader-foreground);
    }

    .header-actions {
      display: flex;
      align-items: center;
      gap: 2px;
    }

    .icon-btn {
      background: none;
      border: none;
      color: var(--vscode-foreground);
      cursor: pointer;
      padding: 4px 6px;
      border-radius: 4px;
      font-size: 14px;
      line-height: 1;
      opacity: 0.7;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .icon-btn:hover {
      opacity: 1;
      background: var(--vscode-toolbar-hoverBackground);
    }

    .icon-btn.active {
      opacity: 1;
      background: var(--vscode-toolbar-activeBackground, rgba(255,255,255,0.1));
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

    .pdse-badge.visible { display: flex; }
    .pdse-badge.passed { background: var(--vscode-testing-iconPassed); color: #fff; }
    .pdse-badge.failed { background: var(--vscode-testing-iconFailed); color: #fff; }

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

    .model-select:focus { border-color: var(--vscode-focusBorder); }

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

    .context-bar:empty { display: none; }

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

    .context-pill .remove-btn:hover { opacity: 1; }

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
      justify-content: space-between;
      font-size: 11px;
      font-weight: 600;
      color: var(--vscode-descriptionForeground);
    }

    .message-header .role-user { color: var(--vscode-textLink-foreground); }
    .message-header .role-assistant { color: var(--vscode-charts-green); }

    .msg-actions {
      display: flex;
      gap: 2px;
      opacity: 0;
      transition: opacity 0.15s;
    }

    .message:hover .msg-actions { opacity: 1; }

    .msg-action-btn {
      background: none;
      border: none;
      color: var(--vscode-descriptionForeground);
      cursor: pointer;
      padding: 2px 4px;
      border-radius: 3px;
      font-size: 11px;
    }

    .msg-action-btn:hover {
      background: var(--vscode-toolbar-hoverBackground);
      color: var(--vscode-foreground);
    }

    .message-body {
      font-size: 13px;
      line-height: 1.5;
      word-wrap: break-word;
      padding: 8px 12px;
      border-radius: 6px;
      background: var(--vscode-editor-background);
      border: 1px solid var(--vscode-panel-border);
    }

    .message-body p { margin: 4px 0; }
    .message-body p:first-child { margin-top: 0; }
    .message-body p:last-child { margin-bottom: 0; }

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

    .code-block-wrapper {
      position: relative;
      margin: 8px 0;
    }

    .code-block-wrapper pre {
      margin: 0;
      padding: 10px 12px;
      padding-top: 28px;
      background: var(--vscode-textCodeBlock-background);
      border-radius: 4px;
      overflow-x: auto;
      font-family: var(--vscode-editor-font-family);
      font-size: var(--vscode-editor-font-size);
      line-height: 1.4;
    }

    .code-block-wrapper pre code {
      padding: 0;
      background: none;
    }

    .code-block-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      padding: 2px 8px;
      font-size: 10px;
      color: var(--vscode-descriptionForeground);
      background: rgba(0,0,0,0.2);
      border-radius: 4px 4px 0 0;
    }

    .code-lang { text-transform: uppercase; font-weight: 600; }

    .copy-code-btn {
      background: none;
      border: none;
      color: var(--vscode-descriptionForeground);
      cursor: pointer;
      padding: 1px 6px;
      border-radius: 3px;
      font-size: 10px;
    }

    .copy-code-btn:hover {
      background: var(--vscode-toolbar-hoverBackground);
      color: var(--vscode-foreground);
    }

    .message-body strong { font-weight: 600; }
    .message-body em { font-style: italic; }
    .message-body ul, .message-body ol { margin: 4px 0; padding-left: 20px; }
    .message-body li { margin: 2px 0; }
    .message-body h1, .message-body h2, .message-body h3 {
      margin: 8px 0 4px;
      font-weight: 600;
    }
    .message-body h1 { font-size: 16px; }
    .message-body h2 { font-size: 14px; }
    .message-body h3 { font-size: 13px; }
    .message-body blockquote {
      border-left: 3px solid var(--vscode-textBlockQuote-border);
      padding: 4px 12px;
      margin: 4px 0;
      color: var(--vscode-descriptionForeground);
    }
    .message-body a {
      color: var(--vscode-textLink-foreground);
      text-decoration: none;
    }
    .message-body a:hover { text-decoration: underline; }

    .typing-indicator {
      display: none;
      padding: 8px 12px;
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
      font-style: italic;
    }

    .typing-indicator.visible { display: block; }

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

    /* ---- Attachments Bar ---- */
    .attachments-bar {
      display: none;
      flex-wrap: wrap;
      gap: 6px;
      padding: 6px 12px;
      border-top: 1px solid var(--vscode-panel-border);
      background: var(--vscode-sideBar-background);
      flex-shrink: 0;
    }

    .attachments-bar.has-items { display: flex; }

    .attachment-item {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 3px 8px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      border-radius: 10px;
      font-size: 11px;
      max-width: 180px;
    }

    .attachment-item .att-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .attachment-item .att-remove {
      cursor: pointer;
      opacity: 0.7;
      font-size: 12px;
      line-height: 1;
      flex-shrink: 0;
    }

    .attachment-item .att-remove:hover { opacity: 1; }

    .attachment-thumb {
      width: 32px;
      height: 32px;
      object-fit: cover;
      border-radius: 4px;
      flex-shrink: 0;
    }

    .attachment-item.image-att {
      padding: 3px;
      gap: 6px;
    }

    /* ---- Drop Zone ---- */
    .drop-zone-overlay {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0,120,212,0.15);
      border: 2px dashed var(--vscode-focusBorder);
      z-index: 300;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      font-weight: 600;
      color: var(--vscode-focusBorder);
      pointer-events: none;
    }

    .drop-zone-overlay.visible { display: flex; }

    /* ---- Input Area ---- */
    .input-area {
      display: flex;
      align-items: flex-end;
      gap: 4px;
      padding: 8px 12px;
      border-top: 1px solid var(--vscode-panel-border);
      background: var(--vscode-sideBar-background);
      flex-shrink: 0;
    }

    .attach-btn {
      flex-shrink: 0;
      padding: 4px;
      align-self: flex-end;
      margin-bottom: 2px;
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

    .input-area textarea:focus { border-color: var(--vscode-focusBorder); }
    .input-area textarea::placeholder { color: var(--vscode-input-placeholderForeground); }

    .send-btn, .stop-btn {
      padding: 6px 14px;
      font-size: 13px;
      font-family: var(--vscode-font-family);
      border: none;
      border-radius: 4px;
      cursor: pointer;
      align-self: flex-end;
      white-space: nowrap;
    }

    .send-btn {
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
    }

    .send-btn:hover { background: var(--vscode-button-hoverBackground); }
    .send-btn:disabled { opacity: 0.5; cursor: not-allowed; }

    .stop-btn {
      color: var(--vscode-errorForeground);
      background: var(--vscode-inputValidation-errorBackground);
      border: 1px solid var(--vscode-inputValidation-errorBorder);
      display: none;
    }

    .stop-btn.visible { display: block; }
    .stop-btn:hover { opacity: 0.9; }

    /* ---- Settings Panel Overlay ---- */
    .settings-overlay {
      display: none;
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: var(--vscode-sideBar-background);
      z-index: 100;
      flex-direction: column;
      overflow-y: auto;
    }

    .settings-overlay.visible {
      display: flex;
    }

    .settings-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      border-bottom: 1px solid var(--vscode-panel-border);
      background: var(--vscode-sideBarSectionHeader-background);
      flex-shrink: 0;
    }

    .settings-header h3 {
      font-size: 13px;
      font-weight: 600;
      flex: 1;
    }

    .settings-body {
      padding: 16px 12px;
      display: flex;
      flex-direction: column;
      gap: 16px;
      overflow-y: auto;
      flex: 1;
    }

    .settings-section h4 {
      font-size: 12px;
      font-weight: 600;
      margin-bottom: 8px;
      color: var(--vscode-foreground);
    }

    .settings-section p {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 8px;
    }

    .key-row {
      margin-bottom: 12px;
    }

    .key-row label {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 12px;
      font-weight: 600;
      margin-bottom: 4px;
    }

    .key-status {
      font-size: 10px;
      font-weight: 400;
      padding: 1px 6px;
      border-radius: 8px;
    }

    .key-status.configured {
      background: var(--vscode-testing-iconPassed);
      color: #fff;
    }

    .key-status.missing {
      background: var(--vscode-descriptionForeground);
      color: var(--vscode-editor-background);
      opacity: 0.5;
    }

    .key-input-row {
      display: flex;
      gap: 4px;
    }

    .key-input-row input {
      flex: 1;
      padding: 6px 8px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border);
      border-radius: 3px;
      font-family: var(--vscode-editor-font-family);
      font-size: 12px;
    }

    .key-input-row input:focus {
      outline: none;
      border-color: var(--vscode-focusBorder);
    }

    .key-save-btn {
      padding: 6px 10px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      border-radius: 3px;
      cursor: pointer;
      font-size: 11px;
      white-space: nowrap;
    }

    .key-save-btn:hover { background: var(--vscode-button-hoverBackground); }

    .key-hint {
      font-size: 10px;
      color: var(--vscode-descriptionForeground);
      margin-top: 2px;
    }

    .key-hint a {
      color: var(--vscode-textLink-foreground);
      text-decoration: none;
    }

    .key-hint a:hover { text-decoration: underline; }

    /* ---- History Panel Overlay ---- */
    .history-overlay {
      display: none;
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: var(--vscode-sideBar-background);
      z-index: 100;
      flex-direction: column;
    }

    .history-overlay.visible {
      display: flex;
    }

    .history-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      border-bottom: 1px solid var(--vscode-panel-border);
      background: var(--vscode-sideBarSectionHeader-background);
      flex-shrink: 0;
    }

    .history-header h3 {
      font-size: 13px;
      font-weight: 600;
      flex: 1;
    }

    .history-list {
      flex: 1;
      overflow-y: auto;
      padding: 8px;
    }

    .history-empty {
      text-align: center;
      padding: 24px;
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
    }

    .history-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 10px;
      border-radius: 4px;
      cursor: pointer;
      border: 1px solid transparent;
    }

    .history-item:hover {
      background: var(--vscode-list-hoverBackground);
    }

    .history-item.current {
      border-color: var(--vscode-focusBorder);
      background: var(--vscode-list-activeSelectionBackground);
      color: var(--vscode-list-activeSelectionForeground);
    }

    .history-item-info {
      flex: 1;
      min-width: 0;
    }

    .history-item-title {
      font-size: 12px;
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .history-item-meta {
      font-size: 10px;
      color: var(--vscode-descriptionForeground);
      margin-top: 2px;
    }

    .history-delete-btn {
      background: none;
      border: none;
      color: var(--vscode-descriptionForeground);
      cursor: pointer;
      padding: 2px 4px;
      border-radius: 3px;
      font-size: 12px;
      opacity: 0;
      transition: opacity 0.15s;
    }

    .history-item:hover .history-delete-btn { opacity: 1; }
    .history-delete-btn:hover { color: var(--vscode-errorForeground); }

    /* ---- Toast notification ---- */
    .toast {
      position: fixed;
      bottom: 60px;
      left: 50%;
      transform: translateX(-50%);
      padding: 6px 16px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      border-radius: 4px;
      font-size: 11px;
      z-index: 200;
      opacity: 0;
      transition: opacity 0.2s;
      pointer-events: none;
    }

    .toast.visible { opacity: 1; }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-left">
      <span class="header-title">DanteCode Chat</span>
      <span class="pdse-badge" id="pdse-badge">
        PDSE: <span id="pdse-score">--</span>
      </span>
    </div>
    <div class="header-actions">
      <button class="icon-btn" id="btn-new-chat" title="New Chat"><svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M14 7H9V2H7v5H2v2h5v5h2V9h5z"/></svg></button>
      <button class="icon-btn" id="btn-history" title="Chat History"><svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 13A6 6 0 118 2a6 6 0 010 12zm.5-10H7v5.4l3.8 2.2.5-.9L8.5 9V4z"/></svg></button>
      <button class="icon-btn" id="btn-settings" title="Settings"><svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M9.1 4.4L8.6 2H7.4l-.5 2.4-.7.3-2-1.3-.8.8 1.3 2-.3.7L2 7.4v1.2l2.4.5.3.7-1.3 2 .8.8 2-1.3.7.3.5 2.4h1.2l.5-2.4.7-.3 2 1.3.8-.8-1.3-2 .3-.7 2.4-.5V7.4l-2.4-.5-.3-.7 1.3-2-.8-.8-2 1.3-.7-.3zM8 10a2 2 0 110-4 2 2 0 010 4z"/></svg></button>
    </div>
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
      <optgroup label="Local (Ollama)" id="ollama-optgroup">
        <option value="" disabled>Scanning...</option>
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

  <div class="attachments-bar" id="attachments-bar"></div>

  <div class="input-area">
    <button class="icon-btn attach-btn" id="btn-attach" title="Attach file"><svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M11 2a3 3 0 00-3 3v6.5a1.5 1.5 0 003 0V5a.5.5 0 00-1 0v6.5a.5.5 0 01-1 0V5a2 2 0 014 0v6.5a2.5 2.5 0 01-5 0V5a3 3 0 016 0v6.5a3.5 3.5 0 01-7 0V5h1v6.5a2.5 2.5 0 005 0V5a2 2 0 00-2-2z"/></svg></button>
    <button class="icon-btn attach-btn" id="btn-attach-image" title="Attach image"><svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M14.5 2h-13a.5.5 0 00-.5.5v11a.5.5 0 00.5.5h13a.5.5 0 00.5-.5v-11a.5.5 0 00-.5-.5zM2 3h12v7.1l-2.6-2.6a.5.5 0 00-.7 0L7.5 10.7 5.8 9a.5.5 0 00-.7 0L2 12.1V3zm0 10.1l3.5-3.5L7.1 11.2l.7-.7 3.5-3.5L14 9.7V13H2v-.9zM5 7.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3z"/></svg></button>
    <textarea id="input" placeholder="Ask DanteCode anything..." rows="1"></textarea>
    <button class="send-btn" id="send-btn">Send</button>
    <button class="stop-btn" id="stop-btn">Stop</button>
  </div>

  <!-- Settings Overlay -->
  <div class="settings-overlay" id="settings-overlay">
    <div class="settings-header">
      <button class="icon-btn" id="settings-back" title="Back to chat"><svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M7 1L1 8l6 7V10h8V6H7z"/></svg></button>
      <h3>Settings</h3>
    </div>
    <div class="settings-body" id="settings-body">
      <div class="settings-section">
        <h4>API Keys</h4>
        <p>Keys are stored securely in your OS keychain via VS Code SecretStorage.</p>
        <div id="api-key-fields"></div>
      </div>
    </div>
  </div>

  <!-- History Overlay -->
  <div class="history-overlay" id="history-overlay">
    <div class="history-header">
      <button class="icon-btn" id="history-back" title="Back to chat"><svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M7 1L1 8l6 7V10h8V6H7z"/></svg></button>
      <h3>Chat History</h3>
    </div>
    <div class="history-list" id="history-list"></div>
  </div>

  <!-- Drop Zone Overlay -->
  <div class="drop-zone-overlay" id="drop-zone">Drop files here</div>

  <!-- Toast -->
  <div class="toast" id="toast"></div>

  <script nonce="${nonce}">
    (function() {
      const vscode = acquireVsCodeApi();

      // DOM references
      const messagesEl = document.getElementById('messages');
      const welcomeEl = document.getElementById('welcome');
      const inputEl = document.getElementById('input');
      const sendBtn = document.getElementById('send-btn');
      const stopBtn = document.getElementById('stop-btn');
      const modelSelect = document.getElementById('model-select');
      const contextBar = document.getElementById('context-bar');
      const typingIndicator = document.getElementById('typing-indicator');
      const pdseBadge = document.getElementById('pdse-badge');
      const pdseScoreEl = document.getElementById('pdse-score');
      const settingsOverlay = document.getElementById('settings-overlay');
      const historyOverlay = document.getElementById('history-overlay');
      const historyList = document.getElementById('history-list');
      const apiKeyFields = document.getElementById('api-key-fields');
      const toastEl = document.getElementById('toast');
      const attachmentsBar = document.getElementById('attachments-bar');
      const dropZone = document.getElementById('drop-zone');

      let isStreaming = false;
      let currentAssistantEl = null;
      var pendingImagePreviews = []; // { dataUrl, fileName }

      // ---- Toast ----
      function showToast(msg, durationMs) {
        toastEl.textContent = msg;
        toastEl.classList.add('visible');
        setTimeout(function() { toastEl.classList.remove('visible'); }, durationMs || 2000);
      }

      // ---- Markdown rendering ----
      function renderMarkdown(text) {
        // Escape HTML first
        var html = text
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');

        // Code blocks
        html = html.replace(/\`\`\`(\\w*)\\n([\\s\\S]*?)\`\`\`/g, function(match, lang, code) {
          var langLabel = lang || 'code';
          var id = 'cb-' + Math.random().toString(36).slice(2, 8);
          return '<div class="code-block-wrapper">' +
            '<div class="code-block-header">' +
              '<span class="code-lang">' + langLabel + '</span>' +
              '<button class="copy-code-btn" data-code-id="' + id + '">Copy</button>' +
            '</div>' +
            '<pre><code id="' + id + '">' + code + '</code></pre>' +
          '</div>';
        });

        // Inline code
        html = html.replace(/\`([^\`]+)\`/g, '<code>$1</code>');

        // Headers
        html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
        html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
        html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

        // Bold and italic
        html = html.replace(/\\*\\*\\*(.+?)\\*\\*\\*/g, '<strong><em>$1</em></strong>');
        html = html.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
        html = html.replace(/\\*(.+?)\\*/g, '<em>$1</em>');

        // Blockquotes
        html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');

        // Unordered lists
        html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
        html = html.replace(/(<li>.*<\\/li>\\n?)+/g, '<ul>$&</ul>');

        // Links
        html = html.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, '<a href="$2" target="_blank">$1</a>');

        // Paragraphs: wrap remaining non-tag lines
        html = html.replace(/^(?!<[a-z/])(.*\\S.*)$/gm, '<p>$1</p>');

        // Clean up double-wrapped paragraphs inside lists
        html = html.replace(/<ul><p>/g, '<ul>');
        html = html.replace(/<\\/p><\\/ul>/g, '</ul>');

        return html;
      }

      // ---- Send message ----
      function sendMessage() {
        var text = inputEl.value.trim();
        if (text.length === 0 || isStreaming) return;

        welcomeEl.style.display = 'none';
        appendMessage('user', text, false);

        inputEl.value = '';
        inputEl.style.height = 'auto';

        isStreaming = true;
        sendBtn.style.display = 'none';
        stopBtn.classList.add('visible');
        typingIndicator.classList.add('visible');

        currentAssistantEl = appendMessage('assistant', '', false);

        vscode.postMessage({ type: 'chat_request', payload: { text: text } });

        // Clear image attachments after send
        pendingImagePreviews = [];
        renderAttachments();
      }

      sendBtn.addEventListener('click', sendMessage);

      inputEl.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendMessage();
        }
      });

      inputEl.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = Math.min(this.scrollHeight, 120) + 'px';
      });

      // ---- Stop generation ----
      stopBtn.addEventListener('click', function() {
        vscode.postMessage({ type: 'stop_generation', payload: {} });
      });

      // ---- Model change ----
      modelSelect.addEventListener('change', function() {
        vscode.postMessage({ type: 'model_change', payload: { model: this.value } });
      });

      // ---- New Chat ----
      document.getElementById('btn-new-chat').addEventListener('click', function() {
        vscode.postMessage({ type: 'new_chat', payload: {} });
        // Clear UI
        messagesEl.innerHTML = '';
        messagesEl.appendChild(welcomeEl);
        welcomeEl.style.display = '';
        currentAssistantEl = null;
        pdseBadge.classList.remove('visible');
      });

      // ---- History ----
      document.getElementById('btn-history').addEventListener('click', function() {
        vscode.postMessage({ type: 'load_history', payload: {} });
        historyOverlay.classList.add('visible');
      });

      document.getElementById('history-back').addEventListener('click', function() {
        historyOverlay.classList.remove('visible');
      });

      // ---- Settings ----
      document.getElementById('btn-settings').addEventListener('click', function() {
        vscode.postMessage({ type: 'open_settings', payload: {} });
        settingsOverlay.classList.add('visible');
      });

      document.getElementById('settings-back').addEventListener('click', function() {
        settingsOverlay.classList.remove('visible');
      });

      // ---- File Attachment ----
      document.getElementById('btn-attach').addEventListener('click', function() {
        vscode.postMessage({ type: 'pick_file', payload: {} });
      });

      document.getElementById('btn-attach-image').addEventListener('click', function() {
        vscode.postMessage({ type: 'pick_image', payload: {} });
      });

      function renderAttachments() {
        attachmentsBar.innerHTML = '';
        var hasItems = pendingImagePreviews.length > 0;
        attachmentsBar.classList.toggle('has-items', hasItems);

        pendingImagePreviews.forEach(function(img, idx) {
          var item = document.createElement('div');
          item.className = 'attachment-item image-att';

          var thumb = document.createElement('img');
          thumb.className = 'attachment-thumb';
          thumb.src = img.dataUrl;
          thumb.alt = img.fileName;

          var name = document.createElement('span');
          name.className = 'att-name';
          name.textContent = img.fileName;

          var removeBtn = document.createElement('span');
          removeBtn.className = 'att-remove';
          removeBtn.textContent = '\\u00d7';
          removeBtn.addEventListener('click', function() {
            pendingImagePreviews.splice(idx, 1);
            vscode.postMessage({ type: 'remove_attachment', payload: { index: idx } });
            renderAttachments();
          });

          item.appendChild(thumb);
          item.appendChild(name);
          item.appendChild(removeBtn);
          attachmentsBar.appendChild(item);
        });
      }

      // ---- Drag & Drop ----
      var dragCounter = 0;

      document.addEventListener('dragenter', function(e) {
        e.preventDefault();
        dragCounter++;
        dropZone.classList.add('visible');
      });

      document.addEventListener('dragleave', function(e) {
        e.preventDefault();
        dragCounter--;
        if (dragCounter <= 0) {
          dragCounter = 0;
          dropZone.classList.remove('visible');
        }
      });

      document.addEventListener('dragover', function(e) {
        e.preventDefault();
      });

      document.addEventListener('drop', function(e) {
        e.preventDefault();
        dragCounter = 0;
        dropZone.classList.remove('visible');

        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          Array.from(e.dataTransfer.files).forEach(function(file) {
            if (file.type && file.type.startsWith('image/')) {
              var reader = new FileReader();
              reader.onload = function(ev) {
                var dataUrl = ev.target.result;
                pendingImagePreviews.push({ dataUrl: dataUrl, fileName: file.name });
                vscode.postMessage({ type: 'paste_image', payload: { data: dataUrl } });
                renderAttachments();
              };
              reader.readAsDataURL(file);
            }
          });
        }
      });

      // ---- Clipboard Paste (images) ----
      inputEl.addEventListener('paste', function(e) {
        if (!e.clipboardData || !e.clipboardData.items) return;

        var items = Array.from(e.clipboardData.items);
        items.forEach(function(item) {
          if (item.type && item.type.startsWith('image/')) {
            e.preventDefault();
            var blob = item.getAsFile();
            if (!blob) return;
            var reader = new FileReader();
            reader.onload = function(ev) {
              var dataUrl = ev.target.result;
              pendingImagePreviews.push({ dataUrl: dataUrl, fileName: 'pasted-image.png' });
              vscode.postMessage({ type: 'paste_image', payload: { data: dataUrl } });
              renderAttachments();
            };
            reader.readAsDataURL(blob);
          }
        });
      });

      // ---- Append a message to the UI ----
      function appendMessage(role, text, useMarkdown) {
        var msgEl = document.createElement('div');
        msgEl.className = 'message ' + role;

        var headerEl = document.createElement('div');
        headerEl.className = 'message-header';

        var roleEl = document.createElement('span');
        roleEl.className = 'role-' + role;
        roleEl.textContent = role === 'user' ? 'You' : 'DanteCode';
        headerEl.appendChild(roleEl);

        // Copy message button
        var actionsEl = document.createElement('div');
        actionsEl.className = 'msg-actions';
        var copyBtn = document.createElement('button');
        copyBtn.className = 'msg-action-btn';
        copyBtn.textContent = 'Copy';
        copyBtn.title = 'Copy message';
        copyBtn.addEventListener('click', function() {
          var bodyText = msgEl.querySelector('.message-body').innerText;
          navigator.clipboard.writeText(bodyText).then(function() {
            showToast('Copied to clipboard');
          });
        });
        actionsEl.appendChild(copyBtn);
        headerEl.appendChild(actionsEl);

        var bodyEl = document.createElement('div');
        bodyEl.className = 'message-body';

        if (useMarkdown && text.length > 0) {
          bodyEl.innerHTML = renderMarkdown(text);
          attachCopyCodeHandlers(bodyEl);
        } else {
          bodyEl.textContent = text;
        }

        msgEl.appendChild(headerEl);
        msgEl.appendChild(bodyEl);
        messagesEl.appendChild(msgEl);
        messagesEl.scrollTop = messagesEl.scrollHeight;

        return bodyEl;
      }

      // ---- Attach copy handlers to code blocks ----
      function attachCopyCodeHandlers(container) {
        container.querySelectorAll('.copy-code-btn').forEach(function(btn) {
          btn.addEventListener('click', function() {
            var codeId = btn.getAttribute('data-code-id');
            var codeEl = document.getElementById(codeId);
            if (codeEl) {
              navigator.clipboard.writeText(codeEl.textContent).then(function() {
                btn.textContent = 'Copied!';
                setTimeout(function() { btn.textContent = 'Copy'; }, 1500);
              });
            }
          });
        });
      }

      // ---- Render context file pills ----
      function renderContextFiles(files) {
        contextBar.innerHTML = '';
        if (!files || files.length === 0) return;

        files.forEach(function(filePath) {
          var pill = document.createElement('span');
          pill.className = 'context-pill';

          var parts = filePath.replace(/\\\\/g, '/').split('/');
          var fileName = parts[parts.length - 1] || filePath;
          pill.textContent = fileName;

          var removeBtn = document.createElement('span');
          removeBtn.className = 'remove-btn';
          removeBtn.textContent = '\\u00d7';
          removeBtn.title = 'Remove from context';
          removeBtn.addEventListener('click', function() {
            vscode.postMessage({ type: 'file_remove', payload: { filePath: filePath } });
          });

          pill.appendChild(removeBtn);
          contextBar.appendChild(pill);
        });
      }

      // ---- Render settings providers ----
      function renderSettings(data) {
        var providers = data.providers || [];
        apiKeyFields.innerHTML = '';

        providers.forEach(function(p) {
          var row = document.createElement('div');
          row.className = 'key-row';

          var label = document.createElement('label');
          label.innerHTML = p.label +
            ' <span class="key-status ' + (p.configured ? 'configured' : 'missing') + '">' +
            (p.configured ? 'Configured' : 'Not set') + '</span>';

          var inputRow = document.createElement('div');
          inputRow.className = 'key-input-row';

          var input = document.createElement('input');
          input.type = 'password';
          input.placeholder = p.placeholder;
          input.dataset.provider = p.id;
          if (p.configured) input.placeholder = '****** (saved)';

          var saveBtn = document.createElement('button');
          saveBtn.className = 'key-save-btn';
          saveBtn.textContent = 'Save';
          saveBtn.addEventListener('click', function() {
            var val = input.value.trim();
            if (val.length > 0) {
              vscode.postMessage({ type: 'save_api_key', payload: { provider: p.id, key: val } });
            }
          });

          inputRow.appendChild(input);
          inputRow.appendChild(saveBtn);

          var hint = document.createElement('div');
          hint.className = 'key-hint';
          hint.innerHTML = 'Get your key at: <a href="' + p.url + '">' + p.url + '</a>';

          row.appendChild(label);
          row.appendChild(inputRow);
          row.appendChild(hint);
          apiKeyFields.appendChild(row);
        });
      }

      // ---- Render history list ----
      function renderHistory(data) {
        var sessions = data.sessions || [];
        var currentId = data.currentChatId || '';
        historyList.innerHTML = '';

        if (sessions.length === 0) {
          historyList.innerHTML = '<div class="history-empty">No chat history yet</div>';
          return;
        }

        sessions.forEach(function(s) {
          var item = document.createElement('div');
          item.className = 'history-item' + (s.id === currentId ? ' current' : '');

          var info = document.createElement('div');
          info.className = 'history-item-info';

          var title = document.createElement('div');
          title.className = 'history-item-title';
          title.textContent = s.title;

          var meta = document.createElement('div');
          meta.className = 'history-item-meta';
          var date = new Date(s.createdAt);
          meta.textContent = date.toLocaleDateString() + ' - ' + s.messageCount + ' messages';

          info.appendChild(title);
          info.appendChild(meta);

          var deleteBtn = document.createElement('button');
          deleteBtn.className = 'history-delete-btn';
          deleteBtn.textContent = '\\u00d7';
          deleteBtn.title = 'Delete chat';
          deleteBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            vscode.postMessage({ type: 'delete_chat', payload: { chatId: s.id } });
          });

          item.appendChild(info);
          item.appendChild(deleteBtn);

          item.addEventListener('click', function() {
            vscode.postMessage({ type: 'select_chat', payload: { chatId: s.id } });
            historyOverlay.classList.remove('visible');
          });

          historyList.appendChild(item);
        });
      }

      // ---- Finalize streaming UI ----
      function finishStreaming(text) {
        isStreaming = false;
        sendBtn.style.display = '';
        stopBtn.classList.remove('visible');
        typingIndicator.classList.remove('visible');

        if (currentAssistantEl && text !== undefined) {
          currentAssistantEl.innerHTML = renderMarkdown(text);
          attachCopyCodeHandlers(currentAssistantEl);
        }
        currentAssistantEl = null;
        messagesEl.scrollTop = messagesEl.scrollHeight;
      }

      // ---- Handle messages from extension host ----
      window.addEventListener('message', function(event) {
        var message = event.data;

        switch (message.type) {
          case 'chat_response_chunk':
            if (currentAssistantEl) {
              // Show raw text during streaming, render markdown on completion
              currentAssistantEl.textContent = message.payload.partial || '';
              messagesEl.scrollTop = messagesEl.scrollHeight;
            }
            break;

          case 'chat_response_done':
            finishStreaming(message.payload.text || '');
            break;

          case 'generation_stopped':
            finishStreaming(message.payload.text ? message.payload.text + '\\n\\n_(generation stopped)_' : '');
            showToast('Generation stopped');
            break;

          case 'chat_response':
            welcomeEl.style.display = 'none';
            appendMessage('assistant', message.payload.text || '', true);
            finishStreaming();
            break;

          case 'chat_restore':
            // Restore an entire conversation from history
            messagesEl.innerHTML = '';
            welcomeEl.style.display = 'none';
            var msgs = message.payload.messages || [];
            msgs.forEach(function(m) {
              appendMessage(m.role, m.content, m.role === 'assistant');
            });
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
            sendBtn.style.display = '';
            stopBtn.classList.remove('visible');
            typingIndicator.classList.remove('visible');
            currentAssistantEl = null;
            appendMessage('error', 'Error: ' + (message.payload.message || 'Unknown error'), false);
            break;

          case 'context_files_update':
            renderContextFiles(message.payload.files || []);
            break;

          case 'model_update':
            var model = message.payload.model || '';
            if (model) {
              modelSelect.dataset.pendingModel = model;
              // Try to select — may not exist yet if Ollama models haven't loaded
              var optExists = document.querySelector('option[value="' + model + '"]');
              if (optExists) modelSelect.value = model;
            }
            break;

          case 'chat_history':
            renderHistory(message.payload);
            break;

          case 'settings_data':
            renderSettings(message.payload);
            break;

          case 'key_saved':
            showToast(message.payload.provider + ' API key saved');
            // Refresh settings to update status badges
            vscode.postMessage({ type: 'load_settings', payload: {} });
            break;

          case 'todo_update':
            var todos = message.payload.todos || [];
            if (todos.length > 0) {
              var todoText = 'Task Update:\\n' + todos.map(function(t) {
                var icon = t.status === 'completed' ? '[done]' :
                           t.status === 'in_progress' ? '[...]' :
                           t.status === 'failed' ? '[fail]' : '[ ]';
                return icon + ' ' + t.text;
              }).join('\\n');
              appendMessage('assistant', todoText, false);
            }
            break;

          case 'image_attached':
            pendingImagePreviews.push({
              dataUrl: message.payload.dataUrl || '',
              fileName: message.payload.fileName || 'image',
            });
            renderAttachments();
            break;

          case 'file_attached':
            break;

          case 'ollama_models':
            var ollamaGroup = document.getElementById('ollama-optgroup');
            if (ollamaGroup) {
              ollamaGroup.innerHTML = '';
              var ollamaModels = message.payload.models || [];
              var ollamaRunning = message.payload.running;
              if (!ollamaRunning) {
                var noOpt = document.createElement('option');
                noOpt.value = '';
                noOpt.disabled = true;
                noOpt.textContent = 'Ollama not running';
                ollamaGroup.appendChild(noOpt);
              } else if (ollamaModels.length === 0) {
                var emptyOpt = document.createElement('option');
                emptyOpt.value = '';
                emptyOpt.disabled = true;
                emptyOpt.textContent = 'No models installed';
                ollamaGroup.appendChild(emptyOpt);
              } else {
                ollamaModels.forEach(function(m) {
                  var opt = document.createElement('option');
                  opt.value = m.id;
                  opt.textContent = m.label;
                  ollamaGroup.appendChild(opt);
                });
              }
              // Re-select the current model if it's an ollama model
              if (modelSelect.value === '' || modelSelect.value.startsWith('ollama/')) {
                var curModel = modelSelect.dataset.pendingModel || '';
                if (curModel && document.querySelector('option[value="' + curModel + '"]')) {
                  modelSelect.value = curModel;
                }
              }
            }
            break;

          case 'audit_event':
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
 * Generates a random nonce string for Content Security Policy.
 */
function getNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
