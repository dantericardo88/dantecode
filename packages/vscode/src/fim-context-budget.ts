// packages/vscode/src/fim-context-budget.ts
// Tabby-harvested: tiered context assembly with principled token budgeting.
// Reference: Tabby context_providers max_input_length allocation pattern.
// Replaces hardcoded 80%/20% prefix/suffix splits in inline-completion.ts.

export interface FimContextSlots {
  /** Max tokens for code prefix (before cursor) */
  prefix: number;
  /** Max tokens for code suffix (after cursor) */
  suffix: number;
  /** Max tokens for LSP type/definition context */
  lsp: number;
  /** Max tokens for RAG/BM25 snippet context */
  rag: number;
  /** Max tokens for cross-file import context */
  crossFile: number;
  /** Tokens reserved for FIM tokens + completion output */
  reserved: number;
}

export interface FimContextBudgetOptions {
  contextWindowTokens: number;
  completionMaxTokens: number;
  slotRatios?: Partial<SlotRatios>;
}

interface SlotRatios {
  prefix: number;    // default 0.60
  suffix: number;    // default 0.15
  lsp: number;       // default 0.10
  rag: number;       // default 0.10
  crossFile: number; // default 0.05
}

const DEFAULT_RATIOS: SlotRatios = {
  prefix: 0.60,
  suffix: 0.15,
  lsp: 0.10,
  rag: 0.10,
  crossFile: 0.05,
};

/** Reserved for FIM structural tokens (<PRE>, <SUF>, <MID>, etc.) */
const FIM_TOKEN_OVERHEAD = 50;

/** Conservative heuristic: ~4 characters per token for code */
const CHARS_PER_TOKEN = 4;

export class FimContextBudget {
  readonly slots: FimContextSlots;

  constructor(options: FimContextBudgetOptions) {
    const { contextWindowTokens, completionMaxTokens, slotRatios = {} } = options;
    const ratios: SlotRatios = { ...DEFAULT_RATIOS, ...slotRatios };

    const sum = ratios.prefix + ratios.suffix + ratios.lsp + ratios.rag + ratios.crossFile;
    if (Math.abs(sum - 1.0) > 0.001) {
      throw new Error(`FimContextBudget: slot ratios must sum to 1.0 (got ${sum.toFixed(4)})`);
    }

    const available = Math.max(0, contextWindowTokens - completionMaxTokens - FIM_TOKEN_OVERHEAD);

    this.slots = {
      prefix: Math.floor(available * ratios.prefix),
      suffix: Math.floor(available * ratios.suffix),
      lsp: Math.floor(available * ratios.lsp),
      rag: Math.floor(available * ratios.rag),
      crossFile: Math.floor(available * ratios.crossFile),
      reserved: completionMaxTokens + FIM_TOKEN_OVERHEAD,
    };
  }

  /**
   * Create a budget from a known context window size.
   * Common context windows: 8192 (small local), 32768 (medium), 131072 (large cloud).
   */
  static forContextWindow(contextWindowTokens: number, completionMaxTokens = 256): FimContextBudget {
    return new FimContextBudget({ contextWindowTokens, completionMaxTokens });
  }

  /**
   * Prune prefix to fit token budget.
   * Takes the TAIL (most recent code near cursor) — do NOT use slice(0, max).
   */
  static prunePrefix(prefix: string, maxTokens: number): string {
    const maxChars = maxTokens * CHARS_PER_TOKEN;
    return prefix.length > maxChars ? prefix.slice(-maxChars) : prefix;
  }

  /**
   * Prune suffix to fit token budget.
   * Takes the HEAD (code immediately after cursor).
   */
  static pruneSuffix(suffix: string, maxTokens: number): string {
    const maxChars = maxTokens * CHARS_PER_TOKEN;
    return suffix.length > maxChars ? suffix.slice(0, maxChars) : suffix;
  }
}

/** Pre-built budgets for common model context window tiers */
export const BUDGET_8K = FimContextBudget.forContextWindow(8_192, 256);
export const BUDGET_32K = FimContextBudget.forContextWindow(32_768, 512);
export const BUDGET_128K = FimContextBudget.forContextWindow(131_072, 512);
