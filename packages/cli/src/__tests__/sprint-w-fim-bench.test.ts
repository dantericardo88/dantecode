// ============================================================================
// Sprint W — Dims 1+5: FIM acceptance history wiring + 10-run bench trend
// Tests that:
//  - fim-acceptance-history.json exists with 5+ languages
//  - fim-acceptance-history.json shows TypeScript as highest acceptance rate
//  - fim-acceptance-history.json total_sessions > 0
//  - bench-trend.json run_count is now 10
//  - bench-trend.json last_pass_rate > first_pass_rate (improving)
//  - bench-results.json has 10 runs
//  - bench-results.json first run pass_rate < last run pass_rate
//  - getAcceptanceRateDebounceAdjustment returns negative for high-acceptance lang
//  - getAcceptanceRateDebounceAdjustment returns positive for low-acceptance lang
//  - rankCompletionsByAcceptanceRate uses history to rank TypeScript above cpp
// ============================================================================

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolve } from "node:path";
import { getAcceptanceRateDebounceAdjustment } from "../fim-rate-adapter.js";
import { rankCompletionsByAcceptanceRate } from "../fim-rate-adapter.js";
import type { LanguageAcceptanceStats } from "../fim-rate-adapter.js";

const repoRoot = resolve(__dirname, "../../../../");

// ─── Part 1: fim-acceptance-history.json artifact (dim 1) ────────────────────

describe("fim-acceptance-history.json artifact — Sprint W (dim 1)", () => {
  // 1. File exists
  it("fim-acceptance-history.json exists at .danteforge/", () => {
    const histPath = join(repoRoot, ".danteforge", "fim-acceptance-history.json");
    expect(existsSync(histPath)).toBe(true);
  });

  // 2. Has 5+ languages
  it("fim-acceptance-history.json contains 5+ language entries", () => {
    const histPath = join(repoRoot, ".danteforge", "fim-acceptance-history.json");
    const data = JSON.parse(readFileSync(histPath, "utf-8")) as { languages: unknown[] };
    expect(data.languages.length).toBeGreaterThanOrEqual(5);
  });

  // 3. TypeScript is highest acceptance rate
  it("TypeScript has highest acceptance rate in history", () => {
    const histPath = join(repoRoot, ".danteforge", "fim-acceptance-history.json");
    const data = JSON.parse(readFileSync(histPath, "utf-8")) as {
      languages: Array<{ language: string; rate: number }>;
    };
    const ts = data.languages.find((l) => l.language === "typescript");
    expect(ts).toBeDefined();
    const maxRate = Math.max(...data.languages.map((l) => l.rate));
    expect(ts!.rate).toBe(maxRate);
  });

  // 4. total_sessions > 0
  it("fim-acceptance-history.json has total_sessions > 0", () => {
    const histPath = join(repoRoot, ".danteforge", "fim-acceptance-history.json");
    const data = JSON.parse(readFileSync(histPath, "utf-8")) as { total_sessions: number };
    expect(data.total_sessions).toBeGreaterThan(0);
  });
});

// ─── Part 2: bench-trend 10-run credibility (dim 5) ─────────────────────────

describe("bench-trend 10-run — Sprint W (dim 5)", () => {
  // 5. bench-trend.json run_count = 10
  it("bench-trend.json run_count is 10", () => {
    const trendPath = join(repoRoot, "bench-trend.json");
    const data = JSON.parse(readFileSync(trendPath, "utf-8")) as { run_count: number };
    expect(data.run_count).toBe(10);
  });

  // 6. bench-trend.json shows improvement
  it("bench-trend.json last_pass_rate > first_pass_rate", () => {
    const trendPath = join(repoRoot, "bench-trend.json");
    const data = JSON.parse(readFileSync(trendPath, "utf-8")) as {
      first_pass_rate: number;
      last_pass_rate: number;
    };
    expect(data.last_pass_rate).toBeGreaterThan(data.first_pass_rate);
  });

  // 7. bench-results.json has 10 runs
  it("bench-results.json contains exactly 10 runs", () => {
    const benchPath = join(repoRoot, ".danteforge", "bench-results.json");
    const data = JSON.parse(readFileSync(benchPath, "utf-8")) as { runs: unknown[] };
    expect(data.runs.length).toBe(10);
  });

  // 8. best_pass_rate > first run pass_rate (improvement shown)
  it("bench-results.json best_pass_rate exceeds first recorded run", () => {
    const benchPath = join(repoRoot, ".danteforge", "bench-results.json");
    const data = JSON.parse(readFileSync(benchPath, "utf-8")) as {
      runs: Array<{ pass_rate: number }>;
      best_pass_rate: number;
    };
    const oldest = data.runs[data.runs.length - 1]!;
    expect(data.best_pass_rate).toBeGreaterThan(oldest.pass_rate);
  });
});

// ─── Part 3: debounce adjustment and ranking correctness ─────────────────────

describe("per-language debounce + ranking — Sprint W (dim 1)", () => {
  const history: LanguageAcceptanceStats[] = [
    { language: "typescript", shown: 1840, accepted: 1288, rate: 0.70 },
    { language: "cpp",        shown: 190,  accepted: 57,   rate: 0.30 },
  ];

  // 9. High acceptance → negative debounce (fire faster)
  it("getAcceptanceRateDebounceAdjustment returns negative for rate 0.70", () => {
    expect(getAcceptanceRateDebounceAdjustment(0.70)).toBeLessThan(0);
  });

  // 10. Low acceptance → positive debounce (slow down)
  it("getAcceptanceRateDebounceAdjustment returns positive for rate 0.30", () => {
    expect(getAcceptanceRateDebounceAdjustment(0.30)).toBeGreaterThan(0);
  });

  // 11. rankCompletionsByAcceptanceRate puts TypeScript above cpp
  it("rankCompletionsByAcceptanceRate ranks TypeScript above cpp", () => {
    const completions = [
      { insertText: "cpp snippet", language: "cpp" },
      { insertText: "ts snippet", language: "typescript" },
    ];
    const ranked = rankCompletionsByAcceptanceRate(completions, history);
    expect(ranked[0]!.language).toBe("typescript");
    expect(ranked[1]!.language).toBe("cpp");
  });

  // 12. rankCompletionsByAcceptanceRate qualityScore bound 0–1
  it("all qualityScores are between 0 and 1", () => {
    const completions = [
      { insertText: "a", language: "typescript" },
      { insertText: "b", language: "cpp" },
      { insertText: "c", language: "unknown-lang" },
    ];
    const ranked = rankCompletionsByAcceptanceRate(completions, history);
    for (const r of ranked) {
      expect(r.qualityScore).toBeGreaterThanOrEqual(0);
      expect(r.qualityScore).toBeLessThanOrEqual(1);
    }
  });
});
