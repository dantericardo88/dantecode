// ============================================================================
// packages/core/src/docs-quality.ts
//
// Dim 43 — Documentation quality
// Static docs quality checker: required files, word count, export coverage.
//
// Pattern: Diataxis four-quadrant model (tutorials/how-to/reference/explanation)
// ============================================================================

import { existsSync, appendFileSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DocsQualityResult {
  score: number;
  missingDocs: string[];
  thinDocs: string[];
  undocumentedExports: string[];
  checkedAt: string;
}

export interface DocsCheckConfig {
  projectRoot: string;
  requiredDocs?: string[];
  minWordCount?: number;
}

// ── Default required docs (Diataxis-structured) ───────────────────────────────

const DEFAULT_REQUIRED_DOCS = [
  "docs/getting-started.md",
  "docs/tutorials/first-task.md",
  "docs/how-to/configure-provider.md",
  "docs/how-to/use-fim.md",
  "docs/reference/config-schema.md",
  "docs/reference/cli-commands.md",
  "docs/explanation/architecture.md",
  "docs/CHANGELOG.md",
];

// ── Word count helper ─────────────────────────────────────────────────────────

function wordCount(text: string): number {
  return text
    .replace(/```[\s\S]*?```/g, "") // strip code blocks
    .replace(/`[^`]*`/g, "")        // strip inline code
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
}

// ── JSDoc coverage helper ─────────────────────────────────────────────────────

function findUndocumentedExports(sourceDir: string): string[] {
  const undocumented: string[] = [];
  if (!existsSync(sourceDir)) return undocumented;

  let files: string[] = [];
  try {
    // Synchronous scan of .ts files in source dir (non-recursive for speed)
    const entries = readdirSync(sourceDir);
    files = entries.filter((f: string) => f.endsWith(".ts") && !f.endsWith(".d.ts") && !f.endsWith(".test.ts"));
  } catch {
    return undocumented;
  }

  for (const file of files.slice(0, 20)) { // cap at 20 files
    try {
      const content = readFileSync(join(sourceDir, file), "utf-8");
      const exportLines = content.match(/^export (function|class|const|async function) \w+/gm) ?? [];
      for (const line of exportLines) {
        const fnName = line.replace(/^export (async function|function|class|const) /, "").split(/[\s(<(=]/)[0];
        if (!fnName) continue;
        // Check if preceded by JSDoc (within 5 lines above)
        const idx = content.indexOf(line);
        const before = content.slice(Math.max(0, idx - 400), idx);
        if (!before.includes("/**") || before.lastIndexOf("/**") < before.lastIndexOf("*/") - 10) {
          // Only flag if the most recent doc block closed more than 10 chars ago (no JSDoc immediately above)
          const hasJsDoc = /\/\*\*[\s\S]*?\*\/\s*$/.test(before.trimEnd());
          if (!hasJsDoc) {
            undocumented.push(`${file}:${fnName}`);
          }
        }
      }
    } catch { /* skip unreadable files */ }
  }
  return undocumented;
}

// ── checkDocsQuality ──────────────────────────────────────────────────────────

export async function checkDocsQuality(config: DocsCheckConfig): Promise<DocsQualityResult> {
  const {
    projectRoot,
    requiredDocs = DEFAULT_REQUIRED_DOCS,
    minWordCount = 200,
  } = config;

  const root = resolve(projectRoot);
  const missingDocs: string[] = [];
  const thinDocs: string[] = [];

  for (const docPath of requiredDocs) {
    const full = join(root, docPath);
    if (!existsSync(full)) {
      missingDocs.push(docPath);
      continue;
    }
    try {
      const content = readFileSync(full, "utf-8");
      if (wordCount(content) < minWordCount) {
        thinDocs.push(docPath);
      }
    } catch {
      thinDocs.push(docPath);
    }
  }

  const undocumentedExports = findUndocumentedExports(join(root, "packages", "core", "src"));

  const penalty =
    missingDocs.length * 15 +
    thinDocs.length * 5 +
    Math.min(undocumentedExports.length, 10); // cap undocumented penalty at 10

  const score = Math.max(0, Math.min(100, 100 - penalty));

  return {
    score,
    missingDocs,
    thinDocs,
    undocumentedExports: undocumentedExports.slice(0, 20),
    checkedAt: new Date().toISOString(),
  };
}

// ── generateDocsReport ────────────────────────────────────────────────────────

export function generateDocsReport(result: DocsQualityResult): string {
  const lines: string[] = [
    `# Documentation Quality Report`,
    `Checked: ${result.checkedAt}`,
    `**Score: ${result.score}/100**`,
    ``,
  ];

  if (result.missingDocs.length === 0 && result.thinDocs.length === 0) {
    lines.push(`✅ All required docs present and above word count threshold.`);
  }

  if (result.missingDocs.length > 0) {
    lines.push(`## Missing Docs (${result.missingDocs.length})`);
    for (const d of result.missingDocs) lines.push(`- \`${d}\``);
    lines.push(``);
  }

  if (result.thinDocs.length > 0) {
    lines.push(`## Thin Docs (${result.thinDocs.length}) — below word count threshold`);
    for (const d of result.thinDocs) lines.push(`- \`${d}\``);
    lines.push(``);
  }

  if (result.undocumentedExports.length > 0) {
    lines.push(`## Undocumented Exports (${result.undocumentedExports.length})`);
    for (const e of result.undocumentedExports.slice(0, 10)) lines.push(`- \`${e}\``);
    lines.push(``);
  }

  return lines.join("\n");
}

// ── JSONL Persistence ─────────────────────────────────────────────────────────

const DOCS_LOG_FILE = ".danteforge/docs-quality-log.jsonl";

export function recordDocsQuality(result: DocsQualityResult, projectRoot: string): void {
  try {
    const dir = join(resolve(projectRoot), ".danteforge");
    mkdirSync(dir, { recursive: true });
    appendFileSync(
      join(dir, "docs-quality-log.jsonl"),
      JSON.stringify(result) + "\n",
      "utf-8",
    );
  } catch { /* non-fatal */ }
}

export function loadDocsQualityLog(projectRoot: string): DocsQualityResult[] {
  const path = join(resolve(projectRoot), DOCS_LOG_FILE);
  if (!existsSync(path)) return [];
  try {
    return readFileSync(path, "utf-8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as DocsQualityResult);
  } catch {
    return [];
  }
}
