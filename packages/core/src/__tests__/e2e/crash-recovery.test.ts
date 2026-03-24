import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EventSourcedCheckpointer } from "../../checkpointer.js";

// ---------------------------------------------------------------------------
// Test Suite — crash-recovery e2e with real file I/O
// ---------------------------------------------------------------------------

describe("Crash recovery — EventSourcedCheckpointer real file I/O", () => {
  const tmpDirs: string[] = [];

  function makeTmpDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "crash-recovery-e2e-"));
    tmpDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    for (const dir of tmpDirs) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }
    tmpDirs.length = 0;
  });

  it("creates checkpoint files on disk", async () => {
    const persistDir = makeTmpDir();
    const checkpointer = new EventSourcedCheckpointer("unused", "session-1", {
      baseDir: persistDir,
    });

    await checkpointer.put(
      { step: "init", data: { foo: "bar" } },
      { source: "input", step: 0, triggerCommand: "/test" },
    );

    // Verify files exist on disk
    const sessionDir = join(persistDir, "session-1");
    expect(existsSync(sessionDir)).toBe(true);

    const baseStatePath = join(sessionDir, "base_state.json");
    expect(existsSync(baseStatePath)).toBe(true);

    // Verify base_state.json contains valid JSON
    const raw = readFileSync(baseStatePath, "utf-8");
    const parsed = JSON.parse(raw) as { checkpoint: { channelValues: Record<string, unknown> } };
    expect(parsed.checkpoint.channelValues.step).toBe("init");
    expect(parsed.checkpoint.channelValues.data).toEqual({ foo: "bar" });
  });

  it("event files accumulate in the events/ directory", async () => {
    const persistDir = makeTmpDir();
    const checkpointer = new EventSourcedCheckpointer("unused", "session-2", {
      baseDir: persistDir,
    });

    await checkpointer.put(
      { status: "running" },
      { source: "input", step: 0, triggerCommand: "/test" },
    );

    // Add incremental writes
    await checkpointer.putWrite({
      taskId: "task-1",
      channel: "progress",
      value: 25,
      timestamp: new Date().toISOString(),
    });
    await checkpointer.putWrite({
      taskId: "task-2",
      channel: "files",
      value: ["a.ts", "b.ts"],
      timestamp: new Date().toISOString(),
    });

    const eventsDir = join(persistDir, "session-2", "events");
    expect(existsSync(eventsDir)).toBe(true);

    const eventFiles = readdirSync(eventsDir).filter(
      (f) => f.startsWith("event-") && f.endsWith(".json"),
    );
    // 1 checkpoint event + 2 write events = 3
    expect(eventFiles.length).toBe(3);
  });

  it("new instance recovers state from disk (simulates restart)", async () => {
    const persistDir = makeTmpDir();
    const sessionId = "session-recover";

    // First instance: create checkpoint + writes
    const checkpointer1 = new EventSourcedCheckpointer("unused", sessionId, {
      baseDir: persistDir,
    });

    await checkpointer1.put(
      { status: "running", progress: 0 },
      { source: "input", step: 0, triggerCommand: "/autoforge" },
    );

    await checkpointer1.putWrite({
      taskId: "task-a",
      channel: "progress",
      value: 50,
      timestamp: new Date().toISOString(),
    });
    await checkpointer1.putWrite({
      taskId: "task-b",
      channel: "lastFile",
      value: "src/index.ts",
      timestamp: new Date().toISOString(),
    });

    // Simulate crash — throw away the first instance (no explicit shutdown)
    // Second instance: resume from disk
    const checkpointer2 = new EventSourcedCheckpointer("unused", sessionId, {
      baseDir: persistDir,
    });

    const resumed = await checkpointer2.resume();
    expect(resumed).toBeGreaterThan(0);

    const tuple = await checkpointer2.getTuple();
    expect(tuple).not.toBeNull();
    expect(tuple!.checkpoint.channelValues.status).toBe("running");
    expect(tuple!.pendingWrites).toHaveLength(2);
    expect(tuple!.pendingWrites[0]!.channel).toBe("progress");
    expect(tuple!.pendingWrites[0]!.value).toBe(50);
    expect(tuple!.pendingWrites[1]!.channel).toBe("lastFile");
    expect(tuple!.pendingWrites[1]!.value).toBe("src/index.ts");
  });

  it("compaction merges writes into base state and clears event log", async () => {
    const persistDir = makeTmpDir();
    const sessionId = "session-compact";

    const checkpointer = new EventSourcedCheckpointer("unused", sessionId, {
      baseDir: persistDir,
      maxEventsBeforeCompaction: 5, // low threshold for testing
    });

    await checkpointer.put(
      { counter: 0 },
      { source: "input", step: 0, triggerCommand: "/test" },
    );

    // Add exactly 4 writes to trigger compaction at maxEvents=5.
    // put() wrote 1 event (index 0), so writes 1-4 fill indices 1-4.
    // Write 4 pushes nextEventIndex to 5 >= maxEvents, triggering compact().
    for (let i = 1; i <= 4; i++) {
      await checkpointer.putWrite({
        taskId: `task-${i}`,
        channel: `channel-${i}`,
        value: i * 10,
        timestamp: new Date().toISOString(),
      });
    }

    // After compaction triggered by 4th write, event log should be cleared
    const eventsDir = join(persistDir, sessionId, "events");
    const eventFiles = readdirSync(eventsDir).filter(
      (f) => f.startsWith("event-") && f.endsWith(".json"),
    );
    expect(eventFiles.length).toBe(0);

    // Compacted values should be merged into base_state.json
    const baseStatePath = join(persistDir, sessionId, "base_state.json");
    const raw = readFileSync(baseStatePath, "utf-8");
    const parsed = JSON.parse(raw) as { checkpoint: { channelValues: Record<string, unknown> } };

    expect(parsed.checkpoint.channelValues["channel-1"]).toBe(10);
    expect(parsed.checkpoint.channelValues["channel-4"]).toBe(40);
  });

  it("getTuple returns null for non-existent session", async () => {
    const persistDir = makeTmpDir();
    const checkpointer = new EventSourcedCheckpointer("unused", "does-not-exist", {
      baseDir: persistDir,
    });

    const tuple = await checkpointer.getTuple();
    expect(tuple).toBeNull();
  });

  it("resume returns 0 for non-existent session", async () => {
    const persistDir = makeTmpDir();
    const checkpointer = new EventSourcedCheckpointer("unused", "no-session", {
      baseDir: persistDir,
    });

    const count = await checkpointer.resume();
    expect(count).toBe(0);
  });
});
