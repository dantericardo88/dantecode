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

  beforeEach(() => {
    testDir = makeTestDir();
  });
  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("starts disabled when configured as such", () => {
    const engine = new DanteGaslightIntegration({ enabled: false }, { cwd: testDir });
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
    const engine = new DanteGaslightIntegration({ enabled: false }, { cwd: testDir });
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
    expect(s).toContain("Distilled to Skillbook");
  });

  it("stats includes distilledCount", () => {
    const engine = new DanteGaslightIntegration({}, { cwd: testDir });
    const s = engine.stats();
    expect(s.distilledCount).toBe(0);
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

  it("cmdReview shows the most recent session (newest-first ordering)", async () => {
    const store = new GaslightSessionStore({ cwd: testDir });
    const older = {
      sessionId: "older-sess",
      trigger: { channel: "explicit-user" as const, at: new Date("2024-01-01").toISOString() },
      iterations: [],
      lessonEligible: false,
      startedAt: new Date("2024-01-01").toISOString(),
    };
    const newer = {
      sessionId: "newer-sess",
      trigger: { channel: "explicit-user" as const, at: new Date("2024-06-01").toISOString() },
      iterations: [],
      lessonEligible: false,
      startedAt: new Date("2024-06-01").toISOString(),
    };
    store.save(older);
    store.save(newer);

    const engine = new DanteGaslightIntegration({}, { cwd: testDir });
    const review = engine.cmdReview();
    expect(review).toContain("newer-sess");
    expect(review).not.toContain("older-sess");
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

  beforeEach(() => {
    testDir = makeTestDir();
  });
  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

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

describe("DanteGaslightIntegration — maxSessions cleanup", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = makeTestDir();
  });
  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("cleanup is triggered after runSession when maxSessions is set", async () => {
    const engine = new DanteGaslightIntegration(
      { ...enabledConfig, maxSessions: 1 },
      { cwd: testDir },
    );
    await engine.maybeGaslight({ message: "go deeper", draft: "first draft" });
    await new Promise((r) => setTimeout(r, 20));
    await engine.maybeGaslight({ message: "go deeper", draft: "second draft" });

    const store = new GaslightSessionStore({ cwd: testDir });
    expect(store.list().length).toBe(1);
  });

  it("maxSessions=0 disables cleanup", async () => {
    const engine = new DanteGaslightIntegration(
      { ...enabledConfig, maxSessions: 0 },
      { cwd: testDir },
    );
    await engine.maybeGaslight({ message: "go deeper", draft: "first" });
    await engine.maybeGaslight({ message: "go deeper", draft: "second" });
    await engine.maybeGaslight({ message: "go deeper", draft: "third" });

    const store = new GaslightSessionStore({ cwd: testDir });
    expect(store.list().length).toBe(3);
  });
});

describe("DanteGaslightIntegration — priorLessonProvider", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = makeTestDir();
  });
  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("priorLessonProvider is called on maybeGaslight", async () => {
    let called = false;
    const engine = new DanteGaslightIntegration(
      enabledConfig,
      { cwd: testDir },
      {
        priorLessonProvider: () => {
          called = true;
          return [];
        },
      },
    );
    await engine.maybeGaslight({ message: "go deeper", draft: "draft" });
    expect(called).toBe(true);
  });

  it("priorLessonProvider receives draft and taskClass", async () => {
    let capturedDraft = "";
    let capturedClass: string | undefined;
    const engine = new DanteGaslightIntegration(
      enabledConfig,
      { cwd: testDir },
      {
        priorLessonProvider: (d, tc) => {
          capturedDraft = d;
          capturedClass = tc;
          return [];
        },
      },
    );
    await engine.maybeGaslight({ message: "go deeper", draft: "my draft", taskClass: "review" });
    expect(capturedDraft).toBe("my draft");
    expect(capturedClass).toBe("review");
  });

  it("explicit priorLessons skips provider", async () => {
    let providerCalled = false;
    const engine = new DanteGaslightIntegration(
      enabledConfig,
      { cwd: testDir },
      {
        priorLessonProvider: () => {
          providerCalled = true;
          return [];
        },
      },
    );
    await engine.maybeGaslight({
      message: "go deeper",
      draft: "draft",
      priorLessons: ["override lesson"],
    });
    expect(providerCalled).toBe(false);
  });

  it("async priorLessonProvider is awaited", async () => {
    let resolved = false;
    const engine = new DanteGaslightIntegration(
      enabledConfig,
      { cwd: testDir },
      {
        priorLessonProvider: async () => {
          await new Promise((r) => setTimeout(r, 5));
          resolved = true;
          return ["async lesson"];
        },
      },
    );
    await engine.maybeGaslight({ message: "go deeper", draft: "draft" });
    expect(resolved).toBe(true);
  });
});
