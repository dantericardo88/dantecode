// ============================================================================
// packages/codebase-index/src/symbol-extractor.ts
// Multi-language symbol extraction via line-anchored regex patterns.
// Supports: TypeScript, JavaScript, Python, Go, Rust.
//
// Harvest: Aider repomap.py (symbol pattern approach) + Tabby language detection.
// Upgrade: extractSymbolsAsync() uses tree-sitter AST for supported languages,
//          falling back to regex for unsupported or when AST returns nothing.
// ============================================================================

import { extname } from "node:path";
import type { Language, SymbolMatch } from "./types.js";
import {
  extractTagsAST,
  detectTreeSitterLanguage,
} from "@dantecode/core";

// ── Language detection ────────────────────────────────────────────────────────

const EXT_TO_LANG: Record<string, Language> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".pyi": "python",
  ".go": "go",
  ".rs": "rust",
};

export function detectLanguage(filePath: string): Language {
  const ext = extname(filePath).toLowerCase();
  return EXT_TO_LANG[ext] ?? "unknown";
}

// ── Pattern definitions ───────────────────────────────────────────────────────

interface SymbolPattern {
  kind: string;
  re: RegExp;
}

/**
 * Line-anchored regex patterns per language.
 * All patterns use `^` (line start, via `m` flag) to avoid matching symbols
 * inside string literals or comments.
 */
const PATTERNS: Record<Exclude<Language, "unknown">, SymbolPattern[]> = {
  typescript: [
    { kind: "function", re: /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+(\w+)/gm },
    { kind: "class",    re: /^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+(\w+)/gm },
    { kind: "arrow",    re: /^(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|_?\w+)(?:\s*:[^=]{0,50})?\s*=>/gm },
    { kind: "interface",re: /^(?:export\s+)?interface\s+(\w+)/gm },
    { kind: "type",     re: /^(?:export\s+)?type\s+(\w+)\s*[=<]/gm },
    { kind: "enum",     re: /^(?:export\s+)?(?:const\s+)?enum\s+(\w+)/gm },
  ],
  javascript: [
    { kind: "function", re: /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+(\w+)/gm },
    { kind: "class",    re: /^(?:export\s+)?(?:default\s+)?class\s+(\w+)/gm },
    { kind: "arrow",    re: /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|_?\w+)\s*=>/gm },
  ],
  python: [
    { kind: "function", re: /^(?:async\s+)?def\s+(\w+)/gm },
    { kind: "class",    re: /^class\s+(\w+)/gm },
  ],
  go: [
    { kind: "function", re: /^func\s+(?:\([^)]+\)\s+)?(\w+)/gm },
    { kind: "type",     re: /^type\s+(\w+)\s+(?:struct|interface)/gm },
    { kind: "const",    re: /^const\s+(\w+)\s+=/gm },
    { kind: "var",      re: /^var\s+(\w+)\s+/gm },
  ],
  rust: [
    { kind: "function", re: /^(?:pub(?:\s*\([^)]*\))?\s+)?(?:async\s+)?fn\s+(\w+)/gm },
    { kind: "struct",   re: /^(?:pub(?:\s*\([^)]*\))?\s+)?struct\s+(\w+)/gm },
    { kind: "trait",    re: /^(?:pub(?:\s*\([^)]*\))?\s+)?trait\s+(\w+)/gm },
    { kind: "enum",     re: /^(?:pub(?:\s*\([^)]*\))?\s+)?enum\s+(\w+)/gm },
    { kind: "impl",     re: /^impl(?:<[^>]+>)?\s+(?:\w+\s+for\s+)?(\w+)/gm },
    { kind: "type",     re: /^(?:pub(?:\s*\([^)]*\))?\s+)?type\s+(\w+)/gm },
  ],
};

// ── Extraction ────────────────────────────────────────────────────────────────

/**
 * Extract symbol definitions from source code.
 *
 * @param content  - Source code text
 * @param language - Language (use detectLanguage() from file path)
 * @returns Array of matched symbols with name, kind, line number, and signature
 */
export function extractSymbols(content: string, language: Language): SymbolMatch[] {
  if (language === "unknown") return [];

  const patterns = PATTERNS[language];
  const lines = content.split("\n");
  const symbols: SymbolMatch[] = [];
  const seen = new Set<string>();

  for (const { kind, re } of patterns) {
    // Clone regex to reset lastIndex for each pattern
    const regex = new RegExp(re.source, re.flags);
    let match: RegExpExecArray | null;

    while ((match = regex.exec(content)) !== null) {
      const name = match[1];
      if (!name) continue;

      const dedupeKey = `${kind}:${name}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      // Compute line number from match index
      const lineIndex = content.slice(0, match.index).split("\n").length - 1;
      const lineContent = lines[lineIndex]?.trimEnd() ?? match[0].trimEnd();

      symbols.push({
        name,
        kind,
        line: lineIndex + 1, // 1-based
        signature: lineContent.replace(/\s*\{?\s*$/, "").trim(),
      });
    }
  }

  // Sort by line number ascending
  return symbols.sort((a, b) => a.line - b.line);
}

/** Map codebase-index Language to tree-sitter SupportedLanguage key via file extension. */
function mapLanguageToPath(language: Language): string {
  // Use a synthetic file path so detectTreeSitterLanguage() can map it
  const extMap: Partial<Record<Language, string>> = {
    typescript: "file.ts",
    javascript: "file.js",
    python: "file.py",
    go: "file.go",
    rust: "file.rs",
  };
  return extMap[language] ?? "";
}

/**
 * Extract symbol definitions using tree-sitter AST (fast path) with regex fallback.
 *
 * Prefer this over `extractSymbols()` in async contexts — AST extraction is more
 * accurate (no false positives from comments/strings, correctly handles generics,
 * decorators, anonymous exports, destructuring).
 *
 * Falls back to `extractSymbols()` when:
 *   - Language is not supported by tree-sitter (Ruby, C, etc.)
 *   - web-tree-sitter is not installed
 *   - AST returns no results (parse error, empty file)
 */
export async function extractSymbolsAsync(
  content: string,
  language: Language,
): Promise<SymbolMatch[]> {
  if (language === "unknown") return [];

  const syntheticPath = mapLanguageToPath(language);
  const tsLang = syntheticPath ? detectTreeSitterLanguage(syntheticPath) : undefined;

  if (tsLang) {
    const tags = await extractTagsAST(content, tsLang, "");
    const defs = tags.filter((t) => t.kind === "def");
    if (defs.length > 0) {
      const lines = content.split("\n");
      const seen = new Set<string>();
      const result: SymbolMatch[] = [];

      for (const tag of defs) {
        const dedupeKey = `${tag.defKind ?? "symbol"}:${tag.name}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);

        const lineContent = lines[tag.line]?.trimEnd() ?? tag.name;
        result.push({
          name: tag.name,
          kind: tag.defKind ?? "symbol",
          line: tag.line + 1, // 0-indexed → 1-indexed
          signature: lineContent.replace(/\s*\{?\s*$/, "").trim(),
        });
      }

      return result.sort((a, b) => a.line - b.line);
    }
  }

  // Regex fallback
  return extractSymbols(content, language);
}
