// ============================================================================
// @dantecode/debug-trail — DanteForge Bridge
// Connects trail completeness scoring to DanteForge PDSE/trust verification.
// ============================================================================

import type { TrailCompletenessScore, AuditExportResult } from "../types.js";
import type { AuditLogger } from "../audit-logger.js";
import { scoreCompleteness } from "../export-engine.js";
import type { TrailStore } from "../sqlite-store.js";

// ---------------------------------------------------------------------------
// Trust result
// ---------------------------------------------------------------------------

export interface TrailTrustResult {
  sessionId: string;
  trustScore: number;
  completenessScore: number;
  pdseGrade: "A" | "B" | "C" | "D" | "F";
  issues: string[];
  verified: boolean;
  verifiedAt: string;
}

// ---------------------------------------------------------------------------
// PDSE grade mapping
// ---------------------------------------------------------------------------

function scoreToGrade(score: number): "A" | "B" | "C" | "D" | "F" {
  if (score >= 0.95) return "A";
  if (score >= 0.85) return "B";
  if (score >= 0.70) return "C";
  if (score >= 0.50) return "D";
  return "F";
}

// ---------------------------------------------------------------------------
// DanteForge Bridge
// ---------------------------------------------------------------------------

export class DanteForgeBridge {
  constructor(
    private readonly logger: AuditLogger,
    private readonly store: TrailStore,
  ) {}

  /**
   * Score the completeness of a session's trail.
   * Returns a PDSE-compatible trust result.
   */
  async scoreSession(sessionId: string, workflowId?: string): Promise<TrailTrustResult> {
    const events = await this.store.queryBySession(sessionId);
    const tombstones = await this.store.readAllTombstones();
    const sessionTombstones = tombstones.filter((t) => t.provenance.sessionId === sessionId);

    const completeness = scoreCompleteness(events, sessionTombstones, sessionId);

    const issues: string[] = [];

    if (completeness.missingProvenance.length > 0) {
      issues.push(`${completeness.missingProvenance.length} events missing session/run provenance`);
    }
    if (completeness.snapshotGaps.length > 0) {
      issues.push(`${completeness.snapshotGaps.length} file events without snapshots`);
    }
    if (completeness.totalEvents === 0) {
      issues.push("Session has no recorded events — trail may be missing");
    }

    const trustScore = completeness.score;
    const pdseGrade = scoreToGrade(trustScore);
    const verified = trustScore >= 0.85 && issues.length === 0;
    const verifiedAt = new Date().toISOString();

    // Log the verification as a trail event, including workflowId in provenance
    await this.logger.log(
      "verification",
      "DanteForgeBridge",
      `Trail completeness: ${(trustScore * 100).toFixed(0)}%, Grade: ${pdseGrade}`,
      { sessionId, workflowId, issues, pdseGrade, trustScore },
      { provenance: { workflowId } as Partial<import("../types.js").TrailProvenance> },
    );

    return {
      sessionId,
      trustScore,
      completenessScore: completeness.score,
      pdseGrade,
      issues,
      verified,
      verifiedAt,
    };
  }

  /**
   * Annotate an export result with trust metadata.
   */
  async annotateExport(
    exportResult: AuditExportResult,
  ): Promise<AuditExportResult & { trust: TrailTrustResult }> {
    const trust = await this.scoreSession(exportResult.sessionId);
    return { ...exportResult, trust };
  }

  /**
   * Quick check: is this trail trustworthy enough for forensic decisions?
   */
  async isTrusted(sessionId: string, minScore = 0.85): Promise<boolean> {
    const result = await this.scoreSession(sessionId);
    return result.trustScore >= minScore;
  }

  /**
   * Get the completeness score object for a session.
   */
  async getCompleteness(sessionId: string): Promise<TrailCompletenessScore> {
    const events = await this.store.queryBySession(sessionId);
    const tombstones = await this.store.readAllTombstones();
    const sessionTombstones = tombstones.filter((t) => t.provenance.sessionId === sessionId);
    return scoreCompleteness(events, sessionTombstones, sessionId);
  }
}
