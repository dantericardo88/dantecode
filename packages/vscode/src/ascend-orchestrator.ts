// ============================================================================
// packages/vscode/src/ascend-orchestrator.ts
//
// In-extension autonomous self-improvement loop. Drives the chat model from
// inside DanteCode (visible tool calls, real edits) instead of shelling out
// to `danteforge ascend` (which prints "Wave NaN" / "+0.0" deltas because no
// agent is attached as a child process — pure theater).
//
// Pure-function helpers live here so they're testable in isolation and can't
// be co-reverted with sidebar-provider.ts. The loop itself (`runAscendLoop`)
// is a method on ChatSidebarProvider — it needs `this.handleChatRequest`,
// `this.postMessage`, etc., so it can't be a pure function.
//
// Flow per cycle:
//   1. `danteforge score --level light` → parse P0 gaps
//   2. Pick top non-ceiling, non-plateaued gap
//   3. Build a focused goal prompt (forbid lazy delegation, demand real edits)
//   4. Caller calls handleChatRequest(goal) — model runs with full tools
//   5. Auto-commit any working-tree changes (score is git-SHA-based)
//   6. Re-score, compute delta, plateau-or-improvement decision
//   7. Stop on target reached, all dimensions skipped, or stop button.
//
// Ceiling dimensions are hardcoded because `--level light` doesn't include
// ceiling info and `--full` hangs without env inheritance from the spawned
// extension process. The values are stable; a static map is correct.
// ============================================================================

import { spawn } from "node:child_process";
import { readdirSync, statSync, existsSync } from "node:fs";
import { join, basename } from "node:path";

export interface Dimension {
  name: string;
  displayName: string;
  score: number;
  ceiling: number | null;
  isCeilingBlocked: boolean;
}

export interface AscendOptions {
  target: number;
  maxCycles: number;
  /** Consecutive plateau cycles on a single dimension before skipping it. */
  plateauThreshold: number;
}

export const DEFAULT_ASCEND_OPTIONS: AscendOptions = {
  target: 9.0,
  maxCycles: 30,
  plateauThreshold: 2,
};

const CEILING_DIMENSIONS: Record<string, number> = {
  community_adoption: 4.0,
  enterprise_readiness: 9.0,
  context_economy: 9.0,
};

// ── Score parsing ───────────────────────────────────────────────────────────

/**
 * Extract the overall score (e.g. `6.5/10`) from `danteforge score --level light`.
 * Returns null if not found. Used to detect cycle-level progress even when a
 * dimension graduates OUT of the P0 gaps list (which the per-gap parser misses).
 */
export function parseOverallScore(text: string): number | null {
  // Match lines like "[INFO]   6.5/10  — solid" or "  6.5/10 — solid"
  const m = text.match(/^\s*(?:\[INFO\])?\s+([\d.]+)\/10\s+—/m);
  if (!m?.[1]) return null;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) ? n : null;
}


/**
 * Parse `danteforge score --level light` output's P0 gaps section into structured
 * dimension data. Output format:
 *
 *   [INFO]   P0 gaps:
 *   [INFO]   1. Testing               4.5/10  — insufficient tests — ...
 *   [INFO]   2. Error Handling        5.0/10  — code crashes ...
 *   [INFO]   3. Ux Polish             5.0/10  — user-facing interfaces ...
 */
export function parseScoreOutput(text: string): Dimension[] {
  const out: Dimension[] = [];
  const lineRe = /^\s*(?:\[INFO\])?\s*\d+\.\s+([A-Za-z][A-Za-z ]+?)\s{2,}([\d.]+)\/10\s*(?:—|--)?\s*(.*)$/gm;
  for (const m of text.matchAll(lineRe)) {
    const display = (m[1] ?? "").trim();
    if (!display) continue;
    const score = parseFloat(m[2] ?? "0");
    const name = display.toLowerCase().replace(/\s+/g, "_");
    const ceiling = CEILING_DIMENSIONS[name] ?? null;
    const isCeilingBlocked = ceiling !== null && score >= ceiling - 0.05;
    out.push({ name, displayName: display, score, ceiling, isCeilingBlocked });
  }
  return out;
}

/**
 * Pick the dimension to improve next.
 * Skip ceilings, skip already-at-target, skip recently plateaued. Lowest wins.
 */
export function pickTopGap(
  dims: Dimension[],
  target: number,
  recentlyPlateaued: Set<string> = new Set(),
): Dimension | null {
  const eligible = dims
    .filter((d) => !d.isCeilingBlocked)
    .filter((d) => d.score < target - 0.05)
    .filter((d) => !recentlyPlateaued.has(d.name));
  if (eligible.length === 0) return null;
  eligible.sort((a, b) => a.score - b.score);
  return eligible[0] ?? null;
}

// ── Test-target picking (Cline-style file-scoped tasks) ────────────────────

/**
 * Walk packages/<x>/src/ recursively and return source files (.ts) that
 * (a) are not themselves tests and (b) have no sibling .test.ts file.
 * Sorted by line count descending — the biggest untested file wins because
 * testing it produces the largest coverage-delta per cycle.
 *
 * This is the Cline pattern: scope a cycle to ONE concrete file rather than
 * a vague "improve testing" dimension. The harsh-scorer's testing formula
 * is `(maturity * 0.4) + (coverage * 0.6)`, so a single 200-line module
 * going from 0% to 80% covered moves the line-coverage pct by ~0.2 points
 * on the whole repo — visible delta where "write some tests" was invisible.
 */
export function findLargestUntestedFile(projectRoot: string): { path: string; lines: number } | null {
  const candidates: Array<{ path: string; lines: number }> = [];
  const packagesDir = join(projectRoot, "packages");
  if (!existsSync(packagesDir)) return null;

  const walk = (dir: string): void => {
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return; }
    for (const entry of entries) {
      const full = join(dir, entry);
      let stat;
      try { stat = statSync(full); } catch { continue; }
      if (stat.isDirectory()) {
        // Skip generated/build/test-fixture dirs
        if (entry === "node_modules" || entry === "dist" || entry === "__tests__" || entry === ".turbo") continue;
        walk(full);
        continue;
      }
      if (!entry.endsWith(".ts")) continue;
      if (entry.endsWith(".test.ts") || entry.endsWith(".d.ts") || entry === "index.ts") continue;
      // Skip if a sibling .test.ts exists OR a __tests__/<name>.test.ts exists
      const stem = entry.slice(0, -3);
      const siblingTest = join(dir, `${stem}.test.ts`);
      const dirName = basename(dir);
      const grandparent = join(dir, "..", "__tests__", `${stem}.test.ts`);
      if (existsSync(siblingTest) || existsSync(grandparent)) continue;
      // Count lines
      try {
        const content = require("node:fs").readFileSync(full, "utf-8") as string;
        const lines = content.split("\n").length;
        if (lines >= 50 && lines <= 600) {
          // 50–600 line band: small enough to test in one cycle, big enough to matter
          candidates.push({ path: full.replace(projectRoot + (process.platform === "win32" ? "\\" : "/"), ""), lines });
        }
      } catch { /* skip unreadable */ }
      // Suppress unused-var warning for `dirName` until we use it for ranking later
      void dirName;
    }
  };

  // Walk every package's src/
  let pkgRoots: string[];
  try { pkgRoots = readdirSync(packagesDir); } catch { return null; }
  for (const pkg of pkgRoots) {
    const srcDir = join(packagesDir, pkg, "src");
    if (existsSync(srcDir)) walk(srcDir);
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.lines - a.lines);
  return candidates[0]!;
}

// ── Goal prompt ─────────────────────────────────────────────────────────────

/**
 * Build a focused, action-oriented goal for the chat model. Hard rules forbid
 * the failure modes Grok exhibited in earlier cycles: lazy delegation to
 * danteforge meta-commands, fabricated VERIFICATION AUDIT blocks, ending the
 * turn after Read/Glob without follow-through to Edit/Write.
 */
export function buildGoalPrompt(
  gap: Dimension,
  target: number,
  cycle: number,
  maxCycles: number,
  targetFile?: { path: string; lines: number },
): string {
  const advice = DIMENSION_HINTS[gap.name];
  // Cline-style file-scoped task: when targeting Testing and a specific
  // untested file was identified, point the model at that file directly.
  // This produces a much larger per-cycle coverage delta than vague guidance,
  // and gives the user a concrete, verifiable artifact: tests for file X.
  const targetLine = targetFile
    ? `**Specific target file:** \`${targetFile.path}\` (${targetFile.lines} lines, currently has no tests). Write tests for THIS file in particular — don't pick a different file.`
    : null;
  return [
    `[Ascend Cycle ${cycle}/${maxCycles}]`,
    `Goal: improve the **${gap.displayName}** dimension from ${gap.score.toFixed(1)}/10 toward ${target.toFixed(1)}/10.`,
    targetLine ?? "",
    "",
    "Hard rules:",
    "1. Your turn is NOT complete until you have executed at least one Edit, Write, or test-running Bash command. Discovery without follow-through is FAILURE.",
    "2. Make REAL changes by directly editing source files (Edit/Write) and running real tests/builds (Bash). Do NOT narrate fictional changes.",
    "3. Do NOT call `danteforge improve`, `danteforge score`, or any other danteforge meta-command. The orchestrator handles scoring. Your job is to write code.",
    "4. Read-before-edit is enforced: ALWAYS Read a file in full (no offset/limit) before you Edit it. If a file is too large, **pick a smaller file in the same area** instead. Do NOT bail.",
    "5. **Run tests from the repo root, never `cd ... && npm test`.** Use `npm test --workspace=packages/vscode` or `npx vitest run packages/vscode/src/X.test.ts`.",
    "6. Pick a small, contained target. One new test file, one error message improved, one input validated.",
    "7. Every claim of \"done\" must point to a tool call you actually executed this turn.",
    "8. After edits, run the relevant test command and report the actual exit status. End with a one-paragraph summary.",
    advice ? `\nDimension-specific guidance: ${advice}` : "",
    "",
    "Stop after one solid improvement and a verification step. The orchestrator will re-score and either run another cycle or move to the next dimension.",
  ]
    .filter(Boolean)
    .join("\n");
}

const DIMENSION_HINTS: Record<string, string> = {
  testing:
    "Add real test files for under-tested modules. Use vitest with EXPLICIT imports — start the test file with `import { describe, it, expect, vi } from 'vitest';` (this repo does NOT use vitest globals, so `vitest.describe()` will fail). Test files go next to the source as `<module>.test.ts` or in `__tests__/`.",
  error_handling:
    "Find code paths that throw bare errors or swallow exceptions. Add specific error types, user-friendly messages, and recovery where reasonable.",
  ux_polish:
    "Identify rough CLI/UI surfaces (inconsistent help text, missing progress feedback, confusing flags). Smooth them.",
  documentation:
    "Update README, JSDoc on exported APIs, or examples for under-documented packages. Keep it accurate.",
  performance:
    "Profile a hot path or measurable operation. Optimize a real bottleneck. Show before/after timings.",
  maintainability:
    "Reduce duplication, split god-files, improve naming on public APIs. Don't refactor for refactoring's sake.",
  developer_experience:
    "Improve developer onboarding: scripts, error messages on common mistakes, faster feedback loops.",
  autonomy:
    "Enhance the agent's ability to recover from errors, verify its own work, or chain operations without human intervention.",
  self_improvement:
    "Strengthen the lesson-capture or retrospective loop. Make failures more learnable.",
  convergence_self_healing:
    "Add detection + repair for an anti-pattern (loops, fabrication, stalls).",
  token_economy:
    "Reduce wasted tokens: tighter prompts, smarter context selection, cache reuse.",
  context_economy:
    "Improve relevance of files/snippets included in context. Cut noise.",
  ecosystem_mcp:
    "Expand MCP tool coverage or add a useful integration.",
  functionality:
    "Implement a missing capability that users would actually reach for.",
  security:
    "Tighten input validation, dependency hygiene, or secret handling on a real attack surface.",
};

// ── Shell helper ────────────────────────────────────────────────────────────

/**
 * Run a shell command, streaming stdout/stderr via onChunk and resolving with
 * the full combined output on exit. Mirrors slash-commands.ts's runStreaming.
 */
export function runShellStreaming(
  command: string,
  options: { cwd: string; timeoutMs: number },
  onChunk?: (text: string) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { cwd: options.cwd, shell: true, windowsHide: true });
    let combined = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Command timed out after ${options.timeoutMs}ms: ${command}`));
    }, options.timeoutMs);
    const handle = (buf: Buffer): void => {
      const text = buf.toString();
      combined += text;
      onChunk?.(text);
    };
    child.stdout?.on("data", handle);
    child.stderr?.on("data", handle);
    child.on("error", (err) => { clearTimeout(timer); reject(err); });
    child.on("close", () => { clearTimeout(timer); resolve(combined); });
  });
}
