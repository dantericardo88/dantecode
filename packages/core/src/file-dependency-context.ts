// Sprint AP — Dim 4: File dependency context builder
// Scans import statements in recently-touched files and returns nearby related files.
// Used to enrich context injection so the agent sees related code without being asked.
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

export interface FileDependencyMap {
  file: string;
  imports: string[]; // resolved absolute paths of local imports
  importedBy: string[]; // other files in the set that import this one
}

export interface FileContextMap {
  touchedFiles: string[];
  dependencyMaps: FileDependencyMap[];
  relatedFiles: string[]; // files related but not in the touched set
  contextSummary: string;
}

/** Resolve a relative import path to an absolute path. */
function resolveImport(fromFile: string, importPath: string): string | null {
  if (!importPath.startsWith(".")) return null;
  const base = dirname(fromFile);
  const candidates = [
    resolve(base, importPath),
    resolve(base, importPath + ".ts"),
    resolve(base, importPath + ".tsx"),
    resolve(base, importPath + ".js"),
    resolve(base, importPath + "/index.ts"),
  ];
  return candidates.find((c) => existsSync(c)) ?? null;
}

/** Extract relative import paths from file content. */
function extractRelativeImports(content: string): string[] {
  const imports: string[] = [];
  for (const m of content.matchAll(/from\s*['"](\.[^'"]+)['"]/g)) {
    if (m[1]) imports.push(m[1]);
  }
  for (const m of content.matchAll(/require\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
    if (m[1]) imports.push(m[1]);
  }
  return imports;
}

/**
 * Build a dependency map for the given files.
 * Also surfaces related files (imported by touched files but not in the set).
 */
export function buildFileContextMap(touchedFiles: string[], projectRoot = process.cwd()): FileContextMap {
  const root = resolve(projectRoot);
  const absFiles = touchedFiles.map((f) => (f.startsWith("/") || /^[A-Z]:/i.test(f) ? f : join(root, f)));
  const touchedSet = new Set(absFiles);
  const dependencyMaps: FileDependencyMap[] = [];
  const relatedSet = new Set<string>();

  for (const filePath of absFiles) {
    if (!existsSync(filePath)) {
      dependencyMaps.push({ file: filePath, imports: [], importedBy: [] });
      continue;
    }
    let content: string;
    try {
      content = readFileSync(filePath, "utf-8");
    } catch {
      dependencyMaps.push({ file: filePath, imports: [], importedBy: [] });
      continue;
    }
    const rawImports = extractRelativeImports(content);
    const resolvedImports: string[] = [];
    for (const imp of rawImports) {
      const resolved = resolveImport(filePath, imp);
      if (resolved) {
        resolvedImports.push(resolved);
        if (!touchedSet.has(resolved)) {
          relatedSet.add(resolved);
        }
      }
    }
    dependencyMaps.push({ file: filePath, imports: resolvedImports, importedBy: [] });
  }

  // Build importedBy relationships
  for (const dep of dependencyMaps) {
    for (const imp of dep.imports) {
      const target = dependencyMaps.find((d) => d.file === imp);
      if (target) {
        target.importedBy.push(dep.file);
      }
    }
  }

  const relatedFiles = Array.from(relatedSet).slice(0, 10);
  const contextSummary = [
    `Touched: ${absFiles.length} file(s)`,
    relatedFiles.length > 0
      ? `Related (imported by touched): ${relatedFiles.map((f) => f.split(/[/\\]/).pop()).join(", ")}`
      : "No related files detected",
  ].join(" | ");

  return { touchedFiles: absFiles, dependencyMaps, relatedFiles, contextSummary };
}
