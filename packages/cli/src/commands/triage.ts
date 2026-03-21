// ============================================================================
// @dantecode/cli — DanteTriage command
// Model-assisted GitHub issue triage with label suggestions and effort estimates.
// ============================================================================

import {
  GitHubClient,
  buildRepoMap,
  ModelRouterImpl,
  readOrInitializeState,
} from "@dantecode/core";
import type { GitHubIssue } from "@dantecode/core";

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
// Types
// ────────────────────────────────────────────────────────

export type Priority = "P0" | "P1" | "P2" | "P3";
export type Effort = "S" | "M" | "L" | "XL";

export interface TriageResult {
  issueNumber: number;
  title: string;
  suggestedLabels: string[];
  priority: Priority;
  effort: Effort;
  relevantFiles: string[];
  canAutoResolve: boolean;
  confidence: number;
  reasoning: string;
  postedToGitHub: boolean;
}

export interface TriageOptions {
  postLabels?: boolean;
  token?: string;
  useLLM?: boolean;
}

// ────────────────────────────────────────────────────────
// Heuristic classification
// ────────────────────────────────────────────────────────

const LABEL_KEYWORDS: Record<string, string[]> = {
  bug: [
    "bug",
    "error",
    "crash",
    "fail",
    "broken",
    "exception",
    "typeerror",
    "null",
    "undefined",
    "traceback",
  ],
  feature: ["feature", "request", "add", "support", "implement", "want", "would like", "new"],
  enhancement: [
    "enhance",
    "improve",
    "better",
    "update",
    "upgrade",
    "performance",
    "faster",
    "speed",
  ],
  documentation: ["docs", "documentation", "readme", "typo", "comment", "explain", "example"],
  security: ["security", "vulnerability", "cve", "injection", "xss", "csrf", "exploit"],
  test: ["test", "spec", "coverage", "flaky", "testing"],
  "good first issue": ["good first", "starter", "beginner", "easy"],
};

function classifyLabels(text: string): string[] {
  const lower = text.toLowerCase();
  return Object.entries(LABEL_KEYWORDS)
    .filter(([, keywords]) => keywords.some((kw) => lower.includes(kw)))
    .map(([label]) => label);
}

function classifyPriority(labels: string[], body: string): Priority {
  const text = (body + " " + labels.join(" ")).toLowerCase();
  if (
    text.includes("security") ||
    text.includes("critical") ||
    text.includes("crash") ||
    text.includes("vulnerability") ||
    text.includes("data loss")
  )
    return "P0";
  if (text.includes("bug") || text.includes("broken") || text.includes("error")) return "P1";
  if (text.includes("feature") || text.includes("enhancement")) return "P2";
  return "P3";
}

function estimateEffort(body: string): Effort {
  const lines = body.split("\n").filter((l) => l.trim().length > 0).length;
  const techMentions = (
    body.match(/\bfile\b|\bfunction\b|\bclass\b|\bmodule\b|\bpackage\b|\bcomponent\b/gi) ?? []
  ).length;
  if (techMentions > 5 || lines > 30) return "XL";
  if (techMentions > 2 || lines > 15) return "L";
  if (lines > 5) return "M";
  return "S";
}

function heuristicTriage(
  issue: GitHubIssue,
): Omit<TriageResult, "relevantFiles" | "postedToGitHub"> {
  const text = issue.title + " " + (issue.body || "");
  const suggestedLabels = classifyLabels(text);
  const priority = classifyPriority(suggestedLabels, issue.body || "");
  const effort = estimateEffort(issue.body || "");
  // Can auto-resolve: small effort, not security-critical, looks like a bug
  const canAutoResolve =
    effort === "S" &&
    priority !== "P0" &&
    (suggestedLabels.includes("bug") || suggestedLabels.includes("documentation"));

  return {
    issueNumber: issue.number,
    title: issue.title,
    suggestedLabels,
    priority,
    effort,
    canAutoResolve,
    confidence: computeHeuristicConfidence(suggestedLabels, priority, text),
    reasoning: `Heuristic classification. Priority=${priority}, Effort=${effort}, Labels=[${suggestedLabels.join(", ")}].`,
  };
}

/**
 * Calibrates heuristic confidence based on signal strength.
 * Returns 0.25–0.75 (LLM can push higher).
 */
function computeHeuristicConfidence(labels: string[], priority: Priority, text: string): number {
  let conf = 0.35;
  // Strong signal: known-critical keywords with matching priority
  if (
    priority === "P0" &&
    (text.includes("crash") ||
      text.includes("security") ||
      text.includes("data loss") ||
      text.includes("vulnerability"))
  )
    conf += 0.35;
  // Multi-label agreement → more confidence
  if (labels.length >= 2) conf += 0.1;
  // Longer body → more information → higher confidence
  if (text.length > 200) conf += 0.1;
  if (text.length > 500) conf += 0.05;
  // P3 with single label → low signal
  if (priority === "P3" && labels.length <= 1) conf -= 0.05;
  return Math.min(0.75, Math.max(0.25, conf));
}

// ────────────────────────────────────────────────────────
// Repo file matching
// ────────────────────────────────────────────────────────

async function findRelevantFiles(issueText: string, projectRoot: string): Promise<string[]> {
  try {
    const words = new Set(
      issueText
        .toLowerCase()
        .split(/\W+/)
        .filter((w) => w.length > 3),
    );
    const ranked = await buildRepoMap(projectRoot, {});
    return ranked
      .filter((f) => {
        const fname = f.filePath.toLowerCase();
        return [...words].some((w) => fname.includes(w));
      })
      .slice(0, 5)
      .map((f) => f.filePath);
  } catch (err) {
    if (process.env["DANTECODE_DEBUG"]) {
      process.stderr.write(
        `[triage] buildRepoMap failed: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
    return [];
  }
}

// ────────────────────────────────────────────────────────
// LLM refinement
// ────────────────────────────────────────────────────────

function buildTriagePrompt(issue: GitHubIssue, relevantFiles: string[]): string {
  const filesSection =
    relevantFiles.length > 0
      ? `\nPossibly related files:\n${relevantFiles
          .slice(0, 5)
          .map((f) => `- ${f}`)
          .join("\n")}`
      : "";
  return (
    `You are a GitHub issue triage expert. Classify the issue using these definitions:\n\n` +
    `PRIORITY: P0=Security/data-loss/total failure | P1=Blocking bug | P2=Feature or enhancement | P3=Docs/polish\n` +
    `EFFORT: S=<30min | M=1-4hrs | L=1-2days | XL=>2days\n` +
    `VALID LABELS: bug, feature, enhancement, documentation, security, test, good-first-issue\n\n` +
    `Examples:\n` +
    `{"labels":["bug"],"priority":"P0","effort":"L","canAutoResolve":false,"confidence":0.95,"reasoning":"SQL injection in auth — security critical"}\n` +
    `{"labels":["documentation"],"priority":"P3","effort":"S","canAutoResolve":true,"confidence":0.99,"reasoning":"README typo fix"}\n` +
    `{"labels":["feature"],"priority":"P2","effort":"M","canAutoResolve":false,"confidence":0.80,"reasoning":"Dark mode — new feature, moderate effort"}\n\n` +
    `Issue #${issue.number}: ${issue.title}\n\n` +
    `${(issue.body || "(no description)").slice(0, 1000)}${filesSection}\n\n` +
    `Return ONLY valid JSON matching the example shape. No markdown, no explanation.`
  );
}

function parseTriageLLMOutput(
  output: string,
  fallback: Omit<TriageResult, "relevantFiles" | "postedToGitHub">,
): Partial<Omit<TriageResult, "relevantFiles" | "postedToGitHub">> {
  try {
    const jsonMatch = /\{[\s\S]*\}/.exec(output);
    if (!jsonMatch) return {};
    const parsed = JSON.parse(jsonMatch[0]) as {
      labels?: string[];
      priority?: string;
      effort?: string;
      canAutoResolve?: boolean;
      confidence?: number;
      reasoning?: string;
    };
    const validPriorities: Priority[] = ["P0", "P1", "P2", "P3"];
    const validEfforts: Effort[] = ["S", "M", "L", "XL"];
    return {
      suggestedLabels: Array.isArray(parsed.labels) ? parsed.labels : fallback.suggestedLabels,
      priority: validPriorities.includes(parsed.priority as Priority)
        ? (parsed.priority as Priority)
        : fallback.priority,
      effort: validEfforts.includes(parsed.effort as Effort)
        ? (parsed.effort as Effort)
        : fallback.effort,
      canAutoResolve:
        typeof parsed.canAutoResolve === "boolean"
          ? parsed.canAutoResolve
          : fallback.canAutoResolve,
      confidence:
        typeof parsed.confidence === "number"
          ? Math.min(1, Math.max(0, parsed.confidence))
          : fallback.confidence,
      reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : fallback.reasoning,
    };
  } catch {
    return {};
  }
}

// ────────────────────────────────────────────────────────
// Core triage logic
// ────────────────────────────────────────────────────────

/**
 * Triage a GitHub issue: classify labels, priority, effort, and relevant files.
 * Uses heuristic classification always; optionally refines with LLM.
 */
export async function triageIssue(
  issueNumber: number,
  projectRoot: string,
  options: TriageOptions = {},
): Promise<TriageResult> {
  const token = options.token ?? process.env["GITHUB_TOKEN"] ?? process.env["GH_TOKEN"] ?? "";

  const client = new GitHubClient({ token });
  await client.inferFromGitRemote(projectRoot);
  const issue = await client.getIssue(issueNumber);

  // Step 1: Heuristic triage (always runs)
  const heuristic = heuristicTriage(issue);

  // Step 2: Find relevant files
  const relevantFiles = await findRelevantFiles(issue.title + " " + issue.body, projectRoot);

  // Step 3: LLM refinement (optional, graceful fallback)
  let finalFields: Omit<TriageResult, "relevantFiles" | "postedToGitHub"> = heuristic;

  if (options.useLLM !== false) {
    try {
      const state = await readOrInitializeState(projectRoot);
      const router = new ModelRouterImpl(
        {
          default: state.model.default,
          fallback: state.model.fallback,
          overrides: {},
        },
        projectRoot,
        "triage-llm",
      );
      const prompt = buildTriagePrompt(issue, relevantFiles);
      const llmOutput = await router.generate([{ role: "user" as const, content: prompt }], {
        maxTokens: 600,
      });
      const refined = parseTriageLLMOutput(llmOutput, heuristic);
      finalFields = { ...heuristic, ...refined };
    } catch (err) {
      if (process.env["DANTECODE_DEBUG"]) {
        process.stderr.write(
          `[triage] LLM refinement failed, using heuristic: ${err instanceof Error ? err.message : String(err)}\n`,
        );
      }
    }
  }

  // Step 4: Apply labels if requested
  let postedToGitHub = false;
  if (options.postLabels && finalFields.suggestedLabels.length > 0) {
    try {
      await client.addLabels(issueNumber, finalFields.suggestedLabels);
      postedToGitHub = true;
    } catch {
      // Label application failure is non-fatal
    }
  }

  return { ...finalFields, relevantFiles, postedToGitHub };
}

// ────────────────────────────────────────────────────────
// Formatters
// ────────────────────────────────────────────────────────

const PRIORITY_COLOR: Record<Priority, string> = {
  P0: RED,
  P1: YELLOW,
  P2: CYAN,
  P3: DIM,
};

const EFFORT_LABEL: Record<Effort, string> = {
  S: "Small",
  M: "Medium",
  L: "Large",
  XL: "Extra Large",
};

/** ANSI-colored CLI output for triage result. */
export function formatTriageOutput(result: TriageResult): string {
  const pColor = PRIORITY_COLOR[result.priority];
  const lines: string[] = [
    ``,
    `${BOLD}DanteTriage — Issue #${result.issueNumber}${RESET}`,
    `  ${DIM}${result.title}${RESET}`,
    `  Priority:   ${pColor}${BOLD}${result.priority}${RESET}`,
    `  Effort:     ${CYAN}${result.effort}${RESET} (${EFFORT_LABEL[result.effort]})`,
    `  Confidence: ${(result.confidence * 100).toFixed(0)}%`,
    `  Auto-resolve: ${result.canAutoResolve ? `${GREEN}Yes${RESET}` : `${DIM}No${RESET}`}`,
  ];

  if (result.suggestedLabels.length > 0) {
    lines.push(
      `  Labels:     ${result.suggestedLabels.map((l) => `${CYAN}[${l}]${RESET}`).join(" ")}`,
    );
  }

  if (result.relevantFiles.length > 0) {
    lines.push(``, `${BOLD}Relevant Files:${RESET}`);
    for (const f of result.relevantFiles) {
      lines.push(`  ${DIM}${f}${RESET}`);
    }
  }

  if (result.reasoning) {
    lines.push(``, `${DIM}${result.reasoning}${RESET}`);
  }

  if (result.postedToGitHub) {
    lines.push(``, `${GREEN}Labels applied to GitHub issue.${RESET}`);
  } else if (result.suggestedLabels.length > 0) {
    lines.push(``, `${DIM}Use --post-labels to apply labels to GitHub.${RESET}`);
  }

  return lines.join("\n");
}

// ────────────────────────────────────────────────────────
// CLI entry point
// ────────────────────────────────────────────────────────

function printTriageHelp(): void {
  console.log(
    [
      ``,
      `${BOLD}dantecode triage${RESET} — model-assisted GitHub issue triage`,
      ``,
      `  ${CYAN}dantecode triage <issue#>${RESET}`,
      `      Analyze issue (heuristics + LLM when available)`,
      ``,
      `  ${CYAN}dantecode triage <issue#> --post-labels${RESET}`,
      `      Analyze and apply suggested labels via GitHub API`,
      ``,
      `  ${CYAN}dantecode triage <issue#> --no-llm${RESET}`,
      `      Heuristic-only classification (fast, no API calls)`,
      ``,
      `  Requires ${CYAN}GITHUB_TOKEN${RESET} environment variable.`,
      ``,
    ].join("\n"),
  );
}

export async function runTriageCommand(args: string[], projectRoot: string): Promise<void> {
  const sub = args[0];

  if (!sub || sub === "--help" || sub === "-h") {
    printTriageHelp();
    return;
  }

  const issueNumber = parseInt(sub, 10);
  if (isNaN(issueNumber) || issueNumber <= 0) {
    console.error(`${RED}Error: Issue number must be a positive integer, got: "${sub}"${RESET}`);
    console.error(`${DIM}Usage: dantecode triage <issue#> [--post-labels] [--no-llm]${RESET}`);
    return;
  }

  const postLabels = args.includes("--post-labels");
  const useLLM = !args.includes("--no-llm");

  console.log(`\n${DIM}Fetching issue #${issueNumber}...${RESET}`);

  try {
    const result = await triageIssue(issueNumber, projectRoot, {
      postLabels,
      useLLM,
    });
    console.log(formatTriageOutput(result));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${RED}Triage error: ${msg}${RESET}`);
  }
}
