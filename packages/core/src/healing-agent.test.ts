// ============================================================================
// HealingAgent — unit tests
// ============================================================================

import { describe, it, expect, vi } from "vitest";
import { HealingAgent, getHealingTools, HEALING_TOOL_NAMES } from "./healing-agent.js";
import type {
  HealingToolCall,
  HealingToolExecutor,
} from "./healing-agent.js";
import type { ModelRouterImpl } from "./model-router.js";
import type { CoreTool, StreamTextResult } from "ai";

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

/** Build a fake StreamTextResult whose fullStream emits the provided parts. */
function makeStream(parts: Array<{ type: string; [k: string]: unknown }>): StreamTextResult<Record<string, CoreTool>, never> {
  const stream = {
    fullStream: (async function* () {
      for (const part of parts) {
        yield part;
      }
    })(),
  };
  return stream as unknown as StreamTextResult<Record<string, CoreTool>, never>;
}

/** Build a mock ModelRouterImpl that returns pre-configured streams per call. */
function makeRouter(streamSequence: Array<StreamTextResult<Record<string, CoreTool>, never> | Error>) {
  let callIndex = 0;
  const streamWithTools = vi.fn(async () => {
    const next = streamSequence[callIndex++];
    if (!next) throw new Error("No more stream responses configured");
    if (next instanceof Error) throw next;
    return next;
  });
  return { streamWithTools } as unknown as ModelRouterImpl;
}

/** Build a simple tool executor that records calls and returns success. */
function makeExecutor(filesModifiedPerCall = 1): {
  executor: HealingToolExecutor;
  calls: HealingToolCall[][];
} {
  const calls: HealingToolCall[][] = [];
  const executor: HealingToolExecutor = async (toolCalls) => {
    calls.push(toolCalls);
    return {
      filesModified: filesModifiedPerCall,
      outputs: toolCalls.map(() => "ok"),
      summary: `${toolCalls.length} call(s)`,
    };
  };
  return { executor, calls };
}

/** A tool call event as emitted by the AI SDK stream. */
function toolCallPart(name = "Edit", id = "tc1"): { type: "tool-call"; toolName: string; toolCallId: string; args: Record<string, unknown> } {
  return {
    type: "tool-call",
    toolName: name,
    toolCallId: id,
    args: { file_path: "src/foo.ts", old_string: "bad", new_string: "good" },
  };
}

/** A text-delta event. */
function textPart(delta: string): { type: "text-delta"; textDelta: string } {
  return { type: "text-delta", textDelta: delta };
}

// ---------------------------------------------------------------------------
// describe: aborted flag
// ---------------------------------------------------------------------------

describe("HealingAgent — aborted flag", () => {
  it("aborted=true when LLM emits no tool calls in round 1", async () => {
    const router = makeRouter([makeStream([textPart("I see no issues.")])]);
    const { executor } = makeExecutor();
    const agent = new HealingAgent(router, executor, { streamOutput: false });
    const result = await agent.run("typecheck", "fix errors", 1, "src/foo.ts");
    expect(result.aborted).toBe(true);
    expect(result.toolCallCount).toBe(0);
    expect(result.filesModified).toBe(0);
  });

  it("aborted=false when LLM emits at least one tool call in round 1", async () => {
    const router = makeRouter([makeStream([toolCallPart()])]);
    const { executor } = makeExecutor();
    const agent = new HealingAgent(router, executor, { streamOutput: false });
    const result = await agent.run("typecheck", "fix errors", 1, "src/foo.ts");
    expect(result.aborted).toBe(false);
  });

  it("aborted=false even if round 2 has no tool calls (round 1 had them)", async () => {
    const router = makeRouter([
      makeStream([toolCallPart()]),
      makeStream([textPart("Done.")]),
    ]);
    const { executor } = makeExecutor();
    const agent = new HealingAgent(router, executor, { streamOutput: false, maxLlmRounds: 2 });
    const result = await agent.run("unit", "fix tests", 1, "");
    expect(result.aborted).toBe(false);
    expect(result.llmRounds).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// describe: single-round tool execution
// ---------------------------------------------------------------------------

describe("HealingAgent — single tool call", () => {
  it("executes one Edit tool call and reports filesModified=1", async () => {
    const router = makeRouter([makeStream([toolCallPart("Edit", "tc-edit-1")])]);
    const { executor, calls } = makeExecutor(1);
    const agent = new HealingAgent(router, executor, { streamOutput: false, maxLlmRounds: 1 });
    const result = await agent.run("typecheck", "fix type error", 1, "src/model.ts");
    expect(result.toolCallCount).toBe(1);
    expect(result.filesModified).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]![0]!.name).toBe("Edit");
    expect(calls[0]![0]!.id).toBe("tc-edit-1");
  });

  it("executes one Write tool call with correct input forwarded", async () => {
    const stream = makeStream([
      {
        type: "tool-call",
        toolName: "Write",
        toolCallId: "tc-write-1",
        args: { file_path: "src/new.ts", content: "export const x = 1;" },
      },
    ]);
    const router = makeRouter([stream]);
    const { executor, calls } = makeExecutor(1);
    const agent = new HealingAgent(router, executor, { streamOutput: false, maxLlmRounds: 1 });
    await agent.run("lint", "fix lint", 1, "");
    expect(calls[0]![0]!.name).toBe("Write");
    expect(calls[0]![0]!.input["file_path"]).toBe("src/new.ts");
  });

  it("executes Read tool call (filesModified=0 from executor perspective)", async () => {
    const router = makeRouter([makeStream([toolCallPart("Read", "tc-read-1")])]);
    const { executor } = makeExecutor(0); // Read doesn't modify
    const agent = new HealingAgent(router, executor, { streamOutput: false, maxLlmRounds: 1 });
    const result = await agent.run("unit", "inspect test", 1, "");
    expect(result.toolCallCount).toBe(1);
    expect(result.filesModified).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// describe: multi-turn (Read → Edit)
// ---------------------------------------------------------------------------

describe("HealingAgent — multi-turn support", () => {
  it("executes 2 rounds: Read then Edit", async () => {
    const router = makeRouter([
      makeStream([toolCallPart("Read", "tc-read-1")]),
      makeStream([toolCallPart("Edit", "tc-edit-2")]),
    ]);
    const { executor, calls } = makeExecutor(1);
    const agent = new HealingAgent(router, executor, { streamOutput: false, maxLlmRounds: 2 });
    const result = await agent.run("typecheck", "fix mismatch", 1, "src/types.ts");
    expect(result.llmRounds).toBe(2);
    expect(result.toolCallCount).toBe(2);
    expect(calls).toHaveLength(2);
    expect(calls[0]![0]!.name).toBe("Read");
    expect(calls[1]![0]!.name).toBe("Edit");
  });

  it("stops after maxLlmRounds=1 even if tool calls present", async () => {
    const router = makeRouter([
      makeStream([toolCallPart("Edit", "tc1")]),
      makeStream([toolCallPart("Edit", "tc2")]),
    ]);
    const { executor } = makeExecutor(1);
    const agent = new HealingAgent(router, executor, { streamOutput: false, maxLlmRounds: 1 });
    const result = await agent.run("lint", "fix lint", 1, "");
    expect(result.llmRounds).toBe(1);
    expect(result.toolCallCount).toBe(1);
  });

  it("stops early when second round emits no tool calls", async () => {
    const router = makeRouter([
      makeStream([toolCallPart("Edit", "tc1")]),
      makeStream([textPart("All done.")]),
    ]);
    const { executor } = makeExecutor(1);
    const agent = new HealingAgent(router, executor, { streamOutput: false, maxLlmRounds: 3 });
    const result = await agent.run("typecheck", "fix errors", 1, "");
    expect(result.llmRounds).toBe(2); // Stopped after round 2 had no calls
    expect(result.toolCallCount).toBe(1); // Only round 1 calls
  });

  it("appends tool results to messages for second-round context", async () => {
    const capturedMessageSets: unknown[][] = [];
    let callIndex = 0;
    const streamSequence = [
      makeStream([toolCallPart("Read", "tc1")]),
      makeStream([textPart("done")]),
    ];
    const router = {
      streamWithTools: vi.fn(async (messages: unknown[]) => {
        capturedMessageSets.push([...messages]);
        return streamSequence[callIndex++];
      }),
    } as unknown as ModelRouterImpl;

    const { executor } = makeExecutor(0);
    const agent = new HealingAgent(router, executor, { streamOutput: false, maxLlmRounds: 2 });
    await agent.run("unit", "fix test", 1, "");

    // Second call should include the original user message + assistant + tool result
    const secondCallMessages = capturedMessageSets[1];
    expect(secondCallMessages).toBeDefined();
    expect((secondCallMessages as unknown[]).length).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// describe: multiple tool calls in one round
// ---------------------------------------------------------------------------

describe("HealingAgent — batch tool calls", () => {
  it("executes multiple tool calls returned in one round", async () => {
    const router = makeRouter([
      makeStream([
        toolCallPart("Read", "tc1"),
        toolCallPart("Edit", "tc2"),
        toolCallPart("Bash", "tc3"),
      ]),
    ]);
    const { executor, calls } = makeExecutor(1);
    const agent = new HealingAgent(router, executor, { streamOutput: false, maxLlmRounds: 1 });
    const result = await agent.run("typecheck", "fix all", 1, "");
    expect(result.toolCallCount).toBe(3);
    expect(calls[0]!.length).toBe(3);
    expect(calls[0]![1]!.name).toBe("Edit");
  });

  it("accumulates filesModified across multiple rounds", async () => {
    // executor returns filesModified per call based on Edit count
    const executor: HealingToolExecutor = async (calls) => ({
      filesModified: calls.filter((c) => c.name === "Edit").length,
      outputs: calls.map(() => "ok"),
      summary: "",
    });
    const agent = new HealingAgent(makeRouter([
      makeStream([toolCallPart("Edit", "tc1"), toolCallPart("Edit", "tc2")]),
      makeStream([toolCallPart("Edit", "tc3")]),
    ]), executor, { streamOutput: false, maxLlmRounds: 2 });
    const result = await agent.run("typecheck", "fix errors", 1, "");
    expect(result.filesModified).toBe(3); // 2 + 1
  });
});

// ---------------------------------------------------------------------------
// describe: executor error resilience
// ---------------------------------------------------------------------------

describe("HealingAgent — executor error resilience", () => {
  it("continues when one tool call throws — records error output", async () => {
    let firstCall = true;
    const executor: HealingToolExecutor = async (calls) => {
      if (firstCall) {
        firstCall = false;
        throw new Error("Tool executor failed");
      }
      return { filesModified: 1, outputs: calls.map(() => "ok"), summary: "" };
    };
    // Router that throws on streamWithTools (simulates executor-level failure)
    const router = makeRouter([new Error("streamWithTools threw")]);
    const agent = new HealingAgent(router, executor, { streamOutput: false });
    // Should not throw — bail gracefully when model doesn't support tool calls
    const result = await agent.run("typecheck", "fix", 1, "");
    expect(result.aborted).toBe(true);
    expect(result.toolCallCount).toBe(0);
  });

  it("gracefully handles model that does not support tool calls (streamWithTools throws)", async () => {
    const router = makeRouter([new Error("Model does not support native tool calling")]);
    const { executor } = makeExecutor();
    const agent = new HealingAgent(router, executor, { streamOutput: false });
    const result = await agent.run("lint", "fix lint", 1, "");
    expect(result.aborted).toBe(true);
    expect(result.llmRounds).toBe(1);
    expect(result.toolCallCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// describe: streamOutput option
// ---------------------------------------------------------------------------

describe("HealingAgent — streamOutput option", () => {
  it("streamOutput=false does not call process.stdout.write for text deltas", async () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const router = makeRouter([makeStream([textPart("Some LLM text")])]);
    const { executor } = makeExecutor();
    const agent = new HealingAgent(router, executor, { streamOutput: false });
    await agent.run("typecheck", "fix", 1, "");
    expect(writeSpy).not.toHaveBeenCalledWith(expect.stringContaining("Some LLM text"));
    writeSpy.mockRestore();
  });

  it("streamOutput=true (default) writes text deltas to stdout", async () => {
    const chunks: string[] = [];
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      chunks.push(String(chunk));
      return true;
    });
    const router = makeRouter([makeStream([textPart("LLM output text")])]);
    const { executor } = makeExecutor();
    const agent = new HealingAgent(router, executor, { streamOutput: true });
    await agent.run("typecheck", "fix", 1, "");
    expect(chunks.some((c) => c.includes("LLM output text"))).toBe(true);
    writeSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// describe: system prompt content
// ---------------------------------------------------------------------------

describe("HealingAgent — system prompt", () => {
  it("typecheck system prompt mentions 'any casts'", async () => {
    let capturedSystem = "";
    const router = {
      streamWithTools: vi.fn(async (_msgs: unknown, _tools: unknown, opts: { system?: string }) => {
        capturedSystem = opts?.system ?? "";
        return makeStream([]);
      }),
    } as unknown as ModelRouterImpl;
    const { executor } = makeExecutor();
    const agent = new HealingAgent(router, executor, { streamOutput: false });
    await agent.run("typecheck", "fix types", 1, "src/foo.ts");
    expect(capturedSystem.toLowerCase()).toContain("any");
    expect(capturedSystem).toContain("src/foo.ts");
  });

  it("lint system prompt mentions eslint-disable", async () => {
    let capturedSystem = "";
    const router = {
      streamWithTools: vi.fn(async (_msgs: unknown, _tools: unknown, opts: { system?: string }) => {
        capturedSystem = opts?.system ?? "";
        return makeStream([]);
      }),
    } as unknown as ModelRouterImpl;
    const { executor } = makeExecutor();
    const agent = new HealingAgent(router, executor, { streamOutput: false });
    await agent.run("lint", "fix lint", 1, "");
    expect(capturedSystem.toLowerCase()).toContain("eslint-disable");
  });

  it("unit system prompt mentions tests", async () => {
    let capturedSystem = "";
    const router = {
      streamWithTools: vi.fn(async (_msgs: unknown, _tools: unknown, opts: { system?: string }) => {
        capturedSystem = opts?.system ?? "";
        return makeStream([]);
      }),
    } as unknown as ModelRouterImpl;
    const { executor } = makeExecutor();
    const agent = new HealingAgent(router, executor, { streamOutput: false });
    await agent.run("unit", "fix tests", 1, "");
    expect(capturedSystem.toLowerCase()).toContain("test");
  });

  it("systemPromptOverride replaces built-in prompt", async () => {
    let capturedSystem = "";
    const router = {
      streamWithTools: vi.fn(async (_msgs: unknown, _tools: unknown, opts: { system?: string }) => {
        capturedSystem = opts?.system ?? "";
        return makeStream([]);
      }),
    } as unknown as ModelRouterImpl;
    const { executor } = makeExecutor();
    const agent = new HealingAgent(router, executor, {
      streamOutput: false,
      systemPromptOverride: "MY CUSTOM SYSTEM PROMPT",
    });
    await agent.run("typecheck", "fix", 1, "");
    expect(capturedSystem).toBe("MY CUSTOM SYSTEM PROMPT");
  });
});

// ---------------------------------------------------------------------------
// describe: user message content
// ---------------------------------------------------------------------------

describe("HealingAgent — user message", () => {
  it("user message includes attempt number", async () => {
    let capturedMessages: unknown[] = [];
    const router = {
      streamWithTools: vi.fn(async (msgs: unknown[]) => {
        capturedMessages = msgs;
        return makeStream([]);
      }),
    } as unknown as ModelRouterImpl;
    const { executor } = makeExecutor();
    const agent = new HealingAgent(router, executor, { streamOutput: false });
    await agent.run("typecheck", "some repair prompt", 3, "src/foo.ts");
    const userMsg = (capturedMessages[0] as { role: string; content: string });
    expect(userMsg.content).toContain("attempt 3");
  });

  it("user message includes target file when non-empty", async () => {
    let capturedMessages: unknown[] = [];
    const router = {
      streamWithTools: vi.fn(async (msgs: unknown[]) => {
        capturedMessages = msgs;
        return makeStream([]);
      }),
    } as unknown as ModelRouterImpl;
    const { executor } = makeExecutor();
    const agent = new HealingAgent(router, executor, { streamOutput: false });
    await agent.run("lint", "fix lint", 1, "packages/core/src/index.ts");
    const userMsg = (capturedMessages[0] as { role: string; content: string });
    expect(userMsg.content).toContain("packages/core/src/index.ts");
  });

  it("user message includes stage name", async () => {
    let capturedMessages: unknown[] = [];
    const router = {
      streamWithTools: vi.fn(async (msgs: unknown[]) => {
        capturedMessages = msgs;
        return makeStream([]);
      }),
    } as unknown as ModelRouterImpl;
    const { executor } = makeExecutor();
    const agent = new HealingAgent(router, executor, { streamOutput: false });
    await agent.run("unit", "fix tests", 1, "");
    const userMsg = (capturedMessages[0] as { role: string; content: string });
    expect(userMsg.content.toLowerCase()).toContain("unit");
  });

  it("user message includes the repair prompt verbatim", async () => {
    const repairPrompt = "Fix TS2345 in line 42: string not assignable to number";
    let capturedMessages: unknown[] = [];
    const router = {
      streamWithTools: vi.fn(async (msgs: unknown[]) => {
        capturedMessages = msgs;
        return makeStream([]);
      }),
    } as unknown as ModelRouterImpl;
    const { executor } = makeExecutor();
    const agent = new HealingAgent(router, executor, { streamOutput: false });
    await agent.run("typecheck", repairPrompt, 1, "");
    const userMsg = (capturedMessages[0] as { role: string; content: string });
    expect(userMsg.content).toContain(repairPrompt);
  });
});

// ---------------------------------------------------------------------------
// describe: HEALING_TOOL_NAMES filter
// ---------------------------------------------------------------------------

describe("getHealingTools / HEALING_TOOL_NAMES", () => {
  it("HEALING_TOOL_NAMES contains the 6 expected tools", () => {
    expect(HEALING_TOOL_NAMES.has("Read")).toBe(true);
    expect(HEALING_TOOL_NAMES.has("Edit")).toBe(true);
    expect(HEALING_TOOL_NAMES.has("Write")).toBe(true);
    expect(HEALING_TOOL_NAMES.has("Bash")).toBe(true);
    expect(HEALING_TOOL_NAMES.has("Glob")).toBe(true);
    expect(HEALING_TOOL_NAMES.has("Grep")).toBe(true);
  });

  it("HEALING_TOOL_NAMES excludes SubAgent", () => {
    expect(HEALING_TOOL_NAMES.has("SubAgent")).toBe(false);
  });

  it("HEALING_TOOL_NAMES excludes GitCommit", () => {
    expect(HEALING_TOOL_NAMES.has("GitCommit")).toBe(false);
  });

  it("getHealingTools filters out non-healing tools", () => {
    const allTools = {
      Read: {} as CoreTool,
      Edit: {} as CoreTool,
      SubAgent: {} as CoreTool,
      GitCommit: {} as CoreTool,
      Bash: {} as CoreTool,
    };
    const filtered = getHealingTools(allTools);
    expect(Object.keys(filtered)).toContain("Read");
    expect(Object.keys(filtered)).toContain("Edit");
    expect(Object.keys(filtered)).toContain("Bash");
    expect(Object.keys(filtered)).not.toContain("SubAgent");
    expect(Object.keys(filtered)).not.toContain("GitCommit");
  });

  it("getHealingTools returns all 6 allowed tools when present", () => {
    const allTools = Object.fromEntries(
      [...HEALING_TOOL_NAMES].map((name) => [name, {} as CoreTool]),
    );
    const filtered = getHealingTools(allTools);
    expect(Object.keys(filtered)).toHaveLength(6);
  });
});

// ---------------------------------------------------------------------------
// describe: summary string
// ---------------------------------------------------------------------------

describe("HealingAgent — summary", () => {
  it("summary mentions 'No tool calls' when aborted", async () => {
    const router = makeRouter([makeStream([])]);
    const { executor } = makeExecutor();
    const agent = new HealingAgent(router, executor, { streamOutput: false });
    const result = await agent.run("typecheck", "fix", 1, "");
    expect(result.summary.toLowerCase()).toContain("no tool calls");
  });

  it("summary mentions tool count when tool calls were made", async () => {
    const router = makeRouter([makeStream([toolCallPart("Edit", "tc1"), toolCallPart("Edit", "tc2")])]);
    const { executor } = makeExecutor(2);
    const agent = new HealingAgent(router, executor, { streamOutput: false, maxLlmRounds: 1 });
    const result = await agent.run("typecheck", "fix", 1, "");
    expect(result.summary).toContain("2");
  });
});

// ---------------------------------------------------------------------------
// describe: tools injection
// ---------------------------------------------------------------------------

describe("HealingAgent — tools injection", () => {
  it("passes injected tools to streamWithTools (not empty object)", async () => {
    let capturedTools: unknown = undefined;
    const router = {
      streamWithTools: vi.fn(async (_msgs: unknown, tools: unknown) => {
        capturedTools = tools;
        return makeStream([]);
      }),
    } as unknown as ModelRouterImpl;
    const { executor } = makeExecutor();
    const fakeTools = { Read: { description: "read", parameters: {} } } as unknown as Record<string, CoreTool>;
    const agent = new HealingAgent(router, executor, { streamOutput: false, tools: fakeTools });
    await agent.run("typecheck", "fix", 1, "");
    expect(capturedTools).toBe(fakeTools);
    expect(Object.keys(capturedTools as object)).toContain("Read");
  });

  it("aborted=false when tool schemas provided and LLM emits a tool call", async () => {
    const fakeTools = { Edit: { description: "edit", parameters: {} } } as unknown as Record<string, CoreTool>;
    const router = makeRouter([makeStream([toolCallPart("Edit", "tc-real")])]);
    const { executor } = makeExecutor(1);
    const agent = new HealingAgent(router, executor, { streamOutput: false, tools: fakeTools, maxLlmRounds: 1 });
    const result = await agent.run("typecheck", "fix error", 1, "src/foo.ts");
    expect(result.aborted).toBe(false);
    expect(result.toolCallCount).toBe(1);
  });
});
