// packages/core/src/__tests__/error-recovery-router.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  classifyError,
  getRecoveryStrategy,
  ErrorRecoveryRouter,
  globalErrorRecoveryRouter,
  type ErrorClass,
} from "../error-recovery-router.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRouter(): ErrorRecoveryRouter {
  return new ErrorRecoveryRouter();
}

// ─── classifyError ────────────────────────────────────────────────────────────

describe("classifyError", () => {
  it("classifies SyntaxError as 'syntax'", () => {
    expect(classifyError("SyntaxError: Unexpected token '}'").errorClass).toBe("syntax");
  });

  it("classifies TypeScript error codes as 'syntax'", () => {
    expect(classifyError("error TS2322: Type 'string' is not assignable").errorClass).toBe("syntax");
  });

  it("classifies TypeError as 'type'", () => {
    expect(classifyError("TypeError: Cannot read properties of undefined").errorClass).toBe("type");
  });

  it("classifies 'command not found' as 'environment'", () => {
    expect(classifyError("bash: node: command not found").errorClass).toBe("environment");
  });

  it("classifies ENOENT as 'not-found'", () => {
    expect(classifyError("Error: ENOENT: no such file or directory").errorClass).toBe("not-found");
  });

  it("classifies EACCES as 'permission'", () => {
    expect(classifyError("Error: EACCES: permission denied").errorClass).toBe("permission");
  });

  it("classifies timeout as 'network'", () => {
    expect(classifyError("Error: Connection timeout after 30000ms").errorClass).toBe("network");
  });

  it("classifies 429 as 'rate-limit'", () => {
    expect(classifyError("HTTP 429 Too Many Requests").errorClass).toBe("rate-limit");
  });

  it("classifies unknown error as 'unknown'", () => {
    expect(classifyError("Something went wrong, try again.").errorClass).toBe("unknown");
  });

  it("extracts file path from error message", () => {
    const fp = classifyError("SyntaxError in src/index.ts:10:5: unexpected token").filePath;
    expect(fp).toContain("src/index.ts");
  });

  it("extracts line number from error", () => {
    const ln = classifyError("error TS2322: src/a.ts:42:10 type mismatch").lineNumber;
    expect(ln).toBe(42);
  });

  it("raw field contains original error string", () => {
    const raw = "some original error";
    expect(classifyError(raw).raw).toBe(raw);
  });
});

// ─── getRecoveryStrategy ──────────────────────────────────────────────────────

describe("getRecoveryStrategy", () => {
  it("syntax errors have fix-code as primary", () => {
    expect(getRecoveryStrategy("syntax").primary).toBe("fix-code");
  });

  it("network errors have retry-backoff as primary", () => {
    expect(getRecoveryStrategy("network").primary).toBe("retry-backoff");
  });

  it("permission errors have elevate as primary", () => {
    expect(getRecoveryStrategy("permission").primary).toBe("elevate");
  });

  it("rate-limit has abort as fallback", () => {
    expect(getRecoveryStrategy("rate-limit").fallback).toBe("abort");
  });

  it("network has positive baseDelayMs", () => {
    expect(getRecoveryStrategy("network").baseDelayMs).toBeGreaterThan(0);
  });

  it("all classes have a rationale string", () => {
    const classes: ErrorClass[] = ["syntax", "type", "runtime", "environment", "network", "permission", "not-found", "rate-limit", "unknown"];
    for (const cls of classes) {
      expect(getRecoveryStrategy(cls).rationale.length).toBeGreaterThan(0);
    }
  });
});

// ─── ErrorRecoveryRouter ──────────────────────────────────────────────────────

describe("ErrorRecoveryRouter", () => {
  let router: ErrorRecoveryRouter;

  beforeEach(() => { router = makeRouter(); });

  it("startSession returns a session with fingerprint", () => {
    const session = router.startSession("SyntaxError: bad token");
    expect(session.fingerprint.errorClass).toBe("syntax");
    expect(session.id).toBeTruthy();
  });

  it("totalSessions increments on each start", () => {
    router.startSession("SyntaxError");
    router.startSession("TypeError");
    expect(router.totalSessions).toBe(2);
  });

  it("activeSessions excludes resolved sessions", () => {
    const s = router.startSession("ENOENT no such file");
    router.recordAttempt(s.id, "clarify", "success");
    expect(router.activeSessions.some((x) => x.id === s.id)).toBe(false);
  });

  it("nextAction returns primary on first attempt", () => {
    const s = router.startSession("SyntaxError: bad");
    expect(router.nextAction(s.id)).toBe("fix-code");
  });

  it("nextAction returns fallback after maxAttempts failures", () => {
    const s = router.startSession("SyntaxError: x");
    const strategy = s.strategy;
    for (let i = 0; i < strategy.maxAttempts; i++) {
      router.recordAttempt(s.id, strategy.primary, "failure");
    }
    expect(router.nextAction(s.id)).toBe(strategy.fallback);
  });

  it("nextAction returns undefined after resolution", () => {
    const s = router.startSession("SyntaxError");
    router.recordAttempt(s.id, "fix-code", "success");
    expect(router.nextAction(s.id)).toBeUndefined();
  });

  it("recordAttempt marks session resolved on success", () => {
    const s = router.startSession("SyntaxError");
    router.recordAttempt(s.id, "fix-code", "success");
    expect(router.getSession(s.id)!.resolved).toBe(true);
  });

  it("recordAttempt marks session resolved on abort", () => {
    const s = router.startSession("SyntaxError");
    router.recordAttempt(s.id, "abort", "failure");
    expect(router.getSession(s.id)!.resolved).toBe(true);
  });

  it("computeBackoffMs doubles with each failure", () => {
    const s = router.startSession("Connection timeout");
    const base = s.strategy.baseDelayMs;
    router.recordAttempt(s.id, "retry-backoff", "failure");
    const delay1 = router.computeBackoffMs(s.id);
    router.recordAttempt(s.id, "retry-backoff", "failure");
    const delay2 = router.computeBackoffMs(s.id);
    expect(delay1).toBe(base * 2);
    expect(delay2).toBe(base * 4);
  });

  it("computeBackoffMs returns 0 for no-delay strategies", () => {
    const s = router.startSession("SyntaxError");
    expect(router.computeBackoffMs(s.id)).toBe(0);
  });

  it("formatSessionForPrompt includes error class", () => {
    const s = router.startSession("SyntaxError: missing semicolon");
    const output = router.formatSessionForPrompt(s.id);
    expect(output).toContain("syntax");
  });

  it("formatSessionForPrompt includes attempt count after recording", () => {
    const s = router.startSession("SyntaxError");
    router.recordAttempt(s.id, "fix-code", "failure", "still broken");
    const output = router.formatSessionForPrompt(s.id);
    expect(output).toContain("Attempt 1");
  });

  it("formatSessionForPrompt returns not-found message for unknown id", () => {
    expect(router.formatSessionForPrompt("no-such")).toContain("not found");
  });

  it("getSession returns undefined for unknown id", () => {
    expect(router.getSession("bogus")).toBeUndefined();
  });
});

// ─── globalErrorRecoveryRouter ────────────────────────────────────────────────

describe("globalErrorRecoveryRouter", () => {
  it("is an ErrorRecoveryRouter instance", () => {
    expect(globalErrorRecoveryRouter).toBeInstanceOf(ErrorRecoveryRouter);
  });
});
