#!/usr/bin/env node
/**
 * bench-build-speed.mjs
 *
 * Benchmark script to measure build performance:
 * - Cold build (no cache)
 * - Warm build (with cache)
 * - Incremental build (single file change)
 *
 * Usage: node scripts/bench-build-speed.mjs
 */

import { execSync } from "node:child_process";
import { writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

function measure(label, fn) {
  const start = Date.now();
  fn();
  const elapsed = Date.now() - start;
  console.log(`✓ ${label}: ${elapsed}ms`);
  return elapsed;
}

function cleanCache() {
  try {
    rmSync(join(ROOT, "node_modules", ".cache"), { recursive: true, force: true });
    rmSync(join(ROOT, ".turbo"), { recursive: true, force: true });
  } catch {
    // Ignore if cache doesn't exist
  }
}

function cleanDist() {
  execSync("npm run clean", { stdio: "ignore" });
}

function build() {
  execSync("npm run build", { stdio: "ignore" });
}

console.log("=== Build Speed Benchmark ===\n");

// 1. Cold build (no cache, no dist)
console.log("1. Cold build (no cache)...");
cleanCache();
cleanDist();
const coldTime = measure("   Cold build", build);

// 2. Warm build (with cache)
console.log("\n2. Warm build (with cache)...");
cleanDist();
const warmTime = measure("   Warm build", build);

// 3. Incremental build (single file change)
console.log("\n3. Incremental build (single file change)...");
const testFile = join(ROOT, "packages", "core", "src", "index.ts");
const originalContent = readFileSync(testFile, "utf-8");
writeFileSync(testFile, originalContent + "\n// benchmark change\n");

const incrementalTime = measure("   Incremental build", build);

// Restore original file
writeFileSync(testFile, originalContent);

// 4. No-op build (no changes)
console.log("\n4. No-op build (no changes)...");
const noopTime = measure("   No-op build", build);

console.log("\n=== Summary ===");
console.log(`Cold build:        ${coldTime}ms (baseline)`);
console.log(
  `Warm build:        ${warmTime}ms (${Math.round((1 - warmTime / coldTime) * 100)}% faster)`,
);
console.log(
  `Incremental build: ${incrementalTime}ms (${Math.round((1 - incrementalTime / coldTime) * 100)}% faster)`,
);
console.log(
  `No-op build:       ${noopTime}ms (${Math.round((1 - noopTime / coldTime) * 100)}% faster)`,
);

console.log("\n=== Speed Grade ===");
if (noopTime < 2000) {
  console.log("✅ Excellent - No-op build under 2s");
} else if (noopTime < 5000) {
  console.log("⚠️  Good - No-op build under 5s");
} else {
  console.log("❌ Needs improvement - No-op build over 5s");
}

if (incrementalTime < coldTime * 0.3) {
  console.log("✅ Excellent - Incremental build 70%+ faster than cold");
} else if (incrementalTime < coldTime * 0.5) {
  console.log("⚠️  Good - Incremental build 50%+ faster than cold");
} else {
  console.log("❌ Needs improvement - Incremental build not utilizing cache effectively");
}

// Export results
const results = {
  timestamp: new Date().toISOString(),
  coldBuildMs: coldTime,
  warmBuildMs: warmTime,
  incrementalBuildMs: incrementalTime,
  noopBuildMs: noopTime,
  speedup: {
    warm: `${Math.round((1 - warmTime / coldTime) * 100)}%`,
    incremental: `${Math.round((1 - incrementalTime / coldTime) * 100)}%`,
    noop: `${Math.round((1 - noopTime / coldTime) * 100)}%`,
  },
};

writeFileSync(
  join(ROOT, "artifacts", "build-speed-benchmark.json"),
  JSON.stringify(results, null, 2),
);

console.log("\n✓ Results saved to artifacts/build-speed-benchmark.json");
