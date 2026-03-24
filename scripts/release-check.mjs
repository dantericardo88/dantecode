// ============================================================================
// DanteCode Release Gate — 10-check comprehensive pre-release validation
// Exit 1 if any check fails.
// ============================================================================

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnNpm } from "./npm-runner.mjs";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptsDir, "..");

const results = [];
let anyFailed = false;

function check(num, name, fn) {
  try {
    const result = fn();
    const passed = result.passed;
    if (!passed) anyFailed = true;
    results.push({ num, name, passed, detail: result.detail });
  } catch (err) {
    anyFailed = true;
    results.push({ num, name, passed: false, detail: err.message });
  }
}

function runCmd(cmd, args, cwd = repoRoot) {
  return spawnSync(cmd, args, { cwd, encoding: "utf8", env: process.env, timeout: 300_000 });
}

// ── Check 1: Build succeeds ────────────────────────────────────────────────

check(1, "Build (turbo)", () => {
  const r = spawnNpm(["run", "build"], repoRoot);
  const ok = r.status === 0;
  return { passed: ok, detail: ok ? "turbo build passed" : `exit ${r.status}` };
});

// ── Check 2: Tests succeed ────────────────────────────────────────────────

check(2, "Tests (turbo)", () => {
  const r = spawnNpm(["test"], repoRoot);
  const ok = r.status === 0;
  return { passed: ok, detail: ok ? "all tests passed" : `exit ${r.status}` };
});

// ── Check 3: Typecheck succeeds ───────────────────────────────────────────

check(3, "Typecheck (turbo)", () => {
  const r = spawnNpm(["run", "typecheck"], repoRoot);
  const ok = r.status === 0;
  return { passed: ok, detail: ok ? "typecheck passed" : `exit ${r.status}` };
});

// ── Check 4: Anti-stub scan ──────────────────────────────────────────────

check(4, "Anti-stub scan", () => {
  const stubPatterns = [
    /\bTODO\b/i,
    /\bFIXME\b/i,
    /\bTBD\b/,
    /\bplaceholder\b/i,
    /\bstub\b/i,
    /\bnot implemented\b/i,
    /throw new Error\(['"]implement/i,
  ];

  const skipDirs = new Set(["node_modules", "dist", ".git", ".turbo", "coverage"]);

  function isTestFile(name) {
    return name.endsWith(".test.ts") || name.endsWith(".test.tsx") ||
           name.endsWith(".spec.ts") || name.endsWith(".spec.tsx");
  }

  function shouldSkipLine(line) {
    const t = line.trim();
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/**") || t.startsWith("*/")) return true;
    if (line.includes("STUB_PATTERNS") || line.includes("HARD_VIOLATION") || line.includes("forbiddenPatterns")) return true;
    if (line.includes("pattern:") || line.includes("RegExp")) return true;
    if (line.includes("placeholder=") || line.includes("placeholder:") || line.includes(".placeholder")) return true;
    if (line.includes("placeHolder")) return true;
    if (line.includes("// antistub-ok")) return true;
    if (/\/[^/]*(?:todo|fixme|tbd|placeholder|stub)[^/]*\//i.test(line)) return true;
    if ((t.startsWith("`") || t.startsWith("'") || t.startsWith('"')) &&
        (line.toLowerCase().includes("todo") || line.toLowerCase().includes("fixme") ||
         line.toLowerCase().includes("placeholder") || line.toLowerCase().includes("stub"))) return true;
    if (line.includes("todo list") || line.includes("Todo") || line.includes(".todo")) return true;
    if (t.startsWith("case") && /['"]/.test(line)) return true;
    return false;
  }

  let violations = 0;

  function scanDir(dir) {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (skipDirs.has(entry.name)) continue;
        scanDir(fullPath);
      } else if ((entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) && !isTestFile(entry.name)) {
        const content = readFileSync(fullPath, "utf-8");
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (shouldSkipLine(line)) continue;
          for (const p of stubPatterns) {
            if (p.test(line)) violations++;
          }
        }
      }
    }
  }

  scanDir(join(repoRoot, "packages"));
  return { passed: violations === 0, detail: violations === 0 ? "no stubs found" : `${violations} violation(s)` };
});

// ── Check 5: Version alignment ───────────────────────────────────────────

check(5, "Version alignment", () => {
  const rootPkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf-8"));
  const rootVersion = rootPkg.version;
  const packagesDir = join(repoRoot, "packages");
  const mismatched = [];

  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const pkgPath = join(packagesDir, entry.name, "package.json");
    if (!existsSync(pkgPath)) continue;
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    if (pkg.version !== rootVersion) {
      mismatched.push(`${entry.name}: ${pkg.version}`);
    }
  }

  return {
    passed: mismatched.length === 0,
    detail: mismatched.length === 0 ? `all at ${rootVersion}` : `mismatched: ${mismatched.join(", ")}`,
  };
});

// ── Check 6: CLI smoke (--help exits 0) ──────────────────────────────────

check(6, "CLI smoke (--help)", () => {
  const cliEntry = join(repoRoot, "packages", "cli", "dist", "index.js");
  if (!existsSync(cliEntry)) return { passed: false, detail: "CLI not built" };
  const r = spawnSync(process.execPath, [cliEntry, "--help"], { cwd: repoRoot, encoding: "utf8", timeout: 30_000 });
  return { passed: r.status === 0, detail: r.status === 0 ? "exits 0" : `exit ${r.status}` };
});

// ── Check 7: CLI commands registered ─────────────────────────────────────

check(7, "CLI commands registered (17+)", () => {
  const cliEntry = join(repoRoot, "packages", "cli", "dist", "index.js");
  if (!existsSync(cliEntry)) return { passed: false, detail: "CLI not built" };
  const r = spawnSync(process.execPath, [cliEntry, "--help"], { cwd: repoRoot, encoding: "utf8", timeout: 30_000 });
  const output = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  // Count lines that look like registered commands (start with / or are indented command names)
  const commandLines = output.split("\n").filter(l => l.trim().startsWith("/") || /^\s{2,}\w+\s/.test(l));
  const count = commandLines.length;
  return { passed: count >= 17, detail: `${count} command(s) detected` };
});

// ── Check 8: No circular dependencies ────────────────────────────────────

check(8, "No circular dependencies", () => {
  const packagesDir = join(repoRoot, "packages");
  const pkgNames = new Map();

  // Build name -> deps map
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const pkgPath = join(packagesDir, entry.name, "package.json");
    if (!existsSync(pkgPath)) continue;
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    const deps = Object.keys(pkg.dependencies ?? {}).filter(d => d.startsWith("@dantecode/"));
    pkgNames.set(pkg.name, deps);
  }

  // Simple cycle detection via DFS
  const cycles = [];
  for (const [name] of pkgNames) {
    const visited = new Set();
    const stack = [name];
    const path = [];

    function dfs(current) {
      if (visited.has(current)) return;
      if (path.includes(current)) {
        cycles.push([...path.slice(path.indexOf(current)), current].join(" -> "));
        return;
      }
      path.push(current);
      for (const dep of pkgNames.get(current) ?? []) {
        dfs(dep);
      }
      path.pop();
      visited.add(current);
    }
    dfs(name);
  }

  return { passed: cycles.length === 0, detail: cycles.length === 0 ? "no cycles" : cycles.join("; ") };
});

// ── Check 9: Export verification ─────────────────────────────────────────

check(9, "Export verification (index.ts)", () => {
  const packagesDir = join(repoRoot, "packages");
  const missing = [];

  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const indexPath = join(packagesDir, entry.name, "src", "index.ts");
    if (!existsSync(indexPath)) continue;
    const content = readFileSync(indexPath, "utf-8");
    const hasExport = /export\s/.test(content);
    if (!hasExport) {
      missing.push(entry.name);
    }
  }

  return {
    passed: missing.length === 0,
    detail: missing.length === 0 ? "all packages export" : `no exports: ${missing.join(", ")}`,
  };
});

// ── Check 10: License + README ───────────────────────────────────────────

check(10, "License + README present", () => {
  const packagesDir = join(repoRoot, "packages");
  const missingLicense = [];
  const missingReadme = [];

  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const pkgPath = join(packagesDir, entry.name, "package.json");
    if (!existsSync(pkgPath)) continue;
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    if (pkg.private) continue; // skip private packages

    const dir = join(packagesDir, entry.name);
    if (!existsSync(join(dir, "LICENSE")) && !existsSync(join(dir, "LICENSE.md"))) {
      missingLicense.push(entry.name);
    }
    if (!existsSync(join(dir, "README.md"))) {
      missingReadme.push(entry.name);
    }
  }

  const allPresent = missingLicense.length === 0 && missingReadme.length === 0;
  const details = [];
  if (missingLicense.length > 0) details.push(`missing LICENSE: ${missingLicense.join(", ")}`);
  if (missingReadme.length > 0) details.push(`missing README: ${missingReadme.join(", ")}`);

  return { passed: allPresent, detail: allPresent ? "all present" : details.join("; ") };
});

// ── Output ───────────────────────────────────────────────────────────────

console.log("\nDanteCode Release Gate");
console.log("=".repeat(50));

for (const r of results) {
  const icon = r.passed ? "\u2713" : "\u2717";
  console.log(`  ${r.num.toString().padStart(2, " ")}. [${icon}] ${r.name} — ${r.detail}`);
}

const passed = results.filter(r => r.passed).length;
const failed = results.filter(r => !r.passed).length;

console.log("\n" + "=".repeat(50));
console.log(`Passed: ${passed}  Failed: ${failed}`);

if (anyFailed) {
  console.log("\nRelease gate FAILED. Fix the above issues before release.");
  process.exit(1);
} else {
  console.log("\nRelease gate PASSED. Ready for release.");
}
