// ============================================================================
// Sprint R — Dims 1+22: FIM acceptance rate surfacing + skill policy enforcement
// Tests that:
//  - getAcceptanceRateDebounceAdjustment returns positive value for low rate (<20%)
//  - getAcceptanceRateDebounceAdjustment returns negative value for high rate (>80%)
//  - getAcceptanceRateDebounceAdjustment returns 0 for mid-range rate (40-60%)
//  - logAcceptanceRateToChannel writes rate % and accepted/shown counts
//  - logAcceptanceRateToChannel includes debounce adjustment
//  - enforceSkillPolicy allows skill with no matching rule
//  - enforceSkillPolicy blocks skill when rule action=block
//  - enforceSkillPolicy writes audit log entry when auditLogPath provided
//  - enforceSkillPolicy wildcard rule blocks all skills
//  - enforceSkillPolicy allow rule overrides wildcard block (first match wins)
//  - enforceSkillPolicy warns but allows when action=warn
// ============================================================================

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { enforceSkillPolicy } from "../skills-manager.js";
import { getAcceptanceRateDebounceAdjustment, logAcceptanceRateToChannel } from "../fim-rate-adapter.js";

// ─── Part 1: FIM acceptance rate surfacing (dim 1) ───────────────────────────

describe("FIM acceptance rate surfacing — Sprint R (dim 1)", () => {
  // 1. Low acceptance → positive (increase) debounce adjustment
  it("returns positive debounce adjustment for low acceptance rate (<20%)", () => {
    expect(getAcceptanceRateDebounceAdjustment(0.1)).toBeGreaterThan(0);
    expect(getAcceptanceRateDebounceAdjustment(0.0)).toBeGreaterThan(0);
  });

  // 2. High acceptance → negative (decrease) debounce adjustment
  it("returns negative debounce adjustment for high acceptance rate (>80%)", () => {
    expect(getAcceptanceRateDebounceAdjustment(0.85)).toBeLessThan(0);
    expect(getAcceptanceRateDebounceAdjustment(1.0)).toBeLessThan(0);
  });

  // 3. Mid-range acceptance → zero adjustment
  it("returns zero adjustment for mid-range acceptance rate (40-60%)", () => {
    expect(getAcceptanceRateDebounceAdjustment(0.5)).toBe(0);
  });

  // 4. logAcceptanceRateToChannel includes rate percentage
  it("logAcceptanceRateToChannel writes rate percentage to channel", () => {
    const lines: string[] = [];
    const channel = { appendLine: (s: string) => lines.push(s) };
    logAcceptanceRateToChannel(0.44, 100, 44, channel);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]).toContain("44.0%");
  });

  // 5. logAcceptanceRateToChannel includes accepted/shown counts
  it("logAcceptanceRateToChannel includes accepted and shown counts", () => {
    const lines: string[] = [];
    const channel = { appendLine: (s: string) => lines.push(s) };
    logAcceptanceRateToChannel(0.3, 50, 15, channel);
    expect(lines[0]).toContain("15");
    expect(lines[0]).toContain("50");
  });

  // 6. logAcceptanceRateToChannel mentions debounce adjustment
  it("logAcceptanceRateToChannel mentions debounce adjustment direction", () => {
    const lines: string[] = [];
    const channel = { appendLine: (s: string) => lines.push(s) };
    logAcceptanceRateToChannel(0.1, 10, 1, channel);
    expect(lines[0]).toContain("debounce");
  });
});

// ─── Part 2: Skill policy enforcement (dim 22) ───────────────────────────────

describe("enforceSkillPolicy — Sprint R (dim 22)", () => {
  // 7. Allow when no matching rule
  it("allows skill execution when no matching policy rule exists", () => {
    const result = enforceSkillPolicy("my-skill", []);
    expect(result.allowed).toBe(true);
  });

  // 8. Blocks skill when rule action=block
  it("blocks skill when matching rule has action=block", () => {
    const rules = [{ skillName: "dangerous-skill", action: "block" as const, reason: "security" }];
    const result = enforceSkillPolicy("dangerous-skill", rules);
    expect(result.allowed).toBe(false);
    expect(result.action).toBe("block");
  });

  // 9. Writes audit log entry when auditLogPath provided
  it("writes audit log entry to file when auditLogPath provided", () => {
    const dir = join(tmpdir(), `skill-audit-${randomUUID()}`);
    const auditPath = join(dir, "skill-audit.jsonl");
    const rules = [{ skillName: "test-skill", action: "allow" as const }];
    enforceSkillPolicy("test-skill", rules, auditPath);
    expect(existsSync(auditPath)).toBe(true);
    const lines = readFileSync(auditPath, "utf-8").trim().split("\n");
    const entry = JSON.parse(lines[0]!) as { skillName: string; allowed: boolean };
    expect(entry.skillName).toBe("test-skill");
    expect(entry.allowed).toBe(true);
  });

  // 10. Wildcard rule blocks all skills
  it("wildcard rule blocks all skills", () => {
    const rules = [{ skillName: "*", action: "block" as const, reason: "maintenance mode" }];
    expect(enforceSkillPolicy("skill-a", rules).allowed).toBe(false);
    expect(enforceSkillPolicy("skill-b", rules).allowed).toBe(false);
  });

  // 11. First-match wins: allow rule before wildcard block
  it("first matching rule wins — specific allow before wildcard block", () => {
    const rules = [
      { skillName: "safe-skill", action: "allow" as const },
      { skillName: "*", action: "block" as const, reason: "maintenance" },
    ];
    expect(enforceSkillPolicy("safe-skill", rules).allowed).toBe(true);
    expect(enforceSkillPolicy("other-skill", rules).allowed).toBe(false);
  });

  // 12. Warn action allows but action field is "warn"
  it("warn action allows execution but records warn action in result", () => {
    const rules = [{ skillName: "risky-skill", action: "warn" as const, reason: "experimental" }];
    const result = enforceSkillPolicy("risky-skill", rules);
    expect(result.allowed).toBe(true);
    expect(result.action).toBe("warn");
  });
});
