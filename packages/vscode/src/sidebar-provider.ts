// ============================================================================
// DanteCode VS Code Extension — Chat Sidebar Provider
// Implements the chat webview panel with message history, model selection,
// context file management, PDSE score display, settings panel, chat history,
// and skill activation.
// ============================================================================

import * as vscode from "vscode";
import {
  resolve as pathResolve,
  relative as pathRelative,
  basename as pathBasename,
  join as pathJoin,
} from "node:path";
import { appendFileSync, existsSync, unlinkSync } from "node:fs";
import type {
  ChatSessionFile,
  ModelConfig,
  ModelRouterConfig,
  PDSEScore,
  TodoItem,
  AuditEvent,
} from "@dantecode/config-types";
import type { ScoreClaimGateInput } from "@dantecode/core";
import {
  DEFAULT_MODEL_ID,
  ModelRouterImpl,
  SessionStore,
  appendAuditEvent,
  compactTextTranscript,
  createSelfImprovementContext,
  detectSelfImprovementContext,
  getContextUtilization,
  getProviderPromptSupplement,
  getProviderSystemPreamble,
  getStrictModeAddition,
  detectUnverifiedScoreClaims,
  getProviderCatalogEntry,
  parseModelReference,
  readOrInitializeState,
  responseNeedsToolExecutionNudge,
  reviewPullRequest,
  shouldContinueLoop,
  FabricationTracker,
  XmlToolCallParser,
  pruneToolOutputs,
  compactContext,
  filterContextByRelevance,
  wouldOverflow,
  classifyApiError,
} from "@dantecode/core";
import type { FileSnapshot, FabricationEvent } from "@dantecode/core";
import { parseSearchReplaceBlocks, type SearchReplaceBlock } from "@dantecode/core";
import {
  runLocalPDSEScorer,
  runAntiStubScanner,
  runConstitutionCheck,
  queryLessons,
} from "@dantecode/danteforge";
import { generateRepoMap, formatRepoMapForContext, getStatus } from "@dantecode/git-engine";
import {
  executeTool,
  extractToolCalls,
  getReadOnlyToolDefinitionsPrompt,
  getToolDefinitionsPrompt,
  shouldCutStream,
  getWrittenFilePath,
  type DiffReviewPayload,
  type ToolResult,
  type ToolExecutionContext,
} from "./agent-tools.js";
import { getWebviewHtml } from "./webview-html.js";
import { parseRegressionGateProofFromOutput } from "./regression-proof-parser.js";

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
export interface WebviewInboundMessage {
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
    | "paste_image"
    | "save_agent_config"
    | "load_agent_config"
    | "user_confirmed_self_mod"
    | "pr_review_request"
    | "slash_input"
    | "context_pill_add"
    | "retry_last"
    | "branch_chat";
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
    | "ollama_models"
    | "agent_config_data"
    | "mode_update"
    | "autoforge_progress"
    | "self_modification_blocked"
    | "loop_terminated"
    | "diff_hunk"
    | "cost_update"
    | "context_update"
    | "memory_info"
    | "slash_suggestions"
    | "pr_review_result"
    | "tool_result_block";
  payload: Record<string, unknown>;
}

// ─── Agent Mode & Permission Types ──────────────────────────────────────────

/** Agent execution modes — Plan (read-only), Build (default), YOLO (full autonomous). */
export type AgentMode = "plan" | "build" | "yolo";

/** Permission levels for tool categories. */
type PermissionLevel = "allow" | "ask" | "deny";
type PermissionKind = "edit" | "bash" | "tools";

/** Persisted agent configuration stored in globalState + .dantecode/config.json. */
interface AgentConfig {
  agentMode: AgentMode;
  permissions: {
    edit: PermissionLevel;
    bash: PermissionLevel;
    tools: PermissionLevel;
  };
  maxToolRounds: number;
  runUntilComplete: boolean;
  showLiveDiffs: boolean;
}

interface SidebarHostCallbacks {
  onCostUpdate?: (update: {
    model: string;
    modelTier: "fast" | "capable";
    sessionTotalUsd: number;
  }) => void;
  onDiffReview?: (payload: DiffReviewPayload) => void;
  onModelChange?: (model: string) => void;
  onStatusBarUpdate?: (info: {
    model?: string;
    contextPercent?: number;
    activeTasks?: number;
    hasError?: boolean;
  }) => void;
  onSearchReplaceBlocks?: (blocks: SearchReplaceBlock[]) => void;
  onCircuitStateChange?: (isOpen: boolean) => void;
  onOutputLine?: (line: string) => void;
}

/** Default config for new users. */
const DEFAULT_AGENT_CONFIG: AgentConfig = {
  agentMode: "build",
  permissions: { edit: "allow", bash: "ask", tools: "allow" },
  maxToolRounds: 15,
  runUntilComplete: false,
  showLiveDiffs: true,
};

/** Read-only tools allowed in Plan mode. */
const PLAN_MODE_TOOLS = new Set(["Read", "ListDir", "Glob", "Grep"]);

export interface ChatPromptProfile {
  contextWindow: number;
  maxResponseTokens: number;
  firstChunkTimeoutMs: number;
  heartbeatMs: number;
  repoMapMaxFiles: number;
  workspaceTreeMaxDepth: number;
  workspaceTreeMaxFiles: number;
  keyFileMaxChars: number;
  activeFileMaxChars: number;
  contextFileMaxChars: number;
}

const CLOUD_CHAT_PROMPT_PROFILE: ChatPromptProfile = {
  contextWindow: 131_072,
  maxResponseTokens: 16_384,
  firstChunkTimeoutMs: 60_000,
  heartbeatMs: 4_000,
  repoMapMaxFiles: 150,
  workspaceTreeMaxDepth: 3,
  workspaceTreeMaxFiles: 200,
  keyFileMaxChars: 4_000,
  activeFileMaxChars: 8_000,
  contextFileMaxChars: 24_000,
};

const OLLAMA_CHAT_PROMPT_PROFILE: ChatPromptProfile = {
  contextWindow: 8_192,
  maxResponseTokens: 4_096,
  firstChunkTimeoutMs: 180_000,
  heartbeatMs: 8_000,
  repoMapMaxFiles: 40,
  workspaceTreeMaxDepth: 2,
  workspaceTreeMaxFiles: 80,
  keyFileMaxChars: 1_500,
  activeFileMaxChars: 2_500,
  contextFileMaxChars: 6_000,
};

export function getChatPromptProfile(provider: string, agentMode: AgentMode): ChatPromptProfile {
  if (provider === "ollama") {
    return {
      ...OLLAMA_CHAT_PROMPT_PROFILE,
      maxResponseTokens: agentMode === "plan" ? 2_048 : OLLAMA_CHAT_PROMPT_PROFILE.maxResponseTokens,
    };
  }

  return CLOUD_CHAT_PROMPT_PROFILE;
}

export function getToolDefinitionsPromptForAgentMode(agentMode: AgentMode): string {
  return agentMode === "plan" ? getReadOnlyToolDefinitionsPrompt() : getToolDefinitionsPrompt();
}

/** Maps model provider names to SecretStorage key names. */
const PROVIDER_SECRET_KEYS: Record<string, string> = {
  grok: "dantecode.grokApiKey",
  anthropic: "dantecode.anthropicApiKey",
  openai: "dantecode.openaiApiKey",
  google: "dantecode.googleApiKey",
};

/** Provider metadata for the settings panel. */
const SETTINGS_PROVIDER_IDS = new Set(Object.keys(PROVIDER_SECRET_KEYS));
const PROVIDER_PLACEHOLDERS: Partial<Record<keyof typeof PROVIDER_SECRET_KEYS, string>> = {
  grok: "xai-...",
  anthropic: "sk-ant-...",
  openai: "sk-...",
  google: "AIza...",
};
const SETTINGS_PROVIDERS = Array.from(SETTINGS_PROVIDER_IDS)
  .map((providerId) => {
    const provider = getProviderCatalogEntry(providerId);
    if (!provider) {
      return null;
    }

    return {
      id: provider.id,
      label: provider.label,
      placeholder: PROVIDER_PLACEHOLDERS[provider.id] ?? "",
      url: provider.docsUrl ?? "",
    };
  })
  .filter((provider): provider is NonNullable<typeof provider> => provider !== null);

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
  // /ascend autonomous loop state. Persists across cycles; `handleStopGeneration`
  // clears `ascendActive` so the loop exits between cycles when the user clicks Stop.
  private ascendActive = false;
  private abortController: AbortController | null = null;
  private pendingImages: string[] = [];
  private agentConfig: AgentConfig = { ...DEFAULT_AGENT_CONFIG };
  private readonly diffContents = new Map<string, string>();
  private sessionStore: SessionStore | null = null;
  private sessionStoreMigrated = false;
  private activeTasks = 0;
  private lastContextPercent = 0;
  /** Dynamic round budget requested by pipeline orchestrators. */
  private pendingRequiredRounds = 0;
  /** Currently active skill name. Enables universal pipeline continuation for all skills. */
  private activeSkill: string | null = null;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly secrets: vscode.SecretStorage,
    private readonly globalState: vscode.Memento,
    private readonly hostCallbacks: SidebarHostCallbacks = {},
  ) {
    const config = vscode.workspace.getConfiguration("dantecode");
    this.currentModel = config.get<string>("defaultModel", DEFAULT_MODEL_ID);
    this.sessionId = `vscode-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.currentChatId = this.generateChatId();

    // Restore agent config from globalState
    const savedConfig = this.globalState.get<AgentConfig>("dantecode.agentConfig");
    if (savedConfig) {
      this.agentConfig = { ...DEFAULT_AGENT_CONFIG, ...savedConfig };
    }

    // Register virtual document provider for diff "before" content
    vscode.workspace.registerTextDocumentContentProvider("dantecode-diff", {
      provideTextDocumentContent: (uri: vscode.Uri) => {
        return this.diffContents.get(uri.toString()) ?? "";
      },
    });
  }

  // --------------------------------------------------------------------------
  // Status bar integration
  // --------------------------------------------------------------------------

  /**
   * Updates the status bar with current model, context utilization, and active
   * task count. Should be called after each model response and when background
   * tasks change.
   */
  updateStatusBar(info: {
    model?: string;
    contextPercent?: number;
    activeTasks?: number;
    hasError?: boolean;
  }): void {
    if (info.contextPercent !== undefined) {
      this.lastContextPercent = info.contextPercent;
    }
    if (info.activeTasks !== undefined) {
      this.activeTasks = info.activeTasks;
    }
    this.hostCallbacks.onStatusBarUpdate?.({
      model: info.model ?? this.currentModel,
      contextPercent: info.contextPercent ?? this.lastContextPercent,
      activeTasks: info.activeTasks ?? this.activeTasks,
      hasError: info.hasError,
    });
  }

  // --------------------------------------------------------------------------
  // Injector setters (wired from extension.ts after construction)
  // --------------------------------------------------------------------------

  setContextRetriever(_retriever: unknown): void {
    /* wired externally */
  }
  setLspInjector(_injector: unknown): void {
    /* wired externally */
  }
  setTerminalOutputManager(_mgr: unknown): void {
    /* wired externally */
  }
  setDebugAttachProvider(_provider: unknown): void {
    /* wired externally */
  }

  /**
   * Called by VS Code when the webview view needs to be resolved.
   */
  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    // Diagnostic: log activation so we can tell from the bypass log whether the
    // webview view is actually being resolved by the host. Also clear stale
    // RELOAD_NEEDED markers — they accumulate from the deploy script and
    // confuse the stale-build gate when the user has actually reloaded.
    try {
      appendFileSync(
        "C:/tmp/dante-bypass.log",
        `[${new Date().toISOString()}] resolveWebviewView CALLED\n`,
      );
      const marker = pathJoin(this.extensionUri.fsPath, "dist", "RELOAD_NEEDED");
      if (existsSync(marker)) {
        unlinkSync(marker);
      }
    } catch { /* best-effort diagnostics */ }

    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    // CRITICAL: wrap getHtmlForWebview in try/catch. If it throws (e.g., MODEL_CATALOG
    // access fails, template literal accidentally hits a syntax issue, etc.), the
    // chat panel renders blank and the user has no way to recover. With this guard
    // they at least see the error message and a reload prompt.
    try {
      webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);
    } catch (htmlErr) {
      const msg = htmlErr instanceof Error ? htmlErr.message : String(htmlErr);
      try {
        appendFileSync(
          "C:/tmp/dante-bypass.log",
          `  getHtmlForWebview THREW: ${msg}\n${htmlErr instanceof Error ? htmlErr.stack ?? "" : ""}\n`,
        );
      } catch { /* ignore */ }
      webviewView.webview.html =
        `<!DOCTYPE html><html><body style="color:var(--vscode-errorForeground,#c0392b);padding:20px;font-family:monospace;font-size:12px;">` +
        `<h3>DanteCode failed to render</h3>` +
        `<pre style="white-space:pre-wrap;word-break:break-word;">${String(msg).replaceAll("<", "&lt;")}</pre>` +
        `<p>Reload the window: <kbd>Ctrl+Shift+P</kbd> → Developer: Reload Window. ` +
        `If it persists, check <code>C:/tmp/dante-bypass.log</code> for the stack trace.</p>` +
        `</body></html>`;
    }

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

  async handleWebviewMessage(message: WebviewInboundMessage): Promise<void> {
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
      case "save_agent_config":
        await this.handleSaveAgentConfig(message.payload as Partial<AgentConfig>);
        break;
      case "load_agent_config":
        this.handleLoadAgentConfig();
        break;
      case "ready":
        this.sendContextFilesUpdate();
        this.sendModelUpdate();
        this.handleLoadAgentConfig();
        void this.scanOllamaModels();
        void this.sendMemoryInfo();
        break;
      case "slash_input":
        this.handleSlashInput(String(message.payload["prefix"] ?? ""));
        break;
      case "context_pill_add":
        this.handleFileAdd(String(message.payload["path"] ?? ""));
        break;
      case "retry_last":
        this.handleRetryLast();
        break;
      case "branch_chat":
        break;
      case "pr_review_request": {
        const prNum = Number((message.payload as { prNumber?: unknown })?.prNumber ?? 0);
        if (!prNum) {
          this.postMessage({ type: "error", payload: { message: "Invalid PR number" } });
          break;
        }
        const repo = (message.payload as { repo?: string })?.repo;
        try {
          const result = await reviewPullRequest({ prNumber: prNum, repo });
          this.postMessage({
            type: "pr_review_result",
            payload: result as unknown as Record<string, unknown>,
          });
        } catch (err) {
          this.postMessage({ type: "error", payload: { message: String(err) } });
        }
        break;
      }
      case "user_confirmed_self_mod":
        break;
    }
  }

  private handleRetryLast(): void {
    const lastUserMsg = [...this.messages].reverse().find((m) => m.role === "user");
    if (!lastUserMsg) {
      this.postMessage({ type: "error", payload: { message: "No user message to retry" } });
      return;
    }
    void this.handleChatRequest(lastUserMsg.content);
  }

  private handleSlashInput(prefix: string): void {
    const allCommands = [
      { cmd: "/file", desc: "Add a file to context" },
      { cmd: "/symbol", desc: "Search for a code symbol" },
      { cmd: "/git", desc: "Add git diff or log" },
      { cmd: "/web", desc: "Search the web" },
      { cmd: "/memory", desc: "Query agent memory" },
      { cmd: "/skill", desc: "Activate a skill" },
      { cmd: "/debug", desc: "Start a debug session" },
      { cmd: "/review", desc: "Review changes" },
    ];
    const commands = prefix ? allCommands.filter((c) => c.cmd.startsWith(prefix)) : allCommands;
    this.postMessage({ type: "slash_suggestions", payload: { commands } });
  }

  // --------------------------------------------------------------------------
  // Permission helpers
  // --------------------------------------------------------------------------

  private async resolveToolPermissionBlock(
    toolName: string,
    permission: PermissionKind,
  ): Promise<string | null> {
    const level = this.agentConfig.permissions[permission];
    if (level === "allow") {
      return null;
    }

    if (level === "deny") {
      if (permission === "edit") {
        return `Tool "${toolName}" blocked: File editing is denied by permissions.`;
      }
      if (permission === "bash") {
        return `Tool "${toolName}" blocked: Shell commands are denied by permissions.`;
      }
      return `Tool "${toolName}" blocked: Tool execution is denied by permissions.`;
    }

    const prompt =
      permission === "edit"
        ? `DanteCode wants to modify files via ${toolName}. Allow this action once?`
        : permission === "bash"
          ? `DanteCode wants to run a shell command via ${toolName}. Allow this action once?`
          : `DanteCode wants to use the ${toolName} tool. Allow this action once?`;
    const deniedMessage =
      permission === "edit"
        ? `Tool "${toolName}" blocked: File editing was not approved.`
        : permission === "bash"
          ? `Tool "${toolName}" blocked: Shell command execution was not approved.`
          : `Tool "${toolName}" blocked: Tool execution was not approved.`;

    const selection = await vscode.window.showWarningMessage(
      prompt,
      { modal: true },
      "Allow once",
      "Block",
    );
    return selection === "Allow once" ? null : deniedMessage;
  }

  // --------------------------------------------------------------------------
  // Chat request handler (with API key retrieval)
  // --------------------------------------------------------------------------

  private async handleChatRequest(text: string): Promise<void> {
    if (text.trim().length === 0) {
      return;
    }

    // Stale-build gate: if a rebuild happened but the window was never reloaded,
    // block all chat requests and prompt the user to reload first.
    {
      const { existsSync } = await import("node:fs");
      const { join } = await import("node:path");
      const _marker = join(this.extensionUri.fsPath, "dist", "RELOAD_NEEDED");
      if (existsSync(_marker)) {
        this.messages.push({ role: "user", content: text });
        this.postMessage({
          type: "chat_response_chunk",
          payload: {
            chunk:
              "⚠️ **DanteCode was rebuilt but this window is running the old version.**\n\n" +
              "Reload the window to activate the latest fixes before sending messages.\n\n" +
              "> `Ctrl+Shift+P` → **Developer: Reload Window**",
            partial: "",
          },
        });
        this.postMessage({ type: "chat_response_done", payload: {} });
        void vscode.window
          .showInformationMessage(
            "DanteCode was rebuilt. Reload window to activate the latest fixes.",
            "Reload Now",
          )
          .then((sel) => {
            if (sel === "Reload Now") {
              void vscode.commands.executeCommand("workbench.action.reloadWindow");
            }
          });
        return;
      }
    }

    // Expand slash commands before processing
    try {
      const { parseSlashCommand, buildSlashPrompt } = await import("./slash-commands.js");
      const parsed = parseSlashCommand(text);
      if (parsed) {
        // /ascend is special: it drives the model in an autonomous loop instead
        // of bypassing the model. Hits the orchestrator BEFORE the execute()
        // shell-out fallback so we get real autonomous improvement, not theater.
        if (parsed.command.name === "ascend") {
          this.hostCallbacks.onOutputLine?.(`[DanteCode] /ascend → autonomous loop`);
          this.messages.push({ role: "user", content: text });
          await this.runAscendLoop(parsed.args);
          return;
        }
        // Commands with execute() run directly — no LLM involvement.
        if (parsed.command.execute) {
          const projectRoot = this.getProjectRoot();
          this.messages.push({ role: "user", content: text });
          try {
            // Stream chunks live to the chat as the command runs, so the user
            // sees output (e.g. ascend's per-cycle progress) in real time.
            // If execute() doesn't call onChunk, post the full output once at end.
            let streamed = "";
            const output = await parsed.command.execute(parsed.args, projectRoot, (chunk) => {
              streamed += chunk;
              this.postMessage({
                type: "chat_response_chunk",
                payload: { chunk, partial: streamed },
              });
            });
            if (streamed.length === 0) {
              this.postMessage({
                type: "chat_response_chunk",
                payload: { chunk: output, partial: output },
              });
            }
            this.messages.push({ role: "assistant", content: output });
          } catch (execErr: unknown) {
            const msg = execErr instanceof Error ? execErr.message : String(execErr);
            this.postMessage({ type: "error", payload: { message: msg } });
          }
          this.postMessage({ type: "chat_response_done", payload: {} });
          return;
        }
        // Commands with prepare() inject live context, then fall through to the model loop.
        if (parsed.command.prepare) {
          try {
            const prefix = await parsed.command.prepare(parsed.args, this.getProjectRoot());
            if (prefix) text = prefix + text;
          } catch { /* prepare is best-effort */ }
        }
        const editor = vscode.window.activeTextEditor;
        const selection =
          editor && !editor.selection.isEmpty ? editor.document.getText(editor.selection) : "";
        const filePath = editor?.document.uri.fsPath ?? "";
        text = buildSlashPrompt(parsed.command, selection, filePath, parsed.args);
      }
    } catch {
      // Slash command expansion is best-effort
    }

    const projectRoot = this.getProjectRoot();
    // /ascend is a sanctioned self-improvement workflow — when the orchestrator
    // is driving, every cycle is implicitly authorized to modify DanteCode's own
    // source. Without this fallback, every Edit to packages/vscode/src/* gets
    // blocked by isProtectedWriteTarget and the model spirals into more Reads.
    // The orchestrator's goal prompt starts with `[Ascend Cycle X/Y]` (not the
    // literal `/ascend`), so detectSelfImprovementContext's slash regex misses
    // it — the ascendActive flag is the canonical signal.
    const selfImprovement =
      detectSelfImprovementContext(text, projectRoot) ??
      (this.ascendActive
        ? createSelfImprovementContext(projectRoot, {
            workflowId: "ascend-self-improve",
            triggerCommand: "/ascend",
          })
        : undefined) ??
      (this.activeSkill
        ? createSelfImprovementContext(projectRoot, {
            workflowId: "skill-pipeline",
            triggerCommand: `skill:${this.activeSkill}`,
          })
        : undefined);
    const readTracker = new Map<string, FileSnapshot>();
    const editAttempts = new Map<string, number>();
    // Sprint 2 — session tool output accumulator (reset per handleChatRequest, not per round)
    const _sessionToolOutputs: string[] = [];
    let _sessionRanImprovementCmd = false;
    let _sessionVerifiedScoreOutput: string | null = null;
    let _sessionRegressionGateProof: ScoreClaimGateInput | null = null;
    // Sprint 5 — narration loop brake (Cline ActModeRespondHandler pattern)
    let _consecutiveTextOnlyRounds = 0;

    this.messages.push({ role: "user", content: text });
    this.stopRequested = false;
    this.abortController = new AbortController();

    // Resolve @-mention context providers and prepend to the user message
    try {
      const { globalContextRegistry, formatForPrompt } = await import("./context-provider.js");
      const contextItems = await globalContextRegistry.resolveAllMentions(text, projectRoot);
      if (contextItems.length > 0) {
        const contextBlock = formatForPrompt(contextItems);
        // Prepend the context block to the last (user) message
        const lastMsg = this.messages[this.messages.length - 1];
        if (lastMsg && lastMsg.role === "user") {
          lastMsg.content = `${contextBlock}\n\n${String(lastMsg.content)}`;
        }
      }
    } catch {
      // Context resolution is best-effort — never block the chat request
    }

    // Detect pipeline workflows and set dynamic round budget.
    // Any active skill gets 80 rounds; heavy DanteForge pipelines get 150.
    if (/\/(?:magic|inferno|blaze)\b/i.test(text)) {
      this.pendingRequiredRounds = 150;
    } else if (this.activeSkill || /\/(?:autoforge|party|ember)\b/i.test(text)) {
      this.pendingRequiredRounds = 80;
    }
    const { signal } = this.abortController;

    // Build model configuration — retrieve API key from SecretStorage
    const [provider, modelId] = this.parseModelString(this.currentModel);
    const promptProfile = getChatPromptProfile(provider, this.agentConfig.agentMode);
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
      maxTokens: promptProfile.maxResponseTokens,
      temperature: 0.1,
      contextWindow: promptProfile.contextWindow,
      supportsVision: false,
      supportsToolCalls: true,
    };

    // Build auto-fallback chain for Grok models
    const fallbackModels: ModelConfig[] = [];
    if (provider === "grok" && apiKey) {
      const grokFallbacks = ["grok-4-1-fast-non-reasoning", "grok-3", "grok-3-mini"];
      for (const fbId of grokFallbacks) {
        if (fbId !== modelId) {
          fallbackModels.push({ ...modelConfig, modelId: fbId });
        }
      }
    }

    const routerConfig: ModelRouterConfig = {
      default: modelConfig,
      fallback: fallbackModels,
      overrides: {},
    };

    const router = new ModelRouterImpl(routerConfig, projectRoot, this.sessionId);

    // Resolve agent mode settings
    const { agentMode, runUntilComplete } = this.agentConfig;
    // Dynamic round budget: pipeline workflows (/magic, /autoforge, /party) can
    // request more rounds via requiredRounds. YOLO mode gets 50, runUntilComplete
    // gets 30, pipeline gets its requested budget, otherwise use the user's setting.
    const pipelineRounds = this.pendingRequiredRounds ?? 0;
    const effectiveMaxRounds =
      pipelineRounds > 0
        ? Math.max(pipelineRounds, 50)
        : agentMode === "yolo"
          ? 50
          : runUntilComplete
            ? 30
            : this.agentConfig.maxToolRounds;
    this.pendingRequiredRounds = 0; // Reset after use
    let executionNudges = 0;
    const MAX_EXECUTION_NUDGES = 2;
    let executedToolsThisTurn = 0;
    let pipelineContinuationNudges = 0;
    // Anti-confabulation guards (Grok empty-response / phantom-completion fix)
    let consecutiveEmptyRounds = 0;
    const MAX_CONSECUTIVE_EMPTY_ROUNDS = 3;
    let confabulationNudges = 0;
    const MAX_CONFABULATION_NUDGES = 2;
    // Cross-round tool-failure log — used to catch fabricated success claims
    const failedToolsLog: Array<{ name: string; error: string; round: number }> = [];
    // Gate 8/9: session-scoped fabrication tracker
    const fabricationTracker = new FabricationTracker();
    // Gate 12: session-scoped verified git ops log — ground truth SHAs only the runtime can generate
    const verifiedOpsLog: Array<{ tool: string; sha: string; round: number; ts: number }> = [];

    // Build system prompt with full workspace context + tool definitions
    const systemParts = [
      "You are DanteCode, an autonomous AI coding agent.",
      // NOTE: Grok identity preamble is prepended below after array init — do not move this comment
      "You help users write, review, and improve code with quality-first principles.",
      "Always provide complete, production-ready code. Never use stubs, TODOs, or placeholders.",
      "",
      "## CRITICAL RULES — NEVER VIOLATE THESE",
      "1. NEVER claim you completed work unless you actually used a tool (Read/Write/Edit/Bash) and received a real result back.",
      "2. NEVER say 'deployed', 'live', 'complete', 'done', or '✅' for work you did not do with actual tool calls.",
      "3. If you cannot do something (e.g., git push, install extension), say so honestly. Do NOT pretend you did it.",
      "4. Every claim of a file change MUST be preceded by a real Edit or Write tool call that returned a success result.",
      "5. Do NOT fabricate tool outputs, diffs, test results, coverage numbers, or PDSE scores. Only report real tool results.",
      "6. Do NOT make up file names, test counts, or progress percentages. If you haven't read or run something, say 'not verified'.",
      "7. When asked about progress, report ONLY what tool calls have actually confirmed. Everything else is 'pending' or 'unverified'.",
      "",
      "## Response Formatting",
      "Format every response for maximum readability in the VS Code sidebar:",
      "- Start with a brief **Summary** of what you did or will do.",
      "- Use ## headings to organize sections (e.g., ## Analysis, ## Changes Made, ## Recommendations).",
      "- Use **bold** for key terms, `inline code` for file names, functions, and commands.",
      "- Use bullet lists and numbered lists for multi-point information.",
      "- Use markdown tables when comparing options, listing files changed, or showing structured data.",
      "- Use > blockquotes for important warnings or callouts.",
      "- Use ```language for all code blocks with the correct language identifier.",
      "- Keep paragraphs short (2-3 sentences max).",
      "",
    ];

    // Prepend Grok identity binding BEFORE all other system content.
    // Affirmative framing (who Grok is + what it's good at) must precede defensive rules
    // to activate Grok's native truth-seeking mode. Zero impact on other providers.
    const _grokPreamble = getProviderSystemPreamble(provider);
    if (_grokPreamble) {
      systemParts.unshift("", _grokPreamble);
    }

    if (selfImprovement?.enabled) {
      systemParts.push("## Explicit Self-Improvement Workflow");
      systemParts.push(
        `Protected source edits are explicitly allowed for this request under workflow ${selfImprovement.workflowId}.`,
      );
      systemParts.push(
        "Use protected writes only when they directly advance the self-improvement task, and verify each major edit batch from the repository root.",
      );
      systemParts.push("");
    }

    // Mode-specific instructions
    if (agentMode === "plan") {
      systemParts.push("## Mode: PLAN (Read-Only)");
      systemParts.push(
        "You are in PLAN mode. You can ONLY use read-only tools: Read, ListDir, Glob, Grep.",
      );
      systemParts.push("Do NOT write, edit, or execute any commands. Analyze and plan only.");
      systemParts.push(
        "Present a detailed implementation plan the user can approve before switching to Build mode.",
      );
      systemParts.push("");
    } else if (agentMode === "yolo") {
      systemParts.push("## Mode: YOLO (Full Autonomous)");
      systemParts.push(
        "You are in YOLO mode. Execute tasks fully and autonomously. Do NOT stop to ask for confirmation.",
      );
      systemParts.push(
        "IMMEDIATELY use <tool_use> blocks to read files, write code, and run commands.",
      );
      systemParts.push(
        "Plan briefly (2-3 sentences max), then execute EVERY step using tools: Read → Edit/Write → Bash.",
      );
      systemParts.push("Continue working through all tool rounds until the task is 100% complete.");
      systemParts.push(
        "If you encounter an error, fix it and continue. Only stop when the task is done.",
      );
      systemParts.push(
        "IMPORTANT: Do NOT write fake progress updates or claim things are 'deployed' or 'live' unless a tool call confirmed it.",
      );
      systemParts.push(
        "Only report actual tool results. If a task requires more steps, use more tools — do not skip steps by pretending they happened.",
      );
      systemParts.push("");
    } else {
      systemParts.push("## Mode: BUILD");
      systemParts.push(
        "When the user asks you to build, implement, or fix something, USE tools immediately.",
      );
      systemParts.push(
        "Do NOT just describe what you would do. Actually do it with <tool_use> blocks.",
      );
      if (runUntilComplete) {
        systemParts.push(
          "The user has enabled 'Run Until Complete'. Execute the full task without stopping early.",
        );
      }
      systemParts.push("");
    }

    systemParts.push(getProviderPromptSupplement(provider));
    systemParts.push("");

    // Skill execution: inject tool recipes and execution protocol when a skill is active.
    // This teaches non-Claude models (Grok, GPT, etc.) how to perform operations that
    // Claude Code handles natively (WebSearch, WebFetch, Agent) using Bash equivalents.
    if (this.activeSkill) {
      systemParts.push("## Tool Recipes for Skill Execution");
      systemParts.push("");
      systemParts.push(
        "When executing skills, you may need capabilities beyond the basic tool set.",
      );
      systemParts.push(
        "Use Bash to access these — do NOT skip steps because a dedicated tool is missing.",
      );
      systemParts.push("");
      systemParts.push("### Searching GitHub");
      systemParts.push("```bash");
      systemParts.push(
        'gh search repos "react state management" --limit 10 --json name,url,description,stargazersCount',
      );
      systemParts.push("```");
      systemParts.push(
        'To search code: `gh search code "pattern" --limit 10 --json path,repository`',
      );
      systemParts.push("");
      systemParts.push("### Fetching Web Content");
      systemParts.push("```bash");
      systemParts.push("curl -sL 'https://example.com/page' | head -200");
      systemParts.push("```");
      systemParts.push("");
      systemParts.push("### Cloning and Analyzing Repositories");
      systemParts.push("```bash");
      systemParts.push(
        "git clone --depth 1 'https://github.com/org/repo.git' /tmp/oss-scan/reponame",
      );
      systemParts.push("```");
      systemParts.push("Then use Glob, Grep, and Read to analyze the cloned repository.");
      systemParts.push("");
      systemParts.push("### GitHub API Queries");
      systemParts.push("```bash");
      systemParts.push("gh api repos/owner/repo --jq '.stargazers_count, .license.spdx_id'");
      systemParts.push(
        "gh api 'search/repositories?q=topic:state-management+language:typescript&sort=stars' --jq '.items[:5] | .[].full_name'",
      );
      systemParts.push("```");
      systemParts.push("");
      systemParts.push("## Skill Execution Protocol");
      systemParts.push("");
      systemParts.push(
        "You are executing a multi-step skill workflow. Follow this protocol STRICTLY:",
      );
      systemParts.push("");
      systemParts.push(
        "1. **DECOMPOSE FIRST**: Use TodoWrite to create a numbered checklist of all steps before doing any work.",
      );
      systemParts.push(
        "2. **READ BEFORE EDIT**: Always Read a file before modifying it. Never edit blind.",
      );
      systemParts.push(
        "3. **ONE STEP AT A TIME**: Complete one step fully, verify it, then advance to the next.",
      );
      systemParts.push(
        "4. **EVERY RESPONSE = TOOL CALLS**: Never respond with only text/narration. Every response MUST include at least one tool call.",
      );
      systemParts.push(
        "5. **VERIFY EACH STEP**: After completing a step, verify with a concrete check (Read the file, run a test, check git status).",
      );
      systemParts.push(
        "6. **UPDATE PROGRESS**: Mark each TodoWrite item as completed before starting the next.",
      );
      systemParts.push(
        "7. **USE BASH FOR EXTERNAL OPS**: GitHub search, web fetch, repo cloning — use Bash with the recipes above.",
      );
      systemParts.push(
        "8. **NEVER CONFABULATE**: Only claim a file was modified AFTER a successful Edit/Write tool result. Only claim tests pass AFTER a successful Bash test result.",
      );
      systemParts.push("");
    }

    // Git commit attribution — use the active model name dynamically
    const modelLabel = this.currentModel.replace(/^[^/]+\//, ""); // strip provider prefix
    systemParts.push("## Git Commits");
    systemParts.push(
      `Prefer the GitCommit tool for commits. If you must use Bash for git commit, always include this Co-Authored-By trailer:`,
    );
    systemParts.push(`Co-Authored-By: DanteCode (${modelLabel}) <noreply@dantecode.dev>`);
    systemParts.push("");

    systemParts.push(getToolDefinitionsPromptForAgentMode(agentMode));

    // Inject workspace context so the model knows about the open project
    const workspaceFolders = vscode.workspace.workspaceFolders;
    const wsFolder = workspaceFolders?.[0];
    if (wsFolder) {
      const projectName = wsFolder.name;
      const projectPath = wsFolder.uri.fsPath;
      const ideName = vscode.env.appName || "VS Code";

      systemParts.push("");
      systemParts.push("## Current Workspace");
      systemParts.push(`- Project: ${projectName}`);
      systemParts.push(`- Path: ${projectPath}`);
      systemParts.push(`- IDE: ${ideName}`);
      systemParts.push("");
      systemParts.push(
        "You have FULL access to this project. The complete file tree, key files, git status,",
      );
      systemParts.push(
        "and project configuration are provided below. When the user asks you to scan, review,",
      );
      systemParts.push(
        "or analyze the project — use this context directly. Do NOT say you lack access.",
      );

      // ── Git-engine repo map (structured file listing with metadata) ──
      try {
        const repoMap = generateRepoMap(projectPath, { maxFiles: promptProfile.repoMapMaxFiles });
        if (repoMap.length > 0) {
          const formatted = formatRepoMapForContext(repoMap);
          systemParts.push("");
          systemParts.push(formatted);
        }
      } catch {
        // Fallback to VS Code API tree if git-engine fails (non-git project)
        try {
          const tree = await this.buildWorkspaceTree(
            wsFolder.uri,
            promptProfile.workspaceTreeMaxDepth,
            promptProfile.workspaceTreeMaxFiles,
          );
          if (tree.length > 0) {
            systemParts.push("");
            systemParts.push("## Project File Tree");
            systemParts.push("```");
            systemParts.push(tree);
            systemParts.push("```");
          }
        } catch {
          /* non-critical */
        }
      }

      // ── Git status + branch info ──
      try {
        const gitStatus = getStatus(projectPath);
        const stagedCount = gitStatus.staged.length;
        const unstagedCount = gitStatus.unstaged.length;
        const untrackedCount = gitStatus.untracked.length;

        systemParts.push("");
        systemParts.push("## Git Status");
        if (stagedCount === 0 && unstagedCount === 0 && untrackedCount === 0) {
          systemParts.push("Working tree is clean.");
        } else {
          if (stagedCount > 0) {
            systemParts.push(
              `**Staged (${stagedCount}):** ${gitStatus.staged.map((e) => e.path).join(", ")}`,
            );
          }
          if (unstagedCount > 0) {
            systemParts.push(
              `**Modified (${unstagedCount}):** ${gitStatus.unstaged.map((e) => e.path).join(", ")}`,
            );
          }
          if (untrackedCount > 0) {
            systemParts.push(
              `**Untracked (${untrackedCount}):** ${gitStatus.untracked.map((e) => e.path).join(", ")}`,
            );
          }
        }
      } catch {
        /* non-git repo — skip */
      }

      // ── STATE.yaml (DanteForge project config) ──
      try {
        const state = await readOrInitializeState(projectPath);
        systemParts.push("");
        systemParts.push("## DanteForge Configuration");
        systemParts.push(
          `- Default model: ${state.model.default.provider}/${state.model.default.modelId}`,
        );
        systemParts.push(`- PDSE threshold: ${state.pdse.threshold}`);
        systemParts.push(`- Autoforge enabled: ${state.autoforge.enabled}`);
        if (state.autoforge.gstackCommands.length > 0) {
          systemParts.push(
            `- GStack commands: ${state.autoforge.gstackCommands.map((c: { name: string }) => c.name).join(", ")}`,
          );
        }
      } catch {
        /* no STATE.yaml — skip */
      }

      // ── Key project files (package.json, README, tsconfig, etc.) ──
      try {
        const keyFiles = await this.readKeyProjectFiles(
          wsFolder.uri,
          promptProfile.keyFileMaxChars,
        );
        if (keyFiles.size > 0) {
          systemParts.push("");
          systemParts.push("## Key Project Files");
          for (const [fileName, content] of keyFiles) {
            systemParts.push(`\n### ${fileName}\n\`\`\`\n${content}\n\`\`\``);
          }
        }
      } catch {
        /* non-critical */
      }

      // ── Currently active editor file ──
      const activeFile = this.getActiveEditorContent(promptProfile.activeFileMaxChars);
      if (activeFile) {
        const relative = activeFile.path.startsWith(projectPath)
          ? activeFile.path.substring(projectPath.length + 1).replace(/\\/g, "/")
          : activeFile.path;
        systemParts.push("");
        systemParts.push("## Currently Active File");
        systemParts.push(`The user has \`${relative}\` open in the editor right now.`);
        systemParts.push(`\`\`\`\n${activeFile.content}\n\`\`\``);
      }

      // ── Open editor tabs ──
      const openEditors = vscode.window.tabGroups.all
        .flatMap((g) => g.tabs)
        .filter(
          (tab) => tab.input && typeof (tab.input as { uri?: vscode.Uri }).uri !== "undefined",
        )
        .map((tab) => (tab.input as { uri: vscode.Uri }).uri.fsPath)
        .slice(0, 20);

      if (openEditors.length > 0) {
        systemParts.push("");
        systemParts.push("## Open Files in Editor");
        for (const editorPath of openEditors) {
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
          let fileText = Buffer.from(content).toString("utf-8");
          if (fileText.length > promptProfile.contextFileMaxChars) {
            fileText =
              fileText.slice(0, promptProfile.contextFileMaxChars) + "\n... (truncated)";
          }
          systemParts.push(`\n--- ${filePath} ---\n${fileText}\n--- end ---`);
        } catch {
          systemParts.push(`\n--- ${filePath} --- (could not read file)`);
        }
      }
    }

    const systemPrompt = systemParts.join("\n");

    // ────────────────────────────────────────────────────────────────────────
    // Autonomous Agent Loop — streams response, extracts tool calls, loops
    // ────────────────────────────────────────────────────────────────────────

    let agentMessages: Array<{ role: "user" | "assistant" | "system"; content: string }> = [
      ...this.messages.map((msg) => ({
        role: msg.role as "user" | "assistant" | "system",
        content: msg.content,
      })),
    ];

    let maxToolRounds = effectiveMaxRounds;
    let finalResponse = "";
    const touchedFiles: string[] = [];
    let roundNumber = 0; // Track which round we're on

    try {
      while (maxToolRounds > 0) {
        maxToolRounds--;
        roundNumber++;
        const isFirstRound = roundNumber === 1;

        // Per-round abort controller (Cline pattern): aborts only this round's HTTP stream.
        // The session-level this.abortController remains live for the user stop button.
        const roundController = new AbortController();
        const _forwardAbort = () => roundController.abort();
        signal.addEventListener("abort", _forwardAbort);

        // Phase 1 prune: erase old tool outputs when context exceeds 40k tokens.
        // Runs before compactTextTranscript so the sliding-window eviction sees the pruned state.
        if (wouldOverflow(agentMessages, modelConfig.contextWindow, promptProfile.maxResponseTokens)) {
          const { pruned, savedTokens } = pruneToolOutputs(agentMessages);
          if (savedTokens > 0) {
            agentMessages.splice(0, agentMessages.length, ...pruned);
          }
        }

        // Phase 2 compact: LLM summarization when prune alone cannot prevent overflow.
        // Only fires when there are enough messages to summarize (>6 so older zone is non-empty).
        if (
          agentMessages.length > 6 &&
          wouldOverflow(agentMessages, modelConfig.contextWindow, promptProfile.maxResponseTokens)
        ) {
          const llmCall = (prompt: string) =>
            router.generate([{ role: "user", content: prompt }], {
              maxTokens: 2048,
              system: "You are a concise summarizer.",
            });
          agentMessages = await compactContext(agentMessages, text, llmCall);
        }

        // Phase 3 filter: PRD-26 context filter pipeline — drop low-relevance tool outputs.
        // Runs after prune+compact to extract maximum signal from remaining tokens.
        const filterResult = filterContextByRelevance(agentMessages, text, {
          tokenBudgetThreshold: 15_000,
          relevanceThreshold: 0.04,
          largeMessageTokens: 400,
          preserveRecentCount: 8,
        });
        if (filterResult.ran) {
          agentMessages = filterResult.messages as typeof agentMessages;
        }

        const compacted = compactTextTranscript(agentMessages, {
          contextWindow: modelConfig.contextWindow,
          preserveRecentMessages: 10,
          preserveRecentToolResults: 5,
        });
        if (compacted.strategy !== "none") {
          agentMessages.splice(0, agentMessages.length, ...compacted.messages);
          void appendAuditEvent(projectRoot, {
            type: "context_compacted",
            sessionId: this.sessionId,
            timestamp: new Date().toISOString(),
            modelId: this.currentModel,
            projectRoot,
            payload: {
              strategy: compacted.strategy,
              droppedMessages: compacted.droppedMessages,
              remainingMessages: compacted.messages.length,
            },
          });
        }

        // D6: Select model tier before each request
        const tier = router.selectTier({
          estimatedInputTokens: router.estimateTokens(agentMessages.map((m) => m.content).join("")),
          taskType: agentMode === "yolo" ? "autoforge" : "chat",
          consecutiveGstackFailures: 0,
          filesInScope: touchedFiles.length,
          forceCapable: false,
        });

        // Stream the model response
        const streamResult = await router.stream(agentMessages, {
          system: systemPrompt,
          maxTokens: Math.min(
            tier === "capable" ? 16_384 : 8_192,
            promptProfile.maxResponseTokens,
          ),
          abortSignal: roundController.signal,
        });

        let fullResponse = "";

        // S4: mid-stream XML parser — fires tool_block_start when <tool_use> opens and
        // tool_block_complete when </tool_use> closes. tool_block_start retracts any
        // pre-tool narration already shown in the live stream so the user never sees
        // fabricated text that precedes a tool call.
        // shouldCutStream() is kept as a safety fallback (both paths run in parallel).
        let _xmlSeenToolClose = false;
        let _xmlShouldCutNext = false;
        let _xmlHasSeenToolOpen = false;
        const _round2PendingChunks: string[] = [];
        const _xmlParser = new XmlToolCallParser(
          (event: import("@dantecode/core").XmlParserEvent) => {
            if (event.type === "tool_block_start") {
              _xmlHasSeenToolOpen = true;
              if (isFirstRound) {
                // Retract any pre-tool narration already shown — clear the partial display.
                this.postMessage({
                  type: "chat_response_chunk",
                  payload: { chunk: "", partial: "" },
                });
              }
              // Round 2+: discard the speculative buffer — those chunks were narration.
              _round2PendingChunks.length = 0;
            } else if (event.type === "tool_block_complete") {
              _xmlSeenToolClose = true;
            } else if (event.type === "text_chunk" && _xmlSeenToolClose) {
              if (/\S/.test(event.text) && !event.text.trimStart().startsWith("<tool_use>")) {
                _xmlShouldCutNext = true;
                // Abort the HTTP stream immediately — prevents the model from generating
                // more epilogue tokens after </tool_use>.
                roundController.abort();
              }
            }
          },
        );

        // Set a 60-second timeout for the first chunk (up from 30s for slower models)
        const firstChunkTimeout = setTimeout(() => {
          if (fullResponse.length === 0 && this.abortController) {
            this.abortController.abort();
          }
        }, promptProfile.firstChunkTimeoutMs);

        // Heartbeat while waiting for model to start responding
        // On round 2+, use chunk-only mode to APPEND to the existing buffer
        let heartbeatTick = 0;
        const streamHeartbeat = setInterval(() => {
          if (fullResponse.length === 0) {
            heartbeatTick++;
            if (isFirstRound && heartbeatTick <= 1) {
              // First tick on first round: show "thinking..." as temporary display
              this.postMessage({
                type: "chat_response_chunk",
                payload: { chunk: "", partial: "_thinking..._" },
              });
            } else {
              // Subsequent ticks: append visible progress to buffer
              const dots = ".".repeat(((heartbeatTick - 1) % 3) + 1);
              this.postMessage({
                type: "chat_response_chunk",
                payload: { chunk: `\n> _waiting for model${dots}_\n`, partial: "" },
              });
            }
          }
        }, promptProfile.heartbeatMs);

        try {
          for await (const chunk of streamResult.textStream) {
            if (fullResponse.length === 0) {
              clearTimeout(firstChunkTimeout);
              clearInterval(streamHeartbeat);
            }
            if (this.stopRequested) break;
            fullResponse += chunk;
            // S4 fast-path: mid-stream parser signals epilogue O(1) per chunk
            _xmlParser.feed(chunk);
            if (_xmlShouldCutNext) break;
            // Gate 10 fallback: full-buffer rescan catches anything the parser missed
            if (shouldCutStream(fullResponse)) break;
            if (isFirstRound) {
              // First round: send partial (full response so far) for clean rendering.
              // If tool_block_start fired, a retraction was already sent — subsequent
              // chunks inside the tool body are harmless (display already cleared).
              if (!_xmlHasSeenToolOpen) {
                this.postMessage({
                  type: "chat_response_chunk",
                  payload: { chunk, partial: fullResponse },
                });
              }
            } else {
              // Round 2+: buffer speculatively. If a tool call is detected,
              // tool_block_start clears the buffer (narration discarded). If the stream
              // ends with no tool call, we flush the buffer — it was a text response.
              if (!_xmlHasSeenToolOpen) {
                _round2PendingChunks.push(chunk);
              }
            }
          }
        } catch (streamErr: unknown) {
          clearTimeout(firstChunkTimeout);
          clearInterval(streamHeartbeat);
          // Round-controller abort: epilogue text was detected and we killed the HTTP stream
          // immediately. This is expected — fall through to normal post-loop processing.
          if (roundController.signal.aborted) {
            // intentional — do nothing, continue below
          } else if (signal.aborted && fullResponse.length === 0) {
            // Session-level timeout with no response yet — show error and stop.
            this.postMessage({
              type: "error",
              payload: {
                message:
                  `Request to ${this.currentModel} timed out after ${Math.round(promptProfile.firstChunkTimeoutMs / 1000)} seconds.\n` +
                  (provider === "ollama"
                    ? "Ollama is running, but the local model did not produce a first token in time. Try a smaller model or a narrower prompt."
                    : "Check your API key and network connection."),
              },
            });
            break;
          } else {
            throw streamErr; // re-throw unexpected errors to outer catch
          }
        }
        clearTimeout(firstChunkTimeout);
        clearInterval(streamHeartbeat);
        // Abort this round's HTTP stream and unchain the session signal listener.
        roundController.abort();
        signal.removeEventListener("abort", _forwardAbort);

        // Round 2+ flush: if the stream ended with no tool call, the buffered chunks
        // are a real text response — send them all now.
        if (!isFirstRound && _round2PendingChunks.length > 0 && !_xmlHasSeenToolOpen) {
          for (const bufferedChunk of _round2PendingChunks) {
            this.postMessage({
              type: "chat_response_chunk",
              payload: { chunk: bufferedChunk, partial: "" },
            });
          }
        }

        if (this.stopRequested) {
          if (fullResponse.length > 0) {
            this.messages.push({
              role: "assistant",
              content: fullResponse + "\n\n_(generation stopped)_",
            });
          }
          this.postMessage({ type: "generation_stopped", payload: { text: fullResponse } });
          this.postMessage({ type: "chat_response_done", payload: { cancelled: true } });
          finalResponse = fullResponse;
          break;
        }

        if (fullResponse.trim().length === 0) {
          // Auto-retry with fallback models before showing error
          let retried = false;
          for (const fb of fallbackModels) {
            try {
              this.postMessage({
                type: "chat_response_chunk",
                payload: {
                  chunk: `\n\n_(${modelId} returned empty — retrying with ${fb.modelId}...)_\n`,
                  partial: `_(retrying with ${fb.modelId}...)_`,
                },
              });
              const fbRouter = new ModelRouterImpl(
                { default: fb, fallback: [], overrides: {} },
                projectRoot,
                this.sessionId,
              );
              const fbStream = await fbRouter.stream(agentMessages, {
                system: systemPrompt,
                maxTokens: promptProfile.maxResponseTokens,
                abortSignal: signal,
              });
              for await (const chunk of fbStream.textStream) {
                if (this.stopRequested) break;
                fullResponse += chunk;
                this.postMessage({
                  type: "chat_response_chunk",
                  payload: { chunk, partial: fullResponse },
                });
              }
              if (fullResponse.trim().length > 0) {
                retried = true;
                break;
              }
            } catch {
              /* try next fallback */
            }
          }
          if (!retried || fullResponse.trim().length === 0) {
            let hint: string;
            if (provider === "ollama") {
              hint = `The model "${modelId}" may not be installed. Run: ollama pull ${modelId}`;
            } else if (provider === "grok") {
              hint = `The model "${modelId}" returned an empty response. Try switching to "Grok 4.1 Fast" or "Grok 3" in the model selector.`;
            } else {
              hint = `The model "${modelId}" returned an empty response. The model ID may be invalid or your API key may lack access.`;
            }
            this.postMessage({
              type: "error",
              payload: { message: `No response from ${this.currentModel}.\n${hint}` },
            });
            break;
          }
        }

        // D6: Emit cost update after each model response
        const costEstimate = router.getCostEstimate();
        this.postMessage({
          type: "cost_update",
          payload: {
            sessionTotalUsd: costEstimate.sessionTotalUsd,
            lastRequestUsd: costEstimate.lastRequestUsd,
            modelTier: costEstimate.modelTier,
            tokensUsedSession: costEstimate.tokensUsedSession,
          },
        });
        this.hostCallbacks.onCostUpdate?.({
          model: this.currentModel,
          modelTier: costEstimate.modelTier,
          sessionTotalUsd: costEstimate.sessionTotalUsd,
        });

        // WS5 Context Guardian: send context utilization update to webview
        const ctxUtil = getContextUtilization(
          agentMessages.map((m) => ({ role: m.role, content: m.content })),
          modelConfig.contextWindow,
        );
        this.postMessage({
          type: "context_update",
          payload: { percent: ctxUtil.percent, tier: ctxUtil.tier },
        });

        // Update the status bar with context utilization after each response
        this.updateStatusBar({ contextPercent: ctxUtil.percent });

        // Extract tool calls from the response.
        // epilogue = text written after the last tool_use block (where models fabricate summaries).
        const {
          toolCalls,
          cleanText: responseCleanText,
          epilogue: responseEpilogue,
          phantomToolNames,
        } = extractToolCalls(fullResponse);

        // ── Anti-fabrication Gate: detect success claims that contradict known failures ──
        // Patterns map tool names to regex that matches fabricated success language.
        const FABRICATION_CLAIM_PATTERNS: Record<string, RegExp> = {
          GitPush:
            /(?:push(?:ed)?|force[\s-]push(?:ed)?(?:\s+with\s+lease)?)\s+(?:succeed|success|complet|to\s+remote|is\s+done)|synced?\s+(?:remote|branch)/i,
          GitCommit: /commit(?:ted)?\s+success|successfully\s+commit/i,
          Bash: /(?:all\s+)?tests?\s+(?:pass(?:ing|ed)?)|typecheck\s+(?:pass|clean)|build\s+success|all\s+checks?\s+pass/i,
          Write: /successfully\s+(?:created|written|wrote)\s+(?:the\s+)?file/i,
          Edit: /successfully\s+(?:updated|edited|modified)\s+(?:the\s+)?file/i,
        };
        if (failedToolsLog.length > 0) {
          const failedNames = new Set(failedToolsLog.map((f) => f.name));
          const contradictions = [...failedNames].filter((name) => {
            const pat = FABRICATION_CLAIM_PATTERNS[name];
            return pat ? pat.test(fullResponse) : false;
          });
          if (contradictions.length > 0) {
            this.postMessage({
              type: "chat_response_chunk",
              payload: {
                chunk: `\n> ⚠️ **Fabrication guard** — response claims success for tool(s) that previously returned errors: **${contradictions.join(", ")}**. See actual tool results above.\n`,
                partial: "",
              },
            });
          }
        }

        // ---- Anti-confabulation: empty response circuit breaker ----
        if (fullResponse.trim().length === 0 && toolCalls.length === 0) {
          consecutiveEmptyRounds++;
          if (consecutiveEmptyRounds >= MAX_CONSECUTIVE_EMPTY_ROUNDS) {
            this.postMessage({
              type: "chat_response_chunk",
              payload: {
                chunk: `\n\n> **Anti-confabulation guard:** ${MAX_CONSECUTIVE_EMPTY_ROUNDS} consecutive empty responses — aborting. Try a different model.\n`,
                partial: "",
              },
            });
            this.messages.push({
              role: "assistant",
              content: `The model returned ${MAX_CONSECUTIVE_EMPTY_ROUNDS} consecutive empty responses. This typically indicates a model compatibility issue. Try a different model or simplify your request.`,
            });
            break;
          }
          this.postMessage({
            type: "chat_response_chunk",
            payload: {
              chunk: `\n\n> **Empty response** (${consecutiveEmptyRounds}/${MAX_CONSECUTIVE_EMPTY_ROUNDS}) — nudging model to use tools.\n`,
              partial: "",
            },
          });
          agentMessages.push({ role: "assistant", content: "(empty response)" });
          agentMessages.push({
            role: "user",
            content:
              "You returned an empty response with no tool calls. This may indicate a compatibility " +
              "issue. Execute the next step using a tool (Read, Edit, Write, Bash, Glob, Grep). " +
              "If you cannot proceed, explain what is blocking you.",
          });
          continue;
        }
        if (toolCalls.length > 0) {
          consecutiveEmptyRounds = 0;
          _consecutiveTextOnlyRounds = 0;
        } else if (fullResponse.trim().length > 0) {
          _consecutiveTextOnlyRounds++;
        }

        // Pipeline detection: used by both no-tool-calls handling and tool execution guards
        const isPipelineWorkflow =
          this.activeSkill !== null ||
          /\/(?:magic|autoforge|party|inferno|blaze|ember|forge|verify|ship)\b/i.test(text);
        const PREMATURE_SUMMARY_RE =
          /(?:^|\n)\s*(?:#{1,3}\s*)?(?:summary|results?|complete|done|finished|all\s+(?:done|complete)|pipeline\s+complete)/i;

        // No tool calls → check if we should nudge the model to actually execute
        if (toolCalls.length === 0) {
          const isExecutionMode = agentMode === "yolo" || agentMode === "build";
          const needsExecutionNudge =
            isExecutionMode &&
            executedToolsThisTurn === 0 &&
            responseNeedsToolExecutionNudge(fullResponse) &&
            executionNudges < MAX_EXECUTION_NUDGES &&
            maxToolRounds > 1;

          // If the model just described or claimed work without acting, nudge it to use tools
          if (needsExecutionNudge) {
            executionNudges++;
            const _execNudgeBrake =
              _consecutiveTextOnlyRounds >= 2
                ? ` (${_consecutiveTextOnlyRounds} consecutive text-only rounds — this is a narration loop)`
                : "";
            // Do NOT send chat_response_done here — keep the streaming element alive
            agentMessages.push({ role: "assistant", content: fullResponse });
            agentMessages.push({
              role: "user",
              content:
                `You described or claimed work without using any tools${_execNudgeBrake}. Stop narrating and EXECUTE the next step with <tool_use> blocks right now. Read files before editing them, make the change with Write/Edit, and only claim success after a real tool result.`,
            });
            this.postMessage({
              type: "chat_response_chunk",
              payload: {
                chunk:
                  "\n\n---\n> **Execution required** — no real tool call was emitted, retrying in tool mode.\n\n",
                partial: "",
              },
            });
            continue; // Go back to the top of the agent loop
          }

          // Pipeline continuation nudge: if a skill is active or the user triggered a
          // pipeline workflow, and the model stopped with a summary-like response,
          // nudge it to continue instead of stopping.
          if (
            isPipelineWorkflow &&
            executedToolsThisTurn > 0 &&
            maxToolRounds > 1 &&
            pipelineContinuationNudges < 3 &&
            PREMATURE_SUMMARY_RE.test(fullResponse)
          ) {
            pipelineContinuationNudges++;
            agentMessages.push({ role: "assistant", content: fullResponse });
            agentMessages.push({
              role: "user",
              content:
                "You stopped mid-pipeline with a summary/status response, but the task is NOT " +
                "complete. The pipeline still has remaining steps. Do NOT summarize — continue " +
                "executing the next step immediately with tool calls.",
            });
            this.postMessage({
              type: "chat_response_chunk",
              payload: {
                chunk: `\n\n---\n> **Pipeline continuation** (${pipelineContinuationNudges}/3) — model stopped mid-pipeline, nudging to continue.\n\n`,
                partial: "",
              },
            });
            continue;
          }

          // Anti-confabulation gate: model claims completion but no files were modified
          if (
            isPipelineWorkflow &&
            touchedFiles.length === 0 &&
            confabulationNudges < MAX_CONFABULATION_NUDGES &&
            PREMATURE_SUMMARY_RE.test(fullResponse)
          ) {
            confabulationNudges++;
            agentMessages.push({ role: "assistant", content: fullResponse });
            agentMessages.push({
              role: "user",
              content:
                "You claimed to complete work, but NO files were actually modified in this session " +
                "(filesModified === 0). You MUST use Edit or Write tools to make real file changes. " +
                "Do NOT narrate changes without executing tool calls. Resume and actually execute " +
                "the next step with real tool calls.",
            });
            this.postMessage({
              type: "chat_response_chunk",
              payload: {
                chunk: `\n\n---\n> **Anti-confabulation** (${confabulationNudges}/${MAX_CONFABULATION_NUDGES}) — model claims completion but 0 files modified.\n\n`,
                partial: "",
              },
            });
            continue;
          }

          // Clear any error state on successful response
          this.updateStatusBar({ hasError: false });
          // Sprint 4 + Dim34: append unverified score/regression warning before finalizing display.
          const _claimWarning = detectUnverifiedScoreClaims(
            fullResponse,
            _sessionToolOutputs,
            _sessionRanImprovementCmd,
            _sessionVerifiedScoreOutput,
            _sessionRegressionGateProof,
          );
          const finalizedResponse = _claimWarning ? `${fullResponse}${_claimWarning}` : fullResponse;
          this.messages.push({ role: "assistant", content: finalizedResponse });
          if (_claimWarning) {
            this.postMessage({ type: "chat_response_chunk", payload: { chunk: _claimWarning, partial: "" } });
          }
          if (roundNumber <= 1) {
            // Single-round response (no tool execution) — send final text
            this.postMessage({ type: "chat_response_done", payload: { text: finalizedResponse } });
          } else {
            // Multi-round: buffer has accumulated tool output + model text — keep it
            this.postMessage({ type: "chat_response_done", payload: {} });
          }
          finalResponse = finalizedResponse;
          break;
        }

        // ── Tool calls found — execute them ──
        // Do NOT send chat_response_done here — keep the streaming element alive
        // so tool execution output is visible in the chat in real-time

        const toolResultParts: string[] = [];
        const roundFailedTools: Array<{ name: string; error: string }> = [];

        for (let ti = 0; ti < toolCalls.length; ti++) {
          executedToolsThisTurn++;
          const toolCall = toolCalls[ti]!;
          // Gate 11: unique sequence id — session prefix + round + tool index (Grok cannot predict this)
          const resultSeq = `${this.sessionId.slice(-6)}-r${roundNumber}-t${ti}`;
          // Show tool execution in the UI with progress
          const toolProgress = toolCalls.length > 1 ? ` (${ti + 1}/${toolCalls.length})` : "";
          this.postMessage({
            type: "chat_response_chunk",
            payload: {
              chunk: `\n\n> **Running: ${toolCall.name}**${toolProgress} ${this.summarizeToolInput(toolCall.name, toolCall.input)}\n`,
              partial: "",
            },
          });

          // Mode-aware tool filtering
          const isWriteTool = toolCall.name === "Write" || toolCall.name === "Edit";
          const isBashTool = toolCall.name === "Bash";

          if (agentMode === "plan" && !PLAN_MODE_TOOLS.has(toolCall.name)) {
            toolResultParts.push(
              `Tool "${toolCall.name}" blocked: Plan mode only allows read-only tools.`,
            );
            continue;
          }
          const permissionBlock = await this.resolveToolPermissionBlock(
            toolCall.name,
            isWriteTool ? "edit" : isBashTool ? "bash" : "tools",
          );
          if (permissionBlock) {
            toolResultParts.push(permissionBlock);
            continue;
          }

          // Write size guard: block large Write payloads on existing files (force Edit).
          if (toolCall.name === "Write") {
            const writeContent = toolCall.input["content"] as string | undefined;
            if (writeContent && writeContent.length > 30_000) {
              const writeFilePath = toolCall.input["file_path"] as string | undefined;
              const absWritePath = writeFilePath
                ? writeFilePath.startsWith("/") || writeFilePath.includes(":")
                  ? writeFilePath
                  : pathResolve(projectRoot, writeFilePath)
                : null;
              const fileAlreadyRead = absWritePath && readTracker.has(absWritePath);
              if (fileAlreadyRead) {
                // Block: model is rewriting an existing file with a massive payload
                this.postMessage({
                  type: "chat_response_chunk",
                  payload: {
                    chunk: `\n> **BLOCKED:** Write (${Math.round(writeContent.length / 1000)}K chars) to existing file. Use Edit for surgical changes.\n`,
                    partial: "",
                  },
                });
                toolResultParts.push(
                  `SYSTEM: Write BLOCKED — your payload is ${Math.round(writeContent.length / 1000)}K characters, which will truncate and corrupt the file. ` +
                    `The file "${writeFilePath}" already exists. Use the Edit tool for surgical changes instead of rewriting the entire file. ` +
                    `Break your changes into multiple small Edit calls targeting specific sections.`,
                );
                continue;
              }
              // New file: warn but allow
              this.postMessage({
                type: "chat_response_chunk",
                payload: {
                  chunk: `\n> **Warning:** Write payload is ${Math.round(writeContent.length / 1000)}K chars — large file.\n`,
                  partial: "",
                },
              });
            }
          }

          // Premature commit blocker: block GitCommit/GitPush when no files were modified.
          if (
            (toolCall.name === "GitCommit" || toolCall.name === "GitPush") &&
            touchedFiles.length === 0 &&
            isPipelineWorkflow
          ) {
            this.postMessage({
              type: "chat_response_chunk",
              payload: {
                chunk: `\n> **BLOCKED:** ${toolCall.name} — 0 files modified this session. Write/Edit files first.\n`,
                partial: "",
              },
            });
            toolResultParts.push(
              `SYSTEM: ${toolCall.name} BLOCKED — you have not modified any files in this session (filesModified === 0). ` +
                `You cannot commit or push changes that do not exist. Use Edit or Write tools to make real file changes first, ` +
                `then commit. Do NOT claim you already made changes — only tool results count.`,
            );
            continue;
          }

          // Capture original file content before tool execution (for diff view)
          let originalContent: string | null = null;
          const isFileOp = toolCall.name === "Write" || toolCall.name === "Edit";
          const toolFilePath = toolCall.input["file_path"] as string | undefined;
          if (isFileOp && toolFilePath && this.agentConfig.showLiveDiffs) {
            try {
              const { readFile: rf } = await import("node:fs/promises");
              const absPath =
                toolFilePath.startsWith("/") || toolFilePath.includes(":")
                  ? toolFilePath
                  : pathResolve(projectRoot, toolFilePath);
              originalContent = await rf(absPath, "utf-8");
            } catch {
              originalContent = null; // New file — no original
            }
          }

          // Execute the tool with heartbeat for long-running operations
          let toolTick = 0;
          const heartbeat = setInterval(() => {
            toolTick++;
            const elapsed = toolTick * 3;
            this.postMessage({
              type: "chat_response_chunk",
              payload: {
                chunk: `\n> _executing${".".repeat((toolTick % 3) + 1)} (${elapsed}s)_\n`,
                partial: "",
              },
            });
          }, 3000); // pulse every 3 seconds
          // D3+D5: Build tool execution context with diff and self-mod callbacks
          const toolContext: ToolExecutionContext = {
            projectRoot,
            silentMode: this.agentConfig.agentMode === "yolo",
            currentModelId: this.currentModel,
            roundId: `round-${roundNumber}`,
            sessionId: this.sessionId,
            selfImprovement,
            readTracker,
            editAttempts,
            onDiffHunk: (diffReview) => {
              this.postMessage({
                type: "diff_hunk",
                payload: { ...diffReview.hunk } as unknown as Record<string, unknown>,
              });
              this.hostCallbacks.onDiffReview?.(diffReview);
            },
            onSelfModificationAttempt: (filePath) => {
              this.postMessage({
                type: "self_modification_blocked",
                payload: { filePath, requiresConfirmation: true },
              });
            },
            // Only show the confirmation dialog during explicit self-improvement sessions.
            // In normal agent runs, awaitSelfModConfirmation is undefined so agent-tools.ts
            // hits the else-branch and returns the blocked error immediately (no modal hang).
            awaitSelfModConfirmation: selfImprovement?.enabled
              ? async () => {
                  const selection = await vscode.window.showWarningMessage(
                    "DanteCode wants to modify protected project files. Allow this write once?",
                    { modal: true },
                    "Allow once",
                    "Block",
                  );
                  return selection === "Allow once";
                }
              : undefined,
          };
          let result: ToolResult;
          try {
            result = await executeTool(toolCall.name, toolCall.input, projectRoot, toolContext);
          } finally {
            clearInterval(heartbeat);
          }

          // Track files written for DanteForge verification
          const writtenFile = getWrittenFilePath(toolCall.name, toolCall.input);
          if (writtenFile && !touchedFiles.includes(writtenFile)) {
            touchedFiles.push(writtenFile);
          }

          // Show tool result with diff for write operations
          if (isFileOp && !result.isError) {
            // Show confirmation that changes were APPLIED to disk, with diff
            const lines = result.content.split("\n");
            const summary = lines[0] ?? "";
            const diffContent = lines.slice(2).join("\n");
            const relPath =
              toolFilePath && projectRoot
                ? pathRelative(
                    projectRoot,
                    toolFilePath.startsWith("/") || toolFilePath.includes(":")
                      ? toolFilePath
                      : pathResolve(projectRoot, toolFilePath),
                  ).replace(/\\/g, "/")
                : (toolFilePath ?? "");
            this.postMessage({
              type: "chat_response_chunk",
              payload: {
                chunk: `\n> **Applied** \`${relPath}\` — ${summary}\n\`\`\`diff\n${diffContent.slice(0, 1000)}\n\`\`\`\n`,
                partial: "",
              },
            });

            // Auto-open file in VS Code editor with diff view
            if (toolFilePath) {
              try {
                const absPath =
                  toolFilePath.startsWith("/") || toolFilePath.includes(":")
                    ? toolFilePath
                    : pathResolve(projectRoot, toolFilePath);
                const modifiedUri = vscode.Uri.file(absPath);

                if (this.agentConfig.showLiveDiffs && originalContent !== null) {
                  // Remove diff computation timeout to prevent "stopped early" warning
                  const diffConfig = vscode.workspace.getConfiguration("diffEditor");
                  if (diffConfig.get<number>("maxComputationTime") !== 0) {
                    await diffConfig.update(
                      "maxComputationTime",
                      0,
                      vscode.ConfigurationTarget.Global,
                    );
                  }
                  // Show diff: original vs modified using a virtual "before" document
                  const beforeUri = modifiedUri.with({
                    scheme: "dantecode-diff",
                    query: `before-${Date.now()}`,
                  });
                  this.registerDiffContent(beforeUri.toString(), originalContent);
                  const fileName = pathBasename(absPath);
                  await vscode.commands.executeCommand(
                    "vscode.diff",
                    beforeUri,
                    modifiedUri,
                    `DanteCode: ${fileName} (saved to disk)`,
                    { preview: true, preserveFocus: true },
                  );
                } else {
                  // Just open the file (new file or diffs disabled)
                  const doc = await vscode.workspace.openTextDocument(modifiedUri);
                  await vscode.window.showTextDocument(doc, { preview: true, preserveFocus: true });
                }
              } catch {
                /* non-critical: editor open */
              }
            }
          } else {
            // Gate 15: render tool result as a separate UI component (not chat bubble text)
            this.postMessage({
              type: "tool_result_block",
              payload: {
                toolName: toolCall.name,
                status: result.isError ? "error" : "ok",
                preview: result.content.split("\n").slice(0, 5).join("\n").slice(0, 200),
                seq: resultSeq,
              },
            });
            // Record failures so the fabrication gate can detect contradictions
            if (result.isError) {
              const errSummary = result.content.slice(0, 300);
              roundFailedTools.push({ name: toolCall.name, error: errSummary });
              failedToolsLog.push({ name: toolCall.name, error: errSummary, round: roundNumber });
            }
            // Gate 12: record verified git SHAs — only the runtime can produce these
            if ((toolCall.name === "GitCommit" || toolCall.name === "GitPush") && !result.isError) {
              const shaMatch = result.content.match(/\b([0-9a-f]{7,40})\b/i);
              if (shaMatch) {
                verifiedOpsLog.push({
                  tool: toolCall.name,
                  sha: shaMatch[1]!,
                  round: roundNumber,
                  ts: Date.now(),
                });
              }
            }
            // Sprint 2: accumulate Bash outputs for score claim validation (Rule 17 gate)
            if (toolCall.name === "Bash" && !result.isError) {
              const cmd = (toolCall.input as { command?: string }).command ?? "";
              const out = result.content ?? "";
              _sessionToolOutputs.push(out);
              if (/danteforge\s+(improve|ascend|autoforge|magic|forge)\b/i.test(cmd)) {
                _sessionRanImprovementCmd = true;
              }
              if (/danteforge\s+score\b/i.test(cmd) && out.trim().length > 0) {
                _sessionVerifiedScoreOutput = out;
              }
              if (/dantecode\s+regression\s+gate\b/i.test(cmd) && out.trim().length > 0) {
                _sessionRegressionGateProof = parseRegressionGateProofFromOutput(out);
              }
            }
          }

          // Run DanteForge gate on written code files immediately
          if (writtenFile && !result.isError) {
            try {
              const { readFile } = await import("node:fs/promises");
              const fileContent = await readFile(writtenFile, "utf-8");
              const stubCheck = runAntiStubScanner(fileContent, projectRoot);
              const constCheck = runConstitutionCheck(fileContent, writtenFile);
              const criticals = constCheck.violations.filter((v) => v.severity === "critical");

              if (!stubCheck.passed || criticals.length > 0) {
                const warnings: string[] = [];
                if (!stubCheck.passed)
                  warnings.push(`${stubCheck.hardViolations.length} anti-stub violations`);
                if (criticals.length > 0)
                  warnings.push(`${criticals.length} constitution violations`);
                this.postMessage({
                  type: "chat_response_chunk",
                  payload: {
                    chunk: `> **DanteForge Warning:** ${warnings.join(", ")} in ${writtenFile}\n`,
                    partial: "",
                  },
                });
              }
            } catch {
              /* verification failure non-critical */
            }
          }

          // Gate 11: XML-tag tool results so Grok cannot replay SHAs/content as its own prose
          toolResultParts.push(
            `<tool_result id="${resultSeq}" name="${toolCall.name}" status="${result.isError ? "ERROR" : "OK"}">\n${result.content}\n</tool_result>`,
          );
        }

        // Gate 7: validate <TOOL_RESULTS_VERIFIED> block against actual round failures
        const verifiedBlock = extractVerificationBlock(fullResponse);
        const roundFabricationEvents: FabricationEvent[] = [];

        if (toolCalls.length > 0) {
          if (!verifiedBlock) {
            roundFabricationEvents.push({ type: "missing_block", round: roundNumber });
            this.postMessage({
              type: "chat_response_chunk",
              payload: {
                chunk: `\n> ⚠️ **Verification block missing** — response included tool calls but no \`<TOOL_RESULTS_VERIFIED>\` block.\n`,
                partial: "",
              },
            });
          } else {
            for (const failed of roundFailedTools) {
              const claimed = verifiedBlock.get(failed.name);
              if (claimed === "SUCCESS") {
                roundFabricationEvents.push({
                  type: "false_success",
                  round: roundNumber,
                  toolName: failed.name,
                  claimedStatus: "SUCCESS",
                  actualError: failed.error.split("\n")[0],
                });
                this.postMessage({
                  type: "chat_response_chunk",
                  payload: {
                    chunk: `\n> 🚨 **Verification block mismatch** — \`${failed.name}\` reports SUCCESS but tool returned error: _${failed.error.split("\n")[0]}_\n`,
                    partial: "",
                  },
                });
              }
            }
          }
        }

        // Gate 13: record phantom tool calls as fabrication events
        for (const phantomName of phantomToolNames) {
          roundFabricationEvents.push({
            type: "phantom_tool",
            toolName: phantomName,
            round: roundNumber,
          });
          this.postMessage({
            type: "chat_response_chunk",
            payload: {
              chunk: `\n> ⚠️ **Phantom tool** — \`${phantomName}\` is not a known tool and was not executed.\n`,
              partial: "",
            },
          });
        }

        // Gate 15: track epilogue prose (text after last </tool_use>) as fabrication event.
        if (toolCalls.length > 0 && responseEpilogue && responseEpilogue.trim().length > 0) {
          roundFabricationEvents.push({ type: "epilogue", round: roundNumber });
        }

        // Gate 8: record round into fabrication tracker
        fabricationTracker.recordRound(
          roundNumber,
          toolCalls.map((t) => t.name),
          roundFabricationEvents,
        );

        // Gate 9c: log to provider health when circuit opens
        if (fabricationTracker.circuitOpen) {
          try {
            const snap = fabricationTracker.getSnapshot();
            const { appendFileSync, mkdirSync } = await import("node:fs");
            const { join } = await import("node:path");
            const eventsDir = join(projectRoot, ".danteforge");
            mkdirSync(eventsDir, { recursive: true });
            appendFileSync(
              join(eventsDir, "fabrication-events.ndjson"),
              JSON.stringify({
                event: "circuit_open",
                provider,
                model: modelId,
                timestamp: new Date().toISOString(),
                ...snap,
              }) + "\n",
              "utf-8",
            );
          } catch {
            /* non-critical */
          }
        }

        // Append the assistant response to conversation context.
        // EPILOGUE STRIP: omit any prose written after the last tool_use block — this is
        // where models (especially Grok) fabricate success summaries. Storing that text
        // in context allows the model to compound fabrications in future rounds by treating
        // its own lies as established history. We keep only the pre-tool reasoning.
        // cleanText has tool_use XML removed; epilogue text is still present at the end.
        // Use lastIndexOf to surgically remove just the epilogue from cleanText.
        let assistantContextContent: string;
        if (toolCalls.length > 0 && responseEpilogue) {
          const epiIdx = responseCleanText.lastIndexOf(responseEpilogue);
          const withoutEpilogue =
            epiIdx >= 0
              ? responseCleanText.slice(0, epiIdx).trim() ||
                `[${toolCalls.map((t) => t.name).join(", ")}]`
              : responseCleanText;
          // Gate 14: also strip excessive pre-tool narration from context
          assistantContextContent = stripPreToolNarration(withoutEpilogue, true);
        } else {
          assistantContextContent = responseCleanText || fullResponse;
        }
        agentMessages.push({ role: "assistant", content: assistantContextContent });

        if (this.hostCallbacks.onSearchReplaceBlocks && fullResponse.includes("<<<<<<< SEARCH")) {
          const { blocks } = parseSearchReplaceBlocks(fullResponse);
          if (blocks.length > 0) this.hostCallbacks.onSearchReplaceBlocks(blocks);
        }

        // If any tools failed this round, inject a structural guard the LLM cannot ignore.
        // This is the primary defense against fabricated success claims in round summaries.
        const fabricationGuardBlock =
          roundFailedTools.length > 0
            ? `\n\n⚠️ FABRICATION GUARD — The following tools FAILED this round:\n${roundFailedTools
                .map((t) => `• ${t.name}: ${t.error.split("\n")[0]}`)
                .join(
                  "\n",
                )}\nYour next response MUST acknowledge each of these failures explicitly. Do NOT say any of them succeeded, completed, or "is done".`
            : "";

        // Sprint 5 — narration loop brake (Cline ActModeRespondHandler pattern).
        // If the model has produced N consecutive rounds with no tool calls, force it to stop.
        const narrationBrake =
          _consecutiveTextOnlyRounds >= 2
            ? `\n\n⚠️ **NARRATION BRAKE**: You have produced ${_consecutiveTextOnlyRounds} consecutive ` +
              `responses with no tool calls. If your task is complete, write one sentence grounded ` +
              `in tool results and stop. If not complete, use tools — do not narrate.`
            : "";

        // Sprint 3 — Rule 17 infrastructure gate (Cline double-check completion pattern).
        // If an improvement command ran this session without a subsequent score verification,
        // block any summary until the model runs danteforge score.
        const rule17Gate =
          _sessionRanImprovementCmd && !_sessionVerifiedScoreOutput
            ? `\n\n⚠️ **RULE 17 GATE (runtime enforcement)**: You called a danteforge improvement ` +
              `command this session but have NOT yet run \`danteforge score --level light\`. ` +
              `You MUST call Bash with \`danteforge score --level light\` before writing any ` +
              `summary, score claim, or improvement delta. Claiming a score without this ` +
              `tool call is a fabrication-class event.`
            : "";

        // Gate 9b: prepend strict-mode override when fabrication threshold crossed
        const strictModePrefix = fabricationTracker.isStrictMode
          ? getStrictModeAddition(fabricationTracker.consecutiveFabrications) + "\n\n"
          : "";

        // Gate 12: prepend verified ops anchor so Grok knows which SHAs are real
        const opsAnchor =
          verifiedOpsLog.length > 0
            ? `<verified_ops_this_session>\n${verifiedOpsLog.map((op) => `${op.tool} @ round ${op.round}: ${op.sha}`).join("\n")}\n</verified_ops_this_session>\n\n`
            : "";

        agentMessages.push({
          role: "user",
          content: `${strictModePrefix}${opsAnchor}Tool execution results:\n\n${toolResultParts.join("\n\n---\n\n")}${fabricationGuardBlock}${rule17Gate}${narrationBrake}\n\nThese are the ACTUAL results. Take the next action based on them, or provide your final answer if the task is complete. Do NOT summarize what just happened — the results above are the ground truth.`,
        });

        // Signal the UI that a new round is starting with real progress
        const toolsRan = toolCalls.length;
        const filesChanged = touchedFiles.length;
        this.postMessage({
          type: "chat_response_chunk",
          payload: {
            chunk: `\n\n---\n> **Round ${roundNumber}/${effectiveMaxRounds}** — ${toolsRan} tool${toolsRan !== 1 ? "s" : ""} executed${filesChanged > 0 ? `, ${filesChanged} file${filesChanged !== 1 ? "s" : ""} modified` : ""}\n\n`,
            partial: "",
          },
        });
      }

      // If the loop exited by exhaustion (maxToolRounds === 0) and tool rounds ran,
      // finalize the streaming UI without replacing content
      if (maxToolRounds === 0 && roundNumber > 1) {
        // D4: Emit loop_terminated with reason
        const loopCheck = shouldContinueLoop(
          0, // no tool calls left
          maxToolRounds,
          false, // gstack not checked in chat loop
          0, // pdse not checked in chat loop
          {
            enabled: true,
            maxIterations: effectiveMaxRounds,
            gstackCommands: [],
            abortOnSecurityViolation: false,
            lessonInjectionEnabled: false,
          },
        );
        this.postMessage({
          type: "loop_terminated",
          payload: { reason: loopCheck.reason, roundsCompleted: roundNumber },
        });

        // Auto-continuation: for pipeline workflows (or any active skill),
        // auto-queue a continuation message instead of just stopping.
        const isPipelineExhausted =
          this.activeSkill !== null ||
          /\/(?:magic|autoforge|party|inferno|blaze|ember|forge)\b/i.test(text);
        if (isPipelineExhausted && this.agentConfig.runUntilComplete) {
          this.postMessage({
            type: "chat_response_chunk",
            payload: {
              chunk:
                "\n\n---\n> **Round budget exhausted** — pipeline still in progress. " +
                "Auto-continuing in a fresh session...\n\n",
              partial: "",
            },
          });
          this.postMessage({ type: "chat_response_done", payload: {} });
          // Queue auto-continuation: send a "please continue" message after a brief delay
          setTimeout(() => {
            void this.handleChatRequest(
              "The previous session exhausted its round budget mid-pipeline. " +
                "Continue the pipeline from where it left off. Check the todo list " +
                "and completed work so far, then execute the remaining steps.",
            );
          }, 500);
        } else {
          this.postMessage({
            type: "chat_response_chunk",
            payload: {
              chunk: isPipelineExhausted
                ? "\n\n---\n> **Max tool rounds reached** mid-pipeline. " +
                  'Send "please continue" to resume, or use `/magic --resume` to pick up later.\n'
                : "\n\n---\n> **Max tool rounds reached.** Review the results above.\n",
              partial: "",
            },
          });
          this.postMessage({ type: "chat_response_done", payload: {} });
        }
      }

      // Auto-save current chat to history
      await this.saveChatToHistory();

      // Run PDSE scoring on the final response's code blocks
      if (finalResponse.length > 0 && this.containsCode(finalResponse)) {
        try {
          const codeBlocks = this.extractCodeBlocks(finalResponse);
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
          /* non-critical */
        }
      }

      // Audit log
      try {
        await appendAuditEvent(projectRoot, {
          sessionId: this.sessionId,
          timestamp: new Date().toISOString(),
          type: "session_start",
          payload: {
            action: "agent_loop",
            chatId: this.currentChatId,
            userMessageLength: text.length,
            assistantResponseLength: finalResponse.length,
            model: this.currentModel,
            toolRoundsUsed: effectiveMaxRounds - maxToolRounds,
            filesWritten: touchedFiles,
          },
          modelId: this.currentModel,
          projectRoot,
        });
      } catch {
        /* audit non-critical */
      }
    } catch (err: unknown) {
      // Handle abort (stop button or timeout) gracefully
      if (err instanceof Error && (err.name === "AbortError" || signal.aborted)) {
        this.postMessage({ type: "generation_stopped", payload: { text: "" } });
        this.postMessage({ type: "chat_response_done", payload: { cancelled: true } });
      } else {
        const rawMessage = err instanceof Error ? err.message : String(err);
        const classified = classifyApiError(err, provider);
        let diagnostic = `Error with ${this.currentModel}: ${rawMessage}`;

        switch (classified.category) {
          case "auth":
            diagnostic += `\n\nAPI key is invalid or expired. Open settings (gear icon) to update your ${provider} key.`;
            break;
          case "rate_limit":
            diagnostic += classified.retryAfterMs
              ? `\n\nRate limit exceeded — retry in ${Math.ceil(classified.retryAfterMs / 1000)}s, or switch to a different model.`
              : `\n\nRate limit exceeded. Wait a moment and try again, or switch to a different model.`;
            break;
          case "quota":
            diagnostic += `\n\nYour ${provider} quota is exhausted. Check your billing at the ${provider} dashboard.`;
            break;
          case "context_overflow":
            diagnostic += `\n\nThe request exceeded ${this.currentModel}'s context window. Try starting a new chat or reducing attached context.`;
            break;
          case "timeout":
            diagnostic += `\n\nRequest timed out. Check your network connection and try again.`;
            break;
          case "server":
            diagnostic += `\n\nThe ${provider} service is temporarily unavailable. Try again in a few minutes.`;
            break;
          default:
            if (provider === "ollama") {
              diagnostic += `\n\nCheck that Ollama is running locally (http://localhost:11434).`;
            } else if (!apiKey) {
              diagnostic += `\n\nNo API key was found for "${provider}". Open settings (gear icon) to configure it.`;
            } else {
              diagnostic += `\n\nThis may be a model name issue or temporary service error.`;
            }
        }
        this.postMessage({ type: "error", payload: { message: diagnostic } });
        this.postMessage({ type: "chat_response_done", payload: { error: true } });
        // Signal error state to status bar
        this.updateStatusBar({ hasError: true });
      }
    } finally {
      this.abortController = null;
    }
  }

  /** Store original file content for a virtual diff URI. Auto-cleans after 60s. */
  private registerDiffContent(uriString: string, content: string): void {
    this.diffContents.set(uriString, content);
    // Auto-cleanup after 60 seconds to prevent memory leaks
    setTimeout(() => this.diffContents.delete(uriString), 60_000);
  }

  /** Summarize tool input for display in the chat. */
  private summarizeToolInput(name: string, input: Record<string, unknown>): string {
    switch (name) {
      case "Read":
        return `\`${input["file_path"] ?? ""}\``;
      case "Write":
        return `\`${input["file_path"] ?? ""}\``;
      case "Edit":
        return `\`${input["file_path"] ?? ""}\``;
      case "ListDir":
        return `\`${input["path"] ?? "."}\``;
      case "Bash":
        return `\`${String(input["command"] ?? "").slice(0, 60)}\``;
      case "Glob":
        return `\`${input["pattern"] ?? ""}\``;
      case "Grep":
        return `\`${input["pattern"] ?? ""}\``;
      default:
        return "";
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
    this.activeSkill = null;
    this.sendContextFilesUpdate();
  }

  /** Lazily initializes SessionStore, migrating from globalState if needed. */
  private async getSessionStore(): Promise<SessionStore | null> {
    const projectRoot = this.getProjectRoot();
    if (!projectRoot) return null;

    if (!this.sessionStore) {
      this.sessionStore = new SessionStore(projectRoot);
    }

    // One-time migration from globalState → disk
    if (!this.sessionStoreMigrated) {
      this.sessionStoreMigrated = true;
      const legacy = this.globalState.get<ChatSession[]>("dantecode.chatHistory", []);
      if (legacy.length > 0) {
        for (const session of legacy) {
          const now = new Date().toISOString();
          const file: ChatSessionFile = {
            id: session.id,
            title: session.title,
            createdAt: session.createdAt,
            updatedAt: now,
            model: session.model,
            messages: session.messages.map((m) => ({
              ...m,
              timestamp: now,
            })),
            contextFiles: [],
          };
          try {
            await this.sessionStore.save(file);
          } catch {
            /* migration is best-effort */
          }
        }
        // Clear legacy after successful migration
        await this.globalState.update("dantecode.chatHistory", undefined);
      }
    }

    return this.sessionStore;
  }

  private async handleLoadHistory(): Promise<void> {
    const store = await this.getSessionStore();
    if (!store) {
      this.postMessage({
        type: "chat_history",
        payload: { sessions: [], currentChatId: this.currentChatId },
      });
      return;
    }

    const entries = await store.list();
    this.postMessage({
      type: "chat_history",
      payload: {
        sessions: entries.map((s) => ({
          id: s.id,
          title: s.title,
          createdAt: s.createdAt,
          model: "",
          messageCount: s.messageCount,
        })),
        currentChatId: this.currentChatId,
      },
    });
  }

  private async handleSelectChat(chatId: string): Promise<void> {
    if (chatId.length === 0) return;

    // Save current conversation first
    if (this.messages.length > 0) {
      await this.saveChatToHistory();
    }

    const store = await this.getSessionStore();
    if (!store) return;

    const session = await store.load(chatId);
    if (session) {
      this.currentChatId = session.id;
      this.messages = session.messages.map((m) => ({
        role: m.role === "user" || m.role === "assistant" ? m.role : "assistant",
        content: m.content,
      }));
      this.currentModel = session.model;

      this.postMessage({
        type: "chat_restore",
        payload: { messages: this.messages },
      });
      this.sendModelUpdate();
    }
  }

  private async handleDeleteChat(chatId: string): Promise<void> {
    if (chatId.length === 0) return;

    const store = await this.getSessionStore();
    if (store) {
      await store.delete(chatId);
    }

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
    this.ascendActive = false; // halt the autonomous loop after the current cycle aborts
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  // --------------------------------------------------------------------------
  // /ascend — autonomous self-improvement loop (drives the chat model)
  //
  // Why this exists: shelling out to `danteforge ascend` produces "Wave NaN" /
  // "+0.0" / "Dimensions improved: 0" because no agent is attached to the spawned
  // process. This loop drives the chat model from inside the extension so tool
  // calls run with full permissions, edits actually land, and scoring reflects
  // real changes. Pure helpers live in ascend-orchestrator.ts.
  // --------------------------------------------------------------------------
  private async runAscendLoop(args: string): Promise<void> {
    // Thin shim: extract logic lives in ascend-orchestrator.ts, this provider
    // method just wires VS Code-side callbacks (postMessage, handleChatRequest,
    // messages.push, outputChannel.log, currentModel) into the pure loop runner.
    const { runAscendLoopCore } = await import("./ascend-orchestrator.js");
    const state = { active: true, cycle: 0 };
    this.ascendActive = true;
    try {
      await runAscendLoopCore(args, this.getProjectRoot(), state, {
        postMessage: (msg) => this.postMessage(msg as Parameters<typeof this.postMessage>[0]),
        runChatRequest: (text) => this.handleChatRequest(text),
        recordMessage: (m) => this.messages.push(m),
        log: (line) => this.hostCallbacks.onOutputLine?.(line),
        getCurrentModel: () => this.currentModel,
        isStopRequested: () => this.stopRequested || !this.ascendActive,
        resetStopRequested: () => { this.stopRequested = false; },
      });
    } finally {
      this.ascendActive = state.active;
    }
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
  // Agent config handlers
  // --------------------------------------------------------------------------

  private async handleSaveAgentConfig(partial: Partial<AgentConfig>): Promise<void> {
    // Merge incoming values
    if (partial.agentMode) this.agentConfig.agentMode = partial.agentMode;
    if (partial.permissions) {
      this.agentConfig.permissions = { ...this.agentConfig.permissions, ...partial.permissions };
    }
    if (typeof partial.maxToolRounds === "number")
      this.agentConfig.maxToolRounds = partial.maxToolRounds;
    if (typeof partial.runUntilComplete === "boolean")
      this.agentConfig.runUntilComplete = partial.runUntilComplete;
    if (typeof partial.showLiveDiffs === "boolean")
      this.agentConfig.showLiveDiffs = partial.showLiveDiffs;

    // Apply YOLO presets
    if (this.agentConfig.agentMode === "yolo") {
      this.agentConfig.permissions = { edit: "allow", bash: "allow", tools: "allow" };
      this.agentConfig.maxToolRounds = 50;
      this.agentConfig.runUntilComplete = true;
    }

    // Persist to globalState
    await this.globalState.update("dantecode.agentConfig", this.agentConfig);

    // Also write to .dantecode/config.json for CLI compatibility
    const projectRoot = this.getProjectRoot();
    if (projectRoot) {
      try {
        const configDir = vscode.Uri.joinPath(vscode.Uri.file(projectRoot), ".dantecode");
        await vscode.workspace.fs.createDirectory(configDir);
        const configUri = vscode.Uri.joinPath(configDir, "config.json");
        const content = Buffer.from(JSON.stringify(this.agentConfig, null, 2), "utf-8");
        await vscode.workspace.fs.writeFile(configUri, content);
      } catch {
        /* non-critical — .dantecode/ may not exist */
      }
    }

    // Send updated config back to webview
    this.handleLoadAgentConfig();
  }

  private handleLoadAgentConfig(): void {
    this.postMessage({
      type: "agent_config_data",
      payload: { config: this.agentConfig },
    });
    this.postMessage({
      type: "mode_update",
      payload: { mode: this.agentConfig.agentMode },
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

  public handleFileAdd(filePath: string): void {
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
    // Update status bar with the new model name
    this.updateStatusBar({ model });
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
      // Track active skill so pipeline continuation protections apply universally
      this.activeSkill = skillName;
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
    this.hostCallbacks.onModelChange?.(this.currentModel);
  }

  /** Send memory info (lesson count + session count) to the webview. */
  private async sendMemoryInfo(): Promise<void> {
    try {
      const projectRoot = this.getProjectRoot();
      if (!projectRoot) return;

      // Count sessions
      const store = await this.getSessionStore();
      const sessions = store ? await store.list() : [];
      const sessionCount = sessions.length;

      // Count lessons
      let lessonCount = 0;
      try {
        const lessons = await queryLessons({ projectRoot, limit: 100 });
        lessonCount = lessons.length;
      } catch {
        // Non-fatal: lessons may not be available
      }

      this.postMessage({
        type: "memory_info",
        payload: { lessonCount, sessionCount },
      });
    } catch {
      // Non-fatal: memory info is cosmetic
    }
  }

  private getProjectRoot(): string {
    const folders = vscode.workspace.workspaceFolders;
    return folders?.[0]?.uri.fsPath ?? "";
  }

  // --------------------------------------------------------------------------
  // Workspace scanning — gives the model real project context
  // --------------------------------------------------------------------------

  /**
   * Builds a directory tree string for the workspace, respecting common
   * ignore patterns. Limits depth and file count to stay within token budget.
   */
  private async buildWorkspaceTree(
    rootUri: vscode.Uri,
    maxDepth = 3,
    maxFiles = 200,
  ): Promise<string> {
    const IGNORE_DIRS = new Set([
      "node_modules",
      ".git",
      ".turbo",
      "dist",
      "build",
      ".next",
      ".nuxt",
      "coverage",
      "__pycache__",
      ".venv",
      "venv",
      ".dantecode",
      ".vscode",
      ".idea",
      "out",
      ".cache",
      ".parcel-cache",
      "target",
    ]);
    const IGNORE_EXTS = new Set([
      ".vsix",
      ".lock",
      ".log",
      ".tsbuildinfo",
      ".map",
      ".min.js",
      ".min.css",
    ]);

    const lines: string[] = [];
    let fileCount = 0;

    const walk = async (dirUri: vscode.Uri, prefix: string, depth: number): Promise<void> => {
      if (depth > maxDepth || fileCount >= maxFiles) return;

      let entries: [string, vscode.FileType][];
      try {
        entries = await vscode.workspace.fs.readDirectory(dirUri);
      } catch {
        return;
      }

      // Sort: directories first, then files
      entries.sort((a, b) => {
        if (a[1] === b[1]) return a[0].localeCompare(b[0]);
        return a[1] === vscode.FileType.Directory ? -1 : 1;
      });

      for (const [name, type] of entries) {
        if (fileCount >= maxFiles) {
          lines.push(`${prefix}... (truncated)`);
          return;
        }

        if (name.startsWith(".") && name !== ".env.example") continue;

        if (type === vscode.FileType.Directory) {
          if (IGNORE_DIRS.has(name)) continue;
          lines.push(`${prefix}${name}/`);
          const childUri = vscode.Uri.joinPath(dirUri, name);
          await walk(childUri, prefix + "  ", depth + 1);
        } else {
          const ext = name.includes(".") ? "." + name.split(".").pop() : "";
          if (IGNORE_EXTS.has(ext)) continue;
          lines.push(`${prefix}${name}`);
          fileCount++;
        }
      }
    };

    await walk(rootUri, "", 0);
    return lines.join("\n");
  }

  /**
   * Reads key project files that give the model high-level understanding
   * of the project: package.json, README, config files, etc.
   * Returns a map of relative path → file content (truncated to stay in budget).
   */
  private async readKeyProjectFiles(
    rootUri: vscode.Uri,
    maxFileSize = CLOUD_CHAT_PROMPT_PROFILE.keyFileMaxChars,
  ): Promise<Map<string, string>> {
    const KEY_FILES = ["package.json", "README.md", "tsconfig.json", ".env.example", "CLAUDE.md"];

    const results = new Map<string, string>();

    for (const fileName of KEY_FILES) {
      try {
        const fileUri = vscode.Uri.joinPath(rootUri, fileName);
        const content = await vscode.workspace.fs.readFile(fileUri);
        let text = Buffer.from(content).toString("utf-8");
        if (text.length > maxFileSize) {
          text = text.substring(0, maxFileSize) + "\n... (truncated)";
        }
        results.set(fileName, text);
      } catch {
        // File doesn't exist — skip
      }
    }

    return results;
  }

  /**
   * Gets the content of the currently active editor tab.
   */
  private getActiveEditorContent(
    maxActiveFile = CLOUD_CHAT_PROMPT_PROFILE.activeFileMaxChars,
  ): { path: string; content: string } | null {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return null;

    const doc = editor.document;
    let content = doc.getText();
    if (content.length > maxActiveFile) {
      content = content.substring(0, maxActiveFile) + "\n... (truncated)";
    }

    return { path: doc.uri.fsPath, content };
  }

  private parseModelString(model: string): [string, string] {
    const parsed = parseModelReference(model);
    return [parsed.provider, parsed.modelId];
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
   * Persists the current chat session to file-based SessionStore.
   */
  private async saveChatToHistory(): Promise<void> {
    if (this.messages.length === 0) return;

    const store = await this.getSessionStore();
    if (!store) return;

    const now = new Date().toISOString();
    const existing = await store.load(this.currentChatId);

    const session: ChatSessionFile = {
      id: this.currentChatId,
      title: this.generateChatTitle(),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      model: this.currentModel,
      messages: this.messages.map((m) => ({
        role: m.role,
        content: m.content,
        timestamp: now,
      })),
      contextFiles: [...this.contextFiles],
    };

    await store.save(session);
  }

  // --------------------------------------------------------------------------
  // Webview HTML
  // --------------------------------------------------------------------------

  private getHtmlForWebview(_webview: vscode.Webview): string {
    return getWebviewHtml(this.currentModel);
  }
}

// Gate 14: strip ALL pre-tool narration from assistant context.
// Any prose before the first <tool_use> establishes false certainty frames that compound
// into future rounds. Strip unconditionally when tool calls are present.
export function stripPreToolNarration(text: string, hasToolCalls: boolean): string {
  if (!hasToolCalls) return text;
  const firstToolIdx = text.indexOf("<tool_use>");
  if (firstToolIdx <= 0) return text;
  return text.slice(firstToolIdx);
}

// Gate 7: parse <TOOL_RESULTS_VERIFIED> block from LLM response text.
function extractVerificationBlock(text: string): Map<string, "SUCCESS" | "ERROR"> | null {
  const match = text.match(/<TOOL_RESULTS_VERIFIED>([\s\S]*?)<\/TOOL_RESULTS_VERIFIED>/i);
  if (!match) return null;
  const entries = new Map<string, "SUCCESS" | "ERROR">();
  for (const line of match[1]!.trim().split("\n")) {
    const m = line.match(/^(\w+):\s*(SUCCESS|ERROR)/i);
    if (m) entries.set(m[1]!, m[2]!.toUpperCase() as "SUCCESS" | "ERROR");
  }
  return entries;
}

