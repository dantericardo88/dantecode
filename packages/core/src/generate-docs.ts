// ============================================================================
// @dantecode/core — API Documentation Generator
//
// Reads packages/core/src/index.ts, extracts exported names with their kind
// (class / function / interface / type / const / enum), and writes a Markdown
// table to the specified output path.
//
// Usage (via root package.json "docs" script):
//   node --loader ts-node/esm packages/core/src/generate-docs.ts docs/API.md
// ============================================================================

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ApiDocEntry {
  /** Exported name (e.g. "BackgroundSemanticIndex") */
  name: string;
  /** Kind of export (class, function, interface, type, const, enum) */
  kind: "class" | "function" | "interface" | "type" | "const" | "enum" | "other";
  /** Short description from the nearest JSDoc comment, or empty string */
  description: string;
  /** Source module file, relative to packages/core/src/ */
  sourceFile: string;
}

// ---------------------------------------------------------------------------
// Extraction helpers
// ---------------------------------------------------------------------------

type ExportKind = ApiDocEntry["kind"];

function normalizeKind(raw: string): ExportKind {
  const k = raw.trim().replace(/^abstract\s+/, "");
  if (k === "class") return "class";
  if (k === "function") return "function";
  if (k === "interface") return "interface";
  if (k === "type") return "type";
  if (k === "enum") return "enum";
  if (k === "const" || k === "let" || k === "var") return "const";
  return "other";
}

/**
 * Parses an index.ts content and returns one `ApiDocEntry` per exported name.
 * The description field is always empty (JSDoc extraction is not in scope for
 * the lightweight generator — it reads index.ts not source files).
 */
export function parseIndexExports(content: string): ApiDocEntry[] {
  const entries: ApiDocEntry[] = [];
  const seen = new Set<string>();

  function add(name: string, kind: ExportKind, sourceFile: string) {
    const trimmed = name.trim();
    // Skip re-exported type aliases like `as X`
    if (!trimmed || trimmed.startsWith("//") || seen.has(trimmed)) return;
    seen.add(trimmed);
    entries.push({ name: trimmed, kind, description: "", sourceFile });
  }

  // Multi-name re-exports: export { Foo, Bar, type Baz } from "./foo.js"
  const multiRe =
    /export\s+(?:type\s+)?\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = multiRe.exec(content)) !== null) {
    const names = (m[1] ?? "").split(",");
    const src = (m[2] ?? "").replace(/^\.\//, "").replace(/\.js$/, ".ts");
    for (const raw of names) {
      // Handle "name as alias" → use alias
      const parts = raw.trim().split(/\s+as\s+/);
      const exported = (parts[parts.length - 1] ?? "").trim().replace(/^type\s+/, "");
      add(exported, "other", src);
    }
  }

  // Single-name re-exports with kind: export { class Foo } from ...
  // (TypeScript doesn't actually use this form but covers edge cases)
  const singleWithKindRe =
    /export\s+(class|function|interface|type|const|enum)\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g;
  while ((m = singleWithKindRe.exec(content)) !== null) {
    add(m[2] ?? "", normalizeKind(m[1] ?? ""), (m[3] ?? "").replace(/^\.\//, "").replace(/\.js$/, ".ts"));
  }

  // Inline declarations: export class Foo / export function bar
  const inlineRe =
    /export\s+(?:declare\s+)?(?:abstract\s+)?(class|function|interface|type|const|let|var|enum)\s+(\w+)/g;
  while ((m = inlineRe.exec(content)) !== null) {
    add(m[2] ?? "", normalizeKind(m[1] ?? ""), "index.ts");
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Markdown rendering
// ---------------------------------------------------------------------------

const KIND_BADGE: Record<ExportKind, string> = {
  class: "class",
  function: "fn",
  interface: "interface",
  type: "type",
  const: "const",
  enum: "enum",
  other: "–",
};

export function renderApiMarkdown(entries: ApiDocEntry[]): string {
  const lines: string[] = [
    "# DanteCode Core — Public API",
    "",
    "> Auto-generated from `packages/core/src/index.ts`.",
    "> Run `npm run docs` to regenerate.",
    "",
    `| Export | Kind | Source | Description |`,
    `|--------|------|--------|-------------|`,
  ];

  for (const e of entries) {
    const badge = KIND_BADGE[e.kind] ?? "–";
    const desc = e.description || "–";
    lines.push(`| \`${e.name}\` | ${badge} | \`${e.sourceFile}\` | ${desc} |`);
  }

  lines.push("");
  lines.push(`_${entries.length} exports total._`);
  lines.push("");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main entry-point
// ---------------------------------------------------------------------------

/**
 * Reads `packages/core/src/index.ts`, extracts all exported names,
 * and writes a Markdown API table to `outputPath`.
 */
export async function generateApiDocs(outputPath: string): Promise<void> {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);

  const indexPath = join(__dirname, "index.ts");
  const content = await readFile(indexPath, "utf-8");

  const entries = parseIndexExports(content);

  // Sort by kind then name
  const kindOrder: ExportKind[] = ["class", "function", "interface", "type", "enum", "const", "other"];
  entries.sort((a, b) => {
    const ai = kindOrder.indexOf(a.kind);
    const bi = kindOrder.indexOf(b.kind);
    if (ai !== bi) return ai - bi;
    return a.name.localeCompare(b.name);
  });

  const markdown = renderApiMarkdown(entries);

  // Ensure output directory exists
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, markdown, "utf-8");

  process.stdout.write(`[docs] Wrote ${entries.length} exports to ${outputPath}\n`);
}

// ---------------------------------------------------------------------------
// CLI entry-point (node --loader ts-node/esm ... docs/API.md)
// ---------------------------------------------------------------------------

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const outputArg = process.argv[2] ?? "docs/API.md";
  generateApiDocs(outputArg).catch((err) => {
    process.stderr.write(`[docs] Error: ${err}\n`);
    process.exit(1);
  });
}
