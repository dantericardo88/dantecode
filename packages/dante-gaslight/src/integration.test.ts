import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DanteGaslightIntegration } from "./integration.js";
import { GaslightSessionStore } from "./session-store.js";

const enabledConfig = { enabled: true, maxIterations: 1, maxTokens: 100_000, maxSeconds: 60 };

const makeTestDir = () => {
  const dir = join(
    tmpdir(),
    `dc-gaslight-int-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
};

describe("DanteGaslightIntegration", () => {
  let testDir: string;

  beforeEach(() => { testDir = makeTestDir(); });
  afterEach(() => { rmSync(testDir, { recursive: true, force: true }); });

  it("starts disabled by default", () => {
    const engine = new DanteGaslightIntegration({}, { cwd: testDir });
    expect(engine.getConfig().enabled).toBe(false);
  });

  it("cmdOn enables engine", () => {
    const engine = new DanteGaslightIntegration({}, { cwd: testDir });
    const msg = engine.cmdOn();
    expect(engine.getConfig().enabled).toBe(true);
    expect(msg).toContain("enabled");
  });

  it("cmdOff disables engine", () => {
    const engine = new DanteGaslightIntegration({ enabled: true }, { cwd: testDir });
    engine.cmdOff();
    expect(engine.getConfig().enabled).toBe(false);
  });

  it("maybeGaslight returns null when disabled", async () => {
    const engine = new DanteGaslightIntegration({}, { cwd: testDir });
    const result = await engine.maybeGaslight({ message: "go deeper", draft: "Some draft." });
    expect(result).toBeNull();
  });

  it("maybeGaslight returns null when no trigger matches", async () => {
    const engine = new DanteGaslightIntegration(enabledConfig, { cwd: testDir });
    const result = await engine.maybeGaslight({ message: "This is fine.", draft: "Some draft." });
    expect(result).toBeNull();
  });

  it("maybeGaslight runs session on trigger match", async () => {
    const engine = new DanteGaslightIntegration(enabledConfig, { cwd: testDir });
    const session = await engine.maybeGaslight({ message: "go deeper", draft: "Initial draft." });
    expect(session).not.toBeNull();
    expect(session?.trigger.channel).toBe("explicit-user");
  });

  it("stats returns zeros initially", () => {
    const engine = new DanteGaslightIntegration({}, { cwd: testDir });
    const s = engine.stats();
    expect(s.totalSessions).toBe(0);
  });

  it("stats updates after sessions", async () => {
    const engine = new DanteGaslightIntegration(enabledConfig, { cwd: testDir });
    await engine.maybeGaslight({ message: "go deeper", draft: "draft" });
    const s = engine.stats();
    expect(s.totalSessions).toBe(1);
  });

  it("cmdStats returns readable string", () => {
    const engine = new DanteGaslightIntegration({}, { cwd: testDir });
    const s = engine.cmdStats();
    expect(s).toContain("Total sessions");
    expect(s).toContain("Engine enabled");
  });

  it("cmdReview returns no sessions message when empty", () => {
    const engine = new DanteGaslightIntegration({}, { cwd: testDir });
    expect(engine.cmdReview()).toContain("No Gaslight sessions");
  });

  it("cmdReview shows last session after run", async () => {
    const engine = new DanteGaslightIntegration(enabledConfig, { cwd: testDir });
    await engine.maybeGaslight({ message: "go deeper", draft: "draft" });
    const review = engine.cmdReview();
    expect(review).toContain("explicit-user");
  });

  it("getSession returns session by ID", async () => {
    const engine = new DanteGaslightIntegration(enabledConfig, { cwd: testDir });
    const session = await engine.maybeGaslight({ message: "go deeper", draft: "draft" });
    expect(session).not.toBeNull();
    const found = engine.getSession(session!.sessionId);
    expect(found?.sessionId).toBe(session!.sessionId);
  });
});

describe("DanteGaslightIntegration — store persistence", () => {
  let testDir: string;

  beforeEach(() => { testDir = makeTestDir(); });
  afterEach(() => { rmSync(testDir, { recursive: true, force: true }); });

  it("runSession persists session to disk automatically", async () => {
    const engine = new DanteGaslightIntegration(enabledConfig, { cwd: testDir });
    const session = await engine.maybeGaslight({ message: "go deeper", draft: "draft" });
    expect(session).not.toBeNull();
    const store = new GaslightSessionStore({ cwd: testDir });
    expect(store.has(session!.sessionId)).toBe(true);
  });

  it("sessions directory is created on first runSession", async () => {
    const engine = new DanteGaslightIntegration(enabledConfig, { cwd: testDir });
    await engine.maybeGaslight({ message: "go deeper", draft: "draft" });
    const store = new GaslightSessionStore({ cwd: testDir });
    expect(existsSync(store.sessionsDir)).toBe(true);
  });

  it("getSession falls back to disk when session not in memory", () => {
    const store = new GaslightSessionStore({ cwd: testDir });
    const fakeSess = {
      sessionId: "disk-only-id",
      trigger: { channel: "explicit-user" as const, at: new Date().toISOString() },
      iterations: [],
      lessonEligible: false,
      startedAt: new Date().toISOString(),
    };
    store.save(fakeSess);

    const engine = new DanteGaslightIntegration({}, { cwd: testDir });
    const found = engine.getSession("disk-only-id");
    expect(found?.sessionId).toBe("disk-only-id");
  });

  it("getSessions includes both in-memory and disk sessions", async () => {
    const store = new GaslightSessionStore({ cwd: testDir });
    const diskSess = {
      sessionId: "past-session",
      trigger: { channel: "explicit-user" as const, at: new Date().toISOString() },
      iterations: [],
      lessonEligible: false,
      startedAt: new Date().toISOString(),
    };
    store.save(diskSess);

    const engine = new DanteGaslightIntegration(enabledConfig, { cwd: testDir });
    await engine.maybeGaslight({ message: "go deeper", draft: "new draft" });

    const all = engine.getSessions();
    const ids = all.map((s) => s.sessionId);
    expect(ids).toContain("past-session");
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  it("getSessions does not duplicate sessions present both in memory and on disk", async () => {
    const engine = new DanteGaslightIntegration(enabledConfig, { cwd: testDir });
    await engine.maybeGaslight({ message: "go deeper", draft: "draft" });
    const all = engine.getSessions();
    const sessionIds = all.map((s) => s.sessionId);
    const unique = new Set(sessionIds);
    expect(unique.size).toBe(sessionIds.length);
  });

  it("stats counts sessions from disk when engine is fresh", () => {
    const store = new GaslightSessionStore({ cwd: testDir });
    for (let i = 0; i < 3; i++) {
      store.save({
        sessionId: `sess-${i}`,
        trigger: { channel: "explicit-user" as const, at: new Date().toISOString() },
        iterations: [],
        lessonEligible: false,
        startedAt: new Date().toISOString(),
      });
    }
    const engine = new DanteGaslightIntegration({}, { cwd: testDir });
    expect(engine.stats().totalSessions).toBe(3);
  });
});
