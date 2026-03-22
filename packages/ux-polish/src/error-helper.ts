/**
 * error-helper.ts — @dantecode/ux-polish
 *
 * Actionable error formatting and classification for the shared UX engine.
 * Implements the PRD ErrorHelpResult contract with classification,
 * rich formatting, PDSE hints, and recovery guidance.
 */

import type { ErrorHelpResult, ErrorContext } from "./types.js";
import { ThemeEngine } from "./theme-engine.js";

// ---------------------------------------------------------------------------
// Error pattern classification
// ---------------------------------------------------------------------------

type ErrorKind =
  | "typescript"
  | "eslint"
  | "test"
  | "api"
  | "git"
  | "network"
  | "permission"
  | "not_found"
  | "timeout"
  | "unknown";

interface ErrorPattern {
  kind: ErrorKind;
  title: string;
  match: RegExp[];
  nextSteps: string[];
  confidenceHint?: string;
  transient?: boolean;
}

const ERROR_PATTERNS: ErrorPattern[] = [
  {
    kind: "typescript",
    title: "TypeScript Error",
    match: [/TS\d{4}:/, /error TS/, /Type '.*' is not assignable/, /Cannot find (module|name)/],
    nextSteps: [
      "Run `npm run typecheck` to see all type errors at once.",
      "Check imports — a missing type export is the most common cause.",
      "Use `// @ts-expect-error` only as a last resort for intentional casts.",
    ],
    confidenceHint: "TypeScript errors block the PDSE quality gate — fix before /verify.",
    transient: false,
  },
  {
    kind: "eslint",
    title: "ESLint Lint Error",
    match: [/ESLint/, /eslint/, /Parsing error:/, /no-unused-vars/, /prefer-const/],
    nextSteps: [
      "Run `npm run lint --fix` to auto-fix many ESLint issues.",
      "Add the rule to `.eslintrc` overrides for confirmed false positives.",
      "Use `// eslint-disable-next-line` for intentional exceptions.",
    ],
    transient: false,
  },
  {
    kind: "test",
    title: "Test Failure",
    match: [/AssertionError/, /expected .* to equal/, /FAIL /, /✗ /, /× /, /test.*failed/i],
    nextSteps: [
      "Run the failing test with `vitest run --reporter verbose <pattern>`.",
      "Check the diff between expected and received — often an interface change.",
      "Ensure mocks are reset between tests (check `beforeEach` / `vi.clearAllMocks`).",
    ],
    confidenceHint: "Test failures lower the PDSE correctness score. Fix before merging.",
    transient: false,
  },
  {
    kind: "api",
    title: "API / LLM Error",
    match: [
      /401.*Unauthorized/,
      /403.*Forbidden/,
      /429.*rate.?limit/i,
      /API key/i,
      /invalid_api_key/,
      /insufficient_quota/,
    ],
    nextSteps: [
      "Check your API key is set correctly (ANTHROPIC_API_KEY, XAI_API_KEY, etc.).",
      "If you hit rate limits, wait 60s or switch models with /model.",
      "Run `dantecode config show` to verify the active provider.",
    ],
    transient: true,
  },
  {
    kind: "git",
    title: "Git Error",
    match: [
      /fatal: not a git repository/,
      /nothing to commit/,
      /merge conflict/i,
      /rejected.*remote/,
      /CONFLICT/,
    ],
    nextSteps: [
      "Run `git status` to inspect your working tree.",
      "For merge conflicts: resolve manually, then `git add` + `git commit`.",
      "For push rejections: `git pull --rebase` before pushing.",
    ],
    transient: false,
  },
  {
    kind: "network",
    title: "Network Error",
    match: [/ECONNREFUSED/, /ETIMEDOUT/, /ENOTFOUND/, /fetch failed/, /network.*error/i],
    nextSteps: [
      "Check your internet connection and retry.",
      "If using a proxy, ensure HTTP_PROXY/HTTPS_PROXY are configured.",
      "Try with --verbose to see the full request details.",
    ],
    transient: true,
  },
  {
    kind: "permission",
    title: "Permission Denied",
    match: [/EACCES/, /Permission denied/, /EPERM/],
    nextSteps: [
      "Check file/directory ownership with `ls -la`.",
      "Avoid running with sudo — fix permissions on the target path instead.",
      "On Windows, close editors that may hold a file lock.",
    ],
    transient: false,
  },
  {
    kind: "not_found",
    title: "File / Module Not Found",
    match: [/ENOENT/, /Cannot find module/, /Module not found/, /No such file/],
    nextSteps: [
      "Check the import path — TypeScript paths and file extensions matter.",
      "Run `npm install` if a node_modules dependency is missing.",
      "If a build artifact is missing, run `npm run build` first.",
    ],
    transient: false,
  },
  {
    kind: "timeout",
    title: "Operation Timeout",
    match: [/timed? out/i, /ETIMEDOUT/, /timeout exceeded/i],
    nextSteps: [
      "Increase the timeout setting if this is a known slow operation.",
      "Check if the target service is responsive.",
      "For CI, consider caching dependencies to speed up builds.",
    ],
    transient: true,
  },
];

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

function _classify(message: string, ctx?: ErrorContext): ErrorHelpResult {
  for (const pat of ERROR_PATTERNS) {
    if (pat.match.some((re) => re.test(message))) {
      const hint = _buildConfidenceHint(pat.confidenceHint, ctx);
      return {
        title: pat.title,
        explanation: message,
        nextSteps: pat.nextSteps,
        confidenceHint: hint,
        transient: pat.transient ?? false,
      };
    }
  }

  return {
    title: "Unexpected Error",
    explanation: message,
    nextSteps: [
      "Run with --verbose to capture the full stack trace.",
      "Check recent log files in .dantecode/ for context.",
      "Use /debug for systematic root-cause analysis.",
    ],
    transient: false,
  };
}

function _buildConfidenceHint(base?: string, ctx?: ErrorContext): string | undefined {
  if (!ctx?.pdseScore && !base) return undefined;
  const parts: string[] = [];
  if (base) parts.push(base);
  if (ctx?.pdseScore !== undefined) {
    const score = ctx.pdseScore;
    if (score < 0.5) parts.push(`PDSE score ${score.toFixed(2)} — critical quality gate failure.`);
    else if (score < 0.8)
      parts.push(`PDSE score ${score.toFixed(2)} — improvement needed before /ship.`);
  }
  return parts.length ? parts.join(" ") : undefined;
}

// ---------------------------------------------------------------------------
// ErrorHelper
// ---------------------------------------------------------------------------

export interface ErrorHelperOptions {
  theme?: ThemeEngine;
  colors?: boolean;
}

export class ErrorHelper {
  private readonly _engine: ThemeEngine;

  constructor(options: ErrorHelperOptions = {}) {
    const engine = options.theme ?? new ThemeEngine();
    if (typeof options.colors === "boolean") engine.setColors(options.colors);
    this._engine = engine;
  }

  /** Classify an error message into a structured ErrorHelpResult. */
  classify(message: string, ctx?: ErrorContext): ErrorHelpResult {
    return _classify(message, ctx);
  }

  /** Format an error result as a rich CLI string. */
  format(result: ErrorHelpResult): string {
    const e = this._engine;
    const icons = e.icons();
    const transientBadge = result.transient ? ` ${e.warning("[transient — retry may help]")}` : "";

    const lines: string[] = [
      `${e.error(`${icons.error} ${result.title}`)}${transientBadge}`,
      `${e.muted(result.explanation)}`,
      "",
      `${e.boldText("Next steps:")}`,
      ...result.nextSteps.map((s, i) => `  ${e.info(`${i + 1}.`)} ${s}`),
    ];

    if (result.confidenceHint) {
      lines.push("", `${e.warning("PDSE hint:")} ${result.confidenceHint}`);
    }

    return lines.join("\n");
  }

  /** Classify and format in one call. */
  formatError(message: string, ctx?: ErrorContext): string {
    return this.format(this.classify(message, ctx));
  }
}

// ---------------------------------------------------------------------------
// PRD public API
// ---------------------------------------------------------------------------

const _helper = new ErrorHelper();

/**
 * Format an error message into a structured, rich ErrorHelpResult string.
 */
export function formatHelpfulError(error: string | Error, context?: ErrorContext): string {
  const msg = error instanceof Error ? error.message : error;
  return _helper.formatError(msg, context);
}

/**
 * Classify an error into a structured ErrorHelpResult (without rendering).
 */
export function classifyErrorMessage(message: string, ctx?: ErrorContext): ErrorHelpResult {
  return _helper.classify(message, ctx);
}
