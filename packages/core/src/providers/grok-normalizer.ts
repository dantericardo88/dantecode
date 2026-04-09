// ============================================================================
// @dantecode/core — Grok Tool Call Normalizer (M7)
// Repairs malformed JSON in streaming tool calls from Grok models.
// Fixes "trailing comma" and "unterminated string" errors in early streaming chunks.
// ============================================================================

/** Capability flags for Grok models */
export interface GrokModelCapabilities {
  supportsStreaming: boolean;
  supportsToolCalls: boolean;
  supportsParallelToolCalls: boolean;
  supportsStructuredOutput: boolean;
  maxToolCallsPerTurn: number;
  requiresToolCallNormalization: boolean;
}

/**
 * Normalizes tool call arguments from Grok models.
 * Grok sometimes emits malformed JSON during streaming (e.g., missing closing braces
 * or illegal characters in JSON).
 */
export function normalizeGrokToolCall(rawArgs: string): string {
  if (!rawArgs) return "{}";
  let processed = rawArgs.trim();

  // Fix 1: Trailing commas in objects/arrays
  processed = processed.replace(/,([\]}])/g, "$1");

  // Fix 2: Unbalanced braces/brackets (common in truncated streams)
  const openBraces = (processed.match(/\{/g) || []).length;
  const closeBraces = (processed.match(/\}/g) || []).length;
  if (openBraces > closeBraces) {
    processed += "}".repeat(openBraces - closeBraces);
  }

  const openBrackets = (processed.match(/\[/g) || []).length;
  const closeBrackets = (processed.match(/\]/g) || []).length;
  if (openBrackets > closeBrackets) {
    processed += "]".repeat(openBrackets - closeBrackets);
  }

  // Fix 3: Handle raw-string responses that should be JSON
  if (!processed.startsWith("{") && !processed.startsWith("[")) {
    // If it looks like a single argument string, wrap it
    if (processed.includes(":")) {
      processed = `{${processed}}`;
    }
  }

  return processed;
}

/**
 * Repairs a malformed JSON payload from Grok.
 */
export function repairMalformedJson(payload: string): string {
  try {
    JSON.parse(payload);
    return payload; // Already valid
  } catch {
    // Attempt standard repairs
    let repaired = payload.trim();
    
    // Unterminated string repair
    const quoteCount = (repaired.match(/"/g) || []).length;
    if (quoteCount % 2 !== 0) {
      repaired += '"';
    }

    // Unbalanced brackets repair
    const openBraces = (repaired.match(/\{/g) || []).length;
    const closeBraces = (repaired.match(/\}/g) || []).length;
    if (openBraces > closeBraces) {
      repaired += "}".repeat(openBraces - closeBraces);
    }

    return repaired;
  }
}
