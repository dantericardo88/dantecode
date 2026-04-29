// ============================================================================
// packages/vscode/src/lsp-context-provider.ts
//
// Four VSCode-LSP-backed @mention context providers:
//   @hover      — type signature + docs at cursor position
//   @definition — source of symbol at cursor (±20 lines around definition)
//   @references — all usage sites of symbol at cursor (capped at 20)
//   @symbol     — workspace-wide symbol search by name
//
// All providers are backed by vscode.commands.executeCommand with the
// standard LSP command IDs that every language server populates.
// All calls are wrapped in try/catch — if the language server is not ready
// or the command fails, providers return a graceful informational message.
// ============================================================================

import * as vscode from "vscode";
import type { ContextProvider, ContextItem, ContextItemType } from "./context-provider.js";

// ── LRU Cache ─────────────────────────────────────────────────────────────────

/** Simple LRU cache backed by a Map (insertion-order = LRU). No external deps. */
class LRUCache<K, V> {
  private readonly _max: number;
  private readonly _map = new Map<K, V>();

  constructor(max: number) {
    this._max = max;
  }

  get(key: K): V | undefined {
    if (!this._map.has(key)) return undefined;
    const val = this._map.get(key)!;
    this._map.delete(key);
    this._map.set(key, val);
    return val;
  }

  set(key: K, val: V): void {
    if (this._map.has(key)) this._map.delete(key);
    else if (this._map.size >= this._max) {
      const firstKey = this._map.keys().next().value;
      if (firstKey !== undefined) this._map.delete(firstKey);
    }
    this._map.set(key, val);
  }

  clear(): void {
    this._map.clear();
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Flatten a Hover's contents into a plain text string.
 * Each `vscode.Hover` has `.contents: (string | vscode.MarkdownString)[]`.
 */
export function flattenHoverContents(hovers: vscode.Hover[]): string {
  return hovers
    .flatMap((h) =>
      h.contents.map((c) => (typeof c === "string" ? c : c.value)),
    )
    .filter((s) => s.trim().length > 0)
    .join("\n\n");
}

/**
 * Resolve the target URI from a Location or LocationLink (union returned by
 * executeDefinitionProvider).
 */
function resolveLocationUri(
  loc: vscode.Location | vscode.LocationLink,
): vscode.Uri {
  return "targetUri" in loc ? loc.targetUri : loc.uri;
}

/**
 * Resolve the target range from a Location or LocationLink.
 */
function resolveLocationRange(
  loc: vscode.Location | vscode.LocationLink,
): vscode.Range {
  return "targetRange" in loc ? loc.targetRange : loc.range;
}

/**
 * Extract ±contextLines lines around a given line number from a TextDocument.
 */
export function extractDocumentContext(
  doc: vscode.TextDocument,
  line: number,
  contextLines = 20,
): string {
  const start = Math.max(0, line - contextLines);
  const end = Math.min(doc.lineCount - 1, line + contextLines);
  const extracted: string[] = [];
  for (let i = start; i <= end; i++) {
    extracted.push(doc.lineAt(i).text);
  }
  return extracted.join("\n");
}

// ── @hover ────────────────────────────────────────────────────────────────────

export const HOVER_PROVIDER: ContextProvider = {
  name: "hover",
  trigger: "@hover",
  description: "Type signature and documentation at cursor position",

  async resolve(_query: string, _workspace: string): Promise<ContextItem[]> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return [{ type: "hover" as ContextItemType, label: "@hover", content: "(no active editor)" }];
    }

    try {
      const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
        "vscode.executeHoverProvider",
        editor.document.uri,
        editor.selection.active,
      );

      if (!hovers?.length) {
        return [{
          type: "hover" as ContextItemType,
          label: "@hover",
          content: "(no hover information at cursor — move cursor onto a symbol)",
        }];
      }

      const content = flattenHoverContents(hovers).slice(0, 2000);
      if (!content.trim()) {
        return [{ type: "hover" as ContextItemType, label: "@hover", content: "(hover returned empty content)" }];
      }

      return [{ type: "hover" as ContextItemType, label: "@hover", content }];
    } catch {
      return [{
        type: "hover" as ContextItemType,
        label: "@hover",
        content: "(hover unavailable — language server may not be ready)",
      }];
    }
  },
};

// ── @definition ───────────────────────────────────────────────────────────────

export const DEFINITION_PROVIDER: ContextProvider = {
  name: "definition",
  trigger: "@definition",
  description: "Source definition of symbol at cursor position",

  async resolve(_query: string, _workspace: string): Promise<ContextItem[]> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return [{ type: "definition" as ContextItemType, label: "@definition", content: "(no active editor)" }];
    }

    try {
      const locations = await vscode.commands.executeCommand<
        Array<vscode.Location | vscode.LocationLink>
      >(
        "vscode.executeDefinitionProvider",
        editor.document.uri,
        editor.selection.active,
      );

      if (!locations?.length) {
        return [{
          type: "definition" as ContextItemType,
          label: "@definition",
          content: "(no definition found — move cursor onto a symbol)",
        }];
      }

      const loc = locations[0]!;
      const uri = resolveLocationUri(loc);
      const range = resolveLocationRange(loc);

      const doc = await vscode.workspace.openTextDocument(uri);
      const context = extractDocumentContext(doc, range.start.line, 20);
      const relPath = vscode.workspace.asRelativePath(uri);

      return [{
        type: "definition" as ContextItemType,
        label: `@definition:${relPath}:${range.start.line + 1}`,
        content: `\`\`\`\n// ${relPath}:${range.start.line + 1}\n${context}\n\`\`\``,
        uri: uri.fsPath,
      }];
    } catch {
      return [{
        type: "definition" as ContextItemType,
        label: "@definition",
        content: "(definition unavailable — language server may not be ready)",
      }];
    }
  },
};

// ── @references ───────────────────────────────────────────────────────────────

const KEYWORD_SET = new Set([
  "true", "false", "null", "undefined", "void", "any", "never", "unknown",
  "string", "number", "boolean", "object", "symbol", "this", "super",
  "return", "const", "let", "var", "function", "class", "interface", "type",
  "import", "export", "default", "from", "if", "else", "for", "while", "do",
]);

export const REFERENCES_PROVIDER: ContextProvider = {
  name: "references",
  trigger: "@references",
  description: "All usage sites of the symbol at cursor position",

  async resolve(_query: string, _workspace: string): Promise<ContextItem[]> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return [{ type: "references" as ContextItemType, label: "@references", content: "(no active editor)" }];
    }

    // Guard against common keywords / short tokens — would return too many results
    const wordRange = editor.document.getWordRangeAtPosition(editor.selection.active);
    const word = wordRange ? editor.document.getText(wordRange) : "";
    if (word.length < 3 || KEYWORD_SET.has(word)) {
      return [{
        type: "references" as ContextItemType,
        label: "@references",
        content: `(cursor is on "${word}" — move onto a meaningful symbol name)`,
      }];
    }

    try {
      const refs = await vscode.commands.executeCommand<vscode.Location[]>(
        "vscode.executeReferenceProvider",
        editor.document.uri,
        editor.selection.active,
      );

      if (!refs?.length) {
        return [{
          type: "references" as ContextItemType,
          label: "@references",
          content: `(no references found for "${word}")`,
        }];
      }

      const capped = refs.slice(0, 20);
      const lines = capped.map((loc) => {
        const rel = vscode.workspace.asRelativePath(loc.uri);
        return `${rel}:${loc.range.start.line + 1}`;
      });

      const header = `${word} — ${refs.length} reference${refs.length !== 1 ? "s" : ""}${refs.length > 20 ? " (showing first 20)" : ""}`;
      const content = `${header}\n\n${lines.join("\n")}`.slice(0, 2000);

      return [{ type: "references" as ContextItemType, label: `@references:${word}`, content }];
    } catch {
      return [{
        type: "references" as ContextItemType,
        label: "@references",
        content: "(references unavailable — language server may not be ready)",
      }];
    }
  },
};

// ── @symbol ───────────────────────────────────────────────────────────────────

export const SYMBOL_PROVIDER: ContextProvider = {
  name: "symbol",
  trigger: "@symbol",
  description: "Workspace-wide symbol search by name",

  async resolve(query: string, _workspace: string): Promise<ContextItem[]> {
    if (!query.trim()) {
      return [{
        type: "symbol" as ContextItemType,
        label: "@symbol",
        content: "(provide a symbol name, e.g. @symbol:UserAuthService)",
      }];
    }

    try {
      const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
        "vscode.executeWorkspaceSymbolProvider",
        query,
      );

      if (!symbols?.length) {
        return [{
          type: "symbol" as ContextItemType,
          label: `@symbol:${query}`,
          content: `(no symbols found matching "${query}")`,
        }];
      }

      const top10 = symbols.slice(0, 10);
      const lines = top10.map((sym) => {
        const rel = vscode.workspace.asRelativePath(sym.location.uri);
        const kind = vscode.SymbolKind[sym.kind] ?? "Symbol";
        const line = sym.location.range.start.line + 1;
        return `${kind} ${sym.name} — ${rel}:${line}`;
      });

      const header = `Symbols matching "${query}" (${symbols.length} total${symbols.length > 10 ? ", showing top 10" : ""}):`;
      return [{
        type: "symbol" as ContextItemType,
        label: `@symbol:${query}`,
        content: `${header}\n\n${lines.join("\n")}`,
      }];
    } catch {
      return [{
        type: "symbol" as ContextItemType,
        label: `@symbol:${query}`,
        content: "(workspace symbol search unavailable — language server may not be ready)",
      }];
    }
  },
};

// ─── Type Definition + Signature Help (Machine 3) ────────────────────────────

/**
 * executeTypeDefinitionProvider: resolves the type definition location(s) for
 * the symbol at the given position. Returns [] on failure or null result.
 */
export async function executeTypeDefinitionProvider(
  doc: vscode.TextDocument,
  position: vscode.Position,
): Promise<Array<vscode.Location | vscode.LocationLink>> {
  try {
    const locs = await vscode.commands.executeCommand<Array<vscode.Location | vscode.LocationLink>>(
      "vscode.executeTypeDefinitionProvider",
      doc.uri,
      position,
    );
    return locs ?? [];
  } catch {
    return [];
  }
}

/**
 * executeSignatureHelpProvider: returns signature help (parameter hints) for
 * the given position and trigger character.
 */
export async function executeSignatureHelpProvider(
  doc: vscode.TextDocument,
  position: vscode.Position,
  triggerChar = "(",
): Promise<vscode.SignatureHelp | null> {
  try {
    const help = await vscode.commands.executeCommand<vscode.SignatureHelp>(
      "vscode.executeSignatureHelpProvider",
      doc.uri,
      position,
      triggerChar,
    );
    return help ?? null;
  } catch {
    return null;
  }
}

// Module-level LRU cache for crawlTypes results (max 64 entries)
const _crawlCache = new LRUCache<string, string>(64);

/** Clear the crawlTypes cache — exported for test isolation. */
export function clearCrawlCache(): void {
  _crawlCache.clear();
}

/**
 * crawlTypes: recursively traverse type definitions starting from the symbol
 * at (doc, position), up to maxDepth hops. LRU-cached.
 *
 * Algorithm:
 * 1. executeTypeDefinitionProvider at current position → get type definition locations
 * 2. For each location (cap 3), open the target document, extract ±10 lines of context
 * 3. Recurse into the definition site (depth-1), deduplicating by file:line
 * Returns a formatted string of all type snippets (capped at 4000 chars).
 */
export async function crawlTypes(
  doc: vscode.TextDocument,
  position: vscode.Position,
  maxDepth = 3,
): Promise<string> {
  const cacheKey = `${doc.uri.fsPath}:${position.line}:${position.character}:${maxDepth}`;
  const cached = _crawlCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const visited = new Set<string>();
  const snippets: string[] = [];

  async function crawl(
    innerDoc: vscode.TextDocument,
    innerPos: vscode.Position,
    depth: number,
  ): Promise<void> {
    if (depth <= 0) return;
    const locs = await executeTypeDefinitionProvider(innerDoc, innerPos);
    for (const loc of locs.slice(0, 3)) {
      const uri = resolveLocationUri(loc);
      const range = resolveLocationRange(loc);
      const key = `${uri.fsPath}:${range.start.line}`;
      if (visited.has(key)) continue;
      visited.add(key);
      try {
        const targetDoc = await vscode.workspace.openTextDocument(uri);
        const snippet = extractDocumentContext(targetDoc, range.start.line, 10);
        const relPath = vscode.workspace.asRelativePath(uri);
        snippets.push(`// ${relPath}:${range.start.line + 1}\n${snippet}`);
        await crawl(targetDoc, new vscode.Position(range.start.line, 0), depth - 1);
      } catch {
        // Ignore unresolvable locations
      }
    }
  }

  await crawl(doc, position, maxDepth);
  const result = snippets.join("\n\n---\n\n").slice(0, 4000);
  _crawlCache.set(cacheKey, result);
  return result;
}

// ── @types ────────────────────────────────────────────────────────────────────

export const TYPES_PROVIDER: ContextProvider = {
  name: "types",
  trigger: "@types",
  description: "Recursive type definition chain at cursor position",

  async resolve(_query: string, _workspace: string): Promise<ContextItem[]> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return [{
        type: "definition" as ContextItemType,
        label: "@types",
        content: "(no active editor)",
      }];
    }
    try {
      const result = await crawlTypes(editor.document, editor.selection.active, 3);
      if (!result.trim()) {
        return [{
          type: "definition" as ContextItemType,
          label: "@types",
          content: "(no type definitions found at cursor)",
        }];
      }
      return [{
        type: "definition" as ContextItemType,
        label: "@types",
        content: "```typescript\n" + result + "\n```",
      }];
    } catch {
      return [{
        type: "definition" as ContextItemType,
        label: "@types",
        content: "(type crawl failed)",
      }];
    }
  },
};
