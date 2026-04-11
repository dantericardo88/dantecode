// ============================================================================
// @dantecode/core — Provider Tool Call Normalization
// ============================================================================

/**
 * Normalizes tool call payloads from different providers into a canonical format.
 * Handles streaming fragments, malformed arguments, and provider-specific quirks.
 */

/**
 * Represents a normalized tool call after provider-specific processing.
 */
export interface NormalizedToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/**
 * Normalizes a tool call from a provider response.
 * Assembles fragments, repairs malformed payloads, and standardizes format.
 */
export function normalizeToolCall(raw: unknown, provider: string): NormalizedToolCall | null {
  // Handle different provider formats
  if (provider === "grok" || provider === "xai") {
    return normalizeGrokToolCall(raw);
  }
  if (provider === "anthropic") {
    return normalizeAnthropicToolCall(raw);
  }
  if (provider === "openai") {
    return normalizeOpenAIToolCall(raw);
  }

  // Fallback: assume already normalized
  if (isNormalizedToolCall(raw)) {
    return raw as NormalizedToolCall;
  }

  return null;
}

/**
 * Normalizes Grok/xAI tool calls, which may come in streaming fragments.
 */
function normalizeGrokToolCall(raw: unknown): NormalizedToolCall | null {
  if (typeof raw !== "object" || raw === null) return null;

  const obj = raw as Record<string, unknown>;

  // Handle streaming fragments: if partial, return null to wait for complete
  if (obj.partial === true) return null;

  // Assemble fragments if present
  const fragments = obj.fragments as unknown[];
  if (fragments) {
    const assembled = assembleFragments(fragments);
    return normalizeGrokToolCall(assembled);
  }

  // Extract name and input
  const name = obj.name as string;
  const input = obj.input as Record<string, unknown>;

  if (!name || !input) return null;

  return {
    id: (obj.id as string) || generateId(),
    name,
    input: repairMalformedArguments(input),
  };
}

/**
 * Normalizes Anthropic tool calls.
 */
function normalizeAnthropicToolCall(raw: unknown): NormalizedToolCall | null {
  // Anthropic uses structured tool calls, so minimal processing needed
  if (isNormalizedToolCall(raw)) {
    return raw as NormalizedToolCall;
  }
  return null;
}

/**
 * Normalizes OpenAI tool calls.
 */
function normalizeOpenAIToolCall(raw: unknown): NormalizedToolCall | null {
  if (typeof raw !== "object" || raw === null) return null;

  const obj = raw as Record<string, unknown>;

  const functionCall = obj.function as Record<string, unknown>;
  if (!functionCall) return null;

  const name = functionCall.name as string;
  const argumentsStr = functionCall.arguments as string;

  if (!name || !argumentsStr) return null;

  let input: Record<string, unknown>;
  try {
    input = JSON.parse(argumentsStr);
  } catch {
    // Malformed JSON: attempt repair
    input = repairMalformedJson(argumentsStr);
  }

  return {
    id: (obj.id as string) || generateId(),
    name,
    input,
  };
}

/**
 * Assembles streaming fragments into a complete tool call.
 */
function assembleFragments(fragments: unknown[]): Record<string, unknown> {
  const assembled: Record<string, unknown> = {};

  for (const fragment of fragments) {
    if (typeof fragment === "object" && fragment !== null) {
      Object.assign(assembled, fragment);
    }
  }

  // Remove partial marker from assembled result
  delete assembled.partial;

  return assembled;
}

/**
 * Repairs malformed tool call arguments.
 */
function repairMalformedArguments(input: Record<string, unknown>): Record<string, unknown> {
  const repaired: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(input)) {
    // Handle common malformations
    if (typeof value === "string") {
      // Try to parse JSON strings
      try {
        repaired[key] = JSON.parse(value);
      } catch {
        repaired[key] = value;
      }
    } else {
      repaired[key] = value;
    }
  }

  return repaired;
}

/**
 * Attempts to repair malformed JSON strings.
 */
function repairMalformedJson(jsonStr: string): Record<string, unknown> {
  // Simple repair: try to fix common issues
  let repaired = jsonStr.trim();

  // Remove trailing commas
  repaired = repaired.replace(/,(\s*[}\]])/g, "$1");

  try {
    return JSON.parse(repaired);
  } catch {
    // If still fails, return empty object
    return {};
  }
}

/**
 * Checks if the raw object is already in normalized format.
 */
function isNormalizedToolCall(raw: unknown): boolean {
  if (typeof raw !== "object" || raw === null) return false;

  const obj = raw as Record<string, unknown>;
  return (
    typeof obj.id === "string" &&
    typeof obj.name === "string" &&
    typeof obj.input === "object" &&
    obj.input !== null
  );
}

/**
 * Generates a unique ID for tool calls that don't have one.
 */
function generateId(): string {
  return `tool-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}
