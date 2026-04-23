// ============================================================================
// @dantecode/core — FIM Acceptance Tracker (Sprint AF — dim 1)
// Records real completion acceptance/rejection events so fim-acceptance-history.json
// grows from live sessions, not just seed data.
// ============================================================================

import { mkdirSync, readFileSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import { join, resolve } from "node:path";

export interface FimAcceptanceEntry {
  timestamp: string;
  language: string;
  accepted: boolean;
  contextLength: number;
  completionLength: number;
  triggerReason?: string;
}

export interface LanguageAcceptanceStats {
  language: string;
  acceptanceRate: number;
  totalSessions: number;
  avgAcceptedLength: number;
  cancellationCount?: number;
}

const HISTORY_FILE = ".danteforge/fim-acceptance-history.json";

export function recordFimAcceptance(
  language: string,
  accepted: boolean,
  context: { contextLength?: number; completionLength?: number; triggerReason?: string } = {},
  projectRoot?: string,
): void {
  const root = projectRoot ?? resolve(process.cwd());
  const histPath = join(root, HISTORY_FILE);
  try {
    mkdirSync(join(root, ".danteforge"), { recursive: true });

    // Load existing history and update the matching language entry
    let history: LanguageAcceptanceStats[] = [];
    if (existsSync(histPath)) {
      try {
        history = JSON.parse(readFileSync(histPath, "utf-8")) as LanguageAcceptanceStats[];
      } catch {
        history = [];
      }
    }

    const existing = history.find((h) => h.language === language);
    if (existing) {
      const prevTotal = existing.totalSessions;
      const prevAccepted = Math.round(existing.acceptanceRate * prevTotal);
      const newTotal = prevTotal + 1;
      const newAccepted = prevAccepted + (accepted ? 1 : 0);
      existing.acceptanceRate = Math.round((newAccepted / newTotal) * 100) / 100;
      existing.totalSessions = newTotal;
      if (accepted && context.completionLength) {
        existing.avgAcceptedLength = Math.round(
          (existing.avgAcceptedLength * prevAccepted + context.completionLength) /
            (prevAccepted + 1),
        );
      }
    } else {
      history.push({
        language,
        acceptanceRate: accepted ? 1.0 : 0.0,
        totalSessions: 1,
        avgAcceptedLength: context.completionLength ?? 0,
      });
    }

    writeFileSync(histPath, JSON.stringify(history, null, 2), "utf-8");
  } catch {
    // non-fatal
  }
}

export function getLanguageAcceptanceRate(
  language: string,
  projectRoot?: string,
): number | null {
  const root = projectRoot ?? resolve(process.cwd());
  const histPath = join(root, HISTORY_FILE);
  if (!existsSync(histPath)) return null;
  try {
    const history = JSON.parse(readFileSync(histPath, "utf-8")) as LanguageAcceptanceStats[];
    return history.find((h) => h.language === language)?.acceptanceRate ?? null;
  } catch {
    return null;
  }
}

export function loadFimAcceptanceHistory(projectRoot?: string): LanguageAcceptanceStats[] {
  const root = projectRoot ?? resolve(process.cwd());
  const histPath = join(root, HISTORY_FILE);
  if (!existsSync(histPath)) return [];
  try {
    return JSON.parse(readFileSync(histPath, "utf-8")) as LanguageAcceptanceStats[];
  } catch {
    return [];
  }
}

// ─── Levenshtein acceptance stats (Sprint BA — Dim 1) ────────────────────────

export interface FimLevenshteinStat {
  language: string;
  suggestionLength: number;
  editDistance: number;
  accepted: boolean;
  timestamp: string;
}

const LEVENSHTEIN_FILE = ".danteforge/fim-levenshtein-log.json";

export function recordLevenshteinAcceptance(
  stat: FimLevenshteinStat,
  projectRoot: string,
): void {
  try {
    const dir = join(resolve(projectRoot), ".danteforge");
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, "fim-levenshtein-log.json"), JSON.stringify(stat) + "\n", "utf-8");
  } catch { /* non-fatal */ }
}

export function loadLevenshteinStats(projectRoot: string): FimLevenshteinStat[] {
  const path = join(resolve(projectRoot), LEVENSHTEIN_FILE);
  if (!existsSync(path)) return [];
  try {
    return readFileSync(path, "utf-8").split("\n").filter(Boolean)
      .map((l) => JSON.parse(l) as FimLevenshteinStat);
  } catch { return []; }
}

/** 90th-percentile edit distance of accepted completions — dynamic threshold. */
export function getLevenshteinAcceptanceThreshold(stats: FimLevenshteinStat[]): number {
  const accepted = stats.filter((s) => s.accepted).map((s) => s.editDistance).sort((a, b) => a - b);
  if (accepted.length === 0) return 3;
  const idx = Math.floor(accepted.length * 0.9);
  return accepted[Math.min(idx, accepted.length - 1)]!;
}

// ─── Stale suggestion suppressor (Sprint Dim 1) ──────────────────────────────

// Module-level in-memory counter — resets on process restart (intentional TTL behavior).
const _suppressCache = new Map<string, number>();

function _suppressKey(text: string, language: string): string {
  return `${language}:${text.slice(0, 40)}`;
}

/** Increment the shown-count for this suggestion. Call before displaying. */
export function trackSuggestionShown(text: string, language: string): void {
  const key = _suppressKey(text, language);
  _suppressCache.set(key, (_suppressCache.get(key) ?? 0) + 1);
}

/**
 * Returns true when this suggestion has been shown >= maxShown times without acceptance.
 * Use to skip presenting stale / repetitive inline completions.
 */
export function shouldSuppressSuggestion(text: string, language: string, maxShown = 3): boolean {
  return (_suppressCache.get(_suppressKey(text, language)) ?? 0) >= maxShown;
}

/**
 * Call on user acceptance to reset the suppress counter for this suggestion,
 * so it is fresh if it reappears in a new context.
 */
export function resetSuggestionShown(text: string, language: string): void {
  _suppressCache.delete(_suppressKey(text, language));
}

/** Wipe the entire in-memory suppress cache (useful in tests). */
export function clearSuggestionSuppressCache(): void {
  _suppressCache.clear();
}

// ─── Cancellation rate tracking (Sprint Dim 1) ───────────────────────────────

/** Record a user cancellation (dismissed without accepting or explicitly rejecting). */
export function recordFimCancellation(language: string, projectRoot: string): void {
  const root = resolve(projectRoot);
  const histPath = join(root, HISTORY_FILE);
  try {
    mkdirSync(join(root, ".danteforge"), { recursive: true });
    let history: LanguageAcceptanceStats[] = [];
    if (existsSync(histPath)) {
      try { history = JSON.parse(readFileSync(histPath, "utf-8")) as LanguageAcceptanceStats[]; } catch { /* ignore */ }
    }
    const existing = history.find((h) => h.language === language);
    if (existing) {
      existing.cancellationCount = (existing.cancellationCount ?? 0) + 1;
    } else {
      history.push({ language, acceptanceRate: 0, totalSessions: 0, avgAcceptedLength: 0, cancellationCount: 1 });
    }
    writeFileSync(histPath, JSON.stringify(history, null, 2), "utf-8");
  } catch { /* non-fatal */ }
}

/**
 * Returns cancellationCount / (totalSessions + cancellationCount) for the given language.
 * Returns 0 if no data.
 */
export function getFimCancellationRate(language: string, projectRoot?: string): number {
  const root = resolve(projectRoot ?? process.cwd());
  const histPath = join(root, HISTORY_FILE);
  if (!existsSync(histPath)) return 0;
  try {
    const history = JSON.parse(readFileSync(histPath, "utf-8")) as LanguageAcceptanceStats[];
    const entry = history.find((h) => h.language === language);
    if (!entry) return 0;
    const cancels = entry.cancellationCount ?? 0;
    const total = entry.totalSessions + cancels;
    return total === 0 ? 0 : Math.round((cancels / total) * 1000) / 1000;
  } catch {
    return 0;
  }
}

/**
 * Sprint BA (dim 1): O(n*m) Levenshtein distance between two strings.
 * Used as acceptance threshold: accepted if distance < max(3, len * 0.10).
 */
export function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i]![j] = a[i - 1] === b[j - 1]
        ? dp[i - 1]![j - 1]!
        : 1 + Math.min(dp[i - 1]![j]!, dp[i]![j - 1]!, dp[i - 1]![j - 1]!);
    }
  }
  return dp[m]![n]!;
}
