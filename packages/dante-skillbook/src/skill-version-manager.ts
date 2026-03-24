// ============================================================================
// @dantecode/dante-skillbook — Skill Version Manager
// Semver versioning, breaking change detection, version history tracking,
// and rollback support for skills.
// ============================================================================

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

/** A single version history entry. */
export interface VersionEntry {
  /** Semver version string. */
  version: string;
  /** Unix timestamp (ms) when the version was recorded. */
  timestamp: number;
  /** Snapshot of the skill state at this version. */
  snapshot: unknown;
  /** The type of change that produced this version. */
  changeType: string;
}

/** Change type for version bumping. */
export type ChangeType = "major" | "minor" | "patch";

// ────────────────────────────────────────────────────────────────────────────
// Manager
// ────────────────────────────────────────────────────────────────────────────

/**
 * Manages versioning of skills with semver, breaking change detection,
 * history tracking, and rollback support.
 *
 * - **bumpVersion**: Increment major/minor/patch following semver rules.
 * - **detectBreakingChange**: Compare old and new export lists for removals.
 * - **addVersion**: Store a version snapshot in history.
 * - **rollback**: Restore the most recent previous version.
 * - **getHistory**: Retrieve all version entries for a skill.
 */
export class SkillVersionManager {
  private readonly history: Map<string, VersionEntry[]> = new Map();
  private readonly nowFn: () => number;

  constructor(options?: { nowFn?: () => number }) {
    this.nowFn = options?.nowFn ?? (() => Date.now());
  }

  /**
   * Bump a semver version string by the given change type.
   * Follows standard semver rules:
   * - major: X+1.0.0
   * - minor: X.Y+1.0
   * - patch: X.Y.Z+1
   */
  bumpVersion(current: string, changeType: ChangeType): string {
    const parts = this.parseSemver(current);
    switch (changeType) {
      case "major":
        return `${parts.major + 1}.0.0`;
      case "minor":
        return `${parts.major}.${parts.minor + 1}.0`;
      case "patch":
        return `${parts.major}.${parts.minor}.${parts.patch + 1}`;
    }
  }

  /**
   * Detect if a change is breaking by comparing old and new export lists.
   * A breaking change occurs when exports present in the old interface
   * are absent from the new interface (removals).
   */
  detectBreakingChange(oldInterface: string[], newInterface: string[]): boolean {
    const newSet = new Set(newInterface);
    for (const symbol of oldInterface) {
      if (!newSet.has(symbol)) return true;
    }
    return false;
  }

  /**
   * Add a version snapshot to the history for a skill.
   */
  addVersion(skillId: string, version: string, snapshot: unknown): void {
    const entries = this.getOrCreateHistory(skillId);
    entries.push({
      version,
      timestamp: this.nowFn(),
      snapshot,
      changeType: this.inferChangeType(entries, version),
    });
  }

  /**
   * Rollback to the previous version of a skill.
   * Returns the previous version entry, or null if no history exists.
   * The current (latest) version is removed from history.
   */
  rollback(skillId: string): VersionEntry | null {
    const entries = this.history.get(skillId);
    if (!entries || entries.length < 2) return null;

    // Remove current version
    entries.pop();
    // Return the now-current (previous) version
    const previous = entries[entries.length - 1]!;
    return { ...previous };
  }

  /**
   * Get the full version history for a skill.
   * Returns a copy sorted by timestamp ascending.
   */
  getHistory(skillId: string): VersionEntry[] {
    const entries = this.history.get(skillId);
    if (!entries) return [];
    return entries.map((e) => ({ ...e }));
  }

  /**
   * Get the latest version for a skill, or null if no history exists.
   */
  getLatestVersion(skillId: string): string | null {
    const entries = this.history.get(skillId);
    if (!entries || entries.length === 0) return null;
    return entries[entries.length - 1]!.version;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────────────────────

  private getOrCreateHistory(skillId: string): VersionEntry[] {
    let entries = this.history.get(skillId);
    if (!entries) {
      entries = [];
      this.history.set(skillId, entries);
    }
    return entries;
  }

  private parseSemver(version: string): { major: number; minor: number; patch: number } {
    const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
    if (!match) {
      return { major: 0, minor: 0, patch: 0 };
    }
    return {
      major: parseInt(match[1]!, 10),
      minor: parseInt(match[2]!, 10),
      patch: parseInt(match[3]!, 10),
    };
  }

  private inferChangeType(entries: VersionEntry[], newVersion: string): string {
    if (entries.length === 0) return "initial";
    const prev = this.parseSemver(entries[entries.length - 1]!.version);
    const curr = this.parseSemver(newVersion);
    if (curr.major > prev.major) return "major";
    if (curr.minor > prev.minor) return "minor";
    if (curr.patch > prev.patch) return "patch";
    return "patch";
  }
}
