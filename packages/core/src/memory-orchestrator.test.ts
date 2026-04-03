import { describe, it, expect, vi } from "vitest";
import { MemoryOrchestrator } from "./memory-orchestrator.js";
import type { ModelRouterImpl } from "./model-router.js";
import type { AutonomyEngine } from "./autonomy-engine.js";
import type { EventSourcedCheckpointer } from "./checkpointer.js";

describe("MemoryOrchestrator", () => {
  it("can record a memory and sync to checkpointer", async () => {
    const mockRouter = {
      generate: vi
        .fn()
        .mockResolvedValue('{"summary":"test sum","entities":["E1"],"category":"fact"}'),
    } as unknown as ModelRouterImpl;

    const mockAutonomy = {
      listGoals: vi.fn().mockReturnValue([]),
    } as unknown as AutonomyEngine;

    const mockCheckpointer = {
      putWrite: vi.fn().mockResolvedValue(undefined),
    } as unknown as EventSourcedCheckpointer;

    const orchestrator = new MemoryOrchestrator(
      { projectRoot: "/mock/root", sessionId: "session-123" },
      mockRouter,
      mockAutonomy,
      mockCheckpointer,
    );

    // Mock the PersistentMemory dependency internally for pure unit testing
    orchestrator.persistentMemory.store = vi.fn().mockResolvedValue({ id: "mem-1" });

    const entry = await orchestrator.recordMemory("Found a new fact", true);

    expect(entry.id).toBe("mem-1");
    expect(mockCheckpointer.putWrite).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "memory_sync",
        taskId: "memory-orchestrator",
      }),
    );
  });
});
