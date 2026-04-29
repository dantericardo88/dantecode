// ============================================================================
// REGRESSION GUARD — DanteCode session fixes that keep reverting
//
// This test exists because fixes in sidebar-provider.ts and adjacent files
// have repeatedly reverted between sessions. It asserts the known-good state
// of patterns that have been fixed and broken multiple times. Any future
// revert that touches these patterns fails this test loudly instead of
// silently shipping broken behavior to users.
//
// Each assertion includes the original failure mode in its description so
// the next person who sees a red test knows what they just regressed.
// ============================================================================

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
const VSCODE_SRC = join(REPO_ROOT, "packages", "vscode", "src");

function read(rel: string): string {
  return readFileSync(join(VSCODE_SRC, rel), "utf-8");
}

describe("regression guard — webview HTML/JS (lives in webview-html.ts since 2026-04-28 refactor)", () => {
  // Refactor 2026-04-28: getHtmlForWebview was extracted from sidebar-provider.ts
  // (5,749 → 3,493 lines) into webview-html.ts so HTML/CSS/JS can be edited
  // independently from chat orchestration. All webview assertions now run
  // against webview-html.ts.
  const src = read("webview-html.ts");

  it("CSP uses 'unsafe-inline' (Antigravity silently blocks nonce-based CSP)", () => {
    // SYMPTOM IF BROKEN: send button does nothing, Enter creates a newline.
    // The nonce-based CSP looks correct in spec but Antigravity's webview host
    // does not honor it — scripts are silently blocked, no event handlers attach.
    // The backup 0.9.2 that worked uses 'unsafe-inline'. Stay matched to that.
    expect(src).toContain("script-src 'unsafe-inline'");
    expect(src).toContain("style-src 'unsafe-inline'");
    expect(src).not.toMatch(/script-src\s+'nonce-\$\{nonce\}'/);
  });

  it("script tag has no nonce attribute (matches CSP unsafe-inline)", () => {
    // SYMPTOM IF BROKEN: same as above. The script tag with a nonce attribute
    // worked when CSP also used nonce — when CSP regressed back to nonce and
    // the script tag had no nonce, scripts didn't run.
    expect(src).toContain("<script>");
    expect(src).not.toMatch(/<script\s+nonce="\$\{nonce\}">/);
  });

  it("streamBuffer uses escaped newlines (\\\\n, not literal \\n)", () => {
    // SYMPTOM IF BROKEN: send button does nothing, Enter creates a newline.
    // ROOT CAUSE: Codex found this. A literal \n inside a single-quoted JS
    // string in the generated webview HTML is a syntax error in the webview's
    // <script> block. The whole IIFE fails to parse → no event handlers attach.
    // FIX: escape the newlines so they emit as \n in the generated JS.
    const matches = src.match(/streamBuffer\s*\+=\s*'[^']*'/g) ?? [];
    for (const m of matches) {
      // Each streamBuffer concatenation must use escaped newlines.
      // A literal `\n` inside a single-quoted string is the regression marker.
      // (`\\n` in the TS source emits `\n` in the JS string, which is correct.)
      const hasLiteralNewlinePattern = /[^\\]\\n[^a-zA-Z]/.test(m) && !/\\\\n/.test(m);
      expect(hasLiteralNewlinePattern, `regression: ${m}`).toBe(false);
    }
  });

  it("slash menu JS is wired (SLASH_CMDS array, showSlashMenu function)", () => {
    // SYMPTOM IF BROKEN: typing "/" in the chat input shows nothing.
    // The empty <div id="slash-menu"> exists in the HTML, but the JS that
    // populated it (the SLASH_CMDS array, the input listener, the show/hide
    // functions) was deleted in a refactor.
    expect(src).toContain("var SLASH_CMDS");
    expect(src).toContain("function showSlashMenu");
    expect(src).toContain("function hideSlashMenu");
    expect(src).toMatch(/inputEl\.addEventListener\(['"]input['"]/);
  });

  it("Send button and Enter key handlers wired", () => {
    // SYMPTOM IF BROKEN: clicking Send or pressing Enter does nothing.
    expect(src).toMatch(/sendBtn\.addEventListener\(['"]click['"]\s*,\s*sendMessage\)/);
    expect(src).toMatch(/inputEl\.addEventListener\(['"]keydown['"]/);
    expect(src).toMatch(/e\.key\s*===\s*['"]Enter['"]\s*&&\s*!e\.shiftKey/);
  });
});

describe("regression guard — slash-commands.ts PATH + streaming", () => {
  const src = read("slash-commands.ts");

  it("uses exec/spawn (shell mode) not execFile (bare PATH)", () => {
    // SYMPTOM IF BROKEN: /score returns "spawn danteforge ENOENT".
    // ROOT CAUSE: VS Code/Antigravity extensions spawn child processes
    // without the npm global bin dir on PATH. execFile does not inherit
    // the user's full PATH. exec/spawn with shell:true do.
    expect(src).toMatch(/import\s*\{[^}]*\b(exec|spawn)\b[^}]*\}\s*from\s*["']node:child_process["']/);
    expect(src).not.toMatch(/import\s*\{\s*execFile\s*\}\s*from\s*["']node:child_process["']/);
  });

  it("has runStreaming helper that uses spawn with shell:true", () => {
    // SYMPTOM IF BROKEN: /score and /ascend buffer output and dump everything
    // at the end — user stares at silence for 30+ seconds, then a wall of text.
    // FIX: spawn-based streaming with onChunk callback so output appears live.
    expect(src).toContain("function runStreaming");
    expect(src).toMatch(/spawn\s*\([^)]*\bshell\s*:\s*true/);
  });

  it("/score and /ascend pass onChunk to runStreaming", () => {
    // SYMPTOM IF BROKEN: streaming helper exists but commands don't use it,
    // so output still buffers. Both commands must invoke onChunk.
    expect(src).toMatch(/runStreaming\s*\(\s*[`"]danteforge\s+score/);
    expect(src).toMatch(/runStreaming\s*\(\s*[`"]danteforge\s+ascend/);
  });

  it("SlashCommand.execute accepts an onChunk callback", () => {
    // SYMPTOM IF BROKEN: execute signature is (args, projectRoot) without
    // the third onChunk param, so streaming callbacks never fire.
    expect(src).toMatch(/execute\?:[\s\S]{0,200}onChunk\?:[\s\S]{0,80}=>\s*void/);
  });
});

describe("regression guard — test-framework-detector.ts (lazy glob)", () => {
  const src = read("test-framework-detector.ts");

  it("glob is loaded lazily, NOT at module-eval time", () => {
    // SYMPTOM IF BROKEN: extension fails to activate with no error message in
    // the chat panel. The bypass log shows no "activate() ENTERED". Antigravity's
    // exthost.log shows "Activating extension dantecode.dantecode failed".
    // ROOT CAUSE: a top-level `requireGlob("glob")` at module load throws when
    // glob is not resolvable from the bundle's __filename. That kills the entire
    // import chain in extension.ts — activate() never gets a chance to run.
    // FIX: wrap the require in a function that runs on first use.

    // The eager pattern (forbidden):
    expect(src).not.toMatch(/^const\s*\{\s*glob\s*:\s*\w+\s*\}\s*=\s*requireGlob\(["']glob["']\)/m);
    // The lazy pattern (required):
    expect(src).toMatch(/function\s+getLegacyGlob\s*\(/);
  });
});

describe("regression guard — deploy script", () => {
  const src = readFileSync(
    join(REPO_ROOT, "packages", "vscode", "scripts", "deploy-local.mjs"),
    "utf-8",
  );

  it("deploys to BOTH ~/.vscode and ~/.antigravity extension dirs", () => {
    // SYMPTOM IF BROKEN: builds appear to succeed but Antigravity keeps loading
    // the old version. User is on Antigravity, not VS Code.
    expect(src).toContain(".antigravity");
    expect(src).toContain(".vscode");
  });
});

describe("regression guard — checkpoint-manager.ts (stash bug)", () => {
  const src = read("checkpoint-manager.ts");

  it("snapshot strategy wins when fileSnapshots is provided", () => {
    // SYMPTOM IF BROKEN: during /ascend, agent edits appear briefly in the
    // working tree, then vanish. New test files end up in `git stash` instead
    // of in the commit.
    // ROOT CAUSE: setPendingDiff calls createCheckpoint with fileSnapshots,
    // but the implementation preferred `git stash push -u` which captures and
    // REMOVES untracked files (including the agent's just-written file).
    // FIX: when fileSnapshots is provided, use the snapshot strategy and do
    // not touch the working tree. Only stash for full-state manual checkpoints.
    expect(src).toMatch(/fileSnapshots\s*&&\s*options\.fileSnapshots\.length\s*>\s*0/);
    // The dangerous order — stash check before snapshot check — must NOT be present
    // as the FIRST conditional after the baseRecord declaration.
    const stashFirst = /baseRecord[\s\S]{0,200}canUseGitStash[\s\S]{0,500}fileSnapshots/;
    const snapshotFirst = /baseRecord[\s\S]{0,500}fileSnapshots[\s\S]{0,500}canUseGitStash/;
    expect(snapshotFirst.test(src), "snapshot check must come before canUseGitStash").toBe(true);
    expect(stashFirst.test(src) && !snapshotFirst.test(src)).toBe(false);
  });
});

describe("regression guard — extension.ts activation safety", () => {
  const src = read("extension.ts");

  it("activate() is wrapped so a thrown error surfaces to the user", () => {
    // SYMPTOM IF BROKEN: chat panel renders blank. No error message anywhere.
    // The bypass log shows no activation entries. Reload doesn't help.
    // FIX: wrap activate() body in try/catch and showErrorMessage on throw.
    expect(src).toContain("activate() ENTERED");
    expect(src).toContain("activate() THREW");
    expect(src).toMatch(/showErrorMessage[\s\S]{0,200}activation\s+failed/i);
  });

  it("onDidWriteTerminalData call is wrapped in try/catch", () => {
    // SYMPTOM IF BROKEN: activation fails with "Extension cannot use API
    // proposal: terminalDataWriteEvent". Chat panel never renders.
    // ROOT CAUSE: typeof check passes (function exists) but CALLING it throws
    // unless the extension declares the proposal AND the editor is launched
    // with --enable-proposed-api dantecode.dantecode.
    // FIX: wrap the call (not just the existence check) in try/catch so the
    // proposal-not-enabled throw degrades gracefully — terminal capture is
    // optional, the rest of the extension works without it.
    expect(src).toMatch(/try\s*\{[\s\S]{0,400}onDidWriteTerminalData[\s\S]{0,500}catch\s*\(/);
  });
});

describe("regression guard — file existence (don't lose new modules)", () => {
  it("checkpoint-manager.ts exists", () => {
    expect(existsSync(join(VSCODE_SRC, "checkpoint-manager.ts"))).toBe(true);
  });

  it("deploy-local.mjs exists", () => {
    expect(existsSync(join(REPO_ROOT, "packages", "vscode", "scripts", "deploy-local.mjs"))).toBe(true);
  });

  it("ascend-orchestrator.ts exists (has been deleted multiple times)", () => {
    // SYMPTOM IF BROKEN: /ascend falls back to shell-out, which is theater —
    // "Wave NaN", "+0.0" deltas, "Dimensions improved: 0", "SUCCESS".
    expect(existsSync(join(VSCODE_SRC, "ascend-orchestrator.ts"))).toBe(true);
  });

  it("webview-html.ts exists (extracted from sidebar-provider 2026-04-28)", () => {
    // SYMPTOM IF BROKEN: refactor reverted, sidebar-provider.ts ballooned back
    // to 5700+ lines. CSP / slash menu / Send-button fixes can co-revert again.
    expect(existsSync(join(VSCODE_SRC, "webview-html.ts"))).toBe(true);
  });

  it("sidebar-provider.ts delegates HTML to webview-html.ts (no inline template)", () => {
    // SYMPTOM IF BROKEN: someone re-inlined the 2200-line template literal.
    const sp = read("sidebar-provider.ts");
    expect(sp).toContain('from "./webview-html.js"');
    expect(sp).toContain("getWebviewHtml(this.currentModel)");
    // Confirm sidebar-provider doesn't re-grow with inline HTML.
    // 4500 is a generous ceiling — the file was 3493 right after refactor.
    expect(sp.split("\n").length).toBeLessThan(4500);
  });
});

describe("regression guard — ascend orchestrator wiring", () => {
  const orch = read("ascend-orchestrator.ts");
  const provider = read("sidebar-provider.ts");

  it("orchestrator exports the four pure helpers", () => {
    // SYMPTOM IF BROKEN: runAscendLoop fails on import — TypeError on undefined.
    expect(orch).toMatch(/export function parseScoreOutput\b/);
    expect(orch).toMatch(/export function pickTopGap\b/);
    expect(orch).toMatch(/export function buildGoalPrompt\b/);
    expect(orch).toMatch(/export function runShellStreaming\b/);
    expect(orch).toMatch(/export const DEFAULT_ASCEND_OPTIONS\b/);
  });

  it("provider has runAscendLoop method and ascendActive state", () => {
    // SYMPTOM IF BROKEN: /ascend has no orchestrator path; falls back to shell.
    expect(provider).toMatch(/private\s+ascendActive\s*=\s*false/);
    expect(provider).toMatch(/private\s+ascendCycle\s*=\s*0/);
    expect(provider).toMatch(/private\s+async\s+runAscendLoop\s*\(/);
  });

  it("/ascend hook in tryExecuteSlashCommand routes to runAscendLoop", () => {
    // SYMPTOM IF BROKEN: /ascend hits the execute() shell-out fallback, which
    // produces "Wave NaN" theater. The orchestrator hook MUST come BEFORE the
    // execute() check.
    expect(provider).toMatch(/parsed\.command\.name\s*===\s*["']ascend["']/);
    expect(provider).toMatch(/await this\.runAscendLoop\s*\(/);
  });

  it("self-improvement context falls back when ascendActive", () => {
    // SYMPTOM IF BROKEN: every Edit to packages/vscode/src/* during /ascend
    // gets blocked with "Self-modification blocked: This file is protected."
    // The model sees the tool error and gives up.
    expect(provider).toMatch(/this\.ascendActive[\s\S]{0,200}createSelfImprovementContext[\s\S]{0,200}ascend-self-improve/);
  });

  it("handleStopGeneration clears ascendActive", () => {
    // SYMPTOM IF BROKEN: clicking Stop aborts the in-flight model call but the
    // loop starts the next cycle anyway.
    expect(provider).toMatch(/handleStopGeneration[\s\S]{0,300}this\.ascendActive\s*=\s*false/);
  });

  it("orchestrator has known ceiling dimensions", () => {
    // SYMPTOM IF BROKEN: ceiling-blocked dimensions consume cycles forever.
    expect(orch).toContain("community_adoption");
    expect(orch).toContain("enterprise_readiness");
    expect(orch).toContain("context_economy");
  });

  it("score-movement detection handles dimension graduation + overall score", () => {
    // SYMPTOM IF BROKEN: a cycle improves Testing enough that it drops out of
    // the P0 gaps list (replaced by the next-worst dimension). The per-gap
    // parser doesn't see Testing in the new output, falls back to beforeScore,
    // and reports "no movement" — even though the overall score went 6.2 → 6.5.
    // FIX: parseOverallScore + graduation detection (newGap === undefined &&
    // newDims.length > 0) + overall-score-moved fallback.
    // (Logic now lives in ascend-orchestrator.ts after 2026-04-28 extraction.)
    expect(orch).toMatch(/export function parseOverallScore/);
    expect(orch).toMatch(/parseOverallScore\s*\(/);
    expect(orch).toMatch(/graduated/);
    expect(orch).toMatch(/overallMoved|overallDelta/);
  });

  it("runAscendLoop is a thin shim delegating to runAscendLoopCore in orchestrator", () => {
    // SYMPTOM IF BROKEN: someone re-inlined the 320-line ascend loop body back
    // into sidebar-provider.ts. Maintainability score stops moving; future
    // changes to the loop have to navigate a 5,000+ line monolith.
    // FIX: provider's runAscendLoop is a callback-wiring shim (~25 lines);
    // orchestrator owns the loop logic via runAscendLoopCore.
    expect(orch).toMatch(/export\s+async\s+function\s+runAscendLoopCore\s*\(/);
    expect(orch).toMatch(/AscendLoopCallbacks/);
    expect(provider).toMatch(/runAscendLoopCore\s*\(\s*args/);
    // Provider's runAscendLoop method is now small — fewer than 40 lines from
    // signature to closing brace. If someone re-inlines, this fails.
    const match = provider.match(/private\s+async\s+runAscendLoop[\s\S]*?\n  \}/);
    expect(match).not.toBeNull();
    if (match) {
      const lineCount = match[0].split("\n").length;
      expect(lineCount).toBeLessThan(40);
    }
  });

  it("SWE-bench harness pre-executes failing tests to prime the agent (OpenHands CodeAct)", () => {
    // OpenHands CodeAct pattern — running the FAIL_TO_PASS tests once
    // before the agent edits. The stack trace becomes priming context so
    // the agent doesn't have to discover the failure through exploration.
    // Targets the test_assertion bucket (model produces wrong fix because
    // it never saw the real error). If this regresses, every cycle wastes
    // budget rediscovering bugs.
    const runner = readFileSync(
      join(REPO_ROOT, "packages", "cli", "src", "swe-bench-runner.ts"),
      "utf-8",
    );
    expect(runner).toMatch(/Pre-execute the failing tests/);
    expect(runner).toMatch(/runTests\(failToPassEarly/);
    expect(runner).toMatch(/failingTestsPriming/);
    expect(runner).toMatch(/Failing tests output \(pre-execution/);
  });

  it("SubmitPatch tool wired into agent-tools (SWE-agent ACI harvest)", () => {
    // SWE-agent's ACI primitive — agent signals "this is my final patch."
    // Fights two top SWE-bench failure modes: empty-patch (no_patch:7) and
    // patch-context fabrication (compile_error:4) by surfacing the working
    // diff and pre-validating Python syntax. If this regresses, the SWE-bench
    // dim 5 sprint loses its primary lever.
    const tools = read("agent-tools.ts");
    expect(tools).toContain("\"SubmitPatch\"");
    expect(tools).toMatch(/case\s+["']SubmitPatch["']\s*:/);
    expect(tools).toMatch(/async function toolSubmitPatch/);
    expect(tools).toMatch(/git diff HEAD --no-color/);
    expect(tools).toMatch(/no changes detected/);
    expect(tools).toMatch(/python -m py_compile/);
    expect(tools).toMatch(/KNOWN_TOOL_NAMES[\s\S]{0,400}SubmitPatch/);
  });

  it("ReplaceInFile tool wired into agent-tools (Cline harvest)", () => {
    // Cline's `replace_in_file` pattern: model emits SEARCH/REPLACE diff blocks,
    // runtime applies via 4-strategy fuzzy fallback. Dramatically reduces
    // edit-failure rate vs free-form Edit(old_string, new_string) which is
    // offset-bug-prone. Hits error_handling, maintainability, developer_experience,
    // functionality dimensions simultaneously.
    const tools = read("agent-tools.ts");
    expect(tools).toContain("\"ReplaceInFile\"");
    expect(tools).toMatch(/case\s+["']ReplaceInFile["']\s*:/);
    expect(tools).toMatch(/async function toolReplaceInFile/);
    expect(tools).toMatch(/parseSearchReplaceBlocks|applySearchReplaceBlock/);
    // Whitelist must include it so phantom-call detection doesn't reject it.
    expect(tools).toMatch(/KNOWN_TOOL_NAMES[\s\S]{0,200}ReplaceInFile/);
  });

  it("orchestrator has Cline-style file-scoped task helper", () => {
    // SYMPTOM IF BROKEN: every Testing cycle gives Grok a vague "improve testing"
    // goal. Grok picks any random file or a small one with already-existing tests.
    // Result: tiny coverage deltas, score doesn't move.
    // FIX: findLargestUntestedFile picks the biggest source file with NO test,
    // and buildGoalPrompt scopes the cycle to writing tests for THAT specific file.
    // (After 2026-04-28 extraction the call site lives in orchestrator's runAscendLoopCore.)
    expect(orch).toMatch(/export function findLargestUntestedFile/);
    expect(orch).toMatch(/buildGoalPrompt[\s\S]{0,300}targetFile\?:/);
    expect(orch).toMatch(/findLargestUntestedFile\s*\(\s*projectRoot\s*\)/);
  });

  it("input-validation primitives exist and are exported from core", () => {
    // SYMPTOM IF BROKEN: harsh-scorer drops security 9.5 → 7.0 because the
    // checkInfraFile('input-validation.ts') evidence flag flips off. Worse,
    // any code path that takes user-supplied paths/URLs/shell args loses its
    // boundary-point sanitization (path traversal, SSRF, command injection).
    const ivPath = join(REPO_ROOT, "packages", "core", "src", "input-validation.ts");
    expect(existsSync(ivPath)).toBe(true);
    const iv = readFileSync(ivPath, "utf-8");
    expect(iv).toMatch(/export function validateRelativePath/);
    expect(iv).toMatch(/export function validateHttpUrl/);
    expect(iv).toMatch(/export function validateShellArg/);
    expect(iv).toMatch(/export function escapeHtml/);
    // Index re-export so consumers can `import { validateHttpUrl } from "@dantecode/core"`.
    const coreIndex = readFileSync(join(REPO_ROOT, "packages", "core", "src", "index.ts"), "utf-8");
    expect(coreIndex).toMatch(/from\s+["']\.\/input-validation\.js["']/);
  });

  it("audit-panel-provider does not innerHTML-interpolate user data", () => {
    // SYMPTOM IF BROKEN: an XSS sink reappears at lines 757-774 — the previous
    // pattern was `innerHTML = '<span>...' + escapeHtml(userValue) + '</span>'`,
    // which is correct today but is one careless edit away from forgetting
    // escapeHtml. The safer pattern is DOM construction + textContent so the
    // browser handles escaping unconditionally.
    const audit = readFileSync(join(VSCODE_SRC, "audit-panel-provider.ts"), "utf-8");
    // The two specific rows must use textContent, not innerHTML.
    expect(audit).toMatch(/sessionVal\.textContent\s*=/);
    expect(audit).toMatch(/modelVal\.textContent\s*=/);
    expect(audit).not.toMatch(/sessionRow\.innerHTML\s*=/);
    expect(audit).not.toMatch(/modelRow\.innerHTML\s*=/);
  });

  it("ascend loop tracks commits and reports source-line deltas", () => {
    // SYMPTOM IF BROKEN: closing summary says "no movement" even when real
    // commits landed, confusing the user into thinking nothing happened.
    // FIX: track commitsMade and totalLinesChanged; differentiate
    // "model isn't editing" (commits == 0) from "edits landed but harsh-scorer
    // can't measure them on this codebase size" (commits > 0).
    // (After 2026-04-28 extraction these counters live in orchestrator's runAscendLoopCore.)
    expect(orch).toMatch(/let\s+commitsMade\s*=\s*0/);
    expect(orch).toMatch(/let\s+totalLinesChanged\s*=\s*0/);
    expect(orch).toMatch(/commitsMade\+\+/);
    expect(orch).toMatch(/edits landing|edits landed/);
  });
});
