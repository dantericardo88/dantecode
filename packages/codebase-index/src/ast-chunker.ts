// packages/codebase-index/src/ast-chunker.ts
// Tabby-harvested: tree-sitter AST parsing for semantic code chunking.
// Reference: TabbyML/tabby crates/tabby-index/src/code/intelligence.rs
//
// Uses tree-sitter to extract function/class/method nodes with precise byte
// offsets and scope metadata. Falls back gracefully if tree-sitter unavailable.
//
// NOTE: tree-sitter is an optionalDependency — all imports are wrapped in
// try/catch so this module degrades gracefully in environments without node-gyp.

// tree-sitter types (resolved at runtime via optionalDependencies)
type TsParser = {
  setLanguage(lang: unknown): void;
  parse(source: string): TsTree;
};
type TsTree = { rootNode: TsNode };
type TsNode = {
  type: string;
  children: TsNode[];
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  startIndex: number;
  endIndex: number;
  text: string;
};

/** Lazy-load a tree-sitter language grammar. Returns undefined if unavailable. */
async function loadLanguage(lang: string): Promise<unknown | undefined> {
  try {
    switch (lang) {
      case "typescript":
      case "tsx": {
        // tree-sitter-typescript exports { typescript, tsx } sub-grammars
        const mod = await import("tree-sitter-typescript" as string);
        return (mod as { typescript?: unknown; default?: { typescript?: unknown } }).typescript
          ?? (mod as { default?: { typescript?: unknown } }).default?.typescript;
      }
      case "javascript":
      case "jsx": {
        const mod = await import("tree-sitter-javascript" as string);
        return (mod as { default?: unknown }).default ?? mod;
      }
      case "python": {
        const mod = await import("tree-sitter-python" as string);
        return (mod as { default?: unknown }).default ?? mod;
      }
      default:
        return undefined;
    }
  } catch {
    return undefined;
  }
}

/** AST node types considered "semantic units" worth indexing individually */
const SEMANTIC_NODE_TYPES = new Set([
  // TypeScript / JavaScript
  "function_declaration",
  "function_expression",
  "arrow_function",
  "method_definition",
  "class_declaration",
  "class_expression",
  "interface_declaration",
  "type_alias_declaration",
  // Python
  "function_definition",
  "class_definition",
  "decorated_definition",
]);

export interface AstChunk {
  /** Source text of this chunk */
  content: string;
  /** 0-indexed start line */
  startLine: number;
  /** 0-indexed end line (inclusive) */
  endLine: number;
  startByte: number;
  endByte: number;
  /** tree-sitter node type */
  nodeType: string;
  /** Extracted symbol name (function/class identifier), if any */
  symbolName: string | undefined;
  /** Nesting depth — top-level definitions are depth 0 */
  depth: number;
}

function extractSymbolName(node: TsNode): string | undefined {
  for (const child of node.children) {
    if (child.type === "identifier" || child.type === "property_identifier") {
      return child.text;
    }
  }
  return undefined;
}

function collectChunks(
  node: TsNode,
  source: string,
  depth: number,
  chunks: AstChunk[],
  maxChunkLines: number,
): void {
  if (SEMANTIC_NODE_TYPES.has(node.type)) {
    const lineCount = node.endPosition.row - node.startPosition.row + 1;
    if (lineCount <= maxChunkLines) {
      chunks.push({
        content: source.slice(node.startIndex, node.endIndex),
        startLine: node.startPosition.row,
        endLine: node.endPosition.row,
        startByte: node.startIndex,
        endByte: node.endIndex,
        nodeType: node.type,
        symbolName: extractSymbolName(node),
        depth,
      });
      return; // complete semantic unit — don't recurse into children
    }
    // Node too large: recurse to get sub-chunks at increased depth
  }

  const childDepth = depth + (SEMANTIC_NODE_TYPES.has(node.type) ? 1 : 0);
  for (const child of node.children) {
    collectChunks(child, source, childDepth, chunks, maxChunkLines);
  }
}

// Parser cache — tree-sitter Parser objects are stateful; one per language
const _parserCache = new Map<string, TsParser>();

/**
 * Chunk source code using tree-sitter AST parsing.
 * Returns null if the language is unsupported or tree-sitter is unavailable.
 * Caller MUST fall back to regex-based chunking on null return.
 */
export async function chunkWithAst(
  source: string,
  language: string,
  maxChunkLines = 200,
): Promise<AstChunk[] | null> {
  const lang = await loadLanguage(language);
  if (lang === undefined || lang === null) return null;

  // Lazy-load the Parser class itself
  let ParserClass: (new () => TsParser) | undefined;
  try {
    const mod = await import("tree-sitter" as string);
    ParserClass = (mod as { default?: new () => TsParser }).default ?? (mod as unknown as new () => TsParser);
  } catch {
    return null;
  }

  if (!_parserCache.has(language)) {
    try {
      const p = new ParserClass();
      p.setLanguage(lang);
      _parserCache.set(language, p);
    } catch {
      return null;
    }
  }

  const parser = _parserCache.get(language)!;

  let tree: TsTree;
  try {
    tree = parser.parse(source);
  } catch {
    return null; // Parse failure — caller falls back to regex
  }

  const chunks: AstChunk[] = [];
  collectChunks(tree.rootNode, source, 0, chunks, maxChunkLines);
  return chunks.length > 0 ? chunks : null;
}

/** Exposed for testing: clear the parser cache */
export function _clearParserCache(): void {
  _parserCache.clear();
}
