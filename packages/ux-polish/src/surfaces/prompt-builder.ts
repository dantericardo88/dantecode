/**
 * prompt-builder.ts — @dantecode/ux-polish
 *
 * Context-aware readline prompt builder for the DanteCode CLI REPL.
 * Builds a rich, context-rich prompt string showing active session state.
 *
 * Pure function — no side effects, returns string only.
 */

import { ThemeEngine } from "../theme-engine.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PromptBuilderState {
  /** Session name or short ID. Omitted if undefined. */
  sessionName?: string;
  /** Short model name, e.g. "grok-3" or "opus". */
  modelShort: string;
  /** Sandbox mode: "read-only" | "workspace-write" | "full-access" */
  sandboxMode: string;
  /** Number of agent rounds completed this session. 0 → omit. */
  roundCount: number;
  /** Last PDSE score (integer 0–100). Omit if undefined. */
  lastPdse?: number;
  /** ThemeEngine for color resolution. */
  theme: ThemeEngine;
}

// ---------------------------------------------------------------------------
// Sandbox icons
// ---------------------------------------------------------------------------

const SANDBOX_ICONS: Record<string, string> = {
  "read-only": "🔒",
  "workspace-write": "🛡️",
  "full-access": "⚡",
};

function sandboxIcon(mode: string): string {
  return SANDBOX_ICONS[mode] ?? "🛡️";
}

// ---------------------------------------------------------------------------
// buildPrompt
// ---------------------------------------------------------------------------

/**
 * Build a context-aware prompt string for the readline interface.
 * Shows: session name, model shorthand, sandbox indicator, round count, PDSE.
 *
 * Example output: `my-session grok-3 🛡️ r12 P:92 ❯ `
 */
export function buildPrompt(state: PromptBuilderState): string {
  const c = state.theme.resolve().colors;
  const parts: string[] = [];

  // Session name (if set)
  if (state.sessionName) {
    parts.push(`${c.muted}${state.sessionName}${c.reset}`);
  }

  // Model shorthand
  parts.push(`${c.info}${state.modelShort}${c.reset}`);

  // Sandbox indicator
  parts.push(sandboxIcon(state.sandboxMode));

  // Round count (omit if 0)
  if (state.roundCount > 0) {
    parts.push(`${c.muted}r${state.roundCount}${c.reset}`);
  }

  // PDSE score (if available)
  if (state.lastPdse !== undefined) {
    const pdseColor = state.lastPdse >= 85 ? c.success : state.lastPdse >= 70 ? c.warning : c.error;
    parts.push(`${pdseColor}P:${state.lastPdse}${c.reset}`);
  }

  // Prompt arrow
  return `${parts.join(" ")} ${c.info}❯${c.reset} `;
}
