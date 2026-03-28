/**
 * test-repair.test.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  runTestRepair,
  formatTestFailures,
  type TestConfig,
  type TestFailure,
} from "./test-repair.js";
import type { EventEngine } from "../event-engine.js";

describe("runTestRepair", () => {
  let mockEventEngine: EventEngine;
  let emittedEvents: any[];

  beforeEach(() => {
    emittedEvents = [];
    mockEventEngine = {
      emit: vi.fn(async (event) => {
        emittedEvents.push(event);
      }),
    } as any;
  });

  describe("test execution", () => {
    it("should run tests and detect no failures", async () => {
      const mockExec = vi.fn(() => Buffer.from("All tests passed"));

      const config: TestConfig = {
        command: "npm test",
        maxRetries: 3,
        runBeforeMutations: false,
      };

      const result = await runTestRepair({
        config,
        projectRoot: "/test",
        eventEngine: mockEventEngine,
        execFn: mockExec,
      });

      expect(result.success).toBe(true);
      expect(result.failures).toHaveLength(0);
      expect(result.newFailures).toHaveLength(0);
      expect(mockExec).toHaveBeenCalledTimes(1);
    });

    it("should run tests and detect failures", async () => {
      const testOutput = `
FAIL src/example.test.ts > should work
  Error: expected 1 to be 2
    at /path/to/example.test.ts:10:5
`;

      const mockExec = vi.fn(() => {
        const error: any = new Error("Tests failed");
        error.stdout = Buffer.from(testOutput);
        throw error;
      });

      const config: TestConfig = {
        command: "npm test",
        maxRetries: 3,
        runBeforeMutations: false,
      };

      const result = await runTestRepair({
        config,
        projectRoot: "/test",
        eventEngine: mockEventEngine,
        execFn: mockExec,
      });

      expect(result.success).toBe(false);
      expect(result.failures).toHaveLength(1);
      expect(result.newFailures).toHaveLength(1);
      expect(result.newFailures[0]!.testName).toBe("should work");
    });

    it("should run baseline tests when configured", async () => {
      let callCount = 0;
      const mockExec = vi.fn(() => {
        callCount++;
        if (callCount === 1) {
          // Baseline - no failures
          return Buffer.from("All tests passed");
        } else {
          // After mutations - 1 failure
          const error: any = new Error("Tests failed");
          error.stdout = Buffer.from("FAIL src/test.ts > new failure\n  Error: new error");
          throw error;
        }
      });

      const config: TestConfig = {
        command: "npm test",
        maxRetries: 3,
        runBeforeMutations: true,
      };

      const result = await runTestRepair({
        config,
        projectRoot: "/test",
        eventEngine: mockEventEngine,
        execFn: mockExec,
      });

      expect(mockExec).toHaveBeenCalledTimes(2);
      expect(result.baselineFailures).toHaveLength(0);
      expect(result.newFailures).toHaveLength(1);
    });

    it("should skip baseline when baseline provided", async () => {
      const mockExec = vi.fn(() => {
        const error: any = new Error("Tests failed");
        error.stdout = Buffer.from("FAIL src/test.ts > test\n  Error: error");
        throw error;
      });

      const baselineFailures: TestFailure[] = [];

      const config: TestConfig = {
        command: "npm test",
        maxRetries: 3,
        runBeforeMutations: true,
      };

      const result = await runTestRepair({
        config,
        projectRoot: "/test",
        baselineFailures,
        execFn: mockExec,
      });

      expect(mockExec).toHaveBeenCalledTimes(1); // Only current test, not baseline
      expect(result.baselineFailures).toHaveLength(0);
    });

    it("should handle execution errors gracefully", async () => {
      const mockExec = vi.fn(() => {
        const error: any = new Error("Command failed");
        error.stdout = Buffer.from("FAIL src/test.ts > test\n  Error: test error");
        throw error;
      });

      const config: TestConfig = {
        command: "npm test",
        maxRetries: 3,
        runBeforeMutations: false,
      };

      const result = await runTestRepair({
        config,
        projectRoot: "/test",
        eventEngine: mockEventEngine,
        execFn: mockExec,
      });

      expect(result.success).toBe(false);
      expect(result.failures).toHaveLength(1);
      expect(emittedEvents).toHaveLength(2); // started + completed
    });

    it("should use specified runner", async () => {
      const jestOutput = `
FAIL src/example.test.js
  ● test name

    Error: test error
`;

      const mockExec = vi.fn(() => {
        const error: any = new Error("Tests failed");
        error.stdout = Buffer.from(jestOutput);
        throw error;
      });

      const config: TestConfig = {
        command: "npm test",
        maxRetries: 3,
        runBeforeMutations: false,
        runner: "jest",
      };

      const result = await runTestRepair({
        config,
        projectRoot: "/test",
        execFn: mockExec,
      });

      expect(result.failures).toHaveLength(1);
      expect(result.failures[0]!.testFile).toBe("src/example.test.js");
    });

    it("should pass custom taskId to events", async () => {
      const mockExec = vi.fn(() => Buffer.from("All tests passed"));

      const config: TestConfig = {
        command: "npm test",
        maxRetries: 3,
        runBeforeMutations: false,
      };

      const customTaskId = "12345678-1234-1234-1234-123456789012";

      await runTestRepair({
        config,
        projectRoot: "/test",
        eventEngine: mockEventEngine,
        taskId: customTaskId,
        execFn: mockExec,
      });

      expect(emittedEvents[0]!.taskId).toBe(customTaskId);
      expect(emittedEvents[1]!.taskId).toBe(customTaskId);
    });

    it("should work without event engine", async () => {
      const mockExec = vi.fn(() => Buffer.from("All tests passed"));

      const config: TestConfig = {
        command: "npm test",
        maxRetries: 3,
        runBeforeMutations: false,
      };

      const result = await runTestRepair({
        config,
        projectRoot: "/test",
        execFn: mockExec,
      });

      expect(result.success).toBe(true);
    });
  });

  describe("baseline comparison", () => {
    it("should detect new failures (none in baseline)", async () => {
      let callCount = 0;
      const mockExec = vi.fn(() => {
        callCount++;
        if (callCount === 1) {
          // Baseline - no failures
          return Buffer.from("All tests passed");
        } else {
          // After mutations - 2 failures
          const error: any = new Error("Tests failed");
          error.stdout = Buffer.from(`
FAIL src/a.test.ts > test one
  Error: error one
FAIL src/b.test.ts > test two
  Error: error two
`);
          throw error;
        }
      });

      const config: TestConfig = {
        command: "npm test",
        maxRetries: 3,
        runBeforeMutations: true,
      };

      const result = await runTestRepair({
        config,
        projectRoot: "/test",
        execFn: mockExec,
      });

      expect(result.baselineFailures).toHaveLength(0);
      expect(result.failures).toHaveLength(2);
      expect(result.newFailures).toHaveLength(2);
    });

    it("should detect new failures (some in baseline)", async () => {
      let callCount = 0;
      const mockExec = vi.fn(() => {
        callCount++;
        if (callCount === 1) {
          // Baseline - 1 existing failure
          const error: any = new Error("Tests failed");
          error.stdout = Buffer.from(`
FAIL src/existing.test.ts > existing test
  Error: existing error
`);
          throw error;
        } else {
          // After mutations - 2 failures (1 existing + 1 new)
          const error: any = new Error("Tests failed");
          error.stdout = Buffer.from(`
FAIL src/existing.test.ts > existing test
  Error: existing error
FAIL src/new.test.ts > new test
  Error: new error
`);
          throw error;
        }
      });

      const config: TestConfig = {
        command: "npm test",
        maxRetries: 3,
        runBeforeMutations: true,
      };

      const result = await runTestRepair({
        config,
        projectRoot: "/test",
        execFn: mockExec,
      });

      expect(result.baselineFailures).toHaveLength(1);
      expect(result.failures).toHaveLength(2);
      expect(result.newFailures).toHaveLength(1);
      expect(result.newFailures[0]!.testFile).toBe("src/new.test.ts");
    });

    it("should not report new failures if all are in baseline", async () => {
      let callCount = 0;
      const mockExec = vi.fn(() => {
        callCount++;
        // Both baseline and current have same failures
        const error: any = new Error("Tests failed");
        error.stdout = Buffer.from(`
FAIL src/test.ts > test one
  Error: error one
FAIL src/test.ts > test two
  Error: error two
`);
        throw error;
      });

      const config: TestConfig = {
        command: "npm test",
        maxRetries: 3,
        runBeforeMutations: true,
      };

      const result = await runTestRepair({
        config,
        projectRoot: "/test",
        execFn: mockExec,
      });

      expect(result.baselineFailures).toHaveLength(2);
      expect(result.failures).toHaveLength(2);
      expect(result.newFailures).toHaveLength(0);
      expect(result.success).toBe(true); // No NEW failures
    });

    it("should use provided baseline failures", async () => {
      const mockExec = vi.fn(() => {
        const error: any = new Error("Tests failed");
        error.stdout = Buffer.from(`
FAIL src/existing.test.ts > existing test
  Error: existing error
FAIL src/new.test.ts > new test
  Error: new error
`);
        throw error;
      });

      const baselineFailures: TestFailure[] = [
        {
          testFile: "src/existing.test.ts",
          testName: "existing test",
          error: "existing error",
        },
      ];

      const config: TestConfig = {
        command: "npm test",
        maxRetries: 3,
        runBeforeMutations: true,
      };

      const result = await runTestRepair({
        config,
        projectRoot: "/test",
        baselineFailures,
        execFn: mockExec,
      });

      expect(result.baselineFailures).toHaveLength(1);
      expect(result.newFailures).toHaveLength(1);
      expect(result.newFailures[0]!.testFile).toBe("src/new.test.ts");
    });

    it("should handle all tests passing after baseline failures", async () => {
      let callCount = 0;
      const mockExec = vi.fn(() => {
        callCount++;
        if (callCount === 1) {
          // Baseline - 1 failure
          const error: any = new Error("Tests failed");
          error.stdout = Buffer.from(`
FAIL src/test.ts > test
  Error: error
`);
          throw error;
        } else {
          // After mutations - all pass (baseline failure fixed!)
          return Buffer.from("All tests passed");
        }
      });

      const config: TestConfig = {
        command: "npm test",
        maxRetries: 3,
        runBeforeMutations: true,
      };

      const result = await runTestRepair({
        config,
        projectRoot: "/test",
        execFn: mockExec,
      });

      expect(result.baselineFailures).toHaveLength(1);
      expect(result.failures).toHaveLength(0);
      expect(result.newFailures).toHaveLength(0);
      expect(result.success).toBe(true);
    });

    it("should treat all failures as new when baseline not run", async () => {
      const mockExec = vi.fn(() => {
        const error: any = new Error("Tests failed");
        error.stdout = Buffer.from(`
FAIL src/test.ts > test one
  Error: error one
FAIL src/test.ts > test two
  Error: error two
`);
        throw error;
      });

      const config: TestConfig = {
        command: "npm test",
        maxRetries: 3,
        runBeforeMutations: false, // No baseline
      };

      const result = await runTestRepair({
        config,
        projectRoot: "/test",
        execFn: mockExec,
      });

      expect(result.baselineFailures).toBeUndefined();
      expect(result.failures).toHaveLength(2);
      expect(result.newFailures).toHaveLength(2);
    });

    it("should compare by file and test name", async () => {
      let callCount = 0;
      const mockExec = vi.fn(() => {
        callCount++;
        if (callCount === 1) {
          // Baseline - test in file A
          const error: any = new Error("Tests failed");
          error.stdout = Buffer.from(`
FAIL src/a.test.ts > same test name
  Error: error in a
`);
          throw error;
        } else {
          // After mutations - same test name but different file
          const error: any = new Error("Tests failed");
          error.stdout = Buffer.from(`
FAIL src/a.test.ts > same test name
  Error: error in a
FAIL src/b.test.ts > same test name
  Error: error in b
`);
          throw error;
        }
      });

      const config: TestConfig = {
        command: "npm test",
        maxRetries: 3,
        runBeforeMutations: true,
      };

      const result = await runTestRepair({
        config,
        projectRoot: "/test",
        execFn: mockExec,
      });

      expect(result.baselineFailures).toHaveLength(1);
      expect(result.failures).toHaveLength(2);
      expect(result.newFailures).toHaveLength(1);
      expect(result.newFailures[0]!.testFile).toBe("src/b.test.ts");
    });
  });

  describe("retry logic", () => {
    it("should set iteration to 0 on first run", async () => {
      const mockExec = vi.fn(() => Buffer.from("All tests passed"));

      const config: TestConfig = {
        command: "npm test",
        maxRetries: 3,
        runBeforeMutations: false,
      };

      const result = await runTestRepair({
        config,
        projectRoot: "/test",
        execFn: mockExec,
      });

      expect(result.iteration).toBe(0);
    });

    it("should include maxRetries in started event", async () => {
      const mockExec = vi.fn(() => Buffer.from("All tests passed"));

      const config: TestConfig = {
        command: "npm test",
        maxRetries: 5,
        runBeforeMutations: false,
      };

      await runTestRepair({
        config,
        projectRoot: "/test",
        eventEngine: mockEventEngine,
        execFn: mockExec,
      });

      expect(emittedEvents[0].kind).toBe("run.repair.test.started");
      expect(emittedEvents[0].payload.maxRetries).toBe(5);
    });
  });

  describe("event emission", () => {
    it("should emit started and completed events", async () => {
      const mockExec = vi.fn(() => Buffer.from("All tests passed"));

      const config: TestConfig = {
        command: "npm test",
        maxRetries: 3,
        runBeforeMutations: false,
      };

      await runTestRepair({
        config,
        projectRoot: "/test",
        eventEngine: mockEventEngine,
        execFn: mockExec,
      });

      expect(emittedEvents).toHaveLength(2);
      expect(emittedEvents[0].kind).toBe("run.repair.test.started");
      expect(emittedEvents[1].kind).toBe("run.repair.test.completed");
    });

    it("should include failure counts in completed event", async () => {
      let callCount = 0;
      const mockExec = vi.fn(() => {
        callCount++;
        if (callCount === 1) {
          // Baseline - 1 failure
          const error: any = new Error("Tests failed");
          error.stdout = Buffer.from("FAIL src/test.ts > old test\n  Error: old error");
          throw error;
        } else {
          // After mutations - 2 failures (1 old + 1 new)
          const error: any = new Error("Tests failed");
          error.stdout = Buffer.from(`
FAIL src/test.ts > old test
  Error: old error
FAIL src/test.ts > new test
  Error: new error
`);
          throw error;
        }
      });

      const config: TestConfig = {
        command: "npm test",
        maxRetries: 3,
        runBeforeMutations: true,
      };

      await runTestRepair({
        config,
        projectRoot: "/test",
        eventEngine: mockEventEngine,
        execFn: mockExec,
      });

      const completedEvent = emittedEvents[1];
      expect(completedEvent.payload.totalFailures).toBe(2);
      expect(completedEvent.payload.baselineFailures).toBe(1);
      expect(completedEvent.payload.newFailures).toBe(1);
      expect(completedEvent.payload.success).toBe(false);
    });

    it("should include duration in completed event", async () => {
      const mockExec = vi.fn(() => Buffer.from("All tests passed"));

      const config: TestConfig = {
        command: "npm test",
        maxRetries: 3,
        runBeforeMutations: false,
      };

      await runTestRepair({
        config,
        projectRoot: "/test",
        eventEngine: mockEventEngine,
        execFn: mockExec,
      });

      const completedEvent = emittedEvents[1];
      expect(completedEvent.payload.durationMs).toBeGreaterThanOrEqual(0);
    });
  });
});

describe("formatTestFailures", () => {
  it("should format empty failures list", () => {
    const formatted = formatTestFailures([]);
    expect(formatted).toBe("No test failures found.");
  });

  it("should format single failure", () => {
    const failures: TestFailure[] = [
      {
        testFile: "src/example.test.ts",
        testName: "should work",
        error: "expected 1 to be 2",
      },
    ];

    const formatted = formatTestFailures(failures);

    expect(formatted).toContain("Found 1 test failure(s) in 1 file(s)");
    expect(formatted).toContain("src/example.test.ts");
    expect(formatted).toContain("● should work");
    expect(formatted).toContain("expected 1 to be 2");
  });

  it("should format multiple failures in same file", () => {
    const failures: TestFailure[] = [
      {
        testFile: "src/example.test.ts",
        testName: "test one",
        error: "error one",
      },
      {
        testFile: "src/example.test.ts",
        testName: "test two",
        error: "error two",
      },
    ];

    const formatted = formatTestFailures(failures);

    expect(formatted).toContain("Found 2 test failure(s) in 1 file(s)");
    expect(formatted).toContain("test one");
    expect(formatted).toContain("test two");
  });

  it("should format failures across multiple files", () => {
    const failures: TestFailure[] = [
      {
        testFile: "src/a.test.ts",
        testName: "test in a",
        error: "error in a",
      },
      {
        testFile: "src/b.test.ts",
        testName: "test in b",
        error: "error in b",
      },
    ];

    const formatted = formatTestFailures(failures);

    expect(formatted).toContain("Found 2 test failure(s) in 2 file(s)");
    expect(formatted).toContain("src/a.test.ts");
    expect(formatted).toContain("src/b.test.ts");
  });

  it("should include stack trace (first 3 lines)", () => {
    const failures: TestFailure[] = [
      {
        testFile: "src/example.test.ts",
        testName: "should work",
        error: "error message",
        stackTrace: "line 1\nline 2\nline 3\nline 4\nline 5",
      },
    ];

    const formatted = formatTestFailures(failures);

    expect(formatted).toContain("at line 1");
    expect(formatted).toContain("at line 2");
    expect(formatted).toContain("at line 3");
    expect(formatted).not.toContain("at line 4"); // Only first 3
  });
});
