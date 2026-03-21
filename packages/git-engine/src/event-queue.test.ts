import { describe, expect, it } from "vitest";
import { GitEventQueue } from "./event-queue.js";
import { normalizeGitEvent } from "./event-normalizer.js";
import type { GitAutomationEvent } from "./event-normalizer.js";

function makeEvent(
  type: GitAutomationEvent["eventType"] = "fs-change",
  repoRoot = "/repo",
  priority: GitAutomationEvent["priority"] = "low",
): GitAutomationEvent {
  const raw = { type, repoRoot, priority } as Parameters<typeof normalizeGitEvent>[0];
  return normalizeGitEvent(raw);
}

describe("GitEventQueue", () => {
  it("enqueues and dequeues a single event", () => {
    const q = new GitEventQueue({ dedupeWindowMs: 0 });
    const event = makeEvent("fs-change");
    expect(q.enqueue(event)).toBe(true);
    expect(q.size()).toBe(1);
    const entry = q.dequeue();
    expect(entry?.event.id).toBe(event.id);
    expect(q.size()).toBe(0);
  });

  it("returns null from dequeue on empty queue", () => {
    const q = new GitEventQueue();
    expect(q.dequeue()).toBeNull();
  });

  it("orders events by priority: high → normal → low", () => {
    const q = new GitEventQueue({ dedupeWindowMs: 0 });
    const low = makeEvent("scheduled-task", "/repo", "low");
    const high = makeEvent("post-commit", "/repo", "high");
    const normal = makeEvent("workflow-run", "/repo", "normal");

    q.enqueue(low);
    q.enqueue(high);
    q.enqueue(normal);

    expect(q.dequeue()?.event.priority).toBe("high");
    expect(q.dequeue()?.event.priority).toBe("normal");
    expect(q.dequeue()?.event.priority).toBe("low");
  });

  it("deduplicates events with the same fingerprint within the window", () => {
    const q = new GitEventQueue({ dedupeWindowMs: 5000 });
    const event = makeEvent("fs-change");

    expect(q.enqueue(event)).toBe(true);
    // Same fingerprint — should be rejected as duplicate
    const duplicate = { ...event, id: "different-id" };
    expect(q.enqueue(duplicate)).toBe(false);
    expect(q.stats().droppedDuplicates).toBe(1);
  });

  it("allows the same fingerprint after dedup window expires", async () => {
    const q = new GitEventQueue({ dedupeWindowMs: 10 });
    const event = makeEvent("fs-change");
    expect(q.enqueue(event)).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 20));
    const later = { ...event, id: "later-id" };
    expect(q.enqueue(later)).toBe(true);
  });

  it("enforces backpressure at maxSize", () => {
    const q = new GitEventQueue({ maxSize: 2, dedupeWindowMs: 0 });
    const e1 = makeEvent("fs-change", "/repo1");
    const e2 = makeEvent("fs-change", "/repo2");
    const e3 = makeEvent("fs-change", "/repo3");

    expect(q.enqueue(e1)).toBe(true);
    expect(q.enqueue(e2)).toBe(true);
    expect(q.enqueue(e3)).toBe(false);
    expect(q.stats().droppedBackpressure).toBe(1);
    expect(q.isBackpressured()).toBe(true);
  });

  it("peek returns the highest-priority entry without removing it", () => {
    const q = new GitEventQueue({ dedupeWindowMs: 0 });
    const low = makeEvent("scheduled-task", "/repo", "low");
    const high = makeEvent("pre-push", "/repo", "high");
    q.enqueue(low);
    q.enqueue(high);

    const peeked = q.peek();
    expect(peeked?.event.priority).toBe("high");
    expect(q.size()).toBe(2); // Not removed
  });

  it("drainBatch returns up to N entries in priority order", () => {
    const q = new GitEventQueue({ dedupeWindowMs: 0 });
    for (let i = 0; i < 5; i++) {
      q.enqueue(makeEvent("fs-change", `/repo${i}`));
    }
    const batch = q.drainBatch(3);
    expect(batch).toHaveLength(3);
    expect(q.size()).toBe(2);
  });

  it("retry re-enqueues a failed entry and increments retryCount", () => {
    const q = new GitEventQueue({ defaultMaxRetries: 2, dedupeWindowMs: 0 });
    const event = makeEvent("webhook");
    q.enqueue(event);
    const entry = q.dequeue()!;

    expect(q.retry(entry)).toBe(true);
    expect(q.size()).toBe(1);
    const retried = q.dequeue()!;
    expect(retried.retryCount).toBe(1);
  });

  it("retry returns false when maxRetries is exhausted", () => {
    const q = new GitEventQueue({ defaultMaxRetries: 1, dedupeWindowMs: 0 });
    const event = makeEvent("webhook");
    q.enqueue(event);

    let entry = q.dequeue()!;
    expect(q.retry(entry)).toBe(true);
    entry = q.dequeue()!;
    expect(q.retry(entry)).toBe(false); // retryCount = 1 = maxRetries
  });

  it("stats reports byPriority correctly", () => {
    const q = new GitEventQueue({ dedupeWindowMs: 0 });
    q.enqueue(makeEvent("post-commit", "/a", "high"));
    q.enqueue(makeEvent("workflow-run", "/b", "normal"));
    q.enqueue(makeEvent("scheduled-task", "/c", "low"));
    q.enqueue(makeEvent("fs-change", "/d", "low"));

    const stats = q.stats();
    expect(stats.byPriority.high).toBe(1);
    expect(stats.byPriority.normal).toBe(1);
    expect(stats.byPriority.low).toBe(2);
    expect(stats.total).toBe(4);
  });

  it("clear empties the queue", () => {
    const q = new GitEventQueue({ dedupeWindowMs: 0 });
    q.enqueue(makeEvent());
    q.enqueue(makeEvent("webhook", "/b"));
    q.clear();
    expect(q.size()).toBe(0);
  });
});
