// ============================================================================
// @dantecode/core — Repo Brain / Persistent Project Intelligence
// ============================================================================

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { execSync } from "node:child_process";
import { generateRepoMap } from "@dantecode/git-engine";

export interface FileNode {
  path: string;
  imports: string[];
  exports: string[];
  symbols: string[];
}

export interface SymbolNode {
  name: string;
  kind: "function" | "class" | "variable" | "interface";
  file: string;
  references: string[];
}

export interface TestRelevance {
  testFile: string;
  sourceFiles: string[];
}

export interface Hotspot {
  file: string;
  changeCount: number;
}

export interface RepoMemory {
  fileGraph: FileNode[];
  symbolGraph: SymbolNode[];
  testMap: TestRelevance[];
  hotspots: Hotspot[];
  lastUpdated: string;
}

const REPO_MEMORY_PATH = ".dantecode/repo_memory.json";

export async function generateRepoMemory(projectRoot: string): Promise<RepoMemory> {
  const repoMap = generateRepoMap(projectRoot, { maxFiles: 1000 });

  // Generate file graph
  const fileGraph = await generateFileGraph(projectRoot, repoMap);

  // Generate symbol graph
  const symbolGraph = await generateSymbolGraph(projectRoot, repoMap);

  // Generate test map
  const testMap = await generateTestMap(projectRoot, repoMap);

  // Generate hotspots
  const hotspots = await generateHotspots(projectRoot);

  const memory: RepoMemory = {
    fileGraph,
    symbolGraph,
    testMap,
    hotspots,
    lastUpdated: new Date().toISOString(),
  };

  // Save to file
  const memoryPath = join(projectRoot, REPO_MEMORY_PATH);
  await mkdir(dirname(memoryPath), { recursive: true });
  await writeFile(memoryPath, JSON.stringify(memory, null, 2));

  return memory;
}

async function generateFileGraph(projectRoot: string, repoMap: any[]): Promise<FileNode[]> {
  const nodes: FileNode[] = [];

  for (const entry of repoMap) {
    if (
      !entry.path.endsWith(".ts") &&
      !entry.path.endsWith(".js") &&
      !entry.path.endsWith(".tsx") &&
      !entry.path.endsWith(".jsx")
    )
      continue;

    try {
      const content = await readFile(join(projectRoot, entry.path), "utf-8");
      const imports = extractImports(content);
      const exports = extractExports(content);
      const symbols = extractSymbols(content);

      nodes.push({
        path: entry.path,
        imports,
        exports,
        symbols,
      });
    } catch {
      // Skip files that can't be read
    }
  }

  return nodes;
}

function extractImports(content: string): string[] {
  const imports: string[] = [];
  const importRegex = /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g;
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    if (match[1]) {
      imports.push(match[1]);
    }
  }
  return imports;
}

function extractExports(content: string): string[] {
  const exports: string[] = [];
  const exportRegex = /export\s+(?:const|let|var|function|class|interface|type)\s+(\w+)/g;
  let match;
  while ((match = exportRegex.exec(content)) !== null) {
    if (match[1]) {
      exports.push(match[1]);
    }
  }
  return exports;
}

function extractSymbols(content: string): string[] {
  const symbols: string[] = [];
  // Simple regex for functions, classes
  const funcRegex = /(?:function|const|let|var)\s+(\w+)\s*[=(]/g;
  const classRegex = /class\s+(\w+)/g;
  let match;
  while ((match = funcRegex.exec(content)) !== null) {
    if (match[1]) {
      symbols.push(match[1]);
    }
  }
  while ((match = classRegex.exec(content)) !== null) {
    if (match[1]) {
      symbols.push(match[1]);
    }
  }
  return [...new Set(symbols)];
}

async function generateSymbolGraph(projectRoot: string, repoMap: any[]): Promise<SymbolNode[]> {
  // Simplified: for each file, extract symbols
  const nodes: SymbolNode[] = [];

  for (const entry of repoMap) {
    if (!entry.path.endsWith(".ts") && !entry.path.endsWith(".js")) continue;

    try {
      const content = await readFile(join(projectRoot, entry.path), "utf-8");
      const symbols = extractSymbols(content);
      for (const symbol of symbols) {
        nodes.push({
          name: symbol,
          kind: content.includes(`function ${symbol}`)
            ? "function"
            : content.includes(`class ${symbol}`)
              ? "class"
              : "variable",
          file: entry.path,
          references: [], // TODO: analyze references
        });
      }
    } catch {
      // Skip
    }
  }

  return nodes;
}

async function generateTestMap(_projectRoot: string, repoMap: any[]): Promise<TestRelevance[]> {
  const testMap: TestRelevance[] = [];

  const testFiles = repoMap.filter((e) => e.path.includes(".test.") || e.path.includes(".spec."));
  const sourceFiles = repoMap.filter(
    (e) => !e.path.includes(".test.") && !e.path.includes(".spec."),
  );

  for (const test of testFiles) {
    const sourceFilesForTest = sourceFiles.filter((s) =>
      test.path.replace(".test.", ".").replace(".spec.", ".").includes(s.path.split("/").pop()!),
    );
    testMap.push({
      testFile: test.path,
      sourceFiles: sourceFilesForTest.map((s) => s.path),
    });
  }

  return testMap;
}

async function generateHotspots(projectRoot: string): Promise<Hotspot[]> {
  try {
    const output = execSync("git log --name-only --pretty=format: | head -1000", {
      cwd: projectRoot,
      encoding: "utf-8",
    });
    const lines = output.split("\n").filter((l) => l.trim());
    const counts: Record<string, number> = {};
    for (const line of lines) {
      counts[line] = (counts[line] || 0) + 1;
    }
    return Object.entries(counts)
      .map(([file, count]) => ({ file, changeCount: count }))
      .sort((a, b) => b.changeCount - a.changeCount)
      .slice(0, 50);
  } catch {
    return [];
  }
}

export async function loadRepoMemory(projectRoot: string): Promise<RepoMemory | null> {
  try {
    const data = await readFile(join(projectRoot, REPO_MEMORY_PATH), "utf-8");
    return JSON.parse(data);
  } catch {
    return null;
  }
}

/**
 * Analyze git log to find files that frequently change together with the
 * given target file. Uses commit co-occurrence counting over the last 500 commits.
 *
 * @param projectRoot  Absolute path to the git repository root
 * @param targetFile   Relative path to the file of interest
 * @param limit        Maximum number of co-change partners to return
 * @returns Array of relative file paths sorted by co-occurrence count (descending)
 */
export async function getCoChangeFiles(
  projectRoot: string,
  targetFile: string,
  limit = 5,
): Promise<string[]> {
  try {
    // Get all commits that touched the target file
    const commitOutput = execSync(
      `git log --follow --pretty=format:"%H" -- "${targetFile}"`,
      { cwd: projectRoot, encoding: "utf-8", timeout: 5000 },
    );

    const commits = commitOutput
      .split("\n")
      .map((c) => c.trim())
      .filter((c) => c.length === 40)
      .slice(0, 200); // cap at 200 commits for performance

    if (commits.length === 0) return [];

    // For each commit, find which other files changed alongside the target
    const coChangeCounts: Record<string, number> = {};

    for (const commit of commits) {
      try {
        const filesInCommit = execSync(
          `git diff-tree --no-commit-id -r --name-only "${commit}"`,
          { cwd: projectRoot, encoding: "utf-8", timeout: 2000 },
        );
        const files = filesInCommit
          .split("\n")
          .map((f) => f.trim())
          .filter((f) => f.length > 0 && f !== targetFile);

        for (const f of files) {
          coChangeCounts[f] = (coChangeCounts[f] ?? 0) + 1;
        }
      } catch {
        // Individual commit lookup failure — skip
      }
    }

    return Object.entries(coChangeCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([file]) => file);
  } catch {
    return [];
  }
}
