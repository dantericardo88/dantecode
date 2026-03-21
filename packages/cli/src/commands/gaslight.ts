/**
 * gaslight.ts
 *
 * CLI command: dantecode gaslight <subcommand>
 *
 * Subcommands:
 *   on                    Enable DanteGaslight
 *   off                   Disable DanteGaslight
 *   stats                 Show session statistics
 *   review [sessionId]    Review last session or a specific session by ID
 *   bridge [sessionId]    Distill lesson from eligible session → write to Skillbook
 */

import type { GaslightSession } from "@dantecode/dante-gaslight";
import {
  GaslightSessionStore,
  distillLesson,
  DEFAULT_GASLIGHT_CONFIG,
} from "@dantecode/dante-gaslight";
import { DanteSkillbookIntegration } from "@dantecode/dante-skillbook";

// ────────────────────────────────────────────────────────
// ANSI helpers
// ────────────────────────────────────────────────────────

const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

// ────────────────────────────────────────────────────────
// Sub-command implementations
// ────────────────────────────────────────────────────────

function cmdOn(): void {
  console.log(
    `${GREEN}${BOLD}DanteGaslight enabled.${RESET} Weak outputs will be challenged and refined when triggered.`,
  );
  console.log(
    `${DIM}Trigger with: "go deeper", "again but better", "truth mode", or /gaslight on${RESET}`,
  );
}

function cmdOff(): void {
  console.log(`${YELLOW}DanteGaslight disabled.${RESET} No automatic refinement will occur.`);
}

function cmdStats(projectRoot: string): void {
  const store = new GaslightSessionStore({ cwd: projectRoot });
  const sessions = store.list();

  if (sessions.length === 0) {
    console.log(`${DIM}No gaslight sessions recorded yet.${RESET}`);
    return;
  }

  let passCount = 0;
  let abortCount = 0;
  let eligibleCount = 0;
  let totalIterations = 0;

  for (const s of sessions) {
    if (s.stopReason === "pass") passCount++;
    if (s.stopReason === "user-stop" || s.stopReason === "policy-abort") abortCount++;
    if (s.lessonEligible) eligibleCount++;
    totalIterations += s.iterations.length;
  }

  const avgIter = sessions.length > 0 ? (totalIterations / sessions.length).toFixed(1) : "0.0";

  console.log(`\n${BOLD}DanteGaslight Stats${RESET}`);
  console.log(`  Total sessions:    ${CYAN}${sessions.length}${RESET}`);
  console.log(`  Sessions with PASS: ${GREEN}${passCount}${RESET}`);
  console.log(`  Sessions aborted:  ${YELLOW}${abortCount}${RESET}`);
  console.log(`  Avg iterations:    ${avgIter}`);
  console.log(`  Lesson-eligible:   ${eligibleCount}`);
  console.log(
    `${DIM}  Config: maxIterations=${DEFAULT_GASLIGHT_CONFIG.maxIterations} maxTokens=${DEFAULT_GASLIGHT_CONFIG.maxTokens}${RESET}`,
  );
}

function cmdReview(args: string[], projectRoot: string): void {
  const store = new GaslightSessionStore({ cwd: projectRoot });
  const sessionIdArg = args[0];

  let session: GaslightSession | null = null;
  if (sessionIdArg) {
    session = store.load(sessionIdArg);
    if (!session) {
      throw new Error(`Session not found: ${sessionIdArg}`);
    }
  } else {
    const all = store.list();
    session = all[0] ?? null;
  }

  if (!session) {
    console.log(`${DIM}No gaslight sessions recorded yet.${RESET}`);
    return;
  }

  console.log(`\n${BOLD}Gaslight Session Review${RESET}`);
  console.log(`  Session ID:    ${CYAN}${session.sessionId}${RESET}`);
  console.log(
    `  Trigger:       ${session.trigger.channel}${session.trigger.phrase ? ` ("${session.trigger.phrase}")` : ""}`,
  );
  console.log(`  Iterations:    ${session.iterations.length}`);
  console.log(`  Stop reason:   ${session.stopReason ?? "in-progress"}`);
  console.log(`  Final gate:    ${session.finalGateDecision ?? "none"}`);
  console.log(
    `  Lesson ready:  ${session.lessonEligible ? `${GREEN}YES${RESET}` : `${YELLOW}NO${RESET}`}`,
  );
  if (session.startedAt) console.log(`  Started:       ${DIM}${session.startedAt}${RESET}`);
  if (session.endedAt) console.log(`  Ended:         ${DIM}${session.endedAt}${RESET}`);

  if (session.iterations.length > 0) {
    console.log(`\n${BOLD}Iteration Summary:${RESET}`);
    for (const iter of session.iterations) {
      const gate = iter.gateDecision ? ` -> gate: ${iter.gateDecision}` : "";
      const score = iter.gateScore !== undefined ? ` (${(iter.gateScore * 100).toFixed(0)}%)` : "";
      console.log(
        `  [${iter.iteration}] ${DIM}draft ${iter.draft.length} chars${RESET}${gate}${score}`,
      );
    }
  }

  if (session.lessonEligible) {
    console.log(
      `\n${GREEN}This session is lesson-eligible. Run: dantecode gaslight bridge ${session.sessionId}${RESET}`,
    );
  }
}

async function cmdBridge(args: string[], projectRoot: string): Promise<void> {
  const store = new GaslightSessionStore({ cwd: projectRoot });
  const sessionIdArg = args[0];

  let session: GaslightSession | null = null;

  if (sessionIdArg) {
    session = store.load(sessionIdArg);
    if (!session) {
      throw new Error(`Session not found: ${sessionIdArg}`);
    }
    if (!session.lessonEligible) {
      throw new Error(
        `Session ${sessionIdArg} is not lesson-eligible. Only PASS sessions qualify.`,
      );
    }
    if (session.distilledAt) {
      throw new Error(
        `Session ${sessionIdArg} was already distilled at ${session.distilledAt}. Distilling twice creates duplicates.`,
      );
    }
  } else {
    const all = store.list();
    // Only pick sessions that are eligible AND not yet distilled
    session = all.find((s) => s.lessonEligible && !s.distilledAt) ?? null;
  }

  if (!session) {
    console.log(`${YELLOW}No undistilled lesson-eligible sessions found.${RESET}`);
    console.log(`${DIM}A session becomes eligible when the DanteForge gate returns PASS.${RESET}`);
    console.log(`${DIM}Already-distilled sessions are skipped (replay protection).${RESET}`);
    console.log(
      `${DIM}Sessions are stored in .dantecode/gaslight/sessions/{sessionId}.json${RESET}`,
    );
    return;
  }

  let lesson: ReturnType<typeof distillLesson>;
  try {
    lesson = distillLesson(session);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Lesson distillation failed: ${msg}`);
  }

  const skillbook = new DanteSkillbookIntegration({ cwd: projectRoot, gitStage: true });
  const result = skillbook.applyProposals([lesson.proposal], ["pass"], {
    sessionId: session.sessionId,
  });

  if (result.applied > 0) {
    // Mark session as distilled so it cannot be bridged a second time
    store.markDistilled(session.sessionId);

    console.log(`\n${GREEN}${BOLD}Closed loop complete.${RESET}`);
    console.log(`  Session:     ${CYAN}${session.sessionId}${RESET}`);
    console.log(`  Section:     ${lesson.section}`);
    console.log(`  Trust score: ${(lesson.trustScore * 100).toFixed(0)}%`);
    console.log(`  Trigger:     ${session.trigger.channel}`);
    console.log(`  Iterations:  ${session.iterations.length}`);
    console.log(`\n${DIM}Skillbook updated at .dantecode/skillbook/skillbook.json${RESET}`);
    console.log(`${DIM}Session marked as distilled — won't be bridged again.${RESET}`);
    console.log(`${DIM}Run 'git commit' to persist the lesson permanently.${RESET}`);
  } else {
    throw new Error(`applyProposals returned 0 applied — check skillbook state.`);
  }
}

function printGaslightHelp(): void {
  console.log(`
${BOLD}dantecode gaslight${RESET} — Bounded adversarial self-critique engine

${BOLD}Usage:${RESET}
  dantecode gaslight <subcommand> [options]

${BOLD}Subcommands:${RESET}
  ${CYAN}on${RESET}                    Enable DanteGaslight (outputs a reminder of trigger phrases)
  ${CYAN}off${RESET}                   Disable DanteGaslight
  ${CYAN}stats${RESET}                 Show aggregated session statistics from disk
  ${CYAN}review [sessionId]${RESET}    Show details of the last session (or a specific session)
  ${CYAN}bridge [sessionId]${RESET}    Distill lesson from a PASS session -> write to DanteSkillbook

${BOLD}Trigger phrases (in the agent):${RESET}
  "go deeper"  |  "again but better"  |  "truth mode"  |  "is this really your best?"

${BOLD}Closed loop:${RESET}
  1. Agent produces output
  2. User challenges it (or verification score triggers automatically)
  3. Gaslight runs bounded critique->rewrite->gate cycles
  4. On PASS: ${CYAN}dantecode gaslight bridge${RESET} distills the lesson -> writes to Skillbook
  5. Future runs inject the lesson automatically
`);
}

// ────────────────────────────────────────────────────────
// Main router
// ────────────────────────────────────────────────────────

/**
 * Entry point for `dantecode gaslight <subcommand> [args]`.
 */
export async function runGaslightCommand(args: string[], projectRoot: string): Promise<void> {
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
    default:
      printGaslightHelp();
      return;
  }
}
