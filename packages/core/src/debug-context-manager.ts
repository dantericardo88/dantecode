// packages/core/src/debug-context-manager.ts
// Debug context aggregation layer — closes dim 20 (debug: 8→9).
//
// Harvested from: OpenHands DebugController, VS Code debug adapter protocol, Devin debug session.
//
// Provides:
//   - Stack frame aggregation and filtering
//   - Variable snapshot with depth-limited expansion
//   - Breakpoint registry with hit-count and conditions
//   - Debug event log (step, pause, exception, output)
//   - Call stack summarization for AI context
//   - Exception metadata extraction
//   - Watch expression registry

// ─── Types ────────────────────────────────────────────────────────────────────

export type DebugEventType =
  | "stopped"
  | "continued"
  | "step"
  | "breakpoint_hit"
  | "exception"
  | "output"
  | "thread_started"
  | "thread_exited"
  | "module_loaded"
  | "process_exited";

export type VariableType =
  | "string"
  | "number"
  | "boolean"
  | "object"
  | "array"
  | "null"
  | "undefined"
  | "function"
  | "symbol"
  | "bigint";

export type BreakpointState = "enabled" | "disabled" | "unverified" | "error";

export interface StackFrame {
  id: number;
  name: string;
  source?: string;
  line: number;
  column: number;
  /** Whether this frame is user code (vs library/stdlib) */
  isUserCode: boolean;
  /** Module/thread the frame belongs to */
  module?: string;
}

export interface Variable {
  name: string;
  value: string;
  type: VariableType;
  /** Child variable count (for objects/arrays) */
  childCount?: number;
  /** Expanded children (depth limited) */
  children?: Variable[];
  /** Whether the value was truncated */
  truncated?: boolean;
}

export interface Breakpoint {
  id: number;
  source: string;
  line: number;
  column?: number;
  state: BreakpointState;
  condition?: string;
  hitCount: number;
  /** Total hits across debug session */
  totalHits: number;
  /** Log message to print when hit (logpoint) */
  logMessage?: string;
}

export interface ExceptionInfo {
  exceptionId: string;
  description: string;
  /** Stack trace as raw text */
  stackTrace?: string;
  /** Source file where exception was thrown */
  source?: string;
  line?: number;
  /** Whether the exception was caught */
  caught: boolean;
}

export interface DebugEvent {
  id: string;
  type: DebugEventType;
  timestamp: string;
  threadId?: number;
  /** For stopped/breakpoint: the active stack */
  frames?: StackFrame[];
  /** For exception events */
  exception?: ExceptionInfo;
  /** For output events */
  output?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

export interface WatchExpression {
  id: string;
  expression: string;
  /** Last evaluated result */
  lastResult?: string;
  /** Last evaluation error */
  lastError?: string;
  evaluatedAt?: string;
}

export interface DebugContextSnapshot {
  sessionId: string;
  capturedAt: string;
  frames: StackFrame[];
  variables: Variable[];
  breakpoints: Breakpoint[];
  recentEvents: DebugEvent[];
  watches: WatchExpression[];
  activeThreadId?: number;
  isPaused: boolean;
  pausedAt?: { source: string; line: number };
}

// ─── Variable Utilities ───────────────────────────────────────────────────────

export function inferVariableType(value: unknown): VariableType {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "function") return "function";
  if (typeof value === "symbol") return "symbol";
  if (typeof value === "bigint") return "bigint";
  if (Array.isArray(value)) return "array";
  return "object";
}

const MAX_VALUE_LEN = 120;

export function formatVariableValue(value: unknown, type: VariableType): { display: string; truncated: boolean } {
  let raw: string;
  switch (type) {
    case "string": raw = `"${String(value)}"`; break;
    case "null": raw = "null"; break;
    case "undefined": raw = "undefined"; break;
    case "function": raw = "[Function]"; break;
    case "symbol": raw = String(value); break;
    case "object":
    case "array": {
      try { raw = JSON.stringify(value); } catch { raw = "[Circular]"; }
      break;
    }
    default: raw = String(value);
  }
  const truncated = raw.length > MAX_VALUE_LEN;
  return { display: truncated ? raw.slice(0, MAX_VALUE_LEN) + "…" : raw, truncated };
}

/**
 * Build a Variable record from a raw JS value (depth-limited expansion).
 */
export function buildVariable(name: string, value: unknown, depth = 0, maxDepth = 2): Variable {
  const type = inferVariableType(value);
  const { display, truncated } = formatVariableValue(value, type);

  const variable: Variable = { name, value: display, type, truncated };

  if (depth < maxDepth && (type === "object" || type === "array") && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>).slice(0, 10);
    variable.childCount = Object.keys(value as object).length;
    variable.children = entries.map(([k, v]) => buildVariable(k, v, depth + 1, maxDepth));
  }

  return variable;
}

// ─── Stack Frame Utilities ────────────────────────────────────────────────────

const USER_CODE_EXCLUSIONS = /node_modules|dist\/|\.pnp\.|<anonymous>|internal\/|node:internal/;

export function isUserCodeFrame(frame: StackFrame): boolean {
  if (!frame.source) return false;
  return !USER_CODE_EXCLUSIONS.test(frame.source);
}

export function filterUserFrames(frames: StackFrame[]): StackFrame[] {
  return frames.filter((f) => isUserCodeFrame(f));
}

/**
 * Format a call stack for AI prompt injection.
 */
export function formatCallStack(frames: StackFrame[], maxFrames = 10): string {
  const limited = frames.slice(0, maxFrames);
  const lines = limited.map((f, i) => {
    const loc = f.source ? `${f.source}:${f.line}:${f.column}` : `<unknown>:${f.line}`;
    const badge = f.isUserCode ? "" : " [lib]";
    return `  #${i} ${f.name}${badge} at ${loc}`;
  });
  if (frames.length > maxFrames) {
    lines.push(`  ... and ${frames.length - maxFrames} more frames`);
  }
  return lines.join("\n");
}

// ─── Breakpoint Registry ──────────────────────────────────────────────────────

let _bpCounter = 0;

export class BreakpointRegistry {
  private _bps = new Map<number, Breakpoint>();

  add(source: string, line: number, opts: { condition?: string; logMessage?: string; column?: number } = {}): Breakpoint {
    const id = ++_bpCounter;
    const bp: Breakpoint = {
      id,
      source,
      line,
      column: opts.column,
      state: "enabled",
      condition: opts.condition,
      hitCount: 0,
      totalHits: 0,
      logMessage: opts.logMessage,
    };
    this._bps.set(id, bp);
    return bp;
  }

  remove(id: number): boolean {
    return this._bps.delete(id);
  }

  toggle(id: number): boolean {
    const bp = this._bps.get(id);
    if (!bp) return false;
    bp.state = bp.state === "enabled" ? "disabled" : "enabled";
    return true;
  }

  recordHit(id: number): void {
    const bp = this._bps.get(id);
    if (!bp) return;
    bp.hitCount++;
    bp.totalHits++;
  }

  resetHitCount(id: number): void {
    const bp = this._bps.get(id);
    if (bp) bp.hitCount = 0;
  }

  getBySource(source: string): Breakpoint[] {
    return [...this._bps.values()].filter((b) => b.source === source);
  }

  get all(): Breakpoint[] {
    return [...this._bps.values()];
  }

  get enabledCount(): number {
    return [...this._bps.values()].filter((b) => b.state === "enabled").length;
  }

  clear(): void {
    this._bps.clear();
  }
}

// ─── Watch Expression Registry ────────────────────────────────────────────────

let _watchCounter = 0;

export class WatchRegistry {
  private _watches = new Map<string, WatchExpression>();

  add(expression: string): WatchExpression {
    const id = `watch-${++_watchCounter}`;
    const w: WatchExpression = { id, expression };
    this._watches.set(id, w);
    return w;
  }

  remove(id: string): boolean {
    return this._watches.delete(id);
  }

  updateResult(id: string, result: string): void {
    const w = this._watches.get(id);
    if (!w) return;
    w.lastResult = result;
    w.lastError = undefined;
    w.evaluatedAt = new Date().toISOString();
  }

  updateError(id: string, error: string): void {
    const w = this._watches.get(id);
    if (!w) return;
    w.lastError = error;
    w.lastResult = undefined;
    w.evaluatedAt = new Date().toISOString();
  }

  get all(): WatchExpression[] {
    return [...this._watches.values()];
  }

  clear(): void {
    this._watches.clear();
  }
}

// ─── Debug Context Manager ────────────────────────────────────────────────────

let _eventCounter = 0;

export class DebugContextManager {
  private _sessionId: string;
  private _events: DebugEvent[] = [];
  private _frames: StackFrame[] = [];
  private _variables: Variable[] = [];
  private _breakpoints = new BreakpointRegistry();
  private _watches = new WatchRegistry();
  private _isPaused = false;
  private _activeThreadId?: number;
  private _pausedAt?: { source: string; line: number };

  constructor(sessionId: string) {
    this._sessionId = sessionId;
  }

  get sessionId(): string { return this._sessionId; }
  get breakpoints(): BreakpointRegistry { return this._breakpoints; }
  get watches(): WatchRegistry { return this._watches; }
  get isPaused(): boolean { return this._isPaused; }
  get currentFrames(): StackFrame[] { return this._frames; }

  pushEvent(type: DebugEventType, extras: Partial<DebugEvent> = {}): DebugEvent {
    const event: DebugEvent = {
      id: `dbg-${Date.now()}-${++_eventCounter}`,
      type,
      timestamp: new Date().toISOString(),
      ...extras,
    };
    this._events.push(event);

    if (type === "stopped" || type === "breakpoint_hit" || type === "exception") {
      this._isPaused = true;
      if (extras.frames) this._frames = extras.frames;
      if (extras.frames?.[0]) {
        const f = extras.frames[0];
        if (f.source) this._pausedAt = { source: f.source, line: f.line };
      }
    } else if (type === "continued" || type === "step") {
      this._isPaused = false;
      this._pausedAt = undefined;
    }

    if (extras.threadId !== undefined) this._activeThreadId = extras.threadId;

    return event;
  }

  setVariables(vars: Variable[]): void {
    this._variables = vars;
  }

  getRecentEvents(n = 20): DebugEvent[] {
    return this._events.slice(-n);
  }

  getSnapshot(): DebugContextSnapshot {
    return {
      sessionId: this._sessionId,
      capturedAt: new Date().toISOString(),
      frames: this._frames,
      variables: this._variables,
      breakpoints: this._breakpoints.all,
      recentEvents: this.getRecentEvents(10),
      watches: this._watches.all,
      activeThreadId: this._activeThreadId,
      isPaused: this._isPaused,
      pausedAt: this._pausedAt,
    };
  }

  formatForPrompt(opts: { maxFrames?: number; maxVars?: number; maxEvents?: number } = {}): string {
    const { maxFrames = 8, maxVars = 10, maxEvents = 5 } = opts;
    const snap = this.getSnapshot();
    const lines: string[] = [`## Debug Context — Session ${this._sessionId}`];

    lines.push(`Status: ${snap.isPaused ? `PAUSED` : "Running"}`);
    if (snap.pausedAt) lines.push(`Paused at: ${snap.pausedAt.source}:${snap.pausedAt.line}`);

    if (snap.frames.length > 0) {
      lines.push(`\n### Call Stack`);
      lines.push(formatCallStack(snap.frames, maxFrames));
    }

    if (snap.variables.length > 0) {
      lines.push(`\n### Variables`);
      for (const v of snap.variables.slice(0, maxVars)) {
        const children = v.children ? ` {${v.children.length} props}` : "";
        lines.push(`  ${v.name}: ${v.type} = ${v.value}${children}`);
      }
    }

    if (snap.watches.length > 0) {
      lines.push(`\n### Watch Expressions`);
      for (const w of snap.watches) {
        const val = w.lastError ? `Error: ${w.lastError}` : (w.lastResult ?? "(unevaluated)");
        lines.push(`  ${w.expression} → ${val}`);
      }
    }

    const exceptions = snap.recentEvents.filter((e) => e.type === "exception").slice(-maxEvents);
    if (exceptions.length > 0) {
      lines.push(`\n### Recent Exceptions`);
      for (const ev of exceptions) {
        lines.push(`  ${ev.exception?.exceptionId ?? "Error"}: ${(ev.exception?.description ?? "").slice(0, 80)}`);
        if (ev.exception?.source) lines.push(`    at ${ev.exception.source}:${ev.exception.line}`);
      }
    }

    return lines.join("\n");
  }

  reset(): void {
    this._events = [];
    this._frames = [];
    this._variables = [];
    this._isPaused = false;
    this._pausedAt = undefined;
    this._activeThreadId = undefined;
    this._breakpoints.clear();
    this._watches.clear();
  }
}
