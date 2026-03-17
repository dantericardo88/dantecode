// ============================================================================
// Blade v1.2 — BladeProgressEmitter
// Encapsulates the Blade progress UX: silent mode, single-line status updates,
// PDSE tracking, and cost-aware phase reporting.
// ============================================================================

import type {
  BladeAutoforgeConfig,
  BladeProgressState,
  GStackResult,
  PDSEScore,
} from "@dantecode/config-types";
import type { AutoforgeResult } from "./autoforge.js";
import { formatBladeProgressLine } from "./autoforge.js";

/**
 * BladeProgressEmitter encapsulates the Blade v1.2 progress UX.
 * Wraps an AutoforgeConfig and emits BladeProgressState events to the provided
 * emit callback on every significant lifecycle event.
 *
 * Usage:
 *   const emitter = new BladeProgressEmitter(config, (state) => postMessage(state));
 *   emitter.onIterationStart(1);
 *   emitter.onPDSEScore(score);
 *   emitter.onComplete(result);
 */
export class BladeProgressEmitter {
  private readonly _config: BladeAutoforgeConfig;
  private readonly _emit: (state: BladeProgressState) => void;
  private _currentPhase = 0;
  private _lastPdseScore = 0;
  private _estimatedCostUsd = 0;
  private _currentTask = "Initializing...";

  constructor(
    config: BladeAutoforgeConfig,
    emit: (state: BladeProgressState) => void,
  ) {
    this._config = config;
    this._emit = emit;
  }

  /** Called when a new autoforge iteration begins. */
  onIterationStart(iteration: number): void {
    this._currentPhase = iteration;
    this._currentTask = `Running iteration ${iteration}...`;
    this._emitState();
  }

  /** Called after each tool round completes. */
  onToolRound(round: number, toolName: string): void {
    this._currentTask = `Tool: ${toolName} (round ${round})`;
    this._emitState();
  }

  /** Called with GStack results after each GStack run. */
  onGStackResult(result: GStackResult): void {
    const status = result.passed ? "pass" : "fail";
    this._currentTask = `GStack ${result.command}: ${status}`;
    this._emitState();
  }

  /** Called after PDSE scoring completes. */
  onPDSEScore(score: PDSEScore): void {
    this._lastPdseScore = score.overall;
    this._currentTask = `PDSE scored: ${score.overall}/100`;
    this._emitState();
  }

  /** Called with cost update from ModelRouterImpl. */
  onCostUpdate(costUsd: number): void {
    this._estimatedCostUsd = costUsd;
    this._emitState();
  }

  /** Called when the autoforge run completes (pass or fail). */
  onComplete(result: AutoforgeResult): void {
    this._currentTask = result.succeeded ? "Complete" : "Did not pass all gates";
    this._emit({
      phase: this._currentPhase,
      totalPhases: this._getTotalPhases(),
      percentComplete: 100,
      pdseScore: result.finalScore?.overall ?? this._lastPdseScore,
      estimatedCostUsd: this._estimatedCostUsd,
      currentTask: this._currentTask,
      silentMode: this._config.silentMode ?? false,
    });
  }

  /** Returns the formatted single-line progress string. */
  getProgressLine(): string {
    return formatBladeProgressLine(this._buildState());
  }

  private _getTotalPhases(): number {
    return this._config.hardCeiling ?? this._config.maxIterations;
  }

  private _buildState(): BladeProgressState {
    const totalPhases = this._getTotalPhases();
    const percentComplete = this._currentPhase === 0
      ? 0
      : Math.floor(((this._currentPhase - 1) / totalPhases) * 100);
    return {
      phase: this._currentPhase,
      totalPhases,
      percentComplete,
      pdseScore: this._lastPdseScore,
      estimatedCostUsd: this._estimatedCostUsd,
      currentTask: this._currentTask,
      silentMode: this._config.silentMode ?? false,
    };
  }

  private _emitState(): void {
    this._emit(this._buildState());
  }
}

export { formatBladeProgressLine };
