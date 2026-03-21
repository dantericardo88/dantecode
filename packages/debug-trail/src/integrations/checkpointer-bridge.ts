// ============================================================================
// @dantecode/debug-trail — Checkpointer Bridge (LangGraph-inspired)
// Cross-links trail events with checkpoint IDs for replay alignment.
// Enables "what was the file state when checkpoint X was created?" queries.
// ============================================================================

import type { AuditLogger } from "../audit-logger.js";
import type { TrailEvent } from "../types.js";

// ---------------------------------------------------------------------------
// Checkpoint bridge
// ---------------------------------------------------------------------------

export interface CheckpointLinkage {
  checkpointId: string;
  sessionId: string;
  step: number;
  trailEventIds: string[];
  timestamp: string;
}

export class CheckpointerBridge {
  private linkages: CheckpointLinkage[] = [];

  constructor(private readonly logger: AuditLogger) {}

  /**
   * Register a checkpoint transition and link it to the current trail position.
   */
  async onCheckpointCreated(checkpointId: string, step: number): Promise<string> {
    const sessionId = this.logger.getSessionId();
    const timestamp = new Date().toISOString();

    // Log the checkpoint transition as a trail event
    const eventId = await this.logger.logCheckpointTransition(checkpointId, step);

    // Update the logger's provenance to include this checkpoint
    this.logger.setCheckpointContext(checkpointId);

    // Record the linkage for later replay alignment
    const existing = this.linkages.find((l) => l.checkpointId === checkpointId);
    if (existing) {
      existing.trailEventIds.push(eventId);
    } else {
      this.linkages.push({
        checkpointId,
        sessionId,
        step,
        trailEventIds: [eventId],
        timestamp,
      });
    }

    return eventId;
  }

  /**
   * Link a set of trail events to a checkpoint (e.g. after the fact).
   */
  linkEventsToCheckpoint(checkpointId: string, eventIds: string[]): void {
    const existing = this.linkages.find((l) => l.checkpointId === checkpointId);
    if (existing) {
      for (const id of eventIds) {
        if (!existing.trailEventIds.includes(id)) {
          existing.trailEventIds.push(id);
        }
      }
    } else {
      this.linkages.push({
        checkpointId,
        sessionId: this.logger.getSessionId(),
        step: -1,
        trailEventIds: eventIds,
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Get all checkpoint linkages for the current session.
   */
  getLinkages(): CheckpointLinkage[] {
    return this.linkages.filter((l) => l.sessionId === this.logger.getSessionId());
  }

  /**
   * Get trail event IDs associated with a specific checkpoint.
   */
  getEventsForCheckpoint(checkpointId: string): string[] {
    return this.linkages.find((l) => l.checkpointId === checkpointId)?.trailEventIds ?? [];
  }

  /**
   * Get the most recent checkpoint before a given timestamp.
   */
  checkpointBefore(timestamp: string): CheckpointLinkage | null {
    const ts = new Date(timestamp).getTime();
    const before = this.linkages
      .filter((l) => new Date(l.timestamp).getTime() <= ts)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return before[0] ?? null;
  }

  /**
   * Reconstruct which checkpoint was active during a given trail event.
   */
  checkpointForEvent(event: TrailEvent): string | null {
    return event.provenance.checkpointId ?? null;
  }
}
