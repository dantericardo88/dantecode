// ============================================================================
// @dantecode/core — ConvergenceMetrics
// Tracks convergence-related metrics across an agent session: iteration counts,
// repair triggers, stuck-loop detector hits, and completion gate rejections.
// ============================================================================

export interface ConvergenceSnapshot {
  iterations: number;
  repairTriggers: number;
  loopDetectorHits: number;
  completionGateRejections: number;
  verificationPassed: boolean | null;
  elapsedMs: number;
}

type IncrementField =
  | "iterations"
  | "repairTriggers"
  | "loopDetectorHits"
  | "completionGateRejections";

export class ConvergenceMetrics {
  private _iterations = 0;
  private _repairTriggers = 0;
  private _loopDetectorHits = 0;
  private _completionGateRejections = 0;
  private _verificationPassed: boolean | null = null;
  private _startMs = Date.now();

  increment(field: IncrementField): void {
    switch (field) {
      case "iterations":
        this._iterations++;
        break;
      case "repairTriggers":
        this._repairTriggers++;
        break;
      case "loopDetectorHits":
        this._loopDetectorHits++;
        break;
      case "completionGateRejections":
        this._completionGateRejections++;
        break;
    }
  }

  setVerificationPassed(passed: boolean): void {
    this._verificationPassed = passed;
  }

  snapshot(): ConvergenceSnapshot {
    return {
      iterations: this._iterations,
      repairTriggers: this._repairTriggers,
      loopDetectorHits: this._loopDetectorHits,
      completionGateRejections: this._completionGateRejections,
      verificationPassed: this._verificationPassed,
      elapsedMs: Date.now() - this._startMs,
    };
  }

  formatSummary(): string {
    const parts: string[] = [];

    parts.push(`${this._iterations} round${this._iterations !== 1 ? "s" : ""}`);

    if (this._repairTriggers > 0) {
      parts.push(`${this._repairTriggers} repair${this._repairTriggers !== 1 ? "s" : ""}`);
    }

    if (this._loopDetectorHits > 0) {
      parts.push(`loop detected ${this._loopDetectorHits}×`);
    }

    if (this._completionGateRejections > 0) {
      parts.push(`gate rejected ${this._completionGateRejections}×`);
    }

    if (this._verificationPassed === true) {
      parts.push("✓ verified");
    } else if (this._verificationPassed === false) {
      parts.push("✗ verify failed");
    }

    return parts.join(", ");
  }

  reset(): void {
    this._iterations = 0;
    this._repairTriggers = 0;
    this._loopDetectorHits = 0;
    this._completionGateRejections = 0;
    this._verificationPassed = null;
    this._startMs = Date.now();
  }
}
