/**
 * contrast-rules.ts — @dantecode/ux-polish
 *
 * Accessibility contrast validation for DanteCode themes.
 * Ensures color tokens meet WCAG 2.1 AA contrast ratios (4.5:1 for text).
 * Terminal-safe validation — works without a DOM.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ContrastCheck {
  role: string;
  foreground: string;
  background: string;
  ratio: number;
  passes: boolean;
  level: "AA" | "AAA" | "fail";
}

export interface ContrastReport {
  theme: string;
  checks: ContrastCheck[];
  allPass: boolean;
  failCount: number;
}

// ---------------------------------------------------------------------------
// ANSI → approximate luminance
// ---------------------------------------------------------------------------

/**
 * ANSI color code → approximate relative luminance (0–1).
 * Maps common 4-bit ANSI codes to approximate sRGB values.
 * This is an approximation — exact contrast requires full 24-bit color info.
 */
const ANSI_LUMINANCE: Record<string, number> = {
  // Standard colors (L1 = 0.0, white = 1.0)
  "0":  0.0,  // black
  "30": 0.0,  // dark black (fg)
  "31": 0.07, // red
  "32": 0.15, // green
  "33": 0.30, // yellow
  "34": 0.04, // blue
  "35": 0.11, // magenta
  "36": 0.25, // cyan
  "37": 0.75, // light gray
  "90": 0.12, // dark gray
  "91": 0.25, // bright red
  "92": 0.40, // bright green
  "93": 0.67, // bright yellow
  "94": 0.20, // bright blue
  "95": 0.35, // bright magenta
  "96": 0.55, // bright cyan
  "97": 1.0,  // white
  "1":  0.8,  // bold (usually white/bright)
  "2":  0.35, // dim
};

/** Terminal background assumed luminance (dark terminal default). */
const TERMINAL_BG_LUMINANCE = 0.01;

/** Extract ANSI code number from escape sequence. */
function extractAnsiCode(ansiSeq: string): string {
  const m = ansiSeq.match(/\x1b\[(\d+)m/);
  return m ? (m[1] ?? "0") : "0";
}

/** Compute contrast ratio between two luminances. */
function contrastRatio(l1: number, l2: number): number {
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Classify contrast ratio to WCAG level. */
function wcagLevel(ratio: number): "AA" | "AAA" | "fail" {
  if (ratio >= 7)   return "AAA";
  if (ratio >= 4.5) return "AA";
  return "fail";
}

// ---------------------------------------------------------------------------
// ContrastValidator
// ---------------------------------------------------------------------------

export interface ContrastValidatorOptions {
  /** Override terminal background luminance assumption. Default: 0.01. */
  bgLuminance?: number;
  /** WCAG minimum ratio required. Default: 4.5 (AA). */
  minRatio?: number;
}

export class ContrastValidator {
  private readonly _bgLuminance: number;
  private readonly _minRatio: number;

  constructor(options: ContrastValidatorOptions = {}) {
    this._bgLuminance = options.bgLuminance ?? TERMINAL_BG_LUMINANCE;
    this._minRatio = options.minRatio ?? 4.5;
  }

  /**
   * Check a single ANSI color sequence against the terminal background.
   */
  check(role: string, ansiSeq: string): ContrastCheck {
    const code = extractAnsiCode(ansiSeq);
    const fgLuminance = ANSI_LUMINANCE[code] ?? 0.5;
    const ratio = contrastRatio(fgLuminance, this._bgLuminance);
    const level = wcagLevel(ratio);
    return {
      role,
      foreground: ansiSeq || "(no color)",
      background: `terminal-bg (L=${this._bgLuminance})`,
      ratio: Math.round(ratio * 100) / 100,
      passes: ratio >= this._minRatio,
      level,
    };
  }

  /**
   * Validate a set of named ANSI color tokens.
   */
  validateTokens(
    themeName: string,
    tokens: Record<string, string>,
  ): ContrastReport {
    const checks = Object.entries(tokens)
      .filter(([, v]) => v.includes("\x1b["))
      .map(([role, seq]) => this.check(role, seq));

    const failCount = checks.filter((c) => !c.passes).length;
    return {
      theme: themeName,
      checks,
      allPass: failCount === 0,
      failCount,
    };
  }

  /**
   * Format a contrast report as a readable string.
   */
  formatReport(report: ContrastReport): string {
    const lines: string[] = [`Contrast report — theme: ${report.theme}`];
    for (const c of report.checks) {
      const badge = c.passes ? "✓" : "✗";
      lines.push(
        `  ${badge} ${c.role.padEnd(12)} ratio:${c.ratio.toFixed(2)} [${c.level}]`,
      );
    }
    lines.push(
      report.allPass
        ? `All ${report.checks.length} checks passed.`
        : `${report.failCount}/${report.checks.length} checks failed.`,
    );
    return lines.join("\n");
  }

  /**
   * Quick pass/fail check — returns true only if all tokens pass.
   */
  allPass(themeName: string, tokens: Record<string, string>): boolean {
    return this.validateTokens(themeName, tokens).allPass;
  }
}
