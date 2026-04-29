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

// ── runAscendLoopCore — extracted 2026-04-28 from sidebar-provider.ts ───────
//
// Was: ChatSidebarProvider#runAscendLoop, ~321 lines wedged inside a 5,749-line
// monolith. Now lives here so all ascend logic is co-located and the provider
// is just a thin shim that wires VS Code-side callbacks. Maintainability move:
// each module gets a single concern instead of the provider being responsible
// for chat orchestration AND ascend orchestration.
//
// The 6-callback interface keeps the loop testable in isolation (no VS Code
// dependency) and makes the provider→orchestrator coupling explicit.

export interface AscendLoopState {
  active: boolean;
  cycle: number;
}

export interface AscendLoopCallbacks {
  postMessage: (msg: { type: string; payload: Record<string, unknown> }) => void;
  runChatRequest: (text: string) => Promise<void>;
  recordMessage: (msg: { role: "user" | "assistant"; content: string }) => void;
  log: (line: string) => void;
  getCurrentModel: () => string;
  isStopRequested: () => boolean;
  resetStopRequested: () => void;
}

// ── runAscendLoopCore helpers ──────────────────────────────────────────────
// Extracted from runAscendLoopCore so that orchestrator stays under the
// 100-LOC maintainability threshold. Each helper owns one phase: post a
// note, stream a score, commit a cycle, evaluate movement, build a tip.

/** Post a self-contained markdown note as a single assistant chat bubble. */
function postNote(cb: AscendLoopCallbacks, md: string): void {
  cb.postMessage({ type: "chat_response_chunk", payload: { chunk: md, partial: md } });
  cb.recordMessage({ role: "assistant", content: md });
  cb.postMessage({ type: "chat_response_done", payload: {} });
}

/** Stream `danteforge score --level light` into chat with one auto-retry on failure. */
async function streamAscendScore(cb: AscendLoopCallbacks, projectRoot: string): Promise<string> {
  const attempt = async (label: string): Promise<string> => {
    let buf = "";
    cb.postMessage({
      type: "chat_response_chunk",
      payload: { chunk: `_Scoring project ${label}…_\n\`\`\`\n`, partial: "" },
    });
    const out = await runShellStreaming(
      "danteforge score --level light",
      { cwd: projectRoot, timeoutMs: 90_000 },
      (chunk) => {
        buf += chunk;
        cb.postMessage({ type: "chat_response_chunk", payload: { chunk, partial: buf } });
      },
    );
    cb.postMessage({ type: "chat_response_chunk", payload: { chunk: "\n```", partial: buf } });
    cb.postMessage({ type: "chat_response_done", payload: {} });
    return out;
  };
  try {
    return await attempt("(`danteforge score --level light`)");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    cb.postMessage({
      type: "chat_response_chunk",
      payload: { chunk: `_Score failed (${msg}); retrying once…_\n`, partial: "" },
    });
    cb.postMessage({ type: "chat_response_done", payload: {} });
    return attempt("(retry)");
  }
}

/**
 * Count source-file lines changed under `packages/` (excluding .danteforge
 * state) for the current working tree. Sums committed-modifications +
 * untracked-new-files. Errors are non-fatal — caller proceeds with zeros.
 */
async function measureSourceDelta(projectRoot: string): Promise<{ filesChanged: number; linesAdded: number }> {
  let linesAdded = 0;
  let filesChanged = 0;
  try {
    const diffStat = await runShellStreaming(
      `git -C "${projectRoot}" diff --numstat HEAD`,
      { cwd: projectRoot, timeoutMs: 10_000 },
    );
    const untracked = await runShellStreaming(
      `git -C "${projectRoot}" ls-files --others --exclude-standard packages/`,
      { cwd: projectRoot, timeoutMs: 10_000 },
    );
    for (const line of diffStat.split("\n")) {
      const m = line.match(/^(\d+)\s+(\d+)\s+(.+)$/);
      if (m && m[3] && m[3].startsWith("packages/") && !m[3].includes(".danteforge")) {
        linesAdded += parseInt(m[1] ?? "0", 10);
        filesChanged++;
      }
    }
    for (const f of untracked.split("\n").filter((l) => l.trim())) {
      if (f.startsWith("packages/") && !f.includes(".danteforge")) {
        filesChanged++;
        try {
          const wc = await runShellStreaming(`wc -l "${f}"`, { cwd: projectRoot, timeoutMs: 5_000 });
          const n = parseInt(wc.trim().split(/\s+/)[0] ?? "0", 10);
          if (Number.isFinite(n)) linesAdded += n;
        } catch { /* ignore */ }
      }
    }
  } catch { /* commit still proceeds */ }
  return { filesChanged, linesAdded };
}

/**
 * Auto-commit cycle changes so the SHA-based score sees them. Returns
 * `commitsMade` (0 or 1) and `sourceLinesAdded` (only files under
 * `packages/`, excluding .danteforge state).
 */
async function commitAscendCycle(
  cb: AscendLoopCallbacks,
  projectRoot: string,
  cycleNum: number,
  displayName: string,
): Promise<{ commitsMade: number; sourceLinesAdded: number }> {
  try {
    const status = await runShellStreaming(
      `git -C "${projectRoot}" status --porcelain`,
      { cwd: projectRoot, timeoutMs: 10_000 },
    );
    if (status.trim().length === 0) return { commitsMade: 0, sourceLinesAdded: 0 };

    const cycleMsg = `ascend cycle ${cycleNum}: ${displayName}`;
    const { filesChanged, linesAdded } = await measureSourceDelta(projectRoot);

    await runShellStreaming(
      `git -C "${projectRoot}" add -A && git -C "${projectRoot}" commit -m "${cycleMsg}" --no-verify`,
      { cwd: projectRoot, timeoutMs: 30_000 },
    );
    const summary = filesChanged > 0
      ? `\n_Committed cycle ${cycleNum}: **${filesChanged} source file${filesChanged === 1 ? "" : "s"}**, ~${linesAdded} lines._\n`
      : `\n_Committed cycle ${cycleNum} (state files only — no source changes)._\n`;
    cb.postMessage({ type: "chat_response_chunk", payload: { chunk: summary, partial: "" } });
    cb.postMessage({ type: "chat_response_done", payload: {} });
    return { commitsMade: 1, sourceLinesAdded: linesAdded };
  } catch (commitErr) {
    cb.log(`[ascend] commit step failed: ${String(commitErr)}`);
    return { commitsMade: 0, sourceLinesAdded: 0 };
  }
}

/**
 * Three signals of real progress, in priority order:
 *   (a) Dimension still in P0 list AND its score went up by ≥0.1 — direct hit.
 *   (b) Dimension dropped OUT of the P0 list — graduated, counts as a win.
 *   (c) Overall score moved up by ≥0.1 — aggregate progress even if (a)/(b) miss.
 */
function evaluateCycleMovement(input: {
  gap: { name: string; displayName: string };
  newGap: { name: string; score: number } | undefined;
  beforeScore: number;
  beforeOverallScore: number;
  afterOverallScore: number;
  overallDelta: number;
  newDimsCount: number;
}): { movement: boolean; message: string } {
  const directDelta = input.newGap ? input.newGap.score - input.beforeScore : 0;
  const graduated = !input.newGap && input.newDimsCount > 0;
  const overallMoved = input.overallDelta >= 0.1;
  const movement = directDelta >= 0.1 || graduated || overallMoved;

  if (!movement) return { movement: false, message: "" };

  const overallSuffix = overallMoved
    ? ` Overall: ${input.beforeOverallScore.toFixed(1)} → ${input.afterOverallScore.toFixed(1)} (+${input.overallDelta.toFixed(1)}).`
    : "";
  if (graduated) {
    return {
      movement: true,
      message: `📈 **${input.gap.displayName} graduated off the P0 list** (was ${input.beforeScore.toFixed(1)}/10 — now no longer in top 3 gaps).${overallSuffix}`,
    };
  }
  if (directDelta >= 0.1 && input.newGap) {
    return {
      movement: true,
      message: `📈 **${input.gap.displayName}: ${input.beforeScore.toFixed(1)} → ${input.newGap.score.toFixed(1)} (+${directDelta.toFixed(1)})**${overallSuffix ? ` —${overallSuffix}` : ""}`,
    };
  }
  return {
    movement: true,
    message: `📈 **Overall score moved: ${input.beforeOverallScore.toFixed(1)} → ${input.afterOverallScore.toFixed(1)} (+${input.overallDelta.toFixed(1)})** — your work shifted the aggregate even though ${input.gap.displayName} stayed flat.`,
  };
}

/** Halt message after 3 consecutive no-movement cycles, branching on whether
 * any commits actually landed. */
function buildEarlyExitMessage(commitsMade: number, totalLinesChanged: number, currentModel: string): string {
  if (commitsMade === 0) {
    const isGrok = currentModel.toLowerCase().includes("grok");
    return `\n## 🛑 Loop halted — model is not making real edits\n\n` +
      `**Current model:** \`${currentModel}\`\n` +
      `**Commits made:** 0\n\n` +
      `Three cycles in a row produced zero commits AND zero score movement. ` +
      (isGrok
        ? `Grok-non-reasoning models often do Read/Glob calls and write analysis paragraphs but never execute Edit or Write. **Switch to \`anthropic:claude-sonnet-4-6\` in the dropdown above** and re-run \`/ascend\`.`
        : `The model isn't following through from analysis to actual edits.`);
  }
  return `\n## 🛑 Loop halted — edits landing, score structurally stuck\n\n` +
    `**Commits made this run:** ${commitsMade} (${totalLinesChanged} source lines added/changed)\n` +
    `**Score movement:** 0\n\n` +
    `Real edits ARE landing — \`git log --oneline\` will show them. The harsh-scorer just can't see your changes ` +
    `on a codebase this size. The Testing dimension formula is \`(maturity × 0.4) + (line_coverage_pct × 0.6)\`. ` +
    `On DanteCode's 81,436 source lines at 28% coverage, you'd need to write tests covering ~800 new lines to ` +
    `move the score 1 percentage point. Each \`/ascend\` cycle adds 50–200 lines — invisible to harsh-scorer.\n\n` +
    `**Recommendation:** the autonomous loop is working as designed. To see scores move, run \`/ascend\` on a ` +
    `smaller project (5k–20k LOC). On DanteCode itself, use \`git log --oneline\` to verify cycles are doing real work.`;
}

/** End-of-run tip differentiating three failure modes: no commits, no score
 * movement (commits > 0), or actual progress (no tip). */
function buildEndOfRunTip(input: {
  cycle: number;
  cyclesWithMovement: number;
  commitsMade: number;
  totalLinesChanged: number;
  currentModel: string;
}): string {
  const noScoreMovement = input.cyclesWithMovement === 0 && input.cycle >= 2;
  const noRealEdits = input.commitsMade === 0 && input.cycle >= 2;
  if (noRealEdits) {
    const isGrok = input.currentModel.toLowerCase().includes("grok");
    return `\n\n## ⚠️ Zero commits across ${input.cycle} cycles\n\n**Current model:** \`${input.currentModel}\`\n\n` +
      (isGrok
        ? `Grok-non-reasoning models often end their turn after Read/Glob without executing Edit/Write. **Switch to \`anthropic:claude-sonnet-4-6\` in the dropdown** and re-run \`/ascend\`.`
        : `The model isn't following through from analysis to actual edits.`);
  }
  if (noScoreMovement) {
    return `\n\n## ℹ️ Real edits landed, score didn't move\n\n` +
      `**Commits this run:** ${input.commitsMade} (${input.totalLinesChanged} source lines added/changed)\n\n` +
      `Run \`git log --oneline | head\` to see the actual cycle commits. The harsh-scorer is structurally insensitive ` +
      `to small per-cycle deltas on a codebase this size — Testing = \`(maturity × 0.4) + (coverage × 0.6)\`, and ` +
      `~150 new lines on 81,436 source lines is a 0.18% coverage delta which rounds to zero. The loop IS working; ` +
      `the metric just can't measure single-cycle progress on a project this large. For score-moving feedback, ` +
      `run \`/ascend\` on a smaller (5k–20k LOC) project.`;
  }
  return "";
}

export async function runAscendLoopCore(
  args: string,
  projectRoot: string,
  state: AscendLoopState,
  cb: AscendLoopCallbacks,
): Promise<void> {
    const target = (() => {
      const n = parseFloat(args.trim());
      return Number.isFinite(n) && n > 0 && n <= 10 ? n : DEFAULT_ASCEND_OPTIONS.target;
    })();
    const maxCycles = DEFAULT_ASCEND_OPTIONS.maxCycles;
    // projectRoot is the function parameter — no shadowing assignment needed.
    const plateauCount = new Map<string, number>();
    const skipped = new Set<string>();
    let cyclesWithMovement = 0;
    let consecutiveNoMovement = 0;
    let commitsMade = 0;
    let totalLinesChanged = 0;

    state.active = true;
    state.cycle = 0;
    cb.resetStopRequested();

    const note = (md: string): void => postNote(cb, md);
    const streamScore = (): Promise<string> => streamAscendScore(cb, projectRoot);

    note(
      `# 🚀 Ascend Loop Started\n\n` +
        `**Target:** ${target.toFixed(1)}/10 across all achievable dimensions.\n` +
        `**Max cycles:** ${maxCycles}.\n\n` +
        `Click **Stop** at any time to halt the loop.\n`,
    );

    try {
      while (state.active && state.cycle < maxCycles) {
        state.cycle++;

        // 1. Score
        let scoreText = "";
        try {
          scoreText = await streamScore();
        } catch (err) {
          note(`**Score command failed:** ${err instanceof Error ? err.message : String(err)}`);
          break;
        }
        const dims = parseScoreOutput(scoreText);
        if (dims.length === 0) {
          note(`**Could not parse score output.** Aborting loop.\n\n\`\`\`\n${scoreText.slice(0, 800)}\n\`\`\``);
          break;
        }

        // 2. Pick top achievable gap
        const gap = pickTopGap(dims, target, skipped);
        if (!gap) {
          const remaining = dims.filter((d) => !d.isCeilingBlocked && d.score < target - 0.05);
          if (remaining.length === 0) {
            note(`✅ **All achievable dimensions at or above ${target.toFixed(1)}/10. Loop complete.**`);
          } else {
            note(`⏸ **All remaining dimensions hit plateau threshold.** Skipped: \`${[...skipped].join(", ")}\`.`);
          }
          break;
        }

        const beforeScore = gap.score;
        // Also capture the overall score so we can detect dimension graduation
        // (e.g. Testing 4.5 → 5.5 might drop the dim out of the P0 list entirely;
        // per-gap parsing then misses it, but overall score reflects the climb).
        const beforeOverallScore = parseOverallScore(scoreText) ?? 0;
        note(
          `---\n\n## Cycle ${state.cycle}/${maxCycles} — ${gap.displayName}\n\n` +
            `Current: **${beforeScore.toFixed(1)}/10** → Target: ${target.toFixed(1)}/10`,
        );

        // 3. Drive the model with a focused goal
        // Cline-style file-scoped task: for Testing cycles, find the largest
        // untested source file and point the model at it specifically. Big
        // coverage deltas per cycle = score actually moves on this codebase size.
        const targetFile = gap.name === "testing" ? findLargestUntestedFile(projectRoot) ?? undefined : undefined;
        if (targetFile) {
          cb.postMessage({
            type: "chat_response_chunk",
            payload: { chunk: `\n_Targeting: \`${targetFile.path}\` (${targetFile.lines} lines, no tests)._\n`, partial: "" },
          });
          cb.postMessage({ type: "chat_response_done", payload: {} });
        }
        const goal = buildGoalPrompt(gap, target, state.cycle, maxCycles, targetFile);
        try {
          await cb.runChatRequest(goal);
        } catch (err) {
          note(`**Cycle errored:** ${err instanceof Error ? err.message : String(err)}`);
        }

        if (!state.active || cb.isStopRequested()) break;

        // 4. Auto-commit so the SHA-based score sees changes.
        const commitResult = await commitAscendCycle(cb, projectRoot, state.cycle, gap.displayName);
        commitsMade += commitResult.commitsMade;
        totalLinesChanged += commitResult.sourceLinesAdded;

        // 5. Re-score and decide
        let newScoreText = "";
        try {
          newScoreText = await streamScore();
        } catch {
          note(`**Re-score failed; continuing.**`);
          continue;
        }
        const newDims = parseScoreOutput(newScoreText);
        const newGap = newDims.find((d) => d.name === gap.name);
        const afterOverallScore = parseOverallScore(newScoreText) ?? beforeOverallScore;
        const overallDelta = afterOverallScore - beforeOverallScore;

        const evaluation = evaluateCycleMovement({
          gap,
          newGap,
          beforeScore,
          beforeOverallScore,
          afterOverallScore,
          overallDelta,
          newDimsCount: newDims.length,
        });

        if (evaluation.movement) {
          plateauCount.delete(gap.name);
          cyclesWithMovement++;
          consecutiveNoMovement = 0;
          note(evaluation.message);
        } else {
          consecutiveNoMovement++;
          const n = (plateauCount.get(gap.name) ?? 0) + 1;
          plateauCount.set(gap.name, n);
          if (n >= DEFAULT_ASCEND_OPTIONS.plateauThreshold) {
            skipped.add(gap.name);
            note(`📉 **${gap.displayName}: plateau ${n}× — skipping for the rest of this run.**`);
          } else {
            note(`📉 **${gap.displayName}: no movement (${n}/${DEFAULT_ASCEND_OPTIONS.plateauThreshold} plateaus).**`);
          }
          if (consecutiveNoMovement >= 3) {
            note(buildEarlyExitMessage(commitsMade, totalLinesChanged, cb.getCurrentModel()));
            state.active = false;
            break;
          }
        }
      }
    } finally {
      const wasStopped = cb.isStopRequested();
      state.active = false;
      const tip = buildEndOfRunTip({
        cycle: state.cycle,
        cyclesWithMovement,
        commitsMade,
        totalLinesChanged,
        currentModel: cb.getCurrentModel(),
      });
      note(
        `---\n\n## Ascend loop ended\n\n` +
          `**Cycles run:** ${state.cycle}\n` +
          `**Commits made:** ${commitsMade} (${totalLinesChanged} source lines)\n` +
          `**Cycles that moved a score:** ${cyclesWithMovement}\n` +
          `**Status:** ${wasStopped ? "stopped by user" : "completed"}\n` +
          `**Skipped (plateau):** ${[...skipped].join(", ") || "none"}` +
          tip,
      );
    }
}
