import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { GaslightSessionStore } from "./session-store.js";
import type { GaslightSession } from "./types.js";

const makeTestDir = () => {
  const dir = join(
    tmpdir(),
    `dc-gaslight-store-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
};

const makeSession = (id: string, lessonEligible = false): GaslightSession => ({
  sessionId: id,
  trigger: { channel: "explicit-user", at: new Date().toISOString() },
  iterations: [],
  lessonEligible,
  startedAt: new Date().toISOString(),
  endedAt: new Date().toISOString(),
  stopReason: lessonEligible ? "pass" : "budget-iterations",
  finalGateDecision: lessonEligible ? "pass" : "fail",
});

describe("GaslightSessionStore", () => {
  let testDir: string;
  let store: GaslightSessionStore;

  beforeEach(() => {
    testDir = makeTestDir();
    store = new GaslightSessionStore({ cwd: testDir });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("sessionsDir reflects cwd + gaslightDir", () => {
    expect(store.sessionsDir).toBe(join(testDir, ".dantecode/gaslight/sessions"));
  });

  it("sessionPath returns expected path for an ID", () => {
    expect(store.sessionPath("abc-123")).toBe(
      join(testDir, ".dantecode/gaslight/sessions/abc-123.json"),
    );
  });

  it("save() creates sessions directory if absent", () => {
    const session = makeSession("s1");
    store.save(session);
    expect(existsSync(store.sessionsDir)).toBe(true);
  });

  it("save() writes a JSON file named {sessionId}.json", () => {
    const session = makeSession("s2");
    store.save(session);
    expect(existsSync(store.sessionPath("s2"))).toBe(true);
  });

  it("save() persists valid JSON that round-trips to the same sessionId", () => {
    const session = makeSession("s-roundtrip");
    store.save(session);
    const loaded = store.load("s-roundtrip");
    expect(loaded?.sessionId).toBe("s-roundtrip");
  });

  it("load() returns null for unknown sessionId", () => {
    expect(store.load("nonexistent")).toBeNull();
  });

  it("load() returns session after save()", () => {
    const session = makeSession("s3");
    store.save(session);
    const loaded = store.load("s3");
    expect(loaded?.sessionId).toBe("s3");
  });

  it("load() preserves lessonEligible flag", () => {
    const session = makeSession("s-lesson", true);
    store.save(session);
    const loaded = store.load("s-lesson");
    expect(loaded?.lessonEligible).toBe(true);
  });

  it("load() returns null for corrupt JSON", () => {
    mkdirSync(store.sessionsDir, { recursive: true });
    writeFileSync(store.sessionPath("corrupt-id"), "NOT_JSON", "utf-8");
    expect(store.load("corrupt-id")).toBeNull();
  });

  it("has() returns false before save", () => {
    expect(store.has("s4")).toBe(false);
  });

  it("has() returns true after save", () => {
    store.save(makeSession("s4"));
    expect(store.has("s4")).toBe(true);
  });

  it("list() returns [] when no sessions directory exists", () => {
    expect(store.list()).toHaveLength(0);
  });

  it("list() returns [] when directory is empty", () => {
    mkdirSync(store.sessionsDir, { recursive: true });
    expect(store.list()).toHaveLength(0);
  });

  it("list() returns all saved sessions", () => {
    store.save(makeSession("s1"));
    store.save(makeSession("s2"));
    store.save(makeSession("s3"));
    expect(store.list()).toHaveLength(3);
  });

  it("list() is sorted newest-first (by file mtime)", async () => {
    store.save(makeSession("older"));
    // Small delay to ensure different mtime
    await new Promise((r) => setTimeout(r, 30));
    store.save(makeSession("newer"));
    const sessions = store.list();
    expect(sessions[0]?.sessionId).toBe("newer");
    expect(sessions[1]?.sessionId).toBe("older");
  });

  it("cleanup(1) deletes oldest, keeps newest", async () => {
    store.save(makeSession("first"));
    await new Promise((r) => setTimeout(r, 30));
    store.save(makeSession("second"));
    await new Promise((r) => setTimeout(r, 30));
    store.save(makeSession("third"));
    const deleted = store.cleanup(1);
    expect(deleted).toBe(2);
    const remaining = store.list();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.sessionId).toBe("third");
  });

  it("cleanup() returns count of deleted sessions", () => {
    store.save(makeSession("s1"));
    store.save(makeSession("s2"));
    store.save(makeSession("s3"));
    const deleted = store.cleanup(1);
    expect(deleted).toBe(2);
  });

  it("cleanup() with maxSessions >= total deletes nothing", () => {
    store.save(makeSession("s1"));
    store.save(makeSession("s2"));
    const deleted = store.cleanup(10);
    expect(deleted).toBe(0);
    expect(store.list()).toHaveLength(2);
  });

  it("cleanup() returns 0 when directory does not exist", () => {
    expect(store.cleanup(5)).toBe(0);
  });

  it("list() skips corrupt files silently", () => {
    mkdirSync(store.sessionsDir, { recursive: true });
    writeFileSync(join(store.sessionsDir, "corrupt.json"), "NOT_JSON", "utf-8");
    store.save(makeSession("valid"));
    const sessions = store.list();
    // corrupt file is skipped; only the valid session is returned
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.sessionId).toBe("valid");
  });

  it("custom gaslightDir is respected", () => {
    const custom = new GaslightSessionStore({
      cwd: testDir,
      gaslightDir: "my/custom/path",
    });
    expect(custom.sessionsDir).toBe(join(testDir, "my/custom/path"));
  });

  it("default cwd falls back to process.cwd()", () => {
    const defaultStore = new GaslightSessionStore();
    // Normalize separators for cross-platform comparison
    const normalized = defaultStore.sessionsDir.replace(/\\/g, "/");
    expect(normalized).toContain(".dantecode/gaslight/sessions");
  });

  it("overwriting a session with the same ID updates the file", () => {
    const s = makeSession("s-overwrite");
    store.save(s);
    const updated = { ...s, lessonEligible: true };
    store.save(updated);
    const loaded = store.load("s-overwrite");
    expect(loaded?.lessonEligible).toBe(true);
  });

  // ── markDistilled ───────────────────────────────────────

  it("markDistilled() sets distilledAt on the stored session", () => {
    const session = makeSession("s-distill", true);
    store.save(session);
    store.markDistilled("s-distill");
    const loaded = store.load("s-distill");
    expect(loaded?.distilledAt).toBeTruthy();
    expect(new Date(loaded!.distilledAt!).toISOString()).toBe(loaded!.distilledAt);
  });

  it("markDistilled() is a no-op for unknown sessionId", () => {
    // Should not throw
    expect(() => store.markDistilled("nonexistent-session")).not.toThrow();
  });

  it("markDistilled() preserves all other session fields", () => {
    const session = makeSession("s-preserve", true);
    store.save(session);
    store.markDistilled("s-preserve");
    const loaded = store.load("s-preserve");
    expect(loaded?.sessionId).toBe("s-preserve");
    expect(loaded?.lessonEligible).toBe(true);
    expect(loaded?.stopReason).toBe("pass");
  });
});
