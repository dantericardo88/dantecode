import { describe, it, expect } from "vitest";
import { runLocalPDSEScorer } from "./pdse-scorer.js";

const PROJECT_ROOT = "/tmp/dantecode-test-nonexistent";

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
      // With default weights: C*0.35 + R*0.30 + Cl*0.20 + Co*0.15
      // If Clarity = 0, max = 100*0.35 + 100*0.30 + 0*0.20 + 100*0.15 = 80
      // 80 < 85 (PRD threshold) — this is a design invariant
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
      // Default weights: completeness 0.35, correctness 0.30, clarity 0.20, consistency 0.15
      const expected =
        score.completeness * 0.35 +
        score.correctness * 0.3 +
        score.clarity * 0.2 +
        score.consistency * 0.15;
      // Allow small floating-point rounding difference
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
});
