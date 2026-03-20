// ============================================================================
// @dantecode/memory-engine — Entity Extractor
// Lightweight regex-based named entity extraction from memory content.
// Extracts: files, functions, classes, packages, errors, concepts.
// Optional: hook in model-backed NER via setModelExtractor().
// ============================================================================

import type { MemoryEntity } from "./types.js";

// ----------------------------------------------------------------------------
// Regex patterns
// ----------------------------------------------------------------------------

/** TypeScript/JS file paths */
const FILE_RE =
  /(?:^|[\s"'`(])(?:[\w./\\-]+\/)*[\w-]+\.(?:ts|tsx|js|jsx|json|md|yaml|yml|mts|cts|mjs|cjs)(?=[\s"'`),\n]|$)/gm;

/** camelCase / PascalCase function names (at least 4 chars) */
const FUNCTION_RE = /\b([a-z][a-zA-Z0-9]{3,}|[A-Z][a-zA-Z0-9]{3,})\s*\(/g;

/** PascalCase class names */
const CLASS_RE = /\b(class|interface|type|enum)\s+([A-Z][a-zA-Z0-9]+)/g;

/** npm package imports */
const PACKAGE_RE =
  /(?:from\s+|require\()['"](@[a-z0-9-]+\/[a-z0-9-]+|[a-z][\w-]{1,})['"]/g;

/** Error patterns */
const ERROR_RE =
  /(?:Error|Exception|TypeError|RangeError|SyntaxError|ReferenceError):\s*([^\n]{5,80})/g;

/** Key concepts: uppercase acronyms or common agent terms */
const CONCEPT_RE =
  /\b(API|CLI|MCP|LLM|RAG|PDSE|DanteForge|DanteCode|autoforge|memory|checkpoint|verification|semantic|embedding|vector|pruning|session|worktree)\b/g;

// ----------------------------------------------------------------------------
// EntityExtractor
// ----------------------------------------------------------------------------

/**
 * Extracts named entities from text/memory content.
 *
 * Usage:
 * ```ts
 * const extractor = new EntityExtractor();
 * const entities = extractor.extract(text, sessionId, memoryKey);
 * ```
 */
export class EntityExtractor {
  private modelExtractor?: (text: string) => Promise<MemoryEntity[]>;

  /** Hook in a model-backed NER for production enrichment. */
  setModelExtractor(fn: (text: string) => Promise<MemoryEntity[]>): void {
    this.modelExtractor = fn;
  }

  /**
   * Extract entities from text content.
   * Returns a deduplicated list of MemoryEntity objects.
   */
  extract(text: string, sessionId?: string, memoryKey?: string): MemoryEntity[] {
    const entityMap = new Map<string, MemoryEntity>();

    const addEntity = (
      name: string,
      type: MemoryEntity["type"],
    ) => {
      const normalizedName = name.trim();
      if (!normalizedName || normalizedName.length < 2) return;

      const existing = entityMap.get(normalizedName);
      if (existing) {
        existing.count++;
        if (sessionId && !existing.sessionIds.includes(sessionId)) {
          existing.sessionIds.push(sessionId);
        }
        if (memoryKey && !existing.memoryKeys.includes(memoryKey)) {
          existing.memoryKeys.push(memoryKey);
        }
      } else {
        entityMap.set(normalizedName, {
          name: normalizedName,
          type,
          count: 1,
          sessionIds: sessionId ? [sessionId] : [],
          memoryKeys: memoryKey ? [memoryKey] : [],
        });
      }
    };

    // Extract files
    for (const match of text.matchAll(FILE_RE)) {
      addEntity(match[0].trim(), "file");
    }

    // Extract packages
    for (const match of text.matchAll(PACKAGE_RE)) {
      if (match[1]) addEntity(match[1], "package");
    }

    // Extract classes/interfaces
    for (const match of text.matchAll(CLASS_RE)) {
      if (match[2]) addEntity(match[2], "class");
    }

    // Extract functions (careful to not duplicate class names)
    const classNames = new Set(
      Array.from(entityMap.values())
        .filter((e) => e.type === "class")
        .map((e) => e.name),
    );
    for (const match of text.matchAll(FUNCTION_RE)) {
      if (match[1] && !classNames.has(match[1])) {
        // Skip very common words
        if (!COMMON_WORDS.has(match[1].toLowerCase())) {
          addEntity(match[1], "function");
        }
      }
    }

    // Extract errors
    for (const match of text.matchAll(ERROR_RE)) {
      addEntity(match[0].slice(0, 80), "error");
    }

    // Extract concepts
    for (const match of text.matchAll(CONCEPT_RE)) {
      addEntity(match[0], "concept");
    }

    return Array.from(entityMap.values()).sort((a, b) => b.count - a.count);
  }

  /**
   * Merge entity arrays (from multiple extractions), summing counts.
   */
  merge(arrays: MemoryEntity[][]): MemoryEntity[] {
    const merged = new Map<string, MemoryEntity>();

    for (const entities of arrays) {
      for (const entity of entities) {
        const existing = merged.get(entity.name);
        if (existing) {
          existing.count += entity.count;
          for (const sid of entity.sessionIds) {
            if (!existing.sessionIds.includes(sid)) existing.sessionIds.push(sid);
          }
          for (const mk of entity.memoryKeys) {
            if (!existing.memoryKeys.includes(mk)) existing.memoryKeys.push(mk);
          }
        } else {
          merged.set(entity.name, { ...entity });
        }
      }
    }

    return Array.from(merged.values()).sort((a, b) => b.count - a.count);
  }

  /**
   * Extract entities from a MemoryItem value.
   */
  extractFromValue(value: unknown, sessionId?: string, memoryKey?: string): MemoryEntity[] {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    return this.extract(text, sessionId, memoryKey);
  }

  /**
   * Model-backed extraction (if provider is set). Falls back to regex.
   */
  async extractAsync(text: string, sessionId?: string, memoryKey?: string): Promise<MemoryEntity[]> {
    if (this.modelExtractor) {
      try {
        return await this.modelExtractor(text);
      } catch {
        // Fall back to regex
      }
    }
    return this.extract(text, sessionId, memoryKey);
  }
}

// Common programming words to skip as function entities
const COMMON_WORDS = new Set([
  "const",
  "function",
  "return",
  "async",
  "await",
  "import",
  "export",
  "default",
  "class",
  "interface",
  "type",
  "enum",
  "from",
  "this",
  "true",
  "false",
  "null",
  "undefined",
  "void",
  "then",
  "catch",
  "finally",
  "throw",
  "new",
  "delete",
  "typeof",
  "instanceof",
  "else",
  "break",
  "continue",
  "while",
  "for",
  "switch",
  "case",
  "object",
  "array",
  "string",
  "number",
  "boolean",
  "super",
  "extends",
  "implements",
  "static",
  "readonly",
  "public",
  "private",
  "protected",
  "abstract",
  "override",
]);

/** Singleton instance for convenience. */
export const globalEntityExtractor = new EntityExtractor();
