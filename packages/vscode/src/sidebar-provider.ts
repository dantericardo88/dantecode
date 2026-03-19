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
} from "node:path";
import type {
  ChatSessionFile,
  ModelConfig,
  ModelRouterConfig,
  PDSEScore,
  TodoItem,
  AuditEvent,
} from "@dantecode/config-types";
import {
  DEFAULT_MODEL_ID,
  MODEL_CATALOG,
  ModelRouterImpl,
  SessionStore,
  appendAuditEvent,
  createSelfImprovementContext,
  detectSelfImprovementContext,
  getContextUtilization,
  getProviderCatalogEntry,
  groupCatalogModels,
  parseModelReference,
  readOrInitializeState,
  responseNeedsToolExecutionNudge,
  shouldContinueLoop,
} from "@dantecode/core";
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
  getToolDefinitionsPrompt,
  getWrittenFilePath,
  type DiffReviewPayload,
  type ToolResult,
  type ToolExecutionContext,
} from "./agent-tools.js";

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
    | "paste_image"
    | "save_agent_config"
    | "load_agent_config"
    | "user_confirmed_self_mod";
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
    | "memory_info";
  payload: Record<string, unknown>;
}

// ─── Agent Mode & Permission Types ──────────────────────────────────────────

/** Agent execution modes — Plan (read-only), Build (default), YOLO (full autonomous). */
type AgentMode = "plan" | "build" | "yolo";

/** Permission levels for tool categories. */
type PermissionLevel = "allow" | "ask" | "deny";

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
    }
  }

  // --------------------------------------------------------------------------
  // Chat request handler (with API key retrieval)
  // --------------------------------------------------------------------------

  private async handleChatRequest(text: string): Promise<void> {
    if (text.trim().length === 0) {
      return;
    }

    const projectRoot = this.getProjectRoot();
    const selfImprovement =
      detectSelfImprovementContext(text, projectRoot) ??
      (this.activeSkill
        ? createSelfImprovementContext(projectRoot, {
            workflowId: "skill-pipeline",
            triggerCommand: `skill:${this.activeSkill}`,
          })
        : undefined);
    const readTracker = new Map<string, string>();
    const editAttempts = new Map<string, number>();

    this.messages.push({ role: "user", content: text });
    this.stopRequested = false;
    this.abortController = new AbortController();

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
    const { agentMode, permissions, runUntilComplete } = this.agentConfig;
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

    // Build system prompt with full workspace context + tool definitions
    const systemParts = [
      "You are DanteCode, an autonomous AI coding agent.",
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
        "To search code: `gh search code \"pattern\" --limit 10 --json path,repository`",
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

    systemParts.push(getToolDefinitionsPrompt());

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
        const repoMap = generateRepoMap(projectPath, { maxFiles: 150 });
        if (repoMap.length > 0) {
          const formatted = formatRepoMapForContext(repoMap);
          systemParts.push("");
          systemParts.push(formatted);
        }
      } catch {
        // Fallback to VS Code API tree if git-engine fails (non-git project)
        try {
          const tree = await this.buildWorkspaceTree(wsFolder.uri);
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
        const keyFiles = await this.readKeyProjectFiles(wsFolder.uri);
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
      const activeFile = this.getActiveEditorContent();
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
          const fileText = Buffer.from(content).toString("utf-8");
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

    const agentMessages: Array<{ role: "user" | "assistant"; content: string }> = [
      ...this.messages.map((msg) => ({
        role: msg.role as "user" | "assistant",
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
          maxTokens: tier === "capable" ? 16384 : 8192,
          abortSignal: signal,
        });

        let fullResponse = "";

        // Set a 60-second timeout for the first chunk (up from 30s for slower models)
        const firstChunkTimeout = setTimeout(() => {
          if (fullResponse.length === 0 && this.abortController) {
            this.abortController.abort();
          }
        }, 60_000);

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
        }, 4000);

        try {
          for await (const chunk of streamResult.textStream) {
            if (fullResponse.length === 0) {
              clearTimeout(firstChunkTimeout);
              clearInterval(streamHeartbeat);
            }
            if (this.stopRequested) break;
            fullResponse += chunk;
            if (isFirstRound) {
              // First round: send partial (full response so far) for clean rendering
              this.postMessage({
                type: "chat_response_chunk",
                payload: { chunk, partial: fullResponse },
              });
            } else {
              // Subsequent rounds: chunk-only mode — APPENDS to existing buffer
              this.postMessage({
                type: "chat_response_chunk",
                payload: { chunk, partial: "" },
              });
            }
          }
        } catch (streamErr: unknown) {
          clearTimeout(firstChunkTimeout);
          clearInterval(streamHeartbeat);
          // If aborted by timeout and no response yet, show a timeout error
          if (signal.aborted && fullResponse.length === 0) {
            this.postMessage({
              type: "error",
              payload: {
                message: `Request to ${this.currentModel} timed out after 30 seconds.\nCheck your API key and network connection.`,
              },
            });
            break;
          }
          throw streamErr; // re-throw other errors to outer catch
        }
        clearTimeout(firstChunkTimeout);
        clearInterval(streamHeartbeat);

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
                maxTokens: 8192,
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

        // Extract tool calls from the response
        const { toolCalls } = extractToolCalls(fullResponse);

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
            // Do NOT send chat_response_done here — keep the streaming element alive
            agentMessages.push({ role: "assistant", content: fullResponse });
            agentMessages.push({
              role: "user",
              content:
                "You described or claimed work without using any tools. Stop narrating and EXECUTE the next step with <tool_use> blocks right now. Read files before editing them, make the change with Write/Edit, and only claim success after a real tool result.",
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

          this.messages.push({ role: "assistant", content: fullResponse });
          // Clear any error state on successful response
          this.updateStatusBar({ hasError: false });
          if (roundNumber <= 1) {
            // Single-round response (no tool execution) — send final text
            this.postMessage({ type: "chat_response_done", payload: { text: fullResponse } });
          } else {
            // Multi-round: buffer has accumulated tool output + model text — keep it
            this.postMessage({ type: "chat_response_done", payload: {} });
          }
          finalResponse = fullResponse;
          break;
        }

        // ── Tool calls found — execute them ──
        // Do NOT send chat_response_done here — keep the streaming element alive
        // so tool execution output is visible in the chat in real-time

        const toolResultParts: string[] = [];

        for (let ti = 0; ti < toolCalls.length; ti++) {
          executedToolsThisTurn++;
          const toolCall = toolCalls[ti]!;
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
          if (permissions.edit === "deny" && isWriteTool) {
            toolResultParts.push(
              `Tool "${toolCall.name}" blocked: File editing is denied by permissions.`,
            );
            continue;
          }
          if (permissions.bash === "deny" && isBashTool) {
            toolResultParts.push(
              `Tool "${toolCall.name}" blocked: Shell commands are denied by permissions.`,
            );
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
            awaitSelfModConfirmation: async () => {
              const selection = await vscode.window.showWarningMessage(
                "DanteCode wants to modify protected project files. Allow this write once?",
                { modal: true },
                "Allow once",
                "Block",
              );
              return selection === "Allow once";
            },
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
            const icon = result.isError ? "Error" : "OK";
            const preview = result.content.split("\n").slice(0, 5).join("\n");
            this.postMessage({
              type: "chat_response_chunk",
              payload: {
                chunk: `> _${icon}:_ \`${preview.slice(0, 200)}\`\n`,
                partial: "",
              },
            });
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

          toolResultParts.push(`Tool "${toolCall.name}" result:\n${result.content}`);
        }

        // Append the assistant response + tool results to the conversation for next round
        agentMessages.push({ role: "assistant", content: fullResponse });
        agentMessages.push({
          role: "user",
          content: `Tool execution results:\n\n${toolResultParts.join("\n\n---\n\n")}\n\nContinue with your task. If done, provide your final answer without any tool_use blocks.`,
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
        let diagnostic = `Error with ${this.currentModel}: ${rawMessage}`;

        // Provider-specific and HTTP-status-aware diagnostics
        const is401 = rawMessage.includes("401") || rawMessage.includes("Unauthorized");
        const is429 = rawMessage.includes("429") || rawMessage.includes("rate limit");
        const is503 = rawMessage.includes("503") || rawMessage.includes("Service Unavailable");

        if (is401) {
          diagnostic += `\n\nAPI key is invalid or expired. Open settings (gear icon) to update your ${provider} key.`;
        } else if (is429) {
          diagnostic += `\n\nRate limit exceeded. Wait a moment and try again, or switch to a different model.`;
        } else if (is503) {
          diagnostic += `\n\nThe ${provider} service is temporarily unavailable. Try again in a few minutes.`;
        } else if (provider !== "ollama" && !apiKey) {
          diagnostic += `\n\nNo API key was found for "${provider}". Open settings (gear icon) to configure it.`;
        } else if (provider !== "ollama") {
          diagnostic += `\n\nAPI key is configured — this may be an authentication or model name issue.`;
        } else {
          diagnostic += `\n\nCheck that Ollama is running locally (http://localhost:11434).`;
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
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
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
  private async readKeyProjectFiles(rootUri: vscode.Uri): Promise<Map<string, string>> {
    const KEY_FILES = ["package.json", "README.md", "tsconfig.json", ".env.example", "CLAUDE.md"];
    const MAX_FILE_SIZE = 4000; // chars per file

    const results = new Map<string, string>();

    for (const fileName of KEY_FILES) {
      try {
        const fileUri = vscode.Uri.joinPath(rootUri, fileName);
        const content = await vscode.workspace.fs.readFile(fileUri);
        let text = Buffer.from(content).toString("utf-8");
        if (text.length > MAX_FILE_SIZE) {
          text = text.substring(0, MAX_FILE_SIZE) + "\n... (truncated)";
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
  private getActiveEditorContent(): { path: string; content: string } | null {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return null;

    const doc = editor.document;
    const MAX_ACTIVE_FILE = 8000;
    let content = doc.getText();
    if (content.length > MAX_ACTIVE_FILE) {
      content = content.substring(0, MAX_ACTIVE_FILE) + "\n... (truncated)";
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
    const nonce = getNonce();
    const modelOptionGroups = renderModelOptionGroups(this.currentModel);

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
    .retry-btn {
      margin-top: 8px;
      padding: 4px 12px;
      font-size: 12px;
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border: none;
      border-radius: 3px;
      cursor: pointer;
    }
    .retry-btn:hover {
      background: var(--vscode-button-secondaryHoverBackground);
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
    .message-body del { text-decoration: line-through; opacity: 0.7; }
    .message-body ul, .message-body ol { margin: 6px 0; padding-left: 22px; }
    .message-body li { margin: 3px 0; line-height: 1.5; }
    .message-body h1, .message-body h2, .message-body h3, .message-body h4 {
      margin: 12px 0 6px;
      font-weight: 600;
      color: var(--vscode-foreground);
    }
    .message-body h1 { font-size: 17px; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 4px; }
    .message-body h2 { font-size: 15px; }
    .message-body h3 { font-size: 13.5px; }
    .message-body h4 { font-size: 13px; font-style: italic; }
    .message-body blockquote {
      border-left: 3px solid var(--vscode-textLink-foreground);
      padding: 8px 14px;
      margin: 8px 0;
      background: rgba(255,255,255,0.03);
      border-radius: 0 4px 4px 0;
      color: var(--vscode-descriptionForeground);
      font-size: 12.5px;
    }
    .message-body hr {
      border: none;
      border-top: 1px solid var(--vscode-panel-border);
      margin: 12px 0;
    }
    .message-body a {
      color: var(--vscode-textLink-foreground);
      text-decoration: none;
    }
    .message-body a:hover { text-decoration: underline; }

    /* ---- Tables ---- */
    .table-wrapper {
      overflow-x: auto;
      margin: 8px 0;
      border-radius: 4px;
      border: 1px solid var(--vscode-panel-border);
    }
    .message-body table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    }
    .message-body thead {
      background: rgba(255,255,255,0.05);
    }
    .message-body th {
      padding: 6px 10px;
      font-weight: 600;
      text-align: left;
      border-bottom: 2px solid var(--vscode-panel-border);
      color: var(--vscode-foreground);
    }
    .message-body td {
      padding: 5px 10px;
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    .message-body tr:last-child td { border-bottom: none; }
    .message-body tr:hover { background: rgba(255,255,255,0.02); }

    /* ---- Task lists ---- */
    .message-body .task-item {
      list-style: none;
      margin-left: -20px;
      padding: 2px 0;
    }
    .message-body .task-item.done { opacity: 0.7; }
    .message-body .task-check { margin-right: 6px; }

    /* ---- Diff Highlighting ---- */
    .diff-block pre { background: var(--vscode-editor-background); }
    .diff-add { color: var(--vscode-gitDecoration-addedResourceForeground, #4ec9b0); background: rgba(78, 201, 176, 0.1); display: inline-block; width: 100%; }
    .diff-del { color: var(--vscode-gitDecoration-deletedResourceForeground, #f44747); background: rgba(244, 71, 71, 0.1); display: inline-block; width: 100%; }
    .diff-hunk { color: var(--vscode-textLink-foreground); font-weight: 600; }
    .diff-file { color: var(--vscode-descriptionForeground); font-weight: 600; }

    /* ---- Progress Bar ---- */
    .progress-bar {
      background: var(--vscode-panel-border);
      border-radius: 3px;
      height: 6px;
      margin: 4px 0;
      overflow: hidden;
    }
    .progress-bar-fill {
      background: var(--vscode-charts-green);
      height: 100%;
      border-radius: 3px;
      transition: width 0.3s ease;
    }

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

    /* ---- Mode Indicator Badge ---- */
    .mode-badge {
      display: flex;
      align-items: center;
      gap: 3px;
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .mode-badge.plan { background: var(--vscode-charts-blue); color: #fff; }
    .mode-badge.build { background: var(--vscode-charts-green); color: #fff; }
    .mode-badge.yolo { background: var(--vscode-charts-orange, #e8912d); color: #fff; }

    /* ---- Mode Selector (in settings) ---- */
    .mode-selector {
      display: flex;
      gap: 4px;
      margin-bottom: 8px;
    }
    .mode-btn {
      flex: 1;
      padding: 8px 4px;
      font-size: 11px;
      font-weight: 600;
      font-family: var(--vscode-font-family);
      text-align: center;
      border: 1px solid var(--vscode-input-border);
      border-radius: 4px;
      background: var(--vscode-input-background);
      color: var(--vscode-foreground);
      cursor: pointer;
      transition: all 0.15s;
    }
    .mode-btn:hover { border-color: var(--vscode-focusBorder); }
    .mode-btn.active {
      border-color: var(--vscode-focusBorder);
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    .mode-btn .mode-icon { display: block; font-size: 16px; margin-bottom: 2px; }
    .mode-desc { font-size: 9px; font-weight: 400; opacity: 0.7; display: block; }

    /* ---- Permission Row ---- */
    .perm-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 0;
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    .perm-row:last-child { border-bottom: none; }
    .perm-label { font-size: 12px; font-weight: 500; }
    .perm-select {
      padding: 3px 6px;
      font-size: 11px;
      font-family: var(--vscode-font-family);
      color: var(--vscode-dropdown-foreground);
      background: var(--vscode-dropdown-background);
      border: 1px solid var(--vscode-dropdown-border);
      border-radius: 3px;
    }

    /* ---- Toggle Switch ---- */
    .toggle-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 0;
    }
    .toggle-label { font-size: 12px; font-weight: 500; }
    .toggle-desc { font-size: 10px; color: var(--vscode-descriptionForeground); }
    .toggle-switch {
      position: relative;
      width: 36px;
      height: 20px;
      flex-shrink: 0;
    }
    .toggle-switch input { opacity: 0; width: 0; height: 0; }
    .toggle-slider {
      position: absolute;
      inset: 0;
      background: var(--vscode-input-border);
      border-radius: 10px;
      cursor: pointer;
      transition: background 0.2s;
    }
    .toggle-slider::before {
      content: '';
      position: absolute;
      width: 16px;
      height: 16px;
      left: 2px;
      top: 2px;
      background: #fff;
      border-radius: 50%;
      transition: transform 0.2s;
    }
    .toggle-switch input:checked + .toggle-slider {
      background: var(--vscode-button-background);
    }
    .toggle-switch input:checked + .toggle-slider::before {
      transform: translateX(16px);
    }

    .settings-divider {
      height: 1px;
      background: var(--vscode-panel-border);
      margin: 4px 0;
    }

    /* ---- Memory Info ---- */
    .memory-info {
      display: none;
      padding: 2px 12px;
      font-size: 10px;
      color: var(--vscode-descriptionForeground);
      background: var(--vscode-sideBarSectionHeader-background);
      border-bottom: 1px solid var(--vscode-panel-border);
      opacity: 0.8;
    }
    .memory-info.visible { display: block; }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-left">
      <span class="header-title">DanteCode Chat</span>
      <span class="mode-badge build" id="mode-badge">BUILD</span>
      <span class="pdse-badge" id="pdse-badge">
        PDSE: <span id="pdse-score">--</span>
      </span>
      <span class="cost-bar" id="cost-bar" style="display:none;">
        <span class="cost-tier" id="cost-tier">fast</span>
        <span id="cost-amount">$0.000</span>
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
      ${modelOptionGroups}
    </select>
  </div>

  <div class="memory-info" id="memory-info"></div>

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

  <div id="context-bar" style="height: 4px; background: var(--vscode-editorWidget-border, #333); margin: 0 8px;">
    <div id="context-fill" style="height: 100%; width: 0%; transition: width 0.3s; background: #4caf50;"></div>
  </div>

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
      <!-- Agent Mode -->
      <div class="settings-section">
        <h4>Agent Mode</h4>
        <p>Controls how DanteCode executes tasks.</p>
        <div class="mode-selector" id="mode-selector">
          <button class="mode-btn" data-mode="plan">
            <span class="mode-icon">&#128270;</span>Plan
            <span class="mode-desc">Read-only analysis</span>
          </button>
          <button class="mode-btn active" data-mode="build">
            <span class="mode-icon">&#128736;</span>Build
            <span class="mode-desc">Edit with permissions</span>
          </button>
          <button class="mode-btn" data-mode="yolo">
            <span class="mode-icon">&#9889;</span>YOLO
            <span class="mode-desc">Full autonomous</span>
          </button>
        </div>
      </div>

      <div class="settings-divider"></div>

      <!-- Permissions -->
      <div class="settings-section" id="permissions-section">
        <h4>Permissions</h4>
        <p>Control what the agent can do. YOLO mode overrides all to "allow".</p>
        <div class="perm-row">
          <span class="perm-label">File Edit (Write/Edit)</span>
          <select class="perm-select" id="perm-edit" data-perm="edit">
            <option value="allow">Allow</option>
            <option value="ask">Ask</option>
            <option value="deny">Deny</option>
          </select>
        </div>
        <div class="perm-row">
          <span class="perm-label">Shell Commands (Bash)</span>
          <select class="perm-select" id="perm-bash" data-perm="bash">
            <option value="allow">Allow</option>
            <option value="ask" selected>Ask</option>
            <option value="deny">Deny</option>
          </select>
        </div>
        <div class="perm-row">
          <span class="perm-label">All Tools</span>
          <select class="perm-select" id="perm-tools" data-perm="tools">
            <option value="allow">Allow</option>
            <option value="ask">Ask</option>
            <option value="deny">Deny</option>
          </select>
        </div>
      </div>

      <div class="settings-divider"></div>

      <!-- Run Until Complete Toggle -->
      <div class="settings-section">
        <div class="toggle-row">
          <div>
            <span class="toggle-label">Run Until Complete</span>
            <span class="toggle-desc">Agent continues without stopping until task is done</span>
          </div>
          <label class="toggle-switch">
            <input type="checkbox" id="toggle-run-complete">
            <span class="toggle-slider"></span>
          </label>
        </div>
      </div>

      <div class="settings-divider"></div>

      <!-- Show Live Diffs Toggle -->
      <div class="settings-section">
        <div class="toggle-row">
          <div>
            <span class="toggle-label">Show Live Diffs</span>
            <span class="toggle-desc">Open modified files in the editor with before/after diff view</span>
          </div>
          <label class="toggle-switch">
            <input type="checkbox" id="toggle-live-diffs" checked>
            <span class="toggle-slider"></span>
          </label>
        </div>
      </div>

      <div class="settings-divider"></div>

      <!-- API Keys -->
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
      const costBar = document.getElementById('cost-bar');
      const costTierEl = document.getElementById('cost-tier');
      const costAmountEl = document.getElementById('cost-amount');
      const settingsOverlay = document.getElementById('settings-overlay');
      const historyOverlay = document.getElementById('history-overlay');
      const historyList = document.getElementById('history-list');
      const apiKeyFields = document.getElementById('api-key-fields');
      const toastEl = document.getElementById('toast');
      const attachmentsBar = document.getElementById('attachments-bar');
      const dropZone = document.getElementById('drop-zone');

      const modeBadge = document.getElementById('mode-badge');
      const modeSelector = document.getElementById('mode-selector');
      const permEdit = document.getElementById('perm-edit');
      const permBash = document.getElementById('perm-bash');
      const permTools = document.getElementById('perm-tools');
      const toggleRunComplete = document.getElementById('toggle-run-complete');
      const permissionsSection = document.getElementById('permissions-section');

      let isStreaming = false;
      let currentAssistantEl = null;
      var streamBuffer = ''; // accumulates all content for current assistant message
      var pendingImagePreviews = []; // { dataUrl, fileName }
      var currentAgentMode = 'build';

      // ---- Toast ----
      function showToast(msg, durationMs) {
        toastEl.textContent = msg;
        toastEl.classList.add('visible');
        setTimeout(function() { toastEl.classList.remove('visible'); }, durationMs || 2000);
      }

      // ---- Markdown rendering (premium) ----
      function renderMarkdown(text) {
        if (!text) return '';

        var BT = String.fromCharCode(96); // backtick
        var BT3 = BT + BT + BT;

        // Protect code blocks from processing — extract and replace with placeholders
        var codeBlocks = [];
        var cbRegex = new RegExp(BT3 + '(\\\\w*)\\\\n([\\\\s\\\\S]*?)' + BT3, 'g');
        var processed = text.replace(cbRegex, function(_match, lang, code) {
          var idx = codeBlocks.length;
          var langLabel = lang || 'code';
          var id = 'cb-' + Math.random().toString(36).slice(2, 8);
          // Escape HTML inside code blocks
          var escaped = code
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
          // Apply diff syntax highlighting for diff/patch blocks
          var codeHtml = escaped;
          if (langLabel === 'diff' || langLabel === 'patch') {
            codeHtml = escaped.split('\\n').map(function(line) {
              if (line.match(/^\\+(?!\\+\\+)/)) return '<span class="diff-add">' + line + '</span>';
              if (line.match(/^-(?!--)/)) return '<span class="diff-del">' + line + '</span>';
              if (line.match(/^@@/)) return '<span class="diff-hunk">' + line + '</span>';
              if (line.match(/^(---\\s|\\+\\+\\+\\s)/)) return '<span class="diff-file">' + line + '</span>';
              return line;
            }).join('\\n');
          }
          codeBlocks.push(
            '<div class="code-block-wrapper' + (langLabel === 'diff' || langLabel === 'patch' ? ' diff-block' : '') + '">' +
              '<div class="code-block-header">' +
                '<span class="code-lang">' + langLabel + '</span>' +
                '<button class="copy-code-btn" data-code-id="' + id + '">Copy</button>' +
              '</div>' +
              '<pre><code id="' + id + '">' + codeHtml + '</code></pre>' +
            '</div>'
          );
          return '%%CODEBLOCK_' + idx + '%%';
        });

        // Escape HTML in non-code content
        processed = processed
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');

        // ── Tables ──
        processed = processed.replace(/((?:^\\|.+\\|[ \\t]*$\\n?)+)/gm, function(tableBlock) {
          var rows = tableBlock.trim().split('\\n').filter(function(r) { return r.trim().length > 0; });
          if (rows.length < 2) return tableBlock;
          var sepTest = rows[1].replace(/\\s/g, '');
          var isSep = /^\\|?[-:|]+(\\|[-:|]+)+\\|?$/.test(sepTest);
          if (!isSep) return tableBlock;

          var sepCells = rows[1].split('|').filter(function(c) { return c.trim().length > 0; });
          var aligns = sepCells.map(function(c) {
            c = c.trim();
            if (c.charAt(0) === ':' && c.charAt(c.length - 1) === ':') return 'center';
            if (c.charAt(c.length - 1) === ':') return 'right';
            return 'left';
          });

          var html = '<div class="table-wrapper"><table>';
          var headerCells = rows[0].split('|').filter(function(c) { return c.trim().length > 0; });
          html += '<thead><tr>';
          headerCells.forEach(function(cell, i) {
            var align = aligns[i] || 'left';
            html += '<th style="text-align:' + align + '">' + cell.trim() + '</th>';
          });
          html += '</tr></thead>';
          html += '<tbody>';
          for (var r = 2; r < rows.length; r++) {
            var cells = rows[r].split('|').filter(function(c) { return c.trim().length > 0; });
            html += '<tr>';
            cells.forEach(function(cell, i) {
              var align = aligns[i] || 'left';
              html += '<td style="text-align:' + align + '">' + cell.trim() + '</td>';
            });
            html += '</tr>';
          }
          html += '</tbody></table></div>';
          return html;
        });

        // ── Horizontal rules ──
        processed = processed.replace(/^(---|\\*\\*\\*|___)\\s*$/gm, '<hr>');

        // ── Inline code (before other inline formatting) ──
        var icRegex = new RegExp(BT + '([^' + BT + ']+)' + BT, 'g');
        processed = processed.replace(icRegex, '<code>$1</code>');

        // ── Headers ──
        processed = processed.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
        processed = processed.replace(/^### (.+)$/gm, '<h3>$1</h3>');
        processed = processed.replace(/^## (.+)$/gm, '<h2>$1</h2>');
        processed = processed.replace(/^# (.+)$/gm, '<h1>$1</h1>');

        // ── Bold and italic ──
        processed = processed.replace(/\\*\\*\\*(.+?)\\*\\*\\*/g, '<strong><em>$1</em></strong>');
        processed = processed.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>');
        processed = processed.replace(/\\*(.+?)\\*/g, '<em>$1</em>');
        processed = processed.replace(/~~(.+?)~~/g, '<del>$1</del>');

        // ── Blockquotes (multi-line aware) ──
        processed = processed.replace(/(^&gt; .+$\\n?)+/gm, function(block) {
          var inner = block.replace(/^&gt; /gm, '').trim();
          return '<blockquote>' + inner + '</blockquote>';
        });

        // ── Task lists (checkboxes) ──
        processed = processed.replace(/^- \\[x\\] (.+)$/gm, '<li class="task-item done"><span class="task-check">&#9989;</span> $1</li>');
        processed = processed.replace(/^- \\[ \\] (.+)$/gm, '<li class="task-item"><span class="task-check">&#9744;</span> $1</li>');

        // ── Ordered lists ──
        processed = processed.replace(/(^(\\d+)\\. .+$\\n?)+/gm, function(block) {
          var items = block.trim().split('\\n');
          var html = '<ol>';
          items.forEach(function(item) {
            var content = item.replace(/^\\d+\\.\\s+/, '');
            html += '<li>' + content + '</li>';
          });
          html += '</ol>';
          return html;
        });

        // ── Unordered lists ──
        processed = processed.replace(/(^- .+$\\n?)+/gm, function(block) {
          var items = block.trim().split('\\n');
          var html = '<ul>';
          items.forEach(function(item) {
            var content = item.replace(/^- /, '');
            html += '<li>' + content + '</li>';
          });
          html += '</ul>';
          return html;
        });

        // ── Links ──
        processed = processed.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, '<a href="$2" target="_blank">$1</a>');

        // ── Paragraphs: wrap remaining non-tag lines ──
        processed = processed.replace(/^(?!<[a-z/]|%%CODEBLOCK)(.*\\S.*)$/gm, '<p>$1</p>');

        // ── Clean up: merge adjacent blockquotes, remove empty paragraphs ──
        processed = processed.replace(/<\\/blockquote>\\s*<blockquote>/g, '<br>');
        processed = processed.replace(/<p>\\s*<\\/p>/g, '');

        // ── Restore code blocks ──
        codeBlocks.forEach(function(block, idx) {
          processed = processed.replace('%%CODEBLOCK_' + idx + '%%', block);
        });

        return processed;
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

        streamBuffer = '';
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

      // ---- Agent Mode selector ----
      modeSelector.addEventListener('click', function(e) {
        var btn = e.target.closest('.mode-btn');
        if (!btn) return;
        var mode = btn.dataset.mode;
        if (!mode) return;

        // Update UI
        modeSelector.querySelectorAll('.mode-btn').forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');
        currentAgentMode = mode;

        // In YOLO mode, force all permissions to allow and disable dropdowns
        if (mode === 'yolo') {
          permEdit.value = 'allow'; permBash.value = 'allow'; permTools.value = 'allow';
          permEdit.disabled = true; permBash.disabled = true; permTools.disabled = true;
          toggleRunComplete.checked = true;
        } else {
          permEdit.disabled = false; permBash.disabled = false; permTools.disabled = false;
        }

        // In Plan mode, force edit+bash to deny
        if (mode === 'plan') {
          permEdit.value = 'deny'; permBash.value = 'deny';
          permEdit.disabled = true; permBash.disabled = true;
        }

        // Save
        vscode.postMessage({
          type: 'save_agent_config',
          payload: {
            agentMode: mode,
            permissions: { edit: permEdit.value, bash: permBash.value, tools: permTools.value },
            runUntilComplete: toggleRunComplete.checked,
          },
        });
      });

      // ---- Permission dropdowns ----
      [permEdit, permBash, permTools].forEach(function(sel) {
        sel.addEventListener('change', function() {
          vscode.postMessage({
            type: 'save_agent_config',
            payload: {
              permissions: { edit: permEdit.value, bash: permBash.value, tools: permTools.value },
            },
          });
        });
      });

      // ---- Run Until Complete toggle ----
      toggleRunComplete.addEventListener('change', function() {
        vscode.postMessage({
          type: 'save_agent_config',
          payload: { runUntilComplete: toggleRunComplete.checked },
        });
      });

      // ---- Show Live Diffs toggle ----
      var toggleLiveDiffs = document.getElementById('toggle-live-diffs');
      toggleLiveDiffs.addEventListener('change', function() {
        vscode.postMessage({
          type: 'save_agent_config',
          payload: { showLiveDiffs: toggleLiveDiffs.checked },
        });
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
            // Safety net: if currentAssistantEl was cleared (e.g. by finishStreaming),
            // create a new assistant message element so tool output isn't dropped
            if (!currentAssistantEl) {
              currentAssistantEl = appendMessage('assistant', '', false);
              streamBuffer = '';
              isStreaming = true;
              sendBtn.style.display = 'none';
              stopBtn.classList.add('visible');
              typingIndicator.classList.add('visible');
            }
            var partial = message.payload.partial || '';
            var chunk = message.payload.chunk || '';
            if (chunk.length > 0) {
              // ALWAYS accumulate chunks — this is the primary content path.
              // Never replace buffer; always append. This prevents tool output,
              // diffs, and round progress from being wiped.
              streamBuffer += chunk;
              currentAssistantEl.innerHTML = renderMarkdown(streamBuffer);
            } else if (partial.length > 0 && streamBuffer.length === 0) {
              // Temporary display only when buffer is empty (e.g., "thinking...")
              // Does NOT modify streamBuffer — real chunks will take over
              currentAssistantEl.innerHTML = renderMarkdown(partial);
            }
            attachCopyCodeHandlers(currentAssistantEl);
            messagesEl.scrollTop = messagesEl.scrollHeight;
            break;

          case 'chat_response_done':
            // If text is provided, render it as final content (single-round response).
            // If text is empty/missing, keep the accumulated stream buffer (multi-round).
            var doneText = message.payload.text;
            if (doneText && doneText.length > 0) {
              finishStreaming(doneText);
            } else {
              finishStreaming(undefined);
            }
            break;

          case 'generation_stopped':
            if (message.payload.text && message.payload.text.length > 0) {
              finishStreaming(message.payload.text + '\\n\\n_(generation stopped)_');
            } else {
              // Keep accumulated buffer, just append stopped notice
              if (currentAssistantEl && streamBuffer) {
                streamBuffer += '\\n\\n_(generation stopped)_';
                currentAssistantEl.innerHTML = renderMarkdown(streamBuffer);
              }
              finishStreaming(undefined);
            }
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
            var errorBody = appendMessage('error', 'Error: ' + (message.payload.message || 'Unknown error'), false);
            // Add retry button to error messages
            var retryBtn = document.createElement('button');
            retryBtn.className = 'retry-btn';
            retryBtn.textContent = 'Retry';
            retryBtn.addEventListener('click', function() {
              var lastUserMsg = document.querySelectorAll('.message.user .message-body');
              if (lastUserMsg.length > 0) {
                var lastText = lastUserMsg[lastUserMsg.length - 1].innerText;
                inputEl.value = lastText;
                sendBtn.click();
              }
            });
            errorBody.appendChild(retryBtn);
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

          case 'agent_config_data':
            var cfg = message.payload.config || {};
            currentAgentMode = cfg.agentMode || 'build';
            // Update mode selector buttons
            modeSelector.querySelectorAll('.mode-btn').forEach(function(b) {
              b.classList.toggle('active', b.dataset.mode === currentAgentMode);
            });
            // Update permission dropdowns
            if (cfg.permissions) {
              permEdit.value = cfg.permissions.edit || 'allow';
              permBash.value = cfg.permissions.bash || 'ask';
              permTools.value = cfg.permissions.tools || 'allow';
            }
            // Update toggles
            toggleRunComplete.checked = !!cfg.runUntilComplete;
            toggleLiveDiffs.checked = cfg.showLiveDiffs !== false; // default true
            // Disable controls based on mode
            var isYolo = currentAgentMode === 'yolo';
            var isPlan = currentAgentMode === 'plan';
            permEdit.disabled = isYolo || isPlan;
            permBash.disabled = isYolo || isPlan;
            permTools.disabled = isYolo;
            break;

          case 'mode_update':
            var m = message.payload.mode || 'build';
            modeBadge.textContent = m.toUpperCase();
            modeBadge.className = 'mode-badge ' + m;
            break;

          case 'cost_update':
            if (costBar && costTierEl && costAmountEl) {
              costBar.style.display = 'flex';
              costTierEl.textContent = message.payload.modelTier || 'fast';
              costAmountEl.textContent = '$' + (Number(message.payload.sessionTotalUsd) || 0).toFixed(3);
            }
            break;

          case 'context_update': {
            var ctxFill = document.getElementById('context-fill');
            if (ctxFill) {
              var pct = Number(message.payload.percent) || 0;
              var tier = message.payload.tier || 'green';
              ctxFill.style.width = pct + '%';
              ctxFill.style.background = tier === 'green' ? '#4caf50' : tier === 'yellow' ? '#ff9800' : '#f44336';
            }
            break;
          }

          case 'memory_info': {
            var memEl = document.getElementById('memory-info');
            if (memEl) {
              var lc = Number(message.payload.lessonCount) || 0;
              var sc = Number(message.payload.sessionCount) || 0;
              if (lc > 0 || sc > 0) {
                memEl.textContent = 'Memory: ' + lc + ' lesson' + (lc !== 1 ? 's' : '') + ' | ' + sc + ' session' + (sc !== 1 ? 's' : '');
                memEl.classList.add('visible');
              } else {
                memEl.classList.remove('visible');
              }
            }
            break;
          }

          case 'diff_hunk':
            if (currentAssistantEl) {
              var hunk = message.payload;
              var diffEl = document.createElement('div');
              diffEl.className = 'diff-hunk-container';
              var headerEl = document.createElement('div');
              headerEl.className = 'diff-hunk-header';
              headerEl.innerHTML = '<span class="diff-filename">' + (hunk.filePath || '') + '</span>'
                + '<span class="diff-stats">+' + (hunk.linesAdded || 0) + ' -' + (hunk.linesRemoved || 0) + '</span>';
              diffEl.appendChild(headerEl);
              var bodyEl = document.createElement('pre');
              bodyEl.className = 'diff-body';
              var lines = hunk.lines || [];
              lines.forEach(function(line) {
                var span = document.createElement('span');
                span.className = 'diff-line diff-' + (line.type || 'context');
                span.textContent = line.content || '';
                bodyEl.appendChild(span);
              });
              diffEl.appendChild(bodyEl);
              currentAssistantEl.appendChild(diffEl);
              messagesEl.scrollTop = messagesEl.scrollHeight;
            }
            break;

          case 'self_modification_blocked':
            if (currentAssistantEl) {
              var modPath = message.payload.filePath || 'unknown';
              streamBuffer += '\\n\\n> **Self-modification blocked:** \\x60' + modPath + '\\x60 — This file is protected.\\n';
              currentAssistantEl.innerHTML = renderMarkdown(streamBuffer);
              messagesEl.scrollTop = messagesEl.scrollHeight;
            }
            break;

          case 'loop_terminated':
            if (currentAssistantEl) {
              var reason = message.payload.reason || 'unknown';
              var rounds = message.payload.roundsCompleted || 0;
              streamBuffer += '\\n\\n> **Loop terminated:** ' + reason + ' after ' + rounds + ' rounds.\\n';
              currentAssistantEl.innerHTML = renderMarkdown(streamBuffer);
              messagesEl.scrollTop = messagesEl.scrollHeight;
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

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderModelOptionGroups(selectedModel: string): string {
  const tierOneModels = MODEL_CATALOG.filter((entry) => entry.supportTier === "tier1");

  return groupCatalogModels(tierOneModels)
    .map(({ groupLabel, models }) => {
      const groupId = groupLabel === "Local (Ollama)" ? ' id="ollama-optgroup"' : "";
      const options = models
        .map((model) => {
          const selected = model.id === selectedModel ? " selected" : "";
          return `<option value="${escapeHtml(model.id)}"${selected}>${escapeHtml(model.label)}</option>`;
        })
        .join("");

      return `<optgroup label="${escapeHtml(groupLabel)}"${groupId}>${options}</optgroup>`;
    })
    .join("");
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
