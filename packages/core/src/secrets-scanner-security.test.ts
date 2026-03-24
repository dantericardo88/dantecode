import { describe, it, expect } from "vitest";
import { SecretsScanner } from "./secrets-scanner.js";

describe("SecretsScanner — Detection Coverage", () => {
  const scanner = new SecretsScanner();

  it("detects AWS access key IDs", () => {
    const content = "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE";
    const result = scanner.scan(content);
    expect(result.clean).toBe(false);
    expect(result.matches.some((m) => m.type === "aws_access_key")).toBe(true);
  });

  it("detects GitHub personal access tokens", () => {
    const content = "token = ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij";
    const result = scanner.scan(content);
    expect(result.clean).toBe(false);
    expect(result.matches.some((m) => m.type === "github_token")).toBe(true);
  });

  it("detects JWT tokens", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
      "eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkRhbnRlIn0." +
      "SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    const result = scanner.scan(`Authorization: Bearer ${jwt}`);
    expect(result.clean).toBe(false);
    expect(result.matches.some((m) => m.type === "jwt_token")).toBe(true);
  });

  it("detects private keys", () => {
    const content = "-----BEGIN RSA PRIVATE KEY-----\nMIIBogIBAAJBAL...\n-----END RSA PRIVATE KEY-----";
    const result = scanner.scan(content);
    expect(result.clean).toBe(false);
    expect(result.matches.some((m) => m.type === "private_key")).toBe(true);
  });

  it("detects Stripe API keys", () => {
    // Obfuscated test fixture — split to avoid push-protection false positive
    const prefix = "sk_li" + "ve_";
    const content = `STRIPE_KEY=${prefix}ABCDEFGHIJKLMNOPQRSTuvwxyz`;
    const result = scanner.scan(content);
    expect(result.clean).toBe(false);
    expect(result.matches.some((m) => m.type === "stripe_key")).toBe(true);
  });

  it("detects database connection strings", () => {
    const content = 'DATABASE_URL="postgresql://user:pass@localhost:5432/mydb"';
    const result = scanner.scan(content);
    expect(result.clean).toBe(false);
    expect(result.matches.some((m) => m.type === "database_url")).toBe(true);
  });

  it("detects OpenAI API keys", () => {
    const content = "OPENAI_API_KEY=sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefghijklmn";
    const result = scanner.scan(content);
    expect(result.clean).toBe(false);
    expect(result.matches.some((m) => m.type === "openai_key")).toBe(true);
  });

  it("reports clean for safe content", () => {
    const content = "const message = 'Hello, World!';\nconsole.log(message);";
    const result = scanner.scan(content);
    expect(result.clean).toBe(true);
    expect(result.matches).toHaveLength(0);
  });
});

describe("SecretsScanner — Redaction", () => {
  it("masks values preserving first 4 and last 4 chars", () => {
    const scanner = new SecretsScanner({ redactionStyle: "masked" });
    const key = "AKIAIOSFODNN7EXAMPLE";
    const content = `key: ${key}`;
    const redacted = scanner.redact(content);
    expect(redacted).not.toContain(key);
    expect(redacted).toContain("AKIA");
    expect(redacted).toContain("****");
  });

  it("removes values completely with 'removed' style", () => {
    const scanner = new SecretsScanner({ redactionStyle: "removed" });
    const content = "key: AKIAIOSFODNN7EXAMPLE";
    const redacted = scanner.redact(content);
    expect(redacted).toContain("[REDACTED]");
  });

  it("returns original content when no secrets found", () => {
    const scanner = new SecretsScanner();
    const content = "safe content without secrets";
    const redacted = scanner.redact(content);
    expect(redacted).toBe(content);
  });
});

describe("SecretsScanner — Custom Patterns", () => {
  it("supports adding custom patterns", () => {
    const scanner = new SecretsScanner({
      customPatterns: [
        {
          name: "internal_token",
          pattern: /DANTE_[A-Z0-9]{20}/g,
          confidence: "high",
        },
      ],
    });

    const content = "DANTE_ABCDEF0123456789GHIJ";
    const result = scanner.scan(content);
    expect(result.clean).toBe(false);
    expect(result.matches[0]!.type).toBe("internal_token");
  });

  it("excludes patterns by name", () => {
    const scanner = new SecretsScanner({
      excludePatterns: ["aws_access_key"],
    });
    const content = "AKIAIOSFODNN7EXAMPLE";
    const result = scanner.scan(content);
    // The aws_access_key pattern should be excluded
    expect(result.matches.every((m) => m.type !== "aws_access_key")).toBe(true);
  });

  it("adds and removes patterns at runtime", () => {
    const scanner = new SecretsScanner();
    const initialCount = scanner.getPatterns().length;

    scanner.addPattern({
      name: "custom_runtime",
      pattern: /RUNTIME_[A-Z]{10}/g,
      confidence: "medium",
    });
    expect(scanner.getPatterns()).toHaveLength(initialCount + 1);

    const removed = scanner.removePattern("custom_runtime");
    expect(removed).toBe(true);
    expect(scanner.getPatterns()).toHaveLength(initialCount);
  });
});

describe("SecretsScanner — isClean and scanFile", () => {
  it("isClean returns true for safe content", () => {
    const scanner = new SecretsScanner();
    expect(scanner.isClean("const x = 42;")).toBe(true);
  });

  it("isClean returns false for content with secrets", () => {
    const scanner = new SecretsScanner();
    expect(scanner.isClean("AKIAIOSFODNN7EXAMPLE")).toBe(false);
  });

  it("scanFile includes file path in summary", () => {
    const scanner = new SecretsScanner();
    const result = scanner.scanFile("const x = 42;", "src/app.ts");
    expect(result.summary).toContain("src/app.ts");
    expect(result.clean).toBe(true);
  });

  it("scanFile shows secrets with file path", () => {
    const scanner = new SecretsScanner();
    const result = scanner.scanFile("AKIAIOSFODNN7EXAMPLE", "config.ts");
    expect(result.summary).toContain("config.ts");
    expect(result.clean).toBe(false);
  });

  it("records correct line numbers for matches", () => {
    const scanner = new SecretsScanner();
    const content = "line 1\nline 2\nAKIAIOSFODNN7EXAMPLE\nline 4";
    const result = scanner.scan(content);
    expect(result.matches[0]!.line).toBe(3);
  });
});
