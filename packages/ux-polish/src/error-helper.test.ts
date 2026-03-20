/**
 * error-helper.test.ts — @dantecode/ux-polish
 */

import { describe, it, expect } from "vitest";
import { ErrorHelper, formatHelpfulError, classifyErrorMessage } from "./error-helper.js";
import { ThemeEngine } from "./theme-engine.js";

const noColor = new ThemeEngine({ colors: false });

describe("ErrorHelper.classify()", () => {
  const h = new ErrorHelper({ theme: noColor });

  it("classifies TypeScript errors", () => {
    const r = h.classify("TS2345: Type 'string' is not assignable to type 'number'");
    expect(r.title).toBe("TypeScript Error");
    expect(r.transient).toBe(false);
    expect(r.nextSteps.length).toBeGreaterThan(0);
  });

  it("classifies ESLint errors", () => {
    const r = h.classify("ESLint: no-unused-vars");
    expect(r.title).toBe("ESLint Lint Error");
  });

  it("classifies test failures", () => {
    const r = h.classify("AssertionError: expected 1 to equal 2");
    expect(r.title).toBe("Test Failure");
  });

  it("classifies API errors", () => {
    const r = h.classify("401 Unauthorized: invalid_api_key");
    expect(r.title).toBe("API / LLM Error");
    expect(r.transient).toBe(true);
  });

  it("classifies git errors", () => {
    const r = h.classify("fatal: not a git repository");
    expect(r.title).toBe("Git Error");
  });

  it("classifies network errors", () => {
    const r = h.classify("ECONNREFUSED connect ECONNREFUSED 127.0.0.1:3000");
    expect(r.title).toBe("Network Error");
    expect(r.transient).toBe(true);
  });

  it("classifies permission errors", () => {
    const r = h.classify("EACCES: permission denied, open '/etc/passwd'");
    expect(r.title).toBe("Permission Denied");
  });

  it("classifies not-found errors", () => {
    const r = h.classify("ENOENT: no such file or directory, open 'missing.ts'");
    expect(r.title).toBe("File / Module Not Found");
  });

  it("classifies timeout errors", () => {
    const r = h.classify("Error: timed out after 30000ms");
    expect(r.title).toBe("Operation Timeout");
  });

  it("falls back to 'Unexpected Error' for unknown messages", () => {
    const r = h.classify("something totally unrecognized blah blah");
    expect(r.title).toBe("Unexpected Error");
    expect(r.nextSteps.length).toBeGreaterThan(0);
  });
});

describe("ErrorHelper.format()", () => {
  const h = new ErrorHelper({ theme: noColor });

  it("includes title and next steps", () => {
    const analysis = h.classify("TS1234: error");
    const formatted = h.format(analysis);
    expect(formatted).toContain("TypeScript Error");
    expect(formatted).toContain("Next steps:");
  });

  it("includes transient badge for transient errors", () => {
    const analysis = h.classify("429 rate limit exceeded");
    const formatted = h.format(analysis);
    expect(formatted).toContain("transient");
  });

  it("includes PDSE hint when present", () => {
    const analysis = h.classify("TS9999: type error");
    const formatted = h.format(analysis);
    if (analysis.confidenceHint) {
      expect(formatted).toContain("PDSE hint");
    }
  });
});

describe("ErrorHelper with PDSE context", () => {
  it("adds PDSE score to confidence hint", () => {
    const h = new ErrorHelper({ theme: noColor });
    const r = h.classify("ENOENT: no such file", { pdseScore: 0.3 });
    expect(r.confidenceHint).toContain("0.30");
  });
});

describe("formatHelpfulError() convenience function", () => {
  it("formats a string error", () => {
    const result = formatHelpfulError("TS2345: type mismatch");
    expect(result).toContain("TypeScript Error");
  });

  it("formats an Error object", () => {
    const result = formatHelpfulError(new Error("ENOENT: no such file"));
    expect(result).toContain("File / Module Not Found");
  });
});

describe("classifyErrorMessage() convenience function", () => {
  it("returns a structured ErrorHelpResult", () => {
    const result = classifyErrorMessage("AssertionError: expected 3 to equal 4");
    expect(result.title).toBe("Test Failure");
    expect(result.nextSteps).toHaveLength(3);
  });
});
