// ============================================================================
// @dantecode/memory-engine — Snapshot Store
// Ties memory to Git/worktree repo state snapshots (GF-06 golden flow).
// Patterns from OpenHands workspace memory + DanteCode git-snapshot-recovery.
// ============================================================================

import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { WorkspaceSnapshot } from "../types.js";

const SNAPSHOTS_DIR = ".dantecode/memory/snapshots";
const INDEX_FILE = "index.json";

export interface SnapshotStoreOptions {
  writeFileFn?: (path: string, data: string) => Promise<void>;
  readFileFn?: (path: string) => Promise<string>;
  mkdirFn?: (path: string, opts?: { recursive?: boolean }) => Promise<void>;
  readdirFn?: (path: string) => Promise<string[]>;
}

/**
 * Stores workspace snapshots that link memory to specific Git states.
 *
 * - Each snapshot records: worktree path, branch, commit hash, memory keys
 * - Index file for fast listing
 * - Snapshots are never mutated (append-only; delete only on explicit prune)
 */
export class SnapshotStore {
  private readonly snapshotsDir: string;
  private readonly writeFileFn: (p: string, d: string) => Promise<void>;
  private readonly readFileFn: (p: string) => Promise<string>;
  private readonly mkdirFn: (p: string, opts?: { recursive?: boolean }) => Promise<void>;
  private readonly readdirFn: (p: string) => Promise<string[]>;

  constructor(projectRoot: string, options: SnapshotStoreOptions = {}) {
    this.snapshotsDir = join(projectRoot, SNAPSHOTS_DIR);
    this.writeFileFn = options.writeFileFn ?? ((p, d) => writeFile(p, d, "utf-8"));
    this.readFileFn = options.readFileFn ?? ((p) => readFile(p, "utf-8"));
    this.mkdirFn =
      options.mkdirFn ??
      ((p, opts) => mkdir(p, { recursive: opts?.recursive ?? true }).then(() => undefined));
    this.readdirFn = options.readdirFn ?? ((p) => readdir(p).then((e) => e.map(String)));
  }

  // --------------------------------------------------------------------------
  // Write
  // --------------------------------------------------------------------------

  /**
   * Captures a new workspace snapshot.
   * Returns the generated snapshot ID.
   */
  async capture(
    params: Omit<WorkspaceSnapshot, "id" | "capturedAt" | "verified">,
  ): Promise<WorkspaceSnapshot> {
    await this.mkdirFn(this.snapshotsDir, { recursive: true });

    const snapshot: WorkspaceSnapshot = {
      id: randomUUID().slice(0, 12),
      capturedAt: new Date().toISOString(),
      verified: false,
      ...params,
    };

    const filePath = join(this.snapshotsDir, `snapshot-${snapshot.id}.json`);
    await this.writeFileFn(filePath, JSON.stringify(snapshot, null, 2));

    // Update index
    await this.updateIndex(snapshot);

    return snapshot;
  }

  /** Mark a snapshot as verified (memory matches known-good state). */
  async markVerified(id: string): Promise<boolean> {
    const snapshot = await this.get(id);
    if (!snapshot) return false;

    snapshot.verified = true;
    const filePath = join(this.snapshotsDir, `snapshot-${id}.json`);
    await this.writeFileFn(filePath, JSON.stringify(snapshot, null, 2));
    return true;
  }

  /** Associate additional memory keys with an existing snapshot. */
  async associateMemoryKeys(id: string, keys: string[]): Promise<boolean> {
    const snapshot = await this.get(id);
    if (!snapshot) return false;

    const keySet = new Set([...snapshot.memoryKeys, ...keys]);
    snapshot.memoryKeys = Array.from(keySet);

    const filePath = join(this.snapshotsDir, `snapshot-${id}.json`);
    await this.writeFileFn(filePath, JSON.stringify(snapshot, null, 2));
    return true;
  }

  // --------------------------------------------------------------------------
  // Read
  // --------------------------------------------------------------------------

  /** Load a snapshot by ID. */
  async get(id: string): Promise<WorkspaceSnapshot | null> {
    const filePath = join(this.snapshotsDir, `snapshot-${id}.json`);
    try {
      const raw = await this.readFileFn(filePath);
      return JSON.parse(raw) as WorkspaceSnapshot;
    } catch {
      return null;
    }
  }

  /** List all snapshots, sorted by capturedAt descending. */
  async list(): Promise<WorkspaceSnapshot[]> {
    try {
      const files = await this.readdirFn(this.snapshotsDir);
      const snapshots: WorkspaceSnapshot[] = [];

      for (const file of files) {
        if (!file.startsWith("snapshot-") || !file.endsWith(".json")) continue;
        try {
          const raw = await this.readFileFn(join(this.snapshotsDir, file));
          snapshots.push(JSON.parse(raw) as WorkspaceSnapshot);
        } catch {
          // skip corrupted
        }
      }

      return snapshots.sort(
        (a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime(),
      );
    } catch {
      return [];
    }
  }

  /**
   * Find snapshots associated with a specific memory key.
   */
  async findByMemoryKey(key: string): Promise<WorkspaceSnapshot[]> {
    const all = await this.list();
    return all.filter((s) => s.memoryKeys.includes(key));
  }

  /**
   * Find snapshots for a specific branch/worktree.
   */
  async findByBranch(branch: string): Promise<WorkspaceSnapshot[]> {
    const all = await this.list();
    return all.filter((s) => s.branch === branch);
  }

  /** Most recent verified snapshot. */
  async latestVerified(): Promise<WorkspaceSnapshot | null> {
    const all = await this.list();
    return all.find((s) => s.verified) ?? null;
  }

  // --------------------------------------------------------------------------
  // Private
  // --------------------------------------------------------------------------

  private async updateIndex(snapshot: WorkspaceSnapshot): Promise<void> {
    const indexPath = join(this.snapshotsDir, INDEX_FILE);
    let index: Array<{ id: string; branch: string; capturedAt: string; verified: boolean }> = [];

    try {
      const raw = await this.readFileFn(indexPath);
      index = JSON.parse(raw) as typeof index;
    } catch {
      // New index
    }

    index.unshift({
      id: snapshot.id,
      branch: snapshot.branch,
      capturedAt: snapshot.capturedAt,
      verified: snapshot.verified,
    });

    // Keep index bounded
    if (index.length > 1000) {
      index = index.slice(0, 1000);
    }

    await this.writeFileFn(indexPath, JSON.stringify(index, null, 2));
  }
}
