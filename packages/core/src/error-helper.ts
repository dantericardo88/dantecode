/**
 * error-helper.ts
 *
 * Actionable error classification and rich formatting for DanteCode.
 * Inspired by Aider's delightful error UX and Continue's contextual hints.
 *
 * Classifies common error types (TypeScript, ESLint, test, API, git, network)
 * and surfaces specific next-step suggestions + PDSE hints.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ErrorKind =
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

export interface ErrorAnalysis {
  kind: ErrorKind;
  /** Short human-readable title. */
  title: string;
  /** Original error message. */
  message: string;
  /** Specific actionable fix suggestions (1–3). */
  suggestions: string[];
  /** PDSE gate hint if relevant. */
  pdseHint?: string;
  /** Whether this error is likely transient (retry may help). */
  transient: boolean;
}

export interface FormatOptions {
  /** Include ANSI colors. Default: true. */
  colors?: boolean;
  /** Show verbose context (full trace). Default: false. */
  verbose?: boolean;
}

// ---------------------------------------------------------------------------
// Error patterns
// ---------------------------------------------------------------------------

interface ErrorPattern {
  kind: ErrorKind;
  title: string;
  match: RegExp[];
  suggestions: string[];
  pdseHint?: string;
  transient?: boolean;
}

const ERROR_PATTERNS: ErrorPattern[] = [
  {
    kind: "typescript",
    title: "TypeScript Error",
    match: [/TS\d{4}:/, /error TS/, /Type '.*' is not assignable/, /Cannot find (module|name)/],
    suggestions: [
      "Run `npm run typecheck` to see all type errors at once.",
      "Check imports — a missing type export is the most common cause.",
      "Use `// @ts-expect-error` as a last resort if this is intentional.",
    ],
    pdseHint:
      "TypeScript errors block the PDSE quality gate. Fix all TS errors before running /verify.",
    transient: false,
  },
  {
    kind: "eslint",
    title: "ESLint Lint Error",
    match: [/ESLint/, /eslint/, /Parsing error:/, /no-unused-vars/, /prefer-const/],
    suggestions: [
      "Run `npm run lint --fix` to auto-fix many ESLint issues.",
      "Add the specific rule to `.eslintrc` overrides if it's a false positive.",
      "Use `// eslint-disable-next-line` for intentional exceptions.",
    ],
    transient: false,
  },
  {
    kind: "test",
    title: "Test Failure",
    match: [/AssertionError/, /expected .* to equal/, /FAIL /, /✗ /, /× /, /test.*failed/i],
    suggestions: [
      "Run the single failing test with `vitest run --reporter verbose <pattern>`.",
      "Check the diff between expected and received — often an interface change.",
      "Ensure mocks are reset between tests (check `beforeEach` / `vi.clearAllMocks`).",
    ],
    pdseHint: "Test failures lower the PDSE correctness score. Fix before merging.",
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
    suggestions: [
      "Check your API key is set correctly (e.g. ANTHROPIC_API_KEY, XAI_API_KEY).",
      "If you hit rate limits, wait 60s or switch to a lower-tier model with /model.",
      "Run `dantecode config show` to verify which provider is active.",
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
    suggestions: [
      "Run `git status` to see what's happening in your working tree.",
      "For merge conflicts: resolve manually, then `git add` + `git commit`.",
      "For push rejections: `git pull --rebase` before pushing.",
    ],
    transient: false,
  },
  {
    kind: "network",
    title: "Network Error",
    match: [/ECONNREFUSED/, /ETIMEDOUT/, /ENOTFOUND/, /fetch failed/, /network.*error/i],
    suggestions: [
      "Check your internet connection and try again.",
      "If using a proxy, ensure HTTP_PROXY/HTTPS_PROXY are configured.",
      "Try the same operation with --verbose to see the full request.",
    ],
    transient: true,
  },
  {
    kind: "permission",
    title: "Permission Denied",
    match: [/EACCES/, /Permission denied/, /EPERM/],
    suggestions: [
      "Check file/directory ownership with `ls -la`.",
      "Avoid running with sudo — fix permissions on the target path instead.",
      "On Windows, close editors that may have a file lock.",
    ],
    transient: false,
  },
  {
    kind: "not_found",
    title: "File / Module Not Found",
    match: [/ENOENT/, /Cannot find module/, /Module not found/, /No such file/],
    suggestions: [
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
    suggestions: [
      "Increase the timeout setting if this is a known slow operation.",
      "Check if the target service is responsive with a quick curl/ping.",
      "For CI environments, consider caching dependencies to speed up builds.",
    ],
    transient: true,
  },
];

// ---------------------------------------------------------------------------
// ErrorHelper
// ---------------------------------------------------------------------------

export class ErrorHelper {
  private readonly useColors: boolean;

  constructor(options: FormatOptions = {}) {
    this.useColors = options.colors ?? true;
  }

  /**
   * Classify an error message and return a structured analysis.
   */
  classify(message: string): ErrorAnalysis {
    for (const pattern of ERROR_PATTERNS) {
      if (pattern.match.some((re) => re.test(message))) {
        return {
          kind: pattern.kind,
          title: pattern.title,
          message,
          suggestions: pattern.suggestions,
          pdseHint: pattern.pdseHint,
          transient: pattern.transient ?? false,
        };
      }
    }

    return {
      kind: "unknown",
      title: "Unexpected Error",
      message,
      suggestions: [
        "Run with --verbose to capture the full stack trace.",
        "Check .danteforge/vitest-error.txt or recent log files for context.",
        "If this is recurring, run /debug for systematic root-cause analysis.",
      ],
      transient: false,
    };
  }

  /**
   * Format an error into a rich, actionable terminal string.
   */
  format(messageOrAnalysis: string | ErrorAnalysis, opts: FormatOptions = {}): string {
    const colors = opts.colors ?? this.useColors;
    const analysis =
      typeof messageOrAnalysis === "string" ? this.classify(messageOrAnalysis) : messageOrAnalysis;

    const RED = colors ? "\x1b[31m" : "";
    const YELLOW = colors ? "\x1b[33m" : "";
    const CYAN = colors ? "\x1b[36m" : "";
    const BOLD = colors ? "\x1b[1m" : "";
    const DIM = colors ? "\x1b[2m" : "";
    const RESET = colors ? "\x1b[0m" : "";

    const transientBadge = analysis.transient
      ? ` ${YELLOW}[transient — retry may help]${RESET}`
      : "";

    const lines: string[] = [
      `${RED}${BOLD}✗ ${analysis.title}${RESET}${transientBadge}`,
      `${DIM}${analysis.message}${RESET}`,
      "",
      `${BOLD}Next steps:${RESET}`,
      ...analysis.suggestions.map((s, i) => `  ${CYAN}${i + 1}.${RESET} ${s}`),
    ];

    if (analysis.pdseHint) {
      lines.push("", `${YELLOW}PDSE hint:${RESET} ${analysis.pdseHint}`);
    }

    return lines.join("\n");
  }

  /**
   * Classify and format in one call. Convenience wrapper.
   */
  formatError(message: string, opts: FormatOptions = {}): string {
    return this.format(this.classify(message), opts);
  }

  /**
   * Return just the suggestions for a given error message.
   */
  getSuggestions(message: string): string[] {
    return this.classify(message).suggestions;
  }

  /**
   * Whether the error kind is typically transient.
   */
  isTransient(message: string): boolean {
    return this.classify(message).transient;
  }
}

/** Singleton helper with default options (colors on). */
export const errorHelper = new ErrorHelper();
