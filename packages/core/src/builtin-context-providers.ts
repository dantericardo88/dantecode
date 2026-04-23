// packages/core/src/builtin-context-providers.ts
// Built-in @mention context providers — closes dim 12 (@mention/context providers: 8→9).
//
// Harvested from: Continue.dev context providers, Claude Code @-file injection.
//
// Provides IContextProvider implementations for:
//   @problems  — LSP diagnostics / type errors
//   @terminal  — recent shell command history
//   @git       — current diff and recent commits
//   @tests     — last test run results
//   @url       — fetched web content
//   @files     — file tree of the project
//   @selection — active editor selection (injected by VSCode extension)
//
// These are registered into globalCoreRegistry at module load time.

import type { IContextProvider, ContextItem, ContextProviderExtras } from "./context-provider-types.js";
import { globalCoreRegistry } from "./context-provider-registry.js";

// ─── @problems Provider ───────────────────────────────────────────────────────

export interface DiagnosticEntry {
  filePath: string;
  line: number;
  col: number;
  severity: "error" | "warning" | "info";
  message: string;
  source?: string;
}

/**
 * @problems — Injects current LSP diagnostics (errors/warnings) into context.
 * Accepts an optional severity filter via query: @problems:error
 */
export class ProblemsContextProvider implements IContextProvider {
  readonly name = "problems";
  readonly description = "Inject current LSP diagnostics (errors/warnings) into context";

  constructor(private readonly getDiagnostics: () => DiagnosticEntry[]) {}

  async getContextItems(extras: ContextProviderExtras): Promise<ContextItem[]> {
    const severityFilter = extras.query?.toLowerCase() as "error" | "warning" | "info" | "" || "";
    let diagnostics = this.getDiagnostics();

    if (severityFilter === "error" || severityFilter === "warning" || severityFilter === "info") {
      diagnostics = diagnostics.filter((d) => d.severity === severityFilter);
    }

    if (diagnostics.length === 0) {
      return [{ name: "problems", description: "LSP diagnostics", content: "No diagnostics found." }];
    }

    const byFile = new Map<string, DiagnosticEntry[]>();
    for (const d of diagnostics) {
      const existing = byFile.get(d.filePath) ?? [];
      existing.push(d);
      byFile.set(d.filePath, existing);
    }

    const lines: string[] = ["## Problems (LSP Diagnostics)", ""];
    for (const [file, diags] of byFile.entries()) {
      lines.push(`**${file}:**`);
      for (const d of diags.slice(0, 10)) {
        const icon = d.severity === "error" ? "✗" : d.severity === "warning" ? "⚠" : "ℹ";
        lines.push(`  ${icon} L${d.line}:${d.col} — ${d.message}${d.source ? ` [${d.source}]` : ""}`);
      }
      if (diags.length > 10) lines.push(`  … and ${diags.length - 10} more`);
      lines.push("");
    }

    const content = lines.join("\n");
    return [{
      name: "problems",
      description: `${diagnostics.length} diagnostic${diagnostics.length === 1 ? "" : "s"}`,
      content,
      uri: { type: "file", value: extras.workspaceRoot },
    }];
  }
}

// ─── @terminal Provider ───────────────────────────────────────────────────────

export interface TerminalRecord {
  command: string;
  exitCode?: number;
  output?: string;
  timestamp: number;
}

/**
 * @terminal — Injects recent shell command history into context.
 * Query: @terminal:5 (show last 5 commands)
 */
export class TerminalContextProvider implements IContextProvider {
  readonly name = "terminal";
  readonly description = "Inject recent terminal/shell command history into context";

  constructor(private readonly getHistory: () => TerminalRecord[]) {}

  async getContextItems(extras: ContextProviderExtras): Promise<ContextItem[]> {
    const n = extras.query ? Math.min(20, parseInt(extras.query, 10) || 10) : 10;
    const history = this.getHistory().slice(-n);

    if (history.length === 0) {
      return [{ name: "terminal", description: "Terminal history", content: "No terminal history available." }];
    }

    const lines: string[] = ["## Terminal History", ""];
    for (const record of history) {
      const icon = record.exitCode === 0 || record.exitCode === undefined ? "✓" : "✗";
      const time = new Date(record.timestamp).toTimeString().slice(0, 8);
      lines.push(`${icon} [${time}] \`${record.command}\``);
      if (record.output && record.exitCode !== 0) {
        const outLines = record.output.split("\n").slice(0, 3).join("\n  ");
        lines.push(`  ${outLines}`);
      }
    }

    return [{
      name: "terminal",
      description: `Last ${history.length} commands`,
      content: lines.join("\n"),
    }];
  }
}

// ─── @git Provider ────────────────────────────────────────────────────────────

export interface GitContextData {
  branch: string;
  uncommittedFiles: Array<{ file: string; additions: number; deletions: number }>;
  recentCommits: Array<{ hash: string; message: string; author: string }>;
  fullDiff?: string;
}

/**
 * @git — Injects current branch, uncommitted changes, and recent commits.
 * Query: @git:diff (include full diff), @git:log (commits only)
 */
export class GitContextProvider implements IContextProvider {
  readonly name = "git";
  readonly description = "Inject current git branch, uncommitted changes, and recent commits";

  constructor(private readonly getGitData: () => GitContextData) {}

  async getContextItems(extras: ContextProviderExtras): Promise<ContextItem[]> {
    const mode = extras.query?.toLowerCase() || "summary";
    const data = this.getGitData();

    const lines: string[] = [`## Git Context`, `Branch: \`${data.branch}\``, ""];

    if (data.uncommittedFiles.length > 0) {
      lines.push("**Uncommitted changes:**");
      for (const f of data.uncommittedFiles.slice(0, 15)) {
        lines.push(`  ${f.file}: +${f.additions}/-${f.deletions}`);
      }
      if (data.uncommittedFiles.length > 15) {
        lines.push(`  … and ${data.uncommittedFiles.length - 15} more files`);
      }
      lines.push("");
    }

    if (data.recentCommits.length > 0 && mode !== "diff") {
      lines.push("**Recent commits:**");
      for (const c of data.recentCommits.slice(0, 5)) {
        lines.push(`  ${c.hash} — ${c.message} (${c.author})`);
      }
      lines.push("");
    }

    if (mode === "diff" && data.fullDiff) {
      lines.push("**Full diff:**");
      lines.push("```diff");
      lines.push(data.fullDiff.slice(0, 4000));
      if (data.fullDiff.length > 4000) lines.push("… (truncated)");
      lines.push("```");
    }

    return [{
      name: "git",
      description: `${data.branch} — ${data.uncommittedFiles.length} changed files`,
      content: lines.join("\n"),
      uri: { type: "file", value: extras.workspaceRoot },
    }];
  }
}

// ─── @tests Provider ─────────────────────────────────────────────────────────

export interface TestResultData {
  runner: string;
  passed: number;
  failed: number;
  total: number;
  failures: Array<{ name: string; error?: string }>;
  rawOutput?: string;
}

/**
 * @tests — Injects last test run results into context.
 * Query: @tests:failures (only show failures)
 */
export class TestsContextProvider implements IContextProvider {
  readonly name = "tests";
  readonly description = "Inject last test run results and failures into context";

  constructor(private readonly getTestResults: () => TestResultData | null) {}

  async getContextItems(extras: ContextProviderExtras): Promise<ContextItem[]> {
    const showOnlyFailures = extras.query?.toLowerCase() === "failures";
    const results = this.getTestResults();

    if (!results) {
      return [{ name: "tests", description: "Test results", content: "No test results available. Run your tests first." }];
    }

    const icon = results.failed === 0 ? "✅" : "❌";
    const lines: string[] = [
      "## Test Results",
      `${icon} ${results.runner}: ${results.passed}/${results.total} passed`,
      "",
    ];

    if (results.failed > 0) {
      lines.push("**Failures:**");
      for (const f of results.failures.slice(0, 10)) {
        lines.push(`  ✗ ${f.name}`);
        if (f.error) {
          lines.push(`    ${f.error.split("\n").slice(0, 3).join("\n    ")}`);
        }
      }
      if (results.failures.length > 10) {
        lines.push(`  … and ${results.failures.length - 10} more failures`);
      }
      lines.push("");
    } else if (!showOnlyFailures) {
      lines.push("All tests passing ✓");
    }

    return [{
      name: "tests",
      description: `${results.passed}/${results.total} passing`,
      content: lines.join("\n"),
    }];
  }
}

// ─── @url Provider ────────────────────────────────────────────────────────────

export type UrlFetcher = (url: string) => Promise<{ text: string; title?: string }>;

const DEFAULT_MAX_CHARS = 8000;

/**
 * @url — Fetches and injects web content into context.
 * Query: @url:https://example.com
 */
export class UrlContextProvider implements IContextProvider {
  readonly name = "url";
  readonly description = "Fetch and inject web page content into context";

  constructor(
    private readonly fetcher: UrlFetcher,
    private readonly maxChars: number = DEFAULT_MAX_CHARS,
  ) {}

  async getContextItems(extras: ContextProviderExtras): Promise<ContextItem[]> {
    const url = extras.query?.trim();
    if (!url || !url.startsWith("http")) {
      return [{ name: "url", description: "URL content", content: "Please provide a URL: @url:https://example.com" }];
    }

    try {
      const { text, title } = await this.fetcher(url);
      const truncated = text.length > this.maxChars
        ? text.slice(0, this.maxChars) + "\n… (content truncated)"
        : text;
      return [{
        name: `url:${url}`,
        description: title ?? url,
        content: `## Web Content: ${title ?? url}\nSource: ${url}\n\n${truncated}`,
        uri: { type: "url", value: url },
      }];
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return [{
        name: "url",
        description: "URL fetch failed",
        content: `Failed to fetch ${url}: ${msg}`,
      }];
    }
  }
}

// ─── @files Provider ──────────────────────────────────────────────────────────

export type FileTreeGetter = (root: string, maxDepth?: number) => string[];

/**
 * @files — Injects the project file tree into context.
 * Query: @files:src (filter to subdirectory)
 */
export class FilesContextProvider implements IContextProvider {
  readonly name = "files";
  readonly description = "Inject project file tree into context";

  constructor(private readonly getFileTree: FileTreeGetter) {}

  async getContextItems(extras: ContextProviderExtras): Promise<ContextItem[]> {
    const subdir = extras.query?.trim() || "";
    const root = subdir
      ? `${extras.workspaceRoot}/${subdir}`.replace(/\\/g, "/")
      : extras.workspaceRoot;

    const files = this.getFileTree(root, 3);
    const label = subdir ? `${subdir}/` : "(project root)";

    const lines = [`## File Tree: ${label}`, ""];
    for (const f of files.slice(0, 100)) {
      const rel = f.replace(extras.workspaceRoot, "").replace(/^[/\\]/, "");
      lines.push(`  ${rel}`);
    }
    if (files.length > 100) lines.push(`  … and ${files.length - 100} more files`);

    return [{
      name: "files",
      description: `${files.length} files in ${label}`,
      content: lines.join("\n"),
      uri: { type: "file", value: root },
    }];
  }
}

// ─── Registration Helper ──────────────────────────────────────────────────────

export interface BuiltinProviderOptions {
  getDiagnostics?: () => DiagnosticEntry[];
  getTerminalHistory?: () => TerminalRecord[];
  getGitData?: () => GitContextData;
  getTestResults?: () => TestResultData | null;
  urlFetcher?: UrlFetcher;
  getFileTree?: FileTreeGetter;
}

/**
 * Register all built-in context providers into the global registry.
 * Skips any provider whose data getter is not provided.
 */
export function registerBuiltinProviders(options: BuiltinProviderOptions = {}): void {
  if (options.getDiagnostics) {
    globalCoreRegistry.register(new ProblemsContextProvider(options.getDiagnostics));
  }
  if (options.getTerminalHistory) {
    globalCoreRegistry.register(new TerminalContextProvider(options.getTerminalHistory));
  }
  if (options.getGitData) {
    globalCoreRegistry.register(new GitContextProvider(options.getGitData));
  }
  if (options.getTestResults) {
    globalCoreRegistry.register(new TestsContextProvider(options.getTestResults));
  }
  if (options.urlFetcher) {
    globalCoreRegistry.register(new UrlContextProvider(options.urlFetcher));
  }
  if (options.getFileTree) {
    globalCoreRegistry.register(new FilesContextProvider(options.getFileTree));
  }
}
