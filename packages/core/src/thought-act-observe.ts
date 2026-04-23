// packages/core/src/thought-act-observe.ts
// Thought-Act-Observe (TAO) loop — deepens dim 15 (agent autonomy: 9→9.5).
//
// Harvested from: SWE-agent ACI (Agent-Computer Interface) pattern,
//                 OpenHands CodeAct interpreter, ReAct prompting.
//
// Provides:
//   - Structured TAO cycle: Thought (reasoning) → Act (tool/code) → Observe (result)
//   - Observation history: structured record of all TAO cycles
//   - Strategy adaptation: detects failure patterns and shifts strategy
//   - Loop termination: success signal, max steps, repeated failure, stuck detection
//   - Bash-first tool execution: structured command + output recording
//   - Prompt formatting: full TAO history for model injection

// ─── Types ────────────────────────────────────────────────────────────────────

export type ActionKind =
  | "bash"        // Execute shell command
  | "write"       // Write file
  | "read"        // Read file
  | "edit"        // Edit file
  | "search"      // Search codebase
  | "browse"      // Browse URL
  | "think"       // Internal reasoning step (no external action)
  | "finish";     // Signal task completion

export type ObservationStatus =
  | "success"       // Action succeeded
  | "failure"       // Action failed with error
  | "partial"       // Partial success (e.g. command ran but with warnings)
  | "timeout"       // Action timed out
  | "skipped";      // Action was skipped

export type TerminationReason =
  | "success"           // Task completed successfully
  | "max-steps"         // Reached step limit
  | "repeated-failure"  // Same failure 3+ times
  | "stuck"             // No progress after N steps
  | "user-stop"         // Manually terminated
  | "error";            // Unrecoverable error

export type TaoStrategy =
  | "direct"            // Attempt task directly
  | "decompose"         // Break into sub-tasks first
  | "explore-first"     // Read/search before acting
  | "test-driven"       // Write tests first, then implementation
  | "defensive";        // Validate each step before proceeding

export interface ThoughtStep {
  content: string;
  /** Current strategy being applied */
  strategy: TaoStrategy;
  /** Confidence in the current approach (0–1) */
  confidence: number;
  /** Whether this thought identifies a new sub-goal */
  newSubGoal?: string;
}

export interface ActionStep {
  kind: ActionKind;
  /** Command, file path, search query, or URL depending on kind */
  target: string;
  /** Content for write/edit actions */
  content?: string;
  /** Parameters for bash/search */
  params?: Record<string, unknown>;
}

export interface ObservationStep {
  status: ObservationStatus;
  /** Raw output from the action */
  output: string;
  /** Structured result if parseable */
  structuredResult?: Record<string, unknown>;
  /** Error message if failed */
  errorMessage?: string;
  /** Whether the observation suggests task completion */
  isCompletionSignal: boolean;
}

export interface TaoCycle {
  stepIndex: number;
  thought: ThoughtStep;
  action: ActionStep;
  observation: ObservationStep;
  durationMs: number;
  /** ISO timestamp */
  timestamp: string;
}

export interface TaoLoopResult {
  cycles: TaoCycle[];
  terminationReason: TerminationReason;
  /** Whether the task was completed successfully */
  success: boolean;
  totalSteps: number;
  totalDurationMs: number;
  /** Final strategy that led to success/failure */
  finalStrategy: TaoStrategy;
}

// ─── Completion Signal Detection ──────────────────────────────────────────────

const SUCCESS_SIGNALS = [
  /\ball (tests|test suite) pass/i,
  /\btask (complete|done|finished)\b/i,
  /\bsuccessfully (created|updated|fixed|implemented)\b/i,
  /exit code[:\s]+0/i,
  /\bno errors\b/i,
];

const FAILURE_SIGNALS = [
  /\bsyntaxerror\b/i,
  /\btypeerror\b/i,
  /\bcommand not found\b/i,
  /\bpermission denied\b/i,
  /error ts\d+:/i,
  /\bfailed with exit code [^0]/i,
];

export function detectCompletionSignal(output: string): boolean {
  return SUCCESS_SIGNALS.some((re) => re.test(output));
}

export function detectFailureSignal(output: string): boolean {
  return FAILURE_SIGNALS.some((re) => re.test(output));
}

export function classifyObservationStatus(output: string, errorMessage?: string): ObservationStatus {
  if (errorMessage) return "failure";
  if (detectCompletionSignal(output)) return "success";
  if (detectFailureSignal(output)) return "failure";
  if (output.length === 0) return "partial";
  return "success";
}

// ─── Strategy Adapter ─────────────────────────────────────────────────────────

const STRATEGY_SEQUENCE: TaoStrategy[] = [
  "direct",
  "explore-first",
  "decompose",
  "test-driven",
  "defensive",
];

/**
 * Suggest next strategy based on failure history.
 * Returns the current strategy if not stuck.
 */
export function adaptStrategy(
  currentStrategy: TaoStrategy,
  recentFailures: number,
  consecutiveStuck: number,
): TaoStrategy {
  if (recentFailures < 2 && consecutiveStuck < 3) return currentStrategy;

  const currentIdx = STRATEGY_SEQUENCE.indexOf(currentStrategy);
  const nextIdx = Math.min(currentIdx + 1, STRATEGY_SEQUENCE.length - 1);
  return STRATEGY_SEQUENCE[nextIdx]!;
}

// ─── Stuck Detection ──────────────────────────────────────────────────────────

/**
 * Detect if the loop is stuck (same action/output repeated).
 */
export function isStuck(cycles: TaoCycle[], windowSize = 3): boolean {
  if (cycles.length < windowSize) return false;

  const recent = cycles.slice(-windowSize);
  const firstTarget = recent[0]!.action.target;
  const firstOutput = recent[0]!.observation.output.slice(0, 100);

  return recent.every(
    (c) => c.action.target === firstTarget && c.observation.output.slice(0, 100) === firstOutput
  );
}

// ─── TAO Cycle Builder ────────────────────────────────────────────────────────

export function buildTaoCycle(
  stepIndex: number,
  thought: ThoughtStep,
  action: ActionStep,
  observation: ObservationStep,
  durationMs: number,
): TaoCycle {
  return {
    stepIndex,
    thought,
    action,
    observation,
    durationMs,
    timestamp: new Date().toISOString(),
  };
}

// ─── TAO Loop Manager ─────────────────────────────────────────────────────────

export class TaoLoopManager {
  private _cycles: TaoCycle[] = [];
  private _currentStrategy: TaoStrategy = "direct";
  private _startTime = Date.now();
  private _terminated = false;
  private _terminationReason?: TerminationReason;

  constructor(
    private readonly _maxSteps = 30,
    initialStrategy: TaoStrategy = "direct",
  ) {
    this._currentStrategy = initialStrategy;
  }

  /**
   * Record a completed TAO cycle.
   * Returns termination decision (reason, or undefined to continue).
   */
  recordCycle(cycle: TaoCycle): TerminationReason | undefined {
    this._cycles.push(cycle);

    // Check success
    if (cycle.action.kind === "finish" || cycle.observation.isCompletionSignal) {
      return this._terminate("success");
    }

    // Check max steps
    if (this._cycles.length >= this._maxSteps) {
      return this._terminate("max-steps");
    }

    // Check stuck
    if (isStuck(this._cycles, 3)) {
      return this._terminate("stuck");
    }

    // Check repeated failures
    const recentFailures = this._cycles.slice(-5).filter((c) =>
      c.observation.status === "failure"
    ).length;
    if (recentFailures >= 3) {
      return this._terminate("repeated-failure");
    }

    // Adapt strategy
    const consecutiveStuck = this._consecutiveUnchangedTargets();
    this._currentStrategy = adaptStrategy(this._currentStrategy, recentFailures, consecutiveStuck);

    return undefined; // continue
  }

  private _terminate(reason: TerminationReason): TerminationReason {
    this._terminated = true;
    this._terminationReason = reason;
    return reason;
  }

  private _consecutiveUnchangedTargets(): number {
    let count = 0;
    for (let i = this._cycles.length - 1; i > 0; i--) {
      if (this._cycles[i]!.action.target === this._cycles[i - 1]!.action.target) count++;
      else break;
    }
    return count;
  }

  buildResult(): TaoLoopResult {
    const terminationReason = this._terminationReason ?? "error";
    return {
      cycles: [...this._cycles],
      terminationReason,
      success: terminationReason === "success",
      totalSteps: this._cycles.length,
      totalDurationMs: Date.now() - this._startTime,
      finalStrategy: this._currentStrategy,
    };
  }

  forceStop(reason: TerminationReason = "user-stop"): void {
    this._terminate(reason);
  }

  get currentStrategy(): TaoStrategy { return this._currentStrategy; }
  get stepCount(): number { return this._cycles.length; }
  get isTerminated(): boolean { return this._terminated; }
  get cycles(): TaoCycle[] { return [...this._cycles]; }

  /**
   * Format the full TAO history for model context injection.
   */
  formatForPrompt(maxCycles?: number): string {
    const cycles = maxCycles ? this._cycles.slice(-maxCycles) : this._cycles;
    const lines: string[] = [
      `## Thought-Act-Observe History (${this._cycles.length} steps, strategy: ${this._currentStrategy})`,
    ];

    for (const cycle of cycles) {
      lines.push(`\n### Step ${cycle.stepIndex + 1}`);
      lines.push(`**Thought:** ${cycle.thought.content}`);
      lines.push(`**Act:** \`${cycle.action.kind}\` → ${cycle.action.target}`);
      const statusIcon = { success: "✅", failure: "❌", partial: "⚠️", timeout: "⏱️", skipped: "⏭️" }[cycle.observation.status];
      lines.push(`**Observe:** ${statusIcon} ${cycle.observation.output.slice(0, 200)}`);
      if (cycle.observation.errorMessage) {
        lines.push(`  Error: ${cycle.observation.errorMessage}`);
      }
    }

    if (this._terminated) {
      lines.push(`\n**Loop ended:** ${this._terminationReason}`);
    }

    return lines.join("\n");
  }

  /**
   * Get a structured summary of what the loop accomplished.
   */
  summarize(): {
    stepsCompleted: number;
    filesModified: string[];
    commandsRun: string[];
    errors: string[];
    strategy: TaoStrategy;
  } {
    const filesModified = this._cycles
      .filter((c) => c.action.kind === "write" || c.action.kind === "edit")
      .map((c) => c.action.target);

    const commandsRun = this._cycles
      .filter((c) => c.action.kind === "bash")
      .map((c) => c.action.target);

    const errors = this._cycles
      .filter((c) => c.observation.status === "failure")
      .map((c) => c.observation.errorMessage ?? c.observation.output.slice(0, 100));

    return {
      stepsCompleted: this._cycles.length,
      filesModified: [...new Set(filesModified)],
      commandsRun: [...new Set(commandsRun)],
      errors: [...new Set(errors)],
      strategy: this._currentStrategy,
    };
  }
}
