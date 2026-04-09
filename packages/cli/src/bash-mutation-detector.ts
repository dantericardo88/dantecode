// ============================================================================
// @dantecode/cli — Bash Mutation Detector (M2)
// Detects file mutations caused by Bash tool commands so they are not
// invisible to the execution integrity ledger.
// ============================================================================

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import type { ExecutionIntegrityManager, MutationRecord } from "@dantecode/core";

/** Snapshot of a file's state before Bash execution */
export interface FileSnapshot {
  filePath: string;
  absolutePath: string;
  exists: boolean;
  contentHash: string | null;
  mtimeMs: number;
}

/** A mutation detected after Bash execution */
export interface DetectedMutation {
  filePath: string;
  absolutePath: string;
  type: "created" | "modified" | "deleted";
  beforeHash: string | null;
  afterHash: string | null;
  additions: number;
  deletions: number;
}

function sha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function safeReadFile(absPath: string): Buffer | null {
  try {
    return readFileSync(absPath);
  } catch {
    return null;
  }
}

function safeStat(absPath: string): { mtimeMs: number } | null {
  try {
    return statSync(absPath);
  } catch {
    return null;
  }
}

/**
 * BashMutationDetector — detects file changes caused by Bash tool commands.
 *
 * Strategy:
 * 1. Before Bash execution, capture `git status --porcelain` to know current dirty state
 * 2. After execution, re-run `git status --porcelain` and diff to find new changes
 * 3. For each changed file, compute before/after hashes and emit MutationRecords
 */
export class BashMutationDetector {
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = resolve(projectRoot);
  }

  /**
   * Snapshot current git-tracked changes before Bash execution.
   * Returns a set of file paths that are already dirty/untracked.
   */
  snapshotBefore(): Map<string, FileSnapshot> {
    const snapshots = new Map<string, FileSnapshot>();

    try {
      const output = execFileSync("git", ["status", "--porcelain", "-uall"], {
        cwd: this.projectRoot,
        encoding: "utf-8",
        timeout: 5000,
      });

      for (const line of output.split("\n")) {
        if (!line.trim()) continue;
        // porcelain format: XY filename
        const filePath = line.slice(3).trim();
        if (!filePath) continue;

        const absPath = resolve(this.projectRoot, filePath);
        const content = safeReadFile(absPath);
        const stat = safeStat(absPath);

        snapshots.set(filePath, {
          filePath,
          absolutePath: absPath,
          exists: content !== null,
          contentHash: content ? sha256(content) : null,
          mtimeMs: stat?.mtimeMs ?? 0,
        });
      }
    } catch {
      // Not a git repo or git not available — fall back to empty snapshot
    }

    return snapshots;
  }

  /**
   * Detect mutations by comparing post-execution git status against the pre-execution snapshot.
   */
  detectMutations(beforeSnapshot: Map<string, FileSnapshot>): DetectedMutation[] {
    const mutations: DetectedMutation[] = [];

    try {
      const output = execFileSync("git", ["status", "--porcelain", "-uall"], {
        cwd: this.projectRoot,
        encoding: "utf-8",
        timeout: 5000,
      });

      const afterFiles = new Set<string>();

      for (const line of output.split("\n")) {
        if (!line.trim()) continue;
        const statusCode = line.slice(0, 2);
        const filePath = line.slice(3).trim();
        if (!filePath) continue;

        afterFiles.add(filePath);
        const absPath = resolve(this.projectRoot, filePath);
        const beforeState = beforeSnapshot.get(filePath);

        // File is deleted
        if (statusCode.includes("D")) {
          if (beforeState?.exists) {
            mutations.push({
              filePath,
              absolutePath: absPath,
              type: "deleted",
              beforeHash: beforeState.contentHash,
              afterHash: null,
              additions: 0,
              deletions: 1,
            });
          }
          continue;
        }

        const afterContent = safeReadFile(absPath);
        const afterHash = afterContent ? sha256(afterContent) : null;

        if (!beforeState || !beforeState.exists) {
          // New file (wasn't in before snapshot OR didn't exist)
          if (afterContent) {
            mutations.push({
              filePath,
              absolutePath: absPath,
              type: "created",
              beforeHash: null,
              afterHash,
              additions: 1,
              deletions: 0,
            });
          }
        } else if (afterHash !== beforeState.contentHash) {
          // Modified file — content hash changed
          mutations.push({
            filePath,
            absolutePath: absPath,
            type: "modified",
            beforeHash: beforeState.contentHash,
            afterHash,
            additions: 1,
            deletions: 1,
          });
        }
        // else: file was already dirty but hasn't changed further — skip
      }

      // Check for files that were dirty before but are now clean (restored)
      for (const [filePath, beforeState] of beforeSnapshot.entries()) {
        if (!afterFiles.has(filePath) && beforeState.exists) {
          // File was dirty before but is now clean — it was restored/deleted
          const absPath = resolve(this.projectRoot, filePath);
          const afterContent = safeReadFile(absPath);
          const afterHash = afterContent ? sha256(afterContent) : null;

          if (afterHash !== beforeState.contentHash) {
            mutations.push({
              filePath,
              absolutePath: absPath,
              type: afterContent ? "modified" : "deleted",
              beforeHash: beforeState.contentHash,
              afterHash,
              additions: afterContent ? 1 : 0,
              deletions: 1,
            });
          }
        }
      }
    } catch {
      // Git not available — cannot detect mutations
    }

    // Filter to project root only
    return mutations.filter((m) => {
      if (isAbsolute(m.filePath)) {
        return m.absolutePath.startsWith(this.projectRoot);
      }
      return true; // relative paths are within project
    });
  }

  /**
   * Record detected mutations into the execution integrity ledger.
   */
  recordDetected(
    mutations: DetectedMutation[],
    executionIntegrity: ExecutionIntegrityManager,
    sessionId: string,
    messageId: string,
  ): MutationRecord[] {
    const records: MutationRecord[] = [];

    for (const mutation of mutations) {
      const record: MutationRecord = {
        toolName: "Bash",
        filePath: mutation.filePath,
        beforeHash: mutation.beforeHash,
        afterHash: mutation.afterHash ?? "",
        additions: mutation.additions,
        deletions: mutation.deletions,
        diffSummary: `[bash] ${mutation.type}: ${mutation.filePath}`,
        appliedAt: new Date().toISOString(),
      };
      records.push(record);
    }

    // Record each mutation as a tool call in the ledger
    if (records.length > 0) {
      for (const record of records) {
        executionIntegrity.recordToolCall(sessionId, messageId, {
          toolName: "Bash",
          toolClass: "mutating" as any,
          calledAt: record.appliedAt,
          arguments: { filePath: record.filePath, source: "bash-mutation-detector" },
          result: {
            success: true,
            metadata: {
              filePath: record.filePath,
              beforeHash: record.beforeHash,
              afterHash: record.afterHash,
              additions: record.additions,
              deletions: record.deletions,
              diffSummary: record.diffSummary,
              observableMutation: true,
            },
          },
          executionDuration: 0,
        });
      }
    }

    return records;
  }
}
