import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { GaslightSessionStore } from "@dantecode/dante-gaslight";
import type { GaslightSession } from "@dantecode/dante-gaslight";
import { runGaslightCommand } from "./gaslight.js";

const makeTestDir = () => {
  const dir = join(
    tmpdir(),
    `dc-gaslight-cmd-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
};

const makeEligibleSession = (id = "sess-pass"): GaslightSession => ({
  sessionId: id,
  trigger: {
    channel: "explicit-user",
    phrase: "go deeper",
    at: new Date().toISOString(),
  },
  iterations: [
    {
      iteration: 1,
      draft: "The final output after one critique cycle.",
      gateDecision: "pass",
      gateScore: 0.88,
      at: new Date().toISOString(),
    },
  ],
  stopReason: "pass",
  finalOutput: "The final output after one critique cycle.",
  finalGateDecision: "pass",
  lessonEligible: true,
  startedAt: new Date().toISOString(),
  endedAt: new Date().toISOString(),
});

const makeIneligibleSession = (id = "sess-fail"): GaslightSession => ({
  sessionId: id,
  trigger: { channel: "explicit-user", at: new Date().toISOString() },
  iterations: [],
  stopReason: "budget-iterations",
  finalGateDecision: "fail",
  lessonEligible: false,
  startedAt: new Date().toISOString(),
  endedAt: new Date().toISOString(),
});

describe("runGaslightCommand", () => {
  let testDir: string;
  let output: string[];
  let originalLog: typeof console.log;
  let originalError: typeof console.error;

  beforeEach(() => {
    testDir = makeTestDir();
    output = [];
    originalLog = console.log;
    originalError = console.error;
    console.log = (...args: unknown[]) => {
      output.push(args.map(String).join(" "));
    };
    console.error = (...args: unknown[]) => {
      output.push(args.map(String).join(" "));
    };
  });

  afterEach(() => {
    console.log = originalLog;
    console.error = originalError;
    rmSync(testDir, { recursive: true, force: true });
  });

  it("on — prints enabled message", async () => {
    await runGaslightCommand(["on"], testDir);
    expect(output.join("\n")).toMatch(/enabled/i);
  });

  it("off — prints disabled message", async () => {
    await runGaslightCommand(["off"], testDir);
    expect(output.join("\n")).toMatch(/disabled/i);
  });

  it("stats — prints 'No gaslight sessions' when empty", async () => {
    await runGaslightCommand(["stats"], testDir);
    expect(output.join("\n")).toMatch(/no gaslight sessions/i);
  });

  it("stats — shows session count when sessions exist", async () => {
    const store = new GaslightSessionStore({ cwd: testDir });
    store.save(makeIneligibleSession());
    await runGaslightCommand(["stats"], testDir);
    expect(output.join("\n")).toContain("1");
  });

  it("review — prints 'No gaslight sessions' when empty", async () => {
    await runGaslightCommand(["review"], testDir);
    expect(output.join("\n")).toMatch(/no gaslight sessions/i);
  });

  it("review — shows last session details when sessions exist", async () => {
    const store = new GaslightSessionStore({ cwd: testDir });
    store.save(makeIneligibleSession("my-session-id"));
    await runGaslightCommand(["review"], testDir);
    expect(output.join("\n")).toContain("my-session-id");
  });

  it("bridge — prints warning when no eligible sessions", async () => {
    const store = new GaslightSessionStore({ cwd: testDir });
    store.save(makeIneligibleSession());
    await runGaslightCommand(["bridge"], testDir);
    expect(output.join("\n")).toMatch(/no undistilled.*eligible|no.*lesson-eligible/i);
  });

  it("bridge — closes the loop when an eligible session exists", async () => {
    const store = new GaslightSessionStore({ cwd: testDir });
    store.save(makeEligibleSession("my-pass-session"));
    await runGaslightCommand(["bridge"], testDir);
    const text = output.join("\n");
    expect(text).toMatch(/closed loop complete/i);
    expect(text).toContain("my-pass-session");
  });

  it("bridge — marks session as distilled after successful bridge", async () => {
    const store = new GaslightSessionStore({ cwd: testDir });
    store.save(makeEligibleSession("distill-me"));
    await runGaslightCommand(["bridge", "distill-me"], testDir);
    const loaded = store.load("distill-me");
    expect(loaded?.distilledAt).toBeTruthy();
  });

  it("bridge — skips already-distilled sessions in auto mode", async () => {
    const store = new GaslightSessionStore({ cwd: testDir });
    const sess = makeEligibleSession("already-done");
    store.save(sess);
    store.markDistilled("already-done");
    await runGaslightCommand(["bridge"], testDir);
    // Should find no undistilled sessions
    expect(output.join("\n")).toMatch(/no undistilled/i);
  });

  it("bridge — rejects already-distilled session when specified by ID", async () => {
    const store = new GaslightSessionStore({ cwd: testDir });
    store.save(makeEligibleSession("done-sess"));
    store.markDistilled("done-sess");
    // After Fix A1: cmdBridge throws instead of calling process.exit — test the thrown error.
    await expect(runGaslightCommand(["bridge", "done-sess"], testDir)).rejects.toThrow(
      /already distilled/i,
    );
  });

  it("unknown subcommand — shows help text", async () => {
    await runGaslightCommand(["unknown-sub"], testDir);
    expect(output.join("\n")).toMatch(/subcommand/i);
  });
});
