import { describe, it, expect, beforeEach } from "vitest";
import { ReviewQueue } from "./review-queue.js";
import type { UpdateOperation } from "./types.js";

const op: UpdateOperation = { action: "add", rationale: "useful", candidateSkill: {
  id: "s1", title: "T", content: "C", section: "coding",
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
}};

describe("ReviewQueue", () => {
  let queue: ReviewQueue;

  beforeEach(() => {
    queue = new ReviewQueue();
  });

  it("starts empty", () => {
    expect(queue.getPending()).toHaveLength(0);
    expect(queue.pendingCount()).toBe(0);
  });

  it("enqueues items", () => {
    const item = queue.enqueue(op, { sessionId: "sess-1" });
    expect(item.id).toMatch(/^rq-/);
    expect(item.status).toBe("pending");
    expect(item.sessionId).toBe("sess-1");
    expect(queue.pendingCount()).toBe(1);
  });

  it("approve transitions to approved", () => {
    const item = queue.enqueue(op);
    const ok = queue.approve(item.id);
    expect(ok).toBe(true);
    expect(queue.getPending()).toHaveLength(0);
    expect(queue.getAll()[0]!.status).toBe("approved");
  });

  it("reject transitions to rejected", () => {
    const item = queue.enqueue(op);
    const ok = queue.reject(item.id);
    expect(ok).toBe(true);
    expect(queue.getAll()[0]!.status).toBe("rejected");
  });

  it("approve returns false for unknown id", () => {
    expect(queue.approve("bad-id")).toBe(false);
  });

  it("reject returns false for already-approved", () => {
    const item = queue.enqueue(op);
    queue.approve(item.id);
    expect(queue.reject(item.id)).toBe(false);
  });

  it("sequential IDs are unique", () => {
    const a = queue.enqueue(op);
    const b = queue.enqueue(op);
    expect(a.id).not.toBe(b.id);
  });
});
