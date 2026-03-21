// ============================================================================
// @dantecode/cli — FleetDashboard
// Live terminal progress dashboard for council fleet execution.
//
// Shows all active lanes with: agent name, status, tokens, PDSE score,
// elapsed time, and progress hints. Redraws in-place using ANSI escape codes.
//
// Design: renderFleetDashboard is a pure function (state → string).
//         FleetDashboard.draw() is the only side effect (writes to stdout).
//         No external dependencies beyond ANSI escape codes.
// ============================================================================

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

/** Display state for a single fleet lane. */
export interface FleetLaneDisplay {
  laneId: string;
  agentName: string;
  agentKind: string;
  status: "pending" | "running" | "completed" | "failed" | "verifying" | "retrying";
  /** Progress hint, e.g. "writing src/auth.ts" or "running tests". */
  progressHint?: string;
  tokensUsed: number;
  pdseScore?: number;
  elapsedMs: number;
  worktreeBranch?: string;
}

/** Top-level fleet dashboard state. */
export interface FleetDashboardState {
  objective: string;
  runId: string;
  lanes: FleetLaneDisplay[];
  totalTokens: number;
  /** Remaining token budget, omitted when unlimited. */
  budgetRemaining?: number;
  elapsedMs: number;
  /** Orchestrator lifecycle status string. */
  status: string;
}

// ----------------------------------------------------------------------------
// ANSI helpers
// ----------------------------------------------------------------------------

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";

/** Move cursor up N lines. */
const CURSOR_UP = (n: number): string => `\x1b[${n}A`;
/** Move cursor to beginning of line. */
const CR = "\r";
/** Clear from cursor to end of line. */
const CLEAR_EOL = "\x1b[K";

function padRight(s: string, len: number): string {
  const stripped = stripAnsi(s);
  const pad = Math.max(0, len - stripped.length);
  return s + " ".repeat(pad);
}

/** Strip ANSI escape codes for length calculations. */
function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*[mAKJHF]/g, "");
}

function colorStatus(status: string): string {
  switch (status) {
    case "completed": return `${GREEN}${status}${RESET}`;
    case "failed": return `${RED}${status}${RESET}`;
    case "running": return `${CYAN}${status}${RESET}`;
    case "verifying": return `${CYAN}${status}${RESET}`;
    case "retrying": return `${YELLOW}${status}${RESET}`;
    case "pending": return `${DIM}${status}${RESET}`;
    default: return status;
  }
}

function getStatusIcon(status: FleetLaneDisplay["status"]): string {
  switch (status) {
    case "pending": return "[~]";
    case "running": return "[>]";
    case "completed": return "[+]";
    case "failed": return "[!]";
    case "verifying": return "[?]";
    case "retrying": return "[R]";
    default: return "[ ]";
  }
}

export function formatDuration(ms: number): string {
  if (ms < 1_000) return `${ms}ms`;
  if (ms < 60_000) return `${Math.floor(ms / 1_000)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1_000);
  return `${m}m${s}s`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function colorFleetStatus(status: string): string {
  if (status === "completed") return `${GREEN}${status}${RESET}`;
  if (status === "failed" || status === "blocked") return `${RED}${status}${RESET}`;
  if (status === "running" || status === "merging" || status === "verifying") return `${CYAN}${status}${RESET}`;
  return status;
}

// ----------------------------------------------------------------------------
// Pure render function
// ----------------------------------------------------------------------------

const BOX_WIDTH = 72;

/**
 * Render the fleet dashboard as a multi-line ANSI string.
 * Pure function: state in → formatted string out.
 */
export function renderFleetDashboard(state: FleetDashboardState): string {
  const lines: string[] = [];
  const w = BOX_WIDTH;

  const hr = "─".repeat(w - 2);

  // Header
  const objTrunc = state.objective.length > 45
    ? state.objective.slice(0, 42) + "..."
    : state.objective;
  const runIdShort = state.runId.slice(-8);
  lines.push(`${BOLD}╭${hr}╮${RESET}`);
  lines.push(
    `${BOLD}│${RESET} Fleet: ${CYAN}${objTrunc}${RESET}` +
    `${" ".repeat(Math.max(1, w - 10 - stripAnsi(objTrunc).length))}${BOLD}│${RESET}`,
  );

  // Stats row
  const tokenStr = formatTokens(state.totalTokens);
  const budgetStr = state.budgetRemaining !== undefined && state.budgetRemaining >= 0
    ? ` / ${formatTokens(state.budgetRemaining)}`
    : "";
  const statsLine =
    `run:${runIdShort}  ` +
    `status:${colorFleetStatus(state.status)}  ` +
    `time:${formatDuration(state.elapsedMs)}  ` +
    `tokens:${tokenStr}${budgetStr}`;
  const statsLinePad = w - 4 - stripAnsi(statsLine).length;
  lines.push(
    `${BOLD}│${RESET} ${statsLine}${" ".repeat(Math.max(0, statsLinePad))} ${BOLD}│${RESET}`,
  );
  lines.push(`${BOLD}├${hr}┤${RESET}`);

  // Column header
  const colHeader = `${DIM}  icon  agent         status       tokens   PDSE   time     progress${RESET}`;
  lines.push(`${BOLD}│${RESET}${colHeader}${" ".repeat(Math.max(0, w - 2 - stripAnsi(colHeader).length))}${BOLD}│${RESET}`);
  lines.push(`${BOLD}├${"─".repeat(w - 2)}┤${RESET}`);

  // Lane rows
  if (state.lanes.length === 0) {
    const noLanes = "  No lanes assigned yet.";
    lines.push(
      `${BOLD}│${RESET}${noLanes}${" ".repeat(Math.max(0, w - 2 - noLanes.length))}${BOLD}│${RESET}`,
    );
  } else {
    for (const lane of state.lanes) {
      const icon = getStatusIcon(lane.status);
      const agentName = padRight(lane.agentName.slice(0, 12), 12);
      const status = padRight(colorStatus(lane.status), 10 + (colorStatus(lane.status).length - lane.status.length));
      const tokens = padRight(formatTokens(lane.tokensUsed), 7);
      const pdse = lane.pdseScore !== undefined
        ? padRight(String(Math.round(lane.pdseScore)), 6)
        : padRight("--", 6);
      const elapsed = padRight(formatDuration(lane.elapsedMs), 8);
      const hint = (lane.progressHint ?? "").slice(0, 20);

      const rowContent = `  ${icon}  ${agentName}  ${status}  ${tokens}  ${pdse}  ${elapsed}  ${hint}`;
      const rawLen = stripAnsi(rowContent).length;
      const padding = " ".repeat(Math.max(0, w - 2 - rawLen));
      lines.push(`${BOLD}│${RESET}${rowContent}${padding}${BOLD}│${RESET}`);
    }
  }

  lines.push(`${BOLD}╰${hr}╯${RESET}`);
  return lines.join("\n");
}

// ----------------------------------------------------------------------------
// FleetDashboard class
// ----------------------------------------------------------------------------

/**
 * Fleet dashboard that redraws in-place using ANSI cursor control.
 *
 * Usage:
 *   const dashboard = new FleetDashboard(initialState);
 *   dashboard.draw();   // initial draw
 *   // update on events:
 *   dashboard.updateLane(laneId, { status: "completed" });
 *   dashboard.draw();   // redraw in place
 *   dashboard.clear();  // remove from terminal
 */
export class FleetDashboard {
  private state: FleetDashboardState;
  private lastLineCount = 0;
  private enabled: boolean;

  constructor(initialState: FleetDashboardState, opts?: { enabled?: boolean }) {
    this.state = {
      ...initialState,
      lanes: initialState.lanes.map((l) => ({ ...l })),
    };
    // Disable if stdout is not a TTY (e.g. CI, piped output).
    this.enabled = opts?.enabled ?? Boolean(process.stdout.isTTY);
  }

  /** Update a specific lane's display state. */
  updateLane(laneId: string, patch: Partial<FleetLaneDisplay>): void {
    const idx = this.state.lanes.findIndex((l) => l.laneId === laneId);
    if (idx !== -1) {
      this.state.lanes[idx] = { ...this.state.lanes[idx]!, ...patch };
    } else {
      // Lane not found by ID — try by agent name (useful before laneId is known).
      const byName = patch.agentName
        ? this.state.lanes.findIndex((l) => l.agentName === patch.agentName)
        : -1;
      if (byName !== -1) {
        this.state.lanes[byName] = {
          ...this.state.lanes[byName]!,
          ...patch,
          laneId,
        };
      }
    }
  }

  /** Update fleet-level state (not lane-specific). */
  updateFleet(patch: Partial<Omit<FleetDashboardState, "lanes">>): void {
    this.state = { ...this.state, ...patch };
  }

  /**
   * Redraw the dashboard in place using ANSI cursor positioning.
   * On the first call, simply prints. On subsequent calls, moves the cursor
   * up and overwrites previous output.
   */
  draw(): void {
    const rendered = renderFleetDashboard(this.state);
    const lines = rendered.split("\n");
    const lineCount = lines.length;

    if (!this.enabled) return;

    if (this.lastLineCount > 0) {
      // Move cursor up to the start of previous render.
      process.stdout.write(CURSOR_UP(this.lastLineCount));
    }

    for (const line of lines) {
      process.stdout.write(CR + CLEAR_EOL + line + "\n");
    }

    this.lastLineCount = lineCount;
  }

  /**
   * Clear the dashboard from the terminal (overwrite with blank lines).
   */
  clear(): void {
    if (!this.enabled || this.lastLineCount === 0) return;
    process.stdout.write(CURSOR_UP(this.lastLineCount));
    for (let i = 0; i < this.lastLineCount; i++) {
      process.stdout.write(CR + CLEAR_EOL + "\n");
    }
    process.stdout.write(CURSOR_UP(this.lastLineCount));
    this.lastLineCount = 0;
  }

  /** Get current state snapshot (for testing). */
  getState(): FleetDashboardState {
    return { ...this.state, lanes: this.state.lanes.map((l) => ({ ...l })) };
  }
}
