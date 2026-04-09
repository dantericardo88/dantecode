// ============================================================================
// @dantecode/cli — Anthropic model pricing calculator
//
// Computes USD cost from token counts using published Anthropic pricing.
// Prices are per-token (not per-million) for easy arithmetic.
// Sources: https://www.anthropic.com/pricing (as of 2026-04)
// ============================================================================

interface TokenPrice {
  /** USD per input token */
  input: number;
  /** USD per output token */
  output: number;
}

// Model ID → per-token pricing (USD)
const PRICING: Record<string, TokenPrice> = {
  // Claude 4.x
  "claude-opus-4-6":              { input: 15.0 / 1_000_000,  output: 75.0 / 1_000_000  },
  "claude-opus-4-5":              { input: 15.0 / 1_000_000,  output: 75.0 / 1_000_000  },
  "claude-opus-4-0":              { input: 15.0 / 1_000_000,  output: 75.0 / 1_000_000  },
  "claude-sonnet-4-6":            { input:  3.0 / 1_000_000,  output: 15.0 / 1_000_000  },
  "claude-sonnet-4-5":            { input:  3.0 / 1_000_000,  output: 15.0 / 1_000_000  },
  "claude-sonnet-4-0":            { input:  3.0 / 1_000_000,  output: 15.0 / 1_000_000  },
  "claude-haiku-4-5-20251001":    { input:  0.25 / 1_000_000, output:  1.25 / 1_000_000 },
  "claude-haiku-4-0":             { input:  0.25 / 1_000_000, output:  1.25 / 1_000_000 },
  // Claude 3.x (legacy)
  "claude-3-5-sonnet-20241022":   { input:  3.0 / 1_000_000,  output: 15.0 / 1_000_000  },
  "claude-3-5-haiku-20241022":    { input:  0.8 / 1_000_000,  output:  4.0 / 1_000_000  },
  "claude-3-opus-20240229":       { input: 15.0 / 1_000_000,  output: 75.0 / 1_000_000  },
  "claude-3-haiku-20240307":      { input:  0.25 / 1_000_000, output:  1.25 / 1_000_000 },
};

// Fallback tier pricing when exact model ID is unknown
const TIER_PRICING: Record<string, TokenPrice> = {
  low:    { input:  0.25 / 1_000_000, output:  1.25 / 1_000_000 },
  medium: { input:  3.0  / 1_000_000, output: 15.0  / 1_000_000 },
  high:   { input: 15.0  / 1_000_000, output: 75.0  / 1_000_000 },
};

/**
 * Compute the USD cost for a model invocation given token counts.
 *
 * @param modelId  Full model ID (e.g. "claude-sonnet-4-6") or tier ("low"/"medium"/"high")
 * @param inputTokens  Number of input/prompt tokens
 * @param outputTokens Number of output/completion tokens
 * @returns USD cost, rounded to 6 decimal places
 */
export function computeCost(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const normalized = modelId.toLowerCase().trim();

  // Try exact match first
  let pricing = PRICING[normalized];

  // Partial match — e.g. model IDs with date suffixes not in our table
  if (!pricing) {
    for (const [key, price] of Object.entries(PRICING)) {
      if (normalized.includes(key) || key.includes(normalized)) {
        pricing = price;
        break;
      }
    }
  }

  // Tier fallback
  if (!pricing) {
    if (normalized.includes("haiku")) {
      pricing = TIER_PRICING["low"]!;
    } else if (normalized.includes("opus")) {
      pricing = TIER_PRICING["high"]!;
    } else {
      // Default: sonnet-class pricing
      pricing = TIER_PRICING["medium"]!;
    }
  }

  const raw = pricing.input * inputTokens + pricing.output * outputTokens;
  // Round to 6 decimal places to avoid floating-point noise
  return Math.round(raw * 1_000_000) / 1_000_000;
}

/**
 * Format a USD cost for display.
 * $0.001234 → "$0.001234"
 * $1.23     → "$1.23"
 */
export function formatCost(usd: number): string {
  if (usd === 0) return "$0.00";
  if (usd < 0.001) return `$${usd.toFixed(6)}`;
  if (usd < 0.01)  return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}
