/**
 * artifact-store.ts — DTR Phase 1: In-memory artifact tracking
 *
 * Tracks all artifacts created during a session (git clones, file writes,
 * downloads) so the durable run store can persist them and we can verify
 * they still exist across tool calls.
 */

import type { ArtifactKind, ArtifactRecord } from './tool-call-types.js';

let _nextId = 1;
function nextId(): string {
  return `art_${Date.now()}_${_nextId++}`;
}

export class ArtifactStore {
  private readonly _artifacts = new Map<string, ArtifactRecord>();

  /** Record a new artifact. Returns the ArtifactRecord (with generated id). */
  record(artifact: Omit<ArtifactRecord, 'id' | 'createdAt' | 'verified'>): ArtifactRecord {
    const record: ArtifactRecord = {
      ...artifact,
      id: nextId(),
      createdAt: Date.now(),
      verified: false,
    };
    this._artifacts.set(record.id, record);
    return record;
  }

  /** Mark an artifact as verified (post-execution check passed). */
  markVerified(id: string): void {
    const rec = this._artifacts.get(id);
    if (rec) {
      rec.verified = true;
      rec.verifiedAt = Date.now();
    }
  }

  /** Get all artifacts for a given tool call. */
  getByToolCall(toolCallId: string): ArtifactRecord[] {
    return [...this._artifacts.values()].filter((a) => a.toolCallId === toolCallId);
  }

  /** Get all artifacts of a given kind. */
  getByKind(kind: ArtifactKind): ArtifactRecord[] {
    return [...this._artifacts.values()].filter((a) => a.kind === kind);
  }

  /** Get artifact by id. */
  get(id: string): ArtifactRecord | undefined {
    return this._artifacts.get(id);
  }

  /** Get all tracked artifacts (snapshot). */
  all(): ArtifactRecord[] {
    return [...this._artifacts.values()];
  }

  /** Count of unverified artifacts (useful for health check). */
  unverifiedCount(): number {
    return [...this._artifacts.values()].filter((a) => !a.verified).length;
  }

  /** Serialize to plain object for durable store persistence. */
  serialize(): ArtifactRecord[] {
    return this.all();
  }

  /** Restore from serialized state (e.g., on session resume). */
  restore(records: ArtifactRecord[]): void {
    for (const rec of records) {
      this._artifacts.set(rec.id, { ...rec });
    }
  }

  /** Clear all artifacts (used in tests). */
  clear(): void {
    this._artifacts.clear();
  }
}

/** Module-level singleton — shared within a CLI or VSCode session */
export const globalArtifactStore = new ArtifactStore();
