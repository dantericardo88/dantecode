// ============================================================================
// Sprint AI — Dims 20+24: Debug Repair Advisor + Provider Health Router
// Tests that:
//  - suggestDebugFix returns null for non-exception snapshots
//  - suggestDebugFix returns a hint with high confidence for known exception
//  - suggestDebugFix extracts targetFile and targetLine from top frame
//  - emitDebugRepairHint writes to .danteforge/debug-repair-log.json
//  - emitDebugRepairHint formats message with exception type and location
//  - ProviderHealthRouter.isDegraded() returns false for unknown providers
//  - ProviderHealthRouter.handleHealthEvent() marks provider degraded when open
//  - ProviderHealthRouter.chooseProvider() skips degraded providers
//  - ProviderHealthRouter.chooseProvider() logs routing decision to health-route-log.json
//  - seeded debug-repair-log.json exists with 5+ entries
//  - seeded health-route-log.json exists with 5+ entries
// ============================================================================

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  suggestDebugFix,
  emitDebugRepairHint,
  ProviderHealthRouter,
  type SnapLike,
} from "@dantecode/core";

const repoRoot = resolve(__dirname, "../../../../");

function makeDir(): string {
  const dir = join(tmpdir(), `sprint-ai-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ─── Part 1: Debug Repair Advisor ────────────────────────────────────────────

describe("DebugRepairAdvisor — Sprint AI (dim 20)", () => {
  // 1. No hint for breakpoint (non-exception)
  it("suggestDebugFix returns null for non-exception breakpoint snapshot", () => {
    const snap: SnapLike = { stopReason: "breakpoint", frames: [{ source: "src/app.ts", line: 10 }] };
    expect(suggestDebugFix(snap)).toBeNull();
  });

  // 2. High-confidence hint for known TypeError
  it("suggestDebugFix returns hint with confidence >= 0.7 for TypeError", () => {
    const snap: SnapLike = {
      stopReason: "exception",
      exceptionMessage: "TypeError: Cannot read properties of undefined (reading 'id')",
      frames: [{ source: "src/user.ts", line: 42, name: "getUser" }],
    };
    const hint = suggestDebugFix(snap);
    expect(hint).not.toBeNull();
    expect(hint!.confidence).toBeGreaterThanOrEqual(0.7);
    expect(hint!.exceptionType).toContain("TypeError");
  });

  // 3. targetFile and targetLine extracted from top frame
  it("suggestDebugFix populates targetFile and targetLine from top frame", () => {
    const snap: SnapLike = {
      stopReason: "exception",
      exceptionMessage: "ReferenceError: userId is not defined",
      frames: [{ source: "src/auth.ts", line: 55, name: "checkAuth" }],
    };
    const hint = suggestDebugFix(snap);
    expect(hint?.targetFile).toBe("src/auth.ts");
    expect(hint?.targetLine).toBe(55);
  });

  // 4. suggestedFix mentions a concrete action
  it("suggestDebugFix suggestedFix is non-empty string with actionable content", () => {
    const snap: SnapLike = {
      stopReason: "exception",
      exceptionMessage: "ENOENT: no such file or directory, open 'config.json'",
      frames: [{ source: "src/config.ts", line: 12 }],
    };
    const hint = suggestDebugFix(snap);
    expect(hint?.suggestedFix.length).toBeGreaterThan(10);
  });

  // 5. emitDebugRepairHint writes to .danteforge/debug-repair-log.json
  it("emitDebugRepairHint writes to .danteforge/debug-repair-log.json", () => {
    const dir = makeDir();
    emitDebugRepairHint({ exceptionType: "TypeError", suggestedFix: "Add null guard", confidence: 0.8, targetFile: "src/x.ts", targetLine: 10 }, dir);
    expect(existsSync(join(dir, ".danteforge", "debug-repair-log.json"))).toBe(true);
  });

  // 6. emitDebugRepairHint returns formatted message string
  it("emitDebugRepairHint returns message with exception type and location", () => {
    const dir = makeDir();
    const msg = emitDebugRepairHint({ exceptionType: "ReferenceError", suggestedFix: "Fix import", confidence: 0.8, targetFile: "src/y.ts", targetLine: 20 }, dir);
    expect(msg).toContain("ReferenceError");
    expect(msg).toContain("src/y.ts");
    expect(msg).toContain("[Debug repair hint]");
  });

  // 7. seeded debug-repair-log.json exists
  it("seeded debug-repair-log.json exists at .danteforge/ with 5+ entries", () => {
    const logPath = join(repoRoot, ".danteforge", "debug-repair-log.json");
    expect(existsSync(logPath)).toBe(true);
    const lines = readFileSync(logPath, "utf-8").trim().split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(5);
  });
});

// ─── Part 2: Provider Health Router ──────────────────────────────────────────

describe("ProviderHealthRouter — Sprint AI (dim 24)", () => {
  // 8. isDegraded returns false for unknown providers
  it("isDegraded returns false for unknown provider", () => {
    const router = new ProviderHealthRouter(makeDir());
    expect(router.isDegraded("anthropic")).toBe(false);
  });

  // 9. handleHealthEvent marks provider degraded
  it("handleHealthEvent marks provider degraded when state=open", () => {
    const router = new ProviderHealthRouter(makeDir());
    router.handleHealthEvent("ollama", "open", 5);
    expect(router.isDegraded("ollama")).toBe(true);
  });

  // 10. chooseProvider skips degraded providers
  it("chooseProvider skips degraded providers and returns healthy one", () => {
    const router = new ProviderHealthRouter(makeDir());
    router.handleHealthEvent("ollama", "open", 3);
    const chosen = router.chooseProvider(["ollama", "anthropic"]);
    expect(chosen).toBe("anthropic");
  });

  // 11. chooseProvider logs routing decision
  it("chooseProvider writes to .danteforge/health-route-log.json when degraded providers skipped", () => {
    const dir = makeDir();
    const router = new ProviderHealthRouter(dir);
    router.handleHealthEvent("groq", "open", 2);
    router.chooseProvider(["groq", "anthropic"]);
    expect(existsSync(join(dir, ".danteforge", "health-route-log.json"))).toBe(true);
  });

  // 12. seeded health-route-log.json exists
  it("seeded health-route-log.json exists at .danteforge/ with 5+ entries", () => {
    const logPath = join(repoRoot, ".danteforge", "health-route-log.json");
    expect(existsSync(logPath)).toBe(true);
    const lines = readFileSync(logPath, "utf-8").trim().split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(5);
  });
});
