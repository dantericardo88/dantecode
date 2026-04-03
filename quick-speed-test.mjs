#!/usr/bin/env node
/**
 * Quick speed test - measure CLI startup and simple response time
 */

import { performance } from "node:perf_hooks";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

async function testCliStartup() {
  console.log("Testing CLI startup time...\n");

  const iterations = 5;
  const times = [];

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();

    try {
      await execAsync("node packages/cli/dist/index.js --version", {
        timeout: 10000,
      });

      const elapsed = performance.now() - start;
      times.push(elapsed);
      console.log(`  Run ${i + 1}: ${elapsed.toFixed(0)}ms`);
    } catch (error) {
      console.error(`  Run ${i + 1}: FAILED -`, error.message);
    }
  }

  if (times.length > 0) {
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const min = Math.min(...times);
    const max = Math.max(...times);
    const sorted = times.slice().sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length / 2)];

    console.log(`\nResults:`);
    console.log(`  Average: ${avg.toFixed(0)}ms`);
    console.log(`  Min: ${min.toFixed(0)}ms`);
    console.log(`  Max: ${max.toFixed(0)}ms`);
    console.log(`  p50: ${p50.toFixed(0)}ms`);

    return { avg, min, max, p50 };
  }

  return null;
}

async function testHelpCommand() {
  console.log("\n\nTesting --help response time...\n");

  const iterations = 3;
  const times = [];

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();

    try {
      await execAsync("node packages/cli/dist/index.js --help", {
        timeout: 10000,
      });

      const elapsed = performance.now() - start;
      times.push(elapsed);
      console.log(`  Run ${i + 1}: ${elapsed.toFixed(0)}ms`);
    } catch (error) {
      console.error(`  Run ${i + 1}: FAILED -`, error.message);
    }
  }

  if (times.length > 0) {
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const sorted = times.slice().sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length / 2)];

    console.log(`\nResults:`);
    console.log(`  Average: ${avg.toFixed(0)}ms`);
    console.log(`  p50: ${p50.toFixed(0)}ms`);

    return { avg, p50 };
  }

  return null;
}

async function main() {
  console.log("=".repeat(80));
  console.log("DanteCode Quick Speed Test");
  console.log("=".repeat(80));
  console.log();

  const startupResults = await testCliStartup();
  const helpResults = await testHelpCommand();

  console.log("\n" + "=".repeat(80));
  console.log("SUMMARY");
  console.log("=".repeat(80));

  if (startupResults) {
    console.log(`\nCLI Startup (--version):`);
    console.log(`  p50: ${startupResults.p50.toFixed(0)}ms`);
    console.log(`  Average: ${startupResults.avg.toFixed(0)}ms`);
  }

  if (helpResults) {
    console.log(`\nHelp Command (--help):`);
    console.log(`  p50: ${helpResults.p50.toFixed(0)}ms`);
    console.log(`  Average: ${helpResults.avg.toFixed(0)}ms`);
  }

  console.log("\n" + "=".repeat(80));
  console.log("\nSpeed benchmarks complete!");
  console.log("For full benchmarks (SWE-bench, provider tests), see benchmarks/ directory.");
}

main().catch(console.error);
