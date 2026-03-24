// ============================================================================
// @dantecode/core — Git Conflict Resolver
// Parses git merge conflict markers, classifies conflicts as textual or
// semantic, and auto-resolves simple textual conflicts.
// ============================================================================

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

/** A detected conflict region within a file. */
export interface ConflictRegion {
  /** 1-based start line of the conflict (the <<<<<<< marker). */
  startLine: number;
  /** 1-based end line of the conflict (the >>>>>>> marker). */
  endLine: number;
  /** Content from "our" side (HEAD). */
  ours: string;
  /** Content from "their" side (incoming). */
  theirs: string;
  /** Ancestor content from diff3 format, if available. */
  ancestor?: string;
}

/** A resolution for a single conflict. */
export interface Resolution {
  /** The resolved content to replace the conflict region. */
  resolved: string;
  /** Strategy used to resolve: pick ours, pick theirs, or merged. */
  strategy: "ours" | "theirs" | "merged";
  /** Confidence in the resolution (0-1). */
  confidence: number;
}

/** Summary report for all detected conflicts. */
export interface ConflictReport {
  /** Total number of conflicts found. */
  totalConflicts: number;
  /** Number of textual (simple) conflicts. */
  textualCount: number;
  /** Number of semantic (complex) conflicts. */
  semanticCount: number;
  /** Number of conflicts that were auto-resolvable. */
  autoResolvableCount: number;
  /** Per-conflict details. */
  conflicts: Array<{
    region: ConflictRegion;
    classification: "textual" | "semantic";
    autoResolution: Resolution | null;
  }>;
}

// ────────────────────────────────────────────────────────────────────────────
// Conflict markers regex
// ────────────────────────────────────────────────────────────────────────────

const CONFLICT_START = /^<{7}\s*(.*)?$/;
const CONFLICT_SEPARATOR = /^={7}$/;
const CONFLICT_ANCESTOR = /^\|{7}\s*(.*)?$/;
const CONFLICT_END = /^>{7}\s*(.*)?$/;

// ────────────────────────────────────────────────────────────────────────────
// Resolver
// ────────────────────────────────────────────────────────────────────────────

/**
 * Detects, classifies, and auto-resolves git merge conflicts.
 *
 * - **Detection**: Parses `<<<<<<<` / `=======` / `>>>>>>>` markers.
 * - **Classification**: Textual = whitespace or identical changes;
 *   Semantic = divergent logic.
 * - **Auto-resolve**: Textual conflicts can be resolved by picking one side
 *   or merging. Semantic conflicts return null (need human review).
 */
export class GitConflictResolver {
  /**
   * Parse conflict markers in file content and return all conflict regions.
   */
  detectConflicts(content: string): ConflictRegion[] {
    const lines = content.split("\n");
    const conflicts: ConflictRegion[] = [];

    let i = 0;
    while (i < lines.length) {
      const startMatch = CONFLICT_START.exec(lines[i]!);
      if (!startMatch) {
        i++;
        continue;
      }

      const startLine = i + 1; // 1-based
      const oursLines: string[] = [];
      const theirsLines: string[] = [];
      const ancestorLines: string[] = [];
      let inOurs = true;
      let inAncestor = false;
      let endLine = startLine;

      i++;
      while (i < lines.length) {
        const line = lines[i]!;

        if (CONFLICT_ANCESTOR.test(line)) {
          inAncestor = true;
          inOurs = false;
          i++;
          continue;
        }

        if (CONFLICT_SEPARATOR.test(line)) {
          inOurs = false;
          inAncestor = false;
          i++;
          continue;
        }

        const endMatch = CONFLICT_END.exec(line);
        if (endMatch) {
          endLine = i + 1; // 1-based
          break;
        }

        if (inAncestor) {
          ancestorLines.push(line);
        } else if (inOurs) {
          oursLines.push(line);
        } else {
          theirsLines.push(line);
        }
        i++;
      }

      const region: ConflictRegion = {
        startLine,
        endLine,
        ours: oursLines.join("\n"),
        theirs: theirsLines.join("\n"),
      };
      if (ancestorLines.length > 0) {
        region.ancestor = ancestorLines.join("\n");
      }
      conflicts.push(region);
      i++;
    }

    return conflicts;
  }

  /**
   * Classify a conflict as textual or semantic.
   *
   * **Textual**: Whitespace-only differences, identical after normalization,
   * or one side is empty (deleted vs modified).
   *
   * **Semantic**: Substantively different logic on both sides.
   */
  classifyConflict(conflict: ConflictRegion): "textual" | "semantic" {
    const oursNorm = this.normalize(conflict.ours);
    const theirsNorm = this.normalize(conflict.theirs);

    // Identical after whitespace normalization
    if (oursNorm === theirsNorm) return "textual";

    // One side is empty (deletion)
    if (oursNorm.length === 0 || theirsNorm.length === 0) return "textual";

    // Check if one side is a superset of the other (additive change)
    if (oursNorm.includes(theirsNorm) || theirsNorm.includes(oursNorm)) return "textual";

    // Check for simple reordering: same tokens, different order
    const oursTokens = new Set(oursNorm.split(/\s+/));
    const theirsTokens = new Set(theirsNorm.split(/\s+/));
    if (oursTokens.size > 3 && theirsTokens.size > 3) {
      let overlap = 0;
      for (const t of oursTokens) {
        if (theirsTokens.has(t)) overlap++;
      }
      const similarity = overlap / Math.max(oursTokens.size, theirsTokens.size);
      if (similarity > 0.85) return "textual";
    }

    return "semantic";
  }

  /**
   * Attempt to auto-resolve a conflict.
   * Returns null for semantic conflicts that require human review.
   */
  autoResolve(conflict: ConflictRegion): Resolution | null {
    const classification = this.classifyConflict(conflict);
    if (classification === "semantic") return null;

    const oursNorm = this.normalize(conflict.ours);
    const theirsNorm = this.normalize(conflict.theirs);

    // Identical after normalization: pick ours
    if (oursNorm === theirsNorm) {
      return { resolved: conflict.ours, strategy: "ours", confidence: 0.95 };
    }

    // One side is empty: pick the non-empty side
    if (oursNorm.length === 0) {
      return { resolved: conflict.theirs, strategy: "theirs", confidence: 0.85 };
    }
    if (theirsNorm.length === 0) {
      return { resolved: conflict.ours, strategy: "ours", confidence: 0.85 };
    }

    // Superset: pick the longer version
    if (theirsNorm.includes(oursNorm)) {
      return { resolved: conflict.theirs, strategy: "theirs", confidence: 0.80 };
    }
    if (oursNorm.includes(theirsNorm)) {
      return { resolved: conflict.ours, strategy: "ours", confidence: 0.80 };
    }

    // High token overlap: merge by taking the longer content
    const longer = conflict.ours.length >= conflict.theirs.length ? conflict.ours : conflict.theirs;
    return {
      resolved: longer,
      strategy: conflict.ours.length >= conflict.theirs.length ? "ours" : "theirs",
      confidence: 0.60,
    };
  }

  /**
   * Generate a summary report for all conflicts in a file.
   */
  generateReport(conflicts: ConflictRegion[]): ConflictReport {
    let textualCount = 0;
    let semanticCount = 0;
    let autoResolvableCount = 0;

    const details = conflicts.map((region) => {
      const classification = this.classifyConflict(region);
      const autoResolution = this.autoResolve(region);

      if (classification === "textual") textualCount++;
      else semanticCount++;
      if (autoResolution !== null) autoResolvableCount++;

      return { region, classification, autoResolution };
    });

    return {
      totalConflicts: conflicts.length,
      textualCount,
      semanticCount,
      autoResolvableCount,
      conflicts: details,
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────────────────────

  /** Normalize whitespace for comparison. */
  private normalize(text: string): string {
    return text.replace(/\s+/g, " ").trim();
  }
}
