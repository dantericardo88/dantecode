// ============================================================================
// @dantecode/core - Doc-Code Drift Detection
// Detects when documentation diverges from implementation signatures
// ============================================================================

import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { TypeScriptParser } from "../parsers/typescript-parser.js";
import { JavaScriptParser } from "../parsers/javascript-parser.js";
import { PythonParser } from "../parsers/python-parser.js";
import { RustParser } from "../parsers/rust-parser.js";
import { GoParser } from "../parsers/go-parser.js";
import type { SymbolDefinition } from "../repo-map-ast.js";

export interface DriftCheck {
  file: string;
  type: "function" | "class" | "interface" | "type";
  name: string;
  codeSignature: string;
  docSignature: string;
  driftDetected: boolean;
  driftReason?: string;
}

export interface DocParameter {
  name: string;
  type?: string;
  description?: string;
}

export interface DocSymbol {
  name: string;
  type: "function" | "class" | "interface" | "type";
  params: DocParameter[];
  returnType?: string;
  signature: string;
  description?: string;
}

export interface CodeParameter {
  name: string;
  type?: string;
  optional?: boolean;
}

export interface CodeSymbol {
  name: string;
  type: "function" | "class" | "interface" | "type";
  params: CodeParameter[];
  returnType?: string;
  signature: string;
}

/**
 * Extract JSDoc/TSDoc documentation signatures from source code.
 */
export function extractDocSignatures(source: string): DocSymbol[] {
  const docSymbols: DocSymbol[] = [];

  // Match JSDoc/TSDoc blocks followed by function/class/interface/type declarations
  const jsDocPattern =
    /\/\*\*\s*([\s\S]*?)\s*\*\/\s*(?:export\s+)?(?:async\s+)?(?:function|class|interface|type|const)\s+(\w+)/g;

  let match: RegExpExecArray | null;
  while ((match = jsDocPattern.exec(source)) !== null) {
    const docBlock = match[1];
    const symbolName = match[2];

    if (!docBlock || !symbolName) continue;

    // Parse JSDoc block
    const params: DocParameter[] = [];
    let returnType: string | undefined;
    let description = "";

    const docLines = docBlock.split("\n");
    for (const line of docLines) {
      const trimmed = line.replace(/^\s*\*\s?/, "").trim();

      // @param {type} name - description
      const paramMatch = trimmed.match(/@param\s+(?:\{([^}]+)\}\s+)?(\w+)(?:\s+-\s+(.+))?/);
      if (paramMatch && paramMatch[2]) {
        params.push({
          name: paramMatch[2],
          type: paramMatch[1],
          description: paramMatch[3],
        });
        continue;
      }

      // @returns {type} description
      const returnMatch = trimmed.match(/@returns?\s+(?:\{([^}]+)\}\s*)?(.+)?/);
      if (returnMatch) {
        returnType = returnMatch[1];
        continue;
      }

      // Description (non-tag lines)
      if (!trimmed.startsWith("@") && trimmed.length > 0) {
        description += trimmed + " ";
      }
    }

    // Determine symbol type from the declaration
    const afterDoc = source.slice(match.index + match[0].length - symbolName.length - 20);
    let symbolType: "function" | "class" | "interface" | "type" = "function";
    if (afterDoc.includes("interface ")) symbolType = "interface";
    else if (afterDoc.includes("class ")) symbolType = "class";
    else if (afterDoc.includes("type ")) symbolType = "type";

    docSymbols.push({
      name: symbolName,
      type: symbolType,
      params,
      returnType,
      signature: `${symbolName}(${params.map((p) => p.name).join(", ")})${returnType ? `: ${returnType}` : ""}`,
      description: description.trim(),
    });
  }

  return docSymbols;
}

/**
 * Extract parameter information from code signature.
 */
export function extractCodeParameters(signature: string): CodeParameter[] {
  const params: CodeParameter[] = [];

  // Extract parameter list from signature
  const paramMatch = signature.match(/\(([^)]*)\)/);
  if (!paramMatch || !paramMatch[1]) return params;

  const paramList = paramMatch[1];

  // Split by comma, handling nested types
  const rawParams: string[] = [];
  let depth = 0;
  let current = "";

  for (let i = 0; i < paramList.length; i++) {
    const char = paramList[i];
    if (char === "<" || char === "{" || char === "[") depth++;
    else if (char === ">" || char === "}" || char === "]") depth--;
    else if (char === "," && depth === 0) {
      rawParams.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) rawParams.push(current.trim());

  // Parse each parameter
  for (const param of rawParams) {
    if (!param) continue;

    // Handle: name: type, name?: type, name = default
    const optional = param.includes("?") || param.includes("=");
    const cleanParam = param.replace(/[?=].*$/, "").trim();

    const parts = cleanParam.split(":").map((p) => p.trim());
    const name = parts[0];
    const type = parts[1];

    if (name) {
      params.push({
        name,
        type,
        optional,
      });
    }
  }

  return params;
}

/**
 * Convert SymbolDefinition to CodeSymbol with parsed parameters.
 */
export function symbolToCodeSymbol(symbol: SymbolDefinition): CodeSymbol {
  const params = extractCodeParameters(symbol.signature);

  // Extract return type from signature
  let returnType: string | undefined;
  const returnMatch = symbol.signature.match(/\):\s*([^{]+)/);
  if (returnMatch && returnMatch[1]) {
    returnType = returnMatch[1].trim();
  }

  // Map symbol kind to CodeSymbol type
  let symbolType: CodeSymbol["type"];
  if (symbol.kind === "const" || symbol.kind === "function") {
    symbolType = "function";
  } else if (symbol.kind === "class") {
    symbolType = "class";
  } else if (symbol.kind === "interface") {
    symbolType = "interface";
  } else {
    symbolType = "type";
  }

  return {
    name: symbol.name,
    type: symbolType,
    params,
    returnType,
    signature: symbol.signature,
  };
}

/**
 * Compare code and doc signatures to detect drift.
 */
export function compareSignatures(
  code: CodeSymbol,
  doc: DocSymbol,
): { detected: boolean; reason?: string } {
  // Check parameter count
  if (code.params.length !== doc.params.length) {
    return {
      detected: true,
      reason: `parameter count mismatch: code has ${code.params.length}, docs have ${doc.params.length}`,
    };
  }

  // Check parameter names
  for (let i = 0; i < code.params.length; i++) {
    const codeParam = code.params[i];
    const docParam = doc.params[i];

    if (!codeParam || !docParam) continue;

    if (codeParam.name !== docParam.name) {
      return {
        detected: true,
        reason: `parameter name mismatch at position ${i + 1}: code has '${codeParam.name}', docs have '${docParam.name}'`,
      };
    }

    // Check parameter types if both are documented
    if (codeParam.type && docParam.type) {
      // Normalize types for comparison (remove whitespace)
      const normalizedCodeType = codeParam.type.replace(/\s+/g, "");
      const normalizedDocType = docParam.type.replace(/\s+/g, "");

      if (normalizedCodeType !== normalizedDocType) {
        return {
          detected: true,
          reason: `parameter type mismatch for '${codeParam.name}': code has '${codeParam.type}', docs have '${docParam.type}'`,
        };
      }
    }
  }

  // Check return type if both are documented
  if (code.returnType && doc.returnType) {
    const normalizedCodeReturn = code.returnType.replace(/\s+/g, "");
    const normalizedDocReturn = doc.returnType.replace(/\s+/g, "");

    if (normalizedCodeReturn !== normalizedDocReturn) {
      return {
        detected: true,
        reason: `return type mismatch: code has '${code.returnType}', docs have '${doc.returnType}'`,
      };
    }
  }

  return { detected: false };
}

/**
 * Get appropriate parser for file extension.
 */
function getParser(filePath: string) {
  const ext = extname(filePath).toLowerCase();

  switch (ext) {
    case ".ts":
      return new TypeScriptParser(false);
    case ".tsx":
      return new TypeScriptParser(true);
    case ".js":
    case ".jsx":
      return new JavaScriptParser();
    case ".py":
      return new PythonParser();
    case ".rs":
      return new RustParser();
    case ".go":
      return new GoParser();
    default:
      return null;
  }
}

/**
 * Detect documentation drift in source files.
 */
export async function detectDrift(
  sourceFiles: string[],
  _projectRoot: string,
): Promise<DriftCheck[]> {
  const checks: DriftCheck[] = [];

  for (const file of sourceFiles) {
    const parser = getParser(file);
    if (!parser) continue;

    try {
      const source = await readFile(file, "utf-8");

      // Extract code signatures via tree-sitter
      const codeSymbols = parser.parse(source, file);

      // Extract doc signatures via JSDoc/TSDoc parsing
      const docSymbols = extractDocSignatures(source);

      // Compare symbols
      for (const symbol of codeSymbols) {
        // Only check functions and classes (interfaces/types don't have runtime params)
        // Also check const (arrow functions assigned to const)
        if (symbol.kind !== "function" && symbol.kind !== "const" && symbol.kind !== "class") {
          continue;
        }

        const docSymbol = docSymbols.find((d) => d.name === symbol.name);

        if (!docSymbol) {
          // Undocumented (not drift, just missing docs)
          continue;
        }

        const codeSymbol = symbolToCodeSymbol(symbol);
        const drift = compareSignatures(codeSymbol, docSymbol);

        if (drift.detected) {
          const driftType: "function" | "class" | "interface" | "type" =
            codeSymbol.type === "function" ? "function" : codeSymbol.type;

          checks.push({
            file,
            type: driftType,
            name: symbol.name,
            codeSignature: symbol.signature,
            docSignature: docSymbol.signature,
            driftDetected: true,
            driftReason: drift.reason,
          });
        }
      }
    } catch (_error) {
      // Skip files that can't be parsed
      continue;
    }
  }

  return checks;
}
