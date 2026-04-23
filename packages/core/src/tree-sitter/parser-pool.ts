// ============================================================================
// packages/core/src/tree-sitter/parser-pool.ts
//
// Lazy WASM initialisation + parser pool (one parser instance per language).
// Uses web-tree-sitter — works in both Node.js and VSCode extension contexts
// without native bindings (Continue.dev pattern).
//
// Exported surface:
//   getParser(language)  → Parser | null (null = unsupported language)
//   resetParserPool()    → void (test helper — clears cache between tests)
//   SupportedLanguage    → union type of all supported language keys
// ============================================================================

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { existsSync } from "node:fs";

// Dynamic import of web-tree-sitter avoids bundler issues when the host
// environment doesn't have it. Callers get null on ImportError.
// web-tree-sitter uses `export = Parser` so the module itself is the Parser class.
type Parser = InstanceType<typeof import("web-tree-sitter")>;
type ParserClass = typeof import("web-tree-sitter");

export type SupportedLanguage =
  | "typescript"
  | "tsx"
  | "javascript"
  | "python"
  | "go"
  | "rust"
  | "java";

// Language key → WASM file basename in tree-sitter-wasms/out/
const WASM_BASENAME: Record<SupportedLanguage, string> = {
  typescript: "tree-sitter-typescript.wasm",
  tsx: "tree-sitter-typescript.wasm", // tsx uses the same TypeScript WASM
  javascript: "tree-sitter-javascript.wasm",
  python: "tree-sitter-python.wasm",
  go: "tree-sitter-go.wasm",
  rust: "tree-sitter-rust.wasm",
  java: "tree-sitter-java.wasm",
};

let _Parser: ParserClass | null = null;
let _initPromise: Promise<void> | null = null;
const _pool = new Map<SupportedLanguage, Parser>();

/** Resolve absolute path to a tree-sitter-wasms .wasm file. */
function resolveWasmPath(basename: string): string {
  // Try require.resolve for CJS interop, then fall back to manual resolution
  try {
    const req = createRequire(import.meta.url);
    const wasmsPkg = req.resolve("tree-sitter-wasms/package.json");
    return join(dirname(wasmsPkg), "out", basename);
  } catch {
    // Fallback: walk up from __dirname equivalent
    const here = fileURLToPath(import.meta.url);
    // Try to find node_modules/tree-sitter-wasms relative to this file
    let dir = dirname(here);
    for (let i = 0; i < 8; i++) {
      const candidate = join(dir, "node_modules", "tree-sitter-wasms", "out", basename);
      if (existsSync(candidate)) return candidate;
      dir = dirname(dir);
    }
    throw new Error(`Cannot resolve tree-sitter-wasms WASM: ${basename}`);
  }
}

/** Resolve absolute path to tree-sitter.wasm (the parser runtime). */
function resolveTreeSitterWasm(): string {
  try {
    const req = createRequire(import.meta.url);
    const pkg = req.resolve("web-tree-sitter/package.json");
    const candidate = join(dirname(pkg), "tree-sitter.wasm");
    if (existsSync(candidate)) return candidate;
  } catch {
    // fall through
  }
  throw new Error("Cannot resolve web-tree-sitter/tree-sitter.wasm");
}

async function ensureInit(): Promise<ParserClass | null> {
  if (_Parser) return _Parser;
  if (_initPromise) {
    await _initPromise;
    return _Parser;
  }
  _initPromise = (async () => {
    try {
      const mod = await import("web-tree-sitter");
      const P = (mod.default ?? mod) as ParserClass;
      const wasmPath = resolveTreeSitterWasm();
      await P.init({ locateFile: () => wasmPath });
      _Parser = P;
    } catch {
      // web-tree-sitter not available — all getParser() calls return null
      _Parser = null;
    }
  })();
  await _initPromise;
  return _Parser;
}

/**
 * Return a cached Parser instance for `language`, or null if:
 *   - web-tree-sitter is not installed
 *   - the language WASM cannot be found
 *   - any error occurs during initialisation
 *
 * The parser is initialised lazily on first call per language.
 */
export async function getParser(language: SupportedLanguage): Promise<Parser | null> {
  const cached = _pool.get(language);
  if (cached) return cached;

  const P = await ensureInit();
  if (!P) return null;

  try {
    const wasmPath = resolveWasmPath(WASM_BASENAME[language]);
    const lang = await P.Language.load(wasmPath);
    const parser = new P();
    parser.setLanguage(lang);
    _pool.set(language, parser);
    return parser;
  } catch {
    return null;
  }
}

/** Test helper: clear parser pool and force re-initialisation. */
export function resetParserPool(): void {
  _pool.clear();
  _Parser = null;
  _initPromise = null;
}
