// ============================================================================
// @dantecode/debug-trail — Retention Policy
// Determines which sessions to keep, compress, archive, or prune.
// PRD hard rule: no pruning without a policy record.
// ============================================================================

import type { TrailRetentionDecision } from "../types.js";
import type { SessionRecord } from "../sqlite-store.js";

// ---------------------------------------------------------------------------
// Policy config
// ---------------------------------------------------------------------------

export interface RetentionPolicyConfig {
  /** Keep sessions newer than N days regardless. Default: 7 */
  keepRecentDays: number;
  /** Prune sessions older than N days (unless pinned). Default: 30 */
  prunePastDays: number;
  /** Compress sessions between keepRecent and prunePast days. Default: true */
  enableCompression: boolean;
  /** Policy identifier for audit records. */
  policyId: string;
}

const DEFAULT_RETENTION: RetentionPolicyConfig = {
  keepRecentDays: 7,
  prunePastDays: 30,
  enableCompression: true,
  policyId: "default-v1",
};

// ---------------------------------------------------------------------------
// Retention Policy
// ---------------------------------------------------------------------------

export class RetentionPolicy {
  private config: RetentionPolicyConfig;

  constructor(config?: Partial<RetentionPolicyConfig>) {
    this.config = { ...DEFAULT_RETENTION, ...config };
  }

  /**
   * Evaluate each session and produce a retention decision.
   * PRD: no pruning without a policy record.
   */
  evaluate(sessions: Record<string, SessionRecord>): TrailRetentionDecision[] {
    const now = Date.now();
    const keepThreshold = now - this.config.keepRecentDays * 86_400_000;
    const pruneThreshold = now - this.config.prunePastDays * 86_400_000;
    const decidedAt = new Date().toISOString();

    const decisions: TrailRetentionDecision[] = [];

    for (const [sessionId, session] of Object.entries(sessions)) {
      const lastActivity = new Date(session.lastEventAt).getTime();

      // Pinned sessions are always kept
      if (session.pinned) {
        decisions.push({
          sessionId,
          decision: "keep",
          reason: "session is pinned — explicit user preserve",
          decidedAt,
          pinned: true,
          policyId: this.config.policyId,
        });
        continue;
      }

      // Recent: keep as-is
      if (lastActivity >= keepThreshold) {
        decisions.push({
          sessionId,
          decision: "keep",
          reason: `last activity within ${this.config.keepRecentDays} days`,
          decidedAt,
          pinned: false,
          policyId: this.config.policyId,
        });
        continue;
      }

      // Very old: prune
      if (lastActivity < pruneThreshold) {
        decisions.push({
          sessionId,
          decision: "prune",
          reason: `last activity > ${this.config.prunePastDays} days ago`,
          decidedAt,
          pinned: false,
          policyId: this.config.policyId,
        });
        continue;
      }

      // Middle range: compress
      decisions.push({
        sessionId,
        decision: this.config.enableCompression ? "compress" : "keep",
        reason: `last activity between ${this.config.keepRecentDays} and ${this.config.prunePastDays} days — eligible for compression`,
        decidedAt,
        pinned: false,
        policyId: this.config.policyId,
      });
    }

    return decisions;
  }

  /** Get sessions scheduled for pruning. */
  getPruneList(sessions: Record<string, SessionRecord>): string[] {
    return this.evaluate(sessions)
      .filter((d) => d.decision === "prune")
      .map((d) => d.sessionId);
  }

  /** Get sessions scheduled for compression. */
  getCompressList(sessions: Record<string, SessionRecord>): string[] {
    return this.evaluate(sessions)
      .filter((d) => d.decision === "compress")
      .map((d) => d.sessionId);
  }
}
