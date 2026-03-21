// ============================================================================
// @dantecode/memory-engine — Summarizer
// Automatic session summarization + context compression.
// Patterns from Mem0 summarization + OpenHands long-horizon context mgmt.
// GF-03: long session compressed without losing critical facts.
// ============================================================================

import type { MemoryItem, MemorySummarizeResult, SessionKnowledge } from "./types.js";

/** Options for summarization. */
export interface SummarizerOptions {
  /** Maximum characters in output summary. Default: 500. */
  maxSummaryLength?: number;
  /** Whether to include file mentions. Default: true. */
  includeFiles?: boolean;
  /** Whether to include error mentions. Default: true. */
  includeErrors?: boolean;
  /** Optional model-backed summarizer function. */
  modelSummarizer?: (text: string, maxLength: number) => Promise<string>;
}

/**
 * Session summarizer + context compression engine.
 *
 * - Extracts facts, files, tasks, errors from a set of MemoryItems
 * - Produces a structured SessionKnowledge object
 * - Estimates token savings from compression
 * - Optional model-backed summarization via setModelSummarizer()
 */
export class Summarizer {
  private readonly maxSummaryLength: number;
  private readonly includeFiles: boolean;
  private readonly includeErrors: boolean;
  private modelSummarizer?: (text: string, maxLength: number) => Promise<string>;

  constructor(options: SummarizerOptions = {}) {
    this.maxSummaryLength = options.maxSummaryLength ?? 500;
    this.includeFiles = options.includeFiles ?? true;
    this.includeErrors = options.includeErrors ?? true;
    this.modelSummarizer = options.modelSummarizer;
  }

  /** Hook in a model-backed summarizer for richer output. */
  setModelSummarizer(fn: (text: string, maxLength: number) => Promise<string>): void {
    this.modelSummarizer = fn;
  }

  // --------------------------------------------------------------------------
  // Summarize a session's MemoryItems
  // --------------------------------------------------------------------------

  /**
   * Summarize a set of MemoryItems from a session.
   * Returns a MemorySummarizeResult with token savings estimate.
   *
   * GF-03: reduces token load without losing critical facts.
   */
  async summarize(sessionId: string, items: MemoryItem[]): Promise<MemorySummarizeResult> {
    if (items.length === 0) {
      return {
        sessionId,
        summary: `Session ${sessionId}: no memory items to summarize.`,
        compressed: false,
        tokensSaved: 0,
      };
    }

    // Count original tokens
    const originalText = items.map((i) => JSON.stringify(i.value)).join(" ");
    const originalTokens = estimateTokens(originalText);

    // Extract structured knowledge
    const knowledge = this.extractKnowledge(sessionId, items);

    // Build summary text
    const summaryText = this.buildSummaryText(knowledge);

    // Optionally run through model summarizer
    let finalSummary = summaryText;
    if (this.modelSummarizer && originalText.length > 1000) {
      try {
        finalSummary = await this.modelSummarizer(summaryText, this.maxSummaryLength);
      } catch {
        finalSummary = summaryText.slice(0, this.maxSummaryLength);
      }
    } else {
      finalSummary = summaryText.slice(0, this.maxSummaryLength);
    }

    const summaryTokens = estimateTokens(finalSummary);
    const tokensSaved = Math.max(0, originalTokens - summaryTokens);

    return {
      sessionId,
      summary: finalSummary,
      compressed: tokensSaved > 0,
      tokensSaved,
    };
  }

  /**
   * Extract structured SessionKnowledge from MemoryItems.
   */
  extractKnowledge(sessionId: string, items: MemoryItem[]): SessionKnowledge {
    const facts: string[] = [];
    const filesModified: Set<string> = new Set();
    const tasks: string[] = [];
    const errors: string[] = [];

    for (const item of items) {
      // Extract facts from summaries
      if (item.summary) {
        facts.push(item.summary);
      }

      // Extract from string values
      const valStr = typeof item.value === "string" ? item.value : JSON.stringify(item.value);

      // File references
      const fileMatches = valStr.match(/[\w./\\-]+\.(?:ts|tsx|js|jsx|json|md|yaml)/g);
      if (fileMatches) {
        for (const f of fileMatches) filesModified.add(f);
      }

      // Task markers
      if (item.tags?.includes("task") || item.key.startsWith("task::")) {
        tasks.push(String(item.value).slice(0, 120));
      }

      // Error markers
      if (
        this.includeErrors &&
        (item.tags?.includes("error") || valStr.toLowerCase().includes("error:"))
      ) {
        const errMatch = valStr.match(/(?:Error|error):\s*([^\n]{5,100})/);
        if (errMatch?.[1]) errors.push(errMatch[1]);
      }

      // High-value items become facts
      if (item.score >= 0.7 && item.summary) {
        facts.push(item.summary);
      }
    }

    // Deduplicate
    const uniqueFacts = [...new Set(facts)].slice(0, 20);
    const uniqueTasks = [...new Set(tasks)].slice(0, 10);
    const uniqueErrors = [...new Set(errors)].slice(0, 5);
    const filesList = this.includeFiles ? [...filesModified].slice(0, 20) : [];

    return {
      sessionId,
      facts: uniqueFacts,
      filesModified: filesList,
      tasks: uniqueTasks,
      errors: uniqueErrors,
      capturedAt: new Date().toISOString(),
    };
  }

  /**
   * Compress a set of MemoryItems into a single consolidated item.
   * GF-03: reduces context size while preserving key facts.
   */
  compress(sessionId: string, items: MemoryItem[]): MemoryItem {
    const knowledge = this.extractKnowledge(sessionId, items);
    const summaryText = this.buildSummaryText(knowledge);

    return {
      key: `compressed::${sessionId}`,
      value: knowledge,
      scope: "project",
      layer: "checkpoint",
      createdAt: new Date().toISOString(),
      lastAccessedAt: new Date().toISOString(),
      score: 0.8,
      recallCount: 0,
      source: sessionId,
      summary: summaryText.slice(0, 200),
      tags: ["compressed", "session-knowledge"],
      verified: false,
    };
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  private buildSummaryText(knowledge: SessionKnowledge): string {
    const parts: string[] = [];

    if (knowledge.tasks.length > 0) {
      parts.push(`Tasks: ${knowledge.tasks.slice(0, 3).join("; ")}`);
    }

    if (knowledge.facts.length > 0) {
      parts.push(`Facts: ${knowledge.facts.slice(0, 5).join("; ")}`);
    }

    if (knowledge.filesModified.length > 0 && this.includeFiles) {
      parts.push(`Files: ${knowledge.filesModified.slice(0, 5).join(", ")}`);
    }

    if (knowledge.errors.length > 0 && this.includeErrors) {
      parts.push(`Errors: ${knowledge.errors.slice(0, 2).join("; ")}`);
    }

    const text = parts.join(". ");
    return text || `Session ${knowledge.sessionId} (no key facts extracted).`;
  }
}

// ----------------------------------------------------------------------------
// Utility: token estimation (approx 4 chars/token, GPT-style)
// ----------------------------------------------------------------------------

/**
 * Estimate token count for a string.
 * Approximation: ~4 characters per token.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Singleton instance. */
export const globalSummarizer = new Summarizer();
