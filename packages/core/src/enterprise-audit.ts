// ============================================================================
// packages/core/src/enterprise-audit.ts
// Dim 28 — Enterprise audit log: write, query, export
// Patterns from: opal (DataUpdateReport hash + per-entry status),
//               cerbos (trace component log), openfga (telemetry context)
// ============================================================================

import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

// ── Types ─────────────────────────────────────────────────────────────────────

export type AuditAction =
  | "user.login"
  | "user.logout"
  | "user.invite"
  | "user.remove"
  | "permission.grant"
  | "permission.revoke"
  | "policy.update"
  | "sso.config.update"
  | "api_key.create"
  | "api_key.revoke"
  | "workspace.create"
  | "workspace.delete"
  | "data.export"
  | "admin.action";

export interface AuditEvent {
  eventId: string;
  actor: string;
  actorType: "user" | "service" | "system";
  action: AuditAction;
  resource: string;
  resourceKind: string;
  outcome: "success" | "failure" | "denied";
  metadata: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  orgId?: string;
  workspaceId?: string;
  recordedAt: string;
}

export interface AuditQueryFilter {
  actor?: string;
  action?: AuditAction;
  resource?: string;
  resourceKind?: string;
  outcome?: "success" | "failure" | "denied";
  orgId?: string;
  workspaceId?: string;
  since?: string;
  until?: string;
  limit?: number;
}

export type AuditExportFormat = "jsonl" | "csv" | "json";

export interface AuditExportResult {
  format: AuditExportFormat;
  content: string;
  eventCount: number;
  exportedAt: string;
}

// ── Storage ───────────────────────────────────────────────────────────────────

function auditLogPath(projectRoot: string): string {
  return join(projectRoot, ".danteforge", "audit-log.jsonl");
}

// ── Write ─────────────────────────────────────────────────────────────────────

export function recordAuditEvent(
  event: Omit<AuditEvent, "eventId" | "recordedAt">,
  projectRoot: string,
): AuditEvent {
  const full: AuditEvent = {
    ...event,
    eventId: crypto.randomUUID(),
    recordedAt: new Date().toISOString(),
  };

  try {
    const dir = join(projectRoot, ".danteforge");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(auditLogPath(projectRoot), JSON.stringify(full) + "\n", "utf-8");
  } catch {
    // non-fatal — audit write failures must not break primary flows
  }

  return full;
}

// ── Read ──────────────────────────────────────────────────────────────────────

export function loadAuditLog(projectRoot: string): AuditEvent[] {
  const path = auditLogPath(projectRoot);
  if (!existsSync(path)) return [];
  try {
    return readFileSync(path, "utf-8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as AuditEvent);
  } catch {
    return [];
  }
}

// ── Query ─────────────────────────────────────────────────────────────────────

export function queryAuditLog(
  events: AuditEvent[],
  filter: AuditQueryFilter,
): AuditEvent[] {
  let result = [...events];

  if (filter.actor) result = result.filter((e) => e.actor === filter.actor);
  if (filter.action) result = result.filter((e) => e.action === filter.action);
  if (filter.resource) result = result.filter((e) => e.resource === filter.resource);
  if (filter.resourceKind) result = result.filter((e) => e.resourceKind === filter.resourceKind);
  if (filter.outcome) result = result.filter((e) => e.outcome === filter.outcome);
  if (filter.orgId) result = result.filter((e) => e.orgId === filter.orgId);
  if (filter.workspaceId) result = result.filter((e) => e.workspaceId === filter.workspaceId);
  if (filter.since) result = result.filter((e) => e.recordedAt >= filter.since!);
  if (filter.until) result = result.filter((e) => e.recordedAt <= filter.until!);
  if (filter.limit && filter.limit > 0) result = result.slice(0, filter.limit);

  return result;
}

// ── Export ────────────────────────────────────────────────────────────────────

export function exportAuditLog(
  events: AuditEvent[],
  format: AuditExportFormat,
): AuditExportResult {
  const exportedAt = new Date().toISOString();

  if (format === "json") {
    return {
      format,
      content: JSON.stringify(events, null, 2),
      eventCount: events.length,
      exportedAt,
    };
  }

  if (format === "csv") {
    const headers = [
      "eventId", "recordedAt", "actor", "actorType", "action",
      "resource", "resourceKind", "outcome", "orgId", "workspaceId",
      "ipAddress", "userAgent",
    ];
    const rows = events.map((e) =>
      headers
        .map((h) => {
          const v = (e as unknown as Record<string, unknown>)[h];
          return v == null ? "" : `"${String(v).replace(/"/g, '""')}"`;
        })
        .join(","),
    );
    return {
      format,
      content: [headers.join(","), ...rows].join("\n"),
      eventCount: events.length,
      exportedAt,
    };
  }

  // jsonl default
  return {
    format,
    content: events.map((e) => JSON.stringify(e)).join("\n"),
    eventCount: events.length,
    exportedAt,
  };
}

export function writeAuditExport(
  result: AuditExportResult,
  outPath: string,
): void {
  writeFileSync(outPath, result.content, "utf-8");
}
