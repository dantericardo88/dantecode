// ============================================================================
// packages/core/src/decision-narrator.ts
//
// Dim 30 — UX trust / explainability
// Surfaces internal confidence + strategy signals as user-visible narration.
//
// Pattern from Cline (Apache-2.0): semantic message types with reasoning blocks
// shown before tool calls; OpenHands: risk level on confirmation actions.
// ============================================================================

import { appendFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ConfidenceLabel = "high" | "moderate" | "exploratory";
export type ActionRisk = "safe" | "review" | "risky";

export interface DecisionNarrative {
  strategy: string;
  confidenceLabel: ConfidenceLabel;
  confidenceScore: number;
  rationale: string;
  formattedLine: string;
  recordedAt: string;
}

// ── labelConfidence ───────────────────────────────────────────────────────────

export function labelConfidence(score: number): ConfidenceLabel {
  if (score >= 0.85) return "high";
  if (score >= 0.65) return "moderate";
  return "exploratory";
}

// ── rateActionRisk ────────────────────────────────────────────────────────────

const SAFE_TOOLS = new Set([
  "read_file", "readFile", "read",
  "glob", "grep", "list_dir", "listDir",
  "web_search", "webSearch",
  "get_config", "getConfig",
]);

const RISKY_TOOLS = new Set([
  "bash", "execute_command", "executeCommand", "run_command", "runCommand",
  "git_push", "gitPush", "push",
  "delete_file", "deleteFile", "remove_file",
  "npm_install", "npmInstall",
]);

export function rateActionRisk(
  toolName: string,
  _input: Record<string, unknown> = {},
): ActionRisk {
  const normalized = toolName.toLowerCase().replace(/-/g, "_");
  if (RISKY_TOOLS.has(toolName) || RISKY_TOOLS.has(normalized)) return "risky";
  if (SAFE_TOOLS.has(toolName) || SAFE_TOOLS.has(normalized)) return "safe";
  // write-like operations default to "review"
  return "review";
}

// ── narrateDecision ───────────────────────────────────────────────────────────

export function narrateDecision(
  strategy: string,
  confidence: number,
  context: string[],
): DecisionNarrative {
  const confidenceLabel = labelConfidence(confidence);
  const pct = Math.round(confidence * 100);

  const rationale = context.length > 0
    ? context.slice(0, 3).join(", ")
    : "general context";

  const strategyLabel = strategy || "direct";

  let formattedLine: string;
  if (confidenceLabel === "high") {
    formattedLine = `Approach: ${strategyLabel} (${confidenceLabel} confidence, ${pct}%) — ${rationale}`;
  } else if (confidenceLabel === "moderate") {
    formattedLine = `Approach: ${strategyLabel} (${confidenceLabel} confidence, ${pct}%) — ${rationale} — review output`;
  } else {
    formattedLine = `[Exploratory] Approach: ${strategyLabel} (${pct}% confidence) — ${rationale} — please verify`;
  }

  return {
    strategy: strategyLabel,
    confidenceLabel,
    confidenceScore: confidence,
    rationale,
    formattedLine,
    recordedAt: new Date().toISOString(),
  };
}

// ── JSONL persistence ─────────────────────────────────────────────────────────

const NARRATIVES_LOG = ".danteforge/decision-narratives.jsonl";

export function recordDecisionNarrative(
  narrative: DecisionNarrative,
  projectRoot: string,
): void {
  try {
    const dir = join(resolve(projectRoot), ".danteforge");
    mkdirSync(dir, { recursive: true });
    appendFileSync(
      join(dir, "decision-narratives.jsonl"),
      JSON.stringify(narrative) + "\n",
      "utf-8",
    );
  } catch { /* non-fatal */ }
}

export function loadDecisionNarratives(projectRoot: string): DecisionNarrative[] {
  const path = join(resolve(projectRoot), NARRATIVES_LOG);
  if (!existsSync(path)) return [];
  try {
    return readFileSync(path, "utf-8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as DecisionNarrative);
  } catch {
    return [];
  }
}

// ── renderActionBadge ─────────────────────────────────────────────────────────

export function renderActionBadge(risk: ActionRisk): string {
  switch (risk) {
    case "safe":   return "[safe]";
    case "review": return "[review]";
    case "risky":  return "[risky — confirm]";
  }
}

// ── renderContextAttribution ──────────────────────────────────────────────────

export function renderContextAttribution(
  files: string[],
  lessonCount: number,
  diagnosticCount: number,
): string {
  const parts: string[] = [];
  if (files.length > 0) parts.push(files.slice(0, 3).join(", "));
  if (lessonCount > 0) parts.push(`${lessonCount} lesson${lessonCount === 1 ? "" : "s"}`);
  if (diagnosticCount > 0) parts.push(`${diagnosticCount} LSP diagnostic${diagnosticCount === 1 ? "" : "s"}`);
  if (parts.length === 0) return "";
  return `Context: ${parts.join(" • ")}`;
}

// ── renderSessionSummary ──────────────────────────────────────────────────────

export interface SessionSummaryInput {
  filesEdited: string[];
  testsResult?: string;
  commitSha?: string;
  commitMessage?: string;
  confidence: number;
}

export function renderSessionSummary(input: SessionSummaryInput): string {
  const sep = "─".repeat(56);
  const lines: string[] = [`${sep}`, `Session complete`];

  if (input.filesEdited.length > 0) {
    const fileList = input.filesEdited.slice(0, 4).join(", ");
    const more = input.filesEdited.length > 4 ? ` +${input.filesEdited.length - 4} more` : "";
    lines.push(`Edited:     ${fileList}${more}`);
  }
  if (input.testsResult) {
    lines.push(`Tests:      ${input.testsResult}`);
  }
  if (input.commitSha && input.commitMessage) {
    const short = input.commitSha.slice(0, 7);
    lines.push(`Commit:     ${short} ${input.commitMessage}`);
  }

  const label = labelConfidence(input.confidence);
  const pct = Math.round(input.confidence * 100);
  lines.push(`Confidence: ${label} (${pct}%)`);
  lines.push(sep);

  return lines.join("\n");
}
