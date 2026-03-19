/**
 * tool-adapters.test.ts — DTR Phase 2 unit tests
 */

import { describe, it, expect } from "vitest";
import {
  wrapToolResult,
  adaptReadResult,
  adaptWriteResult,
  adaptBashResult,
  adaptWebResult,
  adaptSubAgentResult,
  adaptToolResult,
  formatEvidenceSummary,
} from "./tool-adapters.js";

const OK = { content: "success", isError: false };
const ERR = { content: "error: command failed", isError: true };

describe("wrapToolResult", () => {
  it("wraps without evidence when none provided", () => {
    const result = wrapToolResult(OK);
    expect(result.content).toBe("success");
    expect(result.isError).toBe(false);
    expect(result.evidence).toBeUndefined();
  });

  it("wraps with partial evidence", () => {
    const result = wrapToolResult(OK, { exitCode: 0, durationMs: 10 });
    expect(result.evidence?.exitCode).toBe(0);
    expect(result.evidence?.durationMs).toBe(10);
  });
});

describe("adaptReadResult", () => {
  it("includes filesRead on success", () => {
    const result = adaptReadResult(OK, "/tmp/foo.ts", Date.now() - 50);
    expect(result.evidence?.filesRead).toEqual(["/tmp/foo.ts"]);
    expect(result.evidence?.durationMs).toBeGreaterThan(0);
  });

  it("filesRead is empty on error", () => {
    const result = adaptReadResult(ERR, "/tmp/foo.ts", Date.now());
    expect(result.evidence?.filesRead).toEqual([]);
  });
});

describe("adaptWriteResult", () => {
  it("includes filesWritten on success", () => {
    const result = adaptWriteResult(OK, "/tmp/bar.ts", Date.now() - 30);
    expect(result.evidence?.filesWritten).toEqual(["/tmp/bar.ts"]);
  });

  it("filesWritten is empty on error", () => {
    const result = adaptWriteResult(ERR, "/tmp/bar.ts", Date.now());
    expect(result.evidence?.filesWritten).toEqual([]);
  });
});

describe("adaptBashResult", () => {
  it("sets exitCode 0 on success", () => {
    const result = adaptBashResult(OK, "git status", Date.now() - 100);
    expect(result.evidence?.exitCode).toBe(0);
  });

  it("sets exitCode 1 on generic error", () => {
    const result = adaptBashResult(ERR, "npm run build", Date.now());
    expect(result.evidence?.exitCode).toBe(1);
  });

  it("extracts exit code N from error content", () => {
    const result = adaptBashResult(
      { content: "exit code 2: not found", isError: true },
      "some-cmd",
      Date.now(),
    );
    expect(result.evidence?.exitCode).toBe(2);
  });

  it("detects git clone target in filesWritten", () => {
    const result = adaptBashResult(
      OK,
      "git clone https://github.com/org/repo.git myrepo",
      Date.now(),
    );
    expect(result.evidence?.filesWritten).toContain("myrepo");
  });

  it("detects wget bytes transferred", () => {
    const result = adaptBashResult(
      { content: "12345 bytes received", isError: false },
      "wget -O out.zip https://example.com/a.zip",
      Date.now(),
    );
    expect(result.evidence?.bytesTransferred).toBe(12345);
  });
});

describe("adaptWebResult", () => {
  it("sets bytesTransferred to content length on success", () => {
    const result = adaptWebResult({ content: "hello world", isError: false }, Date.now() - 200);
    expect(result.evidence?.bytesTransferred).toBe(11);
  });

  it("sets bytesTransferred to 0 on error", () => {
    const result = adaptWebResult(ERR, Date.now());
    expect(result.evidence?.bytesTransferred).toBe(0);
  });
});

describe("adaptSubAgentResult", () => {
  it("includes durationMs", () => {
    const result = adaptSubAgentResult(OK, Date.now() - 500);
    expect(result.evidence?.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe("adaptToolResult dispatch", () => {
  it("dispatches Read to adaptReadResult", () => {
    const result = adaptToolResult("Read", { file_path: "/tmp/f.ts" }, OK, Date.now());
    expect(result.evidence?.filesRead).toBeDefined();
  });

  it("dispatches Write to adaptWriteResult", () => {
    const result = adaptToolResult("Write", { file_path: "/tmp/f.ts" }, OK, Date.now());
    expect(result.evidence?.filesWritten).toBeDefined();
  });

  it("dispatches Edit to adaptWriteResult", () => {
    const result = adaptToolResult("Edit", { file_path: "/tmp/f.ts" }, OK, Date.now());
    expect(result.evidence?.filesWritten).toBeDefined();
  });

  it("dispatches Bash to adaptBashResult", () => {
    const result = adaptToolResult("Bash", { command: "git status" }, OK, Date.now());
    expect(result.evidence?.exitCode).toBe(0);
  });

  it("dispatches WebSearch to adaptWebResult", () => {
    const result = adaptToolResult("WebSearch", { query: "typescript" }, OK, Date.now());
    expect(result.evidence?.bytesTransferred).toBeDefined();
  });

  it("wraps unknown tools with durationMs only", () => {
    const result = adaptToolResult("GitCommit", {}, OK, Date.now());
    expect(result.evidence?.durationMs).toBeDefined();
    expect(result.evidence?.filesWritten).toBeUndefined();
  });
});

describe("formatEvidenceSummary", () => {
  it("returns empty string when no evidence", () => {
    const result = wrapToolResult(OK);
    expect(formatEvidenceSummary(result)).toBe("");
  });

  it("formats durationMs + exitCode", () => {
    const result = adaptBashResult(OK, "ls", Date.now() - 42);
    const summary = formatEvidenceSummary(result);
    expect(summary).toMatch(/\[.*ms.*exit=0.*\]/);
  });

  it("formats filesWritten count", () => {
    const result = adaptWriteResult(OK, "/tmp/f.ts", Date.now() - 10);
    const summary = formatEvidenceSummary(result);
    expect(summary).toContain("wrote=1");
  });

  it("formats filesRead count", () => {
    const result = adaptReadResult(OK, "/tmp/f.ts", Date.now() - 10);
    const summary = formatEvidenceSummary(result);
    expect(summary).toContain("read=1");
  });
});
