import { describe, expect, it } from "vitest";
import {
  INVALID_TOOL_NAME,
  detectRepeatedToolCall,
  normalizeToolCalls,
  stableToolCallSignature,
} from "./tool-call-normalization.js";

describe("tool-call normalization", () => {
  it("repairs tool names by case-insensitive canonical match", () => {
    const result = normalizeToolCalls(
      [{ id: "1", name: "bash", input: { command: "npm test" } }],
      ["Read", "Bash"],
    );

    expect(result.toolCalls).toEqual([
      { id: "1", name: "Bash", input: { command: "npm test" } },
    ]);
    expect(result.repairs).toEqual([{ from: "bash", to: "Bash" }]);
    expect(result.invalidToolCalls).toEqual([]);
  });

  it("routes unknown tool names to the invalid sentinel", () => {
    const result = normalizeToolCalls(
      [{ id: "1", name: "Shell", input: { command: "npm test" } }],
      ["Read", "Bash"],
    );

    expect(result.toolCalls).toEqual([
      {
        id: "1",
        name: INVALID_TOOL_NAME,
        input: {
          tool: "Shell",
          error: 'Unknown tool "Shell". Available tools: Read, Bash',
        },
      },
    ]);
    expect(result.invalidToolCalls).toEqual([
      { tool: "Shell", error: 'Unknown tool "Shell". Available tools: Read, Bash' },
    ]);
  });

  it("uses stable signatures for repeated tool-call detection", () => {
    const first = stableToolCallSignature("Bash", { b: 2, a: 1 });
    const second = stableToolCallSignature("Bash", { a: 1, b: 2 });

    expect(first).toBe(second);
    expect(
      detectRepeatedToolCall([
        { name: "Bash", input: { a: 1, b: 2 } },
        { name: "Bash", input: { b: 2, a: 1 } },
        { name: "Bash", input: { a: 1, b: 2 } },
      ]),
    ).toEqual({ name: "Bash", input: { a: 1, b: 2 }, count: 3 });
  });
});
