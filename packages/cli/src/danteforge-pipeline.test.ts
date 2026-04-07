import { describe, it, expect } from "vitest";

// Use the real compiled danteforge binary — NO mocking.
// These tests verify the actual pipeline behavior end-to-end.
import {
  runDanteForge,
  formatVerificationVerdict,
  getWrittenFilePath,
  getAllWrittenFilePath,
  type VerificationDetails,
} from "./danteforge-pipeline.js";

const PROJECT_ROOT = process.cwd();

// ---------------------------------------------------------------------------
// runDanteForge — real end-to-end pipeline tests
// ---------------------------------------------------------------------------

describe("runDanteForge — real validators", () => {
  it("passes clean code", async () => {
    const code = `
export function add(a: number, b: number): number {
  return a + b;
}
`;
    const result = await runDanteForge(code, "src/add.ts", PROJECT_ROOT, false);
    expect(result.passed).toBe(true);
    expect(result.pdseScore).toBeGreaterThan(0);
    expect(result.summary).toContain("Verified");
  });

  it("fails on TODO marker (hard anti-stub violation)", async () => {
    const code = `
export function processPayment(amount: number): void {
  // TODO: implement payment processing
}
`;
    const result = await runDanteForge(code, "src/payment.ts", PROJECT_ROOT, false);
    expect(result.passed).toBe(false);
    expect(result.summary).toMatch(/Verification failed|stub/i);
  });

  it("fails on hardcoded API credential (constitution critical)", async () => {
    const code = `
const API_KEY = "sk-abc123supersecretkey";
export function callApi() {
  return fetch("https://api.example.com", { headers: { Authorization: API_KEY } });
}
`;
    const result = await runDanteForge(code, "src/api.ts", PROJECT_ROOT, false);
    expect(result.passed).toBe(false);
    expect(result.summary).toMatch(/Verification failed|policy violation/i);
  });

  it("passes code with console.log (soft violation — non-blocking)", async () => {
    const code = `
export function debug(msg: string): void {
  console.log(msg);
}
`;
    const result = await runDanteForge(code, "src/debug.ts", PROJECT_ROOT, false);
    // console.log is a soft violation — must NOT block
    expect(result.passed).toBe(true);
  });

  it("passes code with low PDSE score (PDSE non-blocking after fix)", async () => {
    // Code with console.log + long lines — PDSE may score below 85 but must not block
    const longLine = "x".repeat(150);
    const code = `
export function example(): void {
  console.log("${longLine}");
  console.warn("debug output here");
}
`;
    const result = await runDanteForge(code, "src/example.ts", PROJECT_ROOT, false);
    expect(result.passed).toBe(true);  // PDSE is informational only
  });

  it("includes PDSE score in result regardless of pass/fail", async () => {
    const code = `export const x = 1;`;
    const result = await runDanteForge(code, "src/x.ts", PROJECT_ROOT, false);
    expect(result.pdseScore).toBeGreaterThanOrEqual(0);
    expect(result.pdseScore).toBeLessThanOrEqual(100);
  });

  it("fails on FIXME stub", async () => {
    const code = `
export function parseConfig(raw: string) {
  // FIXME: this is incomplete
  return {};
}
`;
    const result = await runDanteForge(code, "src/config.ts", PROJECT_ROOT, false);
    expect(result.passed).toBe(false);
  });

  it("fails on empty function body (binary treats it as an incomplete-implementation hard violation)", async () => {
    const code = `
export function doWork() {}
`;
    const result = await runDanteForge(code, "src/work.ts", PROJECT_ROOT, false);
    // The compiled danteforge binary flags empty function bodies (`{\s*}\s*$`) as a hard violation
    // with type "incomplete_function". This is stricter than source-level PDSE scoring.
    expect(result.passed).toBe(false);
    expect(result.pdseScore).toBeLessThan(100);
  });
});

// ---------------------------------------------------------------------------
// formatVerificationVerdict — all output cases
// ---------------------------------------------------------------------------

describe("formatVerificationVerdict", () => {
  const baseDetails: VerificationDetails = {
    antiStubPassed: true,
    hardViolationCount: 0,
    hardViolationMessages: [],
    constitutionPassed: true,
    constitutionCriticalCount: 0,
    constitutionWarningCount: 0,
    constitutionMessages: [],
    pdseScore: 90,
    pdsePassedGate: true,
  };

  it("GREEN — all passed, no warnings", () => {
    const result = formatVerificationVerdict(baseDetails, false);
    expect(result).toContain("Verified");
    expect(result).toContain("no issues");
  });

  it("YELLOW — all passed but constitution has warnings", () => {
    const details: VerificationDetails = {
      ...baseDetails,
      constitutionWarningCount: 2,
    };
    const result = formatVerificationVerdict(details, false);
    expect(result).toContain("Verified");
    expect(result).toContain("warning");
  });

  it("RED — anti-stub failed (stubs detected)", () => {
    const details: VerificationDetails = {
      ...baseDetails,
      antiStubPassed: false,
      hardViolationCount: 1,
      hardViolationMessages: ["TODO: implement this"],
    };
    const result = formatVerificationVerdict(details, false);
    expect(result).toMatch(/Verification failed/i);
    expect(result).toMatch(/stub/i);
  });

  it("RED — constitution failed (critical violation)", () => {
    const details: VerificationDetails = {
      ...baseDetails,
      constitutionPassed: false,
      constitutionCriticalCount: 1,
      constitutionMessages: ["Possible hardcoded credential detected"],
    };
    const result = formatVerificationVerdict(details, false);
    expect(result).toMatch(/Verification failed/i);
    expect(result).toMatch(/policy violation/i);
  });

  it("PDSE gate failure does NOT produce RED verdict (informational only)", () => {
    const details: VerificationDetails = {
      ...baseDetails,
      pdsePassedGate: false,
      pdseScore: 70,
    };
    // With PDSE non-blocking, anti-stub and constitution both pass → GREEN
    const result = formatVerificationVerdict(details, false);
    expect(result).toContain("Verified");
    expect(result).not.toMatch(/Verification failed/i);
  });
});

// ---------------------------------------------------------------------------
// getWrittenFilePath / getAllWrittenFilePath — existing tests preserved
// ---------------------------------------------------------------------------

describe("getAllWrittenFilePath", () => {
  it("returns path for Write tool with any extension", () => {
    expect(getAllWrittenFilePath("Write", { file_path: "package.json" })).toBe("package.json");
    expect(getAllWrittenFilePath("Write", { file_path: "config.yaml" })).toBe("config.yaml");
    expect(getAllWrittenFilePath("Write", { file_path: "README.md" })).toBe("README.md");
    expect(getAllWrittenFilePath("Write", { file_path: "style.css" })).toBe("style.css");
    expect(getAllWrittenFilePath("Write", { file_path: "index.html" })).toBe("index.html");
  });

  it("returns path for Edit tool with any extension", () => {
    expect(getAllWrittenFilePath("Edit", { file_path: "tsconfig.json" })).toBe("tsconfig.json");
    expect(getAllWrittenFilePath("Edit", { file_path: "app.ts" })).toBe("app.ts");
  });

  it("returns null for non-write tools", () => {
    expect(getAllWrittenFilePath("Read", { file_path: "file.ts" })).toBeNull();
    expect(getAllWrittenFilePath("Bash", { command: "ls" })).toBeNull();
    expect(getAllWrittenFilePath("Glob", { pattern: "*.ts" })).toBeNull();
  });

  it("returns null when file_path is missing", () => {
    expect(getAllWrittenFilePath("Write", {})).toBeNull();
    expect(getAllWrittenFilePath("Edit", { content: "test" })).toBeNull();
  });
});

describe("getWrittenFilePath vs getAllWrittenFilePath", () => {
  it("getWrittenFilePath rejects non-code extensions that getAllWrittenFilePath accepts", () => {
    const configFiles = [
      "package.json",
      "config.yaml",
      "README.md",
      "style.css",
      "index.html",
      ".prettierrc",
    ];
    for (const file of configFiles) {
      expect(getWrittenFilePath("Write", { file_path: file })).toBeNull();
      expect(getAllWrittenFilePath("Write", { file_path: file })).toBe(file);
    }
  });

  it("both return path for code files", () => {
    const codeFiles = ["app.ts", "index.js", "main.py", "lib.rs", "server.go"];
    for (const file of codeFiles) {
      expect(getWrittenFilePath("Write", { file_path: file })).toBe(file);
      expect(getAllWrittenFilePath("Write", { file_path: file })).toBe(file);
    }
  });

  it("both return null for non-write tools", () => {
    expect(getWrittenFilePath("Read", { file_path: "app.ts" })).toBeNull();
    expect(getAllWrittenFilePath("Read", { file_path: "app.ts" })).toBeNull();
  });
});
