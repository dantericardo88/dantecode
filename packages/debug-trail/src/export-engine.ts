// ============================================================================
// @dantecode/debug-trail — Export Engine
// Produces immutable, scored forensic reports for sessions and audit exports.
// PRD: no restore without audit record; exports must carry completeness metadata.
// ============================================================================

import { writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type {
  TrailEvent,
  TrailCompletenessScore,
  AuditExportResult,
  DebugTrailConfig,
  DeleteTombstone,
} from "./types.js";
import { defaultConfig, FILE_EVENT_KINDS } from "./types.js";
import { TrailStore, getTrailStore } from "./sqlite-store.js";

// ---------------------------------------------------------------------------
// Export formats
// ---------------------------------------------------------------------------

export type ExportFormat = "json" | "ndjson" | "markdown";

export interface ExportOptions {
  format?: ExportFormat;
  /** Include raw snapshot metadata in export. */
  includeSnapshotRefs?: boolean;
  /** Include tombstones. */
  includeTombstones?: boolean;
  /** Append completeness score to export. */
  includeCompleteness?: boolean;
  /** Custom output path. Default: ~/.dantecode/debug-trail/exports/<sessionId>.<format> */
  outputPath?: string;
}

// ---------------------------------------------------------------------------
// Completeness scorer
// ---------------------------------------------------------------------------

export function scoreCompleteness(
  events: TrailEvent[],
  tombstones: DeleteTombstone[],
  sessionId: string,
  /** Optional: resolve a snapshotId to its storage path for existence checks. */
  snapshotPathFn?: (snapshotId: string) => string,
): TrailCompletenessScore {
  const now = new Date().toISOString();
  const totalEvents = events.length;
  if (totalEvents === 0) {
    return {
      sessionId,
      score: 1.0, // empty session is trivially complete
      totalEvents: 0,
      eventsWithProvenance: 0,
      fileEventsWithSnapshots: 0,
      totalFileEvents: 0,
      missingProvenance: [],
      snapshotGaps: [],
      scoredAt: now,
    };
  }

  const fileEventKinds = new Set(FILE_EVENT_KINDS);

  const missingProvenance: string[] = [];
  const snapshotGaps: string[] = [];
  let fileEventsWithSnapshots = 0;
  let totalFileEvents = 0;

  for (const e of events) {
    // Provenance check
    if (!e.provenance.sessionId || !e.provenance.runId) {
      missingProvenance.push(e.id);
    }

    // Snapshot check for file events
    if (fileEventKinds.has(e.kind)) {
      totalFileEvents++;
      if (e.kind === "file_write" && e.afterSnapshotId) {
        // Verify the snapshot file still exists on disk (may have been pruned/deleted)
        const snapshotExists = snapshotPathFn
          ? existsSync(snapshotPathFn(e.afterSnapshotId))
          : true;
        if (snapshotExists) {
          fileEventsWithSnapshots++;
        } else {
          // Snapshot ID recorded but file is gone — count as gap
          snapshotGaps.push(e.id);
        }
      } else if (e.kind === "file_delete" && e.beforeSnapshotId) {
        // Verify the before-state snapshot file still exists on disk
        const snapshotExists = snapshotPathFn
          ? existsSync(snapshotPathFn(e.beforeSnapshotId))
          : true;
        if (snapshotExists) {
          fileEventsWithSnapshots++;
        } else {
          // Snapshot ID recorded but file is gone — count as gap
          snapshotGaps.push(e.id);
        }
      } else if (e.kind === "file_write" || e.kind === "file_delete") {
        snapshotGaps.push(e.id);
      } else {
        // move/restore — partial credit
        fileEventsWithSnapshots++;
      }
    }
  }

  // Also count tombstones without before-state as gaps
  for (const t of tombstones) {
    if (!t.beforeStateCaptured) {
      snapshotGaps.push(t.tombstoneId);
    }
  }

  const eventsWithProvenance = totalEvents - missingProvenance.length;

  // Score formula: weighted average of provenance completeness and snapshot completeness
  const provenanceScore = totalEvents > 0 ? eventsWithProvenance / totalEvents : 1;
  const snapshotScore = totalFileEvents > 0 ? fileEventsWithSnapshots / totalFileEvents : 1;
  const score = Math.round((provenanceScore * 0.4 + snapshotScore * 0.6) * 100) / 100;

  return {
    sessionId,
    score,
    totalEvents,
    eventsWithProvenance,
    fileEventsWithSnapshots,
    totalFileEvents,
    missingProvenance,
    snapshotGaps,
    scoredAt: now,
  };
}

// ---------------------------------------------------------------------------
// Export Engine
// ---------------------------------------------------------------------------

export class ExportEngine {
  private config: DebugTrailConfig;
  private store: TrailStore;

  constructor(config?: Partial<DebugTrailConfig>) {
    this.config = { ...defaultConfig(), ...config };
    this.store = getTrailStore(this.config.storageRoot);
  }

  /**
   * Export a session to an immutable forensic report.
   */
  async exportSession(sessionId: string, options: ExportOptions = {}): Promise<AuditExportResult> {
    await this.store.init();

    const events = await this.store.queryBySession(sessionId);
    const tombstones = await this.store.readAllTombstones();
    const sessionTombstones = tombstones.filter((t) => t.provenance.sessionId === sessionId);

    const sorted = events.sort((a, b) => a.seq - b.seq);

    // Score completeness — pass store's snapshotPath resolver so we can detect
    // pruned/deleted snapshot files and count them as gaps rather than coverage.
    const completeness = options.includeCompleteness !== false
      ? scoreCompleteness(sorted, sessionTombstones, sessionId, this.store.snapshotPath.bind(this.store))
      : undefined;

    // Build export document
    const format = options.format ?? "json";
    const exportedAt = new Date().toISOString();

    const exportsDir = join(this.config.storageRoot, "exports");
    await mkdir(exportsDir, { recursive: true });

    const outputPath = options.outputPath ??
      join(exportsDir, `${sessionId}.${format === "markdown" ? "md" : format}`);

    let content: string;

    if (format === "ndjson") {
      content = sorted.map((e) => JSON.stringify(e)).join("\n");
    } else if (format === "markdown") {
      content = this.buildMarkdownReport(sessionId, sorted, sessionTombstones, completeness, exportedAt);
    } else {
      const doc = {
        exportedAt,
        sessionId,
        eventCount: sorted.length,
        tombstoneCount: sessionTombstones.length,
        completeness,
        events: sorted,
        tombstones: options.includeTombstones !== false ? sessionTombstones : [],
      };
      content = JSON.stringify(doc, null, 2);
    }

    await writeFile(outputPath, content, "utf8");

    return {
      sessionId,
      path: outputPath,
      completenessScore: completeness?.score,
      eventCount: sorted.length,
      snapshotCount: sorted.filter((e) => e.afterSnapshotId || e.beforeSnapshotId).length,
      exportedAt,
    };
  }

  // -------------------------------------------------------------------------
  // Markdown report
  // -------------------------------------------------------------------------

  private buildMarkdownReport(
    sessionId: string,
    events: TrailEvent[],
    tombstones: DeleteTombstone[],
    completeness: TrailCompletenessScore | undefined,
    exportedAt: string,
  ): string {
    const lines: string[] = [
      `# Forensic Audit Report`,
      ``,
      `**Session:** \`${sessionId}\`  `,
      `**Exported:** ${exportedAt}  `,
      `**Events:** ${events.length}  `,
      `**Tombstones:** ${tombstones.length}  `,
    ];

    if (completeness) {
      lines.push(
        `**Completeness Score:** ${(completeness.score * 100).toFixed(0)}%  `,
        `**File Events with Snapshots:** ${completeness.fileEventsWithSnapshots}/${completeness.totalFileEvents}  `,
        `**Events with Provenance:** ${completeness.eventsWithProvenance}/${completeness.totalEvents}  `,
      );
      if (completeness.snapshotGaps.length > 0) {
        lines.push(`**Snapshot Gaps:** ${completeness.snapshotGaps.length} event(s) missing snapshots  `);
      }
    }

    lines.push(``, `---`, ``, `## Event Timeline`, ``);

    for (const e of events) {
      const icon = this.kindIcon(e.kind);
      const fp =
        typeof e.payload["filePath"] === "string" ? ` \`${e.payload["filePath"]}\`` : "";
      lines.push(
        `### ${icon} [${e.seq}] ${e.kind}${fp}`,
        `- **Time:** ${e.timestamp}`,
        `- **Actor:** ${e.actor}`,
        `- **Summary:** ${e.summary}`,
        e.beforeHash ? `- **Before hash:** \`${e.beforeHash.slice(0, 12)}\`` : "",
        e.afterHash ? `- **After hash:** \`${e.afterHash.slice(0, 12)}\`` : "",
        e.trustScore != null ? `- **Trust:** ${(e.trustScore * 100).toFixed(0)}%` : "",
        ``,
      );
    }

    if (tombstones.length > 0) {
      lines.push(`---`, ``, `## Deletion Tombstones`, ``);
      for (const t of tombstones) {
        lines.push(
          `### 🪦 ${t.filePath}`,
          `- **Deleted at:** ${t.deletedAt}`,
          `- **Deleted by:** ${t.deletedBy}`,
          `- **Before-state captured:** ${t.beforeStateCaptured ? "Yes" : "No"}`,
          t.missingBeforeReason ? `- **Gap reason:** ${t.missingBeforeReason}` : "",
          ``,
        );
      }
    }

    return lines.filter((l) => l !== "").join("\n");
  }

  private kindIcon(kind: string): string {
    const icons: Record<string, string> = {
      tool_call: "🔧",
      tool_result: "✅",
      model_decision: "🤖",
      file_write: "✏️",
      file_delete: "🗑️",
      file_move: "📁",
      file_restore: "♻️",
      verification: "🔍",
      checkpoint_transition: "📍",
      error: "❌",
      retry: "🔄",
      timeout: "⏱️",
      anomaly_flag: "⚠️",
    };
    return icons[kind] ?? "•";
  }
}
