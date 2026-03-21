import { describe, it, expect } from "vitest";
import { SecretsScanner } from "./secrets-scanner.js";

describe("SecretsScanner", () => {
  // -------------------------------------------------------------------------
  // 1. Constructor with defaults
  // -------------------------------------------------------------------------
  it("should initialize with default patterns and masked redaction style", () => {
    const scanner = new SecretsScanner();
    const patterns = scanner.getPatterns();
    expect(patterns.length).toBeGreaterThanOrEqual(17);
    // Verify a few known pattern names exist
    const names = patterns.map((p) => p.name);
    expect(names).toContain("aws_access_key");
    expect(names).toContain("github_token");
    expect(names).toContain("openai_key");
  });

  // -------------------------------------------------------------------------
  // 2. scan() detects AWS access key
  // -------------------------------------------------------------------------
  it("should detect AWS access key", () => {
    const scanner = new SecretsScanner();
    const content = "aws_access_key_id = AKIAIOSFODNN7EXAMPLE";
    const result = scanner.scan(content);
    expect(result.clean).toBe(false);
    expect(result.matches.length).toBeGreaterThanOrEqual(1);
    const awsMatch = result.matches.find((m) => m.type === "aws_access_key");
    expect(awsMatch).toBeDefined();
    expect(awsMatch!.value).toBe("AKIAIOSFODNN7EXAMPLE");
    expect(awsMatch!.confidence).toBe("high");
  });

  // -------------------------------------------------------------------------
  // 3. scan() detects GitHub token (ghp_)
  // -------------------------------------------------------------------------
  it("should detect GitHub personal access token", () => {
    const scanner = new SecretsScanner();
    const token = "ghp_" + "A".repeat(36);
    const content = `GITHUB_TOKEN=${token}`;
    const result = scanner.scan(content);
    expect(result.clean).toBe(false);
    const match = result.matches.find((m) => m.type === "github_token");
    expect(match).toBeDefined();
    expect(match!.value).toBe(token);
    expect(match!.confidence).toBe("high");
  });

  // -------------------------------------------------------------------------
  // 4. scan() detects GitHub fine-grained PAT
  // -------------------------------------------------------------------------
  it("should detect GitHub fine-grained personal access token", () => {
    const scanner = new SecretsScanner();
    const token = "github_pat_" + "B".repeat(82);
    const content = `token: ${token}`;
    const result = scanner.scan(content);
    expect(result.clean).toBe(false);
    const match = result.matches.find((m) => m.type === "github_fine_grained");
    expect(match).toBeDefined();
    expect(match!.value).toBe(token);
    expect(match!.confidence).toBe("high");
  });

  // -------------------------------------------------------------------------
  // 5. scan() detects JWT token
  // -------------------------------------------------------------------------
  it("should detect JWT token", () => {
    const scanner = new SecretsScanner();
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123DEF456_-ghi789";
    const content = `Authorization: Bearer ${jwt}`;
    const result = scanner.scan(content);
    expect(result.clean).toBe(false);
    const match = result.matches.find((m) => m.type === "jwt_token");
    expect(match).toBeDefined();
    expect(match!.value).toBe(jwt);
    expect(match!.confidence).toBe("high");
  });

  // -------------------------------------------------------------------------
  // 6. scan() detects generic API key
  // -------------------------------------------------------------------------
  it("should detect generic API key assignment", () => {
    const scanner = new SecretsScanner();
    const key = "abcdef1234567890ABCDEF";
    const content = `api_key = "${key}"`;
    const result = scanner.scan(content);
    expect(result.clean).toBe(false);
    const match = result.matches.find((m) => m.type === "generic_api_key");
    expect(match).toBeDefined();
    expect(match!.value).toBe(key);
    expect(match!.confidence).toBe("medium");
  });

  // -------------------------------------------------------------------------
  // 7. scan() detects private key header
  // -------------------------------------------------------------------------
  it("should detect private key header", () => {
    const scanner = new SecretsScanner();
    const content = `-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKC...\n-----END RSA PRIVATE KEY-----`;
    const result = scanner.scan(content);
    expect(result.clean).toBe(false);
    const match = result.matches.find((m) => m.type === "private_key");
    expect(match).toBeDefined();
    expect(match!.confidence).toBe("high");
  });

  // -------------------------------------------------------------------------
  // 8. scan() detects Slack token
  // -------------------------------------------------------------------------
  it("should detect Slack token", () => {
    const scanner = new SecretsScanner();
    const token = "xoxb-123456789012-abcdefghij";
    const content = `SLACK_TOKEN=${token}`;
    const result = scanner.scan(content);
    expect(result.clean).toBe(false);
    const match = result.matches.find((m) => m.type === "slack_token");
    expect(match).toBeDefined();
    expect(match!.value).toBe(token);
    expect(match!.confidence).toBe("high");
  });

  // -------------------------------------------------------------------------
  // 9. scan() detects Stripe key
  // -------------------------------------------------------------------------
  it("should detect Stripe secret key", () => {
    const scanner = new SecretsScanner();
    const key = "sk_live_" + "a".repeat(24);
    const content = `STRIPE_SECRET_KEY="${key}"`;
    const result = scanner.scan(content);
    expect(result.clean).toBe(false);
    const match = result.matches.find((m) => m.type === "stripe_key");
    expect(match).toBeDefined();
    expect(match!.value).toBe(key);
    expect(match!.confidence).toBe("high");
  });

  // -------------------------------------------------------------------------
  // 10. scan() detects OpenAI key
  // -------------------------------------------------------------------------
  it("should detect OpenAI API key", () => {
    const scanner = new SecretsScanner();
    const key = "sk-" + "X".repeat(48);
    const content = `OPENAI_API_KEY=${key}`;
    const result = scanner.scan(content);
    expect(result.clean).toBe(false);
    const match = result.matches.find((m) => m.type === "openai_key");
    expect(match).toBeDefined();
    expect(match!.value).toBe(key);
    expect(match!.confidence).toBe("high");
  });

  // -------------------------------------------------------------------------
  // 11. scan() detects Anthropic key
  // -------------------------------------------------------------------------
  it("should detect Anthropic API key", () => {
    const scanner = new SecretsScanner();
    const key = "sk-ant-" + "Y".repeat(90);
    const content = `ANTHROPIC_API_KEY=${key}`;
    const result = scanner.scan(content);
    expect(result.clean).toBe(false);
    const match = result.matches.find((m) => m.type === "anthropic_key");
    expect(match).toBeDefined();
    expect(match!.value).toBe(key);
    expect(match!.confidence).toBe("high");
  });

  // -------------------------------------------------------------------------
  // 12. scan() detects database URL with credentials
  // -------------------------------------------------------------------------
  it("should detect database URL with embedded credentials", () => {
    const scanner = new SecretsScanner();
    const dbUrl = "postgresql://admin:s3cretP@ss@db.example.com:5432/mydb";
    const content = `DATABASE_URL="${dbUrl}"`;
    const result = scanner.scan(content);
    expect(result.clean).toBe(false);
    const match = result.matches.find((m) => m.type === "database_url");
    expect(match).toBeDefined();
    expect(match!.confidence).toBe("high");
  });

  // -------------------------------------------------------------------------
  // 13. scan() returns clean for safe content
  // -------------------------------------------------------------------------
  it("should return clean result for content without secrets", () => {
    const scanner = new SecretsScanner();
    const content = `
      const name = "Alice";
      const count = 42;
      console.log("Hello, world!");
    `;
    const result = scanner.scan(content);
    expect(result.clean).toBe(true);
    expect(result.matches).toHaveLength(0);
    expect(result.summary).toBe("No secrets detected.");
  });

  // -------------------------------------------------------------------------
  // 14. scan() finds multiple secrets in one content
  // -------------------------------------------------------------------------
  it("should detect multiple different secrets in one content block", () => {
    const scanner = new SecretsScanner();
    const content = [
      `AWS_KEY=AKIAIOSFODNN7EXAMPLE`,
      `GITHUB_TOKEN=ghp_${"C".repeat(36)}`,
      `SLACK_TOKEN=xoxb-1234567890-abcdef`,
    ].join("\n");
    const result = scanner.scan(content);
    expect(result.clean).toBe(false);
    expect(result.matches.length).toBeGreaterThanOrEqual(3);
    const types = result.matches.map((m) => m.type);
    expect(types).toContain("aws_access_key");
    expect(types).toContain("github_token");
    expect(types).toContain("slack_token");
  });

  // -------------------------------------------------------------------------
  // 15. scan() computes correct line numbers
  // -------------------------------------------------------------------------
  it("should compute correct 1-based line numbers for matches", () => {
    const scanner = new SecretsScanner();
    const content = [
      "line one is safe",
      "line two is safe",
      "line three has AKIAIOSFODNN7EXAMPLE",
      "line four is safe",
      `line five has ghp_${"D".repeat(36)}`,
    ].join("\n");
    const result = scanner.scan(content);
    expect(result.clean).toBe(false);

    const awsMatch = result.matches.find((m) => m.type === "aws_access_key");
    expect(awsMatch).toBeDefined();
    expect(awsMatch!.line).toBe(3);

    const ghMatch = result.matches.find((m) => m.type === "github_token");
    expect(ghMatch).toBeDefined();
    expect(ghMatch!.line).toBe(5);
  });

  // -------------------------------------------------------------------------
  // 16. redact() masks values ("masked" style)
  // -------------------------------------------------------------------------
  it("should mask secrets with first/last 4 chars by default", () => {
    const scanner = new SecretsScanner({ redactionStyle: "masked" });
    const key = "AKIAIOSFODNN7EXAMPLE";
    const content = `key=${key}`;
    const redacted = scanner.redact(content);
    expect(redacted).not.toContain(key);
    // Masked: first 4 + **** + last 4
    expect(redacted).toContain("AKIA****MPLE");
  });

  // -------------------------------------------------------------------------
  // 17. redact() removes values ("removed" style)
  // -------------------------------------------------------------------------
  it("should replace secrets with [REDACTED] when using removed style", () => {
    const scanner = new SecretsScanner({ redactionStyle: "removed" });
    const key = "AKIAIOSFODNN7EXAMPLE";
    const content = `key=${key}`;
    const redacted = scanner.redact(content);
    expect(redacted).not.toContain(key);
    expect(redacted).toContain("[REDACTED]");
  });

  // -------------------------------------------------------------------------
  // 18. redact() uses placeholder ("placeholder" style)
  // -------------------------------------------------------------------------
  it("should replace secrets with [SECRET:type] when using placeholder style", () => {
    const scanner = new SecretsScanner({ redactionStyle: "placeholder" });
    const key = "AKIAIOSFODNN7EXAMPLE";
    const content = `key=${key}`;
    const redacted = scanner.redact(content);
    expect(redacted).not.toContain(key);
    expect(redacted).toContain("[SECRET:aws_access_key]");
  });

  // -------------------------------------------------------------------------
  // 19. isClean() returns true for clean content
  // -------------------------------------------------------------------------
  it("isClean() should return true for content without secrets", () => {
    const scanner = new SecretsScanner();
    expect(scanner.isClean("const x = 42;")).toBe(true);
    expect(scanner.isClean("Hello, world!")).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 20. isClean() returns false for content with secrets
  // -------------------------------------------------------------------------
  it("isClean() should return false for content containing secrets", () => {
    const scanner = new SecretsScanner();
    expect(scanner.isClean("AKIAIOSFODNN7EXAMPLE")).toBe(false);
    expect(scanner.isClean(`ghp_${"A".repeat(36)}`)).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 21. addPattern() adds custom pattern
  // -------------------------------------------------------------------------
  it("should add a custom pattern at runtime", () => {
    const scanner = new SecretsScanner();
    const initialCount = scanner.getPatterns().length;
    scanner.addPattern({
      name: "custom_token",
      pattern: /CUSTOM-[A-Z]{10}/g,
      confidence: "low",
    });
    expect(scanner.getPatterns().length).toBe(initialCount + 1);
    expect(scanner.getPatterns().map((p) => p.name)).toContain("custom_token");
  });

  // -------------------------------------------------------------------------
  // 22. removePattern() removes pattern
  // -------------------------------------------------------------------------
  it("should remove a pattern by name", () => {
    const scanner = new SecretsScanner();
    const beforeNames = scanner.getPatterns().map((p) => p.name);
    expect(beforeNames).toContain("aws_access_key");

    const removed = scanner.removePattern("aws_access_key");
    expect(removed).toBe(true);

    const afterNames = scanner.getPatterns().map((p) => p.name);
    expect(afterNames).not.toContain("aws_access_key");

    // Removing non-existent returns false
    expect(scanner.removePattern("nonexistent_pattern")).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 23. Custom patterns work in scan
  // -------------------------------------------------------------------------
  it("should detect matches using custom patterns passed via constructor", () => {
    const scanner = new SecretsScanner({
      customPatterns: [
        {
          name: "internal_token",
          pattern: /INTERNAL-[A-F0-9]{32}/g,
          confidence: "high",
        },
      ],
    });
    const token = "INTERNAL-" + "A1B2C3D4".repeat(4);
    const content = `auth_token=${token}`;
    const result = scanner.scan(content);
    expect(result.clean).toBe(false);
    const match = result.matches.find((m) => m.type === "internal_token");
    expect(match).toBeDefined();
    expect(match!.value).toBe(token);
    expect(match!.confidence).toBe("high");
  });

  // -------------------------------------------------------------------------
  // 24. excludePatterns prevents matching
  // -------------------------------------------------------------------------
  it("should exclude specified patterns from scanning", () => {
    const scanner = new SecretsScanner({
      excludePatterns: ["aws_access_key", "github_token"],
    });

    const patterns = scanner.getPatterns();
    const names = patterns.map((p) => p.name);
    expect(names).not.toContain("aws_access_key");
    expect(names).not.toContain("github_token");

    // AWS key should not be detected
    const result = scanner.scan("AKIAIOSFODNN7EXAMPLE");
    const awsMatch = result.matches.find((m) => m.type === "aws_access_key");
    expect(awsMatch).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // 25. scanFile() includes filePath in summary
  // -------------------------------------------------------------------------
  it("should include file path in scanFile summary", () => {
    const scanner = new SecretsScanner();

    // Clean file
    const cleanResult = scanner.scanFile("const x = 1;", "/src/app.ts");
    expect(cleanResult.summary).toContain("/src/app.ts");
    expect(cleanResult.summary).toContain("No secrets detected");

    // File with secret
    const dirtyResult = scanner.scanFile("key=AKIAIOSFODNN7EXAMPLE", "/config/.env");
    expect(dirtyResult.summary).toContain("/config/.env");
    expect(dirtyResult.clean).toBe(false);
    expect(dirtyResult.summary).toContain("aws_access_key");
  });
});
