// ============================================================================
// Sprint AY — Dim 15: Task Ambiguity Detector
// Detects underspecified prompts and generates assumption declarations that
// are injected as system messages — changing agent behavior, not just logging.
// ============================================================================

import { appendFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export type AmbiguitySignalType =
  | "too_short"
  | "no_file_path"
  | "vague_verb"
  | "no_acceptance_criteria"
  | "no_noun_target";

export interface AmbiguitySignal {
  type: AmbiguitySignalType;
  description: string;
}

export interface AmbiguityResult {
  isAmbiguous: boolean;
  score: number;
  signals: AmbiguitySignal[];
  clarifyingQuestion: string;
  assumptionText: string;
}

export interface AmbiguityLogEntry {
  sessionId: string;
  prompt: string;
  isAmbiguous: boolean;
  score: number;
  signalTypes: string[];
  assumptionText: string;
  timestamp: string;
}

const VAGUE_VERBS = ["improve", "make", "fix", "update", "clean"];

export function detectTaskAmbiguity(prompt: string): AmbiguityResult {
  const signals: AmbiguitySignal[] = [];
  const trimmed = prompt.trim();

  if (trimmed.length < 60) {
    signals.push({ type: "too_short", description: "Prompt is shorter than 60 characters" });
  }

  if (!/\.(ts|js|py|go|rs|java|cs|rb|php|tsx|jsx|json|yaml|yml|md)|src\/|lib\/|pkg\//.test(prompt)) {
    signals.push({ type: "no_file_path", description: "No file path or extension found in prompt" });
  }

  const firstWord = trimmed.split(/\s+/)[0]?.toLowerCase() ?? "";
  if (VAGUE_VERBS.some((v) => firstWord === v || trimmed.toLowerCase().startsWith(v + " "))) {
    signals.push({ type: "vague_verb", description: `Starts with vague verb "${firstWord}" without specifying target` });
  }

  if (!/should|must|assert|expect|test|verify/i.test(prompt)) {
    signals.push({ type: "no_acceptance_criteria", description: "No acceptance criteria keywords found" });
  }

  if (!/[A-Z][a-zA-Z]{2,}|`[^`]+`|"[^"]{2,}"|'[^']{2,}'/.test(prompt)) {
    signals.push({ type: "no_noun_target", description: "No CamelCase identifier, backtick, or quoted string found" });
  }

  const score = signals.length;
  const isAmbiguous = score >= 2;

  const clarifyingQuestion = isAmbiguous
    ? buildClarifyingQuestion(signals)
    : "";

  const assumptionText = isAmbiguous
    ? buildAssumptionText(signals, prompt)
    : "";

  return { isAmbiguous, score, signals, clarifyingQuestion, assumptionText };
}

function buildClarifyingQuestion(signals: AmbiguitySignal[]): string {
  const weakest = signals[0]!;
  switch (weakest.type) {
    case "too_short":
      return "To proceed, I need to know: What specific change should be made, and to which file or component?";
    case "no_file_path":
      return "To proceed, I need to know: Which file(s) should be modified?";
    case "vague_verb":
      return "To proceed, I need to know: What specific outcome should the change produce?";
    case "no_acceptance_criteria":
      return "To proceed, I need to know: How will we verify this task is complete?";
    case "no_noun_target":
      return "To proceed, I need to know: Which function, class, or component is the target?";
  }
}

function buildAssumptionText(signals: AmbiguitySignal[], prompt: string): string {
  const parts: string[] = [];
  for (const sig of signals) {
    switch (sig.type) {
      case "too_short":
        parts.push("the full scope is limited to the described change only");
        break;
      case "no_file_path":
        parts.push("changes should be made to the most relevant existing file in the project");
        break;
      case "vague_verb":
        parts.push(`"${prompt.split(/\s+/).slice(0, 5).join(" ")}..." targets the primary feature module`);
        break;
      case "no_acceptance_criteria":
        parts.push("success means the change compiles and existing tests continue to pass");
        break;
      case "no_noun_target":
        parts.push("the target is the main export of the most relevant module");
        break;
    }
  }
  return "Assuming: " + parts.join("; ") + ".";
}

export function recordAmbiguityDetection(
  entry: Omit<AmbiguityLogEntry, "timestamp">,
  projectRoot: string,
): void {
  try {
    const dir = join(projectRoot, ".danteforge");
    mkdirSync(dir, { recursive: true });
    const logEntry: AmbiguityLogEntry = { ...entry, timestamp: new Date().toISOString() };
    appendFileSync(join(dir, "ambiguity-log.json"), JSON.stringify(logEntry) + "\n", "utf-8");
  } catch { /* non-fatal */ }
}

export function loadAmbiguityLog(projectRoot: string): AmbiguityLogEntry[] {
  try {
    const path = join(projectRoot, ".danteforge", "ambiguity-log.json");
    if (!existsSync(path)) return [];
    return readFileSync(path, "utf-8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as AmbiguityLogEntry);
  } catch { return []; }
}

export function getAmbiguityStats(entries: AmbiguityLogEntry[]): {
  totalDetected: number;
  ambiguousRate: number;
  mostCommonSignal: string;
  avgScore: number;
} {
  if (entries.length === 0) {
    return { totalDetected: 0, ambiguousRate: 0, mostCommonSignal: "", avgScore: 0 };
  }

  const ambiguousCount = entries.filter((e) => e.isAmbiguous).length;
  const signalCounts: Record<string, number> = {};
  let totalScore = 0;
  for (const entry of entries) {
    totalScore += entry.score;
    for (const sig of entry.signalTypes) {
      signalCounts[sig] = (signalCounts[sig] ?? 0) + 1;
    }
  }

  const mostCommonSignal = Object.entries(signalCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";

  return {
    totalDetected: entries.length,
    ambiguousRate: ambiguousCount / entries.length,
    mostCommonSignal,
    avgScore: totalScore / entries.length,
  };
}
