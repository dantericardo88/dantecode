#!/usr/bin/env node
// ============================================================================
// packages/edit-dataset/src/cli.ts
//
// CLI entrypoint for the edit-sequence dataset collector.
// Commands: collect | format | stats
// ============================================================================

import { createReadStream, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { GitHubCommitCollector } from "./github-collector.js";
import { extractEditSequences } from "./edit-extractor.js";
import { formatAndWrite, computeStats } from "./dataset-formatter.js";
import type { EditSequenceExample } from "./types.js";

// ── Argument parsing ──────────────────────────────────────────────────────────

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a?.startsWith("--") && argv[i + 1] && !argv[i + 1]?.startsWith("--")) {
      args[a.slice(2)] = argv[i + 1] ?? "";
      i++;
    } else if (a && !a.startsWith("--")) {
      args["_command"] = a;
    }
  }
  return args;
}

// ── JSONL reader ──────────────────────────────────────────────────────────────

async function readJSONLExamples(filePath: string): Promise<EditSequenceExample[]> {
  const examples: EditSequenceExample[] = [];
  const rl = createInterface({ input: createReadStream(filePath), crlfDelay: Infinity });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      examples.push(JSON.parse(trimmed) as EditSequenceExample);
    } catch { /* skip malformed lines */ }
  }
  return examples;
}

// ── Commands ──────────────────────────────────────────────────────────────────

async function cmdCollect(args: Record<string, string>): Promise<void> {
  const token = process.env["GITHUB_TOKEN"] ?? args["token"] ?? "";
  if (!token) {
    console.error(
      "Error: GitHub token required.\n" +
      "Set GITHUB_TOKEN env var or pass --token <token>"
    );
    process.exit(1);
  }

  const reposArg = args["repos"] ?? "microsoft/vscode";
  const repos = reposArg.split(",").map((r) => r.trim());
  const maxCommits = parseInt(args["max-commits"] ?? "500", 10);
  const outPath = args["out"] ?? "./data/raw.jsonl";
  const windowSize = parseInt(args["window-size"] ?? "5", 10);

  const collector = new GitHubCommitCollector({ token });
  const allExamples: EditSequenceExample[] = [];

  for (const repoStr of repos) {
    const [owner, repo] = repoStr.split("/");
    if (!owner || !repo) {
      console.warn(`Skipping invalid repo: ${repoStr}`);
      continue;
    }
    console.log(`Collecting from ${owner}/${repo}...`);
    const commits = await collector.collectFromRepo(owner, repo, maxCommits);
    const focused = collector.filterFocusedCommits(commits);
    console.log(`  ${commits.length} commits fetched, ${focused.length} focused`);

    for (const commit of focused) {
      const pairs = await collector.fetchFilePairs(commit, owner, repo);
      const examples = extractEditSequences(pairs, windowSize);
      allExamples.push(...examples);
    }
    console.log(`  Running total: ${allExamples.length} examples`);
  }

  await formatAndWrite(allExamples, outPath, "alpaca");
  console.log(`\nDone. Wrote ${allExamples.length} examples to ${outPath}`);
}

async function cmdFormat(args: Record<string, string>): Promise<void> {
  const inPath = args["in"] ?? "./data/raw.jsonl";
  const outPath = args["out"] ?? "./data/train.jsonl";
  const format = (args["format"] ?? "alpaca") as "alpaca" | "chatml";

  if (!existsSync(inPath)) {
    console.error(`Error: Input file not found: ${inPath}`);
    process.exit(1);
  }

  const examples = await readJSONLExamples(inPath);
  await formatAndWrite(examples, outPath, format);
  console.log(`Formatted ${examples.length} examples → ${outPath} (${format})`);
}

async function cmdStats(args: Record<string, string>): Promise<void> {
  const inPath = args["in"] ?? "./data/train.jsonl";

  if (!existsSync(inPath)) {
    console.error(`Error: File not found: ${inPath}`);
    process.exit(1);
  }

  const examples = await readJSONLExamples(inPath);
  const stats = computeStats(examples);

  console.log(`Dataset stats for ${inPath}:`);
  console.log(`  Count:           ${stats.count}`);
  console.log(`  Avg history len: ${stats.avgHistoryLength.toFixed(1)} edits`);
  console.log(`  Avg context:     ${stats.avgContextChars.toFixed(0)} chars`);
  console.log(`  Languages:`);
  for (const [lang, count] of Object.entries(stats.languageDistribution).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${lang.padEnd(16)} ${count}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const command = args["_command"];

  switch (command) {
    case "collect": await cmdCollect(args); break;
    case "format":  await cmdFormat(args);  break;
    case "stats":   await cmdStats(args);   break;
    default:
      console.log(
        "edit-dataset — Next-edit training data collector\n\n" +
        "Commands:\n" +
        "  collect   Fetch commits from GitHub and extract training examples\n" +
        "  format    Re-format an existing JSONL file\n" +
        "  stats     Print dataset statistics\n\n" +
        "Examples:\n" +
        "  edit-dataset collect --repos microsoft/vscode,facebook/react --max-commits 500 --out data/raw.jsonl\n" +
        "  edit-dataset format --in data/raw.jsonl --format alpaca --out data/train.jsonl\n" +
        "  edit-dataset stats --in data/train.jsonl"
      );
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
