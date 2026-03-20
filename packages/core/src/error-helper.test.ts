import { describe, it, expect } from "vitest";
import { ErrorHelper, errorHelper } from "./error-helper.js";

describe("ErrorHelper", () => {
  const helper = new ErrorHelper({ colors: false });

  // 1. TypeScript error classification
  it("classifies TS errors by TS code pattern", () => {
    const a = helper.classify("TS2345: Argument of type 'string' is not assignable to type 'number'");
    expect(a.kind).toBe("typescript");
    expect(a.title).toBe("TypeScript Error");
    expect(a.transient).toBe(false);
  });

  // 2. ESLint classification
  it("classifies ESLint errors", () => {
    const a = helper.classify("ESLint: no-unused-vars — 'foo' is defined but never used.");
    expect(a.kind).toBe("eslint");
  });

  // 3. Test failure classification
  it("classifies AssertionError as test failure", () => {
    const a = helper.classify("AssertionError: expected 42 to equal 43");
    expect(a.kind).toBe("test");
    expect(a.pdseHint).toBeTruthy();
  });

  // 4. API error (401)
  it("classifies 401 as api error (transient)", () => {
    const a = helper.classify("Error: 401 Unauthorized — invalid_api_key");
    expect(a.kind).toBe("api");
    expect(a.transient).toBe(true);
  });

  // 5. Rate limit
  it("classifies 429 rate limit as api/transient", () => {
    const a = helper.classify("HTTP 429: rate_limit exceeded, retry after 60s");
    expect(a.kind).toBe("api");
    expect(a.transient).toBe(true);
  });

  // 6. Git error
  it("classifies 'nothing to commit' as git error", () => {
    const a = helper.classify("fatal: nothing to commit, working tree clean");
    expect(a.kind).toBe("git");
  });

  // 7. Network error (ECONNREFUSED)
  it("classifies ECONNREFUSED as network/transient", () => {
    const a = helper.classify("Error: connect ECONNREFUSED 127.0.0.1:3000");
    expect(a.kind).toBe("network");
    expect(a.transient).toBe(true);
  });

  // 8. ENOENT → not_found
  it("classifies ENOENT as not_found", () => {
    const a = helper.classify("ENOENT: no such file or directory, open './dist/index.js'");
    expect(a.kind).toBe("not_found");
  });

  // 9. Permission denied
  it("classifies EACCES as permission error", () => {
    const a = helper.classify("Error: EACCES: permission denied, mkdir '/var/log/dante'");
    expect(a.kind).toBe("permission");
  });

  // 10. Timeout
  it("classifies timeout errors", () => {
    const a = helper.classify("Error: operation timed out after 30000ms");
    expect(a.kind).toBe("timeout");
    expect(a.transient).toBe(true);
  });

  // 11. Unknown error fallback
  it("falls back to unknown for unrecognized errors", () => {
    const a = helper.classify("Something weird happened with the flux capacitor");
    expect(a.kind).toBe("unknown");
    expect(a.suggestions.length).toBeGreaterThan(0);
  });

  // 12. format produces actionable output
  it("format() includes title and suggestions", () => {
    const out = helper.format("TS2304: Cannot find name 'foo'");
    expect(out).toContain("TypeScript Error");
    expect(out).toContain("Next steps:");
    expect(out).toContain("1.");
  });

  // 13. format includes PDSE hint for test failures
  it("format() includes PDSE hint for test failures", () => {
    const out = helper.format("AssertionError: expected true to be false");
    expect(out).toContain("PDSE hint:");
  });

  // 14. formatError convenience wrapper
  it("formatError() is equivalent to format(classify(msg))", () => {
    const msg = "TS2345: Type mismatch";
    expect(helper.formatError(msg)).toBe(helper.format(helper.classify(msg)));
  });

  // 15. getSuggestions returns array
  it("getSuggestions() returns non-empty array", () => {
    const suggestions = helper.getSuggestions("ENOENT: no such file");
    expect(Array.isArray(suggestions)).toBe(true);
    expect(suggestions.length).toBeGreaterThan(0);
  });

  // 16. isTransient
  it("isTransient() returns true for rate-limit errors", () => {
    expect(helper.isTransient("HTTP 429 rate_limit")).toBe(true);
  });

  it("isTransient() returns false for TypeScript errors", () => {
    expect(helper.isTransient("TS2345: type mismatch")).toBe(false);
  });

  // 17. singleton export
  it("errorHelper singleton is an ErrorHelper instance", () => {
    expect(errorHelper).toBeInstanceOf(ErrorHelper);
  });

  // 18. colors disabled strips ANSI
  it("format() with colors:false produces no ANSI codes", () => {
    const out = helper.formatError("TS2345: type error");
    expect(out).not.toContain("\x1b[");
  });

  // 19. colors enabled helper includes ANSI
  it("format() with colors:true includes ANSI codes", () => {
    const colorHelper = new ErrorHelper({ colors: true });
    const out = colorHelper.formatError("TS2345: type error");
    expect(out).toContain("\x1b[");
  });

  // 20. classify returns suggestions >= 1
  it("all error kinds have at least 1 suggestion", () => {
    const messages = [
      "TS2345: type error",
      "ESLint: no-unused-vars",
      "AssertionError: expected x to equal y",
      "401 Unauthorized",
      "fatal: not a git repository",
      "ECONNREFUSED",
      "ENOENT",
      "EACCES",
      "timed out",
      "unknown flux error",
    ];
    for (const msg of messages) {
      const a = helper.classify(msg);
      expect(a.suggestions.length).toBeGreaterThan(0);
    }
  });
});
