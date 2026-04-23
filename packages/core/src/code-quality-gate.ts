// Sprint AO — Dim 3: Code quality gate
// Scores generated code on readability, safety, and correctness indicators.
// Higher scores mean the code is less likely to need immediate fixes.
import { appendFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

export interface CodeQualityScore {
  overall: number; // 0-1
  breakdown: {
    lineLengthOk: boolean;     // avg line length < 80 chars
    noConsoleLog: boolean;     // no bare console.log statements
    camelCaseNames: boolean;   // identifiers follow camelCase/PascalCase
    noMagicNumbers: boolean;   // no inline magic numbers (not 0/1/-1)
    hasErrorHandling: boolean; // try/catch or .catch() present
  };
  linesOfCode: number;
  language: string;
}

export interface CodeQualityLogEntry {
  timestamp: string;
  filePath: string;
  language: string;
  overall: number;
  linesOfCode: number;
  noConsoleLog: boolean;
  hasErrorHandling: boolean;
}

const QUALITY_FILE = ".danteforge/code-quality-log.json";

const MAGIC_NUMBER_RE = /(?<![.'\w])\b(?!0\b|1\b|-1\b)\d{2,}\b/;
const CONSOLE_LOG_RE = /console\.log\s*\(/;
const CAMEL_CASE_RE = /\b[a-z][a-z0-9]*(?:[A-Z][a-z0-9]*)+\b|[A-Z][a-z][a-zA-Z0-9]*/;

/**
 * Score generated code across 5 dimensions, each worth 0.2.
 */
export function scoreGeneratedCode(code: string, language = "typescript"): CodeQualityScore {
  const lines = code.split("\n");
  const nonEmptyLines = lines.filter((l) => l.trim().length > 0);
  const avgLineLen = nonEmptyLines.length > 0
    ? nonEmptyLines.reduce((s, l) => s + l.length, 0) / nonEmptyLines.length
    : 0;

  const lineLengthOk = avgLineLen < 80;
  const noConsoleLog = !CONSOLE_LOG_RE.test(code);
  const camelCaseNames = CAMEL_CASE_RE.test(code);
  const noMagicNumbers = !MAGIC_NUMBER_RE.test(code);
  const hasErrorHandling = /try\s*\{/.test(code) || /\.catch\s*\(/.test(code) || /catch\s*\(/.test(code);

  const points = [lineLengthOk, noConsoleLog, camelCaseNames, noMagicNumbers, hasErrorHandling]
    .filter(Boolean).length;

  return {
    overall: points * 0.2,
    breakdown: { lineLengthOk, noConsoleLog, camelCaseNames, noMagicNumbers, hasErrorHandling },
    linesOfCode: nonEmptyLines.length,
    language,
  };
}

export class CodeQualityGate {
  private readonly _projectRoot: string;

  constructor(projectRoot = process.cwd()) {
    this._projectRoot = resolve(projectRoot);
  }

  /** Score a file's code and record to .danteforge/code-quality-log.json. */
  check(filePath: string, code: string, language = "typescript"): CodeQualityScore {
    const score = scoreGeneratedCode(code, language);
    try {
      mkdirSync(join(this._projectRoot, ".danteforge"), { recursive: true });
      const entry: CodeQualityLogEntry = {
        timestamp: new Date().toISOString(),
        filePath,
        language,
        overall: score.overall,
        linesOfCode: score.linesOfCode,
        noConsoleLog: score.breakdown.noConsoleLog,
        hasErrorHandling: score.breakdown.hasErrorHandling,
      };
      appendFileSync(join(this._projectRoot, QUALITY_FILE), JSON.stringify(entry) + "\n", "utf-8");
    } catch { /* non-fatal */ }
    return score;
  }

  /** Load all quality log entries. */
  loadLog(): CodeQualityLogEntry[] {
    const path = join(this._projectRoot, QUALITY_FILE);
    if (!existsSync(path)) return [];
    try {
      return readFileSync(path, "utf-8").trim().split("\n").filter(Boolean)
        .map((l) => JSON.parse(l) as CodeQualityLogEntry);
    } catch { return []; }
  }

  /** Compute average quality score across all logged files. */
  getAverageScore(): number {
    const entries = this.loadLog();
    if (entries.length === 0) return 0;
    return entries.reduce((s, e) => s + e.overall, 0) / entries.length;
  }
}

// ─── Quality trend tracker (Sprint BB — Dim 3) ──────────────────────────────

export interface QualityTrendResult {
  windowDays: number;
  rollingAvg: number;
  currentSessionAvg: number;
  delta: number;
  isAlert: boolean;
  entryCount: number;
}

const TREND_FILE = ".danteforge/quality-trend-log.json";

export function computeQualityTrend(
  projectRoot: string,
  windowDays = 30,
): QualityTrendResult {
  const path = join(resolve(projectRoot), QUALITY_FILE);
  if (!existsSync(path)) {
    return { windowDays, rollingAvg: 0, currentSessionAvg: 0, delta: 0, isAlert: false, entryCount: 0 };
  }
  let entries: CodeQualityLogEntry[] = [];
  try {
    entries = readFileSync(path, "utf-8").trim().split("\n").filter(Boolean)
      .map((l) => JSON.parse(l) as CodeQualityLogEntry);
  } catch {
    return { windowDays, rollingAvg: 0, currentSessionAvg: 0, delta: 0, isAlert: false, entryCount: 0 };
  }

  const cutoff = Date.now() - windowDays * 86_400_000;
  const windowEntries = entries.filter((e) => new Date(e.timestamp).getTime() >= cutoff);
  const rollingAvg = windowEntries.length === 0
    ? 0
    : windowEntries.reduce((s, e) => s + e.overall, 0) / windowEntries.length;

  const last24hCutoff = Date.now() - 86_400_000;
  const recentEntries = entries.filter((e) => new Date(e.timestamp).getTime() >= last24hCutoff);
  const currentSessionAvg = recentEntries.length === 0
    ? rollingAvg
    : recentEntries.reduce((s, e) => s + e.overall, 0) / recentEntries.length;

  const delta = currentSessionAvg - rollingAvg;
  return {
    windowDays,
    rollingAvg,
    currentSessionAvg,
    delta,
    isAlert: delta < -0.1,
    entryCount: windowEntries.length,
  };
}

export function recordQualityTrend(result: QualityTrendResult, projectRoot: string): void {
  try {
    const dir = join(resolve(projectRoot), ".danteforge");
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, "quality-trend-log.json"), JSON.stringify({ ...result, timestamp: new Date().toISOString() }) + "\n", "utf-8");
  } catch { /* non-fatal */ }
}

export function loadQualityTrendLog(projectRoot: string): Array<QualityTrendResult & { timestamp: string }> {
  const path = join(resolve(projectRoot), TREND_FILE);
  if (!existsSync(path)) return [];
  try {
    return readFileSync(path, "utf-8").trim().split("\n").filter(Boolean)
      .map((l) => JSON.parse(l) as QualityTrendResult & { timestamp: string });
  } catch { return []; }
}

export function getQualityTrendStats(entries: Array<QualityTrendResult & { timestamp: string }>): {
  alertRate: number;
  avgDelta: number;
  totalEntries: number;
} {
  if (entries.length === 0) return { alertRate: 0, avgDelta: 0, totalEntries: 0 };
  const alertRate = entries.filter((e) => e.isAlert).length / entries.length;
  const avgDelta = entries.reduce((s, e) => s + e.delta, 0) / entries.length;
  return { alertRate, avgDelta, totalEntries: entries.length };
}
