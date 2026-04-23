// ============================================================================
// @dantecode/core — Collaborative Context Snapshot (dim 9)
// Tracks multiple developers working concurrently in the same project.
// ============================================================================

import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Public Types
// ---------------------------------------------------------------------------

export interface DeveloperContext {
  developerId: string;
  currentFile?: string;
  cursorLine?: number;
  recentFiles: string[];
  activeSymbol?: string;
  editSessionId: string;
  lastActiveAt: string;
}

export interface CollaborativeSnapshot {
  snapshotId: string;
  projectId: string;
  timestamp: string;
  developers: DeveloperContext[];
  sharedContext: {
    openFiles: string[];
    hotFiles: string[];
    conflictRisk: string[];
  };
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Build a collaborative snapshot for the given project and developer contexts.
 *
 * - openFiles  = unique `currentFile` values across all developers (non-null)
 * - hotFiles   = files present in `recentFiles` of >= 2 developers
 * - conflictRisk = `currentFile` values shared by >= 2 developers simultaneously
 */
export function buildCollaborativeSnapshot(
  projectId: string,
  developers: DeveloperContext[],
): CollaborativeSnapshot {
  // openFiles: unique currentFile values
  const openFilesSet = new Set<string>();
  for (const dev of developers) {
    if (dev.currentFile) openFilesSet.add(dev.currentFile);
  }
  const openFiles = Array.from(openFilesSet);

  // hotFiles: files in recentFiles of >= 2 developers
  const recentFileCount = new Map<string, number>();
  for (const dev of developers) {
    const seen = new Set<string>();
    for (const f of dev.recentFiles) {
      if (!seen.has(f)) {
        seen.add(f);
        recentFileCount.set(f, (recentFileCount.get(f) ?? 0) + 1);
      }
    }
  }
  const hotFiles: string[] = [];
  for (const [file, count] of recentFileCount) {
    if (count >= 2) hotFiles.push(file);
  }

  // conflictRisk: currentFile values shared by >= 2 developers
  const currentFileCount = new Map<string, number>();
  for (const dev of developers) {
    if (dev.currentFile) {
      currentFileCount.set(dev.currentFile, (currentFileCount.get(dev.currentFile) ?? 0) + 1);
    }
  }
  const conflictRisk: string[] = [];
  for (const [file, count] of currentFileCount) {
    if (count >= 2) conflictRisk.push(file);
  }

  return {
    snapshotId: randomUUID(),
    projectId,
    timestamp: new Date().toISOString(),
    developers,
    sharedContext: { openFiles, hotFiles, conflictRisk },
  };
}

/**
 * Format a collaborative snapshot as a markdown string for LLM prompt injection.
 */
export function formatSnapshotForPrompt(snapshot: CollaborativeSnapshot): string {
  const lines: string[] = [];
  lines.push("## Collaborative Context");
  lines.push(`- Active devs: ${snapshot.developers.length}`);
  lines.push(
    `- Hot files: ${snapshot.sharedContext.hotFiles.length > 0 ? snapshot.sharedContext.hotFiles.join(", ") : "none"}`,
  );
  lines.push(
    `- Conflict risk: ${snapshot.sharedContext.conflictRisk.length > 0 ? snapshot.sharedContext.conflictRisk.join(", ") : "none"}`,
  );
  return lines.join("\n");
}

/**
 * Append a collaborative snapshot as a JSONL line to
 * `<projectRoot>/.danteforge/collaborative-snapshots.json`.
 */
export function recordCollaborativeSnapshot(
  snapshot: CollaborativeSnapshot,
  projectRoot?: string,
): void {
  const root = projectRoot ?? process.cwd();
  const dir = join(root, ".danteforge");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const filePath = join(dir, "collaborative-snapshots.json");
  appendFileSync(filePath, JSON.stringify(snapshot) + "\n", "utf8");
}

/**
 * Load all collaborative snapshots from JSONL.
 */
export function loadCollaborativeSnapshots(projectRoot?: string): CollaborativeSnapshot[] {
  const root = projectRoot ?? process.cwd();
  const filePath = join(root, ".danteforge", "collaborative-snapshots.json");
  if (!existsSync(filePath)) return [];

  const raw = readFileSync(filePath, "utf8").trim();
  if (!raw) return [];

  return raw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as CollaborativeSnapshot);
}

/**
 * Compute aggregate statistics across all snapshots.
 */
export function getCollaborationStats(snapshots: CollaborativeSnapshot[]): {
  totalSnapshots: number;
  avgDeveloperCount: number;
  totalConflictRiskEvents: number;
  hotFilesList: string[];
} {
  if (snapshots.length === 0) {
    return {
      totalSnapshots: 0,
      avgDeveloperCount: 0,
      totalConflictRiskEvents: 0,
      hotFilesList: [],
    };
  }

  const totalDevelopers = snapshots.reduce((sum, s) => sum + s.developers.length, 0);
  const avgDeveloperCount = totalDevelopers / snapshots.length;

  const totalConflictRiskEvents = snapshots.reduce(
    (sum, s) => sum + s.sharedContext.conflictRisk.length,
    0,
  );

  const allHotFiles = new Set<string>();
  for (const s of snapshots) {
    for (const f of s.sharedContext.hotFiles) {
      allHotFiles.add(f);
    }
  }

  return {
    totalSnapshots: snapshots.length,
    avgDeveloperCount,
    totalConflictRiskEvents,
    hotFilesList: Array.from(allHotFiles),
  };
}
