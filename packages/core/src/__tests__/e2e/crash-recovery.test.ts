// ============================================================================
// E2E: Crash Recovery — start -> checkpoint -> simulate crash -> recover -> verify
// ============================================================================

import { describe, it, expect, beforeEach } from "vitest";
import { DurableExecution } from "../../durable-execution.js";

describe("E2E: Crash Recovery", () => {
  let exec: DurableExecution;

  beforeEach(() => {
    exec = new DurableExecution();
  });

  it("recovers execution state after simulated crash", () => {
    // Step 1: Start task and accumulate state
    exec.checkpoint({
      stepNumber: 1,
      currentTask: "parse input",
      partialOutput: ["Parsed file A"],
      memoryState: { parsed: ["a.ts"] },
      toolCallHistory: [
        { tool: "Read", timestamp: Date.now(), success: true },
      ],
    });

    exec.checkpoint({
      stepNumber: 2,
      currentTask: "generate code",
      partialOutput: ["Parsed file A", "Generated code for A"],
      memoryState: { parsed: ["a.ts"], generated: ["a.ts"] },
      toolCallHistory: [
        { tool: "Read", timestamp: Date.now(), success: true },
        { tool: "Write", timestamp: Date.now(), success: true },
      ],
    });

    // Step 2: Simulate crash — we lose runtime state but checkpoints survive
    // (In a real scenario, checkpoints would be on disk)

    // Step 3: Recover from last checkpoint
    const recovered = exec.getLastCheckpoint();
    expect(recovered).not.toBeNull();
    expect(recovered!.stepNumber).toBe(2);
    expect(recovered!.currentTask).toBe("generate code");
    expect(recovered!.partialOutput).toEqual(["Parsed file A", "Generated code for A"]);
    expect(recovered!.toolCallHistory).toHaveLength(2);
  });

  it("recovers from a specific checkpoint ID", () => {
    const cp1 = exec.checkpoint({
      stepNumber: 1,
      currentTask: "step 1",
      partialOutput: ["output 1"],
      memoryState: { step: 1 },
      toolCallHistory: [],
    });

    exec.checkpoint({
      stepNumber: 2,
      currentTask: "step 2 (corrupted)",
      partialOutput: ["output 1", "corrupted output"],
      memoryState: { step: 2, error: true },
      toolCallHistory: [],
    });

    // Recover from first checkpoint (step 2 was corrupted)
    const recovered = exec.recover(cp1);
    expect(recovered).not.toBeNull();
    expect(recovered!.stepNumber).toBe(1);
    expect(recovered!.currentTask).toBe("step 1");

    // Verify we can continue from the recovered state
    const newId = exec.checkpoint({
      stepNumber: 2,
      currentTask: "step 2 (retry)",
      partialOutput: [...recovered!.partialOutput, "corrected output"],
      memoryState: { step: 2, retried: true },
      toolCallHistory: recovered!.toolCallHistory,
    });

    const final = exec.recover(newId);
    expect(final!.currentTask).toBe("step 2 (retry)");
    expect(final!.memoryState).toEqual({ step: 2, retried: true });
  });

  it("checkpoints at configured intervals during execution", () => {
    const stepsExecuted: number[] = [];
    const checkpointIds: string[] = [];

    // Simulate 12 steps with checkpoint every 3
    for (let step = 1; step <= 12; step++) {
      stepsExecuted.push(step);

      if (exec.shouldCheckpoint(step, 3)) {
        const id = exec.checkpoint({
          stepNumber: step,
          currentTask: `step ${step}`,
          partialOutput: stepsExecuted.map((s) => `output-${s}`),
          memoryState: { lastStep: step },
          toolCallHistory: [],
        });
        checkpointIds.push(id);
      }
    }

    // Should have 4 checkpoints (at steps 3, 6, 9, 12)
    expect(checkpointIds).toHaveLength(4);
    expect(exec.size()).toBe(4);

    // Last checkpoint should have all 12 outputs
    const last = exec.getLastCheckpoint();
    expect(last!.stepNumber).toBe(12);
    expect(last!.partialOutput).toHaveLength(12);
  });

  it("cleans up old checkpoints to prevent memory leaks", () => {
    const realNow = Date.now;
    const baseTime = 1_700_000_000_000;

    // Create 5 checkpoints at different times
    for (let i = 0; i < 5; i++) {
      Date.now = () => baseTime + i * 10_000; // 10 seconds apart
      exec.checkpoint({
        stepNumber: i + 1,
        currentTask: `task-${i + 1}`,
        partialOutput: [],
        memoryState: {},
        toolCallHistory: [],
      });
    }

    expect(exec.size()).toBe(5);

    // Cleanup checkpoints older than 25 seconds (from perspective of last checkpoint)
    Date.now = () => baseTime + 40_000;
    const deleted = exec.cleanup(25_000);

    Date.now = realNow;

    // Checkpoints at 0, 10000 should be deleted (age > 25000 from 40000)
    // Checkpoints at 20000, 30000, 40000 should survive
    expect(deleted).toBe(2);
    expect(exec.size()).toBe(3);

    // Last checkpoint should still be accessible
    const last = exec.getLastCheckpoint();
    expect(last).not.toBeNull();
    expect(last!.currentTask).toBe("task-5");
  });
});
