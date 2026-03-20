/**
 * onboarding-state.ts — @dantecode/ux-polish
 *
 * Persistent onboarding completion state.
 * Stores per-step completion flags to support resume-from-checkpoint.
 */

import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OnboardingRecord {
  /** Whether the full onboarding flow completed. */
  completed: boolean;
  /** Steps completed successfully (step IDs). */
  stepsCompleted: string[];
  /** Steps that were skipped. */
  stepsSkipped: string[];
  /** ISO-8601 timestamp of last update. */
  updatedAt: string;
  /** ISO-8601 timestamp of first completion (undefined if not yet complete). */
  completedAt?: string;
}

export interface OnboardingStateOptions {
  /** Root directory containing .dantecode/. Default: process.cwd(). */
  projectRoot?: string;
  /** Override state file path. */
  stateFilePath?: string;
}

// ---------------------------------------------------------------------------
// OnboardingState
// ---------------------------------------------------------------------------

const DEFAULTS: OnboardingRecord = {
  completed: false,
  stepsCompleted: [],
  stepsSkipped: [],
  updatedAt: new Date().toISOString(),
};

export class OnboardingState {
  private readonly _filePath: string;
  private _record: OnboardingRecord;

  constructor(options: OnboardingStateOptions = {}) {
    const root = options.projectRoot ?? process.cwd();
    this._filePath =
      options.stateFilePath ??
      path.join(root, ".dantecode", "onboarding.json");
    this._record = { ...DEFAULTS, updatedAt: new Date().toISOString() };
    this._load();
  }

  // -------------------------------------------------------------------------
  // Read API
  // -------------------------------------------------------------------------

  /** Whether full onboarding is complete. */
  isComplete(): boolean {
    return this._record.completed;
  }

  /** Whether a specific step was completed. */
  isStepComplete(stepId: string): boolean {
    return this._record.stepsCompleted.includes(stepId);
  }

  /** Whether a specific step was skipped. */
  isStepSkipped(stepId: string): boolean {
    return this._record.stepsSkipped.includes(stepId);
  }

  /** Get all completed step IDs. */
  getCompletedSteps(): string[] {
    return [...this._record.stepsCompleted];
  }

  /** Get a full snapshot of the record. */
  getRecord(): OnboardingRecord {
    return { ...this._record, stepsCompleted: [...this._record.stepsCompleted], stepsSkipped: [...this._record.stepsSkipped] };
  }

  // -------------------------------------------------------------------------
  // Write API
  // -------------------------------------------------------------------------

  /** Mark a step as completed. */
  markStepComplete(stepId: string): void {
    if (!this._record.stepsCompleted.includes(stepId)) {
      this._record.stepsCompleted = [...this._record.stepsCompleted, stepId];
    }
    // Remove from skipped if it was previously skipped
    this._record.stepsSkipped = this._record.stepsSkipped.filter((s) => s !== stepId);
    this._record.updatedAt = new Date().toISOString();
    this._save();
  }

  /** Mark a step as skipped. */
  markStepSkipped(stepId: string): void {
    if (!this._record.stepsSkipped.includes(stepId)) {
      this._record.stepsSkipped = [...this._record.stepsSkipped, stepId];
    }
    this._record.updatedAt = new Date().toISOString();
    this._save();
  }

  /** Mark the full onboarding flow as complete. */
  markComplete(): void {
    this._record.completed = true;
    this._record.completedAt = new Date().toISOString();
    this._record.updatedAt = new Date().toISOString();
    this._save();
  }

  /** Reset onboarding state (useful for --force re-run). */
  reset(): void {
    this._record = {
      completed: false,
      stepsCompleted: [],
      stepsSkipped: [],
      updatedAt: new Date().toISOString(),
    };
    this._save();
  }

  /** Get the file path used for persistence. */
  getFilePath(): string {
    return this._filePath;
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private _load(): void {
    try {
      if (!fs.existsSync(this._filePath)) return;
      const raw = fs.readFileSync(this._filePath, "utf-8");
      const parsed = JSON.parse(raw) as Partial<OnboardingRecord>;
      this._record = {
        completed: typeof parsed.completed === "boolean" ? parsed.completed : false,
        stepsCompleted: Array.isArray(parsed.stepsCompleted) ? parsed.stepsCompleted as string[] : [],
        stepsSkipped: Array.isArray(parsed.stepsSkipped) ? parsed.stepsSkipped as string[] : [],
        updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
        completedAt: typeof parsed.completedAt === "string" ? parsed.completedAt : undefined,
      };
    } catch {
      // Corrupt file — start fresh
    }
  }

  private _save(): void {
    try {
      const dir = path.dirname(this._filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this._filePath, JSON.stringify(this._record, null, 2));
    } catch {
      // Non-fatal — state just won't persist
    }
  }
}
