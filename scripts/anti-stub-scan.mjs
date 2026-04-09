// ============================================================================
// DanteCode Anti-Stub Scanner
// Scans codebase for incomplete implementations using DanteForge anti-stub system
// Part of the anti-overclaiming enforcement system
// ============================================================================

import { glob } from "glob";
import { readFileSync, existsSync } from "fs";
import { join, resolve, relative } from "path";

const ROOT_DIR = resolve(process.cwd());

async function main() {
  console.log("🔍 DanteCode Anti-Stub Scanner");
  console.log("==============================");

  // Find all source files
  const patterns = [
    "packages/*/src/**/*.{ts,tsx,js,jsx}",
    "scripts/**/*.{ts,tsx,js,jsx,mjs}",
    "!packages/*/dist/**",
    "!packages/*/node_modules/**",
    "!packages/*/build/**",
  ];

  const files = [];
  for (const pattern of patterns) {
    try {
      const matches = await glob(pattern, { cwd: ROOT_DIR });
      files.push(...matches);
    } catch {
      // Ignore glob errors
    }
  }

  console.log(`📁 Scanning ${files.length} files...`);

  let totalHardViolations = 0;
  let totalSoftViolations = 0;
  let filesWithViolations = 0;

  for (const file of files) {
    const fullPath = join(ROOT_DIR, file);

    if (!existsSync(fullPath)) continue;

    try {
      const content = readFileSync(fullPath, "utf8");
      const result = await scanFileWithDanteForge(content, file);

      if (result.hardViolations.length > 0 || result.softViolations.length > 0) {
        console.log(`❌ ${relative(ROOT_DIR, fullPath)}`);
        filesWithViolations++;

        result.hardViolations.forEach((v) => {
          console.log(`   🔴 HARD: ${v.message} (line ${v.lineNumber || "?"})`);
          totalHardViolations++;
        });

        result.softViolations.forEach((v) => {
          console.log(`   🟡 SOFT: ${v.message} (line ${v.lineNumber || "?"})`);
          totalSoftViolations++;
        });
      }
    } catch (error) {
      // Skip files that can't be scanned
      continue;
    }
  }

  console.log("");
  console.log("📊 Summary:");
  console.log(`   Files scanned: ${files.length}`);
  console.log(`   Files with violations: ${filesWithViolations}`);
  console.log(`   Hard violations: ${totalHardViolations}`);
  console.log(`   Soft violations: ${totalSoftViolations}`);

  if (totalHardViolations > 0) {
    console.log("");
    console.log("🚫 CRITICAL: Hard violations found - commit blocked");
    console.log("💡 Fix hard violations (TODO, FIXME, unimplemented functions) before committing");
    process.exit(1);
  } else if (totalSoftViolations > 0) {
    console.log("");
    console.log("⚠️  Soft violations found - review recommended");
    console.log("💡 Consider fixing soft violations (type any, console.log, skipped tests)");
    console.log("✅ Proceeding (soft violations don't block commits)");
  } else {
    console.log("");
    console.log("✅ NO VIOLATIONS FOUND");
    console.log("🎉 Code is anti-stub clean!");
  }
}

async function scanFileWithDanteForge(content, filePath) {
  try {
    // Try to use DanteForge anti-stub scanner
    const { runAntiStubScanner } = await import("@dantecode/danteforge");
    return runAntiStubScanner(content, filePath);
  } catch {
    // Fallback to basic pattern matching if DanteForge not available
    return fallbackAntiStubScan(content, filePath);
  }
}

function fallbackAntiStubScan(content, filePath) {
  const lines = content.split("\n");
  const hardViolations = [];
  const softViolations = [];

  const hardPatterns = [
    /\bTODO\b/i,
    /\bFIXME\b/i,
    /\bHACK\b/i,
    /throw\s+new\s+Error\s*\(\s*['"`]not\s+implemented['"`]\s*\)/i,
    /throw\s+new\s+Error\s*\(\s*['"`]todo['"`]\s*\)/i,
    /^\s*\.\.\.\s*$/,
    /^\s*pass\s*$/,
    /\bplaceholder\b/i,
    /\bnotImplemented\b/i,
  ];

  const softPatterns = [/:\s*any\b/, /\bconsole\.log\b/, /\.skip\s*\(/, /\bXXX\b/];

  lines.forEach((line, index) => {
    hardPatterns.forEach((pattern) => {
      if (pattern.test(line)) {
        hardViolations.push({
          type: "stub_detected",
          message: `Stub pattern detected: ${pattern.source}`,
          lineNumber: index + 1,
        });
      }
    });

    softPatterns.forEach((pattern) => {
      if (pattern.test(line)) {
        softViolations.push({
          type: "code_quality",
          message: `Code quality issue: ${pattern.source}`,
          lineNumber: index + 1,
        });
      }
    });
  });

  return {
    passed: hardViolations.length === 0,
    hardViolations,
    softViolations,
    scannedLines: lines.length,
  };
}

main().catch((error) => {
  console.error("💥 Anti-stub scan failed:", error);
  process.exit(1);
});
