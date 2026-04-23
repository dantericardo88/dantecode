// ============================================================================
// @dantecode/cli — Generate Command (Sprint 30, dim 10: full-app generation)
//
// Usage:
//   dantecode generate "a REST API for managing todo items"
//   dantecode generate "React TypeScript app with dark mode" --name my-app
//   dantecode generate "Python CLI for file processing" --out ./projects/myapp
//   dantecode generate "Express server" --dry-run
// ============================================================================

import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import {
  generateScaffold,
  formatAppScaffoldSummary,
  detectProjectType,
  detectProjectStack,
  incrementalVerifyGate,
} from "@dantecode/core";
import type {
  ScaffoldPlan,
  AppScaffoldOptions,
  IncrementalExecFn,
  IncrementalVerifyResult,
  StackTemplate,
} from "@dantecode/core";
// Local definition — mirrors the shape expected by danteforge.recordTaskOutcome
type RecordTaskOutcomeInput = Record<string, unknown>;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GenerateOptions {
  /** Override project name (defaults to derived from description). */
  name?: string;
  /** Output directory (defaults to ./<projectName>). */
  outDir?: string;
  /** If true, print the plan but do not write any files. */
  dryRun?: boolean;
  /** Override detected project type. */
  projectType?: string;
  /** Run stack-aware typecheck after each generated file. Defaults to true. */
  verifyEachFile?: boolean;
  /** Test hook for incremental verification without invoking a real compiler. */
  incrementalExecFn?: IncrementalExecFn;
  /** Test hook for forcing a specific stack template during incremental verify. */
  stackTemplateOverride?: StackTemplate;
  /** Optional hook for persisting task-outcome artifacts. */
  taskOutcomeRecorder?: (artifact: RecordTaskOutcomeInput, projectRoot: string) => Promise<void>;
}

export interface GenerateResult {
  success: boolean;
  plan: ScaffoldPlan;
  writtenFiles: string[];
  incrementalVerification?: IncrementalVerifyResult[];
  error?: string;
}

// ─── Core logic ───────────────────────────────────────────────────────────────

/**
 * Generate a full application scaffold from a natural-language description.
 *
 * @param description Natural-language description of the project
 * @param options     Optional overrides for name, output dir, dry-run, type
 */
export async function cmdGenerate(
  description: string,
  options: GenerateOptions = {},
): Promise<GenerateResult> {
  const startedAt = new Date().toISOString();
  if (!description || description.trim().length < 3) {
    return {
      success: false,
      plan: generateScaffold("empty"),
      writtenFiles: [],
      error: "Description must be at least 3 characters.",
    };
  }

  const scaffoldOpts: AppScaffoldOptions = {
    projectName: options.name,
    projectType: options.projectType as AppScaffoldOptions["projectType"],
  };
  const plan = generateScaffold(description, scaffoldOpts);

  const outDir = options.outDir ?? `./${plan.projectName}`;
  const verifyEachFile = options.verifyEachFile ?? true;

  const persistTaskOutcome = async (
    success: boolean,
    error: string | undefined,
    writtenFiles: string[],
    incrementalVerification: IncrementalVerifyResult[],
  ): Promise<void> => {
    if (options.dryRun) {
      return;
    }

    const verificationSnapshots = incrementalVerification.map((result, index) => ({
      kind: `incremental-verify-${index + 1}`,
      passed: result.passed,
      summary: result.output || (result.passed ? "typecheck passed" : "typecheck failed"),
    }));

    const recorder =
      options.taskOutcomeRecorder ??
      (async (artifact: RecordTaskOutcomeInput, projectRoot: string) => {
        const danteforge = await import("@dantecode/danteforge") as unknown as { recordTaskOutcome?: (a: unknown, p: string) => Promise<void> };
        await danteforge.recordTaskOutcome?.(artifact, projectRoot);
      });

    await recorder(
      {
        command: "generate",
        taskDescription: description,
        success,
        startedAt,
        verificationSnapshots,
        evidenceRefs: writtenFiles,
        error,
        metadata: {
          projectName: plan.projectName,
          projectType: plan.projectType,
          filesPlanned: plan.files.length,
          filesWritten: writtenFiles.length,
          verifyEachFile,
        },
      },
      outDir,
    );
  };

  if (options.dryRun) {
    return { success: true, plan, writtenFiles: [] };
  }

  const writtenFiles: string[] = [];
  const incrementalVerification: IncrementalVerifyResult[] = [];
  try {
    for (const file of plan.files) {
      const fullPath = join(outDir, file.path);
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, file.content, "utf8");
      writtenFiles.push(fullPath);

      if (verifyEachFile) {
        const stackTemplate = options.stackTemplateOverride ?? await detectProjectStack(outDir);
        const verifyResult = await incrementalVerifyGate(
          fullPath,
          stackTemplate,
          options.incrementalExecFn,
        );
        incrementalVerification.push(verifyResult);

        if (!verifyResult.passed) {
          const error = `Incremental verification failed after ${file.path}: ${verifyResult.output || "typecheck failed"}`;
          await persistTaskOutcome(false, error, writtenFiles, incrementalVerification);
          return {
            success: false,
            plan,
            writtenFiles,
            incrementalVerification,
            error,
          };
        }
      }
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await persistTaskOutcome(false, error, writtenFiles, incrementalVerification);
    return {
      success: false,
      plan,
      writtenFiles,
      incrementalVerification,
      error,
    };
  }

  await persistTaskOutcome(true, undefined, writtenFiles, incrementalVerification);

  return { success: true, plan, writtenFiles, incrementalVerification };
}

// ─── Display helpers ──────────────────────────────────────────────────────────

export { formatAppScaffoldSummary as formatScaffoldSummary, detectProjectType };
