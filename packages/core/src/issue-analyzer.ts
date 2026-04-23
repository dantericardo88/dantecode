// packages/core/src/issue-analyzer.ts
// Issue Analyzer — parses GitHub issues into structured reproduction steps,
// file hints, and root-cause hypotheses to improve SWE-bench performance.
//
// Closes dim 5 (SWE-bench: 6→8) gap vs Claude Code/Codex CLI (both 9).
// Better issue analysis → better localization → better patches.
//
// Based on SWE-bench research: the key bottleneck is file localization
// (finding which files to edit) not the edit itself. This module uses
// heuristics to narrow the search space before calling the model.

export interface IssueSignal {
  /** Raw issue title */
  title: string;
  /** Issue body */
  body: string;
  /** Labels on the issue */
  labels?: string[];
  /** Repository language (e.g. "python", "typescript") */
  language?: string;
}

export interface ReproductionStep {
  step: number;
  action: string;
  expectedResult?: string;
  actualResult?: string;
}

export interface FileHint {
  /** File path pattern or actual path */
  path: string;
  /** Confidence 0-1 that this file is relevant */
  confidence: number;
  /** Why this file was flagged */
  reason: string;
}

export interface ErrorSignature {
  /** Exception class or error code */
  type: string;
  /** Key message fragment */
  message: string;
  /** Stack trace lines if present */
  stackLines?: string[];
}

export interface AnalyzedIssue {
  /** Classified issue type */
  type: "bug" | "feature" | "regression" | "performance" | "docs" | "unknown";
  /** Severity estimate: "critical" | "high" | "medium" | "low" */
  severity: "critical" | "high" | "medium" | "low";
  /** Parsed reproduction steps */
  reproductionSteps: ReproductionStep[];
  /** Extracted error signatures (exception types, error codes) */
  errorSignatures: ErrorSignature[];
  /** File hints ordered by confidence */
  fileHints: FileHint[];
  /** Key symbols (class/function names) mentioned in issue */
  symbols: string[];
  /** Condensed one-sentence problem statement for model prompt */
  problemStatement: string;
  /** Suggested search queries for codebase search */
  searchQueries: string[];
}

// ─── Type Classifiers ─────────────────────────────────────────────────────────

const BUG_SIGNALS = /\b(bug|error|exception|crash|fail|broken|wrong|incorrect|unexpected|traceback|stacktrace|TypeError|ValueError|AttributeError|KeyError|IndexError|RuntimeError|AssertionError)\b/i;
const FEATURE_SIGNALS = /\b(feature|enhancement|add|implement|support|allow|enable|request|proposal|would be nice|could you)\b/i;
const REGRESSION_SIGNALS = /\b(regression|used to|previously|worked in|broke in|version \d|upgrade|downgrade)\b/i;
const PERF_SIGNALS = /\b(slow|performance|memory|leak|timeout|hang|latency|speed|throughput|OOM|out of memory)\b/i;

function classifyType(issue: IssueSignal): AnalyzedIssue["type"] {
  const text = `${issue.title} ${issue.body}`;
  if (REGRESSION_SIGNALS.test(text)) return "regression";
  if (BUG_SIGNALS.test(text)) return "bug";
  if (PERF_SIGNALS.test(text)) return "performance";
  if (FEATURE_SIGNALS.test(text)) return "feature";
  if (/\b(doc|readme|typo|spelling|comment)\b/i.test(text)) return "docs";
  return "unknown";
}

function classifySeverity(issue: IssueSignal): AnalyzedIssue["severity"] {
  const text = `${issue.title} ${issue.body}`;
  const labels = issue.labels ?? [];
  if (labels.some((l) => /critical|p0|blocker|security/i.test(l))) return "critical";
  if (/\b(crash|data loss|security|infinite loop|deadlock|OOM|out of memory)\b/i.test(text)) return "critical";
  if (labels.some((l) => /high|p1/i.test(l))) return "high";
  if (/\b(broken|fail|cannot|unable|exception)\b/i.test(text)) return "high";
  if (labels.some((l) => /medium|p2/i.test(l))) return "medium";
  return "low";
}

// ─── Reproduction Step Parser ─────────────────────────────────────────────────

const STEPS_SECTION = /(?:##?\s*(?:steps to reproduce|reproduction|how to reproduce|repro|steps)|to reproduce:?\s*\n)([\s\S]+?)(?:\n##|$)/i;
const STEP_LINE = /^\s*(?:\d+\.|[-*])\s*(.+)/;
const EXPECTED_RE = /expected:?\s*(.+)/i;
const ACTUAL_RE = /(?:actual|got|but got|instead|result):?\s*(.+)/i;

function parseReproductionSteps(body: string): ReproductionStep[] {
  const sectionMatch = body.match(STEPS_SECTION);
  const section = sectionMatch?.[1] ?? body;

  const steps: ReproductionStep[] = [];
  let stepNum = 0;
  let expected: string | undefined;
  let actual: string | undefined;

  for (const line of section.split("\n")) {
    const expMatch = line.match(EXPECTED_RE);
    if (expMatch) { expected = expMatch[1]!.trim(); continue; }
    const actMatch = line.match(ACTUAL_RE);
    if (actMatch) { actual = actMatch[1]!.trim(); continue; }

    const stepMatch = line.match(STEP_LINE);
    if (stepMatch) {
      stepNum++;
      steps.push({
        step: stepNum,
        action: stepMatch[1]!.trim(),
        expectedResult: stepNum === steps.length + 1 ? expected : undefined,
        actualResult: stepNum === steps.length + 1 ? actual : undefined,
      });
    }
  }

  if (steps.length === 0 && body.trim().length > 0) {
    // No numbered steps — treat first paragraph as the issue description
    const firstPara = body.split(/\n\n/)[0]?.trim() ?? "";
    if (firstPara) {
      steps.push({ step: 1, action: firstPara, expectedResult: expected, actualResult: actual });
    }
  }

  return steps;
}

// ─── Error Signature Extractor ────────────────────────────────────────────────

const TRACEBACK_PATTERNS = [
  // Python: "TypeError: ..."
  /\b([A-Z][a-zA-Z]+(?:Error|Exception|Warning|Fault))\s*:\s*(.{10,100})/g,
  // JS: "Error: message" or "ReferenceError: x is not defined"
  /\b([A-Z][a-zA-Z]*Error)\s*:\s*(.{5,80})/g,
  // Error codes: "E1234: ..." or "TS2304: ..."
  /\b([A-Z]{1,3}\d{3,6})\s*:\s*(.{5,80})/g,
];

const STACK_LINE = /^\s+(?:at |File "|in )\S+/m;

function extractErrorSignatures(body: string): ErrorSignature[] {
  const sigs: ErrorSignature[] = [];
  const seen = new Set<string>();

  for (const pattern of TRACEBACK_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(body)) !== null) {
      const type = match[1]!;
      const message = match[2]!.trim();
      const key = `${type}:${message.slice(0, 30)}`;
      if (seen.has(key)) continue;
      seen.add(key);

      // Extract nearby stack lines
      const nearbyText = body.slice(Math.max(0, match.index - 50), match.index + 200);
      const stackLines = nearbyText
        .split("\n")
        .filter((l) => STACK_LINE.test(l))
        .slice(0, 3)
        .map((l) => l.trim());

      sigs.push({ type, message, stackLines: stackLines.length > 0 ? stackLines : undefined });
    }
  }

  return sigs.slice(0, 5); // cap at 5 signatures
}

// ─── File Hint Generator ──────────────────────────────────────────────────────

// Extract file path patterns from issue text
const FILE_PATH_RE = /`([^`]+\.(?:py|ts|js|tsx|jsx|rs|go|java|rb|cpp|c|cs|kt|swift|sh|yaml|yml|json|toml))`|(?:^|\s)([\w/.-]+\.(?:py|ts|js|tsx|jsx|rs|go|java|rb))(?:\s|$)/gm;
// Module/package references
const MODULE_RE = /(?:import|from|require|use|include)\s+["']?([\w./:-]+)["']?/g;
// Class/function names in backticks or uppercase camel
const SYMBOL_RE = /`([A-Z][a-zA-Z0-9_]{2,}(?:\.[a-zA-Z0-9_]+)*)`|(?<!\w)([A-Z][a-zA-Z0-9_]{3,}(?:Error|Manager|Handler|Provider|Service|Client|Router))/g;

function extractFileHints(text: string, language?: string): { hints: FileHint[]; symbols: string[] } {
  const hints: FileHint[] = [];
  const symbols: string[] = [];
  const seen = new Set<string>();

  // Direct file path mentions
  FILE_PATH_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FILE_PATH_RE.exec(text)) !== null) {
    const path = (match[1] ?? match[2] ?? "").trim();
    if (!path || seen.has(path)) continue;
    seen.add(path);
    hints.push({ path, confidence: 0.9, reason: "directly mentioned in issue" });
  }

  // Module imports
  MODULE_RE.lastIndex = 0;
  while ((match = MODULE_RE.exec(text)) !== null) {
    const mod = match[1]!.trim().replace(/^['"]|['"]$/g, "");
    if (!mod || seen.has(mod) || mod.length < 3) continue;
    seen.add(mod);
    const ext = language === "python" ? ".py" : language === "rust" ? ".rs" : ".ts";
    hints.push({
      path: mod.replace(/\./g, "/") + ext,
      confidence: 0.6,
      reason: `imported module "${mod}"`,
    });
  }

  // Symbol extraction
  SYMBOL_RE.lastIndex = 0;
  while ((match = SYMBOL_RE.exec(text)) !== null) {
    const sym = (match[1] ?? match[2] ?? "").trim();
    if (sym && !symbols.includes(sym)) symbols.push(sym);
  }

  return { hints: hints.slice(0, 10), symbols: symbols.slice(0, 10) };
}

// ─── Search Query Builder ─────────────────────────────────────────────────────

function buildSearchQueries(issue: IssueSignal, symbols: string[], errors: ErrorSignature[]): string[] {
  const queries: string[] = [];

  // Symbol-based queries
  for (const sym of symbols.slice(0, 3)) {
    queries.push(sym);
  }

  // Error-type queries
  for (const err of errors.slice(0, 2)) {
    queries.push(err.type);
    if (err.message.length < 60) queries.push(err.message);
  }

  // Keyword extraction from title (remove common words)
  const STOP_WORDS = new Set(["the", "a", "an", "is", "in", "on", "at", "to", "for", "of", "and", "or", "not", "with"]);
  const titleWords = issue.title.toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOP_WORDS.has(w));

  if (titleWords.length >= 2) {
    queries.push(titleWords.slice(0, 4).join(" "));
  }

  return [...new Set(queries)].slice(0, 6);
}

// ─── Problem Statement Builder ────────────────────────────────────────────────

function buildProblemStatement(issue: IssueSignal, type: AnalyzedIssue["type"], errors: ErrorSignature[]): string {
  const title = issue.title.replace(/^\[.*?\]\s*/, "").trim();

  if (errors.length > 0) {
    const err = errors[0]!;
    return `${type === "bug" ? "Bug" : "Issue"}: ${title}. Error: ${err.type}: ${err.message}`;
  }

  return `${type.charAt(0).toUpperCase() + type.slice(1)}: ${title}`;
}

// ─── Main Analyzer ────────────────────────────────────────────────────────────

/**
 * Analyze a GitHub issue into structured signals for the SWE-bench agent.
 * Results are injected into the model's system prompt to improve localization.
 */
export function analyzeIssue(issue: IssueSignal): AnalyzedIssue {
  const text = `${issue.title}\n\n${issue.body}`;
  const type = classifyType(issue);
  const severity = classifySeverity(issue);
  const reproductionSteps = parseReproductionSteps(issue.body);
  const errorSignatures = extractErrorSignatures(text);
  const { hints: fileHints, symbols } = extractFileHints(text, issue.language);
  const searchQueries = buildSearchQueries(issue, symbols, errorSignatures);
  const problemStatement = buildProblemStatement(issue, type, errorSignatures);

  return {
    type,
    severity,
    reproductionSteps,
    errorSignatures,
    fileHints,
    symbols,
    problemStatement,
    searchQueries,
  };
}

/**
 * Format an analyzed issue as a model system-prompt injection block.
 * Gives the model structured hints to improve localization accuracy.
 */
export function formatAnalyzedIssueForPrompt(analyzed: AnalyzedIssue): string {
  const lines: string[] = [
    "## Issue Analysis",
    "",
    `**Type:** ${analyzed.type}  |  **Severity:** ${analyzed.severity}`,
    `**Problem:** ${analyzed.problemStatement}`,
  ];

  if (analyzed.errorSignatures.length > 0) {
    lines.push("", "**Error signatures:**");
    for (const e of analyzed.errorSignatures) {
      lines.push(`  - \`${e.type}\`: ${e.message}`);
    }
  }

  if (analyzed.fileHints.length > 0) {
    lines.push("", "**Likely relevant files:**");
    for (const h of analyzed.fileHints.filter((h) => h.confidence >= 0.5)) {
      lines.push(`  - \`${h.path}\` (${Math.round(h.confidence * 100)}% — ${h.reason})`);
    }
  }

  if (analyzed.symbols.length > 0) {
    lines.push("", `**Key symbols:** ${analyzed.symbols.map((s) => `\`${s}\``).join(", ")}`);
  }

  if (analyzed.searchQueries.length > 0) {
    lines.push("", "**Search queries to try:**");
    for (const q of analyzed.searchQueries) {
      lines.push(`  - "${q}"`);
    }
  }

  if (analyzed.reproductionSteps.length > 0 && analyzed.type !== "feature") {
    lines.push("", "**Reproduction steps:**");
    for (const s of analyzed.reproductionSteps.slice(0, 5)) {
      lines.push(`  ${s.step}. ${s.action}`);
    }
  }

  return lines.join("\n");
}
