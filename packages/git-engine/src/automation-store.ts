import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export interface StoredAutomationEvent {
  id: string;
  timestamp: string;
  summary: string;
  payload: Record<string, unknown>;
}

export interface StoredGitWatcherRecord {
  id: string;
  eventType: string;
  cwd: string;
  targetPath?: string;
  debounceMs: number;
  status: "active" | "stopped" | "error";
  startedAt: string;
  updatedAt: string;
  stoppedAt?: string;
  lastEventAt?: string;
  eventCount: number;
  recentEvents: StoredAutomationEvent[];
  error?: string;
}

export interface StoredWorkflowRunRecord {
  id: string;
  workflowPath: string;
  cwd: string;
  status: "running" | "completed" | "failed";
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  workflowName: string;
  jobCount: number;
  stepCount: number;
  success?: boolean;
  eventName?: string;
  eventPayloadPath?: string;
  error?: string;
}

export interface StoredWebhookListenerRecord {
  id: string;
  provider: string;
  port: number;
  path: string;
  status: "active" | "stopped" | "error";
  startedAt: string;
  updatedAt: string;
  stoppedAt?: string;
  lastEventAt?: string;
  receivedCount: number;
  recentEvents: StoredAutomationEvent[];
  error?: string;
}

export interface StoredScheduledTaskRun {
  id: string;
  startedAt: string;
  completedAt?: string;
  success: boolean;
  error?: string;
}

export interface StoredScheduledTaskRecord {
  id: string;
  taskName: string;
  schedule: string;
  cwd: string;
  status: "active" | "stopped" | "error";
  startedAt: string;
  updatedAt: string;
  stoppedAt?: string;
  lastRunAt?: string;
  nextRunAt?: string;
  runCount: number;
  recentRuns: StoredScheduledTaskRun[];
  error?: string;
}

export interface StoredAutoPRRecord {
  id: string;
  title: string;
  cwd: string;
  status: "running" | "completed" | "failed";
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  base?: string;
  draft: boolean;
  prUrl?: string;
  changesetFiles: string[];
  error?: string;
}

export type StoredAutomationTriggerKind = "manual" | "watch" | "webhook" | "schedule";

export interface StoredAutomationTrigger {
  kind: StoredAutomationTriggerKind;
  sourceId?: string;
  label?: string;
}

export interface StoredAutomationExecutionRecord {
  id: string;
  kind: "workflow" | "auto_pr";
  cwd: string;
  status: "queued" | "running" | "completed" | "failed" | "blocked";
  gateStatus: "pending" | "passed" | "failed" | "skipped";
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  backgroundTaskId?: string;
  checkpointSessionId?: string;
  workflowPath?: string;
  workflowName?: string;
  title?: string;
  prUrl?: string;
  trigger?: StoredAutomationTrigger;
  modifiedFiles: string[];
  pdseScore?: number;
  repoVerificationPassed?: boolean;
  summary?: string;
  error?: string;
}

interface GitAutomationState {
  watchers: StoredGitWatcherRecord[];
  workflowRuns: StoredWorkflowRunRecord[];
  webhookListeners: StoredWebhookListenerRecord[];
  scheduledTasks: StoredScheduledTaskRecord[];
  autoPullRequests: StoredAutoPRRecord[];
  automationExecutions: StoredAutomationExecutionRecord[];
}

type AutomationBucket = keyof GitAutomationState;
type BucketRecordMap = {
  watchers: StoredGitWatcherRecord;
  workflowRuns: StoredWorkflowRunRecord;
  webhookListeners: StoredWebhookListenerRecord;
  scheduledTasks: StoredScheduledTaskRecord;
  autoPullRequests: StoredAutoPRRecord;
  automationExecutions: StoredAutomationExecutionRecord;
};

const EMPTY_STATE: GitAutomationState = {
  watchers: [],
  workflowRuns: [],
  webhookListeners: [],
  scheduledTasks: [],
  autoPullRequests: [],
  automationExecutions: [],
};

const STORE_LOCKS = new Map<string, Promise<void>>();

function cloneState(state: GitAutomationState): GitAutomationState {
  return {
    watchers: [...state.watchers],
    workflowRuns: [...state.workflowRuns],
    webhookListeners: [...state.webhookListeners],
    scheduledTasks: [...state.scheduledTasks],
    autoPullRequests: [...state.autoPullRequests],
    automationExecutions: [...state.automationExecutions],
  };
}

async function withStoreLock<T>(storePath: string, work: () => Promise<T>): Promise<T> {
  const previous = STORE_LOCKS.get(storePath) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });

  STORE_LOCKS.set(
    storePath,
    previous.then(() => current),
  );
  await previous;

  try {
    return await work();
  } finally {
    release();
    if (STORE_LOCKS.get(storePath) === current) {
      STORE_LOCKS.delete(storePath);
    }
  }
}

export class GitAutomationStore {
  private readonly storePath: string;

  constructor(projectRoot: string) {
    this.storePath = join(projectRoot, ".dantecode", "git-engine", "automation-state.json");
  }

  async listWatchers(): Promise<StoredGitWatcherRecord[]> {
    return [...(await this.readState()).watchers];
  }

  async upsertWatcher(record: StoredGitWatcherRecord): Promise<void> {
    await this.upsertRecord("watchers", record);
  }

  async listWorkflowRuns(): Promise<StoredWorkflowRunRecord[]> {
    return [...(await this.readState()).workflowRuns];
  }

  async upsertWorkflowRun(record: StoredWorkflowRunRecord): Promise<void> {
    await this.upsertRecord("workflowRuns", record);
  }

  async listWebhookListeners(): Promise<StoredWebhookListenerRecord[]> {
    return [...(await this.readState()).webhookListeners];
  }

  async upsertWebhookListener(record: StoredWebhookListenerRecord): Promise<void> {
    await this.upsertRecord("webhookListeners", record);
  }

  async listScheduledTasks(): Promise<StoredScheduledTaskRecord[]> {
    return [...(await this.readState()).scheduledTasks];
  }

  async upsertScheduledTask(record: StoredScheduledTaskRecord): Promise<void> {
    await this.upsertRecord("scheduledTasks", record);
  }

  async listAutoPullRequests(): Promise<StoredAutoPRRecord[]> {
    return [...(await this.readState()).autoPullRequests];
  }

  async upsertAutoPullRequest(record: StoredAutoPRRecord): Promise<void> {
    await this.upsertRecord("autoPullRequests", record);
  }

  async listAutomationExecutions(): Promise<StoredAutomationExecutionRecord[]> {
    return [...(await this.readState()).automationExecutions];
  }

  async upsertAutomationExecution(record: StoredAutomationExecutionRecord): Promise<void> {
    await this.upsertRecord("automationExecutions", record);
  }

  private async upsertRecord<K extends AutomationBucket>(
    bucket: K,
    record: BucketRecordMap[K],
  ): Promise<void> {
    await this.updateState((state) => {
      const next = cloneState(state);
      const records = [...next[bucket]];
      const index = records.findIndex((entry) => entry.id === record.id);
      if (index >= 0) {
        records[index] = record;
      } else {
        records.push(record);
      }
      next[bucket] = records as GitAutomationState[K];
      return next;
    });
  }

  private async readState(): Promise<GitAutomationState> {
    try {
      const raw = await readFile(this.storePath, "utf-8");
      const parsed = JSON.parse(raw) as Partial<GitAutomationState>;
      return {
        watchers: Array.isArray(parsed.watchers) ? parsed.watchers : [],
        workflowRuns: Array.isArray(parsed.workflowRuns) ? parsed.workflowRuns : [],
        webhookListeners: Array.isArray(parsed.webhookListeners) ? parsed.webhookListeners : [],
        scheduledTasks: Array.isArray(parsed.scheduledTasks) ? parsed.scheduledTasks : [],
        autoPullRequests: Array.isArray(parsed.autoPullRequests) ? parsed.autoPullRequests : [],
        automationExecutions: Array.isArray(parsed.automationExecutions)
          ? parsed.automationExecutions
          : [],
      };
    } catch (error: unknown) {
      if (isNodeError(error, "ENOENT")) {
        return cloneState(EMPTY_STATE);
      }
      // Treat corrupt JSON (e.g. partial write during concurrent access) as empty state
      if (error instanceof SyntaxError) {
        return cloneState(EMPTY_STATE);
      }
      throw error;
    }
  }

  private async updateState(
    update: (state: GitAutomationState) => GitAutomationState,
  ): Promise<void> {
    await withStoreLock(this.storePath, async () => {
      const current = await this.readState();
      const next = update(current);
      await mkdir(dirname(this.storePath), { recursive: true });
      await writeFile(this.storePath, JSON.stringify(next, null, 2), "utf-8");
    });
  }
}

export function keepLatest<T>(items: readonly T[], maxItems: number): T[] {
  if (items.length <= maxItems) {
    return [...items];
  }
  return [...items.slice(items.length - maxItems)];
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
