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
interface PersistContext {
  description: string;
  startedAt: string;
  plan: ReturnType<typeof generateScaffold>;
  outDir: string;
  verifyEachFile: boolean;
  options: GenerateOptions;
}

async function persistGenerateOutcome(
  ctx: PersistContext,
  success: boolean,
  error: string | undefined,
  writtenFiles: string[],
  incrementalVerification: IncrementalVerifyResult[],
): Promise<void> {
  if (ctx.options.dryRun) return;

  const verificationSnapshots = incrementalVerification.map((result, index) => ({
    kind: `incremental-verify-${index + 1}`,
    passed: result.passed,
    summary: result.output || (result.passed ? "typecheck passed" : "typecheck failed"),
  }));

  const recorder =
    ctx.options.taskOutcomeRecorder ??
    (async (artifact: RecordTaskOutcomeInput, projectRoot: string) => {
      const danteforge = (await import("@dantecode/danteforge")) as unknown as {
        recordTaskOutcome?: (a: unknown, p: string) => Promise<void>;
      };
      await danteforge.recordTaskOutcome?.(artifact, projectRoot);
    });

  await recorder(
    {
      command: "generate",
      taskDescription: ctx.description,
      success,
      startedAt: ctx.startedAt,
      verificationSnapshots,
      evidenceRefs: writtenFiles,
      error,
      metadata: {
        projectName: ctx.plan.projectName,
        projectType: ctx.plan.projectType,
        filesPlanned: ctx.plan.files.length,
        filesWritten: writtenFiles.length,
        verifyEachFile: ctx.verifyEachFile,
      },
    },
    ctx.outDir,
  );
}

/** Write one file then run the incremental verify gate (when enabled).
 *  Returns the failure reason if verification rejected the file. */
async function writeAndVerifyOne(
  ctx: PersistContext,
  file: { path: string; content: string },
  writtenFiles: string[],
  incrementalVerification: IncrementalVerifyResult[],
): Promise<string | null> {
  const fullPath = join(ctx.outDir, file.path);
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, file.content, "utf8");
  writtenFiles.push(fullPath);

  if (!ctx.verifyEachFile) return null;
  const stackTemplate =
    ctx.options.stackTemplateOverride ?? (await detectProjectStack(ctx.outDir));
  const verifyResult = await incrementalVerifyGate(
    fullPath,
    stackTemplate,
    ctx.options.incrementalExecFn,
  );
  incrementalVerification.push(verifyResult);
  if (verifyResult.passed) return null;
  return `Incremental verification failed after ${file.path}: ${verifyResult.output || "typecheck failed"}`;
}

export async function cmdGenerate(
  description: string,
  options: GenerateOptions = {},
): Promise<GenerateResult> {
  if (!description || description.trim().length < 3) {
    return {
      success: false,
      plan: generateScaffold("empty"),
      writtenFiles: [],
      error: "Description must be at least 3 characters.",
    };
  }

  const plan = generateScaffold(description, {
    projectName: options.name,
    projectType: options.projectType as AppScaffoldOptions["projectType"],
  });
  const ctx: PersistContext = {
    description,
    startedAt: new Date().toISOString(),
    plan,
    outDir: options.outDir ?? `./${plan.projectName}`,
    verifyEachFile: options.verifyEachFile ?? true,
    options,
  };

  if (options.dryRun) {
    return { success: true, plan, writtenFiles: [] };
  }

  const writtenFiles: string[] = [];
  const incrementalVerification: IncrementalVerifyResult[] = [];
  try {
    for (const file of plan.files) {
      const failure = await writeAndVerifyOne(ctx, file, writtenFiles, incrementalVerification);
      if (failure !== null) {
        await persistGenerateOutcome(ctx, false, failure, writtenFiles, incrementalVerification);
        return { success: false, plan, writtenFiles, incrementalVerification, error: failure };
      }
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await persistGenerateOutcome(ctx, false, error, writtenFiles, incrementalVerification);
    return { success: false, plan, writtenFiles, incrementalVerification, error };
  }

  await persistGenerateOutcome(ctx, true, undefined, writtenFiles, incrementalVerification);
  return { success: true, plan, writtenFiles, incrementalVerification };
}

// ─── Display helpers ──────────────────────────────────────────────────────────

export { formatAppScaffoldSummary as formatScaffoldSummary, detectProjectType };
