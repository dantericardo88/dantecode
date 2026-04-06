import { describe, expect, it, vi } from "vitest";
import { persistSessionEnd } from "./session-manager.js";
import type { PersistSessionEndContext } from "./session-manager.js";

// ---------------------------------------------------------------------------
// Minimal mock factory helpers
// ---------------------------------------------------------------------------

function makeMockPersistentMemory(entryCount: number) {
  return {
    size: vi.fn().mockReturnValue(entryCount),
    store: vi.fn().mockResolvedValue({}),
    distill: vi.fn().mockResolvedValue({ kept: entryCount - 10, removed: 0, distilled: 10 }),
    save: vi.fn().mockResolvedValue(undefined),
  };
}

function makeMinimalContext(
  overrides: Partial<PersistSessionEndContext> = {},
): PersistSessionEndContext {
  return {
    durableRunStore: {
      completeRun: vi.fn().mockResolvedValue(undefined),
    } as unknown as PersistSessionEndContext["durableRunStore"],
    durableRun: { id: "run-1" },
    session: {
      id: "session-1",
      projectRoot: "/tmp/test",
      messages: [],
      activeFiles: [],
      readOnlyFiles: [],
      model: {
        provider: "openai",
        modelId: "test-model",
        maxTokens: 4096,
        temperature: 0.1,
        contextWindow: 131072,
        supportsVision: false,
        supportsToolCalls: true,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      agentStack: [],
      todoList: [],
    },
    touchedFiles: ["src/foo.ts"],
    lastConfirmedStep: "step-1",
    lastSuccessfulTool: undefined,
    evidenceLedger: [],
    localSandboxBridge: null,
    filesModified: 1,
    durablePrompt: "Fix the bug in foo.ts",
    sessionPersistentMemory: makeMockPersistentMemory(0) as unknown as PersistSessionEndContext["sessionPersistentMemory"],
    autonomyEngine: {
      save: vi.fn().mockResolvedValue(undefined),
    } as unknown as PersistSessionEndContext["autonomyEngine"],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("persistSessionEnd — MemoryConsolidation gate", () => {
  it("calls distill() and save() when entry count exceeds 100", async () => {
    const memory = makeMockPersistentMemory(101);
    const ctx = makeMinimalContext({
      sessionPersistentMemory: memory as unknown as PersistSessionEndContext["sessionPersistentMemory"],
    });

    await persistSessionEnd(ctx);

    expect(memory.distill).toHaveBeenCalledOnce();
    expect(memory.save).toHaveBeenCalledOnce();
  });

  it("calls distill() when entry count is exactly 101", async () => {
    const memory = makeMockPersistentMemory(101);
    const ctx = makeMinimalContext({
      sessionPersistentMemory: memory as unknown as PersistSessionEndContext["sessionPersistentMemory"],
    });

    await persistSessionEnd(ctx);

    expect(memory.distill).toHaveBeenCalledOnce();
  });

  it("does NOT call distill() when entry count is 50", async () => {
    const memory = makeMockPersistentMemory(50);
    const ctx = makeMinimalContext({
      sessionPersistentMemory: memory as unknown as PersistSessionEndContext["sessionPersistentMemory"],
    });

    await persistSessionEnd(ctx);

    expect(memory.distill).not.toHaveBeenCalled();
    expect(memory.save).not.toHaveBeenCalled();
  });

  it("does NOT call distill() when entry count is exactly 100", async () => {
    const memory = makeMockPersistentMemory(100);
    const ctx = makeMinimalContext({
      sessionPersistentMemory: memory as unknown as PersistSessionEndContext["sessionPersistentMemory"],
    });

    await persistSessionEnd(ctx);

    expect(memory.distill).not.toHaveBeenCalled();
  });

  it("does NOT call distill() when entry count is 0", async () => {
    const memory = makeMockPersistentMemory(0);
    const ctx = makeMinimalContext({
      sessionPersistentMemory: memory as unknown as PersistSessionEndContext["sessionPersistentMemory"],
    });

    await persistSessionEnd(ctx);

    expect(memory.distill).not.toHaveBeenCalled();
  });

  it("does not throw when distill() rejects (non-fatal)", async () => {
    const memory = makeMockPersistentMemory(200);
    memory.distill.mockRejectedValue(new Error("disk full"));
    const ctx = makeMinimalContext({
      sessionPersistentMemory: memory as unknown as PersistSessionEndContext["sessionPersistentMemory"],
    });

    // Should not throw
    await expect(persistSessionEnd(ctx)).resolves.toBeUndefined();
  });
});

describe("persistSessionEnd — memory store gate", () => {
  it("stores a memory summary when files were modified", async () => {
    const memory = makeMockPersistentMemory(5);
    const ctx = makeMinimalContext({
      filesModified: 3,
      touchedFiles: ["a.ts", "b.ts"],
      durablePrompt: "Refactor the auth module",
      sessionPersistentMemory: memory as unknown as PersistSessionEndContext["sessionPersistentMemory"],
    });

    await persistSessionEnd(ctx);

    expect(memory.store).toHaveBeenCalledOnce();
    const [summary, category] = memory.store.mock.calls[0]!;
    expect(summary).toContain("session-1");
    expect(summary).toContain("Files modified: 3");
    expect(category).toBe("context");
  });

  it("skips memory store when no files were modified or touched", async () => {
    const memory = makeMockPersistentMemory(0);
    const ctx = makeMinimalContext({
      filesModified: 0,
      touchedFiles: [],
      sessionPersistentMemory: memory as unknown as PersistSessionEndContext["sessionPersistentMemory"],
    });

    await persistSessionEnd(ctx);

    expect(memory.store).not.toHaveBeenCalled();
  });
});
