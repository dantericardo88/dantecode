// ============================================================================
// packages/core/src/tree-sitter/ast-symbol-extractor.ts
//
// Core extraction function: runs Aider-style .scm queries against a parsed
// tree-sitter AST to produce ASTTag[] (def nodes + ref nodes).
//
// Design decisions:
//   - File size guard: skip content > 500KB (parser would be slow)
//   - Graceful degradation: returns [] on any error (caller uses regex fallback)
//   - Unsupported predicates (#strip!, #select-adjacent!) are stripped before
//     the query string is compiled to avoid QueryError
//   - Language detection: caller provides the language string; we map it to
//     SupportedLanguage (unknown languages return [])
// ============================================================================

import { getParser } from "./parser-pool.js";
import { SCM_QUERIES } from "./scm-queries.js";
import type { SupportedLanguage } from "./parser-pool.js";

const MAX_FILE_BYTES = 512_000; // 500 KB

export interface ASTTag {
  /** Symbol name (decoded UTF-8 text from the AST node). */
  name: string;
  /** "def" = definition site, "ref" = reference/call site. */
  kind: "def" | "ref";
  /** 0-indexed line number (tree-sitter native). */
  line: number;
  /** Absolute or relative file path (passed through from caller). */
  filePath: string;
  /** Sub-kind for definitions: function, class, method, interface, type, etc. */
  defKind?: string;
}

// Aider's custom predicates are not standard tree-sitter predicates.
// Strip them from .scm content before compiling to avoid QueryError.
// These predicates are purely cosmetic (doc-string handling) and don't affect
// the capture nodes we care about.
const UNSUPPORTED_PREDICATE_RE =
  /\(#(?:strip!|select-adjacent!|set-adjacent!|not-match\?|not-eq\?)[^)]*\)/g;

function stripUnsupportedPredicates(scm: string): string {
  return scm.replace(UNSUPPORTED_PREDICATE_RE, "");
}

/**
 * Extract ASTTag[] from `content` using tree-sitter + Aider SCM queries.
 *
 * Returns [] when:
 *   - content > 500KB
 *   - language not in SupportedLanguage union
 *   - web-tree-sitter not installed
 *   - any parse/query error
 *
 * @param content   Full source file text
 * @param language  Language key (e.g. "typescript", "python")
 * @param filePath  File path to embed in returned tags
 */
export async function extractTagsAST(
  content: string,
  language: string,
  filePath: string,
): Promise<ASTTag[]> {
  if (content.length > MAX_FILE_BYTES) return [];
  if (!content.trim()) return [];

  const lang = language as SupportedLanguage;
  const scmRaw = SCM_QUERIES[lang];
  if (!scmRaw) return []; // unsupported language

  const parser = await getParser(lang);
  if (!parser) return [];

  try {
    const tree = parser.parse(content);
    if (!tree) return [];

    const scm = stripUnsupportedPredicates(scmRaw);
    // getLanguage() is the Language instance attached to this parser
    const language_ = parser.getLanguage();
    const query = language_.query(scm);
    const captures = query.captures(tree.rootNode);

    const tags: ASTTag[] = [];
    for (const { name: captureName, node } of captures) {
      const text = node.text;
      if (!text || text.length < 1) continue;

      if (captureName.startsWith("name.definition.")) {
        const defKind = captureName.slice("name.definition.".length);
        tags.push({
          name: text,
          kind: "def",
          line: node.startPosition.row,
          filePath,
          defKind,
        });
      } else if (captureName.startsWith("name.reference.")) {
        tags.push({
          name: text,
          kind: "ref",
          line: node.startPosition.row,
          filePath,
        });
      }
    }
    return tags;
  } catch {
    // Parse or query error — degrade gracefully
    return [];
  }
}

/**
 * Map a file extension or language string to a SupportedLanguage key.
 * Returns undefined for unsupported languages (caller uses regex fallback).
 */
export function detectTreeSitterLanguage(
  filePathOrLang: string,
): SupportedLanguage | undefined {
  const lower = filePathOrLang.toLowerCase();

  // Extension-based detection
  if (lower.endsWith(".ts")) return "typescript";
  if (lower.endsWith(".tsx")) return "tsx";
  if (lower.endsWith(".js") || lower.endsWith(".mjs") || lower.endsWith(".cjs"))
    return "javascript";
  if (lower.endsWith(".jsx")) return "javascript";
  if (lower.endsWith(".py")) return "python";
  if (lower.endsWith(".go")) return "go";
  if (lower.endsWith(".rs")) return "rust";
  if (lower.endsWith(".java")) return "java";

  // Language-string-based detection (from codebase-index Language type)
  if (lower === "typescript") return "typescript";
  if (lower === "tsx") return "tsx";
  if (lower === "javascript") return "javascript";
  if (lower === "python") return "python";
  if (lower === "go") return "go";
  if (lower === "rust") return "rust";
  if (lower === "java") return "java";

  return undefined;
}
