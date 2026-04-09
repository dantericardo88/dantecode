/**
 * skillbook.ts
 *
 * CLI command: dantecode skillbook <subcommand>
 *
 * Subcommands:
 *   status                Show skillbook stats
 *   review                List pending review-queue items
 *   approve <id>          Approve a review-queue item → apply to skillbook
 *   reject <id>           Reject a review-queue item → discard
 *   learn-now <text...>   Directly inject a skill from freeform text
 *   stats                 Alias for status with section breakdown
 */

import { randomUUID } from "node:crypto";
import { DanteSkillbookIntegration } from "@dantecode/dante-skillbook";
import type { UpdateOperation } from "@dantecode/dante-skillbook";
import { logger } from "@dantecode/core";

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

function cmdStatus(projectRoot: string, topN?: number): void {
  const integration = new DanteSkillbookIntegration({ cwd: projectRoot, gitStage: false });
  const stats = integration.stats();

  console.log(`\n${BOLD}DanteSkillbook Status${RESET}`);
  console.log(`  Total skills:  ${CYAN}${stats.totalSkills}${RESET}`);

  const sectionEntries = Object.entries(stats.sections);
  if (sectionEntries.length > 0) {
    const sectionStr = sectionEntries.map(([k, v]) => `${k} (${v})`).join(", ");
    console.log(`  Sections:      ${sectionStr}`);
  } else {
    console.log(`  Sections:      ${DIM}none${RESET}`);
  }

  if (stats.lastUpdatedAt) {
    console.log(`  Last updated:  ${DIM}${stats.lastUpdatedAt}${RESET}`);
  }
  console.log(`  Skillbook at:  ${DIM}.dantecode/skillbook/skillbook.json${RESET}`);

  if (topN !== undefined && topN > 0) {
    const top = integration.getTopSkills(topN);
    if (top.length === 0) {
      console.log(`\n${DIM}No skills with win-rate data yet.${RESET}`);
    } else {
      console.log(`\n${BOLD}Top ${topN} Skills by Win-Rate${RESET}`);
      console.log(
        `  ${"#".padEnd(4)}${"Title".padEnd(40)}${"Win-Rate".padEnd(10)}${"Uses".padEnd(8)}Section`,
      );
      console.log(`  ${"-".repeat(70)}`);
      top.forEach((skill: { title: string; winRate?: number; useCount?: number; section: string }, i: number) => {
        const rank = String(i + 1).padEnd(4);
        const title = (skill.title.length > 38 ? `${skill.title.slice(0, 35)}...` : skill.title).padEnd(40);
        const winRate = skill.winRate !== undefined ? `${(skill.winRate * 100).toFixed(0)}%` : "n/a";
        const winRateStr = winRate.padEnd(10);
        const uses = String(skill.useCount ?? 0).padEnd(8);
        const section = skill.section;
        console.log(`  ${CYAN}${rank}${RESET}${title}${GREEN}${winRateStr}${RESET}${DIM}${uses}${section}${RESET}`);
      });
    }
  }
}

function cmdReview(projectRoot: string): void {
  const integration = new DanteSkillbookIntegration({ cwd: projectRoot, gitStage: false });
  const pending = integration.reviewQueue.getPending();

  if (pending.length === 0) {
    console.log(`${DIM}No pending review-queue items.${RESET}`);
    return;
  }

  console.log(`\n${BOLD}Pending Review Queue (${pending.length} items)${RESET}`);
  for (const item of pending) {
    const skill = item.proposal.candidateSkill;
    const title = skill?.title ?? "(untitled)";
    const section = skill?.section ?? "(no section)";
    console.log(`  ${CYAN}${item.id}${RESET}  ${title}  ${DIM}[${section}]${RESET}`);
    console.log(`    Action:    ${item.proposal.action}`);
    console.log(`    Rationale: ${DIM}${item.proposal.rationale}${RESET}`);
    if (item.sessionId) console.log(`    Session:   ${DIM}${item.sessionId}${RESET}`);
  }
  console.log(`\n${DIM}Approve: dantecode skillbook approve <id>${RESET}`);
  console.log(`${DIM}Reject:  dantecode skillbook reject <id>${RESET}`);
}

function cmdApprove(args: string[], projectRoot: string): void {
  const id = args[0];
  if (!id) {
    logger.error({ command: "skillbook approve" }, "Missing queue ID parameter");
    console.error(`${RED}Usage: dantecode skillbook approve <queue-id>${RESET}`);
    process.exit(1);
  }

  const integration = new DanteSkillbookIntegration({ cwd: projectRoot, gitStage: true });
  // Reload to get fresh state
  integration.reload();
  const ok = integration.applyReviewItem(id);

  if (ok) {
    logger.info(
      { command: "skillbook approve", id, projectRoot },
      "Review item approved and applied",
    );
    console.log(`${GREEN}Approved and applied: ${id}${RESET}`);
    console.log(`${DIM}Skillbook updated. Run 'git commit' to persist.${RESET}`);
  } else {
    logger.error({ command: "skillbook approve", id }, "Review item not found or not pending");
    console.error(`${RED}Item not found or not pending: ${id}${RESET}`);
    process.exit(1);
  }
}

function cmdReject(args: string[], projectRoot: string): void {
  const id = args[0];
  if (!id) {
    logger.error({ command: "skillbook reject" }, "Missing queue ID parameter");
    console.error(`${RED}Usage: dantecode skillbook reject <queue-id>${RESET}`);
    process.exit(1);
  }

  const integration = new DanteSkillbookIntegration({ cwd: projectRoot, gitStage: false });
  const pending = integration.reviewQueue.getPending();
  const item = pending.find((i: { id: string }) => i.id === id);

  if (!item) {
    logger.error({ command: "skillbook reject", id }, "Review item not found or not pending");
    console.error(`${RED}Item not found or not pending: ${id}${RESET}`);
    process.exit(1);
  }

  logger.info({ command: "skillbook reject", id }, "Review item rejected");
  integration.reviewQueue.reject(id);
  console.log(`${YELLOW}Rejected: ${id}${RESET}`);
}

function cmdLearnNow(args: string[], projectRoot: string): void {
  const text = args.join(" ").trim();
  if (!text) {
    logger.error({ command: "skillbook learn-now" }, "Missing lesson text");
    console.error(
      `${RED}Usage: dantecode skillbook learn-now <freeform text describing the lesson>${RESET}`,
    );
    process.exit(1);
  }

  const now = new Date().toISOString();
  const proposal: UpdateOperation = {
    action: "add",
    rationale: "Directly injected via dantecode skillbook learn-now",
    candidateSkill: {
      id: randomUUID(),
      title: text.length > 60 ? `${text.slice(0, 57)}...` : text,
      content: text,
      section: "general",
      trustScore: 0.7,
      createdAt: now,
      updatedAt: now,
    },
  };

  const integration = new DanteSkillbookIntegration({ cwd: projectRoot, gitStage: true });
  const result = integration.applyProposals([proposal], ["pass"]);

  if (result.applied > 0) {
    logger.info(
      { command: "skillbook learn-now", skillId: proposal.candidateSkill.id, projectRoot },
      "Skill added to skillbook",
    );
    console.log(`${GREEN}Skill added to DanteSkillbook.${RESET}`);
    console.log(`  Section:  general`);
    console.log(`  Trust:    70%`);
    console.log(`${DIM}Run 'git commit' to persist.${RESET}`);
  } else {
    logger.error({ command: "skillbook learn-now", projectRoot }, "Failed to add skill");
    console.error(`${RED}Failed to add skill.${RESET}`);
    process.exit(1);
  }
}

function printSkillbookHelp(): void {
  console.log(`
${BOLD}dantecode skillbook${RESET} — DanteForge-gated self-improving Skillbook

${BOLD}Usage:${RESET}
  dantecode skillbook <subcommand> [options]

${BOLD}Subcommands:${RESET}
  ${CYAN}status [--top <n>]${RESET}   Show skillbook stats; --top N prints top N skills by win-rate
  ${CYAN}stats [--top <n>]${RESET}    Alias for status
  ${CYAN}review${RESET}               List pending review-queue items awaiting human approval
  ${CYAN}approve <id>${RESET}         Approve a review-queue item and apply it to the skillbook
  ${CYAN}reject <id>${RESET}          Reject a review-queue item and discard it
  ${CYAN}learn-now <text>${RESET}     Directly inject a skill from freeform text (trust: 70%)

${BOLD}Skillbook path:${RESET}
  .dantecode/skillbook/skillbook.json  (Git-tracked)

${BOLD}Closed loop:${RESET}
  Run ${CYAN}dantecode gaslight bridge${RESET} to distill lessons from PASS sessions automatically.
`);
}

// ────────────────────────────────────────────────────────
// Main router
// ────────────────────────────────────────────────────────

/**
 * Entry point for `dantecode skillbook <subcommand> [args]`.
 */
export async function runSkillbookCommand(args: string[], projectRoot: string): Promise<void> {
  const sub = args[0]?.toLowerCase();
  const rest = args.slice(1);

  switch (sub) {
    case "status":
    case "stats": {
      // Parse optional --top <n> flag
      const topIdx = rest.indexOf("--top");
      let topN: number | undefined;
      if (topIdx !== -1 && rest[topIdx + 1]) {
        const parsed = parseInt(rest[topIdx + 1] as string, 10);
        if (!isNaN(parsed) && parsed > 0) topN = parsed;
      }
      cmdStatus(projectRoot, topN);
      return;
    }
    case "review":
      cmdReview(projectRoot);
      return;
    case "approve":
      cmdApprove(rest, projectRoot);
      return;
    case "reject":
      cmdReject(rest, projectRoot);
      return;
    case "learn-now":
      cmdLearnNow(rest, projectRoot);
      return;
    default:
      printSkillbookHelp();
      return;
  }
}
