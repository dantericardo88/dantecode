/**
 * recovery-messenger.ts
 *
 * Graceful degradation and delightful recovery messages for DanteCode.
 * Inspired by OpenHands' session health indicators and Aider's recovery UX.
 *
 * Provides structured recovery guidance for common failure scenarios:
 * context window saturation, model switch, pipeline stall, rate limit,
 * partial completion, and session resume.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RecoveryScenario =
  | "context_saturated"
  | "model_rate_limited"
  | "pipeline_stalled"
  | "partial_completion"
  | "session_resume"
  | "typecheck_failed"
  | "test_failed"
  | "tool_blocked"
  | "model_confabulated"
  | "round_budget_exhausted";

export interface RecoveryMessage {
  scenario: RecoveryScenario;
  title: string;
  /** 1-sentence plain-English explanation of what happened. */
  explanation: string;
  /** Ordered list of recovery steps (most likely to fix first). */
  steps: string[];
  /** Slash command or action that directly addresses the issue, if any. */
  quickFix?: string;
  /** Whether the session can automatically recover (no human input needed). */
  autoRecoverable: boolean;
}

export interface RecoveryMessengerOptions {
  colors?: boolean;
}

// ---------------------------------------------------------------------------
// Recovery templates
// ---------------------------------------------------------------------------

const RECOVERY_TEMPLATES: Record<RecoveryScenario, Omit<RecoveryMessage, "scenario">> = {
  context_saturated: {
    title: "Context Window Full",
    explanation:
      "The conversation has grown too large for the model's context window — older messages are being truncated.",
    steps: [
      "Run /compact to summarize and trim the conversation history.",
      "Use /drop <file> to remove large files no longer needed.",
      "Start a new focused session for the remaining work.",
    ],
    quickFix: "/compact",
    autoRecoverable: true,
  },

  model_rate_limited: {
    title: "Model Rate Limited",
    explanation:
      "Your API key has hit the provider's rate limit — requests are being throttled.",
    steps: [
      "Wait 60 seconds and retry automatically.",
      "Switch to a lower-tier model with /model to bypass the limit.",
      "Check your API plan quota at the provider's dashboard.",
    ],
    quickFix: "/model",
    autoRecoverable: true,
  },

  pipeline_stalled: {
    title: "Pipeline Stalled",
    explanation:
      "The active pipeline (forge/magic/autoforge) stopped producing tool calls — the model may be confused or stuck.",
    steps: [
      "Type 'continue' or 'keep going' to nudge the model back into action.",
      "Check .danteforge/magic-session.json to resume from the last checkpoint.",
      "If stuck repeatedly, restart with a more focused prompt.",
    ],
    quickFix: "continue",
    autoRecoverable: false,
  },

  partial_completion: {
    title: "Partial Completion",
    explanation:
      "The task was only partially completed before the session ended or the budget ran out.",
    steps: [
      "Resume the pipeline with --resume flag or the /resume command.",
      "Run /verify to see what's passing and what still needs work.",
      "Inspect .danteforge/TASKS.md to pick up remaining tasks manually.",
    ],
    quickFix: "/verify",
    autoRecoverable: true,
  },

  session_resume: {
    title: "Resuming Previous Session",
    explanation:
      "A saved checkpoint was found — DanteCode is resuming from where it left off.",
    steps: [
      "Review .danteforge/STATE.yaml to confirm the correct checkpoint is loaded.",
      "Run /verify to validate the current state before continuing.",
      "If the state looks wrong, use /reset to start fresh.",
    ],
    quickFix: "/verify",
    autoRecoverable: true,
  },

  typecheck_failed: {
    title: "TypeScript Typecheck Failed",
    explanation:
      "The last code change introduced TypeScript type errors that must be resolved before proceeding.",
    steps: [
      "Run `npm run typecheck` to see the full list of errors.",
      "Fix each TS error — most are type mismatches or missing imports.",
      "Re-run /verify after fixing to confirm the PDSE gate passes.",
    ],
    quickFix: "/verify",
    autoRecoverable: false,
  },

  test_failed: {
    title: "Tests Failing",
    explanation:
      "One or more tests are failing after the last code change — the PDSE quality gate is blocked.",
    steps: [
      "Run `npx vitest run --reporter verbose` to see which tests fail.",
      "Check if a mock or interface changed — update the test first.",
      "Use /debug for systematic root-cause analysis if the fix isn't obvious.",
    ],
    quickFix: "/debug",
    autoRecoverable: false,
  },

  tool_blocked: {
    title: "Tool Call Blocked",
    explanation:
      "A tool call was blocked by the safety guard (e.g. destructive git command or force push in pipeline).",
    steps: [
      "Review the blocked command and confirm if it's intentional.",
      "If safe, run the command manually outside the pipeline.",
      "Update your TOOL SAFETY RULES if this is a recurring false positive.",
    ],
    autoRecoverable: false,
  },

  model_confabulated: {
    title: "Model Confabulation Detected",
    explanation:
      "The model claimed to make changes but no files were actually written — a confabulation pattern was detected.",
    steps: [
      "Ask the model to use Write/Edit tools explicitly: 'Please use the Write tool to create X'.",
      "Switch to a Claude model for more reliable tool use.",
      "Run `git status` to confirm actual file state before continuing.",
    ],
    quickFix: "/model",
    autoRecoverable: false,
  },

  round_budget_exhausted: {
    title: "Round Budget Exhausted",
    explanation:
      "The session reached its maximum round limit before completing all tasks.",
    steps: [
      "Type 'continue' to automatically extend the budget and keep going.",
      "If the work is mostly done, run /verify to check what's complete.",
      "For very large tasks, use /party to split work across parallel agents.",
    ],
    quickFix: "continue",
    autoRecoverable: true,
  },
};

// ---------------------------------------------------------------------------
// RecoveryMessenger
// ---------------------------------------------------------------------------

export class RecoveryMessenger {
  private readonly useColors: boolean;

  constructor(options: RecoveryMessengerOptions = {}) {
    this.useColors = options.colors ?? true;
  }

  /**
   * Get a structured recovery message for a given scenario.
   */
  getRecovery(scenario: RecoveryScenario): RecoveryMessage {
    return { scenario, ...RECOVERY_TEMPLATES[scenario] };
  }

  /**
   * Format a recovery message to a rich terminal string.
   */
  format(scenario: RecoveryScenario): string {
    const msg = this.getRecovery(scenario);
    return this._render(msg);
  }

  /**
   * Print the recovery message to stdout immediately.
   */
  print(scenario: RecoveryScenario): void {
    process.stdout.write("\n" + this.format(scenario) + "\n");
  }

  /**
   * Auto-detect a recovery scenario from an error message or status string.
   * Returns null if no scenario matches.
   */
  detect(text: string): RecoveryScenario | null {
    const t = text.toLowerCase();
    if (/context.*(full|limit|window|saturat)/i.test(t)) return "context_saturated";
    if (/rate.?limit|429|quota.?exceed/i.test(t)) return "model_rate_limited";
    if (/no.*tool.*call|summary.*response|pipeline.*stall/i.test(t)) return "pipeline_stalled";
    if (/tsc|type.*error|ts\d{4}/i.test(t)) return "typecheck_failed";
    if (/test.*fail|assertion.*error|vitest/i.test(t)) return "test_failed";
    if (/blocked|destructive|force.?push/i.test(t)) return "tool_blocked";
    if (/confab|0 files.*changed|nothing.*commit/i.test(t)) return "model_confabulated";
    if (/round.*budget|max.*round|round.*limit/i.test(t)) return "round_budget_exhausted";
    if (/partial|incomplete|stopped.*early/i.test(t)) return "partial_completion";
    return null;
  }

  /**
   * Detect and format a recovery message from raw error text.
   * Returns null if no scenario is recognized.
   */
  detectAndFormat(text: string): string | null {
    const scenario = this.detect(text);
    return scenario ? this.format(scenario) : null;
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private _render(msg: RecoveryMessage): string {
    const YELLOW = this.useColors ? "\x1b[33m" : "";
    const CYAN = this.useColors ? "\x1b[36m" : "";
    const GREEN = this.useColors ? "\x1b[32m" : "";
    const BOLD = this.useColors ? "\x1b[1m" : "";
    const DIM = this.useColors ? "\x1b[2m" : "";
    const RESET = this.useColors ? "\x1b[0m" : "";

    const autoTag = msg.autoRecoverable
      ? ` ${GREEN}[auto-recoverable]${RESET}`
      : ` ${DIM}[manual action needed]${RESET}`;

    const lines: string[] = [
      `${YELLOW}${BOLD}⚡ ${msg.title}${RESET}${autoTag}`,
      `${DIM}${msg.explanation}${RESET}`,
      "",
      `${BOLD}Recovery steps:${RESET}`,
      ...msg.steps.map((s, i) => `  ${CYAN}${i + 1}.${RESET} ${s}`),
    ];

    if (msg.quickFix) {
      lines.push("", `${BOLD}Quick fix:${RESET} ${GREEN}${msg.quickFix}${RESET}`);
    }

    return lines.join("\n");
  }
}

/** Singleton with default options. */
export const recoveryMessenger = new RecoveryMessenger();
