import * as fs from "node:fs";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import * as path from "node:path";
import {
  GitAutomationStore,
  keepLatest,
  type StoredAutomationEvent,
  type StoredGitWatcherRecord,
} from "./automation-store.js";

export type GitEventType = "post-commit" | "pre-push" | "branch-update" | "file-change";

export interface GitWatchOptions {
  cwd?: string;
  debounceMs?: number;
  ignore?: string[];
  persist?: boolean;
  recursive?: boolean;
  watchId?: string;
  maxHistory?: number;
}

interface BaseGitWatchData {
  watchId: string;
  cwd: string;
  absolutePath: string;
  relativePath: string;
}

export interface GitHookWatchData extends BaseGitWatchData {
  hook: "post-commit" | "pre-push";
}

export interface GitBranchWatchData extends BaseGitWatchData {
  branch: string;
}

export interface GitFileWatchData extends BaseGitWatchData {
  file: string;
}

export interface GitWatchEvent {
  id: string;
  type: GitEventType;
  timestamp: string;
  data: GitHookWatchData | GitBranchWatchData | GitFileWatchData;
}

const DEFAULT_IGNORES = [".git", "node_modules", "dist"];
const ACTIVE_GIT_WATCHERS = new Map<string, GitEventWatcher>();

export class GitEventWatcher extends EventEmitter {
  private readonly watcherId: string;
  private readonly watchers = new Map<string, fs.FSWatcher>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly cwd: string;
  private readonly debounceMs: number;
  private readonly ignorePatterns: string[];
  private readonly persist: boolean;
  private readonly maxHistory: number;
  private readonly recursive: boolean;
  private readonly store: GitAutomationStore;
  private readonly startedAt: string;
  private pendingPersistence: Promise<void> = Promise.resolve();
  private eventType?: GitEventType;
  private targetPath?: string;
  private recentEvents: StoredAutomationEvent[] = [];
  private eventCount = 0;
  private status: StoredGitWatcherRecord["status"] = "active";
  private stoppedAt?: string;
  private lastEventAt?: string;
  private error?: string;

  constructor(options: GitWatchOptions = {}) {
    super();
    this.cwd = path.resolve(options.cwd ?? process.cwd());
    this.debounceMs = options.debounceMs ?? 250;
    this.ignorePatterns = [...DEFAULT_IGNORES, ...(options.ignore ?? [])];
    this.persist = options.persist ?? true;
    this.maxHistory = options.maxHistory ?? 20;
    this.recursive = options.recursive ?? true;
    this.watcherId = options.watchId ?? randomUUID().slice(0, 12);
    this.store = new GitAutomationStore(this.cwd);
    this.startedAt = new Date().toISOString();
  }

  get id(): string {
    return this.watcherId;
  }

  public watch(eventType: GitEventType, targetPath?: string): void {
    this.eventType = eventType;
    this.targetPath = targetPath;
    const absoluteTarget = this.resolveTargetPath(eventType, targetPath);
    const watchTarget =
      eventType === "post-commit" || eventType === "pre-push"
        ? path.dirname(absoluteTarget)
        : absoluteTarget;

    if (!fs.existsSync(absoluteTarget)) {
      throw new Error(`Watch target does not exist: ${absoluteTarget}`);
    }

    const transform = (filename: string | null): GitWatchEvent | null => {
      const resolvedPath = this.resolveFilename(watchTarget, filename);
      if (!resolvedPath) {
        return null;
      }

      if (
        (eventType === "post-commit" || eventType === "pre-push") &&
        path.resolve(resolvedPath) !== path.resolve(absoluteTarget)
      ) {
        return null;
      }

      const relativePath = path.relative(this.cwd, resolvedPath).replace(/\\/g, "/");
      if (this.shouldIgnore(relativePath)) {
        return null;
      }

      const timestamp = new Date().toISOString();
      const id = randomUUID().slice(0, 12);

      if (eventType === "post-commit" || eventType === "pre-push") {
        return {
          id,
          type: eventType,
          timestamp,
          data: {
            watchId: this.watcherId,
            cwd: this.cwd,
            absolutePath: resolvedPath,
            relativePath,
            hook: eventType,
          },
        };
      }

      if (eventType === "branch-update") {
        return {
          id,
          type: eventType,
          timestamp,
          data: {
            watchId: this.watcherId,
            cwd: this.cwd,
            absolutePath: resolvedPath,
            relativePath,
            branch: filename?.replace(/\\/g, "/") || path.basename(resolvedPath),
          },
        };
      }

      return {
        id,
        type: eventType,
        timestamp,
        data: {
          watchId: this.watcherId,
          cwd: this.cwd,
          absolutePath: resolvedPath,
          relativePath,
          file: filename?.replace(/\\/g, "/") || path.basename(resolvedPath),
        },
      };
    };

    this.addWatcher(watchTarget, transform);
    ACTIVE_GIT_WATCHERS.set(this.watcherId, this);
    void this.persistSnapshot();
  }

  public snapshot(): StoredGitWatcherRecord {
    return {
      id: this.watcherId,
      eventType: this.eventType ?? "file-change",
      cwd: this.cwd,
      ...(this.targetPath ? { targetPath: this.targetPath } : {}),
      debounceMs: this.debounceMs,
      status: this.status,
      startedAt: this.startedAt,
      updatedAt: new Date().toISOString(),
      ...(this.stoppedAt ? { stoppedAt: this.stoppedAt } : {}),
      ...(this.lastEventAt ? { lastEventAt: this.lastEventAt } : {}),
      eventCount: this.eventCount,
      recentEvents: [...this.recentEvents],
      ...(this.error ? { error: this.error } : {}),
    };
  }

  public async stop(): Promise<void> {
    for (const watcher of this.watchers.values()) {
      watcher.close();
    }
    this.watchers.clear();

    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();

    this.status = this.status === "error" ? "error" : "stopped";
    this.stoppedAt = new Date().toISOString();
    ACTIVE_GIT_WATCHERS.delete(this.watcherId);
    await this.persistSnapshot();
  }

  public async flush(): Promise<void> {
    await this.pendingPersistence;
  }

  private resolveTargetPath(eventType: GitEventType, targetPath?: string): string {
    if (eventType === "file-change") {
      return path.resolve(this.cwd, targetPath ?? ".");
    }

    if ((eventType === "post-commit" || eventType === "pre-push") && targetPath) {
      return path.resolve(this.cwd, targetPath);
    }

    const gitDir = path.join(this.cwd, ".git");
    if (!fs.existsSync(gitDir)) {
      throw new Error(`Not a git repository: ${this.cwd}`);
    }

    if (eventType === "post-commit") {
      return path.join(gitDir, "logs", "HEAD");
    }

    if (eventType === "pre-push") {
      throw new Error(
        "pre-push watching requires a hook marker path. Pass a file path that your pre-push hook updates.",
      );
    }

    return path.join(gitDir, "refs", "heads");
  }

  private resolveFilename(targetPath: string, filename: string | null): string | null {
    if (filename && filename.length > 0) {
      return fs.statSync(targetPath).isDirectory()
        ? path.resolve(targetPath, filename.toString())
        : targetPath;
    }

    return targetPath;
  }

  private addWatcher(
    targetPath: string,
    transform: (filename: string | null) => GitWatchEvent | null,
  ): void {
    if (this.watchers.has(targetPath)) {
      return;
    }

    try {
      const isDirectory = fs.statSync(targetPath).isDirectory();
      const watcher = fs.watch(
        targetPath,
        { recursive: isDirectory && this.recursive },
        (_eventType, filename) => {
          const timerKey = `${targetPath}:${filename ?? ""}`;
          const existingTimer = this.timers.get(timerKey);
          if (existingTimer) {
            clearTimeout(existingTimer);
          }

          const timer = setTimeout(() => {
            this.timers.delete(timerKey);
            try {
              const event = transform(filename);
              if (!event) {
                return;
              }
              this.recordEvent(event);
            } catch (error: unknown) {
              this.recordError(error);
            }
          }, this.debounceMs);

          this.timers.set(timerKey, timer);
        },
      );

      this.watchers.set(targetPath, watcher);
    } catch (error: unknown) {
      this.recordError(error);
      throw error;
    }
  }

  private shouldIgnore(relativePath: string): boolean {
    return this.ignorePatterns.some((pattern) => {
      const normalizedPattern = pattern.replace(/\\/g, "/");
      return (
        relativePath === normalizedPattern ||
        relativePath.startsWith(`${normalizedPattern}/`) ||
        relativePath.includes(`/${normalizedPattern}/`)
      );
    });
  }

  private recordEvent(event: GitWatchEvent): void {
    this.eventCount += 1;
    this.lastEventAt = event.timestamp;
    this.status = "active";

    const storedEvent: StoredAutomationEvent = {
      id: event.id,
      timestamp: event.timestamp,
      summary: summarizeWatchEvent(event),
      payload: watchEventPayload(event),
    };

    this.recentEvents = keepLatest([...this.recentEvents, storedEvent], this.maxHistory);
    void this.persistSnapshot();
    this.emit("event", event);
  }

  private recordError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.status = "error";
    this.error = message;
    void this.persistSnapshot();
    if (this.listenerCount("error") > 0) {
      this.emit("error", new Error(message));
    }
  }

  private async persistSnapshot(): Promise<void> {
    if (!this.persist) {
      return;
    }
    this.pendingPersistence = this.pendingPersistence.then(() =>
      this.store.upsertWatcher(this.snapshot()),
    );
    await this.pendingPersistence;
  }
}

export function watchGitEvents(
  eventType: GitEventType,
  targetPath?: string,
  options?: GitWatchOptions,
): GitEventWatcher {
  const watcher = new GitEventWatcher(options);
  watcher.watch(eventType, targetPath);
  return watcher;
}

export async function listGitWatchers(projectRoot = process.cwd()): Promise<StoredGitWatcherRecord[]> {
  const store = new GitAutomationStore(path.resolve(projectRoot));
  return store.listWatchers();
}

export async function stopGitWatcher(
  watchId: string,
  projectRoot = process.cwd(),
): Promise<boolean> {
  const active = ACTIVE_GIT_WATCHERS.get(watchId);
  if (active) {
    await active.stop();
    return true;
  }

  const resolvedRoot = path.resolve(projectRoot);
  const store = new GitAutomationStore(resolvedRoot);
  const watchers = await store.listWatchers();
  const existing = watchers.find((watcher) => watcher.id === watchId);
  if (!existing) {
    return false;
  }

  await store.upsertWatcher({
    ...existing,
    status: existing.status === "error" ? "error" : "stopped",
    updatedAt: new Date().toISOString(),
    stoppedAt: new Date().toISOString(),
  });
  return true;
}

function summarizeWatchEvent(event: GitWatchEvent): string {
  if (event.type === "branch-update") {
    return `Branch updated: ${event.data.relativePath}`;
  }

  if (event.type === "file-change") {
    return `File changed: ${event.data.relativePath}`;
  }

  return `Hook triggered: ${event.type}`;
}

function watchEventPayload(event: GitWatchEvent): Record<string, unknown> {
  return {
    type: event.type,
    ...(event.type === "branch-update"
      ? { branch: (event.data as GitBranchWatchData).branch }
      : event.type === "file-change"
        ? { file: (event.data as GitFileWatchData).file }
        : { hook: (event.data as GitHookWatchData).hook }),
    cwd: event.data.cwd,
    absolutePath: event.data.absolutePath,
    relativePath: event.data.relativePath,
  };
}
