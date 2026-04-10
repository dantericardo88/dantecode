// ============================================================================
// @dantecode/core — Bounded Repair Loop
// Implements autonomous failure classification, bounded repair planning,
// retry budgets, rollback policies, and verification-after-repair.
// ============================================================================

import { execSync } from "node:child_process";
import {
  parseVerificationErrors,
  formatErrorsForFixPrompt,
  computeErrorSignature,
} from "./error-parser.js";
import type { ParsedError } from "./error-parser.js";

export interface FailureClassification {
  category: "compile" | "test" | "lint" | "runtime" | "verification" | "unknown";
  severity: "low" | "medium" | "high";
  signature: string;
  description: string;
  actionable: boolean;
}

export interface RepairPlan {
  strategy:
    | "fix-import"
    | "add-missing-code"
    | "correct-syntax"
    | "rollback"
    | "revert-change"
    | "manual";
  steps: string[];
  confidence: number;
  estimatedTokens: number;
}

export interface RepairAttempt {
  attemptNumber: number;
  classification: FailureClassification;
  plan: RepairPlan;
  prompt: string;
  result: "success" | "partial" | "failed" | "aborted";
  timestamp: string;
}

export interface BoundedRepairContext {
  maxRetries: number;
  currentRetries: number;
  failureHistory: RepairAttempt[];
  rollbackPolicy: "always" | "on-high-severity" | "never";
  verificationRequired: boolean;
}

export async function classifyFailure(
  errorOutput: string,
  projectRoot: string,
): Promise<FailureClassification> {
  const parsedErrors = await parseVerificationErrors(errorOutput, projectRoot);

  if (parsedErrors.length === 0) {
    return {
      category: "unknown",
      severity: "low",
      signature: "no-parsed-errors",
      description: "No specific errors could be parsed",
      actionable: false,
    };
  }

  const primaryError = parsedErrors[0];
  const signature = computeErrorSignature(primaryError);

  // Classify based on error type
  let category: FailureClassification["category"] = "unknown";
  let severity: FailureClassification["severity"] = "medium";
  let actionable = true;

  if (primaryError.type === "typescript" || primaryError.type === "syntax") {
    category = "compile";
    severity = primaryError.level === "error" ? "high" : "medium";
  } else if (primaryError.type === "test") {
    category = "test";
    severity = "high";
  } else if (primaryError.type === "lint") {
    category = "lint";
    severity = "low";
  } else if (primaryError.type === "runtime") {
    category = "runtime";
    severity = "high";
  } else if (primaryError.type === "verification") {
    category = "verification";
    severity = "medium";
  }

  return {
    category,
    severity,
    signature,
    description: primaryError.message,
    actionable,
  };
}

export function planRepair(
  classification: FailureClassification,
  context: BoundedRepairContext,
): RepairPlan | null {
  if (!classification.actionable || context.currentRetries >= context.maxRetries) {
    return null;
  }

  const strategies: Record<string, RepairPlan> = {
    compile: {
      strategy: "correct-syntax",
      steps: ["Analyze error message", "Identify syntax issue", "Apply targeted fix"],
      confidence: 0.7,
      estimatedTokens: 500,
    },
    test: {
      strategy: "add-missing-code",
      steps: ["Review test failure", "Identify missing implementation", "Add required code"],
      confidence: 0.6,
      estimatedTokens: 800,
    },
    lint: {
      strategy: "fix-import",
      steps: ["Check import statements", "Fix linting violations", "Reformat code"],
      confidence: 0.8,
      estimatedTokens: 300,
    },
    verification: {
      strategy: "add-missing-code",
      steps: ["Review verification failure", "Add missing validation logic"],
      confidence: 0.5,
      estimatedTokens: 600,
    },
  };

  return strategies[classification.category] || null;
}

export async function executeRepair(
  plan: RepairPlan,
  classification: FailureClassification,
  projectRoot: string,
): Promise<{ prompt: string; success: boolean }> {
  const errorDetails = formatErrorsForFixPrompt([
    {
      type: classification.category as any,
      level: classification.severity === "high" ? "error" : "warning",
      message: classification.description,
      file: "",
      line: 0,
      column: 0,
    },
  ]);

  const prompt = `AUTONOMOUS REPAIR ATTEMPT (${plan.strategy})

Failure Classification:
- Category: ${classification.category}
- Severity: ${classification.severity}
- Description: ${classification.description}

Repair Plan:
- Strategy: ${plan.strategy}
- Confidence: ${(plan.confidence * 100).toFixed(0)}%
- Steps: ${plan.steps.join(", ")}

Error Details:
${errorDetails}

Please execute the repair following the planned steps. Focus on the specific issue identified.`;

  // In a real implementation, this would trigger the agent loop with the repair prompt
  // For now, return the prompt for manual execution
  return { prompt, success: plan.confidence > 0.5 };
}

export function shouldRollback(
  classification: FailureClassification,
  context: BoundedRepairContext,
): boolean {
  if (context.rollbackPolicy === "always") return true;
  if (context.rollbackPolicy === "never") return false;
  return classification.severity === "high" && context.currentRetries > 2;
}

export async function rollbackChanges(projectRoot: string): Promise<boolean> {
  try {
    execSync("git reset --hard HEAD~1", { cwd: projectRoot });
    return true;
  } catch (e) {
    return false;
  }
}

export async function verifyAfterRepair(projectRoot: string): Promise<boolean> {
  try {
    // Run basic checks
    execSync("npm run typecheck", { cwd: projectRoot });
    execSync("npm run lint", { cwd: projectRoot });
    return true;
  } catch (e) {
    return false;
  }
}

export class BoundedRepairLoop {
  private context: BoundedRepairContext;

  constructor(
    maxRetries: number = 3,
    rollbackPolicy: BoundedRepairContext["rollbackPolicy"] = "on-high-severity",
  ) {
    this.context = {
      maxRetries,
      currentRetries: 0,
      failureHistory: [],
      rollbackPolicy,
      verificationRequired: true,
    };
  }

  async attemptRepair(errorOutput: string, projectRoot: string): Promise<RepairAttempt | null> {
    if (this.context.currentRetries >= this.context.maxRetries) {
      return null;
    }

    const classification = await classifyFailure(errorOutput, projectRoot);
    const plan = planRepair(classification, this.context);

    if (!plan) {
      return null;
    }

    const { prompt, success } = await executeRepair(plan, classification, projectRoot);

    const attempt: RepairAttempt = {
      attemptNumber: this.context.currentRetries + 1,
      classification,
      plan,
      prompt,
      result: success ? "success" : "failed",
      timestamp: new Date().toISOString(),
    };

    this.context.failureHistory.push(attempt);
    this.context.currentRetries++;

    // If repair failed and should rollback
    if (!success && shouldRollback(classification, this.context)) {
      await rollbackChanges(projectRoot);
      attempt.result = "aborted";
    }

    // Verify after repair
    if (success && this.context.verificationRequired) {
      const verified = await verifyAfterRepair(projectRoot);
      if (!verified) {
        attempt.result = "partial";
      }
    }

    return attempt;
  }

  getHistory(): RepairAttempt[] {
    return this.context.failureHistory;
  }

  reset() {
    this.context.currentRetries = 0;
    this.context.failureHistory = [];
  }
}
