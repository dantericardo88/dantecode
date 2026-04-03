// ============================================================================
// @dantecode/core — Update Rollback
// Captures pre-update snapshots, runs health checks, and restores previous
// state on failure. Integrates with evidence chain for audit trails.
// ============================================================================

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

/** Captured state before an update for rollback purposes. */
export interface UpdateSnapshot {
  /** Version string at time of snapshot. */
  version: string;
  /** Unix timestamp (ms) when the snapshot was taken. */
  timestamp: number;
  /** Paths to config files that were captured. */
  configPaths: string[];
  /** Contents of each config file, keyed by path. */
  configContents: Map<string, string>;
  /** Package versions (name -> version). */
  packageVersions: Record<string, string>;
}

/** Configuration for health checks. */
export interface UpdateHealthCheckConfig {
  /** Shell commands to run for health verification. */
  commands: string[];
  /** Timeout per command in milliseconds (default: 60000). */
  timeoutMs?: number;
}

/** Result of running health checks. */
export interface UpdateHealthCheckResult {
  /** Whether all health checks passed. */
  passed: boolean;
  /** List of failure descriptions. */
  failures: string[];
}

/** An evidence chain recording action. */
export interface EvidenceRecord {
  /** The action type being recorded. */
  action: "snapshot" | "rollback";
  /** Details about the action. */
  details: Record<string, unknown>;
  /** Timestamp of the recording. */
  timestamp: number;
}

/** Callbacks for filesystem and shell operations (injectable for testing). */
export interface UpdateRollbackIO {
  /** Read a file, returning its contents. Returns null if file doesn't exist. */
  readFile: (path: string) => string | null;
  /** Write content to a file. */
  writeFile: (path: string, content: string) => void;
  /** Execute a shell command. Returns { exitCode, stdout, stderr }. */
  exec: (
    command: string,
    timeoutMs: number,
  ) => { exitCode: number; stdout: string; stderr: string };
}

// ────────────────────────────────────────────────────────────────────────────
// Rollback Manager
// ────────────────────────────────────────────────────────────────────────────

/**
 * Manages update safety through snapshot/rollback/health-check workflow.
 *
 * 1. **snapshot()** — Capture current state (config files, package versions).
 * 2. **healthCheck()** — Run configurable commands to verify system health.
 * 3. **rollback()** — Restore config files from a snapshot.
 * 4. **recordInEvidenceChain()** — Log actions to an audit trail.
 */
export class UpdateRollback {
  private readonly io: UpdateRollbackIO;
  private readonly evidenceLog: EvidenceRecord[] = [];
  private readonly nowFn: () => number;

  constructor(io: UpdateRollbackIO, options?: { nowFn?: () => number }) {
    this.io = io;
    this.nowFn = options?.nowFn ?? (() => Date.now());
  }

  /**
   * Capture current state: read config files and record package versions.
   */
  snapshot(
    version: string,
    configPaths: string[],
    packageVersions: Record<string, string>,
  ): UpdateSnapshot {
    const configContents = new Map<string, string>();
    const validPaths: string[] = [];

    for (const path of configPaths) {
      const content = this.io.readFile(path);
      if (content !== null) {
        configContents.set(path, content);
        validPaths.push(path);
      }
    }

    const snap: UpdateSnapshot = {
      version,
      timestamp: this.nowFn(),
      configPaths: validPaths,
      configContents,
      packageVersions: { ...packageVersions },
    };

    this.recordInEvidenceChain("snapshot", {
      version,
      configPathCount: validPaths.length,
      packageCount: Object.keys(packageVersions).length,
    });

    return snap;
  }

  /**
   * Run health checks to verify system state after an update.
   */
  healthCheck(config: UpdateHealthCheckConfig): UpdateHealthCheckResult {
    const failures: string[] = [];
    const timeout = config.timeoutMs ?? 60000;

    for (const command of config.commands) {
      try {
        const result = this.io.exec(command, timeout);
        if (result.exitCode !== 0) {
          failures.push(
            `Command failed (exit ${result.exitCode}): ${command}` +
              (result.stderr ? ` — ${result.stderr.slice(0, 200)}` : ""),
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        failures.push(`Command error: ${command} — ${msg}`);
      }
    }

    return { passed: failures.length === 0, failures };
  }

  /**
   * Restore config files from a previous snapshot.
   */
  rollback(snap: UpdateSnapshot): void {
    for (const [path, content] of snap.configContents) {
      this.io.writeFile(path, content);
    }

    this.recordInEvidenceChain("rollback", {
      restoredVersion: snap.version,
      snapshotTimestamp: snap.timestamp,
      filesRestored: snap.configPaths.length,
    });
  }

  /**
   * Record an action in the evidence chain audit log.
   */
  recordInEvidenceChain(action: "snapshot" | "rollback", details: Record<string, unknown>): void {
    this.evidenceLog.push({
      action,
      details: { ...details },
      timestamp: this.nowFn(),
    });
  }

  /**
   * Get all evidence chain records.
   */
  getEvidenceLog(): EvidenceRecord[] {
    return this.evidenceLog.map((r) => ({ ...r, details: { ...r.details } }));
  }
}
