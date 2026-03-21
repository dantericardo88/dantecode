/**
 * iteration-history.ts
 *
 * Manages durable iteration history for a Gaslight session.
 * Every draft, critique, and gate result is recorded here.
 * This is NOT the Skillbook — raw history stays separate.
 */

import type { GaslightSession, IterationRecord, GaslightCritique, GaslightGateDecision } from "./types.js";

export class IterationHistory {
  private records: IterationRecord[] = [];

  /** Add a draft for the current iteration. */
  recordDraft(draft: string): IterationRecord {
    const record: IterationRecord = {
      iteration: this.records.length + 1,
      draft,
      at: new Date().toISOString(),
    };
    this.records.push(record);
    return record;
  }

  /** Attach critique to the last record. */
  attachCritique(critique: GaslightCritique): void {
    const last = this.records[this.records.length - 1];
    if (last) last.critique = critique;
  }

  /** Attach gate decision to the last record. */
  attachGateResult(decision: GaslightGateDecision, score?: number, tokens?: number): void {
    const last = this.records[this.records.length - 1];
    if (last) {
      last.gateDecision = decision;
      if (score !== undefined) last.gateScore = score;
      if (tokens !== undefined) last.tokensUsed = tokens;
    }
  }

  /** Get all records (read-only copy). */
  getRecords(): IterationRecord[] {
    return [...this.records];
  }

  /** Get the last record, if any. */
  last(): IterationRecord | undefined {
    return this.records[this.records.length - 1];
  }

  /** Count of recorded iterations. */
  count(): number {
    return this.records.length;
  }

  /** Export to a GaslightSession (partial). */
  toSessionIterations(): IterationRecord[] {
    return this.getRecords();
  }
}

// Suppress unused import warning — GaslightSession is used as a conceptual export anchor
export type { GaslightSession };
