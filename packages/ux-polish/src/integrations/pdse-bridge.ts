/**
 * pdse-bridge.ts — @dantecode/ux-polish
 *
 * G13 — DanteForge / PDSE weld.
 * Renders PDSE/confidence inline, provides next-step guidance based on
 * verification state, and formats trust hints for CLI/REPL/VSCode surfaces.
 */

import type { ThemeEngine } from "../theme-engine.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Trust band derived from PDSE score. */
export type TrustBand = "trusted" | "caution" | "blocked";

/**
 * Minimal PDSE state — structurally compatible with PdseScoreReport from @dantecode/core.
 * Kept as a local type to avoid circular dependency.
 */
export interface PdseState {
  /** Overall PDSE score 0–1. */
  overall: number;
  /** Optional human label (e.g. "High confidence"). */
  label?: string;
  /** Per-metric breakdown. */
  metrics?: {
    Preciseness?: number;
    Depth?: number;
    Specificity?: number;
    Evidence?: number;
  };
  /** Verification pipeline that produced this score. */
  pipeline?: string;
  /** Whether verification was completed. */
  verified?: boolean;
}

/** A rendered trust hint ready to display. */
export interface PdseTrustHint {
  /** One-line inline text (e.g. "[PDSE: 0.87 ✓ trusted]"). */
  inline: string;
  /** Multi-line detailed breakdown. */
  detail: string;
  /** Trust band classification. */
  band: TrustBand;
  /** Actionable next steps based on the score. */
  nextSteps: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TRUST_THRESHOLDS = {
  trusted: 0.75,
  caution: 0.5,
} as const;

// ---------------------------------------------------------------------------
// PdseBridge
// ---------------------------------------------------------------------------

export class PdseBridge {
  /**
   * Classifies a 0–1 score into a TrustBand.
   */
  formatTrustBand(score: number): TrustBand {
    if (score >= TRUST_THRESHOLDS.trusted) return "trusted";
    if (score >= TRUST_THRESHOLDS.caution) return "caution";
    return "blocked";
  }

  /**
   * Renders a compact one-line inline hint for embedding in CLI output.
   * Optional ThemeEngine applies color coding.
   */
  renderInlineHint(state: PdseState, theme?: ThemeEngine): string {
    const band = this.formatTrustBand(state.overall);
    const pct = Math.round(state.overall * 100);
    const icon = band === "trusted" ? "✓" : band === "caution" ? "⚠" : "✗";
    const label = state.label ?? band;
    const core = `PDSE: ${pct}% ${icon} ${label}`;

    if (!theme) return `[${core}]`;

    if (band === "trusted") return theme.success(`[${core}]`);
    if (band === "caution") return theme.warning(`[${core}]`);
    return theme.error(`[${core}]`);
  }

  /**
   * Builds a full PdseTrustHint with inline, detail, band, and next steps.
   */
  buildTrustHint(state: PdseState, theme?: ThemeEngine): PdseTrustHint {
    const band = this.formatTrustBand(state.overall);
    const inline = this.renderInlineHint(state, theme);
    const detail = this.formatVerificationSummary(state, theme);
    const nextSteps = this.getNextStepGuidance(state, state.pipeline);
    return { inline, detail, band, nextSteps };
  }

  /**
   * Returns actionable next-step strings based on PDSE score and pipeline context.
   */
  getNextStepGuidance(state: PdseState, pipeline?: string): string[] {
    const band = this.formatTrustBand(state.overall);
    const steps: string[] = [];

    if (band === "trusted") {
      steps.push("Result is high-confidence — safe to proceed or ship.");
      if (pipeline) steps.push(`Run \`/verify\` to lock the ${pipeline} baseline.`);
    } else if (band === "caution") {
      steps.push("Review the output carefully before acting.");
      steps.push("Consider running `/verify` to improve the confidence score.");
      if (state.metrics) {
        const low = Object.entries(state.metrics)
          .filter(([, v]) => v !== undefined && v < 0.6)
          .map(([k]) => k);
        if (low.length > 0) {
          steps.push(`Low-scoring dimensions: ${low.join(", ")} — focus review here.`);
        }
      }
    } else {
      steps.push("Score is below the trust threshold — do not ship without review.");
      steps.push("Run `/verify --force` to re-run full verification.");
      steps.push("Check logs for failing checks and fix them before retrying.");
    }

    return steps;
  }

  /**
   * Formats a multi-line verification summary for verbose display.
   */
  formatVerificationSummary(state: PdseState, theme?: ThemeEngine): string {
    const band = this.formatTrustBand(state.overall);
    const pct = Math.round(state.overall * 100);
    const lines: string[] = [];

    const header = `Verification Summary — PDSE ${pct}% (${band})`;
    lines.push(theme ? theme.boldText(header) : header);

    if (state.verified !== undefined) {
      lines.push(`  Verified: ${state.verified ? "yes" : "no"}`);
    }
    if (state.pipeline) {
      lines.push(`  Pipeline: ${state.pipeline}`);
    }

    if (state.metrics && Object.keys(state.metrics).length > 0) {
      lines.push("  Metrics:");
      for (const [key, val] of Object.entries(state.metrics)) {
        if (val === undefined) continue;
        const bar = this._miniBar(val);
        const pctStr = `${Math.round(val * 100)}%`;
        const colored = theme
          ? val >= 0.75 ? theme.success(`${pctStr} ${bar}`) : val >= 0.5 ? theme.warning(`${pctStr} ${bar}`) : theme.error(`${pctStr} ${bar}`)
          : `${pctStr} ${bar}`;
        lines.push(`    ${key.padEnd(12)} ${colored}`);
      }
    }

    return lines.join("\n");
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _miniBar(val: number): string {
    const filled = Math.round(val * 8);
    return "█".repeat(filled) + "░".repeat(8 - filled);
  }
}

// ---------------------------------------------------------------------------
// Module-level convenience
// ---------------------------------------------------------------------------

let _bridge: PdseBridge | null = null;

export function getPdseBridge(): PdseBridge {
  _bridge ??= new PdseBridge();
  return _bridge;
}

export function resetPdseBridge(): void {
  _bridge = null;
}
