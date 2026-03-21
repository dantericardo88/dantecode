/**
 * fearset.ts
 *
 * CLI command: dantecode fearset <subcommand>
 *
 * Subcommands:
 *   on                        Enable DanteFearSet auto-trigger
 *   off                       Disable DanteFearSet
 *   stats                     Show run statistics from disk
 *   review [resultId]         Review last result or a specific result by ID
 *   bridge [resultId]         Distill passed FearSet result(s) → write to DanteSkillbook
 *   run "<context>" [--offline]  Run fear-setting analysis (LLM by default)
 */

import type { FearSetResult } from "@dantecode/runtime-spine";
import { DEFAULT_FEARSET_CONFIG } from "@dantecode/runtime-spine";
import {
  FearSetResultStore,
  distillFearSetLesson,
  type FearSetCallbacks,
} from "@dantecode/dante-gaslight";
import { DanteSkillbookIntegration } from "@dantecode/dante-skillbook";
import { runFearSetEngine } from "@dantecode/dante-gaslight";
import { createFearSetLLMCallbacks } from "../fearset-callbacks.js";

// ────────────────────────────────────────────────────────
// ANSI helpers
// ────────────────────────────────────────────────────────

const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

// ────────────────────────────────────────────────────────
// Sub-command implementations
// ────────────────────────────────────────────────────────

function cmdOn(): void {
  console.log(
    `${GREEN}${BOLD}DanteFearSet enabled.${RESET} I will run structured risk-planning (Define\u2192Prevent\u2192Repair+Benefits+Inaction) on risky or high-stakes tasks.`,
  );
  console.log(
    `${DIM}Auto-triggers on: /fearset, destructive ops, long-horizon plans, weak robustness scores.${RESET}`,
  );
}

function cmdOff(): void {
  console.log(`${YELLOW}DanteFearSet disabled.${RESET} No automatic fear-setting will occur.`);
}

function cmdStats(projectRoot: string): void {
  const store = new FearSetResultStore({ cwd: projectRoot });
  const results = store.list();

  if (results.length === 0) {
    console.log(`${DIM}No FearSet runs recorded yet.${RESET}`);
    return;
  }

  let passCount = 0;
  let failCount = 0;
  let distilledCount = 0;
  let simulatedCount = 0;
  let totalRiskReduction = 0;

  for (const r of results) {
    if (r.passed) passCount++;
    if (r.robustnessScore?.gateDecision === "fail") failCount++;
    if (r.distilledAt) distilledCount++;
    if (r.robustnessScore?.hasSimulationEvidence) simulatedCount++;
    totalRiskReduction += r.robustnessScore?.estimatedRiskReduction ?? 0;
  }

  const avgRisk =
    results.length > 0 ? ((totalRiskReduction / results.length) * 100).toFixed(0) : "0";
  const passRate = results.length > 0 ? ((passCount / results.length) * 100).toFixed(0) : "0";

  console.log(`\n${BOLD}DanteFearSet Stats${RESET}`);
  console.log(`  Total runs:         ${CYAN}${results.length}${RESET}`);
  console.log(`  Passed:             ${GREEN}${passCount} (${passRate}%)${RESET}`);
  console.log(`  Failed:             ${RED}${failCount}${RESET}`);
  console.log(`  Distilled:          ${distilledCount}`);
  console.log(`  Simulated (w/ evidence): ${simulatedCount}`);
  console.log(`  Avg risk reduction: ${avgRisk}%`);
  console.log(
    `${DIM}  Config: mode=${DEFAULT_FEARSET_CONFIG.mode} maxTokensPerColumn=${DEFAULT_FEARSET_CONFIG.maxTokensPerColumn}${RESET}`,
  );
}

function cmdReview(args: string[], projectRoot: string): void {
  const store = new FearSetResultStore({ cwd: projectRoot });
  const idArg = args[0];

  let result: FearSetResult | null = null;
  if (idArg) {
    result = store.load(idArg);
    if (!result) throw new Error(`FearSet result not found: ${idArg}`);
  } else {
    result = store.list()[0] ?? null;
  }

  if (!result) {
    console.log(`${DIM}No FearSet runs recorded yet.${RESET}`);
    return;
  }

  console.log(`\n${BOLD}FearSet Result Review${RESET}`);
  console.log(`  ID:           ${CYAN}${result.id}${RESET}`);
  console.log(`  Context:      ${result.context.slice(0, 100)}`);
  console.log(
    `  Trigger:      ${result.trigger.channel}${result.trigger.rationale ? ` — ${result.trigger.rationale.slice(0, 60)}` : ""}`,
  );
  console.log(`  Mode:         ${result.mode}`);
  console.log(`  Columns:      ${result.columns.map((c) => c.name).join(", ")}`);
  console.log(
    `  Robustness:   ${result.robustnessScore?.overall.toFixed(2) ?? "n/a"} (${result.robustnessScore?.gateDecision ?? "pending"})`,
  );
  console.log(`  Passed:       ${result.passed ? `${GREEN}YES${RESET}` : `${RED}NO${RESET}`}`);

  if (result.synthesizedRecommendation) {
    const rec = result.synthesizedRecommendation;
    const decColor = rec.decision === "go" ? GREEN : rec.decision === "no-go" ? RED : YELLOW;
    console.log(`  Decision:     ${decColor}${BOLD}${rec.decision.toUpperCase()}${RESET}`);
    console.log(`  Reasoning:    ${rec.reasoning.slice(0, 120)}`);
    if (rec.conditions.length > 0) {
      console.log(`  Conditions:`);
      for (const c of rec.conditions) console.log(`    • ${c}`);
    }
  }

  if (result.stopReason && result.stopReason !== "completed") {
    console.log(`  Stop reason:  ${YELLOW}${result.stopReason}${RESET}`);
  }

  if (result.robustnessScore?.estimatedRiskReduction !== undefined) {
    console.log(
      `  Risk reduction: ${(result.robustnessScore.estimatedRiskReduction * 100).toFixed(0)}%`,
    );
  }

  console.log(`  Started:      ${DIM}${result.startedAt}${RESET}`);
  if (result.completedAt) console.log(`  Completed:    ${DIM}${result.completedAt}${RESET}`);

  // Column summaries
  if (result.columns.length > 0) {
    console.log(`\n${BOLD}Column Summaries:${RESET}`);
    for (const col of result.columns) {
      const indicator = col.validationWarnings?.length ? `${YELLOW}⚠${RESET}` : `${GREEN}✓${RESET}`;
      const details: string[] = [];
      if (col.worstCases.length > 0) details.push(`${col.worstCases.length} worst-cases`);
      if (col.preventionActions.length > 0)
        details.push(`${col.preventionActions.length} preventions`);
      if (col.repairPlans.length > 0) details.push(`${col.repairPlans.length} repairs`);
      if (col.benefits.length > 0) details.push(`${col.benefits.length} benefits`);
      if (col.inactionCosts.length > 0) details.push(`${col.inactionCosts.length} inaction costs`);
      console.log(
        `  ${indicator} ${CYAN}${col.name.padEnd(10)}${RESET} ${details.join(", ") || DIM + "empty" + RESET}`,
      );
      if (col.validationWarnings?.length) {
        for (const w of col.validationWarnings) console.log(`      ${DIM}! ${w}${RESET}`);
      }
    }
  }

  if (result.passed && !result.distilledAt) {
    console.log(
      `\n${GREEN}This run is distillable. Run: ${BOLD}dantecode fearset bridge${RESET}${GREEN} to write lessons to Skillbook.${RESET}`,
    );
  }
  if (result.distilledAt) {
    console.log(`\n${DIM}Distilled at: ${result.distilledAt}${RESET}`);
  }
}

async function cmdBridge(args: string[], projectRoot: string): Promise<void> {
  const store = new FearSetResultStore({ cwd: projectRoot });
  const idArg = args[0];

  let results: FearSetResult[] = [];

  if (idArg) {
    const single = store.load(idArg);
    if (!single) throw new Error(`FearSet result not found: ${idArg}`);
    if (!single.passed) throw new Error(`Result ${idArg} did not pass the gate — cannot distill.`);
    if (single.distilledAt)
      throw new Error(
        `Result ${idArg} was already distilled at ${single.distilledAt}. Replay protection active.`,
      );
    results = [single];
  } else {
    results = store.list().filter((r) => r.passed && !r.distilledAt);
  }

  if (results.length === 0) {
    console.log(`${YELLOW}No undistilled passed FearSet results found.${RESET}`);
    console.log(
      `${DIM}A result becomes distillable when the DanteForge gate returns PASS.${RESET}`,
    );
    console.log(`${DIM}Results stored in .dantecode/fearset/results/{id}.json${RESET}`);
    return;
  }

  const skillbook = new DanteSkillbookIntegration({ cwd: projectRoot, gitStage: true });
  let totalLessons = 0;

  for (const result of results) {
    let lessons: ReturnType<typeof distillFearSetLesson>;
    try {
      lessons = distillFearSetLesson(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`${RED}Distillation failed for ${result.id}: ${msg}${RESET}`);
      continue;
    }

    const proposals = lessons.map((l) => l.proposal);
    const decisions = proposals.map(() => "pass" as const);
    const applied = skillbook.applyProposals(proposals, decisions, { sessionId: result.id });

    if (applied.applied > 0) {
      store.markDistilled(result.id);
      totalLessons += applied.applied;

      console.log(
        `\n${GREEN}${BOLD}FearSet → Skillbook: ${applied.applied} lesson(s) distilled${RESET}`,
      );
      console.log(`  Result ID:  ${CYAN}${result.id}${RESET}`);
      console.log(`  Context:    ${result.context.slice(0, 80)}`);
      console.log(`  Trigger:    ${result.trigger.channel}`);
      console.log(`  Columns:    ${result.columns.map((c) => c.name).join(", ")}`);
      for (const l of lessons) {
        console.log(
          `  Section:    ${DIM}${l.section}${RESET} (trust: ${(l.trustScore * 100).toFixed(0)}%)`,
        );
      }
    } else {
      console.error(`${RED}applyProposals returned 0 applied for ${result.id}${RESET}`);
    }
  }

  if (totalLessons > 0) {
    console.log(`\n${DIM}Total lessons written: ${totalLessons}${RESET}`);
    console.log(`${DIM}Skillbook updated at .dantecode/skillbook/skillbook.json${RESET}`);
    console.log(`${DIM}Run 'git commit' to persist the lessons permanently.${RESET}`);
  }
}

async function cmdRun(args: string[], projectRoot: string): Promise<void> {
  // Parse --offline flag before joining context
  const offlineIdx = args.indexOf("--offline");
  const offline = offlineIdx !== -1;
  const contextArgs = offline ? args.filter((_, i) => i !== offlineIdx) : args;
  const context = contextArgs.join(" ").trim();

  if (!context) {
    console.log(`${RED}Usage: dantecode fearset run "<decision context>" [--offline]${RESET}`);
    console.log(`${DIM}Example: dantecode fearset run "Should we migrate to PostgreSQL?"${RESET}`);
    console.log(
      `${DIM}         dantecode fearset run "Should we sunset the v1 API?" --offline${RESET}`,
    );
    return;
  }

  console.log(`\n${BOLD}DanteFearSet — Fear-Setting Analysis${RESET}`);
  console.log(`${DIM}Context: ${context.slice(0, 100)}${RESET}`);

  // Build callbacks — LLM by default, structural-only fallback with --offline
  let callbacks: FearSetCallbacks = {};
  if (offline) {
    console.log(`${DIM}Running offline (structural only — no LLM analysis).${RESET}\n`);
  } else {
    try {
      callbacks = await createFearSetLLMCallbacks(projectRoot);
      console.log(`${DIM}Running with LLM analysis (use --offline for structural only).${RESET}\n`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `${YELLOW}LLM setup failed (${msg}) — falling back to structural-only mode.${RESET}\n`,
      );
    }
  }

  // Attach column progress reporter (works in both modes)
  callbacks = {
    ...callbacks,
    onColumnComplete: (col, _column, warnings) => {
      const indicator = warnings.length ? `${YELLOW}⚠${RESET}` : `${GREEN}✓${RESET}`;
      console.log(
        `  ${indicator} ${CYAN}${col}${RESET} — ${DIM}${warnings.length ? warnings.join("; ") : "ready"}${RESET}`,
      );
    },
  };

  const trigger = {
    channel: "explicit-user" as const,
    rationale: "CLI run command",
    at: new Date().toISOString(),
  };
  const result = await runFearSetEngine(context, trigger, callbacks, {
    config: { ...DEFAULT_FEARSET_CONFIG, enabled: true },
  });

  const store = new FearSetResultStore({ cwd: projectRoot });
  store.save(result);

  console.log(`\n${BOLD}Result:${RESET}`);
  console.log(`  ID:       ${CYAN}${result.id}${RESET}`);
  console.log(`  Passed:   ${result.passed ? `${GREEN}YES${RESET}` : `${RED}NO${RESET}`}`);
  console.log(
    `  Robust:   ${result.robustnessScore?.overall.toFixed(2) ?? "n/a"} (${result.robustnessScore?.gateDecision ?? "n/a"})`,
  );

  if (result.synthesizedRecommendation) {
    const rec = result.synthesizedRecommendation;
    const decColor = rec.decision === "go" ? GREEN : rec.decision === "no-go" ? RED : YELLOW;
    console.log(`  Decision: ${decColor}${BOLD}${rec.decision.toUpperCase()}${RESET}`);
    console.log(`  ${rec.reasoning.slice(0, 120)}`);
    if (rec.conditions.length > 0) {
      console.log(`  Conditions:`);
      for (const c of rec.conditions) console.log(`    • ${c}`);
    }
  }

  if (result.passed) {
    console.log(
      `\n${DIM}Run 'dantecode fearset bridge' to distill this result into DanteSkillbook.${RESET}`,
    );
  }
}

function printFearSetHelp(): void {
  console.log(`
${BOLD}dantecode fearset${RESET} — Tim Ferriss Fear-Setting engine for high-stakes decisions

${BOLD}Usage:${RESET}
  dantecode fearset <subcommand> [options]

${BOLD}Subcommands:${RESET}
  ${CYAN}on${RESET}                     Enable DanteFearSet auto-trigger
  ${CYAN}off${RESET}                    Disable DanteFearSet
  ${CYAN}stats${RESET}                  Show aggregated run statistics from disk
  ${CYAN}review [resultId]${RESET}      Show details of the last run (or a specific result)
  ${CYAN}bridge [resultId]${RESET}      Distill passed result(s) -> write to DanteSkillbook
  ${CYAN}run "<context>" [--offline]${RESET}  Run fear-setting (LLM by default; --offline for structural only)

${BOLD}Fear-Setting columns:${RESET}
  Define   • What is the realistic worst case?
  Prevent  • How do we stop it from happening?
  Repair   • If it happens anyway, how do we recover?
  Benefits • Why acting is worth it
  Inaction • What is the cost of doing nothing?

${BOLD}Closed loop:${RESET}
  1. Risky task or /fearset detected
  2. FearSet runs all 5 columns with DanteElon 5-step reasoning
  3. DanteForge scores plan robustness
  4. Synthesized recommendation: go / conditional / no-go
  5. On PASS: ${CYAN}dantecode fearset bridge${RESET} distills lessons -> writes to Skillbook
  6. Future high-stakes tasks inject prior FearSet lessons automatically
`);
}

// ────────────────────────────────────────────────────────
// Main router
// ────────────────────────────────────────────────────────

/**
 * Entry point for `dantecode fearset <subcommand> [args]`.
 */
export async function runFearsetCommand(args: string[], projectRoot: string): Promise<void> {
  const sub = args[0]?.toLowerCase();
  const rest = args.slice(1);

  switch (sub) {
    case "on":
      cmdOn();
      return;
    case "off":
      cmdOff();
      return;
    case "stats":
      cmdStats(projectRoot);
      return;
    case "review":
      cmdReview(rest, projectRoot);
      return;
    case "bridge":
      await cmdBridge(rest, projectRoot);
      return;
    case "run":
      await cmdRun(rest, projectRoot);
      return;
    default:
      printFearSetHelp();
      return;
  }
}
