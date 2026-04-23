// ============================================================================
// packages/vscode/src/terminal-output-manager.ts
//
// Captures terminal output via onDidWriteTerminalData and maintains a
// per-terminal rolling buffer (8 KB max). Used by the @terminal context
// provider and by test-failure detection for the sidebar's auto-fix flow.
// ============================================================================

// Use a structural interface instead of vscode.TerminalDataWriteEvent to
// avoid depending on a specific @types/vscode version (onDidWriteTerminalData
// was added in VSCode 1.56 and may not be in the installed type definitions).
export interface TerminalDataEvent {
  terminal: { name: string };
  data: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_BYTES = 8_192;

/** Regex patterns that indicate a test failure in terminal output. */
const FAIL_RE = /(\d+\s+failed?|FAILED|FAIL\b|AssertionError|Error:)/;

// ── ANSI stripper ─────────────────────────────────────────────────────────────

/**
 * Strips ANSI/VT100 escape sequences from a string.
 * Handles CSI sequences (colour, cursor) and OSC sequences (window title).
 */
export function stripAnsi(s: string): string {
  return s
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "") // CSI sequences: ESC [ ... letter
    .replace(/\x1b\][^\x07]*\x07/g, "");    // OSC sequences: ESC ] ... BEL
}

// ── TerminalOutputManager ─────────────────────────────────────────────────────

/**
 * Listens to VSCode terminal data events and keeps a rolling 8 KB buffer
 * per terminal (keyed by terminal name).
 *
 * Wire-up in extension.ts:
 *   const mgr = new TerminalOutputManager();
 *   if (vscode.window.onDidWriteTerminalData) {
 *     context.subscriptions.push(
 *       vscode.window.onDidWriteTerminalData((e) => mgr.onData(e)),
 *     );
 *   }
 */
export class TerminalOutputManager {
  private readonly _buffers = new Map<string, string>();

  // ── Data ingestion ──────────────────────────────────────────────────────────

  /**
   * Called for every `TerminalDataWriteEvent`.
   * Strips ANSI codes, appends to the terminal's buffer, and trims to MAX_BYTES.
   */
  onData(e: TerminalDataEvent): void {
    const name = e.terminal.name;
    const stripped = stripAnsi(e.data);
    const current = (this._buffers.get(name) ?? "") + stripped;
    this._buffers.set(name, current.slice(-MAX_BYTES));
  }

  // ── Buffer access ───────────────────────────────────────────────────────────

  /**
   * Returns the buffered output for the given terminal name.
   * If `terminalName` is omitted, returns the buffer of the most recently
   * written-to terminal (useful when no terminal is explicitly active).
   */
  getBuffer(terminalName?: string): string {
    if (terminalName !== undefined) {
      return this._buffers.get(terminalName) ?? "";
    }
    // Return last-written terminal buffer
    const entries = Array.from(this._buffers.entries());
    return entries.length > 0 ? (entries[entries.length - 1]![1]) : "";
  }

  // ── Test-failure detection ──────────────────────────────────────────────────

  /**
   * Scans the named terminal's buffer for common test-failure indicators.
   * Returns the tail of the buffer from the last blank line before the match,
   * or null if no failure pattern is found.
   *
   * Matches: "2 failed", "FAILED", "FAIL ", "AssertionError", "Error:"
   */
  detectTestFailure(terminalName?: string): string | null {
    const buf = this.getBuffer(terminalName);
    const match = FAIL_RE.exec(buf);
    if (!match) return null;
    // Walk back to the nearest blank line before the match for clean context
    const matchStart = buf.indexOf(match[0]!);
    const blankBefore = buf.lastIndexOf("\n\n", matchStart);
    return buf.slice(Math.max(0, blankBefore));
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  /**
   * Clears the buffer for one terminal (or all terminals if no name given).
   */
  clear(terminalName?: string): void {
    if (terminalName !== undefined) {
      this._buffers.delete(terminalName);
    } else {
      this._buffers.clear();
    }
  }
}
