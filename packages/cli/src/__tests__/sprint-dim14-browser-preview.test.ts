// ============================================================================
// Sprint Dim 14: Browser live preview — dev-server-manager + browser capture tests
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectDevCommand, startDevServer, getPreviewUrl } from "../dev-server-manager.js";
import {
  classifyConsoleMessage,
  classifyNetworkError,
  isBlockingError,
  buildCaptureSummary,
  extractErrorsFromDevOutput,
  buildRepairPrompt,
  recordPreviewFailure,
  loadPreviewFailures,
  getPreviewRepairSuccessRate,
  getPreviewSessionStats,
} from "@dantecode/core";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "dim14-test-"));
});

afterEach(() => {
  // Windows: spawned subprocesses may briefly hold temp dir handles after kill()
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* EPERM on Windows — ignore */ }
});

// ── detectDevCommand ──────────────────────────────────────────────────────────

describe("detectDevCommand", () => {
  it("returns null when no package.json exists", () => {
    expect(detectDevCommand(tmpDir)).toBeNull();
  });

  it("returns 'npm run dev' when scripts.dev exists", () => {
    writeFileSync(join(tmpDir, "package.json"), JSON.stringify({ scripts: { dev: "vite" } }));
    expect(detectDevCommand(tmpDir)).toBe("npm run dev");
  });

  it("returns 'npm run start' when only scripts.start exists", () => {
    writeFileSync(join(tmpDir, "package.json"), JSON.stringify({ scripts: { start: "node server.js" } }));
    expect(detectDevCommand(tmpDir)).toBe("npm run start");
  });

  it("prefers 'dev' over 'start' when both exist", () => {
    writeFileSync(
      join(tmpDir, "package.json"),
      JSON.stringify({ scripts: { dev: "vite", start: "node server.js" } }),
    );
    expect(detectDevCommand(tmpDir)).toBe("npm run dev");
  });

  it("returns null when no matching scripts exist", () => {
    writeFileSync(join(tmpDir, "package.json"), JSON.stringify({ scripts: { build: "tsc" } }));
    expect(detectDevCommand(tmpDir)).toBeNull();
  });

  it("returns 'npm run serve' for a Vue-style project", () => {
    writeFileSync(join(tmpDir, "package.json"), JSON.stringify({ scripts: { serve: "vue-cli-service serve" } }));
    expect(detectDevCommand(tmpDir)).toBe("npm run serve");
  });

  it("handles malformed package.json gracefully", () => {
    writeFileSync(join(tmpDir, "package.json"), "NOT VALID JSON");
    expect(detectDevCommand(tmpDir)).toBeNull();
  });
});

// ── startDevServer ────────────────────────────────────────────────────────────

describe("startDevServer", () => {
  it("resolves DevServerHandle when ready pattern matches in stdout", async () => {
    // Simulate a dev server that immediately prints its port
    const handle = await startDevServer({
      command: process.platform === "win32"
        ? `node -e "process.stdout.write('ready on http://localhost:4321\\n');"`
        : `node -e "process.stdout.write('ready on http://localhost:4321\\n');"`,
      cwd: tmpDir,
      timeoutMs: 10_000,
    });
    expect(handle.port).toBe(4321);
    expect(handle.url).toBe("http://localhost:4321");
    handle.kill();
  });

  it("rejects after timeoutMs when no ready line emitted", async () => {
    await expect(
      startDevServer({
        command: process.platform === "win32" ? "ping -n 60 127.0.0.1 > nul" : "sleep 60",
        cwd: tmpDir,
        timeoutMs: 200,
      }),
    ).rejects.toThrow();
  });

  it("handle.kill() terminates the subprocess without throwing", async () => {
    const handle = await startDevServer({
      command: `node -e "process.stdout.write('on port 9999\\n'); setTimeout(()=>{},60000);"`,
      cwd: tmpDir,
      timeoutMs: 10_000,
    });
    expect(() => handle.kill()).not.toThrow();
  });
});

// ── getPreviewUrl ─────────────────────────────────────────────────────────────

describe("getPreviewUrl", () => {
  it("returns http://localhost:{port}", async () => {
    const handle = await startDevServer({
      command: `node -e "process.stdout.write('ready on http://localhost:7777\\n');"`,
      cwd: tmpDir,
      timeoutMs: 10_000,
    });
    const url = getPreviewUrl(handle);
    expect(url).toBe("http://localhost:7777");
    handle.kill();
  });
});

// ── captureOutput (DevServerHandle buffer) ───────────────────────────────────

describe("captureOutput", () => {
  it("handle.captureOutput() returns accumulated stdout lines", async () => {
    const handle = await startDevServer({
      command: `node -e "process.stdout.write('build complete\\nready on http://localhost:5500\\n');"`,
      cwd: tmpDir,
      timeoutMs: 10_000,
    });
    const lines = handle.captureOutput();
    expect(lines.length).toBeGreaterThanOrEqual(1);
    expect(lines.some((l) => l.includes("localhost:5500") || l.includes("build complete"))).toBe(true);
    handle.kill();
  });
});

// ── classifyConsoleMessage ────────────────────────────────────────────────────

describe("classifyConsoleMessage", () => {
  it("classifies TypeError as uncaught error", () => {
    const e = classifyConsoleMessage("Uncaught TypeError: Cannot read property 'x' of undefined");
    expect(e.source).toBe("uncaught");
    expect(e.severity).toBe("error");
  });

  it("classifies unhandled rejection correctly", () => {
    const e = classifyConsoleMessage("Unhandled Promise Rejection: fetch failed");
    expect(e.source).toBe("unhandledrejection");
  });

  it("classifies generic console.log as info", () => {
    const e = classifyConsoleMessage("Component mounted", "log");
    expect(e.severity).toBe("info");
    expect(e.source).toBe("console");
  });

  it("includes timestamp in result", () => {
    const e = classifyConsoleMessage("some error");
    expect(e.timestamp).toBeTruthy();
    expect(new Date(e.timestamp).getTime()).toBeGreaterThan(0);
  });
});

// ── classifyNetworkError ──────────────────────────────────────────────────────

describe("classifyNetworkError", () => {
  it("classifies 404 as network failure", () => {
    const f = classifyNetworkError("/api/users", "GET", 404);
    expect(f.statusCode).toBe(404);
    expect(f.method).toBe("GET");
    expect(f.errorMessage).toContain("404");
  });

  it("classifies .js URL as script resource type", () => {
    const f = classifyNetworkError("/app.js", "GET", 500);
    expect(f.resourceType).toBe("script");
  });

  it("handles null statusCode (network unreachable)", () => {
    const f = classifyNetworkError("/api/data", "POST", null, "ERR_CONNECTION_REFUSED");
    expect(f.statusCode).toBeNull();
    expect(f.errorMessage).toBe("ERR_CONNECTION_REFUSED");
  });
});

// ── isBlockingError ───────────────────────────────────────────────────────────

describe("isBlockingError", () => {
  it("returns true for uncaught TypeError", () => {
    const e = classifyConsoleMessage("Uncaught TypeError: x is not a function");
    expect(isBlockingError(e)).toBe(true);
  });

  it("returns false for warning-level messages", () => {
    const e = classifyConsoleMessage("Deprecated API used", "warning");
    expect(isBlockingError(e)).toBe(false);
  });

  it("returns true for CORS error", () => {
    const e = classifyConsoleMessage("Blocked by CORS policy: No 'Access-Control-Allow-Origin'");
    expect(isBlockingError(e)).toBe(true);
  });
});

// ── buildCaptureSummary ───────────────────────────────────────────────────────

describe("buildCaptureSummary", () => {
  it("builds summary with hasBlockingErrors=true for TypeError", () => {
    const err = classifyConsoleMessage("Uncaught TypeError: boom");
    const summary = buildCaptureSummary(3000, [err], []);
    expect(summary.hasBlockingErrors).toBe(true);
    expect(summary.previewUrl).toBe("http://localhost:3000");
    expect(summary.port).toBe(3000);
  });

  it("builds summary with hasBlockingErrors=false for no errors", () => {
    const summary = buildCaptureSummary(3000, [], []);
    expect(summary.hasBlockingErrors).toBe(false);
  });

  it("sets hasBlockingErrors=true for 500 network failure", () => {
    const nf = classifyNetworkError("/api", "GET", 500);
    const summary = buildCaptureSummary(3000, [], [nf]);
    expect(summary.hasBlockingErrors).toBe(true);
  });
});

// ── extractErrorsFromDevOutput ────────────────────────────────────────────────

describe("extractErrorsFromDevOutput", () => {
  it("extracts TypeScript build errors from stdout", () => {
    const out = "src/App.tsx(10,5): error TS2322: Type 'string' is not assignable\n> Build failed";
    const errors = extractErrorsFromDevOutput(out);
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0]!.severity).toBe("error");
  });

  it("extracts Vite build failure", () => {
    const out = "[vite] error: Failed to resolve module specifier react";
    const errors = extractErrorsFromDevOutput(out);
    expect(errors.length).toBeGreaterThanOrEqual(1);
  });

  it("returns empty array for clean output", () => {
    const out = "Local: http://localhost:5173\nReady in 245ms";
    expect(extractErrorsFromDevOutput(out)).toEqual([]);
  });
});

// ── buildRepairPrompt ─────────────────────────────────────────────────────────

describe("buildRepairPrompt", () => {
  it("includes error context in fullPrompt", () => {
    const err = classifyConsoleMessage("Uncaught TypeError: Cannot read 'x'");
    const summary = buildCaptureSummary(3000, [err], []);
    const prompt = buildRepairPrompt(summary);
    expect(prompt.fullPrompt).toContain("TypeError");
    expect(prompt.fullPrompt).toContain("BROWSER PREVIEW FAILURE");
  });

  it("suggests 'Fix the blocking' for blocking errors", () => {
    const err = classifyConsoleMessage("Uncaught ReferenceError: foo is not defined");
    const summary = buildCaptureSummary(3000, [err], []);
    const prompt = buildRepairPrompt(summary);
    expect(prompt.suggestedAction).toContain("blocking");
  });

  it("includes network failure context", () => {
    const nf = classifyNetworkError("/api/auth", "POST", 401);
    const summary = buildCaptureSummary(3000, [], [nf]);
    const prompt = buildRepairPrompt(summary);
    expect(prompt.errorContext).toContain("/api/auth");
  });
});

// ── Preview failure persistence ───────────────────────────────────────────────

describe("recordPreviewFailure + loadPreviewFailures", () => {
  it("creates preview-failures.jsonl on first record", () => {
    recordPreviewFailure({ sessionId: "s1", previewUrl: "http://localhost:3000", port: 3000, errorCount: 2, networkFailureCount: 0, topError: "TypeError", repairAttempted: false }, tmpDir);
    expect(existsSync(join(tmpDir, ".danteforge", "preview-failures.jsonl"))).toBe(true);
  });

  it("reads back entries correctly", () => {
    recordPreviewFailure({ sessionId: "a", previewUrl: "http://localhost:3000", port: 3000, errorCount: 1, networkFailureCount: 0, topError: "SyntaxError", repairAttempted: true, repairSucceeded: true }, tmpDir);
    recordPreviewFailure({ sessionId: "b", previewUrl: "http://localhost:4000", port: 4000, errorCount: 3, networkFailureCount: 1, topError: "NetworkError", repairAttempted: true, repairSucceeded: false }, tmpDir);
    const records = loadPreviewFailures(tmpDir);
    expect(records).toHaveLength(2);
    expect(records[0]!.topError).toBe("SyntaxError");
    expect(records[1]!.repairSucceeded).toBe(false);
  });

  it("returns empty array when no file exists", () => {
    expect(loadPreviewFailures(tmpDir)).toEqual([]);
  });
});

// ── getPreviewRepairSuccessRate ───────────────────────────────────────────────

describe("getPreviewRepairSuccessRate", () => {
  it("returns 0 for empty records", () => {
    expect(getPreviewRepairSuccessRate([])).toBe(0);
  });

  it("returns 0 when no repairs attempted", () => {
    const r = [{ sessionId: "x", previewUrl: "http://localhost:3000", port: 3000, errorCount: 1, networkFailureCount: 0, topError: "err", repairAttempted: false, recordedAt: "" }];
    expect(getPreviewRepairSuccessRate(r)).toBe(0);
  });

  it("returns 1.0 when all attempted repairs succeeded", () => {
    const r = [
      { sessionId: "a", previewUrl: "http://localhost:3000", port: 3000, errorCount: 1, networkFailureCount: 0, topError: "e", repairAttempted: true, repairSucceeded: true, recordedAt: "" },
      { sessionId: "b", previewUrl: "http://localhost:3000", port: 3000, errorCount: 1, networkFailureCount: 0, topError: "e", repairAttempted: true, repairSucceeded: true, recordedAt: "" },
    ];
    expect(getPreviewRepairSuccessRate(r)).toBe(1);
  });

  it("returns 0.5 for half success", () => {
    const r = [
      { sessionId: "a", previewUrl: "http://localhost:3000", port: 3000, errorCount: 1, networkFailureCount: 0, topError: "e", repairAttempted: true, repairSucceeded: true, recordedAt: "" },
      { sessionId: "b", previewUrl: "http://localhost:3000", port: 3000, errorCount: 1, networkFailureCount: 0, topError: "e", repairAttempted: true, repairSucceeded: false, recordedAt: "" },
    ];
    expect(getPreviewRepairSuccessRate(r)).toBeCloseTo(0.5);
  });
});

// ── getPreviewSessionStats ────────────────────────────────────────────────────

describe("getPreviewSessionStats", () => {
  const sampleRecords = [
    { sessionId: "a", previewUrl: "http://localhost:3000", port: 3000, errorCount: 2, networkFailureCount: 0, topError: "TypeError: x is not defined", repairAttempted: true, repairSucceeded: true, recordedAt: "" },
    { sessionId: "b", previewUrl: "http://localhost:3000", port: 3000, errorCount: 1, networkFailureCount: 1, topError: "NetworkError: fetch failed", repairAttempted: true, repairSucceeded: false, recordedAt: "" },
    { sessionId: "c", previewUrl: "http://localhost:3000", port: 3000, errorCount: 0, networkFailureCount: 0, topError: "", repairAttempted: false, recordedAt: "" },
  ];

  it("returns totalSessions=3 for 3 records", () => {
    const stats = getPreviewSessionStats(sampleRecords);
    expect(stats.totalSessions).toBe(3);
  });

  it("returns repairAttemptRate=2/3 for 2 of 3 attempted", () => {
    const stats = getPreviewSessionStats(sampleRecords);
    expect(stats.repairAttemptRate).toBeCloseTo(2 / 3);
  });

  it("returns repairSuccessRate=0.5 (1 succeeded of 2 attempted)", () => {
    const stats = getPreviewSessionStats(sampleRecords);
    expect(stats.repairSuccessRate).toBeCloseTo(0.5);
  });

  it("returns avgErrorsPerSession=1 (3 total errors / 3 sessions)", () => {
    const stats = getPreviewSessionStats(sampleRecords);
    expect(stats.avgErrorsPerSession).toBeCloseTo(1);
  });

  it("returns empty topErrorTypes when all topError fields are empty", () => {
    const emptyErrors = sampleRecords.map((r) => ({ ...r, topError: "" }));
    const stats = getPreviewSessionStats(emptyErrors);
    expect(stats.topErrorTypes).toHaveLength(0);
  });

  it("returns totalSessions=0 for empty input", () => {
    const stats = getPreviewSessionStats([]);
    expect(stats.totalSessions).toBe(0);
  });

  it("returns repairAttemptRate=0 for empty input", () => {
    const stats = getPreviewSessionStats([]);
    expect(stats.repairAttemptRate).toBe(0);
  });

  it("returns topErrorTypes containing TypeError: when TypeError present", () => {
    const stats = getPreviewSessionStats(sampleRecords);
    expect(stats.topErrorTypes).toContain("TypeError:");
  });

  it("returns avgErrorsPerSession=0 for empty records", () => {
    const stats = getPreviewSessionStats([]);
    expect(stats.avgErrorsPerSession).toBe(0);
  });

  it("returns repairSuccessRate=0 when no repairs were attempted", () => {
    const noRepair = sampleRecords.map((r) => ({ ...r, repairAttempted: false, repairSucceeded: undefined }));
    expect(getPreviewSessionStats(noRepair).repairSuccessRate).toBe(0);
  });

  it("returns topErrorTypes with at most 3 entries", () => {
    const manyErrors = [
      { sessionId: "1", previewUrl: "http://localhost:3000", port: 3000, errorCount: 1, networkFailureCount: 0, topError: "TypeError: a", repairAttempted: false, recordedAt: "" },
      { sessionId: "2", previewUrl: "http://localhost:3000", port: 3000, errorCount: 1, networkFailureCount: 0, topError: "ReferenceError: b", repairAttempted: false, recordedAt: "" },
      { sessionId: "3", previewUrl: "http://localhost:3000", port: 3000, errorCount: 1, networkFailureCount: 0, topError: "SyntaxError: c", repairAttempted: false, recordedAt: "" },
      { sessionId: "4", previewUrl: "http://localhost:3000", port: 3000, errorCount: 1, networkFailureCount: 0, topError: "NetworkError: d", repairAttempted: false, recordedAt: "" },
    ];
    const stats = getPreviewSessionStats(manyErrors);
    expect(stats.topErrorTypes.length).toBeLessThanOrEqual(3);
  });

  it("counts error frequency correctly for topErrorTypes ranking", () => {
    const repeated = [
      { sessionId: "1", previewUrl: "http://localhost:3000", port: 3000, errorCount: 1, networkFailureCount: 0, topError: "TypeError: a", repairAttempted: false, recordedAt: "" },
      { sessionId: "2", previewUrl: "http://localhost:3000", port: 3000, errorCount: 1, networkFailureCount: 0, topError: "TypeError: b", repairAttempted: false, recordedAt: "" },
      { sessionId: "3", previewUrl: "http://localhost:3000", port: 3000, errorCount: 1, networkFailureCount: 0, topError: "ReferenceError: c", repairAttempted: false, recordedAt: "" },
    ];
    const stats = getPreviewSessionStats(repeated);
    expect(stats.topErrorTypes[0]).toBe("TypeError:");
  });
});

// ── Dev server error injection into agent context ─────────────────────────────

describe("dev server error capture for agent injection", () => {
  it("extractErrorsFromDevOutput returns error for TypeScript compile error line", () => {
    const output = "error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'";
    const errors = extractErrorsFromDevOutput(output);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0]!.severity).toBe("error");
  });

  it("extractErrorsFromDevOutput returns empty array for clean output", () => {
    const output = "vite v5.0.0 ready in 432ms\n  ➜  Local: http://localhost:5173/";
    const errors = extractErrorsFromDevOutput(output);
    expect(errors).toHaveLength(0);
  });

  it("buildRepairPrompt includes [BROWSER PREVIEW FAILURE] prefix", () => {
    const errors = extractErrorsFromDevOutput("error TS2304: Cannot find name 'React'");
    const summary = buildCaptureSummary(5173, errors, []);
    const repair = buildRepairPrompt(summary);
    expect(repair.fullPrompt).toContain("[BROWSER PREVIEW FAILURE]");
  });

  it("buildRepairPrompt fullPrompt includes error message context", () => {
    const errors = extractErrorsFromDevOutput("failed to compile\nModule not found: Error: Can't resolve './missing'");
    const summary = buildCaptureSummary(3000, errors, []);
    const repair = buildRepairPrompt(summary);
    expect(repair.errorContext.length).toBeGreaterThan(0);
  });
});
