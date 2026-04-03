/**
 * review-queue.ts
 *
 * Review queue for REVIEW-REQUIRED skill update proposals.
 * Ensures no blocked update silently disappears.
 */

import type { UpdateOperation } from "./types.js";

export interface ReviewQueueItem {
  id: string;
  proposedAt: string;
  proposal: UpdateOperation;
  sessionId?: string;
  runId?: string;
  status: "pending" | "approved" | "rejected";
}

export class ReviewQueue {
  private items: ReviewQueueItem[] = [];
  private nextId = 1;

  /** Enqueue a review-required proposal. */
  enqueue(
    proposal: UpdateOperation,
    opts: { sessionId?: string; runId?: string } = {},
  ): ReviewQueueItem {
    const item: ReviewQueueItem = {
      id: `rq-${this.nextId++}`,
      proposedAt: new Date().toISOString(),
      proposal,
      sessionId: opts.sessionId,
      runId: opts.runId,
      status: "pending",
    };
    this.items.push(item);
    return item;
  }

  /** Get all pending items. */
  getPending(): ReviewQueueItem[] {
    return this.items.filter((i) => i.status === "pending");
  }

  /** Get all items (all statuses). */
  getAll(): ReviewQueueItem[] {
    return [...this.items];
  }

  /** Approve a pending item by ID. Returns true if found and transitioned. */
  approve(id: string): boolean {
    const item = this.items.find((i) => i.id === id && i.status === "pending");
    if (!item) return false;
    item.status = "approved";
    return true;
  }

  /** Reject a pending item by ID. Returns true if found and transitioned. */
  reject(id: string): boolean {
    const item = this.items.find((i) => i.id === id && i.status === "pending");
    if (!item) return false;
    item.status = "rejected";
    return true;
  }

  /** Count of pending items. */
  pendingCount(): number {
    return this.items.filter((i) => i.status === "pending").length;
  }
}
