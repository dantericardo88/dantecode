// ============================================================================
// @dantecode/core - Structured Tool-Call Normalization
// ============================================================================

export const INVALID_TOOL_NAME = "InvalidTool";

export interface NormalizableToolCall {
  id?: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolNameRepair {
  from: string;
  to: string;
}

export interface InvalidToolCall {
  tool: string;
  error: string;
}

export interface NormalizeToolCallsResult<T extends NormalizableToolCall = NormalizableToolCall> {
  toolCalls: T[];
  repairs: ToolNameRepair[];
  invalidToolCalls: InvalidToolCall[];
}

export interface RepeatedToolCall {
  name: string;
  input: Record<string, unknown>;
  count: number;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function stableToolCallSignature(name: string, input: Record<string, unknown>): string {
  return `${name}:${stableStringify(input)}`;
}

export function normalizeToolCalls<T extends NormalizableToolCall>(
  toolCalls: T[],
  allowedToolNames: Iterable<string>,
): NormalizeToolCallsResult<T> {
  const allowed = [...allowedToolNames];
  const byLowercase = new Map(allowed.map((name) => [name.toLowerCase(), name]));
  const repairs: ToolNameRepair[] = [];
  const invalidToolCalls: InvalidToolCall[] = [];

  const normalized = toolCalls.map((toolCall) => {
    if (allowed.includes(toolCall.name)) {
      return toolCall;
    }

    const repaired = byLowercase.get(toolCall.name.toLowerCase());
    if (repaired) {
      repairs.push({ from: toolCall.name, to: repaired });
      return { ...toolCall, name: repaired };
    }

    const error = `Unknown tool "${toolCall.name}". Available tools: ${allowed.join(", ")}`;
    invalidToolCalls.push({ tool: toolCall.name, error });
    return {
      ...toolCall,
      name: INVALID_TOOL_NAME,
      input: {
        tool: toolCall.name,
        error,
      },
    };
  });

  return {
    toolCalls: normalized,
    repairs,
    invalidToolCalls,
  };
}

export function detectRepeatedToolCall(
  recentCalls: Array<{ name: string; input: Record<string, unknown> }>,
  threshold = 3,
): RepeatedToolCall | null {
  if (recentCalls.length < threshold) {
    return null;
  }

  const window = recentCalls.slice(-threshold);
  const first = window[0];
  if (!first) {
    return null;
  }

  const signature = stableToolCallSignature(first.name, first.input);
  if (window.every((call) => stableToolCallSignature(call.name, call.input) === signature)) {
    return { name: first.name, input: first.input, count: threshold };
  }
  return null;
}
