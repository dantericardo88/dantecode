import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Comprehensive vscode module mock
// ---------------------------------------------------------------------------

const mockCollectionSet = vi.fn();
const mockCollectionDelete = vi.fn();
const mockCollectionClear = vi.fn();
const mockCollectionDispose = vi.fn();

const mockStatusBarItem = {
  text: "",
  tooltip: "",
  command: undefined as string | undefined,
  backgroundColor: undefined as unknown,
  color: undefined as unknown,
  show: vi.fn(),
  dispose: vi.fn(),
};

vi.mock("vscode", () => {
  const DiagnosticSeverity = { Error: 0, Warning: 1, Information: 2, Hint: 3 };

  class Position {
    constructor(
      public line: number,
      public character: number,
    ) {}
  }

  class Range {
    constructor(
      public start: Position,
      public end: Position,
    ) {}
  }

  class Diagnostic {
    source = "";
    code: unknown = undefined;
    relatedInformation: unknown[] | undefined;
    tags: unknown[] | undefined;
    constructor(
      public range: Range,
      public message: string,
      public severity: number,
    ) {}
  }

  class DiagnosticRelatedInformation {
    constructor(
      public location: unknown,
      public message: string,
    ) {}
  }

  class Location {
    constructor(
      public uri: unknown,
      public range: Range,
    ) {}
  }

  class ThemeColor {
    constructor(public id: string) {}
  }

  class InlineCompletionItem {
    filterText = "";
    constructor(
      public insertText: string,
      public range: Range,
    ) {}
  }

  class RelativePattern {
    constructor(
      public base: unknown,
      public pattern: string,
    ) {}
  }

  class EventEmitter {
    private listeners: Array<(...args: unknown[]) => void> = [];
    event = (listener: (...args: unknown[]) => void) => {
      this.listeners.push(listener);
      return { dispose: () => {} };
    };
    fire(data?: unknown) {
      this.listeners.forEach((l) => l(data));
    }
    dispose() {
      this.listeners = [];
    }
  }

  class TreeItem {
    label?: string;
    description?: string;
    tooltip?: string;
    iconPath?: unknown;
    command?: unknown;
    collapsibleState?: number;
    resourceUri?: unknown;
    constructor(labelOrUri: unknown, collapsibleState?: number) {
      if (typeof labelOrUri === "string") {
        this.label = labelOrUri;
      } else {
        this.resourceUri = labelOrUri;
      }
      this.collapsibleState = collapsibleState;
    }
  }

  const TreeItemCollapsibleState = { None: 0, Collapsed: 1, Expanded: 2 };

  const StatusBarAlignment = { Left: 1, Right: 2 };
  const ConfigurationTarget = { Global: 1, Workspace: 2, WorkspaceFolder: 3 };
  const ProgressLocation = { Notification: 15 };

  const Uri = {
    parse: (s: string) => ({ toString: () => s, fsPath: s }),
    file: (s: string) => ({ fsPath: s, toString: () => s }),
  };

  return {
    DiagnosticSeverity,
    Diagnostic,
    DiagnosticRelatedInformation,
    Location,
    Range,
    Position,
    ThemeColor,
    InlineCompletionItem,
    RelativePattern,
    EventEmitter,
    TreeItem,
    TreeItemCollapsibleState,
    StatusBarAlignment,
    ConfigurationTarget,
    ProgressLocation,
    Uri,
    languages: {
      createDiagnosticCollection: vi.fn(() => ({
        set: mockCollectionSet,
        delete: mockCollectionDelete,
        clear: mockCollectionClear,
        dispose: mockCollectionDispose,
      })),
      registerInlineCompletionItemProvider: vi.fn(() => ({ dispose: vi.fn() })),
    },
    window: {
      createStatusBarItem: vi.fn(() => mockStatusBarItem),
      showInformationMessage: vi.fn(),
      showWarningMessage: vi.fn(),
      showErrorMessage: vi.fn(),
      showQuickPick: vi.fn(),
      createOutputChannel: vi.fn(() => ({
        appendLine: vi.fn(),
        clear: vi.fn(),
        show: vi.fn(),
        dispose: vi.fn(),
      })),
      registerWebviewViewProvider: vi.fn(() => ({ dispose: vi.fn() })),
      createTreeView: vi.fn(() => ({ dispose: vi.fn() })),
      activeTextEditor: undefined,
      createTerminal: vi.fn(() => ({ sendText: vi.fn(), show: vi.fn() })),
    },
    workspace: {
      registerTextDocumentContentProvider: vi.fn(() => ({
        provideTextDocumentContent: vi.fn(() => ""),
      })),
      getConfiguration: vi.fn(() => ({
        get: vi.fn((_key: string, defaultValue: unknown) => defaultValue),
        update: vi.fn(),
      })),
      onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
      workspaceFolders: [{ uri: { fsPath: "/test/project" } }],
      onDidChangeWorkspaceFolders: vi.fn(() => ({ dispose: vi.fn() })),
      createFileSystemWatcher: vi.fn(() => ({
        onDidChange: vi.fn(),
        onDidCreate: vi.fn(),
        onDidDelete: vi.fn(),
        dispose: vi.fn(),
      })),
      fs: { readFile: vi.fn() },
      openTextDocument: vi.fn(),
    },
    commands: {
      registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
      executeCommand: vi.fn(),
    },
  };
});

// Mock DanteCode packages
vi.mock("@dantecode/core", () => ({
  DEFAULT_MODEL_ID: "grok/grok-3",
  MODEL_CATALOG: [
    {
      id: "grok/grok-3",
      provider: "grok",
      modelId: "grok-3",
      label: "Grok 3",
      groupLabel: "xAI / Grok",
      supportTier: "tier1",
      defaultSelected: true,
    },
    {
      id: "anthropic/claude-sonnet-4-6",
      provider: "anthropic",
      modelId: "claude-sonnet-4-6",
      label: "Claude Sonnet 4.6",
      groupLabel: "Anthropic",
      supportTier: "tier1",
    },
    {
      id: "ollama/llama3.1:8b",
      provider: "ollama",
      modelId: "llama3.1:8b",
      label: "Llama 3.1 8B (local)",
      groupLabel: "Local (Ollama)",
      supportTier: "tier1",
    },
  ],
  getProviderCatalogEntry: vi.fn((providerId: string) => {
    const providers: Record<
      string,
      {
        id: string;
        label: string;
        docsUrl?: string;
        envVars: string[];
        requiresApiKey: boolean;
        supportTier: "tier1" | "advanced";
      }
    > = {
      grok: {
        id: "grok",
        label: "xAI / Grok",
        docsUrl: "https://console.x.ai/",
        envVars: ["XAI_API_KEY", "GROK_API_KEY"],
        requiresApiKey: true,
        supportTier: "tier1",
      },
      anthropic: {
        id: "anthropic",
        label: "Anthropic",
        docsUrl: "https://console.anthropic.com/",
        envVars: ["ANTHROPIC_API_KEY"],
        requiresApiKey: true,
        supportTier: "tier1",
      },
      openai: {
        id: "openai",
        label: "OpenAI",
        docsUrl: "https://platform.openai.com/api-keys",
        envVars: ["OPENAI_API_KEY"],
        requiresApiKey: true,
        supportTier: "tier1",
      },
      google: {
        id: "google",
        label: "Google AI",
        docsUrl: "https://aistudio.google.com/apikey",
        envVars: ["GOOGLE_API_KEY", "GEMINI_API_KEY"],
        requiresApiKey: true,
        supportTier: "tier1",
      },
      ollama: {
        id: "ollama",
        label: "Local (Ollama)",
        docsUrl: "https://ollama.com/",
        envVars: ["OLLAMA_BASE_URL"],
        requiresApiKey: false,
        supportTier: "tier1",
      },
    };
    return providers[providerId];
  }),
  groupCatalogModels: vi.fn((models: Array<{ groupLabel: string }>) => {
    const grouped = new Map<string, Array<{ groupLabel: string }>>();
    for (const model of models) {
      const existing = grouped.get(model.groupLabel) ?? [];
      existing.push(model);
      grouped.set(model.groupLabel, existing);
    }
    return Array.from(grouped.entries()).map(([groupLabel, groupedModels]) => ({
      groupLabel,
      models: groupedModels,
    }));
  }),
  readOrInitializeState: vi.fn().mockResolvedValue({
    autoforge: { gstackCommands: [] },
  }),
  initializeState: vi.fn().mockResolvedValue(undefined),
  appendAuditEvent: vi.fn().mockResolvedValue(undefined),
  ModelRouterImpl: vi.fn(),
  parseModelReference: vi.fn((model: string) => {
    const slashIndex = model.indexOf("/");
    if (slashIndex >= 0) {
      return {
        id: model,
        provider: model.slice(0, slashIndex),
        modelId: model.slice(slashIndex + 1),
      };
    }
    const provider = /^(llama|qwen|mistral)/i.test(model) ? "ollama" : "grok";
    return {
      id: `${provider}/${model}`,
      provider,
      modelId: model,
    };
  }),
  responseNeedsToolExecutionNudge: vi.fn((text: string) =>
    /\b(plan|will|executing plan|running:|created|updated|modified)\b/i.test(text),
  ),
}));

vi.mock("@dantecode/danteforge", () => ({
  runLocalPDSEScorer: vi.fn().mockReturnValue({
    overall: 85,
    completeness: 80,
    correctness: 90,
    clarity: 85,
    consistency: 85,
    violations: [],
    passedGate: true,
    scoredAt: "2026-03-15T10:00:00Z",
    scoredBy: "pdse-local",
  }),
  runGStack: vi.fn().mockResolvedValue([]),
  summarizeGStackResults: vi.fn().mockReturnValue("All passed"),
  allGStackPassed: vi.fn().mockReturnValue(true),
  queryLessons: vi.fn().mockResolvedValue([]),
  formatLessonsForPrompt: vi.fn().mockReturnValue(""),
}));

vi.mock("@dantecode/git-engine", () => ({
  generateRepoMap: vi.fn().mockReturnValue([]),
  generateColoredHunk: vi.fn().mockReturnValue({
    filePath: "test.ts",
    linesAdded: 1,
    linesRemoved: 0,
    lines: [{ type: "add", content: "new line", oldLineNo: null, newLineNo: 1 }],
    truncated: false,
    fullLineCount: 1,
  }),
}));

vi.mock("@dantecode/skill-adapter", () => ({
  importSkills: vi.fn().mockResolvedValue({
    imported: [],
    skipped: [],
    errors: [],
  }),
}));

// Mock node:fs/promises for executeTool integration tests
const mockReadFile = vi.fn();
const mockWriteFile = vi.fn();
const mockMkdir = vi.fn();
const mockReaddir = vi.fn();
const mockStat = vi.fn();
vi.mock("node:fs/promises", () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
  mkdir: (...args: unknown[]) => mockMkdir(...args),
  readdir: (...args: unknown[]) => mockReaddir(...args),
  stat: (...args: unknown[]) => mockStat(...args),
}));

// Mock node:fs (sync) for resolveShell in toolBash
vi.mock("node:fs", () => ({
  accessSync: vi.fn(),
}));

// Mock node:child_process for toolBash
const mockExecSync = vi.fn();
vi.mock("node:child_process", () => ({
  execSync: (...args: unknown[]) => mockExecSync(...args),
}));

const mockCreateCheckpoint = vi.fn().mockResolvedValue({
  id: "cp-1",
  label: "manual-checkpoint",
  strategy: "snapshot",
});
const mockListCheckpoints = vi.fn().mockReturnValue([
  {
    id: "cp-1",
    label: "manual-checkpoint",
    strategy: "snapshot",
    createdAt: "2026-03-17T00:00:00.000Z",
  },
]);
const mockRewindCheckpoint = vi.fn().mockResolvedValue({
  id: "cp-1",
  label: "manual-checkpoint",
  strategy: "snapshot",
});
const mockDiffReviewOpen = vi.fn().mockResolvedValue(undefined);
const mockDiffReviewCreate = vi.fn().mockResolvedValue({
  filePath: "/test/project/src/app.ts",
  relativePath: "src/app.ts",
  oldContent: "old code",
  newContent: "new code",
  beforeUri: { fsPath: "/tmp/before.ts" },
  afterUri: { fsPath: "/test/project/src/app.ts" },
  hunks: [
    {
      file: "src/app.ts",
      oldStart: 1,
      oldLines: 1,
      newStart: 1,
      newLines: 1,
      content: "@@ -1 +1 @@\n-old\n+new",
    },
  ],
});
const mockDiffReviewApply = vi.fn().mockResolvedValue(undefined);
const mockDiffReviewReject = vi.fn().mockResolvedValue(undefined);
const mockDiffReviewItems = vi
  .fn()
  .mockReturnValue([
    { index: 0, label: "Hunk 1", description: "src/app.ts:1", detail: "old | new" },
  ]);

vi.mock("./checkpoint-manager.js", () => ({
  CheckpointManager: vi.fn().mockImplementation(() => ({
    createCheckpoint: mockCreateCheckpoint,
    listCheckpoints: mockListCheckpoints,
    rewindCheckpoint: mockRewindCheckpoint,
  })),
}));

vi.mock("./diff-review-provider.js", () => ({
  DiffReviewProvider: vi.fn().mockImplementation(() => ({
    createReview: mockDiffReviewCreate,
    openReview: mockDiffReviewOpen,
    buildQuickPickItems: mockDiffReviewItems,
    applySelectedHunks: mockDiffReviewApply,
    rejectSelectedHunks: mockDiffReviewReject,
  })),
}));

import type { PDSEScore } from "@dantecode/config-types";
import { PDSEDiagnosticProvider } from "./diagnostics.js";
import {
  createStatusBar,
  updateStatusBar,
  updateSandboxStatus,
  updateStatusBarWithCost,
  type StatusBarState,
} from "./status-bar.js";
import {
  isSelfModificationTarget,
  isSelfModificationBashCommand,
  executeTool,
  type ToolExecutionContext,
} from "./agent-tools.js";
import { ChatSidebarProvider } from "./sidebar-provider.js";
import { AuditPanelProvider } from "./audit-panel-provider.js";
import { DanteCodeCompletionProvider } from "./inline-completion.js";
import { activate, deactivate, setPendingDiff } from "./extension.js";
import { generateColoredHunk } from "@dantecode/git-engine";
import * as vscode from "vscode";

// ---------------------------------------------------------------------------
// PDSEDiagnosticProvider Tests
// ---------------------------------------------------------------------------

describe("VS Code Extension", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStatusBarItem.text = "";
    mockStatusBarItem.tooltip = "";
    mockStatusBarItem.command = undefined;
    mockStatusBarItem.backgroundColor = undefined;
    mockStatusBarItem.color = undefined;
  });

  describe("PDSEDiagnosticProvider", () => {
    it("creates a diagnostic collection on construction", () => {
      new PDSEDiagnosticProvider();
      expect(vscode.languages.createDiagnosticCollection).toHaveBeenCalledWith("DanteCode PDSE");
    });

    it("maps hard violations to Error severity", () => {
      const provider = new PDSEDiagnosticProvider();
      const uri = vscode.Uri.file("/test.ts");
      const score: PDSEScore = {
        overall: 50,
        completeness: 50,
        correctness: 50,
        clarity: 50,
        consistency: 50,
        violations: [
          {
            type: "stub_detected",
            severity: "hard",
            file: "/test.ts",
            line: 10,
            message: "TODO marker found",
          },
        ],
        passedGate: false,
        scoredAt: "2026-03-15T10:00:00Z",
        scoredBy: "pdse-local",
      };

      provider.updateDiagnostics(uri as unknown as vscode.Uri, score);

      expect(mockCollectionSet).toHaveBeenCalledTimes(1);
      const diagnostics = mockCollectionSet.mock.calls[0]![1] as vscode.Diagnostic[];
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]!.severity).toBe(vscode.DiagnosticSeverity.Error);
    });

    it("maps soft violations to Warning severity", () => {
      const provider = new PDSEDiagnosticProvider();
      const uri = vscode.Uri.file("/test.ts");
      const score: PDSEScore = {
        overall: 70,
        completeness: 70,
        correctness: 70,
        clarity: 70,
        consistency: 70,
        violations: [
          {
            type: "missing_error_handling",
            severity: "soft",
            file: "/test.ts",
            line: 5,
            message: "Missing error handling",
          },
        ],
        passedGate: false,
        scoredAt: "2026-03-15T10:00:00Z",
        scoredBy: "pdse-local",
      };

      provider.updateDiagnostics(uri as unknown as vscode.Uri, score);

      const diagnostics = mockCollectionSet.mock.calls[0]![1] as vscode.Diagnostic[];
      expect(diagnostics[0]!.severity).toBe(vscode.DiagnosticSeverity.Warning);
    });

    it("uses correct violation labels for known types", () => {
      const provider = new PDSEDiagnosticProvider();
      const uri = vscode.Uri.file("/test.ts");
      const score: PDSEScore = {
        overall: 60,
        completeness: 60,
        correctness: 60,
        clarity: 60,
        consistency: 60,
        violations: [
          {
            type: "hardcoded_secret",
            severity: "hard",
            file: "/test.ts",
            line: 1,
            message: "Secret found",
          },
        ],
        passedGate: false,
        scoredAt: "2026-03-15T10:00:00Z",
        scoredBy: "pdse-local",
      };

      provider.updateDiagnostics(uri as unknown as vscode.Uri, score);

      const diagnostics = mockCollectionSet.mock.calls[0]![1] as vscode.Diagnostic[];
      expect(diagnostics[0]!.message).toContain("[Hardcoded Secret]");
      expect(diagnostics[0]!.message).toContain("Secret found");
    });

    it("falls back to type string for unknown violation types", () => {
      const provider = new PDSEDiagnosticProvider();
      const uri = vscode.Uri.file("/test.ts");
      const score: PDSEScore = {
        overall: 60,
        completeness: 60,
        correctness: 60,
        clarity: 60,
        consistency: 60,
        violations: [
          {
            type: "custom_unknown_type" as PDSEScore["violations"][0]["type"],
            severity: "soft",
            file: "/test.ts",
            line: 1,
            message: "Custom issue",
          },
        ],
        passedGate: false,
        scoredAt: "2026-03-15T10:00:00Z",
        scoredBy: "pdse-local",
      };

      provider.updateDiagnostics(uri as unknown as vscode.Uri, score);

      const diagnostics = mockCollectionSet.mock.calls[0]![1] as vscode.Diagnostic[];
      expect(diagnostics[0]!.message).toContain("[custom_unknown_type]");
    });

    it("converts 1-indexed line numbers to 0-indexed ranges", () => {
      const provider = new PDSEDiagnosticProvider();
      const uri = vscode.Uri.file("/test.ts");
      const score: PDSEScore = {
        overall: 60,
        completeness: 60,
        correctness: 60,
        clarity: 60,
        consistency: 60,
        violations: [
          {
            type: "stub_detected",
            severity: "hard",
            file: "/test.ts",
            line: 15,
            message: "Stub found",
          },
        ],
        passedGate: false,
        scoredAt: "2026-03-15T10:00:00Z",
        scoredBy: "pdse-local",
      };

      provider.updateDiagnostics(uri as unknown as vscode.Uri, score);

      const diagnostics = mockCollectionSet.mock.calls[0]![1] as vscode.Diagnostic[];
      expect(diagnostics[0]!.range.start.line).toBe(14); // 15 - 1
    });

    it("defaults to line 0 when no line number provided", () => {
      const provider = new PDSEDiagnosticProvider();
      const uri = vscode.Uri.file("/test.ts");
      const score: PDSEScore = {
        overall: 60,
        completeness: 60,
        correctness: 60,
        clarity: 60,
        consistency: 60,
        violations: [
          {
            type: "stub_detected",
            severity: "hard",
            file: "/test.ts",
            message: "Stub found",
          },
        ],
        passedGate: false,
        scoredAt: "2026-03-15T10:00:00Z",
        scoredBy: "pdse-local",
      };

      provider.updateDiagnostics(uri as unknown as vscode.Uri, score);

      const diagnostics = mockCollectionSet.mock.calls[0]![1] as vscode.Diagnostic[];
      expect(diagnostics[0]!.range.start.line).toBe(0);
    });

    it("includes PDSE overall score in diagnostic code", () => {
      const provider = new PDSEDiagnosticProvider();
      const uri = vscode.Uri.file("/test.ts");
      const score: PDSEScore = {
        overall: 42,
        completeness: 40,
        correctness: 40,
        clarity: 40,
        consistency: 40,
        violations: [
          {
            type: "stub_detected",
            severity: "hard",
            file: "/test.ts",
            line: 1,
            message: "Stub",
          },
        ],
        passedGate: false,
        scoredAt: "2026-03-15T10:00:00Z",
        scoredBy: "pdse-local",
      };

      provider.updateDiagnostics(uri as unknown as vscode.Uri, score);

      const diagnostics = mockCollectionSet.mock.calls[0]![1] as vscode.Diagnostic[];
      const code = diagnostics[0]!.code as { value: string };
      expect(code.value).toBe("PDSE 42");
    });

    it("includes related info when violation has a pattern", () => {
      const provider = new PDSEDiagnosticProvider();
      const uri = vscode.Uri.file("/test.ts");
      const score: PDSEScore = {
        overall: 50,
        completeness: 50,
        correctness: 50,
        clarity: 50,
        consistency: 50,
        violations: [
          {
            type: "stub_detected",
            severity: "hard",
            file: "/test.ts",
            line: 5,
            message: "TODO found",
            pattern: "\\bTODO\\b",
          },
        ],
        passedGate: false,
        scoredAt: "2026-03-15T10:00:00Z",
        scoredBy: "pdse-local",
      };

      provider.updateDiagnostics(uri as unknown as vscode.Uri, score);

      const diagnostics = mockCollectionSet.mock.calls[0]![1] as vscode.Diagnostic[];
      expect(diagnostics[0]!.relatedInformation).toHaveLength(1);
    });

    it("adds summary diagnostic when gate failed with no violations", () => {
      const provider = new PDSEDiagnosticProvider();
      const uri = vscode.Uri.file("/test.ts");
      const score: PDSEScore = {
        overall: 55,
        completeness: 55,
        correctness: 55,
        clarity: 55,
        consistency: 55,
        violations: [],
        passedGate: false,
        scoredAt: "2026-03-15T10:00:00Z",
        scoredBy: "pdse-local",
      };

      provider.updateDiagnostics(uri as unknown as vscode.Uri, score);

      const diagnostics = mockCollectionSet.mock.calls[0]![1] as vscode.Diagnostic[];
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]!.message).toContain("quality gate failed");
      expect(diagnostics[0]!.message).toContain("55");
      expect(diagnostics[0]!.severity).toBe(vscode.DiagnosticSeverity.Error);
    });

    it("adds pass diagnostic when gate passed with no violations", () => {
      const provider = new PDSEDiagnosticProvider();
      const uri = vscode.Uri.file("/test.ts");
      const score: PDSEScore = {
        overall: 95,
        completeness: 95,
        correctness: 95,
        clarity: 95,
        consistency: 95,
        violations: [],
        passedGate: true,
        scoredAt: "2026-03-15T10:00:00Z",
        scoredBy: "pdse-local",
      };

      provider.updateDiagnostics(uri as unknown as vscode.Uri, score);

      const diagnostics = mockCollectionSet.mock.calls[0]![1] as vscode.Diagnostic[];
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]!.message).toContain("quality gate passed");
      expect(diagnostics[0]!.severity).toBe(vscode.DiagnosticSeverity.Information);
    });

    it("handles multiple violations in one score", () => {
      const provider = new PDSEDiagnosticProvider();
      const uri = vscode.Uri.file("/test.ts");
      const score: PDSEScore = {
        overall: 40,
        completeness: 40,
        correctness: 40,
        clarity: 40,
        consistency: 40,
        violations: [
          {
            type: "stub_detected",
            severity: "hard",
            file: "/test.ts",
            line: 5,
            message: "TODO marker",
          },
          {
            type: "type_any",
            severity: "soft",
            file: "/test.ts",
            line: 10,
            message: "Type any usage",
          },
          {
            type: "console_log_leftover",
            severity: "soft",
            file: "/test.ts",
            line: 20,
            message: "Console log leftover",
          },
        ],
        passedGate: false,
        scoredAt: "2026-03-15T10:00:00Z",
        scoredBy: "pdse-local",
      };

      provider.updateDiagnostics(uri as unknown as vscode.Uri, score);

      const diagnostics = mockCollectionSet.mock.calls[0]![1] as vscode.Diagnostic[];
      expect(diagnostics).toHaveLength(3);
      expect(diagnostics[0]!.message).toContain("[Stub Detected]");
      expect(diagnostics[1]!.message).toContain("[Type 'any' Usage]");
      expect(diagnostics[2]!.message).toContain("[Console Log Leftover]");
    });

    it("clearDiagnostics deletes from collection", () => {
      const provider = new PDSEDiagnosticProvider();
      const uri = vscode.Uri.file("/test.ts");
      provider.clearDiagnostics(uri as unknown as vscode.Uri);
      expect(mockCollectionDelete).toHaveBeenCalledWith(uri);
    });

    it("clearAll clears the entire collection", () => {
      const provider = new PDSEDiagnosticProvider();
      provider.clearAll();
      expect(mockCollectionClear).toHaveBeenCalled();
    });

    it("dispose disposes the collection", () => {
      const provider = new PDSEDiagnosticProvider();
      provider.dispose();
      expect(mockCollectionDispose).toHaveBeenCalled();
    });

    it("sets diagnostic source to DanteCode PDSE", () => {
      const provider = new PDSEDiagnosticProvider();
      const uri = vscode.Uri.file("/test.ts");
      const score: PDSEScore = {
        overall: 50,
        completeness: 50,
        correctness: 50,
        clarity: 50,
        consistency: 50,
        violations: [
          {
            type: "stub_detected",
            severity: "hard",
            file: "/test.ts",
            line: 1,
            message: "Stub",
          },
        ],
        passedGate: false,
        scoredAt: "2026-03-15T10:00:00Z",
        scoredBy: "pdse-local",
      };

      provider.updateDiagnostics(uri as unknown as vscode.Uri, score);

      const diagnostics = mockCollectionSet.mock.calls[0]![1] as vscode.Diagnostic[];
      expect(diagnostics[0]!.source).toBe("DanteCode PDSE");
    });
  });

  // -------------------------------------------------------------------------
  // Status Bar Tests
  // -------------------------------------------------------------------------

  describe("Status Bar", () => {
    function createMockContext() {
      return {
        subscriptions: [] as { dispose: () => void }[],
        extensionUri: vscode.Uri.file("/test"),
        extensionPath: "/test",
      } as unknown as vscode.ExtensionContext;
    }

    it("createStatusBar returns a StatusBarState", () => {
      const context = createMockContext();
      const state = createStatusBar(context);

      expect(state.item).toBe(mockStatusBarItem);
      expect(state.gateStatus).toBe("none");
      expect(state.sandboxEnabled).toBe(false);
    });

    it("createStatusBar sets click command to switchModel", () => {
      const context = createMockContext();
      createStatusBar(context);

      expect(mockStatusBarItem.command).toBe("dantecode.switchModel");
    });

    it("createStatusBar shows the status bar item", () => {
      const context = createMockContext();
      createStatusBar(context);

      expect(mockStatusBarItem.show).toHaveBeenCalled();
    });

    it("createStatusBar registers disposables", () => {
      const context = createMockContext();
      createStatusBar(context);

      // item + configWatcher
      expect(context.subscriptions.length).toBeGreaterThanOrEqual(2);
    });

    it("updateStatusBar updates model and gate status", () => {
      const state: StatusBarState = {
        item: mockStatusBarItem as unknown as vscode.StatusBarItem,
        currentModel: "grok/grok-3",
        gateStatus: "none",
        sandboxEnabled: false,
        modelTier: "fast",
        sessionCostUsd: 0,
      };

      updateStatusBar(state, "anthropic/claude-sonnet-4", "passed");

      expect(state.currentModel).toBe("anthropic/claude-sonnet-4");
      expect(state.gateStatus).toBe("passed");
      // formatModelName("anthropic/claude-sonnet-4") → "claude-sonnet-4"
      expect(mockStatusBarItem.text).toContain("claude-sonnet-4");
      expect(mockStatusBarItem.text).toContain("DanteCode:");
    });

    it("updateStatusBar with passed status shows pass icon", () => {
      const state: StatusBarState = {
        item: mockStatusBarItem as unknown as vscode.StatusBarItem,
        currentModel: "grok/grok-3",
        gateStatus: "none",
        sandboxEnabled: false,
        modelTier: "fast",
        sessionCostUsd: 0,
      };

      updateStatusBar(state, "grok/grok-3", "passed");

      expect(mockStatusBarItem.text).toContain("$(pass-filled)");
    });

    it("updateStatusBar with failed status shows error icon", () => {
      const state: StatusBarState = {
        item: mockStatusBarItem as unknown as vscode.StatusBarItem,
        currentModel: "grok/grok-3",
        gateStatus: "none",
        sandboxEnabled: false,
        modelTier: "fast",
        sessionCostUsd: 0,
      };

      updateStatusBar(state, "grok/grok-3", "failed");

      expect(mockStatusBarItem.text).toContain("$(error)");
    });

    it("updateStatusBar with pending status shows loading icon", () => {
      const state: StatusBarState = {
        item: mockStatusBarItem as unknown as vscode.StatusBarItem,
        currentModel: "grok/grok-3",
        gateStatus: "none",
        sandboxEnabled: false,
        modelTier: "fast",
        sessionCostUsd: 0,
      };

      updateStatusBar(state, "grok/grok-3", "pending");

      expect(mockStatusBarItem.text).toContain("$(loading~spin)");
    });

    it("updateStatusBar with failed status sets error background", () => {
      const state: StatusBarState = {
        item: mockStatusBarItem as unknown as vscode.StatusBarItem,
        currentModel: "grok/grok-3",
        gateStatus: "none",
        sandboxEnabled: false,
        modelTier: "fast",
        sessionCostUsd: 0,
      };

      updateStatusBar(state, "grok/grok-3", "failed");

      expect(mockStatusBarItem.backgroundColor).toBeDefined();
      expect((mockStatusBarItem.backgroundColor as { id: string }).id).toBe(
        "statusBarItem.errorBackground",
      );
    });

    it("updateStatusBar with none status clears colors", () => {
      const state: StatusBarState = {
        item: mockStatusBarItem as unknown as vscode.StatusBarItem,
        currentModel: "grok/grok-3",
        gateStatus: "none",
        sandboxEnabled: false,
        modelTier: "fast",
        sessionCostUsd: 0,
      };

      updateStatusBar(state, "grok/grok-3", "none");

      expect(mockStatusBarItem.backgroundColor).toBeUndefined();
      expect(mockStatusBarItem.color).toBeUndefined();
    });

    it("updateSandboxStatus adds vm icon when enabled", () => {
      const state: StatusBarState = {
        item: mockStatusBarItem as unknown as vscode.StatusBarItem,
        currentModel: "grok/grok-3",
        gateStatus: "none",
        sandboxEnabled: false,
        modelTier: "fast",
        sessionCostUsd: 0,
      };

      updateSandboxStatus(state, true);

      expect(state.sandboxEnabled).toBe(true);
      expect(mockStatusBarItem.text).toContain("$(vm)");
    });

    it("updateSandboxStatus removes vm icon when disabled", () => {
      const state: StatusBarState = {
        item: mockStatusBarItem as unknown as vscode.StatusBarItem,
        currentModel: "grok/grok-3",
        gateStatus: "none",
        sandboxEnabled: true,
        modelTier: "fast",
        sessionCostUsd: 0,
      };

      updateSandboxStatus(state, false);

      expect(state.sandboxEnabled).toBe(false);
      expect(mockStatusBarItem.text).not.toContain("$(vm)");
    });

    it("tooltip includes model, gate status, and sandbox info", () => {
      const state: StatusBarState = {
        item: mockStatusBarItem as unknown as vscode.StatusBarItem,
        currentModel: "openai/gpt-4o",
        gateStatus: "none",
        sandboxEnabled: false,
        modelTier: "fast",
        sessionCostUsd: 0,
      };

      updateStatusBar(state, "openai/gpt-4o", "passed");

      expect(mockStatusBarItem.tooltip).toContain("Model: openai/gpt-4o");
      expect(mockStatusBarItem.tooltip).toContain("PDSE gate: PASSED");
      expect(mockStatusBarItem.tooltip).toContain("Click to switch model");
    });

    it("formats model name by extracting part after slash", () => {
      const state: StatusBarState = {
        item: mockStatusBarItem as unknown as vscode.StatusBarItem,
        currentModel: "google/gemini-2.5-pro",
        gateStatus: "none",
        sandboxEnabled: false,
        modelTier: "fast",
        sessionCostUsd: 0,
      };

      updateStatusBar(state, "google/gemini-2.5-pro", "none");

      expect(mockStatusBarItem.text).toContain("gemini-2.5-pro");
      expect(mockStatusBarItem.text).not.toContain("google/");
    });

    it("formats model name with no slash as-is", () => {
      const state: StatusBarState = {
        item: mockStatusBarItem as unknown as vscode.StatusBarItem,
        currentModel: "llama3",
        gateStatus: "none",
        sandboxEnabled: false,
        modelTier: "fast",
        sessionCostUsd: 0,
      };

      updateStatusBar(state, "llama3", "none");

      expect(mockStatusBarItem.text).toContain("llama3");
    });
  });

  // -------------------------------------------------------------------------
  // ChatSidebarProvider Tests
  // -------------------------------------------------------------------------

  describe("ChatSidebarProvider", () => {
    const mockSecrets = {
      get: vi.fn().mockResolvedValue(undefined),
      store: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      onDidChange: vi.fn(),
    } as unknown as vscode.SecretStorage;

    const mockGlobalState = {
      get: vi.fn().mockReturnValue([]),
      update: vi.fn().mockResolvedValue(undefined),
      keys: vi.fn().mockReturnValue([]),
      setKeysForSync: vi.fn(),
    } as unknown as vscode.Memento;

    it("has correct viewType", () => {
      expect(ChatSidebarProvider.viewType).toBe("dantecode.chatView");
    });

    it("constructs without throwing", () => {
      const uri = vscode.Uri.file("/test");
      expect(
        () => new ChatSidebarProvider(uri as unknown as vscode.Uri, mockSecrets, mockGlobalState),
      ).not.toThrow();
    });

    it("getCurrentModel returns default model from config", () => {
      const uri = vscode.Uri.file("/test");
      const provider = new ChatSidebarProvider(
        uri as unknown as vscode.Uri,
        mockSecrets,
        mockGlobalState,
      );
      // Default from mock: getConfiguration().get("defaultModel", "grok/grok-4-1-fast-non-reasoning") → returns the defaultValue
      expect(provider.getCurrentModel()).toBe("grok/grok-3");
    });

    it("addFileToContext does not throw", () => {
      const uri = vscode.Uri.file("/test");
      const provider = new ChatSidebarProvider(
        uri as unknown as vscode.Uri,
        mockSecrets,
        mockGlobalState,
      );
      expect(() => provider.addFileToContext("/some/file.ts")).not.toThrow();
    });

    it("sendPDSEScore does not throw when view is not set", () => {
      const uri = vscode.Uri.file("/test");
      const provider = new ChatSidebarProvider(
        uri as unknown as vscode.Uri,
        mockSecrets,
        mockGlobalState,
      );
      const score: PDSEScore = {
        overall: 90,
        completeness: 90,
        correctness: 90,
        clarity: 90,
        consistency: 90,
        violations: [],
        passedGate: true,
        scoredAt: "2026-03-15T10:00:00Z",
        scoredBy: "pdse-local",
      };
      expect(() => provider.sendPDSEScore(score)).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // AuditPanelProvider Tests
  // -------------------------------------------------------------------------

  describe("AuditPanelProvider", () => {
    it("has correct viewType", () => {
      expect(AuditPanelProvider.viewType).toBe("dantecode.auditView");
    });

    it("constructs without throwing", () => {
      const uri = vscode.Uri.file("/test");
      expect(() => new AuditPanelProvider(uri as unknown as vscode.Uri)).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // DanteCodeCompletionProvider Tests
  // -------------------------------------------------------------------------

  describe("DanteCodeCompletionProvider", () => {
    it("constructs without throwing", () => {
      expect(() => new DanteCodeCompletionProvider()).not.toThrow();
    });

    it("clearCache does not throw", () => {
      const provider = new DanteCodeCompletionProvider();
      expect(() => provider.clearCache()).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // Extension Lifecycle Tests
  // -------------------------------------------------------------------------

  describe("Extension lifecycle", () => {
    function createMockContext() {
      return {
        subscriptions: [] as { dispose: () => void }[],
        extensionUri: vscode.Uri.file("/test"),
        extensionPath: "/test",
        secrets: {
          get: vi.fn().mockResolvedValue(undefined),
          store: vi.fn().mockResolvedValue(undefined),
        },
        globalState: {
          get: vi.fn().mockReturnValue(true),
          update: vi.fn().mockResolvedValue(undefined),
        },
      } as unknown as vscode.ExtensionContext;
    }

    it("activate registers all 19 commands", () => {
      const context = createMockContext();
      activate(context);

      expect(vscode.commands.registerCommand).toHaveBeenCalledTimes(19);
    });

    it("activate registers webview view providers", () => {
      const context = createMockContext();
      activate(context);

      expect(vscode.window.registerWebviewViewProvider).toHaveBeenCalledTimes(2);
    });

    it("activate registers inline completion provider", () => {
      const context = createMockContext();
      activate(context);

      expect(vscode.languages.registerInlineCompletionItemProvider).toHaveBeenCalledTimes(1);
    });

    it("activate creates status bar", () => {
      const context = createMockContext();
      activate(context);

      expect(vscode.window.createStatusBarItem).toHaveBeenCalled();
    });

    it("activate creates output channel", () => {
      const context = createMockContext();
      activate(context);

      expect(vscode.window.createOutputChannel).toHaveBeenCalledWith("DanteCode");
    });

    it("activate pushes disposables to context.subscriptions", () => {
      const context = createMockContext();
      activate(context);

      // At minimum: 2 webview providers + inline completion + status bar item
      // + config watcher + diagnostics + 11 commands + output channel
      expect(context.subscriptions.length).toBeGreaterThanOrEqual(10);
    });

    it("deactivate does not throw", () => {
      const context = createMockContext();
      activate(context);
      expect(() => deactivate()).not.toThrow();
    });

    it("deactivate clears diagnostic provider", () => {
      const context = createMockContext();
      activate(context);
      deactivate();

      // clearAll should have been called during deactivation
      expect(mockCollectionClear).toHaveBeenCalled();
    });

    it("registers dantecode.openChat command", () => {
      const context = createMockContext();
      activate(context);

      const callArgs = (vscode.commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
      const commandIds = callArgs.map((c: unknown[]) => c[0]);
      expect(commandIds).toContain("dantecode.openChat");
    });

    it("registers dantecode.switchModel command", () => {
      const context = createMockContext();
      activate(context);

      const callArgs = (vscode.commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
      const commandIds = callArgs.map((c: unknown[]) => c[0]);
      expect(commandIds).toContain("dantecode.switchModel");
    });

    it("registers dantecode.runPDSE command", () => {
      const context = createMockContext();
      activate(context);

      const callArgs = (vscode.commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
      const commandIds = callArgs.map((c: unknown[]) => c[0]);
      expect(commandIds).toContain("dantecode.runPDSE");
    });

    it("registers checkpoint commands", () => {
      const context = createMockContext();
      activate(context);

      const callArgs = (vscode.commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
      const commandIds = callArgs.map((c: unknown[]) => c[0]);
      expect(commandIds).toContain("dantecode.createCheckpoint");
      expect(commandIds).toContain("dantecode.listCheckpoints");
      expect(commandIds).toContain("dantecode.rewindCheckpoint");
    });

    it("registers diff review commands", () => {
      const context = createMockContext();
      activate(context);

      const callArgs = (vscode.commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
      const commandIds = callArgs.map((c: unknown[]) => c[0]);
      expect(commandIds).toContain("dantecode.reviewDiff");
      expect(commandIds).toContain("dantecode.acceptDiffHunks");
      expect(commandIds).toContain("dantecode.rejectDiffHunks");
    });

    it("manual create checkpoint command delegates to the checkpoint manager", async () => {
      const context = createMockContext();
      activate(context);

      const callArgs = (vscode.commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
      const handler = callArgs.find(
        (c: unknown[]) => c[0] === "dantecode.createCheckpoint",
      )?.[1] as (() => Promise<void>) | undefined;

      await handler?.();

      expect(mockCreateCheckpoint).toHaveBeenCalled();
      expect(vscode.window.showInformationMessage).toHaveBeenCalled();
    });

    it("rewind checkpoint command restores the selected checkpoint", async () => {
      (vscode.window.showQuickPick as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        label: "manual-checkpoint",
        description: "cp-1",
      });

      const context = createMockContext();
      activate(context);

      const callArgs = (vscode.commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
      const handler = callArgs.find(
        (c: unknown[]) => c[0] === "dantecode.rewindCheckpoint",
      )?.[1] as (() => Promise<void>) | undefined;

      await handler?.();

      expect(mockListCheckpoints).toHaveBeenCalled();
      expect(mockRewindCheckpoint).toHaveBeenCalledWith("cp-1");
    });

    it("setPendingDiff auto-creates a checkpoint before storing the diff", async () => {
      const context = createMockContext();
      activate(context);

      setPendingDiff("/test/project/src/app.ts", "old code", "new code");
      await Promise.resolve();

      expect(mockCreateCheckpoint).toHaveBeenCalledWith(
        expect.objectContaining({
          fileSnapshots: [{ filePath: "/test/project/src/app.ts", content: "old code" }],
        }),
      );
    });

    it("accept diff hunks delegates to the diff review provider", async () => {
      (vscode.window.showQuickPick as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { index: 0, label: "Hunk 1", description: "src/app.ts:1" },
      ]);

      const context = createMockContext();
      activate(context);
      setPendingDiff("/test/project/src/app.ts", "old code", "new code");

      const callArgs = (vscode.commands.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
      const handler = callArgs.find((c: unknown[]) => c[0] === "dantecode.acceptDiffHunks")?.[1] as
        | (() => Promise<void>)
        | undefined;

      await handler?.();

      expect(mockDiffReviewCreate).toHaveBeenCalled();
      expect(mockDiffReviewOpen).toHaveBeenCalled();
      expect(mockDiffReviewApply).toHaveBeenCalledWith(
        expect.objectContaining({ filePath: "/test/project/src/app.ts" }),
        [0],
      );
    });
  });
});

// ---------------------------------------------------------------------------
// Shared mock context for Blade v1.2 tests
// ---------------------------------------------------------------------------

const mockExtensionContext = {
  subscriptions: [] as { dispose: () => void }[],
  extensionUri: vscode.Uri.file("/test"),
  extensionPath: "/test",
} as unknown as vscode.ExtensionContext;

// ---------------------------------------------------------------------------
// Blade v1.2 — isSelfModificationTarget tests (D5)
// ---------------------------------------------------------------------------

describe("isSelfModificationTarget", () => {
  const projectRoot = "/projects/dantecode";

  it("returns true for packages/vscode path", () => {
    expect(isSelfModificationTarget("packages/vscode/src/sidebar-provider.ts", projectRoot)).toBe(
      true,
    );
  });

  it("returns true for packages/cli path", () => {
    expect(isSelfModificationTarget("packages/cli/src/agent-loop.ts", projectRoot)).toBe(true);
  });

  it("returns true for packages/danteforge path", () => {
    expect(isSelfModificationTarget("packages/danteforge/src/autoforge.ts", projectRoot)).toBe(
      true,
    );
  });

  it("returns true for packages/core path", () => {
    expect(isSelfModificationTarget("packages/core/src/model-router.ts", projectRoot)).toBe(true);
  });

  it("returns true for .dantecode directory", () => {
    expect(isSelfModificationTarget(".dantecode/STATE.yaml", projectRoot)).toBe(true);
  });

  it("returns true for CONSTITUTION.md", () => {
    expect(isSelfModificationTarget("CONSTITUTION.md", projectRoot)).toBe(true);
  });

  it("returns false for user project files", () => {
    expect(isSelfModificationTarget("src/app.ts", projectRoot)).toBe(false);
  });

  it("returns false for packages/sandbox path", () => {
    expect(isSelfModificationTarget("packages/sandbox/src/runner.ts", projectRoot)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Blade v1.2 — isSelfModificationBashCommand tests (D5)
// ---------------------------------------------------------------------------

describe("isSelfModificationBashCommand", () => {
  it("catches echo redirect to cli source", () => {
    expect(isSelfModificationBashCommand('echo "code" > packages/cli/src/index.ts')).toBe(true);
  });

  it("catches tee to packages", () => {
    expect(isSelfModificationBashCommand("cat file | tee packages/core/src/router.ts")).toBe(true);
  });

  it("catches redirect to .dantecode", () => {
    expect(isSelfModificationBashCommand('echo "data" > .dantecode/STATE.yaml')).toBe(true);
  });

  it("catches redirect to CONSTITUTION.md", () => {
    expect(isSelfModificationBashCommand('echo "x" > CONSTITUTION.md')).toBe(true);
  });

  it("returns false for safe commands", () => {
    expect(isSelfModificationBashCommand("npm test")).toBe(false);
    expect(isSelfModificationBashCommand("echo hello")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Blade v1.2 — Status bar cost display tests (D6)
// ---------------------------------------------------------------------------

describe("updateStatusBarWithCost", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStatusBarItem.text = "";
    mockStatusBarItem.tooltip = "";
    mockStatusBarItem.command = undefined;
    mockStatusBarItem.backgroundColor = undefined;
    mockStatusBarItem.color = undefined;
    (mockExtensionContext as unknown as { subscriptions: vscode.Disposable[] }).subscriptions = [];
  });

  it("displays cost in status bar text", () => {
    const state = createStatusBar(mockExtensionContext);
    updateStatusBarWithCost(state, "fast", 0.014);
    expect(state.item.text).toContain("$0.014");
  });

  it("displays capable tier label when escalated", () => {
    const state = createStatusBar(mockExtensionContext);
    updateStatusBarWithCost(state, "capable", 0.5);
    expect(state.item.text).toContain("[capable]");
  });

  it("includes tier info in tooltip", () => {
    const state = createStatusBar(mockExtensionContext);
    updateStatusBarWithCost(state, "fast", 0.001);
    expect(state.item.tooltip).toContain("Tier: fast");
  });
});

// ---------------------------------------------------------------------------
// executeTool integration tests (Blade v1.2)
// ---------------------------------------------------------------------------

describe("executeTool integration", () => {
  function makeContext(overrides: Partial<ToolExecutionContext> = {}): ToolExecutionContext {
    return {
      projectRoot: "/proj",
      silentMode: false,
      currentModelId: "grok/grok-4-1-fast-non-reasoning",
      roundId: "round-001",
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockReadFile.mockReset();
    mockWriteFile.mockReset();
    mockMkdir.mockReset();
    mockReaddir.mockReset();
    mockStat.mockReset();
    mockExecSync.mockReset();
  });

  it("blocks Write to self-owned path without confirmation", async () => {
    const onSelfModificationAttempt = vi.fn();
    const context = makeContext({ onSelfModificationAttempt });

    const result = await executeTool(
      "Write",
      { file_path: "packages/vscode/src/test.ts", content: "x" },
      "/proj",
      context,
    );

    expect(result.isError).toBe(true);
    expect(result.content).toContain("Self-modification blocked");
    expect(onSelfModificationAttempt).toHaveBeenCalledWith("packages/vscode/src/test.ts");
  });

  it("allows Write to self-owned path when confirmation returns true", async () => {
    const onSelfModificationAttempt = vi.fn();
    const awaitSelfModConfirmation = vi.fn().mockResolvedValue(true);
    const context = makeContext({
      onSelfModificationAttempt,
      awaitSelfModConfirmation,
    });

    // Mock fs: readFile returns null on first call (file doesn't exist),
    // then returns new content for diff generation
    mockReadFile
      .mockRejectedValueOnce(new Error("ENOENT")) // old content check (inside toolWrite)
      .mockResolvedValueOnce("x"); // new content read for diff hunk
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);

    const result = await executeTool(
      "Write",
      { file_path: "packages/vscode/src/test.ts", content: "x" },
      "/proj",
      context,
    );

    expect(result.isError).toBe(false);
    expect(result.content).toContain("Created");
    expect(awaitSelfModConfirmation).toHaveBeenCalled();
  });

  it("blocks Bash with self-modification pattern", async () => {
    const context = makeContext();

    const result = await executeTool(
      "Bash",
      { command: 'echo "x" > packages/cli/src/index.ts' },
      "/proj",
      context,
    );

    expect(result.isError).toBe(true);
    expect(result.content).toContain("Self-modification blocked");
    expect(mockExecSync).not.toHaveBeenCalled();
  });

  it("allows safe Bash commands", async () => {
    const context = makeContext();
    mockExecSync.mockReturnValue("file1.ts\nfile2.ts\n");

    const result = await executeTool("Bash", { command: "ls" }, "/proj", context);

    expect(result.isError).toBe(false);
    expect(result.content).toContain("file1.ts");
    expect(mockExecSync).toHaveBeenCalled();
  });

  it("calls onDiffHunk after successful Write", async () => {
    const onDiffHunk = vi.fn();
    const context = makeContext({ onDiffHunk });

    // File does not target self-owned paths, so no self-mod guard
    // First readFile: old content capture for diff (before write)
    // Second readFile: inside toolWrite to check if file existed
    // Third readFile: new content read for diff hunk (after write)
    mockReadFile
      .mockRejectedValueOnce(new Error("ENOENT")) // D3: old content capture (file doesn't exist)
      .mockRejectedValueOnce(new Error("ENOENT")) // toolWrite: existed check
      .mockResolvedValueOnce("hello world"); // D3: new content read for diff
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);

    const result = await executeTool(
      "Write",
      { file_path: "src/app.ts", content: "hello world" },
      "/proj",
      context,
    );

    expect(result.isError).toBe(false);
    expect(generateColoredHunk).toHaveBeenCalledWith("", "hello world", "src/app.ts");
    expect(onDiffHunk).toHaveBeenCalledTimes(1);
    expect(onDiffHunk).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: "src/app.ts",
        newContent: "hello world",
        oldContent: "",
        hunk: expect.objectContaining({ filePath: "test.ts", linesAdded: 1 }),
      }),
    );
  });

  it("calls onDiffHunk after successful Edit", async () => {
    const onDiffHunk = vi.fn();
    const context = makeContext({ onDiffHunk });

    const oldContent = 'const x = "old";';
    const newContent = 'const x = "new";';

    // readFile calls:
    // 1. D3: old content capture for diff (before dispatch)
    // 2. toolEdit: read existing content for replacement
    // 3. D3: new content read for diff (after dispatch)
    mockReadFile
      .mockResolvedValueOnce(oldContent) // D3: old content capture
      .mockResolvedValueOnce(oldContent) // toolEdit: read existing
      .mockResolvedValueOnce(newContent); // D3: new content for diff
    mockWriteFile.mockResolvedValue(undefined);

    const result = await executeTool(
      "Edit",
      { file_path: "src/app.ts", old_string: '"old"', new_string: '"new"' },
      "/proj",
      context,
    );

    expect(result.isError).toBe(false);
    expect(result.content).toContain("Successfully edited");
    expect(generateColoredHunk).toHaveBeenCalledWith(oldContent, newContent, "src/app.ts");
    expect(onDiffHunk).toHaveBeenCalledTimes(1);
  });

  it("works without context (backward compatible)", async () => {
    mockReadFile.mockResolvedValue("line1\nline2\nline3\n");

    const result = await executeTool("Read", { file_path: "test.txt" }, "/proj");

    expect(result.isError).toBe(false);
    expect(result.content).toContain("line1");
    expect(result.content).toContain("line2");
  });
});
