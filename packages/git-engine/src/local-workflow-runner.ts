import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import * as path from "node:path";
import { parse as parseYaml } from "yaml";
import {
  GitAutomationStore,
  type StoredWorkflowRunRecord,
} from "./automation-store.js";

export interface WorkflowOptions {
  cwd?: string;
  env?: Record<string, string>;
  shell?: string;
  timeoutMs?: number;
  continueOnError?: boolean;
  jobFilter?: string | string[];
  workflowId?: string;
  persist?: boolean;
  commandRunner?: WorkflowCommandRunner;
}

export interface WorkflowStepResult {
  name: string;
  success: boolean;
  output: string;
  error?: string;
  skipped?: boolean;
  durationMs: number;
  workingDirectory: string;
  shell: string;
}

export interface WorkflowJobResult {
  jobId: string;
  jobName: string;
  success: boolean;
  matrix?: Record<string, string>;
  steps: WorkflowStepResult[];
}

export interface WorkflowResult {
  id: string;
  success: boolean;
  workflowName: string;
  jobName: string;
  steps: WorkflowStepResult[];
  jobs: WorkflowJobResult[];
  eventPayloadPath?: string;
  totalDurationMs: number;
}

export interface WorkflowCommandRunnerOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  shell: string;
  timeoutMs?: number;
}

export interface WorkflowCommandResult {
  stdout: string;
  stderr: string;
}

export type WorkflowCommandRunner = (
  command: string,
  options: WorkflowCommandRunnerOptions,
) => Promise<WorkflowCommandResult>;

interface ParsedWorkflowStep {
  name?: string;
  run?: string;
  env?: Record<string, unknown>;
  if?: string;
  shell?: string;
  "working-directory"?: string;
}

interface ParsedWorkflowDefaults {
  run?: {
    shell?: string;
    "working-directory"?: string;
  };
}

interface ParsedWorkflowJob {
  name?: string;
  strategy?: {
    matrix?: Record<string, unknown>;
  };
  env?: Record<string, unknown>;
  defaults?: ParsedWorkflowDefaults;
  steps?: ParsedWorkflowStep[];
}

interface ParsedWorkflowDefinition {
  name?: string;
  jobs?: Record<string, ParsedWorkflowJob>;
}

export class LocalWorkflowRunner {
  private readonly cwd: string;
  private readonly store: GitAutomationStore;

  constructor(private readonly options: WorkflowOptions = {}) {
    this.cwd = path.resolve(options.cwd ?? process.cwd());
    this.store = new GitAutomationStore(this.cwd);
  }

  public async runWorkflow(
    workflowPath: string,
    eventPayload?: Record<string, unknown>,
  ): Promise<WorkflowResult> {
    const startedAt = Date.now();
    const workflowId = this.options.workflowId ?? randomUUID().slice(0, 12);
    const runner = this.options.commandRunner ?? runShellCommand;
    const definition = await this.loadWorkflowDefinition(workflowPath);
    const workflowName = definition.name?.trim() || path.basename(workflowPath);
    const eventName = deriveEventName(eventPayload);
    const jobFilter = normalizeJobFilter(this.options.jobFilter);
    const jobEntries = Object.entries(definition.jobs ?? {}).filter(([jobId]) =>
      jobFilter ? jobFilter.has(jobId) : true,
    );

    const eventPayloadPath = eventPayload
      ? await this.writeEventPayload(workflowId, eventPayload)
      : undefined;

    await this.persist({
      id: workflowId,
      workflowPath,
      cwd: this.cwd,
      status: "running",
      startedAt: new Date(startedAt).toISOString(),
      updatedAt: new Date(startedAt).toISOString(),
      workflowName,
      jobCount: jobEntries.length,
      stepCount: 0,
      ...(eventPayloadPath ? { eventPayloadPath } : {}),
      eventName,
    });

    const jobs: WorkflowJobResult[] = [];
    let success = true;

    for (const [jobId, job] of jobEntries) {
      const matrices = expandMatrix(job.strategy?.matrix);
      const jobRuns = matrices.length > 0 ? matrices : [undefined];

      for (const matrix of jobRuns) {
        const jobResult = await this.runJob(
          workflowName,
          jobId,
          job,
          matrix,
          workflowPath,
          eventName,
          eventPayloadPath,
          runner,
        );
        jobs.push(jobResult);
        if (!jobResult.success) {
          success = false;
          if (!this.options.continueOnError) {
            break;
          }
        }
      }

      if (!success && !this.options.continueOnError) {
        break;
      }
    }

    const completedAt = Date.now();
    const flattenedSteps = jobs[0]?.steps ?? [];
    const result: WorkflowResult = {
      id: workflowId,
      success,
      workflowName,
      jobName: jobs[0]?.jobName ?? workflowName,
      steps: flattenedSteps,
      jobs,
      ...(eventPayloadPath ? { eventPayloadPath } : {}),
      totalDurationMs: completedAt - startedAt,
    };

    await this.persist({
      id: workflowId,
      workflowPath,
      cwd: this.cwd,
      status: success ? "completed" : "failed",
      startedAt: new Date(startedAt).toISOString(),
      updatedAt: new Date(completedAt).toISOString(),
      completedAt: new Date(completedAt).toISOString(),
      workflowName,
      jobCount: jobs.length,
      stepCount: jobs.reduce((total, job) => total + job.steps.length, 0),
      success,
      ...(eventPayloadPath ? { eventPayloadPath } : {}),
      eventName,
      ...(!success ? { error: firstWorkflowError(jobs) } : {}),
    });

    return result;
  }

  private async runJob(
    workflowName: string,
    jobId: string,
    job: ParsedWorkflowJob,
    matrix: Record<string, string> | undefined,
    workflowPath: string,
    eventName: string,
    eventPayloadPath: string | undefined,
    runner: WorkflowCommandRunner,
  ): Promise<WorkflowJobResult> {
    const jobEnv = normalizeEnv(job.env);
    const steps = job.steps ?? [];
    const results: WorkflowStepResult[] = [];
    let success = true;

    for (let index = 0; index < steps.length; index++) {
      const step = steps[index]!;
      const stepName = step.name?.trim() || `Step ${index + 1}`;
      const shouldRun = evaluateCondition(step.if, {
        eventName,
        matrix,
        env: {
          ...jobEnv,
          ...normalizeEnv(step.env),
        },
      });

      if (!step.run || !shouldRun) {
        results.push({
          name: stepName,
          success: shouldRun,
          output: "",
          skipped: !shouldRun || !step.run,
          durationMs: 0,
          workingDirectory: resolveWorkingDirectory(this.cwd, job.defaults, step),
          shell: resolveShell(step.shell, job.defaults?.run?.shell, this.options.shell),
        });
        continue;
      }

      const shell = resolveShell(step.shell, job.defaults?.run?.shell, this.options.shell);
      const workingDirectory = resolveWorkingDirectory(this.cwd, job.defaults, step);
      const env = {
        ...process.env,
        ...this.options.env,
        ...jobEnv,
        ...normalizeEnv(step.env),
        ...matrixToEnv(matrix),
        GITHUB_ACTIONS: "true",
        GITHUB_WORKSPACE: this.cwd,
        GITHUB_WORKFLOW: workflowName,
        GITHUB_JOB: jobId,
        GITHUB_RUN_ID: path.basename(workflowPath),
        GITHUB_EVENT_NAME: eventName,
        ...(eventPayloadPath ? { GITHUB_EVENT_PATH: eventPayloadPath } : {}),
      };

      const startedAt = Date.now();

      try {
        const commandResult = await runner(step.run, {
          cwd: workingDirectory,
          env,
          shell,
          timeoutMs: this.options.timeoutMs,
        });
        const output = combineOutput(commandResult.stdout, commandResult.stderr);
        results.push({
          name: stepName,
          success: true,
          output,
          durationMs: Date.now() - startedAt,
          workingDirectory,
          shell,
        });
      } catch (error: unknown) {
        success = false;
        const message = error instanceof Error ? error.message : String(error);
        results.push({
          name: stepName,
          success: false,
          output: "",
          error: message,
          durationMs: Date.now() - startedAt,
          workingDirectory,
          shell,
        });
        if (!this.options.continueOnError) {
          break;
        }
      }
    }

    return {
      jobId,
      jobName: job.name?.trim() || jobId,
      success,
      ...(matrix ? { matrix } : {}),
      steps: results,
    };
  }

  private async loadWorkflowDefinition(workflowPath: string): Promise<ParsedWorkflowDefinition> {
    const fullPath = path.resolve(this.cwd, workflowPath);
    const raw = await readFile(fullPath, "utf-8");
    const parsed = parseYaml(raw) as ParsedWorkflowDefinition | null;

    if (!parsed || typeof parsed !== "object") {
      throw new Error(`Workflow file is empty or invalid: ${fullPath}`);
    }

    if (!parsed.jobs || Object.keys(parsed.jobs).length === 0) {
      throw new Error(`Workflow does not define any jobs: ${fullPath}`);
    }

    return parsed;
  }

  private async writeEventPayload(
    workflowId: string,
    eventPayload: Record<string, unknown>,
  ): Promise<string> {
    const eventDir = path.join(this.cwd, ".dantecode", "git-engine", "workflow-events");
    await mkdir(eventDir, { recursive: true });
    const eventPath = path.join(eventDir, `${workflowId}.json`);
    await writeFile(eventPath, JSON.stringify(eventPayload, null, 2), "utf-8");
    return eventPath;
  }

  private async persist(record: StoredWorkflowRunRecord): Promise<void> {
    if (this.options.persist === false) {
      return;
    }
    await this.store.upsertWorkflowRun(record);
  }
}

export async function runLocalWorkflow(
  workflowPath: string,
  eventPayload?: Record<string, unknown>,
  options?: WorkflowOptions,
): Promise<WorkflowResult> {
  const runner = new LocalWorkflowRunner(options);
  return runner.runWorkflow(workflowPath, eventPayload);
}

async function runShellCommand(
  command: string,
  options: WorkflowCommandRunnerOptions,
): Promise<WorkflowCommandResult> {
  return new Promise<WorkflowCommandResult>((resolve, reject) => {
    const child = spawn(command, {
      cwd: options.cwd,
      env: options.env,
      shell: options.shell,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let timeout: NodeJS.Timeout | undefined;

    if (options.timeoutMs && options.timeoutMs > 0) {
      timeout = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, options.timeoutMs);
    }

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf-8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
    });

    child.on("error", (error) => {
      if (timeout) {
        clearTimeout(timeout);
      }
      reject(error);
    });

    child.on("close", (code) => {
      if (timeout) {
        clearTimeout(timeout);
      }

      if (timedOut) {
        reject(new Error(`Command timed out after ${options.timeoutMs}ms`));
        return;
      }

      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(new Error(combineOutput(stdout, stderr) || `Command failed with exit code ${code}`));
    });
  });
}

function expandMatrix(
  matrix: Record<string, unknown> | undefined,
): Array<Record<string, string>> {
  if (!matrix || Object.keys(matrix).length === 0) {
    return [];
  }

  return Object.entries(matrix).reduce<Array<Record<string, string>>>((accumulator, [key, value]) => {
    const values = Array.isArray(value)
      ? value.map((entry) => String(entry))
      : value !== undefined
        ? [String(value)]
        : [];

    if (accumulator.length === 0) {
      return values.map((entry) => ({ [key]: entry }));
    }

    const next: Array<Record<string, string>> = [];
    for (const existing of accumulator) {
      for (const entry of values) {
        next.push({ ...existing, [key]: entry });
      }
    }
    return next;
  }, []);
}

function normalizeEnv(
  value: Record<string, unknown> | undefined,
): Record<string, string> {
  if (!value) {
    return {};
  }

  const env: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    env[key] = String(entry);
  }
  return env;
}

function matrixToEnv(matrix: Record<string, string> | undefined): Record<string, string> {
  if (!matrix) {
    return {};
  }

  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(matrix)) {
    env[`MATRIX_${key.toUpperCase()}`] = value;
  }
  return env;
}

function resolveShell(
  stepShell: string | undefined,
  defaultShell: string | undefined,
  optionShell: string | undefined,
): string {
  return (
    stepShell ||
    defaultShell ||
    optionShell ||
    process.env["COMSPEC"] ||
    process.env["SHELL"] ||
    "sh"
  );
}

function resolveWorkingDirectory(
  cwd: string,
  defaults: ParsedWorkflowDefaults | undefined,
  step: ParsedWorkflowStep,
): string {
  const configured =
    step["working-directory"] ?? defaults?.run?.["working-directory"];
  return configured ? path.resolve(cwd, configured) : cwd;
}

function normalizeJobFilter(jobFilter: WorkflowOptions["jobFilter"]): Set<string> | null {
  if (!jobFilter) {
    return null;
  }

  const values = Array.isArray(jobFilter) ? jobFilter : [jobFilter];
  return new Set(values.map((value) => value.trim()).filter((value) => value.length > 0));
}

function evaluateCondition(
  condition: string | undefined,
  context: {
    eventName: string;
    matrix?: Record<string, string>;
    env: Record<string, string>;
  },
): boolean {
  if (!condition || condition.trim().length === 0 || condition.trim() === "always()") {
    return true;
  }

  const trimmed = condition.trim();
  if (trimmed === "false") {
    return false;
  }

  const match = trimmed.match(
    /^(github\.event_name|matrix\.[A-Za-z0-9_-]+|env\.[A-Za-z0-9_]+)\s*(==|!=)\s*['"]?([^'"]+)['"]?$/,
  );
  if (!match) {
    return true;
  }

  const left = match[1];
  const operator = match[2];
  const right = match[3];
  if (!left || !operator || !right) {
    return true;
  }
  let actual = "";

  if (left === "github.event_name") {
    actual = context.eventName;
  } else if (left.startsWith("matrix.")) {
    actual = context.matrix?.[left.slice("matrix.".length)] ?? "";
  } else {
    actual = context.env[left.slice("env.".length)] ?? "";
  }

  return operator === "==" ? actual === right : actual !== right;
}

function deriveEventName(eventPayload: Record<string, unknown> | undefined): string {
  if (!eventPayload) {
    return "workflow_dispatch";
  }

  const explicit = eventPayload["eventName"];
  if (typeof explicit === "string" && explicit.trim().length > 0) {
    return explicit.trim();
  }

  const action = eventPayload["action"];
  if (typeof action === "string" && action.trim().length > 0) {
    return action.trim();
  }

  return "workflow_dispatch";
}

function combineOutput(stdout: string, stderr: string): string {
  const trimmedStdout = stdout.trim();
  const trimmedStderr = stderr.trim();
  if (trimmedStdout && trimmedStderr) {
    return `${trimmedStdout}\n${trimmedStderr}`;
  }
  return trimmedStdout || trimmedStderr;
}

function firstWorkflowError(jobs: WorkflowJobResult[]): string | undefined {
  for (const job of jobs) {
    const failedStep = job.steps.find((step) => step.success === false && step.error);
    if (failedStep?.error) {
      return failedStep.error;
    }
  }
  return undefined;
}
