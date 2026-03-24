// ============================================================================
// /adaptation — D-12A Model Adaptation admin command
// Status, overrides, experiments, rollback, report, mode switching.
// ============================================================================

import type { ReplState } from "../slash-commands.js";

const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

const STATUS_BADGE: Record<string, string> = {
  draft: `${DIM}[draft]${RESET}`,
  testing: `${YELLOW}[testing]${RESET}`,
  awaiting_review: `${YELLOW}${BOLD}[awaiting_review]${RESET}`,
  promoted: `${GREEN}[promoted]${RESET}`,
  rejected: `${RED}[rejected]${RESET}`,
  rolled_back: `${RED}[rolled_back]${RESET}`,
};

export async function adaptationCommand(args: string, state: ReplState): Promise<string> {
  const sub = args.trim().split(/\s+/);
  const cmd = sub[0] ?? "status";

  const store = state.modelAdaptationStore;
  if (!store) {
    return `${RED}Model adaptation store not initialized.${RESET}\nCheck that DANTE_DISABLE_MODEL_ADAPTATION is not set to "1".`;
  }

  switch (cmd) {
    case "status":
      return adaptationStatus(store);
    case "overrides":
      return adaptationOverrides(store);
    case "experiments":
      return adaptationExperiments(store, sub[1]);
    case "rollback":
      return adaptationRollback(store, sub[1]);
    case "report":
      return adaptationReport(store, state.projectRoot, sub[1]);
    case "mode":
      return adaptationMode(sub[1]);
    case "review":
      return adaptationReview(store);
    case "approve":
      return adaptationApprove(store, sub[1]);
    case "reject":
      return adaptationReject(store, sub[1]);
    case "test":
      return adaptationTest(store, sub[1]);
    case "dashboard":
      return adaptationDashboard(store);
    default:
      return [
        `${BOLD}Usage:${RESET} /adaptation <subcommand>`,
        "",
        "  status       Show mode, observation count, active overrides",
        "  overrides    List all overrides with status badges",
        "  experiments  Show experiment history [quirkKey]",
        "  rollback     Manual rollback <overrideId>",
        "  report       Generate adaptation report [quirkKey]",
        "  mode         Change runtime mode <observe-only|staged|active>",
        "  review       List overrides awaiting human review",
        "  approve      Approve a testing override for promotion <overrideId>",
        "  reject       Reject an override <overrideId>",
        "  test         Run experiment on a draft/testing override <overrideId>",
        "  dashboard    Show pipeline activity summary and counts",
      ].join("\n");
  }
}

async function adaptationStatus(store: unknown): Promise<string> {
  const s = store as import("@dantecode/core").ModelAdaptationStore;
  const mode = process.env.DANTE_MODEL_ADAPTATION_MODE ?? "observe-only";
  const disabled = process.env.DANTE_DISABLE_MODEL_ADAPTATION === "1";
  const snapshot = s.snapshot();

  const lines = [
    `${BOLD}Model Adaptation Status${RESET}`,
    "",
    `  Mode:          ${disabled ? `${RED}DISABLED${RESET}` : mode === "active" ? `${GREEN}${mode}${RESET}` : `${YELLOW}${mode}${RESET}`}`,
    `  Observations:  ${snapshot.observations.length}`,
    `  Overrides:     ${snapshot.overrides.length}`,
    `  Experiments:   ${snapshot.experiments.length}`,
  ];

  const awaitingReview = snapshot.overrides.filter((o) => o.status === "awaiting_review");
  if (awaitingReview.length > 0) {
    lines.push(`  ${YELLOW}Awaiting review: ${awaitingReview.length}${RESET}`);
  }

  const promoted = snapshot.overrides.filter((o) => o.status === "promoted");
  if (promoted.length > 0) {
    lines.push("");
    lines.push(`  ${GREEN}Active overrides:${RESET}`);
    for (const o of promoted) {
      lines.push(`    ${o.quirkKey} (${o.provider}/${o.model}) v${o.version}`);
    }
  }

  return lines.join("\n");
}

async function adaptationOverrides(store: unknown): Promise<string> {
  const s = store as import("@dantecode/core").ModelAdaptationStore;
  const snapshot = s.snapshot();
  if (snapshot.overrides.length === 0) {
    return `${DIM}No overrides recorded.${RESET}`;
  }

  const lines = [`${BOLD}Model Adaptation Overrides${RESET}`, ""];
  for (const o of snapshot.overrides) {
    const badge = STATUS_BADGE[o.status] ?? `[${o.status}]`;
    lines.push(
      `  ${badge} ${CYAN}${o.quirkKey}${RESET} — ${o.provider}/${o.model} v${o.version} (${o.id})`,
    );
    if (o.patch?.promptPreamble) {
      lines.push(`    ${DIM}${o.patch.promptPreamble.slice(0, 80)}...${RESET}`);
    }
  }
  return lines.join("\n");
}

async function adaptationExperiments(store: unknown, quirkKey?: string): Promise<string> {
  const s = store as import("@dantecode/core").ModelAdaptationStore;
  const snapshot = s.snapshot();
  let experiments = snapshot.experiments;
  if (quirkKey) {
    experiments = experiments.filter((e) => e.quirkKey === quirkKey);
  }

  if (experiments.length === 0) {
    return `${DIM}No experiments${quirkKey ? ` for ${quirkKey}` : ""}.${RESET}`;
  }

  const lines = [`${BOLD}Experiment History${quirkKey ? ` (${quirkKey})` : ""}${RESET}`, ""];
  for (const e of experiments) {
    const decisionColor = e.decision === "promote" ? GREEN : e.decision === "reject" ? RED : YELLOW;
    lines.push(
      `  ${decisionColor}[${e.decision}]${RESET} ${e.quirkKey} — ${e.provider}/${e.model}`,
    );
    const bPdse = e.baseline.pdseScore ?? "—";
    const cPdse = e.candidate.pdseScore ?? "—";
    lines.push(`    Baseline PDSE: ${bPdse}, Candidate PDSE: ${cPdse}`);
    lines.push(`    Smoke: ${e.smokePassed ? "pass" : "FAIL"}, Control regression: ${e.controlRegression ? "YES" : "no"}`);
    lines.push(`    ${DIM}${e.createdAt}${RESET}`);
  }
  return lines.join("\n");
}

async function adaptationRollback(store: unknown, overrideId?: string): Promise<string> {
  if (!overrideId) {
    return `${RED}Usage: /adaptation rollback <overrideId>${RESET}`;
  }

  try {
    const { createRollbackOverride } = await import("@dantecode/core");
    const s = store as import("@dantecode/core").ModelAdaptationStore;
    const snapshot = s.snapshot();
    const override = snapshot.overrides.find((o) => o.id === overrideId);
    if (!override) {
      return `${RED}Override not found: ${overrideId}${RESET}`;
    }
    if (override.status === "rolled_back") {
      return `${YELLOW}Override already rolled back.${RESET}`;
    }

    const rollback = createRollbackOverride(override, "user_disable");
    s.addDraft(rollback as unknown as Record<string, unknown>);
    s.updateStatus(overrideId, "rolled_back", {});
    await s.save().catch(() => {});

    return `${GREEN}Rolled back override ${overrideId} (${override.quirkKey}).${RESET}`;
  } catch (err) {
    return `${RED}Rollback failed: ${err instanceof Error ? err.message : String(err)}${RESET}`;
  }
}

async function adaptationReport(store: unknown, projectRoot: string, quirkKey?: string): Promise<string> {
  try {
    const { generateAdaptationReport, serializeAdaptationReport, writeAdaptationReport } = await import("@dantecode/core");
    const s = store as import("@dantecode/core").ModelAdaptationStore;
    const snapshot = s.snapshot();

    if (quirkKey) {
      const qk = quirkKey as import("@dantecode/core").QuirkKey;
      const observations = snapshot.observations.filter((o) => o.quirkKey === qk);
      const override = snapshot.overrides.find((o) => o.quirkKey === qk);
      const experiments = snapshot.experiments.filter((e) => e.quirkKey === qk);

      const report = generateAdaptationReport(qk, observations, override ?? null, experiments, []);
      const md = serializeAdaptationReport(report);
      await writeAdaptationReport(projectRoot, report, qk);
      return `${GREEN}Report generated for ${qk}:${RESET}\n\n${md}`;
    }

    // Generate report for all quirks with observations
    const quirkKeys = [...new Set(snapshot.observations.map((o) => o.quirkKey))];
    if (quirkKeys.length === 0) {
      return `${DIM}No observations to report.${RESET}`;
    }

    const reports: string[] = [];
    for (const qk of quirkKeys) {
      const obs = snapshot.observations.filter((o) => o.quirkKey === qk);
      const ovr = snapshot.overrides.find((o) => o.quirkKey === qk);
      const exps = snapshot.experiments.filter((e) => e.quirkKey === qk);
      const report = generateAdaptationReport(qk, obs, ovr ?? null, exps, []);
      const md = serializeAdaptationReport(report);
      await writeAdaptationReport(projectRoot, report, qk);
      reports.push(md);
    }
    return `${GREEN}Generated ${reports.length} report(s).${RESET}\n\n${reports.join("\n---\n\n")}`;
  } catch (err) {
    return `${RED}Report generation failed: ${err instanceof Error ? err.message : String(err)}${RESET}`;
  }
}

async function adaptationMode(newMode?: string): Promise<string> {
  const validModes = ["observe-only", "staged", "active"];
  if (!newMode || !validModes.includes(newMode)) {
    const current = process.env.DANTE_MODEL_ADAPTATION_MODE ?? "staged";
    return [
      `${BOLD}Current mode:${RESET} ${current}`,
      "",
      `${BOLD}Usage:${RESET} /adaptation mode <${validModes.join("|")}>`,
      "",
      `  observe-only  Record observations only, no overrides applied`,
      `  staged        Create drafts + run experiments, but don't auto-apply`,
      `  active        Apply promoted overrides to system prompts`,
    ].join("\n");
  }

  process.env.DANTE_MODEL_ADAPTATION_MODE = newMode;
  return `${GREEN}Model adaptation mode set to: ${BOLD}${newMode}${RESET}`;
}

async function adaptationReview(store: unknown): Promise<string> {
  const s = store as import("@dantecode/core").ModelAdaptationStore;
  const snapshot = s.snapshot();
  const reviewable = snapshot.overrides.filter(o => o.status === "testing" || o.status === "awaiting_review");
  if (reviewable.length === 0) {
    return `${DIM}No overrides awaiting review.${RESET}`;
  }
  const lines = [`${BOLD}Overrides Awaiting Review${RESET}`, ""];
  for (const o of reviewable) {
    const exps = snapshot.experiments.filter(e => e.overrideId === o.id);
    const latest = exps[exps.length - 1];
    const badge = STATUS_BADGE[o.status] ?? `[${o.status}]`;
    lines.push(`  ${badge} ${CYAN}${o.quirkKey}${RESET} — ${o.provider}/${o.model} (${o.id})`);
    if (latest) {
      const delta = (latest.candidate.pdseScore ?? 0) - (latest.baseline.pdseScore ?? 0);
      lines.push(`    PDSE delta: ${delta >= 0 ? "+" : ""}${delta.toFixed(1)}, smoke: ${latest.smokePassed ? "pass" : "FAIL"}, control: ${latest.controlRegression ? "REGRESSED" : "ok"}`);
      lines.push(`    Decision: ${latest.decision}`);
    }
  }
  lines.push("", `${DIM}Approve: /adaptation approve <overrideId>${RESET}`);
  lines.push(`${DIM}Reject:  /adaptation reject <overrideId>${RESET}`);
  return lines.join("\n");
}

async function adaptationApprove(store: unknown, overrideId?: string): Promise<string> {
  if (!overrideId) return `${RED}Usage: /adaptation approve <overrideId>${RESET}`;
  const s = store as import("@dantecode/core").ModelAdaptationStore;
  const snapshot = s.snapshot();
  const override = snapshot.overrides.find(o => o.id === overrideId);
  if (!override) return `${RED}Override not found: ${overrideId}${RESET}`;
  if (override.status !== "testing" && override.status !== "awaiting_review") return `${YELLOW}Override must be in testing or awaiting_review status (current: ${override.status}).${RESET}`;
  s.updateStatus(overrideId, "promoted");
  await s.save().catch(() => {});
  return `${GREEN}Approved and promoted: ${overrideId} (${override.quirkKey})${RESET}`;
}

async function adaptationReject(store: unknown, overrideId?: string): Promise<string> {
  if (!overrideId) return `${RED}Usage: /adaptation reject <overrideId>${RESET}`;
  const s = store as import("@dantecode/core").ModelAdaptationStore;
  const snapshot = s.snapshot();
  const override = snapshot.overrides.find(o => o.id === overrideId);
  if (!override) return `${RED}Override not found: ${overrideId}${RESET}`;
  if (override.status === "rejected") return `${YELLOW}Override already rejected.${RESET}`;
  s.updateStatus(overrideId, "rejected");
  await s.save().catch(() => {});
  return `${GREEN}Rejected: ${overrideId} (${override.quirkKey})${RESET}`;
}

async function adaptationTest(store: unknown, overrideId?: string): Promise<string> {
  if (!overrideId) return `${RED}Usage: /adaptation test <overrideId>${RESET}`;
  const s = store as import("@dantecode/core").ModelAdaptationStore;
  const snapshot = s.snapshot();
  const override = snapshot.overrides.find(o => o.id === overrideId);
  if (!override) return `${RED}Override not found: ${overrideId}${RESET}`;
  if (override.status !== "draft" && override.status !== "testing") {
    return `${YELLOW}Override must be in draft or testing status to test (current: ${override.status}).${RESET}`;
  }
  try {
    const { runAdaptationExperiment, evaluatePromotionGate } = await import("@dantecode/core");
    const result = await runAdaptationExperiment(override);
    s.addExperiment(result);
    if (override.status === "draft") s.updateStatus(overrideId, "testing");
    await s.save().catch(() => {});
    const delta = (result.candidate.pdseScore ?? 0) - (result.baseline.pdseScore ?? 0);
    const gate = evaluatePromotionGate(result, s.getPromotionCount(override.quirkKey));
    const lines = [
      `${BOLD}Experiment Result${RESET}`,
      "",
      `  Override:       ${override.quirkKey} (${overrideId})`,
      `  Baseline PDSE:  ${result.baseline.pdseScore ?? "—"}`,
      `  Candidate PDSE: ${result.candidate.pdseScore ?? "—"}`,
      `  Delta:          ${delta >= 0 ? "+" : ""}${delta.toFixed(1)}`,
      `  Smoke:          ${result.smokePassed ? `${GREEN}pass${RESET}` : `${RED}FAIL${RESET}`}`,
      `  Control:        ${result.controlRegression ? `${RED}REGRESSED${RESET}` : `${GREEN}ok${RESET}`}`,
      "",
      `  ${BOLD}Gate Decision:${RESET} ${gate.decision}`,
    ];
    for (const r of gate.reasons) lines.push(`    ${DIM}${r}${RESET}`);
    if (gate.requiresHumanApproval) {
      lines.push("", `  ${YELLOW}Human approval required. Use /adaptation approve ${overrideId}${RESET}`);
    }
    return lines.join("\n");
  } catch (err) {
    return `${RED}Experiment failed: ${err instanceof Error ? err.message : String(err)}${RESET}`;
  }
}

async function adaptationDashboard(store: unknown): Promise<string> {
  const s = store as import("@dantecode/core").ModelAdaptationStore;
  const snapshot = s.snapshot();

  const statusCounts: Record<string, number> = {};
  for (const o of snapshot.overrides) {
    statusCounts[o.status] = (statusCounts[o.status] ?? 0) + 1;
  }

  const mode = process.env.DANTE_MODEL_ADAPTATION_MODE ?? "observe-only";
  const disabled = process.env.DANTE_DISABLE_MODEL_ADAPTATION === "1";

  const lines = [
    `${BOLD}Adaptation Dashboard${RESET}`,
    "",
    `  Mode:           ${disabled ? `${RED}DISABLED${RESET}` : mode === "active" ? `${GREEN}${mode}${RESET}` : `${YELLOW}${mode}${RESET}`}`,
    `  Observations:   ${snapshot.observations.length}`,
    "",
    `  ${BOLD}Overrides by status:${RESET}`,
    `    Draft:           ${statusCounts["draft"] ?? 0}`,
    `    Testing:         ${statusCounts["testing"] ?? 0}`,
    `    Awaiting review: ${YELLOW}${statusCounts["awaiting_review"] ?? 0}${RESET}`,
    `    Promoted:        ${GREEN}${statusCounts["promoted"] ?? 0}${RESET}`,
    `    Rejected:        ${statusCounts["rejected"] ?? 0}`,
    `    Rolled back:     ${statusCounts["rolled_back"] ?? 0}`,
    "",
    `  ${BOLD}Experiments:${RESET} ${snapshot.experiments.length} total`,
  ];

  // Last 3 experiments
  if (snapshot.experiments.length > 0) {
    const recent = snapshot.experiments.slice(-3).reverse();
    lines.push("");
    lines.push(`  ${BOLD}Recent experiments:${RESET}`);
    for (const e of recent) {
      const decisionColor = e.decision === "promote" ? GREEN : e.decision === "reject" ? RED : YELLOW;
      const delta = (e.candidate.pdseScore ?? 0) - (e.baseline.pdseScore ?? 0);
      lines.push(
        `    ${decisionColor}[${e.decision}]${RESET} ${e.quirkKey} — PDSE ${delta >= 0 ? "+" : ""}${delta.toFixed(1)} ${DIM}${e.createdAt}${RESET}`,
      );
    }
  }

  // Quirk activity summary
  const quirkCounts = new Map<string, number>();
  for (const o of snapshot.observations) {
    quirkCounts.set(o.quirkKey, (quirkCounts.get(o.quirkKey) ?? 0) + 1);
  }
  if (quirkCounts.size > 0) {
    lines.push("");
    lines.push(`  ${BOLD}Quirk observations:${RESET}`);
    for (const [qk, count] of [...quirkCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)) {
      lines.push(`    ${CYAN}${qk}${RESET}: ${count}`);
    }
  }

  return lines.join("\n");
}
