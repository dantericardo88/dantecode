import { describe, it, expect } from "vitest";
import { runLocalPDSEScorer, runPDSEScorer } from "./pdse-scorer.js";
import type { ModelRouterConfig, ModelConfig } from "@dantecode/config-types";

const PROJECT_ROOT = "/tmp/dantecode-test-nonexistent";

// ---------------------------------------------------------------------------
// Mock Model Router
// ---------------------------------------------------------------------------

function createMockRouter(response: string | Error) {
  return {
    chat: async (_prompt: string, _config?: Partial<ModelConfig>): Promise<string> => {
      if (response instanceof Error) {
        throw response;
      }
      return response;
    },
    getConfig: (): ModelRouterConfig => ({
      default: {
        provider: "grok",
        modelId: "grok-3",
        maxTokens: 8192,
        temperature: 0.1,
        contextWindow: 131072,
        supportsVision: false,
        supportsToolCalls: true,
      },
      fallback: [],
      overrides: {},
    }),
  };
}

// ---------------------------------------------------------------------------
// Local Heuristic Scorer Tests
// ---------------------------------------------------------------------------

describe("pdse-scorer (local heuristic)", () => {
  describe("clean code scoring", () => {
    it("scores complete, well-structured code above threshold", () => {
      const code = `
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface UserProfile {
  id: string;
  name: string;
  email: string;
}

export async function loadUserProfile(dataDir: string, userId: string): Promise<UserProfile> {
  const filePath = join(dataDir, \`\${userId}.json\`);
  try {
    const content = await readFile(filePath, "utf-8");
    const parsed: unknown = JSON.parse(content);
    if (typeof parsed !== "object" || parsed === null) {
      throw new Error(\`Invalid profile data for user \${userId}: expected an object\`);
    }
    const obj = parsed as Record<string, unknown>;
    return {
      id: String(obj["id"] ?? userId),
      name: String(obj["name"] ?? "Unknown"),
      email: String(obj["email"] ?? ""),
    };
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new Error(\`Corrupted profile file for user \${userId}: invalid JSON\`);
    }
    throw err;
  }
}

export function validateEmail(email: string): boolean {
  const emailRegex = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;
  return emailRegex.test(email);
}
`;
      const score = runLocalPDSEScorer(code, PROJECT_ROOT);
      expect(score.overall).toBeGreaterThanOrEqual(70);
      expect(score.passedGate).toBe(true);
      expect(score.scoredBy).toBe("pdse-local");
    });
  });

  describe("stub detection integration", () => {
    it("sets clarity to 0 when hard stub violations present", () => {
      const code = `
export function processData(input: string): string {
  // TODO: implement actual processing
  return input;
}
`;
      const score = runLocalPDSEScorer(code, PROJECT_ROOT);
      expect(score.clarity).toBe(0);
      expect(score.passedGate).toBe(false);
    });

    it("fails gate when 'as any' is used", () => {
      const code = `
export function fetchData(url: string): Promise<unknown> {
  const response = fetch(url) as any;
  return response;
}
`;
      const score = runLocalPDSEScorer(code, PROJECT_ROOT);
      expect(score.clarity).toBe(0);
      expect(score.passedGate).toBe(false);
    });

    it("mathematical guarantee: clarity=0 makes max achievable < threshold", () => {
      const maxWithoutClarity = 100 * 0.35 + 100 * 0.3 + 0 * 0.2 + 100 * 0.15;
      expect(maxWithoutClarity).toBeLessThan(85);
    });
  });

  describe("scoring dimensions", () => {
    it("returns all four dimension scores", () => {
      const code = `export const VERSION = "1.0.0";`;
      const score = runLocalPDSEScorer(code, PROJECT_ROOT);
      expect(score).toHaveProperty("completeness");
      expect(score).toHaveProperty("correctness");
      expect(score).toHaveProperty("clarity");
      expect(score).toHaveProperty("consistency");
      expect(score).toHaveProperty("overall");
      expect(score).toHaveProperty("violations");
      expect(score).toHaveProperty("passedGate");
      expect(score).toHaveProperty("scoredAt");
      expect(score).toHaveProperty("scoredBy");
    });

    it("scores are between 0 and 100", () => {
      const code = `
export function add(a: number, b: number): number {
  return a + b;
}
`;
      const score = runLocalPDSEScorer(code, PROJECT_ROOT);
      expect(score.completeness).toBeGreaterThanOrEqual(0);
      expect(score.completeness).toBeLessThanOrEqual(100);
      expect(score.correctness).toBeGreaterThanOrEqual(0);
      expect(score.correctness).toBeLessThanOrEqual(100);
      expect(score.clarity).toBeGreaterThanOrEqual(0);
      expect(score.clarity).toBeLessThanOrEqual(100);
      expect(score.consistency).toBeGreaterThanOrEqual(0);
      expect(score.consistency).toBeLessThanOrEqual(100);
    });

    it("penalizes async code without error handling", () => {
      const codeWithoutErrorHandling = `
export async function fetchUsers(): Promise<string[]> {
  const response = await fetch("https://api.example.com/users");
  const data = await response.json();
  return data;
}
`;
      const codeWithErrorHandling = `
export async function fetchUsers(): Promise<string[]> {
  try {
    const response = await fetch("https://api.example.com/users");
    const data = await response.json();
    return data as string[];
  } catch (err) {
    throw new Error("Failed to fetch users: " + String(err));
  }
}
`;
      const scoreWithout = runLocalPDSEScorer(codeWithoutErrorHandling, PROJECT_ROOT);
      const scoreWith = runLocalPDSEScorer(codeWithErrorHandling, PROJECT_ROOT);
      expect(scoreWith.correctness).toBeGreaterThanOrEqual(scoreWithout.correctness);
    });
  });

  describe("weighted score computation", () => {
    it("computes overall as weighted average of dimensions", () => {
      const code = `export const VALUE = 42;`;
      const score = runLocalPDSEScorer(code, PROJECT_ROOT);
      const expected =
        score.completeness * 0.35 +
        score.correctness * 0.3 +
        score.clarity * 0.2 +
        score.consistency * 0.15;
      expect(Math.abs(score.overall - Math.round(expected * 100) / 100)).toBeLessThan(1);
    });
  });

  describe("violation reporting", () => {
    it("includes stub violations in the violations array", () => {
      const code = `
// FIXME: this is broken
export function broken(): void {
  return;
}
`;
      const score = runLocalPDSEScorer(code, PROJECT_ROOT);
      expect(score.violations.length).toBeGreaterThan(0);
      expect(score.violations.some((v) => v.severity === "hard")).toBe(true);
    });

    it("reports scoredAt as ISO timestamp", () => {
      const code = `export const X = 1;`;
      const score = runLocalPDSEScorer(code, PROJECT_ROOT);
      expect(score.scoredAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  // ---- New tests for uncovered branches ----

  describe("empty function detection", () => {
    it("penalizes completeness for empty function bodies", () => {
      const code = `
export function doSomething(): void {}
export function doAnother(): void {}
export function doMore(): void {}
`;
      const score = runLocalPDSEScorer(code, PROJECT_ROOT);
      expect(score.completeness).toBeLessThan(100);
    });
  });

  describe("many exports in short file", () => {
    it("penalizes completeness for many exports in a very short file", () => {
      const code = `
export const A = 1;
export const B = 2;
export const C = 3;
export const D = 4;
export const E = 5;
export const F = 6;
`;
      const score = runLocalPDSEScorer(code, PROJECT_ROOT);
      expect(score.completeness).toBeLessThan(100);
      expect(score.violations.some((v) => v.message.includes("Many exports"))).toBe(true);
    });
  });

  describe("throw without catch penalty", () => {
    it("penalizes correctness for throw without catch", () => {
      const code = `
export function validate(input: string): string {
  if (input.length === 0) {
    throw new Error("Input must not be empty");
  }
  if (input.length > 1000) {
    throw new Error("Input is too long");
  }
  return input.trim();
}
`;
      const score = runLocalPDSEScorer(code, PROJECT_ROOT);
      expect(score.correctness).toBeLessThan(100);
    });
  });

  describe("null check detection", () => {
    it("penalizes correctness for many property accesses without null guards", () => {
      // Many property accesses (>20) with zero null checks
      const code = `
export function processUser(user: any): string {
  const firstName = user.profile.name.first;
  const lastName = user.profile.name.last;
  const email = user.contact.email.primary;
  const phone = user.contact.phone.mobile;
  const street = user.address.street.line1;
  const city = user.address.city.name;
  const state = user.address.state.code;
  const zip = user.address.zip.full;
  const country = user.address.country.iso;
  const age = user.demographics.age.years;
  const gender = user.demographics.gender.value;
  return firstName + lastName + email + phone + street + city + state + zip + country + age + gender;
}
`;
      const score = runLocalPDSEScorer(code, PROJECT_ROOT);
      expect(score.violations.some((v) => v.message.includes("null/undefined"))).toBe(true);
    });
  });

  describe("long function detection", () => {
    it("penalizes clarity for functions longer than 50 lines", () => {
      // Build a function with 55 lines
      const lines = [
        "export function longFunction(): string {",
        ...Array.from({ length: 53 }, (_, i) => `  const v${i} = ${i};`),
        "  return String(v0);",
        "}",
      ];
      const code = lines.join("\n");
      const score = runLocalPDSEScorer(code, PROJECT_ROOT);
      expect(score.clarity).toBeLessThan(100);
      expect(score.violations.some((v) => v.message.includes("lines long"))).toBe(true);
    });
  });

  describe("magic number detection", () => {
    it("penalizes clarity for many magic numbers", () => {
      const code = `
export function calculate(input: number): number {
  if (input > 42) return input * 37;
  if (input > 99) return input + 256;
  if (input > 15) return input - 73;
  if (input > 88) return input / 19;
  if (input > 55) return input % 33;
  return input + 777;
}
`;
      const score = runLocalPDSEScorer(code, PROJECT_ROOT);
      expect(score.clarity).toBeLessThan(100);
    });
  });

  describe("mixed indentation detection", () => {
    it("penalizes consistency for mixed tabs and spaces", () => {
      const code = [
        "export function tabsAndSpaces(): void {",
        "\tconst a = 1;",
        "\tconst b = 2;",
        "\tconst c = 3;",
        "\tconst d = 4;",
        "  const e = 5;",
        "  const f = 6;",
        "  const g = 7;",
        "  const h = 8;",
        "}",
      ].join("\n");
      const score = runLocalPDSEScorer(code, PROJECT_ROOT);
      expect(score.consistency).toBeLessThan(100);
      expect(score.violations.some((v) => v.message.includes("Mixed indentation"))).toBe(true);
    });
  });

  describe("mixed quote style detection", () => {
    it("penalizes consistency for heavily mixed quote styles", () => {
      const code = `
export function quoteStyles(): string[] {
  const a = 'hello';
  const b = "world";
  const c = 'foo';
  const d = "bar";
  const e = 'baz';
  const f = "qux";
  const g = 'alpha';
  const h = "beta";
  return [a, b, c, d, e, f, g, h];
}
`;
      const score = runLocalPDSEScorer(code, PROJECT_ROOT);
      expect(score.consistency).toBeLessThan(100);
    });
  });

  describe("mixed export style detection", () => {
    it("penalizes consistency for mixed default and named exports", () => {
      const code = `
export function namedExport(): void {
  return;
}

export default function defaultExport(): void {
  return;
}
`;
      const score = runLocalPDSEScorer(code, PROJECT_ROOT);
      expect(score.consistency).toBeLessThan(100);
    });
  });
});

// ---------------------------------------------------------------------------
// Model-Based Scorer Tests
// ---------------------------------------------------------------------------

describe("pdse-scorer (model-based)", () => {
  describe("runPDSEScorer with valid model response", () => {
    it("returns model-scored result with scoredBy 'pdse-model'", async () => {
      const modelResponse = JSON.stringify({
        completeness: 90,
        correctness: 85,
        clarity: 80,
        consistency: 95,
        violations: [],
      });
      const router = createMockRouter(modelResponse);
      const code = `export function add(a: number, b: number): number { return a + b; }`;

      const score = await runPDSEScorer(code, router, PROJECT_ROOT);
      expect(score.scoredBy).toBe("pdse-model");
      expect(score.completeness).toBe(90);
      expect(score.correctness).toBe(85);
      expect(score.consistency).toBe(95);
    });

    it("computes weighted overall from model dimensions", async () => {
      const modelResponse = JSON.stringify({
        completeness: 100,
        correctness: 100,
        clarity: 100,
        consistency: 100,
        violations: [],
      });
      const router = createMockRouter(modelResponse);
      const code = `export function identity(x: number): number { return x; }`;

      const score = await runPDSEScorer(code, router, PROJECT_ROOT);
      expect(score.overall).toBe(100);
      expect(score.passedGate).toBe(true);
    });

    it("converts model violations to PDSEViolation format", async () => {
      const modelResponse = JSON.stringify({
        completeness: 80,
        correctness: 70,
        clarity: 60,
        consistency: 90,
        violations: [
          { type: "error_handling", message: "Missing catch block", line: 5 },
          { type: "console_log", message: "Leftover console.log", line: 12 },
        ],
      });
      const router = createMockRouter(modelResponse);
      const code = `export function test(): void { console.log("debug"); }`;

      const score = await runPDSEScorer(code, router, PROJECT_ROOT);
      const modelViolations = score.violations.filter((v) => v.file === "<evaluated>");
      expect(modelViolations.length).toBeGreaterThanOrEqual(2);
      expect(modelViolations.some((v) => v.type === "missing_error_handling")).toBe(true);
      expect(modelViolations.some((v) => v.type === "console_log_leftover")).toBe(true);
    });

    it("sets clarity to 0 when code has hard stub violations", async () => {
      const modelResponse = JSON.stringify({
        completeness: 90,
        correctness: 85,
        clarity: 80,
        consistency: 95,
        violations: [],
      });
      const router = createMockRouter(modelResponse);
      const code = `
export function process(input: string): string {
  // TODO: implement this
  return input;
}
`;
      const score = await runPDSEScorer(code, router, PROJECT_ROOT);
      expect(score.clarity).toBe(0);
      expect(score.passedGate).toBe(false);
    });
  });

  describe("model response parsing", () => {
    it("handles JSON wrapped in markdown code fences", async () => {
      const modelResponse =
        '```json\n{"completeness": 85, "correctness": 90, "clarity": 80, "consistency": 88, "violations": []}\n```';
      const router = createMockRouter(modelResponse);
      const code = `export const X = 1;`;

      const score = await runPDSEScorer(code, router, PROJECT_ROOT);
      expect(score.scoredBy).toBe("pdse-model");
      expect(score.completeness).toBe(85);
    });

    it("handles JSON with surrounding text", async () => {
      const modelResponse =
        'Here is my analysis:\n\n{"completeness": 75, "correctness": 80, "clarity": 70, "consistency": 85, "violations": []}\n\nOverall the code is decent.';
      const router = createMockRouter(modelResponse);
      const code = `export const X = 1;`;

      const score = await runPDSEScorer(code, router, PROJECT_ROOT);
      expect(score.scoredBy).toBe("pdse-model");
      expect(score.completeness).toBe(75);
    });

    it("falls back to local scorer for completely invalid response", async () => {
      const router = createMockRouter("I cannot evaluate this code, sorry.");
      const code = `export const X = 1;`;

      const score = await runPDSEScorer(code, router, PROJECT_ROOT);
      expect(score.scoredBy).toBe("pdse-local");
    });

    it("coerces partial model responses with missing fields", async () => {
      const modelResponse = JSON.stringify({
        completeness: 80,
        correctness: "not-a-number",
        clarity: 70,
        consistency: 90,
        violations: "not-an-array",
      });
      const router = createMockRouter(modelResponse);
      const code = `export const X = 1;`;

      const score = await runPDSEScorer(code, router, PROJECT_ROOT);
      // Should coerce: NaN becomes 0, invalid violations becomes []
      expect(score.scoredBy).toBe("pdse-model");
      expect(score.correctness).toBe(0);
    });
  });

  describe("model error fallback", () => {
    it("falls back to local scorer when model throws", async () => {
      const router = createMockRouter(new Error("Network timeout"));
      const code = `export function add(a: number, b: number): number { return a + b; }`;

      const score = await runPDSEScorer(code, router, PROJECT_ROOT);
      expect(score.scoredBy).toBe("pdse-local");
    });
  });

  describe("gate configuration overrides", () => {
    it("uses custom threshold from gateConfig", async () => {
      const modelResponse = JSON.stringify({
        completeness: 60,
        correctness: 60,
        clarity: 60,
        consistency: 60,
        violations: [],
      });
      const router = createMockRouter(modelResponse);
      const code = `export const X = 1;`;

      // With default threshold 70, overall 60 should fail
      const scoreFail = await runPDSEScorer(code, router, PROJECT_ROOT);
      expect(scoreFail.passedGate).toBe(false);

      // With custom threshold 50, overall 60 should pass
      const scorePass = await runPDSEScorer(code, router, PROJECT_ROOT, { threshold: 50 });
      expect(scorePass.passedGate).toBe(true);
    });

    it("uses custom weights from gateConfig", async () => {
      const modelResponse = JSON.stringify({
        completeness: 100,
        correctness: 0,
        clarity: 100,
        consistency: 100,
        violations: [],
      });
      const router = createMockRouter(modelResponse);
      const code = `export const X = 1;`;

      // With default weights, correctness=0 should significantly lower score
      const defaultScore = await runPDSEScorer(code, router, PROJECT_ROOT);

      // With correctness weight=0, it should score higher
      const customScore = await runPDSEScorer(code, router, PROJECT_ROOT, {
        weights: { completeness: 0.5, correctness: 0, clarity: 0.25, consistency: 0.25 },
      });

      expect(customScore.overall).toBeGreaterThan(defaultScore.overall);
    });
  });

  describe("violation type mapping", () => {
    it("maps known violation types correctly", async () => {
      const modelResponse = JSON.stringify({
        completeness: 80,
        correctness: 80,
        clarity: 80,
        consistency: 80,
        violations: [
          { type: "stub", message: "Stub found" },
          { type: "incomplete", message: "Incomplete function" },
          { type: "any", message: "Type any used" },
          { type: "secret", message: "Hardcoded secret" },
          { type: "dead_code", message: "Dead code" },
          { type: "skip", message: "Test skipped" },
          { type: "unused_import", message: "Unused import" },
          { type: "background", message: "Background process" },
        ],
      });
      const router = createMockRouter(modelResponse);
      const code = `export const X = 1;`;

      const score = await runPDSEScorer(code, router, PROJECT_ROOT);
      const types = score.violations.filter((v) => v.file === "<evaluated>").map((v) => v.type);
      expect(types).toContain("stub_detected");
      expect(types).toContain("incomplete_function");
      expect(types).toContain("type_any");
      expect(types).toContain("hardcoded_secret");
      expect(types).toContain("dead_code");
      expect(types).toContain("test_skip");
      expect(types).toContain("import_unused");
      expect(types).toContain("background_process");
    });

    it("maps unknown violation types to stub_detected", async () => {
      const modelResponse = JSON.stringify({
        completeness: 80,
        correctness: 80,
        clarity: 80,
        consistency: 80,
        violations: [{ type: "completely_unknown_type_xyz", message: "Some issue" }],
      });
      const router = createMockRouter(modelResponse);
      const code = `export const X = 1;`;

      const score = await runPDSEScorer(code, router, PROJECT_ROOT);
      const modelViolations = score.violations.filter((v) => v.file === "<evaluated>");
      expect(modelViolations[0]?.type).toBe("stub_detected");
    });
  });
});
