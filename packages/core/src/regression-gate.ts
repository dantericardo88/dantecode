import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type RegressionGateProfile = "quick" | "release" | "score_claim";

export type RegressionFailureClass =
  | "blocking"
  | "known_legacy"
  | "flaky"
  | "environmental"
  | "waived";

export interface RegressionGateCommand {
  name: string;
  command: string;
}

export interface RegressionWaiver {
  signature: string;
  classification: RegressionFailureClass;
  owner: string;
  reason: string;
  expiresAt: string;
  appliesTo?: string[];
}

export interface RegressionWaiverError {
  field: "signature" | "owner" | "reason" | "expiresAt" | "classification";
  signature?: string;
  reason: string;
}

export interface RegressionFailure {
  stepName: string;
  command: string;
  signature: string;
  classification: RegressionFailureClass;
  message: string;
  nextAction: string;
  waiver?: RegressionWaiver;
}

export interface RegressionGateStep {
  name: string;
  command: string;
  passed: boolean;
  durationMs: number;
  output: string;
  failure?: RegressionFailure;
}

export interface RegressionGateProof {
  releaseGatesGreen: boolean;
  scoreClaimsBlocked: boolean;
  blockingFailureCount: number;
  waiverCount: number;
  commandCount: number;
}

export interface RegressionGateResult {
  dimensionId: "regression_prevention";
  generatedAt: string;
  profile: RegressionGateProfile;
  pass: boolean;
  score: number;
  threshold: number;
  steps: RegressionGateStep[];
  failures: RegressionFailure[];
  blockingFailures: RegressionFailure[];
  waiverErrors: RegressionWaiverError[];
  proof: RegressionGateProof;
}

export interface ScoreClaimGateInput {
  pass: boolean;
  score: number;
  threshold: number;
  profile: string;
}

export interface ScoreClaimGateResult {
  ok: boolean;
  reason?: string;
}

export interface RunRegressionGateOptions {
  projectRoot: string;
  profile?: RegressionGateProfile | "score-claim";
  threshold?: number;
  stepTimeoutMs?: number;
  steps?: RegressionGateCommand[];
  waivers?: RegressionWaiver[];
  execSyncFn?: (command: string, cwd: string) => string;
  now?: () => Date;
}

const DEFAULT_THRESHOLD = 90;

const FAILURE_PENALTY: Record<RegressionFailureClass, number> = {
  blocking: 35,
  known_legacy: 8,
  flaky: 15,
  environmental: 15,
  waived: 12,
};

export function normalizeRegressionProfile(profile: RegressionGateProfile | "score-claim" = "release"): RegressionGateProfile {
  return profile === "score-claim" ? "score_claim" : profile;
}

export function getRegressionGateSteps(profile: RegressionGateProfile): RegressionGateCommand[] {
  if (profile === "quick") {
    return [
      { name: "core-build", command: "npm run build --workspace @dantecode/core" },
      { name: "cli-build", command: "npm run build --workspace @dantecode/cli" },
    ];
  }

  const releaseSteps: RegressionGateCommand[] = [
    { name: "typecheck", command: "npm run typecheck" },
    { name: "lint", command: "npm run lint" },
    { name: "test", command: "npm test" },
    { name: "coverage", command: "npm run test:coverage" },
  ];

  if (profile === "score_claim") {
    return [
      ...releaseSteps,
      {
        name: "frontier-gap",
        command: "danteforge frontier-gap --matrix .danteforge/compete/matrix.json regression_prevention",
      },
    ];
  }

  return releaseSteps;
}

export function loadRegressionWaivers(projectRoot: string): RegressionWaiver[] {
  const waiverPath = join(projectRoot, ".danteforge", "regression-waivers.json");
  if (!existsSync(waiverPath)) {
    return [];
  }

  const parsed = JSON.parse(readFileSync(waiverPath, "utf-8")) as
    | RegressionWaiver[]
    | { waivers?: RegressionWaiver[] };
  return Array.isArray(parsed) ? parsed : parsed.waivers ?? [];
}

export function validateRegressionWaivers(
  waivers: RegressionWaiver[],
  now: Date = new Date(),
): RegressionWaiverError[] {
  const errors: RegressionWaiverError[] = [];

  for (const waiver of waivers) {
    if (!waiver.signature) {
      errors.push({ field: "signature", reason: "waiver signature is required" });
    }
    if (!waiver.owner) {
      errors.push({ field: "owner", signature: waiver.signature, reason: "waiver owner is required" });
    }
    if (!waiver.reason) {
      errors.push({ field: "reason", signature: waiver.signature, reason: "waiver reason is required" });
    }
    if (!waiver.expiresAt) {
      errors.push({ field: "expiresAt", signature: waiver.signature, reason: "waiver expiry is required" });
    } else {
      const expiry = new Date(waiver.expiresAt);
      if (Number.isNaN(expiry.getTime())) {
        errors.push({ field: "expiresAt", signature: waiver.signature, reason: "waiver expiry is invalid" });
      } else if (expiry.getTime() <= now.getTime()) {
        errors.push({ field: "expiresAt", signature: waiver.signature, reason: "waiver expired" });
      }
    }
    if (waiver.classification === "blocking") {
      errors.push({
        field: "classification",
        signature: waiver.signature,
        reason: "waiver classification must be non-blocking",
      });
    }
  }

  return errors;
}

export function runRegressionGate(options: RunRegressionGateOptions): RegressionGateResult {
  const generatedAt = (options.now?.() ?? new Date()).toISOString();
  const now = new Date(generatedAt);
  const profile = normalizeRegressionProfile(options.profile);
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const steps = options.steps ?? getRegressionGateSteps(profile);
  const waivers = options.waivers ?? loadRegressionWaivers(options.projectRoot);
  const waiverErrors = validateRegressionWaivers(waivers, now);
  const validWaivers = waiverErrors.length === 0 ? waivers : [];
  const execSyncFn = options.execSyncFn ?? ((command, cwd) => defaultExecSync(command, cwd, options.stepTimeoutMs));

  const stepResults: RegressionGateStep[] = steps.map((step) => {
    const start = Date.now();
    try {
      const output = execSyncFn(step.command, options.projectRoot);
      return {
        name: step.name,
        command: step.command,
        passed: true,
        output: truncateOutput(output),
        durationMs: Date.now() - start,
      };
    } catch (error) {
      const output = stringifyCommandError(error);
      const failure = buildRegressionFailure(step, output, validWaivers, now);
      return {
        name: step.name,
        command: step.command,
        passed: false,
        output: truncateOutput(output),
        durationMs: Date.now() - start,
        failure,
      };
    }
  });

  const failures = stepResults
    .map((step) => step.failure)
    .filter((failure): failure is RegressionFailure => Boolean(failure));
  const blockingFailures = failures.filter((failure) => failure.classification === "blocking");
  const score = computeRegressionScore(failures, waiverErrors);
  const pass = blockingFailures.length === 0 && score >= threshold;

  return {
    dimensionId: "regression_prevention",
    generatedAt,
    profile,
    pass,
    score,
    threshold,
    steps: stepResults,
    failures,
    blockingFailures,
    waiverErrors,
    proof: {
      releaseGatesGreen: stepResults.every((step) => step.passed),
      scoreClaimsBlocked: profile === "score_claim",
      blockingFailureCount: blockingFailures.length,
      waiverCount: failures.filter((failure) => Boolean(failure.waiver)).length,
      commandCount: stepResults.length,
    },
  };
}

export function evaluateScoreClaimGate(gate: ScoreClaimGateInput | null | undefined): ScoreClaimGateResult {
  if (!gate) {
    return {
      ok: false,
      reason: "missing regression gate proof",
    };
  }
  if (gate.profile !== "score_claim" && gate.profile !== "score-claim") {
    return {
      ok: false,
      reason: "regression gate proof did not use score_claim profile",
    };
  }
  if (!gate.pass) {
    return {
      ok: false,
      reason: "failing regression gate",
    };
  }
  if (gate.score < gate.threshold) {
    return {
      ok: false,
      reason: "regression gate score below threshold",
    };
  }
  return { ok: true };
}

export function createRegressionFailureSignature(stepName: string, output: string): string {
  const normalized = normalizeFailureOutput(output);
  const hash = createHash("sha256").update(`${stepName}:${normalized}`).digest("hex").slice(0, 12);
  const label = normalized.slice(0, 80) || "no-output";
  return `${stepName}:${hash}:${label}`;
}

export function formatRegressionGateMarkdown(result: RegressionGateResult): string {
  const lines = [
    "# Regression Prevention Gate",
    "",
    `- Dimension: ${result.dimensionId}`,
    `- Profile: ${result.profile}`,
    `- Pass: ${result.pass ? "yes" : "no"}`,
    `- Score: ${result.score}/${result.threshold}`,
    `- Generated: ${result.generatedAt}`,
    "",
    "## Steps",
    "",
    "| Step | Status | Class | Waiver | Next action |",
    "|---|---|---|---|---|",
  ];

  for (const step of result.steps) {
    const failure = step.failure;
    lines.push(
      `| ${step.name} | ${step.passed ? "pass" : "fail"} | ${failure?.classification ?? "-"} | ${failure?.waiver ? "active" : "-"} | ${failure?.nextAction ?? "-"} |`,
    );
  }

  lines.push("", "## Waiver Errors", "");
  if (result.waiverErrors.length === 0) {
    lines.push("- none");
  } else {
    for (const error of result.waiverErrors) {
      lines.push(`- ${error.field}: ${error.reason}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

export function formatRegressionGateText(result: RegressionGateResult): string {
  const status = result.pass ? "PASS" : "FAIL";
  const failed = result.failures.length === 0
    ? "none"
    : result.failures.map((failure) => `${failure.stepName}:${failure.classification}`).join(", ");
  return [
    `Regression prevention gate: ${status}`,
    `Profile: ${result.profile}`,
    `Score: ${result.score}/${result.threshold}`,
    `Failures: ${failed}`,
  ].join("\n");
}

function buildRegressionFailure(
  step: RegressionGateCommand,
  output: string,
  waivers: RegressionWaiver[],
  now: Date,
): RegressionFailure {
  const signature = createRegressionFailureSignature(step.name, output);
  const waiver = findActiveWaiver(signature, step.name, waivers, now);
  const classification = waiver?.classification ?? inferFailureClass(output);
  return {
    stepName: step.name,
    command: step.command,
    signature,
    classification,
    message: normalizeFailureOutput(output),
    nextAction: nextActionFor(classification),
    waiver,
  };
}

function findActiveWaiver(
  signature: string,
  stepName: string,
  waivers: RegressionWaiver[],
  now: Date,
): RegressionWaiver | undefined {
  return waivers.find((waiver) => {
    if (waiver.signature !== signature) {
      return false;
    }
    if (waiver.appliesTo && !waiver.appliesTo.includes(stepName)) {
      return false;
    }
    return new Date(waiver.expiresAt).getTime() > now.getTime();
  });
}

function inferFailureClass(output: string): RegressionFailureClass {
  if (/\b(?:error TS\d+|ESLint|@typescript-eslint|no-unused-vars|TypeError|AssertionError)\b/i.test(output)) {
    return "blocking";
  }
  if (/\b(?:timed out|timeout|flaky|intermittent|hook timed out)\b/i.test(output)) {
    return "flaky";
  }
  if (/\b(?:enoent|econnrefused|not recognized|command not found|sql-wasm\.wasm)\b/i.test(output)) {
    return "environmental";
  }
  return "blocking";
}

function nextActionFor(classification: RegressionFailureClass): string {
  switch (classification) {
    case "known_legacy":
      return "Keep visible, assign owner, and burn down before waiver expiry.";
    case "flaky":
      return "Rerun in isolation, capture signature, and quarantine only with expiry.";
    case "environmental":
      return "Document prerequisite or fix local environment before score claim.";
    case "waived":
      return "Review waiver owner, reason, expiry, and residual score cap.";
    case "blocking":
      return "Fix before release or score movement.";
  }
}

function computeRegressionScore(failures: RegressionFailure[], waiverErrors: RegressionWaiverError[]): number {
  const penalty = failures.reduce((total, failure) => total + FAILURE_PENALTY[failure.classification], 0)
    + waiverErrors.length * 20;
  return Math.max(0, Math.min(100, 100 - penalty));
}

function normalizeFailureOutput(output: string): string {
  return output
    .replace(/\x1b\[[0-9;]*m/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stringifyCommandError(error: unknown): string {
  const maybe = error as { stdout?: Buffer | string; stderr?: Buffer | string; message?: string };
  const parts = [maybe.stderr, maybe.stdout, maybe.message]
    .map((part) => bufferOrString(part))
    .filter((part): part is string => Boolean(part));
  return parts.join("\n") || String(error);
}

function bufferOrString(value: Buffer | string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  return Buffer.isBuffer(value) ? value.toString("utf-8") : value;
}

function truncateOutput(output: string): string {
  return output.length > 2000 ? `${output.slice(0, 2000)}...` : output;
}

function defaultExecSync(command: string, cwd: string, timeoutMs = 60_000): string {
  return execSync(command, {
    cwd,
    encoding: "utf-8",
    env: process.env,
    timeout: timeoutMs,
    stdio: ["ignore", "pipe", "pipe"],
  });
}
