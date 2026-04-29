// Tests for input-validation primitives. Covers path traversal blocking,
// SSRF guards, shell-meta detection, HTML escaping, JSON size limits, and
// the throwing variants integrating with ValidationError.

import { describe, it, expect } from "vitest";
import {
  validateRelativePath,
  assertValidRelativePath,
  validateHttpUrl,
  assertValidHttpUrl,
  validateProvider,
  containsShellMeta,
  validateShellArg,
  escapeHtml,
  validateBoundedString,
  parseJsonBounded,
} from "./input-validation.js";
import { ValidationError } from "./errors.js";

describe("validateRelativePath", () => {
  it("accepts a clean relative path", () => {
    const r = validateRelativePath("src/foo/bar.ts");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe("src/foo/bar.ts");
  });

  it("normalizes backslashes and double slashes", () => {
    const r = validateRelativePath("src\\foo//bar.ts");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe("src/foo/bar.ts");
  });

  it("strips leading ./", () => {
    const r = validateRelativePath("./src/foo.ts");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe("src/foo.ts");
  });

  it("rejects parent traversal segments", () => {
    const r = validateRelativePath("../../etc/passwd");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/parent traversal/);
  });

  it("rejects parent traversal mixed with other segments", () => {
    expect(validateRelativePath("src/../../../etc").ok).toBe(false);
  });

  it("rejects POSIX absolute paths", () => {
    expect(validateRelativePath("/etc/passwd").ok).toBe(false);
  });

  it("rejects Windows absolute paths", () => {
    expect(validateRelativePath("C:\\Windows\\System32").ok).toBe(false);
    expect(validateRelativePath("D:/foo/bar").ok).toBe(false);
  });

  it("rejects null bytes", () => {
    expect(validateRelativePath("src/foo\0bar").ok).toBe(false);
  });

  it("rejects empty input", () => {
    expect(validateRelativePath("").ok).toBe(false);
  });

  it("rejects non-string input", () => {
    expect(validateRelativePath(42 as unknown as string).ok).toBe(false);
  });

  it("permits dotfiles like .gitignore", () => {
    const r = validateRelativePath(".gitignore");
    expect(r.ok).toBe(true);
  });

  it("rejects hidden traversal-like segments", () => {
    expect(validateRelativePath("..config/secret").ok).toBe(false);
  });
});

describe("assertValidRelativePath", () => {
  it("returns the path on success", () => {
    expect(assertValidRelativePath("src/foo.ts")).toBe("src/foo.ts");
  });

  it("throws ValidationError on failure", () => {
    expect(() => assertValidRelativePath("../etc/passwd")).toThrow(ValidationError);
  });

  it("uses fieldName in the thrown error", () => {
    try {
      assertValidRelativePath("../etc", "configPath");
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).message).toMatch(/configPath/);
    }
  });
});

describe("validateHttpUrl", () => {
  it("accepts valid https URLs", () => {
    const r = validateHttpUrl("https://example.com/path");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.hostname).toBe("example.com");
  });

  it("accepts plain http URLs", () => {
    expect(validateHttpUrl("http://example.com").ok).toBe(true);
  });

  it("rejects file:// protocol", () => {
    expect(validateHttpUrl("file:///etc/passwd").ok).toBe(false);
  });

  it("rejects javascript: protocol", () => {
    expect(validateHttpUrl("javascript:alert(1)").ok).toBe(false);
  });

  it("rejects data: protocol", () => {
    expect(validateHttpUrl("data:text/html,<script>alert(1)</script>").ok).toBe(false);
  });

  it("rejects malformed URL", () => {
    expect(validateHttpUrl("not-a-url").ok).toBe(false);
  });

  it("rejects localhost by default", () => {
    expect(validateHttpUrl("http://localhost:3000").ok).toBe(false);
    expect(validateHttpUrl("http://127.0.0.1").ok).toBe(false);
    expect(validateHttpUrl("http://[::1]").ok).toBe(false);
  });

  it("permits localhost when opted in", () => {
    expect(validateHttpUrl("http://localhost:3000", { allowLocalhost: true }).ok).toBe(true);
  });

  it("rejects RFC1918 private ranges (SSRF protection)", () => {
    expect(validateHttpUrl("http://10.0.0.1").ok).toBe(false);
    expect(validateHttpUrl("http://192.168.1.1").ok).toBe(false);
    expect(validateHttpUrl("http://172.16.0.1").ok).toBe(false);
    expect(validateHttpUrl("http://172.31.255.255").ok).toBe(false);
    expect(validateHttpUrl("http://169.254.169.254").ok).toBe(false); // AWS metadata
  });

  it("permits public IPs that look adjacent to private ranges", () => {
    expect(validateHttpUrl("http://172.15.0.1").ok).toBe(true);
    expect(validateHttpUrl("http://172.32.0.1").ok).toBe(true);
  });
});

describe("assertValidHttpUrl", () => {
  it("returns parsed URL on success", () => {
    const u = assertValidHttpUrl("https://example.com");
    expect(u.hostname).toBe("example.com");
  });

  it("throws ValidationError on failure", () => {
    expect(() => assertValidHttpUrl("file:///etc/passwd")).toThrow(ValidationError);
  });
});

describe("validateProvider", () => {
  it("accepts known providers (case-insensitive)", () => {
    expect(validateProvider("anthropic").ok).toBe(true);
    expect(validateProvider("OpenAI").ok).toBe(true);
    expect(validateProvider("  GROK  ").ok).toBe(true);
  });

  it("rejects unknown providers", () => {
    const r = validateProvider("evilcorp");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/unknown provider/);
  });

  it("rejects path-traversal-style provider strings", () => {
    expect(validateProvider("../etc/passwd").ok).toBe(false);
    expect(validateProvider("javascript:alert(1)").ok).toBe(false);
  });

  it("normalizes to lowercase", () => {
    const r = validateProvider("Anthropic");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe("anthropic");
  });
});

describe("containsShellMeta / validateShellArg", () => {
  it("detects command separators", () => {
    expect(containsShellMeta("rm -rf /; ls")).toBe(true);
    expect(containsShellMeta("foo && bar")).toBe(true);
    expect(containsShellMeta("foo || bar")).toBe(true);
    expect(containsShellMeta("foo | bar")).toBe(true);
  });

  it("detects command substitution", () => {
    expect(containsShellMeta("`whoami`")).toBe(true);
    expect(containsShellMeta("$(whoami)")).toBe(true);
  });

  it("detects redirection", () => {
    expect(containsShellMeta("cat foo > bar")).toBe(true);
    expect(containsShellMeta("cat < /etc/passwd")).toBe(true);
  });

  it("permits clean arguments", () => {
    expect(containsShellMeta("hello-world.txt")).toBe(false);
    expect(containsShellMeta("--flag=value")).toBe(false);
  });

  it("validateShellArg returns reason on failure", () => {
    const r = validateShellArg("foo; rm -rf /");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/metacharacters/);
  });
});

describe("escapeHtml", () => {
  it("escapes the standard XSS-relevant characters", () => {
    expect(escapeHtml("<script>alert(1)</script>")).toBe(
      "&lt;script&gt;alert(1)&lt;&#x2F;script&gt;",
    );
  });

  it("escapes ampersands first to avoid double-encoding", () => {
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });

  it("escapes quotes (both single and double)", () => {
    expect(escapeHtml(`"foo" 'bar'`)).toBe("&quot;foo&quot; &#39;bar&#39;");
  });

  it("returns empty string for non-string input", () => {
    expect(escapeHtml(null as unknown as string)).toBe("");
    expect(escapeHtml(undefined as unknown as string)).toBe("");
  });
});

describe("validateBoundedString", () => {
  it("accepts strings within bounds", () => {
    expect(validateBoundedString("hello", { max: 100 }).ok).toBe(true);
  });

  it("rejects too-long strings", () => {
    const r = validateBoundedString("x".repeat(101), { max: 100 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/too long/);
  });

  it("rejects too-short strings", () => {
    const r = validateBoundedString("hi", { min: 5, max: 100 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/too short/);
  });

  it("respects fieldName in error message", () => {
    const r = validateBoundedString("", { min: 1, max: 10, fieldName: "username" });
    if (!r.ok) expect(r.reason).toMatch(/username/);
  });
});

describe("parseJsonBounded", () => {
  it("parses valid JSON", () => {
    const r = parseJsonBounded<{ a: number }>('{"a":1}');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.a).toBe(1);
  });

  it("rejects oversized input", () => {
    const big = JSON.stringify({ data: "x".repeat(2000) });
    const r = parseJsonBounded(big, { maxBytes: 100 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/exceeds/);
  });

  it("returns structured reason on parse failure", () => {
    const r = parseJsonBounded("{not-json");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/JSON parse failed/);
  });
});
