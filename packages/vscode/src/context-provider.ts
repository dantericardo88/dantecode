// ============================================================================
// packages/vscode/src/context-provider.ts
//
// @-mention context provider registry for DanteCode chat.
// Built-in providers: @file, @code, @git (pure Node.js — no VS Code dep).
// VS Code-specific providers (@terminal, @problems, @selection) are
// registered from extension.ts during activation.
// ============================================================================

import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, isAbsolute, resolve as pathResolve } from "node:path";

// ── Types ──────────────────────────────────────────────────────────────────

export type ContextItemType =
  | "file"
  | "code"
  | "git"
  | "terminal"
  | "problems"
  | "selection"
  | "codebase"
  | "tree"
  | "recent"
  | "diff"
  | "os"
  | "http";

export interface ContextItem {
  type: ContextItemType;
  /** Display label shown as a pill in the UI, e.g. "@file:src/app.ts" */
  label: string;
  /** Content injected into the system prompt */
  content: string;
  /** Optional file URI (absolute path) */
  uri?: string;
}

export interface ContextProvider {
  name: string;       // "file", "code", "git", …
  trigger: string;    // "@file", "@code", …
  description: string;
  resolve(query: string, workspace: string): Promise<ContextItem[]>;
}

// ── Mention parsing ─────────────────────────────────────────────────────────

/**
 * Regex that matches @-mentions in chat input.
 * Supports: @file:path, @code:symbol, @git, @git:log,
 *           @terminal, @problems, @selection
 */
const MENTION_RE = /(@(?:file|code|git|terminal|problems|selection|codebase|debug|docs|web|tree|recent|diff|os|http)(?::[^\s]+)?)/g;

/**
 * Extracts all @-mentions from the given text.
 * Returns an array of { trigger, query } pairs.
 * trigger = "@file", query = "src/app.ts"
 */
export function parseAllMentions(
  text: string,
): Array<{ trigger: string; query: string }> {
  const results: Array<{ trigger: string; query: string }> = [];
  MENTION_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MENTION_RE.exec(text)) !== null) {
    const full = match[1]!;
    const colonIdx = full.indexOf(":");
    if (colonIdx === -1) {
      results.push({ trigger: full, query: "" });
    } else {
      results.push({ trigger: full.slice(0, colonIdx), query: full.slice(colonIdx + 1) });
    }
  }
  return results;
}

// ── Formatting ──────────────────────────────────────────────────────────────

/**
 * Formats resolved context items into a single markdown block
 * suitable for injection as an additional system message.
 */
export function formatForPrompt(items: ContextItem[]): string {
  if (items.length === 0) return "";
  const sections = items.map((item) => `### ${item.label}\n${item.content}`);
  return `## Context\n\n${sections.join("\n\n")}`;
}

// ── Timeout helper ──────────────────────────────────────────────────────────

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("context-provider timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err as Error);
      },
    );
  });
}

// ── Path resolution ─────────────────────────────────────────────────────────

function resolveFilePath(query: string, workspace: string): string {
  if (isAbsolute(query)) return query;
  return pathResolve(join(workspace, query));
}

// ── Built-in: @file ─────────────────────────────────────────────────────────

export const FILE_PROVIDER: ContextProvider = {
  name: "file",
  trigger: "@file",
  description: "Inject a file's contents into context",

  async resolve(query: string, workspace: string): Promise<ContextItem[]> {
    if (!query) return [];
    const filePath = resolveFilePath(query, workspace);
    try {
      const content = readFileSync(filePath, "utf-8");
      return [
        {
          type: "file",
          label: `@file:${query}`,
          content: `\`\`\`\n${content}\n\`\`\``,
          uri: filePath,
        },
      ];
    } catch {
      return [
        {
          type: "file",
          label: `@file:${query}`,
          content: `(File not found: ${query})`,
        },
      ];
    }
  },
};

// ── Built-in: @code ─────────────────────────────────────────────────────────

export const CODE_PROVIDER: ContextProvider = {
  name: "code",
  trigger: "@code",
  description: "Inject a symbol (function/class) definition into context",

  async resolve(query: string, workspace: string): Promise<ContextItem[]> {
    if (!query) return [];
    try {
      // Grep for the symbol declaration across TypeScript, JavaScript, Python
      const pattern = `(export )?(function|class|const|interface|type|def) ${query}`;
      const output = execSync(
        `grep -rn --include="*.ts" --include="*.js" --include="*.py" -A 20 "${pattern}" .`,
        {
          cwd: workspace,
          encoding: "utf-8",
          timeout: 5_000,
          stdio: ["ignore", "pipe", "ignore"],
        },
      );
      const truncated = output.slice(0, 2000);
      return [
        {
          type: "code",
          label: `@code:${query}`,
          content: `\`\`\`\n${truncated || "(no results)"}\n\`\`\``,
        },
      ];
    } catch {
      return [
        {
          type: "code",
          label: `@code:${query}`,
          content: `(Symbol not found: ${query})`,
        },
      ];
    }
  },
};

// ── Built-in: @git ───────────────────────────────────────────────────────────

export const GIT_PROVIDER: ContextProvider = {
  name: "git",
  trigger: "@git",
  description: "Inject recent git diff (default) or git log into context",

  async resolve(query: string, workspace: string): Promise<ContextItem[]> {
    const subCommand = query || "diff";
    try {
      let output: string;
      if (subCommand === "log") {
        output = execSync("git log --oneline -10", {
          cwd: workspace,
          encoding: "utf-8",
          timeout: 10_000,
          stdio: ["ignore", "pipe", "ignore"],
        });
      } else {
        output = execSync("git diff HEAD", {
          cwd: workspace,
          encoding: "utf-8",
          timeout: 10_000,
          stdio: ["ignore", "pipe", "ignore"],
        });
      }
      const truncated = output.slice(0, 3000);
      return [
        {
          type: "git",
          label: `@git${query ? `:${query}` : ""}`,
          content: `\`\`\`diff\n${truncated || "(no changes)"}\n\`\`\``,
        },
      ];
    } catch {
      return [
        {
          type: "git",
          label: "@git",
          content: "(git not available in this workspace)",
        },
      ];
    }
  },
};

// ── Built-in: @tree ─────────────────────────────────────────────────────────

export const TREE_PROVIDER: ContextProvider = {
  name: "tree",
  trigger: "@tree",
  description: "Inject a directory listing into context",

  async resolve(_query: string, workspace: string): Promise<ContextItem[]> {
    try {
      const { readdirSync } = await import("node:fs");
      const entries = readdirSync(workspace, { withFileTypes: true });
      const listing = entries
        .slice(0, 50)
        .map((e) => `${e.isDirectory() ? "d" : "-"} ${e.name}`)
        .join("\n");
      return [{ type: "tree", label: "@tree", content: listing || "." }];
    } catch {
      return [{ type: "tree", label: "@tree", content: "." }];
    }
  },
};

// ── Built-in: @recent ────────────────────────────────────────────────────────

export const RECENT_PROVIDER: ContextProvider = {
  name: "recent",
  trigger: "@recent",
  description: "Files recently changed in git",

  async resolve(_query: string, workspace: string): Promise<ContextItem[]> {
    try {
      const output = execSync("git log --since=1.week.ago --name-only --format= --diff-filter=ACMR", {
        cwd: workspace,
        encoding: "utf-8",
        timeout: 5_000,
        stdio: ["ignore", "pipe", "ignore"],
      });
      return [{ type: "recent", label: "@recent", content: output.trim() || "(no recent files)" }];
    } catch {
      return [{ type: "recent", label: "@recent", content: "(git not available)" }];
    }
  },
};

// ── Built-in: @diff ─────────────────────────────────────────────────────────

export const DIFF_PROVIDER: ContextProvider = {
  name: "diff",
  trigger: "@diff",
  description: "Current git diff",

  async resolve(_query: string, workspace: string): Promise<ContextItem[]> {
    try {
      const output = execSync("git diff", {
        cwd: workspace,
        encoding: "utf-8",
        timeout: 5_000,
        stdio: ["ignore", "pipe", "ignore"],
      });
      return [{ type: "diff", label: "@diff", content: output.trim() || "(no uncommitted changes)" }];
    } catch {
      return [{ type: "diff", label: "@diff", content: "(git not available)" }];
    }
  },
};

// ── Built-in: @os ────────────────────────────────────────────────────────────

export const OS_PROVIDER: ContextProvider = {
  name: "os",
  trigger: "@os",
  description: "Operating system information",

  async resolve(_query: string, _workspace: string): Promise<ContextItem[]> {
    const content = [
      `platform: ${process.platform}`,
      `arch: ${process.arch}`,
      `node: ${process.version}`,
    ].join("\n");
    return [{ type: "os", label: "@os", content }];
  },
};

// ── Built-in: @http ──────────────────────────────────────────────────────────

export const HTTP_PROVIDER: ContextProvider = {
  name: "http",
  trigger: "@http",
  description: "Fetch content from an https:// URL",

  async resolve(query: string, _workspace: string): Promise<ContextItem[]> {
    if (!query || !query.startsWith("https://")) {
      return [{ type: "http", label: "@http", content: `Provide an https:// URL. Example: @http:https://example.com` }];
    }
    try {
      const resp = await fetch(query);
      const text = await resp.text();
      return [{ type: "http", label: `@http:${query}`, content: text.slice(0, 3000) }];
    } catch (err) {
      return [{ type: "http", label: `@http:${query}`, content: `Error fetching ${query}: ${String(err)}` }];
    }
  },
};

// ── Registry ─────────────────────────────────────────────────────────────────

/**
 * Registry for all context providers.
 * Pre-registers the three built-in pure providers.
 * VS Code-specific providers (terminal, problems, selection) are
 * registered from extension.ts after the extension host is ready.
 */
export class ContextProviderRegistry {
  private readonly providers = new Map<string, ContextProvider>();

  constructor() {
    this.register(FILE_PROVIDER);
    this.register(CODE_PROVIDER);
    this.register(GIT_PROVIDER);
    this.register(TREE_PROVIDER);
    this.register(RECENT_PROVIDER);
    this.register(DIFF_PROVIDER);
    this.register(OS_PROVIDER);
    this.register(HTTP_PROVIDER);
  }

  register(provider: ContextProvider): void {
    this.providers.set(provider.trigger, provider);
  }

  listProviders(): ContextProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * Resolves a single mention string (e.g. "@file:src/app.ts") to a
   * ContextItem, or null if no provider matches.
   */
  async resolve(mention: string, workspace: string): Promise<ContextItem | null> {
    const colonIdx = mention.indexOf(":");
    const trigger = colonIdx === -1 ? mention : mention.slice(0, colonIdx);
    const query = colonIdx === -1 ? "" : mention.slice(colonIdx + 1);
    const provider = this.providers.get(trigger);
    if (!provider) return null;
    const items = await provider.resolve(query, workspace);
    return items[0] ?? null;
  }

  /**
   * Parses all @-mentions from text and resolves each with its provider.
   * Provider calls time out after 2 s to avoid blocking the UI thread.
   */
  async resolveAllMentions(text: string, workspace: string): Promise<ContextItem[]> {
    const mentions = parseAllMentions(text);
    const results: ContextItem[] = [];

    for (const { trigger, query } of mentions) {
      const provider = this.providers.get(trigger);
      if (!provider) continue;
      try {
        const items = await withTimeout(provider.resolve(query, workspace), 2_000);
        results.push(...items);
      } catch {
        // Timeout or error — skip silently, don't block the chat request
      }
    }

    return results;
  }
}

/** Singleton registry used by the extension host. */
export const globalContextRegistry = new ContextProviderRegistry();

// ── Codebase index manager accessor ─────────────────────────────────────────
// Extension.ts injects the manager after activation via setCodebaseIndexManager().
// Using a module-level variable + setter avoids circular imports: context-provider.ts
// has no direct knowledge of CodebaseIndexManager's concrete type.

let _codebaseIndexManager: { search(q: string, limit?: number): Promise<unknown[]> } | null =
  null;

export function setCodebaseIndexManager(
  mgr: { search(q: string, limit?: number): Promise<unknown[]> } | null,
): void {
  _codebaseIndexManager = mgr;
}

export function getCodebaseIndexManager(): {
  search(q: string, limit?: number): Promise<unknown[]>;
} | null {
  return _codebaseIndexManager;
}
