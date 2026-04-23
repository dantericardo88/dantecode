// packages/core/src/explanation-quality-meter.ts
// Sprint CC — Dim 14: Explanation quality analysis and scoring.

import { appendFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

export interface ExplanationQualitySignals {
  hasCodeExample: boolean;         // contains ``` code block
  hasNumberedSteps: boolean;       // contains "1." or "1)" pattern
  hasConciseOpening: boolean;      // first sentence < 120 chars
  mentionsWhyNotJustWhat: boolean; // contains "because", "reason", "in order to", "so that"
  hasAnalogy: boolean;             // contains "like", "similar to", "think of it as"
  referencesDocumentation: boolean; // contains "docs", "documentation", "RFC", "spec", "MDN"
  wordCount: number;
  sentenceCount: number;
}

export interface ExplanationQualityScore {
  text: string;                    // first 200 chars of explanation
  signals: ExplanationQualitySignals;
  score: number;                   // 0-1 composite
  grade: "excellent" | "good" | "fair" | "poor";
  suggestions: string[];           // 1-line improvement hints
}

export function analyzeExplanationQuality(text: string): ExplanationQualityScore {
  const hasCodeExample = /```[\s\S]*?```/.test(text);
  const hasNumberedSteps = /^\d+[\.\)]/m.test(text);
  const hasConciseOpening = (text.split(".")[0] ?? "").trim().length < 120;
  const mentionsWhyNotJustWhat = /(because|reason|in order to|so that)/i.test(text);
  const hasAnalogy = /(like|similar to|think of it as)/i.test(text);
  const referencesDocumentation = /(docs|documentation|RFC|spec|MDN)/i.test(text);
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const sentenceCount = text.split(/[.!?]+/).filter((s) => s.trim().length > 0).length;

  const signals: ExplanationQualitySignals = {
    hasCodeExample,
    hasNumberedSteps,
    hasConciseOpening,
    mentionsWhyNotJustWhat,
    hasAnalogy,
    referencesDocumentation,
    wordCount,
    sentenceCount,
  };

  const booleanSignals = [
    hasCodeExample,
    hasNumberedSteps,
    hasConciseOpening,
    mentionsWhyNotJustWhat,
    hasAnalogy,
    referencesDocumentation,
  ];
  const signalCount = booleanSignals.filter(Boolean).length;
  let score = signalCount / 6;
  if (wordCount >= 50 && wordCount <= 300) {
    score += 0.1;
  }
  score = Math.min(1.0, score);

  let grade: "excellent" | "good" | "fair" | "poor";
  if (score >= 0.8) grade = "excellent";
  else if (score >= 0.6) grade = "good";
  else if (score >= 0.4) grade = "fair";
  else grade = "poor";

  const suggestions: string[] = [];
  if (!hasCodeExample) suggestions.push("Add a code example to illustrate the concept");
  if (!hasNumberedSteps) suggestions.push("Use numbered steps for procedural explanations");
  if (!mentionsWhyNotJustWhat) suggestions.push("Explain *why*, not just *what*");
  if (!hasAnalogy) suggestions.push("Use an analogy to relate to familiar concepts");

  return {
    text: text.slice(0, 200),
    signals,
    score,
    grade,
    suggestions,
  };
}

const EXPLANATION_LOG_PATH = ".danteforge/explanation-quality-log.json";

export function recordExplanationQuality(
  score: ExplanationQualityScore,
  sessionId: string,
  projectRoot?: string,
): void {
  const root = projectRoot ?? process.cwd();
  const dir = join(root, ".danteforge");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const filePath = join(root, EXPLANATION_LOG_PATH);
  const entry = { ...score, sessionId, timestamp: new Date().toISOString() };
  appendFileSync(filePath, JSON.stringify(entry) + "\n", "utf8");
}

export function loadExplanationQualityLog(
  projectRoot?: string,
): Array<ExplanationQualityScore & { sessionId: string; timestamp: string }> {
  const root = projectRoot ?? process.cwd();
  const filePath = join(root, EXPLANATION_LOG_PATH);
  if (!existsSync(filePath)) return [];
  const raw = readFileSync(filePath, "utf8");
  return raw
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as ExplanationQualityScore & { sessionId: string; timestamp: string });
}

export function getExplanationQualityStats(
  entries: Array<{ score: number; grade: string }>,
): {
  avgScore: number;
  gradeDistribution: Record<string, number>;
  excellentRate: number;
} {
  if (entries.length === 0) {
    return { avgScore: 0, gradeDistribution: {}, excellentRate: 0 };
  }
  const avgScore = entries.reduce((sum, e) => sum + e.score, 0) / entries.length;
  const gradeDistribution: Record<string, number> = {};
  for (const e of entries) {
    gradeDistribution[e.grade] = (gradeDistribution[e.grade] ?? 0) + 1;
  }
  const excellentRate = (gradeDistribution["excellent"] ?? 0) / entries.length;
  return { avgScore, gradeDistribution, excellentRate };
}
