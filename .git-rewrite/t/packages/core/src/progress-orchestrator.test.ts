import { describe, it, expect, beforeEach } from "vitest";
import { ProgressOrchestrator } from "./progress-orchestrator.js";

describe("ProgressOrchestrator", () => {
  let orch: ProgressOrchestrator;

  beforeEach(() => {
    orch = new ProgressOrchestrator();
  });

  // 1. register + getTask
  it("registers a task and retrieves it", () => {
    orch.register("t1", "Build", 10);
    const task = orch.getTask("t1");
    expect(task).toBeDefined();
    expect(task!.label).toBe("Build");
    expect(task!.state).toBe("pending");
    expect(task!.total).toBe(10);
  });

  // 2. duplicate register throws
  it("throws on duplicate task id", () => {
    orch.register("t1", "Build");
    expect(() => orch.register("t1", "Build again")).toThrow("already registered");
  });

  // 3. start transitions to running
  it("start() transitions state to running", () => {
    orch.register("t1", "Build");
    orch.start("t1", "starting...");
    const task = orch.getTask("t1")!;
    expect(task.state).toBe("running");
    expect(task.detail).toBe("starting...");
    expect(task.startedAt).toBeGreaterThan(0);
  });

  // 4. update sets progress
  it("update() sets current/total and auto-starts pending task", () => {
    orch.register("t1", "Build", 100);
    orch.update("t1", 50, 100, "halfway");
    const task = orch.getTask("t1")!;
    expect(task.current).toBe(50);
    expect(task.total).toBe(100);
    expect(task.detail).toBe("halfway");
    expect(task.state).toBe("running");
  });

  // 5. complete transitions to done
  it("complete() sets state to done and clamps current to total", () => {
    orch.register("t1", "Build", 10);
    orch.start("t1");
    orch.complete("t1", "all done");
    const task = orch.getTask("t1")!;
    expect(task.state).toBe("done");
    expect(task.current).toBe(10);
    expect(task.detail).toBe("all done");
    expect(task.finishedAt).toBeGreaterThan(0);
  });

  // 6. fail sets error
  it("fail() records error and state=failed", () => {
    orch.register("t1", "Build");
    orch.start("t1");
    orch.fail("t1", "tsc exited with code 1");
    const task = orch.getTask("t1")!;
    expect(task.state).toBe("failed");
    expect(task.error).toBe("tsc exited with code 1");
  });

  // 7. skip
  it("skip() marks task as skipped", () => {
    orch.register("t1", "Lint");
    orch.skip("t1", "already clean");
    expect(orch.getTask("t1")!.state).toBe("skipped");
    expect(orch.getTask("t1")!.detail).toBe("already clean");
  });

  // 8. getSummary counts by state
  it("getSummary() returns correct counts", () => {
    orch.register("a", "A");
    orch.start("a");
    orch.complete("a");
    orch.register("b", "B");
    orch.start("b");
    orch.fail("b", "oops");
    orch.register("c", "C");
    orch.register("d", "D");
    orch.start("d");
    const s = orch.getSummary();
    expect(s.done).toBe(1);
    expect(s.failed).toBe(1);
    expect(s.pending).toBe(1);
    expect(s.running).toBe(1);
  });

  // 9. isComplete returns true when all terminal
  it("isComplete() returns true when all tasks finished", () => {
    orch.register("a", "A");
    orch.start("a");
    orch.complete("a");
    orch.register("b", "B");
    orch.skip("b");
    expect(orch.isComplete()).toBe(true);
  });

  // 10. isComplete returns false with pending
  it("isComplete() returns false when any task still pending", () => {
    orch.register("a", "A");
    orch.complete("a");
    orch.register("b", "B"); // still pending
    expect(orch.isComplete()).toBe(false);
  });

  // 11. render produces output
  it("render() includes task labels", () => {
    orch.register("a", "Typecheck", 5);
    orch.start("a");
    orch.update("a", 3, 5);
    const out = orch.render();
    expect(out).toContain("Typecheck");
    expect(out).toContain("Progress:");
  });

  // 12. render includes failed error
  it("render() shows error message for failed tasks", () => {
    orch.register("a", "Build");
    orch.start("a");
    orch.fail("a", "exit code 2");
    const out = orch.render();
    expect(out).toContain("exit code 2");
  });

  // 13. reset clears all tasks
  it("reset() clears all registered tasks", () => {
    orch.register("a", "A");
    orch.register("b", "B");
    orch.reset();
    expect(orch.getTasks()).toHaveLength(0);
    expect(orch.isComplete()).toBe(false);
  });

  // 14. getTask returns undefined for unknown id
  it("getTask() returns undefined for unknown id", () => {
    expect(orch.getTask("nope")).toBeUndefined();
  });

  // 15. operations on unknown id throw
  it("start() throws for unknown task id", () => {
    expect(() => orch.start("ghost")).toThrow("not found");
  });
});
