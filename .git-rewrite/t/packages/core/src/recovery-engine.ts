// ============================================================================
// @dantecode/core — Recovery Engine
// Provides re-read + context recovery logic for long-running agent sessions.
// When a verification failure occurs, the engine re-reads the target file
// and surrounding context, then retries with fresh state.
// Also enforces hash-based before/after auditing on self-edit commits.
// ============================================================================

import { readFile } from "node:fs/promises";
import { resolve, dirname, basename } from "node:path";
import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import { execSync as nodeExecSync } from "node:child_process";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

/** Result of a re-read recovery attempt. */
export interface RecoveryResult {
  /** Whether recovery was successful (file re-read completed). */
  recovered: boolean;
  /** The fresh content of the target file. */
  targetContent?: string;
  /** Content of surrounding context files. */
  contextFiles: ContextFile[];
  /** Hash of the target file after re-read. */
  targetHash?: string;
  /** Error message if recovery failed. */
  error?: string;
}

/** A context file read during recovery. */
export interface ContextFile {
  path: string;
  content: string;
}

/** Hash audit record for before/after verification. */
export interface HashAuditRecord {
  filePath: string;
  beforeHash: string;
  afterHash: string;
  modified: boolean;
  timestamp: string;
}

/** Verification result from repo-root checks. */
export interface RepoRootVerificationResult {
  passed: boolean;
  failedSteps: string[];
  stepResults: RepoVerificationStep[];
}

/** Individual verification step result. */
export interface RepoVerificationStep {
  name: string;
  command: string;
  passed: boolean;
  output?: string;
  durationMs: number;
}

/** Options for the RecoveryEngine constructor. */
export interface RecoveryEngineOptions {
  /** Maximum number of context files to read during recovery. Default: 5. */
  maxContextFiles?: number;
  /** File extensions to include in context recovery. Default: [".ts", ".tsx", ".js", ".jsx"]. */
  contextExtensions?: string[];
  /** Injectable function for running shell commands (for repo-root verification). */
  execSyncFn?: (command: string, cwd: string) => string;
  /** Injectable file read function. */
  readFileFn?: (path: string) => Promise<string>;
  /** Injectable directory listing function. */
  readdirSyncFn?: (path: string) => string[];
}

// ----------------------------------------------------------------------------
// RecoveryEngine
// ----------------------------------------------------------------------------

/**
 * Handles re-read + context recovery when a long-running session encounters
 * verification failures. The recovery flow:
 *
 * 1. Re-read the target file from disk (picks up any external changes)
 * 2. Read surrounding context files in the same directory
 * 3. Return fresh content to the caller for retry
 *
 * Also provides:
 * - Hash-based before/after audit for self-edit commit verification
 * - Repo-root verification (typecheck → lint → test) gating
 */
export class RecoveryEngine {
  private readonly maxContextFiles: number;
  private readonly contextExtensions: Set<string>;
  private readonly execSyncFn: (command: string, cwd: string) => string;
  private readonly readFileFn: (path: string) => Promise<string>;
  private readonly readdirSyncFn: (path: string) => string[];
  private readonly auditTrail: HashAuditRecord[] = [];

  constructor(options: RecoveryEngineOptions = {}) {
    this.maxContextFiles = options.maxContextFiles ?? 5;
    this.contextExtensions = new Set(options.contextExtensions ?? [".ts", ".tsx", ".js", ".jsx"]);
    this.execSyncFn = options.execSyncFn ?? defaultExecSync;
    this.readFileFn = options.readFileFn ?? ((p) => readFile(p, "utf-8"));
    this.readdirSyncFn =
      options.readdirSyncFn ?? ((p) => readdirSync(p).map((e) => (typeof e === "string" ? e : e)));
  }

  /**
   * Re-reads the target file and surrounding context files from disk.
   * This is the primary recovery mechanism — fresh state from the filesystem
   * allows the agent to retry with accurate data.
   */
  async rereadAndRecover(targetFilePath: string, projectRoot: string): Promise<RecoveryResult> {
    const resolvedTarget = resolve(projectRoot, targetFilePath);

    try {
      const targetContent = await this.readFileFn(resolvedTarget);
      const targetHash = sha256(targetContent);

      // Read surrounding context files
      const contextFiles = await this.readSurroundingContext(resolvedTarget);

      return {
        recovered: true,
        targetContent,
        contextFiles,
        targetHash,
      };
    } catch (err: unknown) {
      return {
        recovered: false,
        contextFiles: [],
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Records the before-hash for a file, to be compared after edits.
   * Returns the hash for reference.
   */
  recordBeforeHash(filePath: string, content: string): string {
    const hash = sha256(content);
    // Store pending audit (afterHash will be filled in by `recordAfterHash`)
    this.auditTrail.push({
      filePath,
      beforeHash: hash,
      afterHash: "",
      modified: false,
      timestamp: new Date().toISOString(),
    });
    return hash;
  }

  /**
   * Records the after-hash for a file and marks whether it was modified.
   * Matches against the most recent `recordBeforeHash` for the same file.
   */
  recordAfterHash(filePath: string, content: string): HashAuditRecord | null {
    const afterHash = sha256(content);
    const pending = [...this.auditTrail]
      .reverse()
      .find((r) => r.filePath === filePath && r.afterHash === "");

    if (!pending) return null;

    pending.afterHash = afterHash;
    pending.modified = pending.beforeHash !== afterHash;
    return { ...pending };
  }

  /** Returns the full audit trail. */
  getAuditTrail(): HashAuditRecord[] {
    return [...this.auditTrail];
  }

  /**
   * Runs full repo-root verification: typecheck → lint → test.
   * All three must pass for the verification to succeed.
   */
  runRepoRootVerification(projectRoot: string): RepoRootVerificationResult {
    const steps: { name: string; command: string }[] = [
      { name: "typecheck", command: "npm run typecheck" },
      { name: "lint", command: "npm run lint" },
      { name: "test", command: "npm test" },
    ];

    const failedSteps: string[] = [];
    const stepResults: RepoVerificationStep[] = [];

    for (const step of steps) {
      const start = Date.now();
      try {
        const output = this.execSyncFn(step.command, projectRoot);
        stepResults.push({
          name: step.name,
          command: step.command,
          passed: true,
          output: output.slice(0, 500),
          durationMs: Date.now() - start,
        });
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        failedSteps.push(step.name);
        stepResults.push({
          name: step.name,
          command: step.command,
          passed: false,
          output: errMsg.slice(0, 500),
          durationMs: Date.now() - start,
        });
      }
    }

    return {
      passed: failedSteps.length === 0,
      failedSteps,
      stepResults,
    };
  }

  /**
   * Validates that a self-edit commit should proceed. Runs:
   * 1. Repo-root verification (typecheck → lint → test)
   * 2. Hash audit for all modified files
   *
   * Returns a result indicating whether the commit is safe.
   */
  validateSelfEditCommit(
    projectRoot: string,
    modifiedFiles: { path: string; beforeContent: string; afterContent: string }[],
  ): {
    safe: boolean;
    verification: RepoRootVerificationResult;
    audits: HashAuditRecord[];
    blockedReason?: string;
  } {
    // Record before/after hashes
    const audits: HashAuditRecord[] = [];
    for (const file of modifiedFiles) {
      this.recordBeforeHash(file.path, file.beforeContent);
      const audit = this.recordAfterHash(file.path, file.afterContent);
      if (audit) audits.push(audit);
    }

    // Run repo-root verification
    const verification = this.runRepoRootVerification(projectRoot);

    if (!verification.passed) {
      return {
        safe: false,
        verification,
        audits,
        blockedReason: `Repo-root verification failed: ${verification.failedSteps.join(", ")}`,
      };
    }

    return { safe: true, verification, audits };
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  /** Reads source files in the same directory as the target, for context. */
  private async readSurroundingContext(targetFilePath: string): Promise<ContextFile[]> {
    const dir = dirname(targetFilePath);
    const targetName = basename(targetFilePath);
    const contextFiles: ContextFile[] = [];

    try {
      const entries = this.readdirSyncFn(dir);
      const candidates = entries
        .filter((name) => {
          if (name === targetName) return false;
          const ext = name.slice(name.lastIndexOf("."));
          return this.contextExtensions.has(ext);
        })
        .slice(0, this.maxContextFiles);

      for (const name of candidates) {
        try {
          const content = await this.readFileFn(resolve(dir, name));
          contextFiles.push({ path: resolve(dir, name), content });
        } catch {
          // Skip unreadable files
        }
      }
    } catch {
      // Directory listing failed — return empty context
    }

    return contextFiles;
  }
}

// ----------------------------------------------------------------------------
// Utilities
// ----------------------------------------------------------------------------

/** SHA-256 hash of a string, returned as hex. */
function sha256(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

/** Default execSync wrapper. */
function defaultExecSync(command: string, cwd: string): string {
  return nodeExecSync(command, { cwd, stdio: "pipe", encoding: "utf-8" }) as string;
}

export { sha256 as sha256ForTesting };
