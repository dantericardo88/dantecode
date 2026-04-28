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

  it("ascend loop tracks commits and reports source-line deltas", () => {
    // SYMPTOM IF BROKEN: closing summary says "no movement" even when real
    // commits landed, confusing the user into thinking nothing happened.
    // FIX: track commitsMade and totalLinesChanged; differentiate
    // "model isn't editing" (commits == 0) from "edits landed but harsh-scorer
    // can't measure them on this codebase size" (commits > 0).
    expect(provider).toMatch(/let\s+commitsMade\s*=\s*0/);
    expect(provider).toMatch(/let\s+totalLinesChanged\s*=\s*0/);
    expect(provider).toMatch(/commitsMade\+\+/);
    expect(provider).toMatch(/edits landing|edits landed/);
  });
});
