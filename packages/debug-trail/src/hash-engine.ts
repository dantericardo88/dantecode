// ============================================================================
// @dantecode/debug-trail — Hash Engine
// SHA-256 content hashing for file snapshots and event deduplication.
// ============================================================================

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";

/** Compute SHA-256 hex hash of a string or Buffer. */
export function hashContent(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

/** Compute SHA-256 hex hash of a file at the given path. Returns null if file not found. */
export async function hashFile(filePath: string): Promise<string | null> {
  if (!existsSync(filePath)) return null;
  try {
    const content = await readFile(filePath);
    return hashContent(content);
  } catch {
    return null;
  }
}

/** Compute a short 8-char prefix of a hash for display. */
export function shortHash(hash: string): string {
  return hash.slice(0, 8);
}

/** Generate a unique snapshot ID from file path + hash + timestamp. */
export function makeSnapshotId(filePath: string, contentHash: string, timestamp: string): string {
  const raw = `${filePath}:${contentHash}:${timestamp}`;
  return `snap_${createHash("sha256").update(raw).digest("hex").slice(0, 16)}`;
}

/** Generate a tombstone ID from file path + timestamp. */
export function makeTombstoneId(filePath: string, timestamp: string): string {
  const raw = `tombstone:${filePath}:${timestamp}`;
  return `tomb_${createHash("sha256").update(raw).digest("hex").slice(0, 16)}`;
}

/** Generate a trail event ID (sequential + random). */
export function makeTrailEventId(seq: number, sessionId: string): string {
  const raw = `event:${sessionId}:${seq}:${Date.now()}:${Math.random()}`;
  return `evt_${createHash("sha256").update(raw).digest("hex").slice(0, 16)}`;
}

/** Detect if two hashes represent the same content. */
export function hashesEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a == null || b == null) return false;
  return a === b;
}
