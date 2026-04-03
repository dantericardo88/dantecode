// ============================================================================
// @dantecode/core - Architect Planner (Plan/Execute Phase Split)
// Aider-inspired architect pattern: expensive model plans, fast model executes.
// ============================================================================

export interface PlanStep {
  id: string;
  description: string;
  files: string[];
  verifyCommand?: string;
  dependencies?: string[];
  status: "pending" | "in_progress" | "completed" | "failed";
  error?: string;
}

export interface ExecutionPlan {
  goal: string;
  steps: PlanStep[];
  createdAt: string;
  estimatedComplexity: number;
}

export interface ArchitectPlannerOptions {
  generatePlan: (prompt: string, context: string) => Promise<string>;
}

/**
 * Estimate prompt complexity on a 0-1 scale.
 * Higher complexity suggests using the architect/editor split.
 */
export function analyzeComplexity(prompt: string): number {
  let score = 0;
  const lower = prompt.toLowerCase();
  const words = lower.split(/\s+/).length;

  // Length factor
  if (words > 100) score += 0.2;
  else if (words > 50) score += 0.1;

  // Multi-file indicators
  const multiFileSignals = [
    "refactor",
    "across",
    "multiple files",
    "all files",
    "throughout",
    "codebase",
    "project-wide",
    "migration",
    "rename everywhere",
  ];
  if (multiFileSignals.some((signal) => lower.includes(signal))) {
    score += 0.25;
  }

  // Architecture indicators
  const archSignals = [
    "architect",
    "design",
    "implement",
    "build",
    "create",
    "system",
    "pipeline",
    "integration",
    "infrastructure",
  ];
  const archMatches = archSignals.filter((s) => lower.includes(s)).length;
  score += Math.min(archMatches * 0.08, 0.25);

  // Multi-step indicators
  const stepSignals = ["then", "after that", "next", "finally", "first", "second", "step"];
  const stepMatches = stepSignals.filter((s) => lower.includes(s)).length;
  score += Math.min(stepMatches * 0.05, 0.15);

  // Complexity modifiers
  if (lower.includes("test") && lower.includes("implement")) score += 0.1;
  if (lower.includes("database") || lower.includes("schema")) score += 0.1;
  if (lower.includes("api") && lower.includes("endpoint")) score += 0.1;

  return Math.min(score, 1);
}

/**
 * Parse a structured plan from the architect model's text response.
 * Expects numbered steps with optional file annotations.
 */
export function parsePlanFromText(goal: string, text: string): ExecutionPlan {
  const steps: PlanStep[] = [];
  const lines = text.split("\n");

  let currentStep: Partial<PlanStep> | null = null;
  let stepCounter = 0;

  for (const line of lines) {
    const trimmed = line.trim();

    // Match numbered step patterns: "1.", "1)", "Step 1:", etc.
    const stepMatch = trimmed.match(/^(?:step\s+)?(\d+)[.):\s]+(.+)/i);
    if (stepMatch) {
      // Save previous step
      if (currentStep?.description) {
        steps.push(finalizeStep(currentStep, stepCounter));
      }

      stepCounter++;
      currentStep = {
        description: stepMatch[2]!.trim(),
        files: [],
        status: "pending",
      };
      continue;
    }

    // Match file annotations: "- files: a.ts, b.ts" or "  Files: ..."
    const fileMatch = trimmed.match(/^[-*]?\s*files?:\s*(.+)/i);
    if (fileMatch && currentStep) {
      const filePaths = fileMatch[1]!
        .split(/[,;]/)
        .map((f) => f.trim().replace(/`/g, ""))
        .filter((f) => f.length > 0);
      currentStep.files = [...(currentStep.files ?? []), ...filePaths];
      continue;
    }

    // Match verify annotations: "- verify: npm test" or "  Verify: ..."
    const verifyMatch = trimmed.match(/^[-*]?\s*verify:\s*(.+)/i);
    if (verifyMatch && currentStep) {
      currentStep.verifyCommand = verifyMatch[1]!.trim().replace(/`/g, "");
      continue;
    }

    // Match dependency annotations: "- depends: step 1" or "  After: step 1"
    const depMatch = trimmed.match(/^[-*]?\s*(?:depends|after|requires):\s*(.+)/i);
    if (depMatch && currentStep) {
      currentStep.dependencies = depMatch[1]!
        .split(/[,;]/)
        .map((d) => d.trim().replace(/^step\s+/i, ""))
        .filter((d) => d.length > 0);
    }
  }

  // Save last step
  if (currentStep?.description) {
    steps.push(finalizeStep(currentStep, stepCounter));
  }

  return {
    goal,
    steps,
    createdAt: new Date().toISOString(),
    estimatedComplexity: analyzeComplexity(goal),
  };
}

function finalizeStep(partial: Partial<PlanStep>, index: number): PlanStep {
  return {
    id: `step-${index}`,
    description: partial.description ?? "",
    files: partial.files ?? [],
    verifyCommand: partial.verifyCommand,
    dependencies: partial.dependencies,
    status: "pending",
  };
}

/**
 * Architect planner that generates structured execution plans.
 * Uses an expensive model with extended thinking to analyze the task.
 */
export class ArchitectPlanner {
  private readonly generatePlan: (prompt: string, context: string) => Promise<string>;

  constructor(options: ArchitectPlannerOptions) {
    this.generatePlan = options.generatePlan;
  }

  async createPlan(prompt: string, repoContext: string): Promise<ExecutionPlan> {
    const architectPrompt = buildArchitectPrompt(prompt);
    const response = await this.generatePlan(architectPrompt, repoContext);
    return parsePlanFromText(prompt, response);
  }
}

function buildArchitectPrompt(userPrompt: string): string {
  return [
    "You are an architect planning code changes. Analyze the request and produce a numbered step-by-step plan.",
    "For each step, include:",
    "- A clear description of what to do",
    "- Files: list of files to create or modify",
    "- Verify: optional command to verify the step (e.g., npm test)",
    "- Depends: optional list of prerequisite steps",
    "",
    "Format each step as:",
    "1. Description of the step",
    "   Files: path/to/file1.ts, path/to/file2.ts",
    "   Verify: npm test",
    "",
    `Task: ${userPrompt}`,
  ].join("\n");
}
