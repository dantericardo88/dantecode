// ============================================================================
// packages/core/src/diff-engine/multi-file-session.ts
//
// Coordinates SEARCH/REPLACE edits across multiple files.
// Each block tracks its own accept/reject/fail state, enabling
// a unified pre-apply review session before any file is written.
// ============================================================================

import {
  applySearchReplaceBlock,
  type SearchReplaceBlock,
  type ApplySearchReplaceResult,
  type MatchQuality,
} from "./search-replace-parser.js";

// ── Types ────────────────────────────────────────────────────────────────────

export type BlockState = "pending" | "applied" | "rejected" | "failed";

export interface SessionBlock {
  readonly id: string;
  readonly filePath: string;
  readonly searchContent: string;
  readonly replaceContent: string;
  state: BlockState;
  matchQuality?: MatchQuality;
  failureReason?: string;
}

// ── MultiFileDiffSession ──────────────────────────────────────────────────────

/**
 * Groups all SEARCH/REPLACE blocks from a single model response into a session.
 * Blocks can be individually accepted or rejected, or settled in bulk.
 * Applying a block reads and writes via injected async callbacks so the
 * session has no direct filesystem dependency (testable, sandboxable).
 */
export class MultiFileDiffSession {
  private readonly _blocks: SessionBlock[];

  constructor(blocks: SearchReplaceBlock[]) {
    this._blocks = blocks.map((b, i) => ({
      id: `block-${i}`,
      filePath: b.filePath,
      searchContent: b.searchContent,
      replaceContent: b.replaceContent,
      state: "pending" as BlockState,
    }));
  }

  // ── Read-only views ────────────────────────────────────────────────────────

  get blocks(): readonly SessionBlock[] {
    return this._blocks;
  }

  get pendingBlocks(): SessionBlock[] {
    return this._blocks.filter((b) => b.state === "pending");
  }

  get allSettled(): boolean {
    return this._blocks.every((b) => b.state !== "pending");
  }

  get affectedFiles(): string[] {
    return [...new Set(this._blocks.map((b) => b.filePath))];
  }

  getBlocksForFile(filePath: string): SessionBlock[] {
    return this._blocks.filter((b) => b.filePath === filePath);
  }

  // ── Apply ─────────────────────────────────────────────────────────────────

  /**
   * Apply a single pending block.
   * Reads the current file content via `getContent`, attempts to apply
   * the SEARCH/REPLACE block, and writes back via `writeContent` on success.
   *
   * Throws if the block id is not found or the block is not in "pending" state.
   */
  async applyBlock(
    id: string,
    getContent: (path: string) => Promise<string>,
    writeContent: (path: string, content: string) => Promise<void>,
    opts?: { fuzzyThreshold?: number },
  ): Promise<ApplySearchReplaceResult> {
    const block = this._blocks.find((b) => b.id === id);
    if (!block) throw new Error(`MultiFileDiffSession: block "${id}" not found`);
    if (block.state !== "pending") {
      throw new Error(
        `MultiFileDiffSession: block "${id}" is already ${block.state} — cannot apply`,
      );
    }

    const fileContent = await getContent(block.filePath);
    const result = applySearchReplaceBlock(fileContent, block as unknown as SearchReplaceBlock, opts);

    if (result.matched) {
      await writeContent(block.filePath, result.updatedContent!);
      block.state = "applied";
      block.matchQuality = result.matchQuality;
    } else {
      block.state = "failed";
      block.failureReason = result.diagnostic;
    }

    return result;
  }

  // ── Reject ────────────────────────────────────────────────────────────────

  /**
   * Reject a single pending block (no file write occurs).
   * Throws if the block id is not found.
   */
  rejectBlock(id: string): void {
    const block = this._blocks.find((b) => b.id === id);
    if (!block) throw new Error(`MultiFileDiffSession: block "${id}" not found`);
    block.state = "rejected";
  }

  // ── Bulk operations ────────────────────────────────────────────────────────

  /**
   * Apply all currently pending blocks in document order.
   * Each block is applied independently (re-reads file each time so previous
   * block writes are visible). Failures set the block state to "failed" but
   * do not abort subsequent blocks.
   *
   * Returns a map from block id → ApplySearchReplaceResult.
   */
  async applyAll(
    getContent: (path: string) => Promise<string>,
    writeContent: (path: string, content: string) => Promise<void>,
    opts?: { fuzzyThreshold?: number },
  ): Promise<Map<string, ApplySearchReplaceResult>> {
    const results = new Map<string, ApplySearchReplaceResult>();

    // Snapshot the pending list before iteration (applyBlock mutates state)
    const pending = this.pendingBlocks.slice();
    for (const block of pending) {
      try {
        const result = await this.applyBlock(block.id, getContent, writeContent, opts);
        results.set(block.id, result);
      } catch (err) {
        // Already-settled block (shouldn't happen with snapshot, but guard anyway)
        results.set(block.id, {
          matched: false,
          matchQuality: "none",
          usedFallback: false,
          diagnostic: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return results;
  }

  /**
   * Reject all currently pending blocks.
   */
  rejectAll(): void {
    for (const block of this._blocks) {
      if (block.state === "pending") block.state = "rejected";
    }
  }
}
