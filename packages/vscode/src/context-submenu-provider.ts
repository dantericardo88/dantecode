// ============================================================================
// packages/vscode/src/context-submenu-provider.ts
//
// Continue.dev-style context provider protocol for DanteCode.
// Implements the IContextProvider interface with submenu providers for
// @file: (file picker) and @code: (symbol picker).
// ============================================================================

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { execSync } from "node:child_process";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ContextProviderDescription {
  title: string;
  displayTitle: string;
  description: string;
  type: "normal" | "submenu";
}

export interface ContextSubmenuItem {
  id: string;
  title: string;
  description?: string;
}

export interface IContextProvider {
  readonly description: ContextProviderDescription;
  getContextItems(query: string, projectRoot: string): Promise<Array<{ label: string; content: string }>>;
  loadSubmenuItems?(projectRoot: string): Promise<ContextSubmenuItem[]>;
}

// ── File walker utility ───────────────────────────────────────────────────────

const SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".next", "build", "coverage", "__pycache__"]);

function walkFiles(dir: string, depth: number, maxFiles: number, acc: string[]): void {
  if (depth <= 0 || acc.length >= maxFiles) return;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (acc.length >= maxFiles) break;
    if (entry.startsWith(".") && entry !== ".env.example") continue;
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    try {
      const st = statSync(full);
      if (st.isDirectory()) {
        walkFiles(full, depth - 1, maxFiles, acc);
      } else if (st.isFile()) {
        acc.push(full);
      }
    } catch {
      // Ignore unreadable entries
    }
  }
}

// ── FileSubmenuProvider ───────────────────────────────────────────────────────

export class FileSubmenuProvider implements IContextProvider {
  readonly description: ContextProviderDescription = {
    title: "file",
    displayTitle: "File",
    description: "Inject a file's contents into context",
    type: "submenu",
  };

  async loadSubmenuItems(projectRoot: string): Promise<ContextSubmenuItem[]> {
    if (!projectRoot) return [];
    const files: string[] = [];
    walkFiles(projectRoot, 3, 200, files);
    return files.map((f) => {
      const rel = relative(projectRoot, f);
      return {
        id: rel,
        title: rel,
        description: extname(f).slice(1) || "file",
      };
    });
  }

  async getContextItems(query: string, projectRoot: string): Promise<Array<{ label: string; content: string }>> {
    if (!query) return [{ label: "@file", content: "No file path provided." }];
    const abs = query.startsWith("/") || /^[A-Za-z]:/.test(query) ? query : join(projectRoot, query);
    try {
      const content = readFileSync(abs, "utf-8");
      return [{ label: `@file:${query}`, content: `\`\`\`\n// ${query}\n${content}\n\`\`\`` }];
    } catch {
      return [{ label: `@file:${query}`, content: `Could not read file: ${query}` }];
    }
  }
}

// ── CodeSubmenuProvider ───────────────────────────────────────────────────────

export class CodeSubmenuProvider implements IContextProvider {
  readonly description: ContextProviderDescription = {
    title: "code",
    displayTitle: "Code",
    description: "Find and inject a symbol definition",
    type: "submenu",
  };

  async loadSubmenuItems(projectRoot: string): Promise<ContextSubmenuItem[]> {
    if (!projectRoot) return [];
    try {
      const raw = execSync(
        `grep -rn --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" -E "^export (function|class|const|type|interface|enum) [A-Za-z_][A-Za-z0-9_]*" "${projectRoot}"`,
        { encoding: "utf-8", timeout: 5000, maxBuffer: 1024 * 512 },
      );
      const items: ContextSubmenuItem[] = [];
      for (const line of raw.split("\n").slice(0, 200)) {
        const m = line.match(/^(.+):(\d+):export\s+(?:function|class|const|type|interface|enum)\s+([A-Za-z_][A-Za-z0-9_]*)/);
        if (!m) continue;
        const [, filePath, lineNo, symbolName] = m;
        const rel = relative(projectRoot, filePath!);
        items.push({ id: `${symbolName}:${rel}`, title: symbolName!, description: `${rel}:${lineNo}` });
      }
      return items;
    } catch {
      return [];
    }
  }

  async getContextItems(query: string, projectRoot: string): Promise<Array<{ label: string; content: string }>> {
    if (!query) return [{ label: "@code", content: "No symbol provided." }];
    // query may be "SymbolName:src/file.ts" or just "SymbolName"
    const [symbolName, filePath] = query.split(":");
    if (!symbolName) return [{ label: `@code:${query}`, content: `Invalid query: ${query}` }];
    try {
      const searchTarget = filePath ? join(projectRoot, filePath) : projectRoot;
      const raw = execSync(
        `grep -n "${symbolName}" "${searchTarget}"`,
        { encoding: "utf-8", timeout: 3000, maxBuffer: 1024 * 256 },
      );
      const lines = raw.split("\n").slice(0, 30).join("\n");
      return [{ label: `@code:${symbolName}`, content: `\`\`\`\n// ${symbolName} — matches in ${filePath ?? "project"}\n${lines}\n\`\`\`` }];
    } catch {
      return [{ label: `@code:${symbolName}`, content: `Symbol not found: ${symbolName}` }];
    }
  }
}

// ── Exports ───────────────────────────────────────────────────────────────────

export const SUBMENU_PROVIDERS: IContextProvider[] = [
  new FileSubmenuProvider(),
  new CodeSubmenuProvider(),
];
