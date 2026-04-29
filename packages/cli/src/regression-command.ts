import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  formatRegressionGateMarkdown,
  formatRegressionGateText,
  normalizeRegressionProfile,
  runRegressionGate,
} from "@dantecode/core";
import type { RegressionGateProfile } from "@dantecode/core";

interface ParsedRegressionArgs {
  subcommand: "gate";
  profile: RegressionGateProfile;
  format: "text" | "json" | "markdown";
  evidence: boolean;
  threshold: number;
  stepTimeoutMs: number;
}

export interface RegressionCommandOptions {
  cwd: string;
  execSyncFn?: (command: string, cwd: string) => string;
  now?: () => Date;
  writeOutput?: (text: string) => void;
}

const DEFAULT_ARGS: ParsedRegressionArgs = {
  subcommand: "gate",
  profile: "release",
  format: "text",
  evidence: false,
  threshold: 90,
  stepTimeoutMs: 60_000,
};

export async function runRegressionCommand(
  args: string[],
  options: RegressionCommandOptions,
): Promise<number> {
  const parsed = parseRegressionArgs(args);
  if (!parsed) {
    options.writeOutput?.(getRegressionHelpText());
    return 1;
  }

  const result = runRegressionGate({
    projectRoot: options.cwd,
    profile: parsed.profile,
    threshold: parsed.threshold,
    stepTimeoutMs: parsed.stepTimeoutMs,
    execSyncFn: options.execSyncFn,
    now: options.now,
  });

  if (parsed.evidence) {
    await writeRegressionEvidence(options.cwd, result);
  }

  const output = formatRegressionOutput(parsed.format, result);
  (options.writeOutput ?? process.stdout.write.bind(process.stdout))(`${output}\n`);
  return result.pass ? 0 : 1;
}

function parseRegressionArgs(args: string[]): ParsedRegressionArgs | null {
  if (args[0] !== "gate") {
    return null;
  }

  const parsed: ParsedRegressionArgs = { ...DEFAULT_ARGS };
  for (let i = 1; i < args.length; i += 1) {
    const token = args[i];
    if (token === "--profile") {
      const value = args[i + 1];
      if (!value) return null;
      parsed.profile = normalizeRegressionProfile(value as RegressionGateProfile | "score-claim");
      i += 1;
      continue;
    }
    if (token === "--format") {
      const value = args[i + 1];
      if (value !== "text" && value !== "json" && value !== "markdown") return null;
      parsed.format = value;
      i += 1;
      continue;
    }
    if (token === "--threshold") {
      const value = Number(args[i + 1]);
      if (!Number.isFinite(value)) return null;
      parsed.threshold = value;
      i += 1;
      continue;
    }
    if (token === "--step-timeout-ms") {
      const value = Number(args[i + 1]);
      if (!Number.isFinite(value) || value <= 0) return null;
      parsed.stepTimeoutMs = value;
      i += 1;
      continue;
    }
    if (token === "--evidence") {
      parsed.evidence = true;
      continue;
    }
    if (token === "--help" || token === "-h") {
      return null;
    }
  }

  return parsed;
}

function formatRegressionOutput(format: ParsedRegressionArgs["format"], result: ReturnType<typeof runRegressionGate>): string {
  if (format === "json") {
    return JSON.stringify(result, null, 2);
  }
  if (format === "markdown") {
    return formatRegressionGateMarkdown(result);
  }
  return formatRegressionGateText(result);
}

async function writeRegressionEvidence(
  cwd: string,
  result: ReturnType<typeof runRegressionGate>,
): Promise<void> {
  const evidenceDir = join(cwd, ".danteforge", "evidence");
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(
    join(evidenceDir, "regression-prevention-dim34.json"),
    `${JSON.stringify(result, null, 2)}\n`,
    "utf-8",
  );
  await writeFile(
    join(evidenceDir, "regression-prevention-dim34.md"),
    formatRegressionGateMarkdown(result),
    "utf-8",
  );
}

function getRegressionHelpText(): string {
  return [
    "Usage: dantecode regression gate [--profile quick|release|score-claim] [--format text|json|markdown] [--threshold N] [--step-timeout-ms N] [--evidence]",
    "",
    "Runs the Dimension 34 regression-prevention gate and optionally writes evidence artifacts.",
  ].join("\n");
}
