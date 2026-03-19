import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  BackgroundAgentTask,
  DurableRun,
  DurableRunStatus,
  ExecutionEvidence,
  PauseReason,
  ResumeHint,
  Session,
} from "@dantecode/config-types";
import type { AutoforgeCheckpointFile } from "./autoforge-checkpoint.js";
import { BackgroundTaskStore } from "./background-task-store.js";
import { EventSourcedCheckpointer } from "./checkpointer.js";
import { SessionStore } from "./session-store.js";

interface InitializeDurableRunOptions {
  runId?: string;
  session: Session;
  prompt: string;
  workflow: string;
}

interface DurableRunCheckpointPayload {
  session?: Session;
  touchedFiles?: string[];
  lastConfirmedStep?: string;
  lastSuccessfulTool?: string;
  nextAction?: string;
  message?: string;
  evidence?: ExecutionEvidence[];
  reason?: PauseReason;
}

const RUN_FILENAME = "run.json";
const RESUME_FILENAME = "resume.json";
const EVIDENCE_FILENAME = "evidence.json";

export class DurableRunStore {
  private readonly runsDir: string;
  private readonly sessionStore: SessionStore;

  constructor(private readonly projectRoot: string) {
    this.runsDir = join(projectRoot, ".danteforge", "runs");
    this.sessionStore = new SessionStore(projectRoot);
  }

  async initializeRun(options: InitializeDurableRunOptions): Promise<DurableRun> {
    const now = new Date().toISOString();
    const runId = options.runId ?? `run-${options.session.id}-${Date.now()}`;
    const run: DurableRun = {
      id: runId,
      projectRoot: this.projectRoot,
      sessionId: options.session.id,
      prompt: options.prompt,
      workflow: options.workflow,
      status: "running",
      createdAt: now,
      updatedAt: now,
      touchedFiles: [],
      evidenceCount: 0,
    };

    await this.persistRun(run, options.session, []);
    await this.persistCheckpoint(run, {
      source: "input",
      step: 0,
      triggerCommand: options.prompt,
    });

    return run;
  }

  async checkpoint(runId: string, payload: DurableRunCheckpointPayload): Promise<DurableRun> {
    const current = await this.requireRun(runId);
    const evidence = await this.mergeEvidence(runId, payload.evidence ?? []);
    const next = this.mergeRun(current, {
      ...payload,
      evidenceCount: evidence.length,
      status: current.status,
    });

    await this.persistRun(next, payload.session, evidence);
    await this.persistCheckpoint(next, {
      source: "loop",
      step: evidence.length,
      triggerCommand: current.prompt,
    });

    return next;
  }

  async pauseRun(
    runId: string,
    payload: DurableRunCheckpointPayload & { reason: PauseReason },
  ): Promise<DurableRun> {
    const current = await this.requireRun(runId);
    const evidence = await this.mergeEvidence(runId, payload.evidence ?? []);
    const next = this.mergeRun(current, {
      ...payload,
      status: "waiting_user",
      evidenceCount: evidence.length,
    });

    await this.persistRun(next, payload.session, evidence);
    await this.persistCheckpoint(next, {
      source: "update",
      step: evidence.length,
      triggerCommand: current.prompt,
      extra: { pauseReason: payload.reason },
    });

    return next;
  }

  async completeRun(runId: string, payload: DurableRunCheckpointPayload = {}): Promise<DurableRun> {
    const current = await this.requireRun(runId);
    const evidence = await this.mergeEvidence(runId, payload.evidence ?? []);
    const next = this.mergeRun(current, {
      ...payload,
      status: "completed",
      evidenceCount: evidence.length,
    });

    await this.persistRun(next, payload.session, evidence);
    await this.persistCheckpoint(next, {
      source: "update",
      step: evidence.length,
      triggerCommand: current.prompt,
    });

    return next;
  }

  async failRun(runId: string, payload: DurableRunCheckpointPayload = {}): Promise<DurableRun> {
    const current = await this.requireRun(runId);
    const evidence = await this.mergeEvidence(runId, payload.evidence ?? []);
    const next = this.mergeRun(current, {
      ...payload,
      status: "failed",
      evidenceCount: evidence.length,
    });

    await this.persistRun(next, payload.session, evidence);
    await this.persistCheckpoint(next, {
      source: "update",
      step: evidence.length,
      triggerCommand: current.prompt,
    });

    return next;
  }

  async appendEvidence(runId: string, evidence: ExecutionEvidence | ExecutionEvidence[]): Promise<void> {
    const current = await this.requireRun(runId);
    const merged = await this.mergeEvidence(runId, Array.isArray(evidence) ? evidence : [evidence]);
    const next: DurableRun = {
      ...current,
      evidenceCount: merged.length,
      updatedAt: new Date().toISOString(),
    };
    await this.persistRun(next, undefined, merged);
  }

  async loadRun(runId: string): Promise<DurableRun | null> {
    return this.readJson<DurableRun>(this.getRunFilePath(runId));
  }

  async loadEvidence(runId: string): Promise<ExecutionEvidence[]> {
    return (await this.readJson<ExecutionEvidence[]>(this.getEvidenceFilePath(runId))) ?? [];
  }

  async loadSessionSnapshot(runId: string): Promise<Session | null> {
    return this.sessionStore.loadRuntimeSession(runId);
  }

  async getResumeHint(runId: string): Promise<ResumeHint | null> {
    return this.readJson<ResumeHint>(this.getResumeFilePath(runId));
  }

  async listRuns(): Promise<DurableRun[]> {
    const runs: DurableRun[] = [];

    try {
      const entries = await readdir(this.runsDir);
      for (const entry of entries) {
        const run = await this.loadRun(entry);
        if (run) {
          runs.push(run);
        }
      }
    } catch {
      // No native durable runs yet.
    }

    runs.push(...(await this.listLegacyAutoforgeRuns()));
    runs.push(...(await this.listLegacyBackgroundRuns()));

    return runs.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  async getLatestWaitingUserRun(): Promise<DurableRun | null> {
    const runs = await this.listRuns();
    return runs.find((run) => run.status === "waiting_user") ?? null;
  }

  private async listLegacyAutoforgeRuns(): Promise<DurableRun[]> {
    const checkpointDir = join(this.projectRoot, ".dantecode", "autoforge-checkpoints");
    try {
      const entries = await readdir(checkpointDir);
      const rawRuns: Array<DurableRun | null> = await Promise.all(
        entries
          .filter((entry) => entry.endsWith(".json"))
          .map(async (entry) => {
            const file = await this.readJson<AutoforgeCheckpointFile>(join(checkpointDir, entry));
            if (!file) {
              return null;
            }
            const latest = file.checkpoints[file.checkpoints.length - 1];
            const updatedAt = latest?.createdAt ?? file.startedAt;
            return {
              id: file.sessionId,
              projectRoot: this.projectRoot,
              sessionId: file.sessionId,
              prompt: latest?.triggerCommand ?? "/autoforge",
              workflow: "autoforge",
              status: "waiting_user" as DurableRunStatus,
              createdAt: file.startedAt,
              updatedAt,
              touchedFiles: latest?.targetFilePath ? [latest.targetFilePath] : [],
              evidenceCount: latest?.pdseScores.length ?? 0,
              lastConfirmedStep: latest ? `Step ${latest.currentStep}` : undefined,
              nextAction: "Resume the last autoforge session.",
              legacySource: "autoforge_checkpoint" as const,
            } satisfies DurableRun;
          }),
      );

      return rawRuns.filter((run): run is DurableRun => run !== null);
    } catch {
      return [];
    }
  }

  private async listLegacyBackgroundRuns(): Promise<DurableRun[]> {
    const store = new BackgroundTaskStore(this.projectRoot);
    const tasks = await store.listTasks();
    return tasks.map((task) => this.backgroundTaskToRun(task));
  }

  private backgroundTaskToRun(task: BackgroundAgentTask): DurableRun {
    const status = this.backgroundStatusToDurableStatus(task.status);
    const updatedAt = task.completedAt ?? task.startedAt ?? task.createdAt;
    return {
      id: task.id,
      projectRoot: this.projectRoot,
      sessionId: task.id,
      prompt: task.prompt,
      workflow: "background",
      status,
      createdAt: task.createdAt,
      updatedAt,
      touchedFiles: task.touchedFiles ?? [],
      evidenceCount: 0,
      nextAction:
        status === "waiting_user" ? "Resume the paused background task." : task.progress,
      legacySource: "background_task",
    };
  }

  private backgroundStatusToDurableStatus(status: BackgroundAgentTask["status"]): DurableRunStatus {
    if (status === "paused") {
      return "waiting_user";
    }
    if (status === "queued" || status === "running") {
      return "running";
    }
    if (status === "completed") {
      return "completed";
    }
    if (status === "failed") {
      return "failed";
    }
    return "cancelled";
  }

  private async persistRun(
    run: DurableRun,
    session?: Session,
    evidence?: ExecutionEvidence[],
  ): Promise<void> {
    await this.ensureRunDir(run.id);
    await this.writeJson(this.getRunFilePath(run.id), run);

    if (typeof session !== "undefined") {
      await this.sessionStore.saveRuntimeSession(run.id, session);
    }

    if (typeof evidence !== "undefined") {
      await this.writeJson(this.getEvidenceFilePath(run.id), evidence);
    }

    if (run.resumeHint) {
      await this.writeJson(this.getResumeFilePath(run.id), run.resumeHint);
    }
  }

  private async persistCheckpoint(
    run: DurableRun,
    metadata: {
      source: "input" | "loop" | "update" | "fork";
      step: number;
      triggerCommand: string;
      extra?: Record<string, unknown>;
    },
  ): Promise<void> {
    const checkpointer = new EventSourcedCheckpointer(this.projectRoot, "run", {
      baseDir: join(this.getRunDir(run.id), "event-log"),
    });
    await checkpointer.put(
      {
        id: run.id,
        workflow: run.workflow,
        status: run.status,
        touchedFiles: run.touchedFiles,
        evidenceCount: run.evidenceCount,
        lastConfirmedStep: run.lastConfirmedStep,
        lastSuccessfulTool: run.lastSuccessfulTool,
        nextAction: run.nextAction,
      },
      metadata,
    );
  }

  private mergeRun(
    current: DurableRun,
    payload: DurableRunCheckpointPayload & {
      status: DurableRunStatus;
      evidenceCount: number;
    },
  ): DurableRun {
    const touchedFiles = uniqueStrings([...current.touchedFiles, ...(payload.touchedFiles ?? [])]);
    const updatedAt = new Date().toISOString();
    const resumeHint = this.buildResumeHint(current.id, {
      message: payload.message,
      lastConfirmedStep: payload.lastConfirmedStep ?? current.lastConfirmedStep,
      lastSuccessfulTool: payload.lastSuccessfulTool ?? current.lastSuccessfulTool,
      nextAction: payload.nextAction ?? current.nextAction ?? "Resume from the last checkpoint.",
    });

    return {
      ...current,
      status: payload.status,
      pauseReason: payload.reason ?? current.pauseReason,
      touchedFiles,
      evidenceCount: payload.evidenceCount,
      lastConfirmedStep: payload.lastConfirmedStep ?? current.lastConfirmedStep,
      lastSuccessfulTool: payload.lastSuccessfulTool ?? current.lastSuccessfulTool,
      nextAction: payload.nextAction ?? current.nextAction,
      resumeHint,
      updatedAt,
    };
  }

  private buildResumeHint(
    runId: string,
    payload: {
      message?: string;
      lastConfirmedStep?: string;
      lastSuccessfulTool?: string;
      nextAction: string;
    },
  ): ResumeHint {
    return {
      runId,
      summary: payload.message ?? "Execution paused before completion.",
      lastConfirmedStep: payload.lastConfirmedStep,
      lastSuccessfulTool: payload.lastSuccessfulTool,
      nextAction: payload.nextAction,
      continueCommand: "continue",
    };
  }

  private async mergeEvidence(runId: string, additions: ExecutionEvidence[]): Promise<ExecutionEvidence[]> {
    const current = await this.loadEvidence(runId);
    if (additions.length === 0) {
      return current;
    }
    return [...current, ...additions];
  }

  private async requireRun(runId: string): Promise<DurableRun> {
    const run = await this.loadRun(runId);
    if (!run) {
      throw new Error(`Durable run not found: ${runId}`);
    }
    return run;
  }

  private getRunDir(runId: string): string {
    return join(this.runsDir, runId);
  }

  private getRunFilePath(runId: string): string {
    return join(this.getRunDir(runId), RUN_FILENAME);
  }

  private getResumeFilePath(runId: string): string {
    return join(this.getRunDir(runId), RESUME_FILENAME);
  }

  private getEvidenceFilePath(runId: string): string {
    return join(this.getRunDir(runId), EVIDENCE_FILENAME);
  }

  private async ensureRunDir(runId: string): Promise<void> {
    await mkdir(this.getRunDir(runId), { recursive: true });
  }

  private async writeJson(path: string, value: unknown): Promise<void> {
    await writeFile(path, JSON.stringify(value, null, 2), "utf-8");
  }

  private async readJson<T>(path: string): Promise<T | null> {
    try {
      const raw = await readFile(path, "utf-8");
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.length > 0)));
}
