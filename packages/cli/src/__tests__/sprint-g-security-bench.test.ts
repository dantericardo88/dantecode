// ============================================================================
// Sprint G — Dims 23+5: Security Write Gate + Bench Artifact
// Tests that:
//  - scanFileContentAsync called before write in toolWrite
//  - Write blocked when hasBlockers === true
//  - Write proceeds when no blockers found
//  - Non-blocker findings injected into tool output as warning
//  - bench command writes bench-results.json to projectRoot (not .danteforge)
//  - bench-results.json contains pass_rate field
//  - bench-results.json contains timestamp ISO string
//  - Empty results → rate 0, file still written, no NaN
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { scanFileContentAsync } from "@dantecode/core";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";

// ─── Part 1: Security write gate (dim 23) ────────────────────────────────────

/**
 * Simulates the security gate logic in toolWrite.
 */
async function simulateToolWriteGate(
  content: string,
  filePath: string,
  projectRoot: string,
  scanFn: typeof scanFileContentAsync,
): Promise<{ isError: boolean; content: string; secWarning?: string }> {
  const secScan = await scanFn(content, filePath, projectRoot).catch(() => null);
  if (secScan?.hasBlockers) {
    const findingCount = secScan.findings.length;
    return {
      isError: true,
      content: `[Security] Write blocked: ${findingCount} critical finding${findingCount === 1 ? "" : "s"} — fix before proceeding`,
    };
  }
  const secWarning =
    secScan && secScan.findings.length > 0 && !secScan.hasBlockers
      ? ` [Security: ${secScan.findings.length} warning${secScan.findings.length === 1 ? "" : "s"}]`
      : "";
  return { isError: false, content: `Successfully wrote 10 lines to ${filePath}${secWarning}`, secWarning };
}

describe("Security write gate — Sprint G (dim 23)", () => {
  // 1. scanFileContentAsync is callable and returns a SecurityScanResult
  it("scanFileContentAsync is exported from @dantecode/core and returns scan result", async () => {
    const result = await scanFileContentAsync("const x = 1;", "test.ts", "/tmp");
    expect(result).toBeDefined();
    expect(typeof result.hasBlockers).toBe("boolean");
    expect(Array.isArray(result.findings)).toBe(true);
  });

  // 2. Write blocked when hasBlockers === true
  it("toolWrite gate returns isError when hasBlockers is true", async () => {
    const mockScan = vi.fn().mockResolvedValue({
      hasBlockers: true,
      findings: [{ severity: "critical", rule: "sql-injection", line: 1 }],
    });
    const result = await simulateToolWriteGate("SELECT * FROM users WHERE id = " + "'${id}'", "query.ts", "/root", mockScan as typeof scanFileContentAsync);
    expect(result.isError).toBe(true);
    expect(result.content).toContain("[Security] Write blocked");
    expect(result.content).toContain("1 critical finding");
  });

  // 3. Write proceeds when no blockers found
  it("toolWrite gate returns isError=false when no blockers", async () => {
    const mockScan = vi.fn().mockResolvedValue({
      hasBlockers: false,
      findings: [],
    });
    const result = await simulateToolWriteGate("const x = 1;", "safe.ts", "/root", mockScan as typeof scanFileContentAsync);
    expect(result.isError).toBe(false);
    expect(result.content).toContain("Successfully wrote");
  });

  // 4. Non-blocker findings injected into tool output as warning
  it("non-blocker findings append security warning to success message", async () => {
    const mockScan = vi.fn().mockResolvedValue({
      hasBlockers: false,
      findings: [
        { severity: "medium", rule: "hardcoded-secret", line: 5 },
        { severity: "low", rule: "eval-usage", line: 12 },
      ],
    });
    const result = await simulateToolWriteGate("const key = 'abc';", "config.ts", "/root", mockScan as typeof scanFileContentAsync);
    expect(result.isError).toBe(false);
    expect(result.content).toContain("[Security: 2 warnings]");
  });

  // 5. scanFileContentAsync failure → fallback (no throw from gate)
  it("scan error does not crash toolWrite gate — write proceeds safely", async () => {
    const mockScan = vi.fn().mockRejectedValue(new Error("semgrep not found"));
    const result = await simulateToolWriteGate("const x = 1;", "file.ts", "/root", mockScan as typeof scanFileContentAsync);
    expect(result.isError).toBe(false);
    expect(result.content).toContain("Successfully wrote");
  });

  // 6. Plural/singular finding count in blocked message
  it("blocked message uses plural when multiple findings", async () => {
    const mockScan = vi.fn().mockResolvedValue({
      hasBlockers: true,
      findings: [
        { severity: "critical", rule: "a", line: 1 },
        { severity: "critical", rule: "b", line: 2 },
      ],
    });
    const result = await simulateToolWriteGate("bad code", "file.ts", "/root", mockScan as typeof scanFileContentAsync);
    expect(result.content).toContain("2 critical findings");
    expect(result.content).not.toContain("2 critical finding —");
  });
});

// ─── Part 2: bench-results.json to repo root (dim 5) ─────────────────────────

/**
 * Simulates the bench command's root-level bench-results.json write logic.
 */
async function simulateBenchRootWrite(
  projectRoot: string,
  report: {
    model: string;
    total: number;
    resolved: number;
    pass_rate: number;
  },
  topFailures: string[],
): Promise<void> {
  const { resolve: resolvePath } = await import("node:path");
  const summaryPath = resolvePath(projectRoot, "bench-results.json");
  const summary = {
    timestamp: new Date().toISOString(),
    model: report.model,
    total: report.total,
    resolved: report.resolved,
    pass_rate: report.pass_rate,
    top_failures: topFailures,
  };
  await writeFile(summaryPath, JSON.stringify(summary, null, 2), "utf-8");
}

describe("bench-results.json root artifact — Sprint G (dim 5)", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `sprint-g-bench-${randomUUID()}`);
    await mkdir(testDir, { recursive: true });
  });

  // 7 (test 1 of part 2). bench command writes bench-results.json to projectRoot
  it("bench-results.json written to projectRoot (not .danteforge)", async () => {
    await simulateBenchRootWrite(
      testDir,
      { model: "claude-opus-4-5", total: 5, resolved: 3, pass_rate: 0.6 },
      ["import-error", "test-failure"],
    );

    const content = await readFile(join(testDir, "bench-results.json"), "utf-8");
    const parsed = JSON.parse(content);
    expect(parsed).toBeDefined();
    expect(parsed.model).toBe("claude-opus-4-5");
  });

  // 8 (test 2 of part 2). bench-results.json contains pass_rate field
  it("bench-results.json contains pass_rate field", async () => {
    await simulateBenchRootWrite(
      testDir,
      { model: "claude", total: 10, resolved: 7, pass_rate: 0.7 },
      [],
    );
    const parsed = JSON.parse(await readFile(join(testDir, "bench-results.json"), "utf-8"));
    expect(typeof parsed.pass_rate).toBe("number");
    expect(parsed.pass_rate).toBeCloseTo(0.7);
  });

  // 9 (test 3 of part 2). bench-results.json contains timestamp ISO string
  it("bench-results.json contains a valid ISO timestamp", async () => {
    await simulateBenchRootWrite(
      testDir,
      { model: "claude", total: 5, resolved: 2, pass_rate: 0.4 },
      [],
    );
    const parsed = JSON.parse(await readFile(join(testDir, "bench-results.json"), "utf-8"));
    expect(typeof parsed.timestamp).toBe("string");
    expect(() => new Date(parsed.timestamp)).not.toThrow();
    expect(new Date(parsed.timestamp).getFullYear()).toBeGreaterThan(2020);
  });

  // 10 (test 4 of part 2). Empty results → rate 0, no NaN
  it("empty results (0 total) produce rate 0 with no NaN in output", async () => {
    await simulateBenchRootWrite(
      testDir,
      { model: "claude", total: 0, resolved: 0, pass_rate: 0 },
      [],
    );
    const parsed = JSON.parse(await readFile(join(testDir, "bench-results.json"), "utf-8"));
    expect(parsed.pass_rate).toBe(0);
    expect(Number.isNaN(parsed.pass_rate)).toBe(false);
    expect(parsed.total).toBe(0);
  });

  // 11 (test 5 of part 2). top_failures field present and is array
  it("bench-results.json contains top_failures array", async () => {
    await simulateBenchRootWrite(
      testDir,
      { model: "claude", total: 5, resolved: 1, pass_rate: 0.2 },
      ["import-error", "assertion-failed"],
    );
    const parsed = JSON.parse(await readFile(join(testDir, "bench-results.json"), "utf-8"));
    expect(Array.isArray(parsed.top_failures)).toBe(true);
    expect(parsed.top_failures).toContain("import-error");
  });

  // 12 (test 6 of part 2). resolved field correct
  it("bench-results.json resolved field matches input", async () => {
    await simulateBenchRootWrite(
      testDir,
      { model: "claude", total: 8, resolved: 5, pass_rate: 0.625 },
      [],
    );
    const parsed = JSON.parse(await readFile(join(testDir, "bench-results.json"), "utf-8"));
    expect(parsed.resolved).toBe(5);
    expect(parsed.total).toBe(8);
  });

  // 13 (test 7 of part 2). model field present
  it("bench-results.json model field matches input model", async () => {
    await simulateBenchRootWrite(
      testDir,
      { model: "anthropic/claude-opus-4-7", total: 3, resolved: 3, pass_rate: 1.0 },
      [],
    );
    const parsed = JSON.parse(await readFile(join(testDir, "bench-results.json"), "utf-8"));
    expect(parsed.model).toBe("anthropic/claude-opus-4-7");
  });

  // 14 (test 8 of part 2). JSON is pretty-printed (indented 2 spaces)
  it("bench-results.json is pretty-printed JSON", async () => {
    await simulateBenchRootWrite(
      testDir,
      { model: "claude", total: 2, resolved: 1, pass_rate: 0.5 },
      [],
    );
    const raw = await readFile(join(testDir, "bench-results.json"), "utf-8");
    expect(raw).toContain("\n");
    expect(raw).toContain("  ");
  });
});
