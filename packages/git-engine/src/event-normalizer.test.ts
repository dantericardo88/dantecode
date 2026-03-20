import { describe, expect, it } from "vitest";
import {
  computeEventFingerprint,
  isNoiseEvent,
  normalizeGitEvent,
  sortByPriority,
  type GitAutomationEvent,
  type RawGitEvent,
} from "./event-normalizer.js";

describe("normalizeGitEvent", () => {
  it("produces a canonical event with stable fingerprint and high priority for post-commit", () => {
    const raw: RawGitEvent = {
      type: "post-commit",
      repoRoot: "C:\\Projects\\MyRepo",
      branch: "main",
      paths: ["src/index.ts", "src/utils.ts"],
    };
    const event = normalizeGitEvent(raw);

    expect(event.id).toBeTruthy();
    expect(event.repoRoot).toBe("C:/Projects/MyRepo");
    expect(event.branch).toBe("main");
    expect(event.eventType).toBe("post-commit");
    expect(event.paths).toEqual(["src/index.ts", "src/utils.ts"]);
    expect(event.priority).toBe("high");
    expect(event.createdAt).toBeTruthy();
    expect(event.fingerprint).toBeTruthy();
  });

  it("assigns high priority to webhook events", () => {
    const raw: RawGitEvent = { type: "webhook", repoRoot: "/repo" };
    expect(normalizeGitEvent(raw).priority).toBe("high");
  });

  it("assigns normal priority to workflow-run events", () => {
    const raw: RawGitEvent = { type: "workflow-run", repoRoot: "/repo" };
    expect(normalizeGitEvent(raw).priority).toBe("normal");
  });

  it("assigns low priority to fs-change and scheduled-task events", () => {
    expect(normalizeGitEvent({ type: "fs-change", repoRoot: "/repo" }).priority).toBe("low");
    expect(normalizeGitEvent({ type: "scheduled-task", repoRoot: "/repo" }).priority).toBe("low");
  });

  it("honours explicit priority override", () => {
    const raw: RawGitEvent = { type: "fs-change", repoRoot: "/repo", priority: "high" };
    expect(normalizeGitEvent(raw).priority).toBe("high");
  });

  it("normalises backslash paths on Windows-style paths", () => {
    const raw: RawGitEvent = {
      type: "fs-change",
      repoRoot: "C:\\repo",
      paths: ["src\\index.ts"],
    };
    const event = normalizeGitEvent(raw);
    expect(event.repoRoot).toBe("C:/repo");
    expect(event.paths).toEqual(["src/index.ts"]);
  });

  it("omits optional fields when not provided", () => {
    const event = normalizeGitEvent({ type: "fs-change", repoRoot: "/repo" });
    expect(event.worktreeId).toBeUndefined();
    expect(event.branch).toBeUndefined();
    expect(event.paths).toBeUndefined();
    expect(event.payload).toBeUndefined();
  });

  it("includes worktreeId and payload when provided", () => {
    const raw: RawGitEvent = {
      type: "webhook",
      repoRoot: "/repo",
      worktreeId: "wt-1",
      payload: { action: "push" },
    };
    const event = normalizeGitEvent(raw);
    expect(event.worktreeId).toBe("wt-1");
    expect(event.payload).toEqual({ action: "push" });
  });
});

describe("computeEventFingerprint", () => {
  it("produces identical fingerprints for equivalent events", () => {
    const raw1: RawGitEvent = {
      type: "post-commit",
      repoRoot: "/repo",
      paths: ["a.ts", "b.ts"],
    };
    const raw2: RawGitEvent = {
      type: "post-commit",
      repoRoot: "/repo",
      paths: ["b.ts", "a.ts"], // Different order — should still match
    };
    expect(computeEventFingerprint(raw1)).toBe(computeEventFingerprint(raw2));
  });

  it("produces different fingerprints for different repos", () => {
    const raw1: RawGitEvent = { type: "fs-change", repoRoot: "/repo1" };
    const raw2: RawGitEvent = { type: "fs-change", repoRoot: "/repo2" };
    expect(computeEventFingerprint(raw1)).not.toBe(computeEventFingerprint(raw2));
  });

  it("produces different fingerprints for different event types", () => {
    const raw1: RawGitEvent = { type: "post-commit", repoRoot: "/repo" };
    const raw2: RawGitEvent = { type: "fs-change", repoRoot: "/repo" };
    expect(computeEventFingerprint(raw1)).not.toBe(computeEventFingerprint(raw2));
  });
});

describe("isNoiseEvent", () => {
  function makeEvent(fingerprint: string, offsetMs = 0): GitAutomationEvent {
    const now = Date.now() - offsetMs;
    return {
      id: Math.random().toString(36).slice(2, 8),
      repoRoot: "/repo",
      eventType: "fs-change",
      priority: "low",
      createdAt: new Date(now).toISOString(),
      fingerprint,
    };
  }

  it("returns false for an empty history", () => {
    const candidate = makeEvent("fp1");
    expect(isNoiseEvent(candidate, [])).toBe(false);
  });

  it("returns true when a matching fingerprint appears within the dedup window", () => {
    const candidate = makeEvent("fp1", 0);
    const recent = [makeEvent("fp1", 100)]; // 100ms ago — within 500ms default
    expect(isNoiseEvent(candidate, recent)).toBe(true);
  });

  it("returns false when matching fingerprint is outside the dedup window", () => {
    const candidate = makeEvent("fp1", 0);
    const recent = [makeEvent("fp1", 1000)]; // 1000ms ago — outside 500ms window
    expect(isNoiseEvent(candidate, recent)).toBe(false);
  });

  it("returns false when fingerprints differ", () => {
    const candidate = makeEvent("fp1", 0);
    const recent = [makeEvent("fp2", 100)];
    expect(isNoiseEvent(candidate, recent)).toBe(false);
  });

  it("respects custom dedupeWindowMs", () => {
    const candidate = makeEvent("fp1", 0);
    const recent = [makeEvent("fp1", 200)]; // 200ms ago
    expect(isNoiseEvent(candidate, recent, { dedupeWindowMs: 100 })).toBe(false);
    expect(isNoiseEvent(candidate, recent, { dedupeWindowMs: 500 })).toBe(true);
  });
});

describe("sortByPriority", () => {
  function makeEventWithPriority(
    priority: "high" | "normal" | "low",
    createdAt: string,
  ): GitAutomationEvent {
    return {
      id: Math.random().toString(36).slice(2, 8),
      repoRoot: "/repo",
      eventType: "fs-change",
      priority,
      createdAt,
      fingerprint: Math.random().toString(36),
    };
  }

  it("sorts high before normal before low", () => {
    const events = [
      makeEventWithPriority("low", "2026-01-01T00:00:03.000Z"),
      makeEventWithPriority("high", "2026-01-01T00:00:01.000Z"),
      makeEventWithPriority("normal", "2026-01-01T00:00:02.000Z"),
    ];
    const sorted = sortByPriority(events);
    expect(sorted[0]?.priority).toBe("high");
    expect(sorted[1]?.priority).toBe("normal");
    expect(sorted[2]?.priority).toBe("low");
  });

  it("sorts by createdAt within the same priority (FIFO)", () => {
    const events = [
      makeEventWithPriority("normal", "2026-01-01T00:00:02.000Z"),
      makeEventWithPriority("normal", "2026-01-01T00:00:01.000Z"),
    ];
    const sorted = sortByPriority(events);
    expect(sorted[0]?.createdAt).toBe("2026-01-01T00:00:01.000Z");
    expect(sorted[1]?.createdAt).toBe("2026-01-01T00:00:02.000Z");
  });

  it("does not mutate the original array", () => {
    const original = [
      makeEventWithPriority("low", "2026-01-01T00:00:02.000Z"),
      makeEventWithPriority("high", "2026-01-01T00:00:01.000Z"),
    ];
    sortByPriority(original);
    expect(original[0]?.priority).toBe("low");
  });
});
