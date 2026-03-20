// ============================================================================
// @dantecode/memory-engine — Compression Engine
// Token-efficiency layer: compacts verbose memory into durable summaries.
// Patterns from OpenHands context-window optimization + LangGraph compaction.
// ============================================================================

import { estimateTokens } from "./summarizer.js";
import type { MemoryItem } from "./types.js";

/** Result of a compression operation. */
export interface CompressionResult {
  originalItems: MemoryItem[];
  compressedItem: MemoryItem;
  tokensBefore: number;
  tokensAfter: number;
  compressionRatio: number;
}

/**
 * Compression Engine reduces context load by merging verbose MemoryItems
 * into compact representations without losing critical facts.
 *
 * GF-03: context window efficiency — 40%+ token reduction target.
 */
export class CompressionEngine {
  private modelCompressor?: (items: MemoryItem[], maxTokens: number) => Promise<string>;

  /** Hook in model-backed compression for higher quality. */
  setModelCompressor(fn: (items: MemoryItem[], maxTokens: number) => Promise<string>): void {
    this.modelCompressor = fn;
  }

  // --------------------------------------------------------------------------
  // Compress
  // --------------------------------------------------------------------------

  /**
   * Compress a list of MemoryItems into a single item.
   * Preserves the most important facts from each item.
   */
  async compress(
    items: MemoryItem[],
    maxTokens = 200,
  ): Promise<CompressionResult> {
    if (items.length === 0) {
      throw new Error("Cannot compress empty item list");
    }

    const originalText = items.map((i) => this.itemToText(i)).join("\n\n");
    const tokensBefore = estimateTokens(originalText);

    let compressedText: string;

    if (this.modelCompressor && tokensBefore > maxTokens * 2) {
      try {
        compressedText = await this.modelCompressor(items, maxTokens);
      } catch {
        compressedText = this.extractiveCompress(items, maxTokens);
      }
    } else {
      compressedText = this.extractiveCompress(items, maxTokens);
    }

    const tokensAfter = estimateTokens(compressedText);
    const compressionRatio = tokensBefore > 0 ? tokensAfter / tokensBefore : 1;

    // Build the compressed MemoryItem
    const best = items.reduce((a, b) => (a.score > b.score ? a : b));
    const compressedItem: MemoryItem = {
      key: `compressed::${best.key}::${Date.now()}`,
      value: {
        original_count: items.length,
        summary: compressedText,
        keys: items.map((i) => i.key),
      },
      scope: best.scope,
      layer: best.layer,
      createdAt: new Date().toISOString(),
      lastAccessedAt: new Date().toISOString(),
      score: Math.max(...items.map((i) => i.score)),
      recallCount: items.reduce((sum, i) => sum + i.recallCount, 0),
      source: best.source,
      summary: compressedText.slice(0, 200),
      tags: ["compressed", ...(best.tags ?? [])],
      verified: items.every((i) => i.verified),
    };

    return {
      originalItems: items,
      compressedItem,
      tokensBefore,
      tokensAfter,
      compressionRatio,
    };
  }

  /**
   * Batch compress: groups items by source/session and compresses each group.
   */
  async batchCompress(
    items: MemoryItem[],
    maxTokensPerGroup = 200,
  ): Promise<CompressionResult[]> {
    // Group by source
    const groups = new Map<string, MemoryItem[]>();
    for (const item of items) {
      const groupKey = item.source ?? "default";
      if (!groups.has(groupKey)) groups.set(groupKey, []);
      groups.get(groupKey)!.push(item);
    }

    const results: CompressionResult[] = [];
    for (const [, groupItems] of groups) {
      if (groupItems.length > 1) {
        results.push(await this.compress(groupItems, maxTokensPerGroup));
      }
    }
    return results;
  }

  /**
   * Estimate whether a set of items would benefit from compression.
   * Returns true if compression would save >= 30% tokens.
   */
  shouldCompress(items: MemoryItem[], maxTokens: number): boolean {
    if (items.length <= 1) return false;
    const totalTokens = items.reduce((sum, i) => sum + estimateTokens(this.itemToText(i)), 0);
    return totalTokens > maxTokens * 1.3;
  }

  // --------------------------------------------------------------------------
  // Private
  // --------------------------------------------------------------------------

  /**
   * Extractive compression: take the most informative sentences/facts.
   * No model needed — pure heuristic.
   */
  private extractiveCompress(items: MemoryItem[], maxTokens: number): string {
    const sentences: Array<{ text: string; score: number }> = [];

    for (const item of items) {
      const text = this.itemToText(item);
      // Split into sentences
      const parts = text.split(/[.!?]+/).filter((s) => s.trim().length > 20);

      for (const part of parts) {
        // Score: longer + from high-value items = better
        const score = (part.length / 200) * item.score + (item.verified ? 0.3 : 0);
        sentences.push({ text: part.trim(), score });
      }
    }

    // Sort by score
    sentences.sort((a, b) => b.score - a.score);

    // Take sentences until we hit the token limit
    const selected: string[] = [];
    let tokenCount = 0;
    const targetChars = maxTokens * 4; // ~4 chars per token

    for (const { text } of sentences) {
      if (tokenCount + text.length > targetChars) break;
      selected.push(text);
      tokenCount += text.length;
    }

    return selected.length > 0 ? selected.join(". ") + "." : items[0]!.summary ?? items[0]!.key;
  }

  private itemToText(item: MemoryItem): string {
    if (item.summary) return item.summary;
    if (typeof item.value === "string") return item.value;
    try {
      return JSON.stringify(item.value);
    } catch {
      return item.key;
    }
  }
}

/** Singleton compression engine. */
export const globalCompressionEngine = new CompressionEngine();
