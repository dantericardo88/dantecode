/**
 * screen-reader.ts — @dantecode/ux-polish
 *
 * Screen reader support hooks for DanteCode CLI and VS Code surfaces.
 * Provides ARIA-equivalent text alternatives, reduced-motion detection,
 * and accessible output modes.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScreenReaderOptions {
  /** Force screen reader mode regardless of environment detection. */
  forceEnabled?: boolean;
  /** Include position/total context in progress announcements. Default: true. */
  includePosition?: boolean;
}

export interface AccessibleAnnouncement {
  /** The text to be read aloud. */
  text: string;
  /** Urgency: "assertive" interrupts, "polite" waits for idle. */
  politeness: "assertive" | "polite";
  /** Underlying semantic role. */
  role: "status" | "alert" | "progress" | "log" | "dialog";
}

// ---------------------------------------------------------------------------
// Environment detection
// ---------------------------------------------------------------------------

/**
 * Detect whether screen reader mode should be active.
 * Checks for known environment variables and flags.
 */
export function detectScreenReaderMode(): boolean {
  if (typeof process === "undefined") return false;
  const env = process.env;
  // Explicit opt-in via DANTE_A11Y or standard AT_SPI_BUS (Linux AT-SPI)
  if (env["DANTE_A11Y"] === "1" || env["FORCE_A11Y"] === "1") return true;
  if (env["AT_SPI_BUS_ADDRESS"]) return true;
  // CI environments with accessibility tooling
  if (env["NVDA_RUNNING"] || env["JAWS_RUNNING"]) return true;
  return false;
}

/**
 * Detect whether reduced motion is preferred (terminal equivalent).
 * When true, spinners/animations should be suppressed.
 */
export function detectReducedMotion(): boolean {
  if (typeof process === "undefined") return false;
  const env = process.env;
  return (
    env["PREFERS_REDUCED_MOTION"] === "1" ||
    env["DANTE_REDUCED_MOTION"] === "1" ||
    env["NO_ANIMATION"] === "1"
  );
}

// ---------------------------------------------------------------------------
// ScreenReaderSupport
// ---------------------------------------------------------------------------

export class ScreenReaderSupport {
  private readonly _enabled: boolean;
  private readonly _includePosition: boolean;
  private readonly _log: AccessibleAnnouncement[] = [];

  constructor(options: ScreenReaderOptions = {}) {
    this._enabled = options.forceEnabled ?? detectScreenReaderMode();
    this._includePosition = options.includePosition ?? true;
  }

  /** Whether screen reader mode is active. */
  get enabled(): boolean {
    return this._enabled;
  }

  // -------------------------------------------------------------------------
  // Announcement builders
  // -------------------------------------------------------------------------

  /** Build an announcement for a status change. */
  announceStatus(message: string): AccessibleAnnouncement {
    const ann: AccessibleAnnouncement = {
      text: message,
      politeness: "polite",
      role: "status",
    };
    this._log.push(ann);
    return ann;
  }

  /** Build an urgent announcement (error or critical state change). */
  announceAlert(message: string): AccessibleAnnouncement {
    const ann: AccessibleAnnouncement = {
      text: message,
      politeness: "assertive",
      role: "alert",
    };
    this._log.push(ann);
    return ann;
  }

  /** Build a progress announcement. */
  announceProgress(
    phase: string,
    percent: number | undefined,
    position?: { current: number; total: number },
  ): AccessibleAnnouncement {
    let text = `${phase}`;
    if (percent !== undefined) text += `, ${Math.round(percent)}% complete`;
    if (this._includePosition && position) {
      text += `, step ${position.current} of ${position.total}`;
    }

    const ann: AccessibleAnnouncement = {
      text,
      politeness: "polite",
      role: "progress",
    };
    this._log.push(ann);
    return ann;
  }

  // -------------------------------------------------------------------------
  // Text transformation
  // -------------------------------------------------------------------------

  /**
   * Strip ANSI escape codes from text for screen reader output.
   * Screen readers cannot interpret ANSI — they need plain text.
   */
  stripAnsi(text: string): string {
    // eslint-disable-next-line no-control-regex
    return text.replace(/\x1b\[[0-9;]*m/g, "");
  }

  /**
   * Expand icon/emoji to readable text equivalents when in screen reader mode.
   * If not in SR mode, returns text unchanged.
   */
  expandIcons(text: string): string {
    if (!this._enabled) return text;
    return text
      .replace(/✓/g, "success")
      .replace(/✗/g, "failed")
      .replace(/⚠/g, "warning")
      .replace(/ℹ/g, "info")
      .replace(/▶/g, "running")
      .replace(/○/g, "pending")
      .replace(/◉/g, "in progress")
      .replace(/⊘/g, "skipped")
      .replace(/🚀/g, "start")
      .replace(/💡/g, "hint");
  }

  /**
   * Format text for screen reader output: strip ANSI + expand icons.
   */
  format(text: string): string {
    return this.expandIcons(this.stripAnsi(text));
  }

  // -------------------------------------------------------------------------
  // Log access (for testing / VS Code announcement bridge)
  // -------------------------------------------------------------------------

  /** Get all announcements made during this session. */
  getLog(): AccessibleAnnouncement[] {
    return [...this._log];
  }

  /** Clear the announcement log. */
  clearLog(): void {
    this._log.length = 0;
  }
}
