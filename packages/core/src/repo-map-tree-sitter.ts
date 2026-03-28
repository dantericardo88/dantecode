// ============================================================================
// @dantecode/core - Tree-Sitter Symbol Extraction
// Fast, accurate symbol extraction using tree-sitter parsers with regex fallback
// ============================================================================

import { extname } from "node:path";
import type { SymbolDefinition } from "./repo-map-ast.js";
import { extractSymbolDefinitions as extractSymbolsRegex } from "./repo-map-ast.js";
import { TypeScriptParser } from "./parsers/typescript-parser.js";
import { JavaScriptParser } from "./parsers/javascript-parser.js";
import { PythonParser } from "./parsers/python-parser.js";
import { GoParser } from "./parsers/go-parser.js";
import { RustParser } from "./parsers/rust-parser.js";

export interface TreeSitterParser {
  parse(source: string, filePath: string): SymbolDefinition[];
}

/**
 * Unified symbol extractor that uses tree-sitter for supported languages
 * and falls back to regex for unsupported files or parse errors.
 */
export class RepoMapTreeSitter {
  private parsers: Map<string, TreeSitterParser>;
  private stats = {
    treeSitterSuccess: 0,
    treeSitterFallback: 0,
    regexOnly: 0,
  };

  constructor() {
    this.parsers = new Map();

    // Initialize parsers
    const tsParser = new TypeScriptParser(false);
    const tsxParser = new TypeScriptParser(true);
    const jsParser = new JavaScriptParser();
    const pyParser = new PythonParser();
    const goParser = new GoParser();
    const rsParser = new RustParser();

    // Map file extensions to parsers
    this.parsers.set(".ts", tsParser);
    this.parsers.set(".tsx", tsxParser);
    this.parsers.set(".js", jsParser);
    this.parsers.set(".jsx", jsParser);
    this.parsers.set(".mjs", jsParser);
    this.parsers.set(".cjs", jsParser);
    this.parsers.set(".py", pyParser);
    this.parsers.set(".go", goParser);
    this.parsers.set(".rs", rsParser);
  }

  /**
   * Extract symbols from source code.
   * Uses tree-sitter for supported languages, falls back to regex otherwise.
   */
  extractSymbols(source: string, filePath: string): SymbolDefinition[] {
    const ext = extname(filePath).toLowerCase();
    const parser = this.parsers.get(ext);

    if (!parser) {
      // No tree-sitter parser for this extension, use regex
      this.stats.regexOnly++;
      return extractSymbolsRegex(source, filePath);
    }

    try {
      const symbols = parser.parse(source, filePath);
      this.stats.treeSitterSuccess++;
      return symbols;
    } catch (error) {
      // Parse error, fall back to regex
      this.stats.treeSitterFallback++;
      return extractSymbolsRegex(source, filePath);
    }
  }

  /**
   * Get statistics on parser usage.
   */
  getStats() {
    const total =
      this.stats.treeSitterSuccess + this.stats.treeSitterFallback + this.stats.regexOnly;
    const coverage = total > 0 ? (this.stats.treeSitterSuccess / total) * 100 : 0;

    return {
      ...this.stats,
      total,
      coverage,
    };
  }

  /**
   * Reset statistics.
   */
  resetStats() {
    this.stats.treeSitterSuccess = 0;
    this.stats.treeSitterFallback = 0;
    this.stats.regexOnly = 0;
  }
}
