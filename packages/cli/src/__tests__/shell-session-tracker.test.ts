// packages/cli/src/__tests__/shell-session-tracker.test.ts
import { describe, it, expect } from "vitest";
import { ShellSessionTracker, globalShellTracker, recordBashExecution } from "../shell-session-tracker.js";

// ─── ShellSessionTracker — basic recording ────────────────────────────────────

describe("ShellSessionTracker — record", () => {
  it("records command with exit code 0", () => {
    const tracker = new ShellSessionTracker("/tmp");
    tracker.record("npm test", { exitCode: 0, stdout: "All tests pass", durationMs: 500 });
    const snap = tracker.snapshot();
    expect(snap.history).toHaveLength(1);
    expect(snap.history[0]!.command).toBe("npm test");
    expect(snap.history[0]!.exitCode).toBe(0);
  });

  it("records command with non-zero exit code", () => {
    const tracker = new ShellSessionTracker("/tmp");
    tracker.record("tsc", { exitCode: 1, stderr: "TS2345: error", durationMs: 200 });
    const snap = tracker.snapshot();
    expect(snap.history[0]!.exitCode).toBe(1);
    expect(snap.lastCommandFailed).toBe(true);
  });

  it("lastCommandFailed is false when last command succeeded", () => {
    const tracker = new ShellSessionTracker("/tmp");
    tracker.record("echo ok", { exitCode: 0 });
    expect(tracker.snapshot().lastCommandFailed).toBe(false);
  });

  it("truncates stdout at maxStdoutBytes", () => {
    const tracker = new ShellSessionTracker("/tmp", { maxStdoutBytes: 10 });
    const longOutput = "x".repeat(100);
    tracker.record("cmd", { stdout: longOutput });
    const rec = tracker.snapshot().history[0]!;
    expect(rec.stdout.length).toBeLessThan(50); // truncated + "(truncated)"
    expect(rec.stdout).toContain("truncated");
  });

  it("respects maxHistory limit", () => {
    const tracker = new ShellSessionTracker("/tmp", { maxHistory: 3 });
    for (let i = 0; i < 5; i++) {
      tracker.record(`cmd_${i}`, { exitCode: 0 });
    }
    expect(tracker.snapshot().history).toHaveLength(3);
    expect(tracker.snapshot().history[0]!.command).toBe("cmd_2");
  });

  it("records timestamp as valid ISO string", () => {
    const tracker = new ShellSessionTracker("/tmp");
    tracker.record("ls", { exitCode: 0 });
    const ts = tracker.snapshot().history[0]!.timestamp;
    expect(new Date(ts).toISOString()).toBe(ts);
  });
});

// ─── ShellSessionTracker — cwd tracking ──────────────────────────────────────

describe("ShellSessionTracker — cwd tracking", () => {
  it("starts with initialCwd", () => {
    const tracker = new ShellSessionTracker("/home/user");
    expect(tracker.cwd).toContain("home");
    expect(tracker.cwd).toContain("user");
  });

  it("chdir updates cwd", () => {
    const tracker = new ShellSessionTracker("/tmp");
    tracker.chdir("/var/log");
    expect(tracker.cwd).toContain("var");
    expect(tracker.cwd).toContain("log");
  });

  it("auto-detects cd command and updates cwd", () => {
    const tracker = new ShellSessionTracker("/tmp");
    tracker.record("cd /var/log", { exitCode: 0 });
    expect(tracker.cwd).toContain("var");
  });

  it("does not update cwd on failed cd", () => {
    const tracker = new ShellSessionTracker("/tmp");
    const originalCwd = tracker.cwd;
    tracker.record("cd /nonexistent", { exitCode: 1 });
    expect(tracker.cwd).toBe(originalCwd);
  });
});

// ─── ShellSessionTracker — env diff ──────────────────────────────────────────

describe("ShellSessionTracker — environment tracking", () => {
  it("setEnv records a new env var", () => {
    const tracker = new ShellSessionTracker("/tmp", { baselineEnv: {} });
    tracker.setEnv("MY_VAR", "hello");
    expect(tracker.snapshot().envDiff["MY_VAR"]).toBe("hello");
  });

  it("setEnv with same baseline value removes from diff", () => {
    const tracker = new ShellSessionTracker("/tmp", { baselineEnv: { NODE_ENV: "development" } });
    tracker.setEnv("NODE_ENV", "production");
    expect(tracker.snapshot().envDiff["NODE_ENV"]).toBe("production");

    tracker.setEnv("NODE_ENV", "development");  // Reset to baseline
    expect(tracker.snapshot().envDiff["NODE_ENV"]).toBeUndefined();
  });

  it("parseExports detects export KEY=VALUE patterns", () => {
    const tracker = new ShellSessionTracker("/tmp", { baselineEnv: {} });
    tracker.parseExports("export FOO=bar export BATZ=qux");
    const snap = tracker.snapshot();
    expect(snap.envDiff["FOO"]).toBe("bar");
    expect(snap.envDiff["BATZ"]).toBe("qux");
  });
});

// ─── ShellSessionTracker — formatForContext ───────────────────────────────────

describe("ShellSessionTracker — formatForContext", () => {
  it("includes working directory header", () => {
    const tracker = new ShellSessionTracker("/home/user/project");
    const ctx = tracker.formatForContext();
    expect(ctx).toContain("Working directory");
    expect(ctx).toContain("project");
  });

  it("includes recent commands", () => {
    const tracker = new ShellSessionTracker("/tmp");
    tracker.record("npm test", { exitCode: 0, stdout: "passing" });
    const ctx = tracker.formatForContext();
    expect(ctx).toContain("npm test");
    expect(ctx).toContain("passing");
  });

  it("shows failure warning when last command failed", () => {
    const tracker = new ShellSessionTracker("/tmp");
    tracker.record("tsc --noEmit", { exitCode: 2, stderr: "errors found" });
    const ctx = tracker.formatForContext();
    expect(ctx).toContain("Last command failed");
  });

  it("does not show failure warning on success", () => {
    const tracker = new ShellSessionTracker("/tmp");
    tracker.record("echo ok", { exitCode: 0 });
    const ctx = tracker.formatForContext();
    expect(ctx).not.toContain("Last command failed");
  });

  it("includes env changes section when env differs from baseline", () => {
    const tracker = new ShellSessionTracker("/tmp", { baselineEnv: {} });
    tracker.setEnv("DEBUG", "1");
    const ctx = tracker.formatForContext();
    expect(ctx).toContain("Environment changes");
    expect(ctx).toContain("DEBUG=1");
  });
});

// ─── ShellSessionTracker — getCompactHistory ─────────────────────────────────

describe("ShellSessionTracker — getCompactHistory", () => {
  it("returns last N commands as compact lines", () => {
    const tracker = new ShellSessionTracker("/tmp");
    tracker.record("cmd1", { exitCode: 0 });
    tracker.record("cmd2", { exitCode: 1 });
    tracker.record("cmd3", { exitCode: 0 });
    const compact = tracker.getCompactHistory(2);
    expect(compact).toContain("cmd2");
    expect(compact).toContain("cmd3");
    expect(compact).not.toContain("cmd1");
  });

  it("uses ✓ for success and ✗ for failure", () => {
    const tracker = new ShellSessionTracker("/tmp");
    tracker.record("pass", { exitCode: 0 });
    tracker.record("fail", { exitCode: 1 });
    const compact = tracker.getCompactHistory(2);
    expect(compact).toContain("✓");
    expect(compact).toContain("✗");
  });
});

// ─── ShellSessionTracker — clearHistory ──────────────────────────────────────

describe("ShellSessionTracker — clearHistory", () => {
  it("clears all recorded commands", () => {
    const tracker = new ShellSessionTracker("/tmp");
    tracker.record("cmd", { exitCode: 0 });
    expect(tracker.snapshot().history).toHaveLength(1);

    tracker.clearHistory();
    expect(tracker.snapshot().history).toHaveLength(0);
  });
});

// ─── globalShellTracker and recordBashExecution ───────────────────────────────

describe("globalShellTracker and recordBashExecution", () => {
  it("globalShellTracker is a ShellSessionTracker instance", () => {
    expect(globalShellTracker).toBeInstanceOf(ShellSessionTracker);
  });

  it("recordBashExecution adds to globalShellTracker history", () => {
    const sizeBefore = globalShellTracker.snapshot().history.length;
    recordBashExecution("echo test", { exitCode: 0, stdout: "test" });
    expect(globalShellTracker.snapshot().history.length).toBeGreaterThan(sizeBefore);
  });
});
