// ============================================================================
// @dantecode/dante-sandbox — Audit Log
// Persists sandbox audit records to .dantecode/sandbox/audit.jsonl.
// Durable, append-only, queryable. Links to checkpoint IDs.
// ============================================================================

import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { SandboxAuditRecord, AuditSink, SandboxAuditRef } from "./types.js";

const AUDIT_DIR = ".dantecode/sandbox";
const AUDIT_FILE = "audit.jsonl";

export interface AuditLogOptions {
  projectRoot: string;
}

export class SandboxAuditLog {
  private readonly auditPath: string;
  private initialized = false;
  private readonly sessionRecords: SandboxAuditRecord[] = [];

  constructor(private readonly opts: AuditLogOptions) {
    this.auditPath = join(opts.projectRoot, AUDIT_DIR, AUDIT_FILE);
  }

  /** AuditSink compatible function — append one record. */
  readonly sink: AuditSink = async (record) => {
    await this.append(record);
  };

  async append(record: SandboxAuditRecord): Promise<void> {
    await this.ensureDir();
    this.sessionRecords.push(record);
    const line = JSON.stringify(record) + "\n";
    await appendFile(this.auditPath, line, "utf8");
  }

  /** Read all records from the audit file. */
  async readAll(): Promise<SandboxAuditRecord[]> {
    await this.ensureDir();
    try {
      const content = await readFile(this.auditPath, "utf8");
      return content
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as SandboxAuditRecord);
    } catch {
      return [];
    }
  }

  /** Filter records by session ID. */
  async readBySession(sessionId: string): Promise<SandboxAuditRecord[]> {
    const all = await this.readAll();
    return all.filter((r) => r.sessionId === sessionId);
  }

  /** Filter records by checkpoint ID. */
  async readByCheckpoint(checkpointId: string): Promise<SandboxAuditRecord[]> {
    const all = await this.readAll();
    return all.filter((r) => r.checkpointId === checkpointId);
  }

  /**
   * Build a SandboxAuditRef from this session's records.
   * Used to embed in Checkpoint.sandboxAuditRef.
   */
  buildAuditRef(): SandboxAuditRef {
    const records = this.sessionRecords;
    const lastRecord = records[records.length - 1];
    const violations = records.reduce((n, r) => n + r.violations.length, 0);
    const hostEscapes = records.filter((r) => r.hostEscape).length;

    return {
      lastStrategy: lastRecord?.decision?.strategy,
      activeMode: lastRecord?.request?.requestedMode,
      violationCount: violations,
      hostEscapeCount: hostEscapes,
      auditRecordIds: records.map((r) => r.id),
      at: new Date().toISOString(),
    };
  }

  /** Returns all records collected in this session (in-memory only). */
  getSessionRecords(): readonly SandboxAuditRecord[] {
    return this.sessionRecords;
  }

  private async ensureDir(): Promise<void> {
    if (this.initialized) return;
    await mkdir(join(this.opts.projectRoot, AUDIT_DIR), { recursive: true });
    this.initialized = true;
  }
}

/** No-op audit sink for use in tests / mock mode. */
export const noopAuditSink: AuditSink = async (_record) => {};
