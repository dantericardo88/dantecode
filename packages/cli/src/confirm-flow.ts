/**
 * confirm-flow.ts
 *
 * Aider-style interactive confirmation flows for DanteCode.
 * Provides multi-step confirmation dialogs for destructive operations,
 * y/n prompts, selection menus, and structured approval gates.
 *
 * Inspired by Aider's elegant confirmation UX and Cline's command palette.
 */

import * as readline from "node:readline";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConfirmOptions {
  /** Default answer when user just hits Enter. Default: false. */
  defaultYes?: boolean;
  /** ANSI color output. Default: true. */
  colors?: boolean;
  /** Timeout in ms. If exceeded, resolves to defaultYes. 0 = no timeout. */
  timeoutMs?: number;
}

export interface SelectOption {
  label: string;
  value: string;
  description?: string;
}

export interface SelectOptions {
  /** Default selection index. Default: 0. */
  defaultIndex?: number;
  colors?: boolean;
}

export interface DestructiveConfirmOptions extends ConfirmOptions {
  /** Operation name displayed in warning. */
  operation?: string;
  /** Extra warning detail shown below the main prompt. */
  detail?: string;
}

export interface MultiStepResult {
  confirmed: boolean;
  answers: Record<string, string>;
}

export interface StepDefinition {
  key: string;
  prompt: string;
  /** "yn" for yes/no, "text" for free text, "select" for menu. */
  kind: "yn" | "text" | "select";
  options?: SelectOption[];
  defaultValue?: string;
  /** If true, confirmation must be "yes" (not just "y") for destructive steps. */
  requireExplicit?: boolean;
}

// ---------------------------------------------------------------------------
// ANSI helpers
// ---------------------------------------------------------------------------

const makeColors = (enabled: boolean) => ({
  RED: enabled ? "\x1b[31m" : "",
  YELLOW: enabled ? "\x1b[33m" : "",
  CYAN: enabled ? "\x1b[36m" : "",
  GREEN: enabled ? "\x1b[32m" : "",
  BOLD: enabled ? "\x1b[1m" : "",
  DIM: enabled ? "\x1b[2m" : "",
  RESET: enabled ? "\x1b[0m" : "",
});

// ---------------------------------------------------------------------------
// ConfirmFlow — low-level building blocks
// ---------------------------------------------------------------------------

/**
 * Ask a yes/no question in a non-TTY safe way.
 * Returns the default answer immediately when not in a TTY.
 */
export async function confirm(question: string, options: ConfirmOptions = {}): Promise<boolean> {
  const { defaultYes = false, colors = true, timeoutMs = 0 } = options;
  const c = makeColors(colors);

  if (!process.stdin.isTTY) return defaultYes;

  const hint = defaultYes ? `${c.DIM}[Y/n]${c.RESET}` : `${c.DIM}[y/N]${c.RESET}`;

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  return new Promise((resolve) => {
    let resolved = false;

    const done = (answer: boolean) => {
      if (resolved) return;
      resolved = true;
      rl.close();
      resolve(answer);
    };

    // Optional timeout
    if (timeoutMs > 0) {
      setTimeout(() => {
        process.stdout.write(
          `\n${c.DIM}(timed out — using default: ${defaultYes ? "yes" : "no"})${c.RESET}\n`,
        );
        done(defaultYes);
      }, timeoutMs);
    }

    rl.question(`${c.CYAN}?${c.RESET} ${question} ${hint} `, (answer) => {
      const trimmed = answer.trim().toLowerCase();
      if (trimmed === "") done(defaultYes);
      else done(/^y/.test(trimmed));
    });
  });
}

/**
 * Show a warning banner and require explicit confirmation before a
 * destructive operation proceeds.
 */
export async function confirmDestructive(
  question: string,
  options: DestructiveConfirmOptions = {},
): Promise<boolean> {
  const { colors = true, operation = "this operation", detail } = options;
  const c = makeColors(colors);

  process.stdout.write(`\n${c.RED}${c.BOLD}⚠  WARNING: ${operation}${c.RESET}\n`);
  if (detail) {
    process.stdout.write(`${c.DIM}   ${detail}${c.RESET}\n`);
  }
  process.stdout.write(`${c.YELLOW}   This action may be irreversible.${c.RESET}\n\n`);

  return confirm(question, { ...options, defaultYes: false });
}

/**
 * Present a selection menu and return the chosen value.
 * Returns the default option when not in a TTY.
 */
export async function select(
  prompt: string,
  choices: SelectOption[],
  options: SelectOptions = {},
): Promise<string> {
  const { defaultIndex = 0, colors = true } = options;
  const c = makeColors(colors);

  if (!choices.length) throw new Error("select() requires at least one choice");
  if (!process.stdin.isTTY) return choices[defaultIndex]?.value ?? choices[0]!.value;

  process.stdout.write(`\n${c.BOLD}${prompt}${c.RESET}\n`);
  choices.forEach((opt, i) => {
    const marker = i === defaultIndex ? `${c.GREEN}>${c.RESET}` : " ";
    const desc = opt.description ? ` ${c.DIM}— ${opt.description}${c.RESET}` : "";
    process.stdout.write(`  ${marker} ${c.DIM}${i + 1}.${c.RESET} ${opt.label}${desc}\n`);
  });

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  return new Promise((resolve) => {
    const hint = `${c.DIM}(1–${choices.length}, default: ${defaultIndex + 1})${c.RESET}`;
    rl.question(`${c.CYAN}?${c.RESET} Select ${hint} `, (answer) => {
      rl.close();
      const num = parseInt(answer.trim(), 10);
      if (isNaN(num) || num < 1 || num > choices.length) {
        resolve(choices[defaultIndex]?.value ?? choices[0]!.value);
      } else {
        resolve(choices[num - 1]!.value);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// MultiStepFlow
// ---------------------------------------------------------------------------

/**
 * Run a multi-step confirmation/input flow.
 * Steps are executed sequentially. A "yn" step that returns false short-circuits
 * the flow and returns `confirmed: false`.
 *
 * Example:
 * ```ts
 * const result = await runMultiStepFlow("Deploy to production?", [
 *   { key: "env", prompt: "Which environment?", kind: "select", options: [...] },
 *   { key: "proceed", prompt: "All good — proceed?", kind: "yn", requireExplicit: true },
 * ]);
 * if (result.confirmed) { ... }
 * ```
 */
export async function runMultiStepFlow(
  title: string,
  steps: StepDefinition[],
  options: { colors?: boolean } = {},
): Promise<MultiStepResult> {
  const { colors = true } = options;
  const c = makeColors(colors);
  const answers: Record<string, string> = {};

  process.stdout.write(`\n${c.CYAN}${c.BOLD}${title}${c.RESET}\n`);
  process.stdout.write(`${c.DIM}${"─".repeat(Math.min(title.length + 4, 60))}${c.RESET}\n\n`);

  for (const step of steps) {
    if (step.kind === "yn") {
      const explicit = step.requireExplicit ?? false;
      const confirmed = await _askYN(step.prompt, explicit, colors);
      answers[step.key] = confirmed ? "yes" : "no";
      if (!confirmed) return { confirmed: false, answers };
    } else if (step.kind === "select" && step.options) {
      const value = await select(step.prompt, step.options, { colors });
      answers[step.key] = value;
    } else {
      // text input
      const value = await _askText(step.prompt, step.defaultValue ?? "", colors);
      answers[step.key] = value;
    }
  }

  return { confirmed: true, answers };
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

async function _askYN(prompt: string, requireExplicit: boolean, colors: boolean): Promise<boolean> {
  const c = makeColors(colors);
  if (!process.stdin.isTTY) return false;

  const hint = requireExplicit ? `${c.DIM}[yes/no]${c.RESET}` : `${c.DIM}[y/N]${c.RESET}`;

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${c.CYAN}?${c.RESET} ${prompt} ${hint} `, (answer) => {
      rl.close();
      const trimmed = answer.trim().toLowerCase();
      if (requireExplicit) resolve(trimmed === "yes");
      else resolve(/^y/.test(trimmed));
    });
  });
}

async function _askText(prompt: string, defaultValue: string, colors: boolean): Promise<string> {
  const c = makeColors(colors);
  if (!process.stdin.isTTY) return defaultValue;

  const hint = defaultValue ? ` ${c.DIM}(default: ${defaultValue})${c.RESET}` : "";
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${c.CYAN}?${c.RESET} ${prompt}${hint} `, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultValue);
    });
  });
}

// ---------------------------------------------------------------------------
// Pre-built confirmation flows for common DanteCode operations
// ---------------------------------------------------------------------------

/** Confirm before a git force-push. */
export async function confirmForcePush(branch: string, colors = true): Promise<boolean> {
  return confirmDestructive(`Force push to ${branch}?`, {
    colors,
    operation: `git push --force to '${branch}'`,
    detail: "This will overwrite the remote branch history.",
  });
}

/** Confirm before resetting/reverting uncommitted changes. */
export async function confirmRevert(colors = true): Promise<boolean> {
  return confirmDestructive("Revert all uncommitted changes?", {
    colors,
    operation: "git revert / checkout --",
    detail: "All unstaged and staged changes will be permanently lost.",
  });
}

/** Confirm before running a sandbox-escape or high-risk Bash command. */
export async function confirmHighRiskBash(command: string, colors = true): Promise<boolean> {
  return confirmDestructive(`Run: ${command.slice(0, 80)}`, {
    colors,
    operation: "high-risk shell command",
    detail: "This command was flagged as potentially destructive by the safety guard.",
  });
}
