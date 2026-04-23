// ============================================================================
// packages/codebase-index/src/symbol-definition-lookup.ts
// Symbol name → definition chunk lookup for FIM injection.
//
// Harvest: Continue.dev @definitions context provider pattern.
// Given a cursor context like `useAuth(`, find the definition of `useAuth`
// and inject its signature into the FIM system prompt.
// ============================================================================

import type { IndexChunk } from "./types.js";

// Patterns that indicate a definition site (not a call site)
const DEFINITION_PATTERNS = [
  /\bfunction\s+{name}\b/,
  /\bclass\s+{name}\b/,
  /\bconst\s+{name}\s*=/,
  /\blet\s+{name}\s*=/,
  /\bvar\s+{name}\s*=/,
  /\binterface\s+{name}\b/,
  /\btype\s+{name}\s*[=<]/,
  /\benum\s+{name}\b/,
  /\bdef\s+{name}\b/,          // Python
  /\bfn\s+{name}\b/,            // Rust
  /^func\s+(?:\([^)]+\)\s+)?{name}\b/m, // Go method/func
  /\bstruct\s+{name}\b/,
  /\btrait\s+{name}\b/,
];

/**
 * Look up symbol definitions in the indexed chunk set.
 *
 * Accepts a lazy `getChunks` factory so the lookup can be constructed
 * before the index is ready and call `getChunks()` at look-up time.
 */
export class SymbolDefinitionLookup {
  constructor(private readonly getChunks: () => IndexChunk[]) {}

  /**
   * Find the chunk most likely to contain the definition of `symbolName`.
   *
   * Strategy:
   * 1. Build patterns for each known definition form (function foo, class Foo…).
   * 2. Score each chunk by how many definition patterns match.
   * 3. Return the highest-scoring chunk, or null if none match.
   *
   * @param symbolName - Plain symbol name (e.g. "useAuth", "AuthManager").
   * @returns The definition chunk, or null.
   */
  lookup(symbolName: string): IndexChunk | null {
    if (!symbolName || symbolName.length === 0) return null;

    // Build regexes with the actual symbol name substituted in
    const regexes = DEFINITION_PATTERNS.map((pattern) => {
      const src = pattern.source.replace(/\{name\}/g, escapeRegex(symbolName));
      return new RegExp(src, "m");
    });

    const chunks = this.getChunks();
    let best: { chunk: IndexChunk; score: number } | null = null;

    for (const chunk of chunks) {
      if (!chunk.content) continue;

      let score = 0;
      for (const re of regexes) {
        if (re.test(chunk.content)) score++;
      }

      if (score > 0 && (best === null || score > best.score)) {
        best = { chunk, score };
      }
    }

    return best?.chunk ?? null;
  }

  /**
   * Extract a symbol name from the text immediately before the cursor.
   *
   * Handles patterns like:
   *   `useAuth(`     → "useAuth"
   *   `new Foo(`     → "Foo"
   *   `AuthManager.` → "AuthManager"
   *   `import { X `  → null (import context, not a call site)
   *
   * @param prefix - Text before the cursor position.
   * @returns Symbol name, or null if no call-site symbol detected.
   */
  static extractCallSiteSymbol(prefix: string): string | null {
    if (!prefix) return null;

    // Match: identifier immediately before ( or .
    // Also handle `new Foo(`
    const callMatch = prefix.match(/(?:new\s+)?(\w{2,})\s*[.(]\s*$/);
    if (callMatch) {
      const name = callMatch[1]!;
      // Exclude language keywords
      if (KEYWORDS.has(name)) return null;
      return name;
    }

    return null;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const KEYWORDS = new Set([
  "if", "else", "for", "while", "do", "switch", "case", "break", "continue",
  "return", "throw", "try", "catch", "finally", "class", "function", "const",
  "let", "var", "type", "interface", "enum", "import", "export", "from",
  "default", "new", "delete", "typeof", "instanceof", "in", "of", "async",
  "await", "yield", "void", "null", "true", "false", "this", "super",
  "extends", "implements", "static", "public", "private", "protected",
  "readonly", "abstract", "namespace", "module", "declare", "keyof",
]);
