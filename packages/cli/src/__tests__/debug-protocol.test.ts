// ============================================================================
// packages/cli/src/__tests__/debug-protocol.test.ts
//
// Unit tests for the debug protocol: error classification, prompt generation,
// and escalation detection.
//
// Design rules:
//   - Zero mocks — all tests call the real exported functions
//   - Every classification test checks the exact ErrorClass string
//   - Every prompt test checks for expected substrings (not exact match)
// ============================================================================

import { describe, it, expect } from "vitest";
import {
  classifyError,
  buildDebugPrompt,
  shouldEscalateToRepairLoop,
  type ErrorClass,
  type ErrorRecord,
} from "../debug-protocol.js";

// ---------------------------------------------------------------------------
// 1. classifyError — TypeScript errors
// ---------------------------------------------------------------------------

describe("classifyError — TypescriptError", () => {
  it("classifies TS error code pattern (TS2345)", () => {
    expect(classifyError("error TS2345: Argument of type 'string'", 1)).toBe("TypescriptError");
  });

  it("classifies 'cannot find name' pattern", () => {
    expect(classifyError("error: Cannot find name 'foo'.", 1)).toBe("TypescriptError");
  });

  it("classifies 'is not assignable to type' pattern", () => {
    expect(classifyError("Type 'number' is not assignable to type 'string'", 1)).toBe(
      "TypescriptError",
    );
  });
});

// ---------------------------------------------------------------------------
// 2. classifyError — ModuleNotFound
// ---------------------------------------------------------------------------

describe("classifyError — ModuleNotFound", () => {
  it("classifies 'Cannot find module' pattern", () => {
    expect(classifyError("Cannot find module '@dantecode/core'", 1)).toBe("ModuleNotFound");
  });

  it("classifies 'Module not found' pattern (webpack/vite)", () => {
    expect(classifyError("Module not found: Error: Can't resolve './foo'", 1)).toBe(
      "ModuleNotFound",
    );
  });
});

// ---------------------------------------------------------------------------
// 3. classifyError — TestFailure
// ---------------------------------------------------------------------------

describe("classifyError — TestFailure", () => {
  it("classifies vitest expected/received pattern", () => {
    expect(classifyError("Expected: 42\nReceived: 0", 1)).toBe("TestFailure");
  });

  it("classifies 'test failed' pattern", () => {
    expect(classifyError("test failed: should return correct value", 1)).toBe("TestFailure");
  });
});

// ---------------------------------------------------------------------------
// 4. classifyError — NetworkError
// ---------------------------------------------------------------------------

describe("classifyError — NetworkError", () => {
  it("classifies ENOTFOUND pattern", () => {
    expect(classifyError("Error: getaddrinfo ENOTFOUND api.example.com", 1)).toBe("NetworkError");
  });

  it("classifies ECONNREFUSED pattern", () => {
    expect(classifyError("Error: connect ECONNREFUSED 127.0.0.1:3000", 1)).toBe("NetworkError");
  });

  it("classifies curl exit code 6 (host not found)", () => {
    expect(classifyError("", 6)).toBe("NetworkError");
  });
});

// ---------------------------------------------------------------------------
// 5. classifyError — PermissionError
// ---------------------------------------------------------------------------

describe("classifyError — PermissionError", () => {
  it("classifies 'permission denied' pattern", () => {
    expect(classifyError("Error: EACCES: permission denied, open '/etc/hosts'", 1)).toBe(
      "PermissionError",
    );
  });

  it("classifies exit code 126 (not executable)", () => {
    expect(classifyError("bash: ./script.sh: Permission denied", 126)).toBe("PermissionError");
  });
});

// ---------------------------------------------------------------------------
// 6. classifyError — SyntaxError
// ---------------------------------------------------------------------------

describe("classifyError — SyntaxError", () => {
  it("classifies 'SyntaxError: Unexpected token' pattern", () => {
    expect(classifyError("SyntaxError: Unexpected token '}'", 1)).toBe("SyntaxError");
  });
});

// ---------------------------------------------------------------------------
// 7. classifyError — UnknownError fallback
// ---------------------------------------------------------------------------

describe("classifyError — UnknownError", () => {
  it("returns UnknownError for unrecognized output", () => {
    expect(classifyError("something unexpected happened", 1)).toBe("UnknownError");
  });

  it("returns UnknownError for empty stderr with exit code 1", () => {
    expect(classifyError("", 1)).toBe("UnknownError");
  });
});

// ---------------------------------------------------------------------------
// 8. buildDebugPrompt
// ---------------------------------------------------------------------------

describe("buildDebugPrompt", () => {
  it("includes the diagnosis protocol for TypescriptError", () => {
    const result = buildDebugPrompt("TypescriptError", "npm run typecheck", "TS2345 error");
    expect(result).toContain("TypeScript Error");
    expect(result).toContain("npm run typecheck");
    expect(result).toContain("TS2345 error");
  });

  it("includes the diagnosis protocol for TestFailure", () => {
    const result = buildDebugPrompt("TestFailure", "npx vitest run", "Expected: 1\nReceived: 2");
    expect(result).toContain("Test Failure");
    expect(result).toContain("Expected: 1");
  });

  it("truncates very long error output to 800 characters", () => {
    const longOutput = "x".repeat(2000);
    const result = buildDebugPrompt("UnknownError", "some-command", longOutput);
    expect(result).toContain("...(truncated)");
    // The output section should not contain the full 2000-char string
    expect(result.length).toBeLessThan(1500);
  });

  it("includes the failed command in backticks", () => {
    const result = buildDebugPrompt("NetworkError", "curl https://example.com", "ENOTFOUND");
    expect(result).toContain("`curl https://example.com`");
  });
});

// ---------------------------------------------------------------------------
// 9. shouldEscalateToRepairLoop
// ---------------------------------------------------------------------------

describe("shouldEscalateToRepairLoop", () => {
  function makeRecord(errorClass: ErrorClass): ErrorRecord {
    return {
      command: "npm run build",
      stderr: "error",
      exitCode: 1,
      errorClass,
      timestamp: Date.now(),
    };
  }

  it("returns false when fewer than 3 records", () => {
    const history = [makeRecord("TypescriptError"), makeRecord("TypescriptError")];
    expect(shouldEscalateToRepairLoop(history)).toBe(false);
  });

  it("returns true when same error class appears 3+ times in recent history", () => {
    const history = [
      makeRecord("TypescriptError"),
      makeRecord("TypescriptError"),
      makeRecord("TypescriptError"),
    ];
    expect(shouldEscalateToRepairLoop(history)).toBe(true);
  });

  it("returns false when errors are mixed (no single class >= 3)", () => {
    const history = [
      makeRecord("TypescriptError"),
      makeRecord("TestFailure"),
      makeRecord("NetworkError"),
      makeRecord("TypescriptError"),
    ];
    expect(shouldEscalateToRepairLoop(history)).toBe(false);
  });

  it("considers only the last 5 records", () => {
    // 3 early TypescriptErrors + 4 different recent errors = should NOT escalate
    const history = [
      makeRecord("TypescriptError"),
      makeRecord("TypescriptError"),
      makeRecord("TypescriptError"),
      makeRecord("NetworkError"),
      makeRecord("TestFailure"),
      makeRecord("SyntaxError"),
      makeRecord("UnknownError"),
    ];
    expect(shouldEscalateToRepairLoop(history)).toBe(false);
  });
});
