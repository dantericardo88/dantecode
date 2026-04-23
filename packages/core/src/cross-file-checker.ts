// Sprint AO — Dim 9: Cross-file consistency checker
// Validates that exported names in changed files match what their import consumers expect.
// Catches renamed exports that break downstream files without requiring a full typecheck.
import { readFileSync, existsSync } from "node:fs";

export interface ConsistencyIssue {
  type: "missing_export" | "name_mismatch" | "unresolved_import";
  sourceFile: string;
  importingFile?: string;
  symbol: string;
  detail: string;
}

export interface ConsistencyReport {
  checked: number;
  inconsistencies: ConsistencyIssue[];
  passed: boolean;
}

/** Extract named exports from a TypeScript/JavaScript file content. */
export function extractExports(content: string): Set<string> {
  const exports = new Set<string>();
  // export const/let/function/class/type/interface Name
  for (const m of content.matchAll(/^export\s+(?:const|let|function|class|type|interface|enum)\s+(\w+)/gm)) {
    if (m[1]) exports.add(m[1]);
  }
  // export { A, B, C }
  for (const m of content.matchAll(/^export\s*\{([^}]+)\}/gm)) {
    for (const name of (m[1] ?? "").split(",")) {
      const trimmed = name.trim().split(/\s+as\s+/)[0]?.trim();
      if (trimmed) exports.add(trimmed);
    }
  }
  return exports;
}

/** Extract named imports from a file content (for cross-file consistency checking). */
export function extractNamedImports(content: string): Map<string, string[]> {
  const imports = new Map<string, string[]>();
  for (const m of content.matchAll(/^import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/gm)) {
    const names: string[] = [];
    for (const part of (m[1] ?? "").split(",")) {
      const name = part.trim().split(/\s+as\s+/)[0]?.trim();
      if (name) names.push(name);
    }
    const source = m[2] ?? "";
    imports.set(source, [...(imports.get(source) ?? []), ...names]);
  }
  return imports;
}

export interface FileContent {
  path: string;
  content: string;
}

/**
 * Check that exported names in each file match what sibling files import from them.
 * Only validates files within the provided set (not external deps).
 */
export function checkExportImportMatch(files: FileContent[]): ConsistencyReport {
  const issues: ConsistencyIssue[] = [];
  const exportsByFile = new Map<string, Set<string>>();

  for (const f of files) {
    exportsByFile.set(f.path, extractExports(f.content));
  }

  for (const f of files) {
    const imports = extractNamedImports(f.content);
    for (const [source, names] of imports) {
      // Only check relative imports that resolve to a file in our set
      if (!source.startsWith(".")) continue;
      // Find matching file by basename
      const matchedFile = files.find((other) => {
        const base = other.path.replace(/\.(ts|tsx|js|jsx)$/, "");
        const srcBase = source.replace(/\.(ts|tsx|js|jsx)$/, "");
        return base.endsWith(srcBase) || base.endsWith(srcBase.replace("./", "/"));
      });
      if (!matchedFile) {
        issues.push({
          type: "unresolved_import",
          sourceFile: f.path,
          symbol: source,
          detail: `Cannot resolve "${source}" to any file in the changed set`,
        });
        continue;
      }
      const exports = exportsByFile.get(matchedFile.path) ?? new Set();
      for (const name of names) {
        if (!exports.has(name)) {
          issues.push({
            type: "missing_export",
            sourceFile: matchedFile.path,
            importingFile: f.path,
            symbol: name,
            detail: `"${name}" is imported in ${f.path} but not exported from ${matchedFile.path}`,
          });
        }
      }
    }
  }

  return { checked: files.length, inconsistencies: issues, passed: issues.length === 0 };
}

/** Read file contents from disk for cross-file checking. */
export function readFilesForCheck(paths: string[]): FileContent[] {
  return paths
    .filter((p) => existsSync(p) && /\.(ts|tsx|js|jsx)$/.test(p))
    .map((p) => ({ path: p, content: readFileSync(p, "utf-8") }));
}
