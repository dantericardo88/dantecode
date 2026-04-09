/**
 * confirmation-dialog.ts — @dantecode/ux-polish
 *
 * Reusable confirmation dialog component.
 * In non-interactive mode (no TTY or nonInteractive: true) auto-approves.
 * In interactive mode prompts the user for y/n input.
 */

import * as readline from "node:readline";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConfirmationOptions {
  /** The question / message to display to the user. */
  message: string;
  /** If true, pressing Enter without input answers "yes". Default: false. */
  defaultYes?: boolean;
  /** Auto-approve without prompting (e.g. CI mode). Default: false. */
  nonInteractive?: boolean;
}

export interface ConfirmationResult {
  /** Whether the action was confirmed. */
  confirmed: boolean;
  /** True when the result was determined automatically (non-interactive or no TTY). */
  autoApproved: boolean;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Show a confirmation prompt and wait for user input.
 *
 * - If `nonInteractive: true` or stdin is not a TTY: auto-approve and return
 *   `{ confirmed: true, autoApproved: true }`.
 * - Otherwise: display the message with [Y/n] or [y/N] hint, read one line,
 *   and return the result.
 *
 * @param opts - ConfirmationOptions
 * @returns Promise<ConfirmationResult>
 */
export async function confirmAction(opts: ConfirmationOptions): Promise<ConfirmationResult> {
  const { message, defaultYes = false, nonInteractive = false } = opts;

  // Auto-approve in non-interactive mode or when stdin is not a TTY
  if (nonInteractive || !process.stdin.isTTY) {
    return { confirmed: true, autoApproved: true };
  }

  const hint = defaultYes ? "[Y/n]" : "[y/N]";
  const CYAN = "\x1b[36m";
  const DIM = "\x1b[2m";
  const RESET = "\x1b[0m";

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise<ConfirmationResult>((resolve) => {
    rl.question(`${CYAN}?${RESET} ${message} ${DIM}${hint}${RESET} `, (answer) => {
      rl.close();
      const trimmed = answer.trim().toLowerCase();
      let confirmed: boolean;
      if (trimmed === "") {
        confirmed = defaultYes;
      } else {
        confirmed = /^y/.test(trimmed);
      }
      resolve({ confirmed, autoApproved: false });
    });
  });
}
