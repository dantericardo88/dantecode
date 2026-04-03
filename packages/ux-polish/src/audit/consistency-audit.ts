/**
 * consistency-audit.ts — @dantecode/ux-polish
 *
 * G17 — Consistency audit harness.
 * Renders the same payload on all three surfaces (CLI/REPL/VSCode) and
 * reports message/tone drift and theme token drift.
 */

import { RichRenderer } from "../rich-renderer.js";
import { CliSurface } from "../surfaces/cli-surface.js";
import { ReplSurface } from "../surfaces/repl-surface.js";
import { VscodeSurface } from "../surfaces/vscode-surface.js";
import { ThemeEngine } from "../theme-engine.js";
import { COLOR_TOKENS } from "../tokens/color-tokens.js";
import type { RenderPayload, UXSurface } from "../types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One entry in a drift report. */
export interface DriftEntry {
  /** What type of drift was detected. */
  type: "length" | "tone" | "icon" | "color" | "missing-token";
  /** Human-readable description. */
  description: string;
  /** Severity 1–3 (1=info, 2=warning, 3=critical). */
  severity: 1 | 2 | 3;
  /** Which surfaces are involved. */
  surfaces: UXSurface[];
}

/** Result of rendering the same payload across all surfaces. */
export interface CrossSurfaceRender {
  payload: RenderPayload;
  outputs: Record<UXSurface, string>;
}

/** Full audit report for a set of payloads. */
export interface AuditReport {
  /** How many payloads were tested. */
  payloadCount: number;
  /** Detected drift entries. */
  drifts: DriftEntry[];
  /** Whether any critical drifts were found. */
  hasCritical: boolean;
  /** Token validation results. */
  tokenDrifts: TokenDriftResult[];
  /** Summary string. */
  summary: string;
}

/** Result of checking theme token consistency. */
export interface TokenDriftResult {
  theme: string;
  token: string;
  issue: string;
}

// ---------------------------------------------------------------------------
// ConsistencyAudit
// ---------------------------------------------------------------------------

export class ConsistencyAudit {
  private _theme: ThemeEngine;

  constructor(theme?: ThemeEngine) {
    this._theme = theme ?? new ThemeEngine({ colors: false });
  }

  /**
   * Renders a payload on all three surfaces and returns the raw outputs.
   * Surfaces run in no-color mode to keep output comparable.
   */
  renderAcrossSurfaces(payload: RenderPayload): CrossSurfaceRender {
    const noColorTheme = new ThemeEngine({ colors: false });
    const renderer = new RichRenderer({ theme: noColorTheme });

    // CLI surface (no stdout)
    const cli = new CliSurface({ theme: noColorTheme, writeToStdout: false });
    const cliOut = cli.render(payload, { colors: false });

    // REPL surface
    const repl = new ReplSurface({ theme: noColorTheme });
    const replOut = repl.render(payload, { colors: false });

    // VSCode surface
    const vscodeMessages: string[] = [];
    const vscode = new VscodeSurface({
      theme: noColorTheme,
      postMessage: (msg) => {
        const p = msg.payload as Record<string, unknown> | null;
        const output = typeof p?.["output"] === "string" ? p["output"] : JSON.stringify(p);
        vscodeMessages.push(output);
      },
    });
    const vscodeMsg = vscode.render(payload);
    const directOut =
      typeof (vscodeMsg.payload as Record<string, unknown>)?.["output"] === "string"
        ? ((vscodeMsg.payload as Record<string, unknown>)["output"] as string)
        : JSON.stringify(vscodeMsg.payload);
    const vscodeOut = vscodeMessages.join("\n") || directOut;

    // Also get direct renderer output for comparison
    const rendererOut = renderer.render("cli", payload, { colors: false });

    return {
      payload,
      outputs: {
        cli: cliOut || rendererOut.output,
        repl: replOut || rendererOut.output,
        vscode: vscodeOut || rendererOut.output,
      },
    };
  }

  /**
   * Runs a full audit over a set of payloads.
   */
  runAudit(payloads: RenderPayload[]): AuditReport {
    const drifts: DriftEntry[] = [];
    let payloadCount = 0;

    for (const payload of payloads) {
      payloadCount++;
      const rendered = this.renderAcrossSurfaces(payload);
      const detected = this.detectToneDrift(rendered.outputs);
      drifts.push(...detected);
    }

    const tokenDrifts = this.detectThemeDrift(this._theme);
    const hasCritical = drifts.some((d) => d.severity === 3);

    const summary = this._buildSummary(payloadCount, drifts, tokenDrifts);
    return { payloadCount, drifts, hasCritical, tokenDrifts, summary };
  }

  /**
   * Detects message/tone drift between surface outputs.
   * Checks: length variance, missing content, icon inconsistency.
   */
  detectToneDrift(outputs: Record<UXSurface, string>): DriftEntry[] {
    const drifts: DriftEntry[] = [];
    const surfaces = Object.keys(outputs) as UXSurface[];
    const lengths = surfaces.map((s) => outputs[s].length);
    const maxLen = Math.max(...lengths);
    const minLen = Math.min(...lengths);

    // Length variance > 200% is suspicious
    if (maxLen > 0 && minLen / maxLen < 0.1) {
      const short = surfaces.filter((s) => outputs[s].length < maxLen * 0.1);
      drifts.push({
        type: "length",
        description: `Output length drift: ${short.join(", ")} surfaces have near-empty output (max=${maxLen}, min=${minLen}).`,
        severity: 2,
        surfaces: short,
      });
    }

    // Check for missing content across surfaces
    for (const s of surfaces) {
      if (outputs[s].trim().length === 0) {
        drifts.push({
          type: "missing-token",
          description: `Surface "${s}" produced empty output.`,
          severity: 3,
          surfaces: [s],
        });
      }
    }

    // Check for tone markers — success/error states should appear consistently
    const markers = ["[OK]", "Error", "Warning", "✓", "✗", "⚠"];
    for (const marker of markers) {
      const present = surfaces.filter((s) => outputs[s].includes(marker));
      const absent = surfaces.filter((s) => !outputs[s].includes(marker));
      if (present.length > 0 && absent.length > 0) {
        drifts.push({
          type: "tone",
          description: `Tone marker "${marker}" present on [${present.join(", ")}] but absent on [${absent.join(", ")}].`,
          severity: 1,
          surfaces: absent,
        });
      }
    }

    return drifts;
  }

  /**
   * Validates theme token consistency — checks for empty strings where values are expected.
   */
  detectThemeDrift(theme: ThemeEngine): TokenDriftResult[] {
    const results: TokenDriftResult[] = [];
    const resolved = theme.resolve();
    const colorKeys = Object.keys(resolved.colors) as Array<keyof typeof resolved.colors>;

    // In a color-enabled theme, no semantic token should be empty
    if (theme.colorsEnabled) {
      for (const key of colorKeys) {
        if (resolved.colors[key] === "") {
          results.push({
            theme: resolved.name,
            token: key,
            issue: "empty string in color-enabled theme",
          });
        }
      }
    }

    // Check all built-in themes for coverage
    const themeNames = Object.keys(COLOR_TOKENS) as Array<keyof typeof COLOR_TOKENS>;
    for (const name of themeNames) {
      const tokens = COLOR_TOKENS[name];
      for (const [key, val] of Object.entries(tokens)) {
        if (val === undefined) {
          results.push({ theme: name, token: key, issue: "undefined token value" });
        }
      }
    }

    return results;
  }

  /**
   * Formats an AuditReport into a human-readable string.
   */
  formatReport(report: AuditReport): string {
    const lines: string[] = [];
    const icon = report.hasCritical ? "✗" : report.drifts.length === 0 ? "✓" : "⚠";
    lines.push(`${icon} Consistency Audit — ${report.payloadCount} payloads tested`);

    if (report.drifts.length === 0 && report.tokenDrifts.length === 0) {
      lines.push("  No drift detected. All surfaces are consistent.");
    } else {
      if (report.drifts.length > 0) {
        lines.push(`  Tone/Content Drifts (${report.drifts.length}):`);
        for (const d of report.drifts) {
          const sev = d.severity === 3 ? "[CRITICAL]" : d.severity === 2 ? "[WARNING]" : "[INFO]";
          lines.push(`    ${sev} ${d.description}`);
        }
      }
      if (report.tokenDrifts.length > 0) {
        lines.push(`  Token Drifts (${report.tokenDrifts.length}):`);
        for (const t of report.tokenDrifts) {
          lines.push(`    [${t.theme}] ${t.token}: ${t.issue}`);
        }
      }
    }

    lines.push("");
    lines.push(report.summary);
    return lines.join("\n");
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private _buildSummary(
    payloadCount: number,
    drifts: DriftEntry[],
    tokenDrifts: TokenDriftResult[],
  ): string {
    const critCount = drifts.filter((d) => d.severity === 3).length;
    const warnCount = drifts.filter((d) => d.severity === 2).length;
    const infoCount = drifts.filter((d) => d.severity === 1).length;
    const tokenCount = tokenDrifts.length;

    if (critCount === 0 && warnCount === 0 && tokenCount === 0) {
      return `PASS: ${payloadCount} payloads rendered consistently across all surfaces.`;
    }
    const parts: string[] = [];
    if (critCount > 0) parts.push(`${critCount} critical`);
    if (warnCount > 0) parts.push(`${warnCount} warning`);
    if (infoCount > 0) parts.push(`${infoCount} info`);
    if (tokenCount > 0) parts.push(`${tokenCount} token`);
    return `DRIFT: ${parts.join(", ")} issue(s) found across ${payloadCount} payloads.`;
  }
}
