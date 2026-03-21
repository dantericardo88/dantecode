// ============================================================================
// @dantecode/core — Council Overlap Detector
// Detects file-level, hunk-level, and semantic ownership collisions between
// council lanes. Enforces NOMA (Non-Overlapping Mandate Assignment).
// ============================================================================

import { randomUUID } from "node:crypto";
import type { FileMandate, OverlapLevel, OverlapRecord } from "./council-types.js";
import type { WorktreeSnapshot } from "./worktree-observer.js";

// ----------------------------------------------------------------------------
// Overlap detection result
// ----------------------------------------------------------------------------

export interface OverlapDetectionResult {
  overlaps: OverlapRecord[];
  /** Lanes that must be frozen pending merge-brain review. */
  lanesToFreeze: string[];
  /** Lanes that should receive a warning (L2). */
  lanesToWarn: string[];
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function newOverlapId(): string {
  return `overlap-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

/**
 * Classify overlap severity between two file sets.
 *
 * L0 — no overlap
 * L1 — shared contract files (read-only deps)
 * L2 — same module family (same directory prefix), different files
 * L3 — same file, intersection detected
 * L4 — same file AND same hunk region
 */
export function classifyOverlapLevel(filesA: string[], filesB: string[]): OverlapLevel {
  const setA = new Set(filesA);
  const setB = new Set(filesB);

  const sameFiles = [...setA].filter((f) => setB.has(f));

  if (sameFiles.length === 0) {
    // Check same module family (same parent directory)
    const dirsA = new Set(filesA.map((f) => f.split("/").slice(0, -1).join("/")));
    const dirsB = new Set(filesB.map((f) => f.split("/").slice(0, -1).join("/")));
    const sameDirs = [...dirsA].filter((d) => d !== "" && dirsB.has(d));
    if (sameDirs.length > 0) return 2;
    return 0;
  }

  // Same files present — L3 at minimum
  return 3;
}

/**
 * Check if any file in set A violates the mandate of lane B.
 */
function mandateViolation(
  filesWritten: string[],
  mandate: FileMandate,
): { forbidden: string[]; ownedByOther: string[] } {
  const forbidden = filesWritten.filter((f) => mandate.forbiddenFiles.includes(f));
  const ownedByOther = filesWritten.filter(
    (f) => mandate.ownedFiles.includes(f) || mandate.readOnlyFiles.includes(f),
  );
  return { forbidden, ownedByOther };
}

// ----------------------------------------------------------------------------
// OverlapDetector
// ----------------------------------------------------------------------------

/**
 * Compares file mandates and actual worktree snapshots across all active lanes.
 * Produces OverlapRecord entries and freeze/warn recommendations.
 */
export class OverlapDetector {
  /**
   * Detect overlaps from current worktree snapshots and file mandates.
   *
   * @param snapshots - Current snapshots from WorktreeObserver.
   * @param mandates  - NOMA mandates registered for each lane.
   */
  detect(snapshots: WorktreeSnapshot[], mandates: FileMandate[]): OverlapDetectionResult {
    const overlaps: OverlapRecord[] = [];
    const lanesToFreeze = new Set<string>();
    const lanesToWarn = new Set<string>();
    const now = new Date().toISOString();

    const mandateMap = new Map(mandates.map((m) => [m.laneId, m]));

    // Compare every pair of lanes
    for (let i = 0; i < snapshots.length; i++) {
      for (let j = i + 1; j < snapshots.length; j++) {
        const snapA = snapshots[i]!;
        const snapB = snapshots[j]!;

        const level = classifyOverlapLevel(snapA.modifiedFiles, snapB.modifiedFiles);
        if (level === 0) continue;

        const intersect = snapA.modifiedFiles.filter((f) => snapB.modifiedFiles.includes(f));

        const record: OverlapRecord = {
          id: newOverlapId(),
          laneA: snapA.laneId,
          laneB: snapB.laneId,
          level,
          files:
            intersect.length > 0 ? intersect : [...snapA.modifiedFiles, ...snapB.modifiedFiles],
          detectedAt: now,
          frozen: false,
        };

        // Enforce NOMA policy
        if (level >= 3) {
          // L3+ — freeze both lanes
          record.frozen = true;
          lanesToFreeze.add(snapA.laneId);
          lanesToFreeze.add(snapB.laneId);
        } else if (level === 2) {
          lanesToWarn.add(snapA.laneId);
          lanesToWarn.add(snapB.laneId);
        }

        overlaps.push(record);
      }
    }

    // Also check mandate declarations for forbidden file violations
    for (const snapshot of snapshots) {
      for (const [otherLaneId, otherMandate] of mandateMap) {
        if (otherLaneId === snapshot.laneId) continue;
        const { forbidden, ownedByOther } = mandateViolation(snapshot.modifiedFiles, otherMandate);
        if (forbidden.length > 0 || ownedByOther.length > 0) {
          const violatedFiles = [...forbidden, ...ownedByOther];
          const existing = overlaps.find(
            (o) =>
              (o.laneA === snapshot.laneId && o.laneB === otherLaneId) ||
              (o.laneA === otherLaneId && o.laneB === snapshot.laneId),
          );
          if (!existing) {
            overlaps.push({
              id: newOverlapId(),
              laneA: snapshot.laneId,
              laneB: otherLaneId,
              level: 4, // mandate violation = highest severity
              files: violatedFiles,
              detectedAt: now,
              frozen: true,
            });
            lanesToFreeze.add(snapshot.laneId);
          }
        }
      }
    }

    return {
      overlaps,
      lanesToFreeze: [...lanesToFreeze],
      lanesToWarn: [...lanesToWarn],
    };
  }

  /**
   * Check a single proposed file write against existing mandates.
   * Returns true if the write is safe (no NOMA violation).
   */
  checkWrite(
    laneId: string,
    filePath: string,
    allMandates: FileMandate[],
  ): { safe: boolean; reason?: string } {
    const ownMandate = allMandates.find((m) => m.laneId === laneId);
    if (ownMandate) {
      if (ownMandate.forbiddenFiles.includes(filePath)) {
        return { safe: false, reason: `File is forbidden for lane ${laneId}` };
      }
      if (ownMandate.ownedFiles.length > 0 && !ownMandate.ownedFiles.includes(filePath)) {
        return {
          safe: false,
          reason: `File not in owned manifest for lane ${laneId}. Add it to ownedFiles or request a mandate extension.`,
        };
      }
    }

    // Check other mandates for ownership conflicts
    for (const mandate of allMandates) {
      if (mandate.laneId === laneId) continue;
      if (mandate.ownedFiles.includes(filePath)) {
        return {
          safe: false,
          reason: `File ${filePath} is owned by lane ${mandate.laneId}. NOMA violation.`,
        };
      }
      if (mandate.forbiddenFiles.includes(filePath)) {
        // Another lane forbids it globally — treat as L4 overlap
        return {
          safe: false,
          reason: `File ${filePath} is forbidden by mandate of lane ${mandate.laneId}.`,
        };
      }
    }

    return { safe: true };
  }
}
