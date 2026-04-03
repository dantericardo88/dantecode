// ============================================================================
// DanteCode VS Code Extension — Cross-File Context Gatherer
// Extracts exported symbols from neighbouring open files and import targets
// to supply additional context for FIM completions. The output is a compact
// string of signature lines that can be prepended to a FIM prompt.
// ============================================================================

/**
 * Options passed to {@link gatherCrossFileContext}.
 */
export interface CrossFileContextOptions {
  /** Absolute path to the file currently being edited. */
  currentFilePath: string;
  /** Absolute paths of all files open in editor tabs. */
  openFilePaths: string[];
  /** Absolute paths of recently edited files (highest priority). */
  recentEditPaths?: string[];
  /** Rough token budget for the context block (default 1000; ~4 chars/token). */
  maxTokenBudget?: number;
  /** Callback that reads the full text of a file by its absolute path. */
  readFile: (path: string) => Promise<string>;
}

// ---------------------------------------------------------------------------
// Import path extraction
// ---------------------------------------------------------------------------

/**
 * Regex that captures a module specifier from an ES `import` statement.
 * It matches:
 *   import ... from "specifier"
 *   import ... from 'specifier'
 *   import "specifier"
 *
 * Only relative specifiers (starting with `.`) are of interest — bare
 * package names are ignored since we cannot resolve them to open tabs.
 */
const IMPORT_RE = /import\s+(?:[\s\S]*?from\s+)?['"]([^'"]+)['"]/g;

/**
 * Extracts relative import specifiers from a source file.
 */
export function extractImportPaths(source: string): string[] {
  const paths: string[] = [];
  let match: RegExpExecArray | null;
  // Reset lastIndex in case the regex was used before.
  IMPORT_RE.lastIndex = 0;
  while ((match = IMPORT_RE.exec(source)) !== null) {
    const specifier = match[1];
    if (specifier && specifier.startsWith(".")) {
      paths.push(specifier);
    }
  }
  return paths;
}

// ---------------------------------------------------------------------------
// Exported symbol extraction
// ---------------------------------------------------------------------------

/**
 * Regex that matches a single-line exported declaration:
 *   export function foo(...)
 *   export async function bar(...)
 *   export class Baz ...
 *   export interface Qux ...
 *   export type Alias = ...
 *   export const/let/var name ...
 *
 * Captures the signature up to the first `{` or `=` so function bodies and
 * initializers are omitted.
 */
const EXPORT_SIG_RE =
  /^export\s+(?:default\s+)?(?:async\s+)?(?:function|class|interface|type|const|let|var)\b[^{=;]*/gm;

/**
 * Extracts one-line exported symbol signatures from a source file.
 */
export function extractExportedSignatures(source: string): string[] {
  EXPORT_SIG_RE.lastIndex = 0;
  const sigs: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = EXPORT_SIG_RE.exec(source)) !== null) {
    const sig = match[0].trim();
    if (sig.length > 0) {
      sigs.push(sig);
    }
  }
  return sigs;
}

// ---------------------------------------------------------------------------
// Path matching helper
// ---------------------------------------------------------------------------

/**
 * Returns true if `candidatePath` could be the resolution of `importSpec`
 * relative to `currentFilePath`. The comparison is approximate: it
 * normalises both sides to forward-slash paths, strips common extensions,
 * and checks whether the candidate ends with the specifier.
 */
function pathMatchesImport(candidatePath: string, importSpec: string): boolean {
  const normalise = (p: string): string =>
    p
      .replace(/\\/g, "/")
      .replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, "")
      .replace(/\/index$/, "");

  const normCandidate = normalise(candidatePath);
  const normImport = normalise(importSpec);

  // The import spec is relative (e.g. `./utils`). Check if the candidate
  // path ends with the base portion of the specifier.
  const importBase = normImport.replace(/^\.\//, "").replace(/^\.\.\//, "");
  return normCandidate.endsWith(importBase);
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Gathers a compact block of cross-file context suitable for injection into
 * a FIM prompt.
 *
 * The algorithm:
 * 1. Read the current file to discover import specifiers.
 * 2. Build a priority-ordered list of context source files:
 *    a. Recently edited files that are also imported.
 *    b. Open files that are imported.
 *    c. Recently edited files not yet included.
 *    d. Remaining open files not yet included.
 * 3. For each source file, extract exported signatures.
 * 4. Format each signature as `// From <shortPath>: <signature>`.
 * 5. Accumulate lines until the token budget is exhausted.
 *
 * @returns A string of context lines separated by `\n`, or an empty string
 *          if no useful context could be gathered.
 */
export async function gatherCrossFileContext(options: CrossFileContextOptions): Promise<string> {
  const {
    currentFilePath,
    openFilePaths,
    recentEditPaths = [],
    maxTokenBudget = 1000,
    readFile,
  } = options;

  const charBudget = maxTokenBudget * 4;

  // 1. Read the current file and extract import paths.
  let currentSource: string;
  try {
    currentSource = await readFile(currentFilePath);
  } catch {
    return "";
  }

  const importSpecs = extractImportPaths(currentSource);

  // 2. Classify open/recent files.
  const otherFiles = [...new Set([...recentEditPaths, ...openFilePaths])].filter(
    (p) => p !== currentFilePath,
  );

  const isImported = (filePath: string): boolean =>
    importSpecs.some((spec) => pathMatchesImport(filePath, spec));

  const isRecent = (filePath: string): boolean => recentEditPaths.includes(filePath);

  // Sort: imported+recent > imported > recent > rest.
  const sorted = [...otherFiles].sort((a, b) => {
    const scoreOf = (p: string): number => {
      let s = 0;
      if (isImported(p)) s += 2;
      if (isRecent(p)) s += 1;
      return s;
    };
    return scoreOf(b) - scoreOf(a);
  });

  // 3. Gather signatures from each file until budget is consumed.
  const lines: string[] = [];
  let usedChars = 0;

  for (const filePath of sorted) {
    if (usedChars >= charBudget) break;

    let source: string;
    try {
      source = await readFile(filePath);
    } catch {
      continue;
    }

    const sigs = extractExportedSignatures(source);
    if (sigs.length === 0) continue;

    // Derive a short display path (last two segments).
    const shortPath = filePath.replace(/\\/g, "/").split("/").slice(-2).join("/");

    for (const sig of sigs) {
      const line = `// From ${shortPath}: ${sig}`;
      if (usedChars + line.length > charBudget) break;
      lines.push(line);
      usedChars += line.length;
    }
  }

  return lines.join("\n");
}
