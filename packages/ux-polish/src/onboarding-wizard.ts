/**
 * onboarding-wizard.ts — @dantecode/ux-polish
 *
 * First-run onboarding wizard for DanteCode.
 * Guides new users through setup with interactive steps,
 * checkpoint/resume support, and guided recovery on failure.
 */

import type { OnboardingResult, OnboardingContext, OnboardingStep } from "./types.js";
import { OnboardingState } from "./preferences/onboarding-state.js";
import { ThemeEngine } from "./theme-engine.js";

// ---------------------------------------------------------------------------
// Default onboarding steps
// ---------------------------------------------------------------------------

const DEFAULT_STEPS: OnboardingStep[] = [
  {
    id: "env-check",
    title: "Environment Check",
    description: "Verify Node.js ≥18, git, and npm are available.",
    skippable: false,
  },
  {
    id: "api-key",
    title: "API Key Setup",
    description: "Set your ANTHROPIC_API_KEY (or configure an alternative provider).",
    skippable: false,
  },
  {
    id: "config-init",
    title: "Project Config",
    description: "Initialize .dantecode/config.json with sensible defaults.",
    skippable: true,
  },
  {
    id: "first-verify",
    title: "First Verify Run",
    description: "Run /verify to confirm the setup is healthy.",
    skippable: true,
  },
  {
    id: "explore",
    title: "Explore Commands",
    description: "Review available /commands and their PDSE gates.",
    skippable: true,
  },
];

// ---------------------------------------------------------------------------
// Step runner type (injectable for testing)
// ---------------------------------------------------------------------------

export type StepRunner = (step: OnboardingStep) => Promise<"completed" | "skipped" | "failed">;

// ---------------------------------------------------------------------------
// OnboardingWizard
// ---------------------------------------------------------------------------

export interface OnboardingWizardOptions {
  theme?: ThemeEngine;
  stepRunner?: StepRunner;
  stateOptions?: { projectRoot?: string; stateFilePath?: string };
}

export class OnboardingWizard {
  private readonly _engine: ThemeEngine;
  private readonly _stepRunner: StepRunner;
  private readonly _state: OnboardingState;

  constructor(options: OnboardingWizardOptions = {}) {
    this._engine = options.theme ?? new ThemeEngine();
    this._stepRunner = options.stepRunner ?? _defaultStepRunner;
    this._state = new OnboardingState(options.stateOptions ?? {});
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Run the onboarding wizard.
   * Resumes from the last completed step unless ctx.force is true.
   */
  async run(ctx: OnboardingContext = {}): Promise<OnboardingResult> {
    const steps = ctx.steps ?? DEFAULT_STEPS;

    // Already complete and not forced — short-circuit
    if (this._state.isComplete() && !ctx.force) {
      return {
        completed: true,
        stepsCompleted: this._state.getCompletedSteps(),
        nextSuggestedStep: undefined,
      };
    }

    // Force reset
    if (ctx.force) this._state.reset();

    this._banner();

    const completed: string[] = [...this._state.getCompletedSteps()];

    for (const step of steps) {
      // Skip already-done steps (resume behavior)
      if (this._state.isStepComplete(step.id)) {
        this._log(`  ${this._engine.muted(`[skipped — already done] ${step.title}`)}`);
        continue;
      }

      this._log(`\n  ${this._engine.boldText(step.title)}`);
      this._log(`  ${this._engine.muted(step.description)}`);

      if (ctx.ci && step.skippable) {
        this._state.markStepSkipped(step.id);
        this._log(`  ${this._engine.warning("Skipped (CI mode)")}`);
        continue;
      }

      let outcome: "completed" | "skipped" | "failed";
      try {
        outcome = await this._stepRunner(step);
      } catch {
        outcome = "failed";
      }

      if (outcome === "completed") {
        this._state.markStepComplete(step.id);
        completed.push(step.id);
        this._log(`  ${this._engine.success(`✓ ${step.title} complete`)}`);
      } else if (outcome === "skipped" && step.skippable) {
        this._state.markStepSkipped(step.id);
        this._log(`  ${this._engine.warning("Skipped")}`);
      } else if (outcome === "failed") {
        this._log(`  ${this._engine.error(`✗ ${step.title} failed`)}`);
        const nextStep = this._findNextStep(steps, step.id);
        return {
          completed: false,
          stepsCompleted: completed,
          nextSuggestedStep: nextStep
            ? `Retry: ${nextStep.title}`
            : "Run /debug to investigate the setup failure.",
        };
      }
    }

    // All steps done
    this._state.markComplete();
    this._log(`\n${this._engine.success("🚀 Onboarding complete! Run /magic to start building.")}`);

    return {
      completed: true,
      stepsCompleted: completed,
      nextSuggestedStep: "/magic — start your first development pipeline",
    };
  }

  // -------------------------------------------------------------------------
  // Status
  // -------------------------------------------------------------------------

  /** Check if onboarding was already completed. */
  isComplete(): boolean {
    return this._state.isComplete();
  }

  /** Get completed step IDs. */
  getCompletedSteps(): string[] {
    return this._state.getCompletedSteps();
  }

  /** Reset onboarding state. */
  reset(): void {
    this._state.reset();
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private _banner(): void {
    const e = this._engine;
    this._log(`\n${e.boldText("Welcome to DanteCode!")}`);
    this._log(`${e.muted("Let's get you set up in under 5 minutes.")}\n`);
  }

  private _findNextStep(steps: OnboardingStep[], failedId: string): OnboardingStep | undefined {
    const idx = steps.findIndex((s) => s.id === failedId);
    return idx >= 0 ? steps[idx] : undefined;
  }

  private _log(msg: string): void {
    // In CI or test environments, suppress output unless explicitly enabled
    if (typeof process !== "undefined" && process.env["DANTE_ONBOARDING_QUIET"]) return;
    console.log(msg);
  }
}

// ---------------------------------------------------------------------------
// Default step runner (headless — auto-passes all steps)
// ---------------------------------------------------------------------------

const _defaultStepRunner: StepRunner = async (step: OnboardingStep) => {
  // In non-interactive mode (no TTY or CI), auto-complete if not skippable,
  // or skip if skippable.
  const isTTY = typeof process !== "undefined" && process.stdout?.isTTY === true;
  if (!isTTY || process.env["CI"]) {
    return step.skippable ? "skipped" : "completed";
  }
  return "completed";
};

// ---------------------------------------------------------------------------
// PRD public API
// ---------------------------------------------------------------------------

let _wizard: OnboardingWizard | null = null;

/** Run the onboarding wizard with the shared default instance. */
export async function runOnboardingWizard(context?: OnboardingContext): Promise<OnboardingResult> {
  if (!_wizard) _wizard = new OnboardingWizard();
  return _wizard.run(context);
}

/** Reset the shared wizard instance (useful for tests). */
export function resetOnboardingWizard(): void {
  _wizard = null;
}
