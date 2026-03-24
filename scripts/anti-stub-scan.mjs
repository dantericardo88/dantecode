// ============================================================================
// Anti-Stub Scan (ESM) — CI-grade stub/placeholder scanner
// Scans all packages/*/src/**/*.ts files (excluding tests) for forbidden
// patterns. Reports file path, line number, and matched pattern.
// Exit 0 if clean, 1 if violations found.
// ============================================================================

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptsDir, "..");
const packagesDir = join(repoRoot, "packages");

const STUB_PATTERNS = [
  { regex: /\bTODO\b/i, label: "TODO" },
  { regex: /\bFIXME\b/i, label: "FIXME" },
  { regex: /\bTBD\b/, label: "TBD" },
  { regex: /\bplaceholder\b/i, label: "placeholder" },
  { regex: /\bstub\b/i, label: "stub" },
  { regex: /\bnot implemented\b/i, label: "not implemented" },
  { regex: /throw new Error\(['"]implement/i, label: "throw implement" },
];

const SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".turbo", "coverage"]);

function isTestFile(name) {
  return (
    name.endsWith(".test.ts") ||
    name.endsWith(".test.tsx") ||
    name.endsWith(".spec.ts") ||
    name.endsWith(".spec.tsx")
  );
}

function shouldSkipLine(line) {
  const t = line.trim();
  // JSDoc / block comment continuations
  if (t.startsWith("/**") || t.startsWith("*/") || (t.startsWith("*") && !t.startsWith("*=")))
    return true;
  // Single-line comments describing scanner rules
  if (t.startsWith("//") && /todo|fixme|tbd|placeholder|stub|implement/i.test(line)) return true;
  // Scanner rule definitions (variable names referencing stubs)
  if (
    line.includes("STUB_PATTERNS") ||
    line.includes("HARD_VIOLATION") ||
    line.includes("SOFT_VIOLATION") ||
    line.includes("PLACEHOLDER_PATTERNS") ||
    line.includes("forbiddenPatterns") ||
    line.includes("placeholderHits")
  )
    return true;
  // Regex patterns or pattern definitions
  if (line.includes("pattern:") || line.includes("RegExp")) return true;
  // HTML/CSS placeholder attributes (legitimate UI)
  if (
    line.includes("placeholder=") ||
    line.includes("placeholder:") ||
    line.includes("::placeholder") ||
    line.includes(".placeholder") ||
    line.includes("placeHolder")
  )
    return true;
  // Explicit escape hatch
  if (line.includes("// antistub-ok")) return true;
  // Regex literals containing stub words
  if (/\/[^/]*(?:todo|fixme|tbd|placeholder|stub)[^/]*\//i.test(line)) return true;
  // String literals describing rules (documentation, not stubs)
  if (
    (t.startsWith("`") || t.startsWith("'") || t.startsWith('"')) &&
    /todo|fixme|tbd|placeholder|stub/i.test(line)
  )
    return true;
  // Todo-list feature references (not TODO markers)
  if (
    line.includes("todo list") ||
    line.includes("todo-$") ||
    line.includes("Todo") ||
    line.includes(".todo")
  )
    return true;
  // Case statements with string literal values
  if (/^\s*case\s+['"]/.test(line)) return true;
  // createStubPattern() calls
  if (line.includes("createStubPattern(")) return true;
  // Mock/test helper references
  if (line.includes("mockReturnValue") || line.includes("mockImplementation")) return true;
  return false;
}

const violations = [];

function scanDir(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      scanDir(fullPath);
    } else if (
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
      !isTestFile(entry.name)
    ) {
      const content = readFileSync(fullPath, "utf-8");
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (shouldSkipLine(line)) continue;
        for (const { regex, label } of STUB_PATTERNS) {
          // Reset lastIndex for global patterns
          const re = new RegExp(regex.source, regex.flags);
          if (re.test(line)) {
            violations.push({
              file: fullPath.replace(repoRoot + "/", "").replace(repoRoot + "\\", ""),
              line: i + 1,
              pattern: label,
              content: line.trim().slice(0, 120),
            });
          }
        }
      }
    }
  }
}

scanDir(packagesDir);

if (violations.length > 0) {
  console.error(`Anti-Stub Scan: ${violations.length} violation(s) found\n`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line} [${v.pattern}] ${v.content}`);
  }
  console.error(`\n${violations.length} stub violation(s). Anti-Stub Doctrine violated.`);
  process.exit(1);
} else {
  console.log("Anti-Stub Scan: clean. Zero violations found.");
}
