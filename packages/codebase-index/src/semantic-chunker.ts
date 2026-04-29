// ============================================================================
// packages/codebase-index/src/semantic-chunker.ts
//
// Semantic bracket-counting chunker — Continue.dev harvest.
// Splits code at true semantic boundaries using brace depth tracking,
// import block grouping, JSDoc attachment, and Python indentation mode.
//
// Advantages over regex-only chunking:
//   - Class body stays as ONE chunk (methods don't split from parent)
//   - Import block at top grouped as one chunk
//   - JSDoc / block comments attach to the following declaration
//   - Python uses indentation instead of brackets
//   - Unknown/text files fall back gracefully
// ============================================================================

import { extname } from "node:path";
import type { IndexChunk } from "./types.js";
import { extractSymbols, detectLanguage } from "./symbol-extractor.js";

// ── Language detection ─────────────────────────────────────────────────────────

type ChunkLang = "brace" | "python" | "text";

const BRACE_EXTS = new Set([
  ".ts", ".tsx", ".mts", ".cts",
  ".js", ".jsx", ".mjs", ".cjs",
  ".java", ".go", ".rs", ".c", ".cpp", ".h", ".hpp", ".cs",
  ".swift", ".kt", ".kts", ".scala", ".groovy", ".php",
  ".json", ".jsonc",
]);

const PYTHON_EXTS = new Set([".py", ".pyi"]);

function detectChunkLang(filePath: string): ChunkLang {
  const ext = extname(filePath).toLowerCase();
  if (BRACE_EXTS.has(ext)) return "brace";
  if (PYTHON_EXTS.has(ext)) return "python";
  return "text";
}

// ── Import line detection ──────────────────────────────────────────────────────

const IMPORT_LINE_RE = /^(?:import\s|export\s+\{|export\s+\*|require\s*\(|from\s+['"])/;

// ── Top-level declaration detection (for brace mode) ──────────────────────────

const TOP_LEVEL_DECL_RE = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:abstract\s+)?(?:function|class|interface|type|enum|const|let|var|struct|impl|trait|fn|pub\s+fn|pub\s+struct|pub\s+enum|pub\s+trait|func\s+\w|def\s+\w)\b/;

// ── Comment line detection ─────────────────────────────────────────────────────

const COMMENT_LINE_RE = /^\s*(?:\/\/\/|\/\*\*|\*\s|\*\/|#\s|""")/;

// ── Core algorithm ─────────────────────────────────────────────────────────────

function makechunk(
  lines: string[],
  startIdx: number,
  endIdx: number,
  filePath: string,
): IndexChunk {
  const content = lines.slice(startIdx, endIdx).join("\n");
  const lang = detectLanguage(filePath);
  const symbolMatches = extractSymbols(content, lang);
  return {
    filePath,
    content,
    startLine: startIdx + 1,
    endLine: endIdx,
    symbols: symbolMatches.map((s) => s.name),
  };
}

/**
 * Semantic chunker using bracket depth tracking.
 *
 * Rules:
 *  1. Leading import block → one chunk
 *  2. Each top-level declaration + its full body (tracked by brace depth) → one chunk
 *  3. Preceding comment/JSDoc lines attach to the next declaration's chunk
 *  4. Chunks > maxChunkLines are force-split at the next top-level boundary
 *  5. Chunks < MIN_LINES merge with next chunk
 */
/** Skip a leading run of import lines and emit them as a single chunk. Returns
 *  the index of the first non-import line (or 0 if there were no imports). */
function emitImportChunk(
  lines: string[],
  filePath: string,
  chunks: IndexChunk[],
): number {
  let i = 0;
  while (i < lines.length && IMPORT_LINE_RE.test(lines[i]!.trim())) i++;
  if (i > 0) chunks.push(makechunk(lines, 0, i, filePath));
  return i;
}

interface BraceScanState {
  depth: number;
  inBlockComment: boolean;
  inString: "'" | '"' | "`" | null;
}

/** Walk one line and update the running brace depth + string/comment state. */
function advanceBraceScan(line: string, state: BraceScanState): void {
  for (let ci = 0; ci < line.length; ci++) {
    const ch = line[ci]!;
    const prev = ci > 0 ? line[ci - 1] : "";
    if (state.inBlockComment) {
      if (ch === "/" && prev === "*") state.inBlockComment = false;
      continue;
    }
    if (state.inString) {
      if (ch === state.inString && prev !== "\\") state.inString = null;
      continue;
    }
    if (ch === "/" && line[ci + 1] === "/") break;
    if (ch === "/" && line[ci + 1] === "*") { state.inBlockComment = true; ci++; continue; }
    if (ch === '"' || ch === "'" || ch === "`") { state.inString = ch as "'" | '"' | "`"; continue; }
    if (ch === "{") state.depth++;
    else if (ch === "}") state.depth = Math.max(0, state.depth - 1);
  }
}

/** Coalesce chunks shorter than MIN_LINES into the previous chunk. */
function mergeTinyChunks(chunks: IndexChunk[], minLines: number): IndexChunk[] {
  const merged: IndexChunk[] = [];
  for (const cur of chunks) {
    const lineCount = (cur.endLine ?? 0) - (cur.startLine ?? 1) + 1;
    if (lineCount < minLines && merged.length > 0) {
      const prev = merged[merged.length - 1]!;
      prev.content += "\n" + cur.content;
      prev.endLine = cur.endLine;
      prev.symbols = [...(prev.symbols ?? []), ...(cur.symbols ?? [])];
    } else {
      merged.push({ ...cur });
    }
  }
  return merged;
}

function chunkBrace(
  lines: string[],
  filePath: string,
  maxChunkLines: number,
): IndexChunk[] {
  const MIN_LINES = 5;
  const chunks: IndexChunk[] = [];

  let i = emitImportChunk(lines, filePath, chunks);

  let chunkStart = i;
  const scan: BraceScanState = { depth: 0, inBlockComment: false, inString: null };
  let pendingCommentStart = -1;

  while (i < lines.length) {
    const line = lines[i]!;
    const trimmed = line.trim();

    if (scan.depth === 0 && COMMENT_LINE_RE.test(trimmed)) {
      if (pendingCommentStart === -1) pendingCommentStart = i;
      i++;
      continue;
    }

    if (scan.depth === 0 && TOP_LEVEL_DECL_RE.test(trimmed) && i > chunkStart) {
      const prevEnd = pendingCommentStart !== -1 ? pendingCommentStart : i;
      if (prevEnd > chunkStart) {
        const c = makechunk(lines, chunkStart, prevEnd, filePath);
        if (c.content.trim()) chunks.push(c);
      }
      chunkStart = pendingCommentStart !== -1 ? pendingCommentStart : i;
      pendingCommentStart = -1;
    } else if (scan.depth === 0 && pendingCommentStart !== -1 && trimmed.length > 0) {
      const c = makechunk(lines, chunkStart, pendingCommentStart, filePath);
      if (c.content.trim()) chunks.push(c);
      chunkStart = pendingCommentStart;
      pendingCommentStart = -1;
    }

    advanceBraceScan(line, scan);

    if (scan.depth === 0 && (i - chunkStart) >= maxChunkLines) {
      const c = makechunk(lines, chunkStart, i + 1, filePath);
      if (c.content.trim()) chunks.push(c);
      chunkStart = i + 1;
      pendingCommentStart = -1;
    }

    i++;
  }

  if (chunkStart < lines.length) {
    const c = makechunk(lines, chunkStart, lines.length, filePath);
    if (c.content.trim()) chunks.push(c);
  }

  return mergeTinyChunks(chunks, MIN_LINES);
}

/**
 * Python chunker using indentation boundaries.
 * Splits at top-level `def` / `class` at column 0.
 */
function chunkPython(
  lines: string[],
  filePath: string,
  maxChunkLines: number,
): IndexChunk[] {
  const MIN_LINES = 5;
  const TOP_LEVEL_PY = /^(?:def |class |async def )/;
  const chunks: IndexChunk[] = [];
  let chunkStart = 0;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    const isTopLevel = TOP_LEVEL_PY.test(line);
    const chunkLen = i - chunkStart;

    if (isTopLevel && chunkLen >= MIN_LINES) {
      const c = makechunk(lines, chunkStart, i, filePath);
      if (c.content.trim()) chunks.push(c);
      chunkStart = i;
    } else if (chunkLen >= maxChunkLines) {
      const c = makechunk(lines, chunkStart, i, filePath);
      if (c.content.trim()) chunks.push(c);
      chunkStart = i;
    }
  }

  if (chunkStart < lines.length) {
    const c = makechunk(lines, chunkStart, lines.length, filePath);
    if (c.content.trim()) chunks.push(c);
  }

  return chunks;
}

/**
 * Fallback plain-text chunker: splits at every `maxChunkLines` lines.
 */
function chunkText(
  lines: string[],
  filePath: string,
  maxChunkLines: number,
): IndexChunk[] {
  const chunks: IndexChunk[] = [];
  for (let start = 0; start < lines.length; start += maxChunkLines) {
    const end = Math.min(start + maxChunkLines, lines.length);
    const c = makechunk(lines, start, end, filePath);
    if (c.content.trim()) chunks.push(c);
  }
  return chunks;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Semantically chunk a source file.
 *
 * - Brace languages (TS/JS/Go/Rust/Java/…): bracket-depth tracking
 * - Python: indentation-based top-level boundary detection
 * - Everything else: fixed-size line splitting
 *
 * @param content       Raw file content
 * @param filePath      Used for language detection and stored in each chunk
 * @param maxChunkLines Hard maximum lines per chunk (default 200)
 */
export function semanticChunkFile(
  content: string,
  filePath: string,
  maxChunkLines = 200,
): IndexChunk[] {
  if (!content.trim()) return [];
  const lines = content.split("\n");
  if (lines.length <= maxChunkLines) {
    // Small enough — return as single chunk
    return [makechunk(lines, 0, lines.length, filePath)];
  }

  const lang = detectChunkLang(filePath);
  switch (lang) {
    case "brace":  return chunkBrace(lines, filePath, maxChunkLines);
    case "python": return chunkPython(lines, filePath, maxChunkLines);
    default:       return chunkText(lines, filePath, maxChunkLines);
  }
}

/**
 * Async variant of semanticChunkFile with a tree-sitter AST fast path.
 *
 * For TypeScript, JavaScript, and Python files, attempts tree-sitter AST
 * parsing first (Tabby-harvested) to extract precise function/class/method
 * boundaries. Falls back to the synchronous regex chunker for unsupported
 * languages or when tree-sitter is unavailable (graceful degradation).
 *
 * @param content       Raw file content
 * @param filePath      Used for language detection and stored in each chunk
 * @param maxChunkLines Hard maximum lines per chunk (default 200)
 */
export async function semanticChunkFileAsync(
  content: string,
  filePath: string,
  maxChunkLines = 200,
): Promise<IndexChunk[]> {
  // ── Tree-sitter AST fast path (Tabby-harvested) ──────────────────────────
  // For TypeScript, JavaScript, and Python, use tree-sitter AST parsing to
  // extract precise function/class/method node boundaries. Falls back to the
  // existing regex chunking for unsupported languages or if tree-sitter fails.
  try {
    const ext = extname(filePath).toLowerCase();
    const astLanguage =
      ext === ".ts" || ext === ".tsx" || ext === ".mts" || ext === ".cts" ? "typescript"
      : ext === ".js" || ext === ".jsx" || ext === ".mjs" || ext === ".cjs" ? "javascript"
      : ext === ".py" || ext === ".pyi" ? "python"
      : null;

    if (astLanguage !== null) {
      const { chunkWithAst } = await import("./ast-chunker.js");
      const astChunks = await chunkWithAst(content, astLanguage, maxChunkLines);
      if (astChunks !== null && astChunks.length > 0) {
        return astChunks.map((c, idx) => ({
          filePath,
          startLine: c.startLine + 1,  // SemanticChunker uses 1-indexed lines
          endLine: c.endLine + 1,
          content: c.content,
          symbols: c.symbolName !== undefined ? [c.symbolName] : [],
          chunkIndex: idx,
        }));
      }
    }
  } catch {
    // tree-sitter unavailable or failed — fall through to regex chunker
  }
  // ── End tree-sitter fast path ─────────────────────────────────────────────

  return semanticChunkFile(content, filePath, maxChunkLines);
}
