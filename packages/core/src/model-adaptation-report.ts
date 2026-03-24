// ============================================================================
// @dantecode/core — Model Adaptation Report Generator (D-12A Phase 6)
// Generates human-readable adaptation reports from quirk observation data.
// ============================================================================

import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type {
  QuirkKey,
  QuirkObservation,
  CandidateOverride,
  ExperimentResult,
  AdaptationReportData,
} from "./model-adaptation-types.js";

// ---------------------------------------------------------------------------
// Generate an adaptation report from quirk data
// ---------------------------------------------------------------------------

export function generateAdaptationReport(
  quirkKey: QuirkKey,
  observations: QuirkObservation[],
  override: CandidateOverride | null,
  experiments: ExperimentResult[],
  rollbackHistory: CandidateOverride[],
): AdaptationReportData {
  // ## Quirk detected
  const quirkDetected =
    `Quirk class: \`${quirkKey}\`\n` +
    `Total observations: ${observations.length}\n` +
    (observations.length > 0
      ? `First observed: ${observations[0]!.createdAt}\nLast observed: ${observations[observations.length - 1]!.createdAt}`
      : "No observations recorded.");

  // ## Evidence — last 5 observations
  const evidence = observations.slice(-5).map((obs, i) => {
    const tags = obs.failureTags.length > 0 ? ` — tags: ${obs.failureTags.join(", ")}` : "";
    return (
      `${i + 1}. [${obs.provider}/${obs.model}] ${obs.workflow} workflow` +
      (obs.commandName ? ` (${obs.commandName})` : "") +
      tags +
      (obs.pdseScore !== undefined ? ` — PDSE: ${obs.pdseScore}` : "") +
      (obs.completionStatus ? ` — ${obs.completionStatus}` : "")
    );
  });

  // ## Candidate override
  let candidateOverride: string;
  if (!override) {
    candidateOverride = "No candidate override has been generated yet.";
  } else {
    const patchParts: string[] = [];
    if (override.patch.promptPreamble) {
      patchParts.push(`Prompt preamble: "${override.patch.promptPreamble}"`);
    }
    if (override.patch.orderingHints?.length) {
      patchParts.push(`Ordering hints: ${override.patch.orderingHints.join("; ")}`);
    }
    if (override.patch.toolFormattingHints?.length) {
      patchParts.push(`Tool formatting hints: ${override.patch.toolFormattingHints.join("; ")}`);
    }
    if (override.patch.synthesisRequirements?.length) {
      patchParts.push(`Synthesis requirements: ${override.patch.synthesisRequirements.join("; ")}`);
    }
    candidateOverride =
      `Override ID: \`${override.id}\`\nStatus: **${override.status}**\nVersion: ${override.version}\n` +
      `Provider: ${override.provider} / ${override.model}\n` +
      (patchParts.length > 0
        ? `Patch:\n${patchParts.map((p) => `  - ${p}`).join("\n")}`
        : "No patch content.");
  }

  // ## Experiments run
  const experimentsRun =
    experiments.length === 0
      ? ["No experiments have been run."]
      : experiments.map((exp, i) => {
          const baseScore = exp.baseline.pdseScore ?? "N/A";
          const candScore = exp.candidate.pdseScore ?? "N/A";
          const delta = (exp.candidate.pdseScore ?? 0) - (exp.baseline.pdseScore ?? 0);
          return (
            `${i + 1}. [${exp.createdAt}] PDSE: ${baseScore} → ${candScore} (delta: ${delta >= 0 ? "+" : ""}${delta.toFixed(1)}) — ` +
            `control regression: ${exp.controlRegression ? "YES" : "no"}, smoke: ${exp.smokePassed ? "passed" : "FAILED"} — decision: **${exp.decision}**`
          );
        });

  // ## Promotion decision
  let promotionDecision: string;
  if (!override) {
    promotionDecision = "No override exists to promote.";
  } else if (override.status === "promoted") {
    promotionDecision = `Override \`${override.id}\` was promoted at ${override.promotedAt ?? "unknown"}.`;
  } else if (override.status === "rejected") {
    promotionDecision = `Override \`${override.id}\` was rejected at ${override.rejectedAt ?? "unknown"}.`;
  } else if (override.status === "rolled_back") {
    promotionDecision = `Override \`${override.id}\` was rolled back (version ${override.rollbackOfVersion}).`;
  } else {
    promotionDecision = `Override \`${override.id}\` is in **${override.status}** status. Awaiting experiment results.`;
  }

  // ## Rollback status
  let rollbackStatus: string;
  if (rollbackHistory.length === 0) {
    rollbackStatus = "No rollbacks have occurred.";
  } else {
    rollbackStatus = rollbackHistory
      .map(
        (rb) =>
          `- Version ${rb.rollbackOfVersion ?? "?"} → rolled back (ID: \`${rb.id}\`, at ${rb.rejectedAt ?? "unknown"})`,
      )
      .join("\n");
  }

  // ## What changed in plain English
  let plainEnglish: string;
  if (!override) {
    plainEnglish = `DanteCode detected the "${quirkKey}" quirk ${observations.length} time(s) but has not yet generated an override.`;
  } else if (override.status === "promoted") {
    plainEnglish =
      `DanteCode learned that the ${override.provider}/${override.model} model exhibits "${quirkKey}" behavior. ` +
      `A prompt adjustment was tested and improved PDSE scores, so it was promoted to active use. ` +
      `This means the model will now receive adjusted instructions to avoid this quirk.`;
  } else if (override.status === "rejected" || override.status === "rolled_back") {
    plainEnglish =
      `DanteCode detected "${quirkKey}" behavior from ${override.provider}/${override.model} and tested a prompt adjustment, ` +
      `but it did not improve results enough (or caused regression), so it was ${override.status === "rejected" ? "rejected" : "rolled back"}.`;
  } else {
    plainEnglish =
      `DanteCode detected "${quirkKey}" behavior from ${override.provider}/${override.model}. ` +
      `A candidate prompt adjustment is in "${override.status}" status and needs ${override.status === "testing" ? "experiment results" : "review"} before it can be activated.`;
  }

  return {
    quirkDetected,
    evidence,
    candidateOverride,
    experimentsRun,
    promotionDecision,
    rollbackStatus,
    plainEnglish,
  };
}

// ---------------------------------------------------------------------------
// Serialize to markdown with 7 required sections
// ---------------------------------------------------------------------------

export function serializeAdaptationReport(report: AdaptationReportData): string {
  const lines: string[] = [
    "# Model Adaptation Report",
    "",
    "## Quirk detected",
    "",
    report.quirkDetected,
    "",
    "## Evidence",
    "",
    ...(report.evidence.length > 0 ? report.evidence : ["No evidence recorded."]),
    "",
    "## Candidate override",
    "",
    report.candidateOverride,
    "",
    "## Experiments run",
    "",
    ...report.experimentsRun,
    "",
    "## Promotion decision",
    "",
    report.promotionDecision,
    "",
    "## Rollback status",
    "",
    report.rollbackStatus,
    "",
    "## What changed in plain English",
    "",
    report.plainEnglish,
    "",
  ];
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Write report to disk
// ---------------------------------------------------------------------------

export async function writeAdaptationReport(
  projectRoot: string,
  report: AdaptationReportData,
  quirkKey?: string,
): Promise<string> {
  const timestamp = new Date()
    .toISOString()
    .replace(/:/g, "-")
    .replace(/\.\d+Z$/, "Z");
  const suffix = quirkKey ? `-${quirkKey.replace(/[^a-z0-9_-]/gi, "-")}` : "";
  const filename = `${timestamp}-adaptation${suffix}.md`;
  const reportsDir = join(projectRoot, ".dantecode", "reports");
  await mkdir(reportsDir, { recursive: true });
  const filePath = join(reportsDir, filename);
  await writeFile(filePath, serializeAdaptationReport(report), "utf-8");
  return filePath;
}
