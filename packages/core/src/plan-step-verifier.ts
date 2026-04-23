// ============================================================================
// Sprint BA — Dim 16: Plan Step Verifier
// Verifies each Plan/Act step produced a measurable artifact.
// Steps with no file writes and no tool calls are flagged "unverified" —
// future steps can gate on prior step verification.
// ============================================================================

import { appendFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export interface PlanStep {
  id: string;
  description: string;
  expectedOutput?: string;
}

export type StepVerificationReason = "file_written" | "tool_called" | "no_output";

export interface StepVerificationResult {
  stepId: string;
  description: string;
  verified: boolean;
  reason: StepVerificationReason;
  filesWrittenCount: number;
  timestamp: string;
}

export function verifyStepCompletion(
  step: PlanStep,
  filesWrittenBefore: string[],
  filesWrittenAfter: string[],
  toolCallsThisStep: number,
): StepVerificationResult {
  const newFiles = filesWrittenAfter.filter((f) => !filesWrittenBefore.includes(f));
  const filesWrittenCount = newFiles.length;

  let verified: boolean;
  let reason: StepVerificationReason;

  if (filesWrittenCount > 0) {
    verified = true;
    reason = "file_written";
  } else if (toolCallsThisStep > 0) {
    verified = true;
    reason = "tool_called";
  } else {
    verified = false;
    reason = "no_output";
  }

  return {
    stepId: step.id,
    description: step.description,
    verified,
    reason,
    filesWrittenCount,
    timestamp: new Date().toISOString(),
  };
}

export function recordStepVerification(
  result: StepVerificationResult,
  projectRoot: string,
): void {
  try {
    const dir = join(projectRoot, ".danteforge");
    mkdirSync(dir, { recursive: true });
    appendFileSync(
      join(dir, "plan-step-verification-log.json"),
      JSON.stringify(result) + "\n",
      "utf-8",
    );
  } catch { /* non-fatal */ }
}

export function loadStepVerifications(projectRoot: string): StepVerificationResult[] {
  try {
    const path = join(projectRoot, ".danteforge", "plan-step-verification-log.json");
    if (!existsSync(path)) return [];
    return readFileSync(path, "utf-8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as StepVerificationResult);
  } catch { return []; }
}

export function getPlanVerificationRate(results: StepVerificationResult[]): number {
  if (results.length === 0) return 0;
  return results.filter((r) => r.verified).length / results.length;
}
