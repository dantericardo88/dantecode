/**
 * token-dashboard.ts — @dantecode/ux-polish
 *
 * Token usage dashboard for the CLI.
 * Shows: total tokens, by-tool breakdown, cost estimate, context utilization.
 *
 * Pure rendering function — no side effects, no stdout writes.
 */

import { ThemeEngine } from "../theme-engine.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TokenUsageData {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  /** Per-tool breakdown: tool name → { calls, tokens }. */
  byTool: Record<string, { calls: number; tokens: number }>;
  modelId: string;
  /** Total context window size for this model. */
  contextWindow: number;
  /** Fraction of context used (0–1). */
  contextUtilization: number;
  /** Estimated cost in USD (optional). */
  estimatedCost?: number;
  /** Session duration in milliseconds. */
  sessionDurationMs: number;
}

// ---------------------------------------------------------------------------
// Model pricing (per million tokens, input/output in USD)
// ---------------------------------------------------------------------------

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  "grok-3": { input: 3.0, output: 15.0 },
  "grok/grok-3": { input: 3.0, output: 15.0 },
  "claude-sonnet-4": { input: 3.0, output: 15.0 },
  "anthropic/claude-sonnet-4": { input: 3.0, output: 15.0 },
  "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
  "anthropic/claude-sonnet-4-6": { input: 3.0, output: 15.0 },
  "claude-opus-4-6": { input: 15.0, output: 75.0 },
  "anthropic/claude-opus-4-6": { input: 15.0, output: 75.0 },
  "claude-haiku-4-5": { input: 0.8, output: 4.0 },
  "anthropic/claude-haiku-4-5": { input: 0.8, output: 4.0 },
  "gpt-4o": { input: 2.5, output: 10.0 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
};

/**
 * Fuzzy pricing lookup: exact → suffix (after /) → prefix match (first 3 dash-segments).
 * Handles date-suffixed model IDs like "anthropic/claude-haiku-4-5-20251001".
 */
function findPricing(modelId: string): { input: number; output: number } | undefined {
  if (MODEL_PRICING[modelId]) return MODEL_PRICING[modelId];
  const suffix = modelId.split("/").pop() ?? "";
  if (MODEL_PRICING[suffix]) return MODEL_PRICING[suffix];
  const prefix = suffix.split("-").slice(0, 3).join("-");
  for (const key of Object.keys(MODEL_PRICING)) {
    if (key.startsWith(prefix)) return MODEL_PRICING[key];
  }
  return undefined;
}

function estimateCost(modelId: string, inputTokens: number, outputTokens: number): number | undefined {
  const pricing = findPricing(modelId);
  if (!pricing) return undefined;
  return (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
}

// ---------------------------------------------------------------------------
// renderTokenDashboard
// ---------------------------------------------------------------------------

/** Box width (inner content width). */
const BOX_WIDTH = 50;

/**
 * Render a token usage dashboard as themed ANSI output.
 * Returns a multi-line string with box-drawing characters.
 */
export function renderTokenDashboard(data: TokenUsageData, theme?: ThemeEngine): string {
  const engine = theme ?? new ThemeEngine();
  const c = engine.resolve().colors;

  if (data.totalTokens === 0) {
    return boxLine(c.muted, "No token data", BOX_WIDTH, c.reset);
  }

  const lines: string[] = [];

  // Top border
  lines.push(`${c.info}╭─ Token Usage ${"─".repeat(BOX_WIDTH - 12)}╮${c.reset}`);

  const row = (label: string, value: string): string => {
    const inner = `${c.muted}${label.padEnd(12)}${c.reset}${value}`;
    return `${c.info}│${c.reset} ${padToVisible(inner, BOX_WIDTH)} ${c.info}│${c.reset}`;
  };

  // Model & duration
  lines.push(row("Model:", `${c.info}${data.modelId}${c.reset}`));
  lines.push(row("Duration:", `${c.muted}${formatDuration(data.sessionDurationMs)}${c.reset}`));
  lines.push(`${c.info}│${c.reset}${" ".repeat(BOX_WIDTH + 2)}${c.info}│${c.reset}`);

  // Token counts
  lines.push(row("Input:", `${c.muted}${formatNumber(data.inputTokens)} tokens${c.reset}`));
  lines.push(row("Output:", `${c.muted}${formatNumber(data.outputTokens)} tokens${c.reset}`));
  lines.push(row("Total:", `${c.progress}${formatNumber(data.totalTokens)} tokens${c.reset}`));

  // Context utilization bar
  const pct = Math.min(100, Math.round(data.contextUtilization * 100));
  const barWidth = 16;
  const filled = Math.round((pct / 100) * barWidth);
  const empty = barWidth - filled;
  const barColor = pct >= 80 ? c.error : pct >= 60 ? c.warning : c.progress;
  const bar = `${barColor}${"█".repeat(filled)}${c.muted}${"░".repeat(empty)}${c.reset}`;
  lines.push(row("Context:", `${bar} ${c.muted}${pct}% of ${formatNumber(data.contextWindow)}${c.reset}`));

  // By-tool breakdown
  const toolEntries = Object.entries(data.byTool)
    .sort((a, b) => b[1].tokens - a[1].tokens)
    .slice(0, 8);

  if (toolEntries.length > 0) {
    lines.push(`${c.info}│${c.reset}${" ".repeat(BOX_WIDTH + 2)}${c.info}│${c.reset}`);
    lines.push(`${c.info}│${c.reset} ${c.muted}By Tool:${c.reset}${" ".repeat(BOX_WIDTH - 7)}${c.info}│${c.reset}`);
    for (const [tool, { calls, tokens }] of toolEntries) {
      const label = `  ${tool.padEnd(10)} ${String(calls).padStart(3)} calls   ${formatNumber(tokens)} tokens`;
      lines.push(`${c.info}│${c.reset} ${c.muted}${label}${c.reset}${" ".repeat(Math.max(0, BOX_WIDTH - label.length + 1))}${c.info}│${c.reset}`);
    }
  }

  // Cost estimate
  const cost = data.estimatedCost ?? estimateCost(data.modelId, data.inputTokens, data.outputTokens);
  if (cost !== undefined) {
    lines.push(`${c.info}│${c.reset}${" ".repeat(BOX_WIDTH + 2)}${c.info}│${c.reset}`);
    lines.push(row("Est. Cost:", `${c.success}~$${cost.toFixed(4)}${c.reset}`));
  }

  // Bottom border
  lines.push(`${c.info}╰${"─".repeat(BOX_WIDTH + 2)}╯${c.reset}`);

  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem}s`;
}

function boxLine(color: string, text: string, width: number, reset: string): string {
  return `${color}╭${"─".repeat(width + 2)}╮\n│ ${text.padEnd(width)} │\n╰${"─".repeat(width + 2)}╯${reset}\n`;
}

// ---------------------------------------------------------------------------
// ANSI-aware string helpers
// ---------------------------------------------------------------------------

/** Strip SGR ANSI escape sequences to measure visible width. */
function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

/** Visible character width (excludes ANSI escape codes). */
function visibleWidth(s: string): number {
  return stripAnsi(s).length;
}

/** Pad string to targetWidth visible characters (ANSI-aware). */
function padToVisible(s: string, targetWidth: number): string {
  const vw = visibleWidth(s);
  return s + " ".repeat(Math.max(0, targetWidth - vw));
}
