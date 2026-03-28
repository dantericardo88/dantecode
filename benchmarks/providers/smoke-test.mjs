#!/usr/bin/env node
/**
 * Provider Smoke Tests
 *
 * Tests live integration with Anthropic Claude, OpenAI GPT, and X.AI Grok.
 * Generates receipts with API logs, response times, costs, and quality metrics.
 *
 * Usage:
 *   node smoke-test.mjs --provider anthropic
 *   node smoke-test.mjs --provider openai
 *   node smoke-test.mjs --provider xai
 *   node smoke-test.mjs --all
 */

import { writeFile } from "node:fs/promises";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

const PROVIDERS = {
  anthropic: {
    name: "Anthropic Claude Sonnet 4.6",
    model: "claude-sonnet-4-6",
    envVar: "ANTHROPIC_API_KEY",
  },
  openai: {
    name: "OpenAI GPT-4o",
    model: "gpt-4o",
    envVar: "OPENAI_API_KEY",
  },
  xai: {
    name: "X.AI Grok 3",
    model: "grok-3",
    envVar: "XAI_API_KEY",
  },
};

const TEST_TASKS = [
  {
    name: "simple-function",
    prompt: "Write a function that calculates the factorial of a number recursively",
    expectedPatterns: ["function", "factorial", "return", "recursive"],
  },
  {
    name: "bug-fix",
    prompt: "Fix this bug: function add(a, b) { return a + b + 1 } // should just add without +1",
    expectedPatterns: ["function", "add", "return a + b"],
  },
  {
    name: "test-generation",
    prompt: "Write unit tests for a function that validates email addresses",
    expectedPatterns: ["test", "expect", "email", "valid"],
  },
];

class ProviderSmokeTest {
  constructor(providerKey) {
    this.provider = PROVIDERS[providerKey];
    this.providerKey = providerKey;
    this.results = [];
  }

  async checkApiKey() {
    const key = process.env[this.provider.envVar];
    if (!key) {
      throw new Error(
        `${this.provider.envVar} not set. Export it before running smoke tests.`
      );
    }
    console.log(`✓ ${this.provider.envVar} found`);
  }

  async runTask(task) {
    console.log(`\n  Running: ${task.name}...`);
    const startTime = Date.now();

    try {
      // Run dantecode with the task prompt
      const cmd = `dantecode agent "${task.prompt}" --model ${this.provider.model} --json --timeout 60`;

      const { stdout, stderr } = await execAsync(cmd, {
        timeout: 65000,
        env: {
          ...process.env,
          DANTECODE_PROVIDER: this.providerKey,
        },
      });

      const elapsed = Date.now() - startTime;
      const output = stdout.trim();

      // Parse JSON output
      let jsonOutput = {};
      try {
        jsonOutput = JSON.parse(output);
      } catch {
        console.log(`    Warning: Could not parse JSON output`);
      }

      // Check if expected patterns are in output
      const patternsFound = task.expectedPatterns.filter((pattern) =>
        output.toLowerCase().includes(pattern.toLowerCase())
      );
      const qualityScore =
        (patternsFound.length / task.expectedPatterns.length) * 100;

      const result = {
        task: task.name,
        success: true,
        elapsedMs: elapsed,
        tokensUsed: jsonOutput.tokens_used || 0,
        costUsd: jsonOutput.cost_usd || 0,
        qualityScore,
        patternsFound: patternsFound.length,
        patternsTotal: task.expectedPatterns.length,
        output: output.slice(0, 500),
        error: null,
      };

      console.log(
        `    ✓ Success in ${elapsed}ms (Quality: ${qualityScore.toFixed(0)}%)`
      );
      this.results.push(result);
      return result;
    } catch (error) {
      const elapsed = Date.now() - startTime;
      const result = {
        task: task.name,
        success: false,
        elapsedMs: elapsed,
        tokensUsed: 0,
        costUsd: 0,
        qualityScore: 0,
        patternsFound: 0,
        patternsTotal: task.expectedPatterns.length,
        output: null,
        error: error.message,
      };

      console.log(`    ✗ Failed: ${error.message}`);
      this.results.push(result);
      return result;
    }
  }

  async runAll() {
    console.log(`\n${"=".repeat(80)}`);
    console.log(`Provider Smoke Test: ${this.provider.name}`);
    console.log(`${"=".repeat(80)}\n`);

    await this.checkApiKey();

    for (const task of TEST_TASKS) {
      await this.runTask(task);
    }

    // Calculate summary
    const summary = {
      provider: this.providerKey,
      providerName: this.provider.name,
      model: this.provider.model,
      timestamp: new Date().toISOString(),
      totalTasks: this.results.length,
      successfulTasks: this.results.filter((r) => r.success).length,
      failedTasks: this.results.filter((r) => !r.success).length,
      avgElapsedMs:
        this.results.reduce((sum, r) => sum + r.elapsedMs, 0) /
        this.results.length,
      totalTokens: this.results.reduce((sum, r) => sum + r.tokensUsed, 0),
      totalCostUsd: this.results.reduce((sum, r) => sum + r.costUsd, 0),
      avgQualityScore:
        this.results.reduce((sum, r) => sum + r.qualityScore, 0) /
        this.results.length,
      results: this.results,
    };

    // Save receipt
    const timestamp = new Date().toISOString().split("T")[0];
    const filename = `../results/provider-smoke-${this.providerKey}-${timestamp}.json`;
    await writeFile(filename, JSON.stringify(summary, null, 2));

    console.log(`\n${"=".repeat(80)}`);
    console.log(`SUMMARY - ${this.provider.name}`);
    console.log(`${"=".repeat(80)}`);
    console.log(`Success Rate: ${summary.successfulTasks}/${summary.totalTasks}`);
    console.log(`Avg Time: ${summary.avgElapsedMs.toFixed(0)}ms`);
    console.log(`Total Tokens: ${summary.totalTokens.toLocaleString()}`);
    console.log(`Total Cost: $${summary.totalCostUsd.toFixed(4)}`);
    console.log(`Avg Quality: ${summary.avgQualityScore.toFixed(1)}%`);
    console.log(`\nReceipt saved to: ${filename}`);
    console.log(`${"=".repeat(80)}\n`);

    return summary;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const allFlag = args.includes("--all");
  const providerArg = args.find((arg) => arg.startsWith("--provider="));
  const providerKey = providerArg
    ? providerArg.split("=")[1]
    : allFlag
      ? null
      : "anthropic";

  if (allFlag) {
    // Run all providers
    const summaries = [];
    for (const key of Object.keys(PROVIDERS)) {
      try {
        const tester = new ProviderSmokeTest(key);
        const summary = await tester.runAll();
        summaries.push(summary);
      } catch (error) {
        console.error(`\n✗ ${PROVIDERS[key].name} failed: ${error.message}\n`);
      }
    }

    // Print comparative summary
    console.log(`\n${"=".repeat(80)}`);
    console.log(`COMPARATIVE SUMMARY - All Providers`);
    console.log(`${"=".repeat(80)}\n`);
    for (const summary of summaries) {
      console.log(`${summary.providerName}:`);
      console.log(
        `  Success: ${summary.successfulTasks}/${summary.totalTasks}`
      );
      console.log(`  Avg Time: ${summary.avgElapsedMs.toFixed(0)}ms`);
      console.log(`  Total Cost: $${summary.totalCostUsd.toFixed(4)}`);
      console.log(`  Avg Quality: ${summary.avgQualityScore.toFixed(1)}%\n`);
    }
  } else {
    // Run single provider
    if (!PROVIDERS[providerKey]) {
      console.error(`Invalid provider: ${providerKey}`);
      console.error(
        `Valid providers: ${Object.keys(PROVIDERS).join(", ")}`
      );
      process.exit(1);
    }

    const tester = new ProviderSmokeTest(providerKey);
    await tester.runAll();
  }
}

main().catch((error) => {
  console.error(`Fatal error: ${error.message}`);
  process.exit(1);
});
