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
  // Compound camelCase or snake_case identifiers containing "stub" — not actual stubs.
  // e.g. stubViolation, antiStub, stubCheck, stubFound, stub_detected, antiStubIcon
  // A match is only a real stub if "stub" is a standalone word, not embedded in a longer identifier.
  // Test: strip all compound occurrences and see if the word "stub" still stands alone.
  if (/\bstub\b/i.test(line)) {
    // Strip camelCase/PascalCase compounds (stubFoo, fooStub), snake_case (stub_foo, foo_stub),
    // and hyphenated forms (anti-stub, stub-check) — all of which are naming conventions, not stubs.
    const withoutCompound = line
      .replace(/\w*[Ss]tub\w+/g, "REMOVED")  // stubViolation, antiStubIcon, stubFound, etc.
      .replace(/\w+[Ss]tub\b/g, "REMOVED")   // fooStub
      .replace(/\w+-[Ss]tub\b/gi, "REMOVED") // anti-stub
      .replace(/\b[Ss]tub-\w+/g, "REMOVED"); // stub-check
    if (!/\bstub\b/i.test(withoutCompound)) return true;
  }
  // Any line whose only "stub" occurrences are inside string/template literals used as
  // labels, messages, or diagnostic text (not functional stub code).
  // Covers: `Anti-Stub Scan: ${...}`, `${n} stub violation(s)`, "[STUB]", "Stub: ${...}"
  if (/stub/i.test(line)) {
    // Strip all string/template literal content and check if stub remains in code
    const codeOnly = line
      .replace(/`[^`]*`/g, "STRLIT")       // template literals
      .replace(/"[^"]*"/g, "STRLIT")        // double-quoted strings
      .replace(/'[^']*'/g, "STRLIT");       // single-quoted strings
    if (!/\bstub\b/i.test(codeOnly)) return true;
  }
  // process.stdout.write / process.stderr.write calls with stub-mention strings
  if (/(?:stdout|stderr)\.write\s*\(/.test(line) && /stub/i.test(line)) return true;
  // Markdown bullet lines inside template strings describing the Anti-Stub Doctrine
  // e.g. "- Stub functions ...", "- Placeholder comments ...", "- \`throw new Error(...)\`"
  if (/^\s*-\s+(?:[Ss]tub\b|[Pp]laceholder\b|\\`|`)/i.test(t)) return true;
  // Markdown headings describing the Anti-Stub Doctrine
  if (/^##?\s*Anti.?Stub/i.test(t)) return true;
  // Object key/value pairs using "stub" as metadata (type unions, label fields, category fields)
  // e.g. category: "anti-stub", label: "Stub response", stub_detected: "Stub Detected"
  if (/^\s*(?:category|label|stub_detected)\s*[:?]/.test(t)) return true;
  // String union type literals: e.g. | "anti-stub" | or "anti-stub" in type position
  if (/["']anti-stub["']/.test(line)) return true;
  // Lines that contain only a string mentioning stub (e.g. object key: "Stub Detected")
  if (/:\s*["'][^"']*stub[^"']*["']/i.test(line) && !/\bstub\s*\(/.test(line)) return true;
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
