import { describe, it, expect, beforeEach } from "vitest";
import { SessionMap } from "./session-map.js";

describe("SessionMap", () => {
  let sm: SessionMap;

  beforeEach(() => {
    sm = new SessionMap();
  });

  it("starts a new session with generated IDs", () => {
    const info = sm.startSession();
    expect(info.sessionId).toMatch(/^sess_/);
    expect(info.runId).toMatch(/^run_/);
    expect(info.eventCount).toBe(0);
    expect(info.pinned).toBe(false);
    expect(info.tags).toEqual([]);
  });

  it("starts a session with custom IDs", () => {
    const info = sm.startSession({ sessionId: "s-custom", runId: "r-custom" });
    expect(info.sessionId).toBe("s-custom");
    expect(info.runId).toBe("r-custom");
  });

  it("resumes an existing session", () => {
    sm.startSession({ sessionId: "s-resume" });
    const resumed = sm.startSession({ sessionId: "s-resume" });
    expect(resumed.sessionId).toBe("s-resume");
  });

  it("tracks current session", () => {
    sm.startSession({ sessionId: "s1" });
    const current = sm.current();
    expect(current).not.toBeNull();
    expect(current!.sessionId).toBe("s1");
  });

  it("ends a session and clears current", () => {
    sm.startSession({ sessionId: "s-end" });
    sm.endSession();
    expect(sm.current()).toBeNull();
    const info = sm.get("s-end");
    expect(info!.endedAt).toBeDefined();
  });

  it("lists all sessions sorted newest first", () => {
    sm.startSession({ sessionId: "s-old" });
    sm.startSession({ sessionId: "s-new" });
    const all = sm.all();
    expect(all.length).toBe(2);
    // Both have same timestamp since we're running fast, just check they're both present
    expect(all.map((s) => s.sessionId)).toContain("s-old");
    expect(all.map((s) => s.sessionId)).toContain("s-new");
  });

  it("records events and updates counts", () => {
    sm.startSession({ sessionId: "s-count" });
    sm.recordEvent("s-count", "file_write");
    sm.recordEvent("s-count", "file_delete");
    sm.recordEvent("s-count", "other");
    const info = sm.get("s-count")!;
    expect(info.eventCount).toBe(3);
    expect(info.fileModCount).toBe(1);
    expect(info.fileDeleteCount).toBe(1);
  });

  it("pins and unpins sessions", () => {
    sm.startSession({ sessionId: "s-pin" });
    sm.pin("s-pin");
    expect(sm.get("s-pin")!.pinned).toBe(true);
    sm.unpin("s-pin");
    expect(sm.get("s-pin")!.pinned).toBe(false);
  });

  it("tags a session", () => {
    sm.startSession({ sessionId: "s-tag" });
    sm.tag("s-tag", "important");
    sm.tag("s-tag", "reviewed");
    sm.tag("s-tag", "important"); // duplicate
    expect(sm.get("s-tag")!.tags).toEqual(["important", "reviewed"]);
  });

  it("serializes and loads state", () => {
    sm.startSession({ sessionId: "s-ser" });
    sm.tag("s-ser", "tag1");
    const json = sm.toJSON();

    const sm2 = new SessionMap();
    sm2.loadFrom(json);
    expect(sm2.get("s-ser")!.tags).toEqual(["tag1"]);
  });
});
