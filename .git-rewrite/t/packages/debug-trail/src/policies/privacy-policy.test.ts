import { describe, it, expect } from "vitest";
import { PrivacyPolicy, StorageQuotaPolicy } from "./privacy-policy.js";
import type { TrailEvent } from "../types.js";

function makeEvent(overrides: Partial<TrailEvent> = {}): TrailEvent {
  return {
    id: "evt-1",
    seq: 1,
    timestamp: new Date().toISOString(),
    kind: "tool_call",
    actor: "Bash",
    summary: "ran command",
    payload: {},
    provenance: { sessionId: "s1", runId: "r1" },
    ...overrides,
  };
}

describe("PrivacyPolicy", () => {
  it("excludes node_modules paths by default", () => {
    const policy = new PrivacyPolicy();
    expect(policy.shouldExcludePath("node_modules/vitest/index.ts")).toBe(true);
    expect(policy.shouldExcludePath(".git/HEAD")).toBe(true);
    expect(policy.shouldExcludePath("dist/index.js")).toBe(true);
  });

  it("allows normal source paths", () => {
    const policy = new PrivacyPolicy();
    expect(policy.shouldExcludePath("src/app.ts")).toBe(false);
    expect(policy.shouldExcludePath("packages/core/src/index.ts")).toBe(false);
  });

  it("redacts .env and .key files by default", () => {
    const policy = new PrivacyPolicy();
    expect(policy.shouldRedactContent("config/.env")).toBe(true);
    expect(policy.shouldRedactContent("secrets/api.key")).toBe(true);
    expect(policy.shouldRedactContent("src/app.ts")).toBe(false);
  });

  it("detects files too large for snapshot", () => {
    const policy = new PrivacyPolicy({ maxSnapshotBytes: 1000 });
    expect(policy.tooLargeForSnapshot(999)).toBe(false);
    expect(policy.tooLargeForSnapshot(1001)).toBe(true);
  });

  it("evaluateCapture returns exclude for excluded paths", () => {
    const policy = new PrivacyPolicy();
    expect(policy.evaluateCapture("node_modules/foo.js", 100)).toBe("exclude");
  });

  it("evaluateCapture returns redact for sensitive files", () => {
    const policy = new PrivacyPolicy();
    expect(policy.evaluateCapture("config/database.secret", 100)).toBe("redact");
  });

  it("evaluateCapture returns capture for normal files", () => {
    const policy = new PrivacyPolicy();
    expect(policy.evaluateCapture("src/app.ts", 100)).toBe("capture");
  });

  it("evaluateCapture returns exclude for oversized files", () => {
    const policy = new PrivacyPolicy({ maxSnapshotBytes: 500 });
    expect(policy.evaluateCapture("src/big.ts", 1000)).toBe("exclude");
  });

  it("sanitizes events by redacting env vars", () => {
    const event = makeEvent({
      payload: { cmd: "API_KEY=sk-secret-12345 node run.js" },
    });
    const policy = new PrivacyPolicy();
    const sanitized = policy.sanitizeEvent(event);
    const cmd = sanitized.payload["cmd"] as string;
    expect(cmd).toContain("[REDACTED]");
    expect(cmd).not.toContain("sk-secret-12345");
  });

  it("sanitizes events by redacting secret keys in JSON", () => {
    // sanitizeEvent serializes the full payload with JSON.stringify, then applies
    // SECRET_KEY_RE.  The key must be a direct property so it appears as a normal
    // key/value pair in the JSON, not a double-escaped string-within-a-string.
    const event = makeEvent({
      payload: { api_key: "my-secret-value-here" },
    });
    const policy = new PrivacyPolicy();
    const sanitized = policy.sanitizeEvent(event);
    const apiKey = sanitized.payload["api_key"] as string;
    expect(apiKey).toBe("[REDACTED]");
  });

  it("filterForExport excludes events with excluded paths", () => {
    const events = [
      makeEvent({ payload: { filePath: "node_modules/pkg/index.js" } }),
      makeEvent({ payload: { filePath: "src/app.ts" } }),
    ];
    const policy = new PrivacyPolicy();
    const filtered = policy.filterForExport(events);
    expect(filtered).toHaveLength(1);
  });

  it("handles Windows backslash paths", () => {
    const policy = new PrivacyPolicy();
    expect(policy.shouldExcludePath("node_modules\\vitest\\index.ts")).toBe(true);
  });
});

describe("StorageQuotaPolicy", () => {
  it("reports ok when directory does not exist", async () => {
    const policy = new StorageQuotaPolicy(100);
    const result = await policy.checkQuota("/nonexistent/path/" + Date.now());
    expect(result.ok).toBe(true);
    expect(result.usedBytes).toBe(0);
  });
});
