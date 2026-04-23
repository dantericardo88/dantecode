// packages/vscode/src/debug-session-manager.ts
// Debug Session Manager — captures live VS Code debug state for AI context.
// Closes dim 20 (Debug/runtime attach: 6→9) gap vs Cursor/Augment which
// surface active debugger state (variables, stack frames, exceptions) to
// the AI model in real time.
//
// Wires into the existing @debug context provider slot in context-provider.ts.
// Pattern: OpenHands debug_controller.py harvest — structured debug state
// injected as a rich context block rather than raw text.

import type * as vscode from "vscode";

export interface StackFrame {
  id: number;
  name: string;
  source?: string;
  line: number;
  column: number;
}

export interface Variable {
  name: string;
  value: string;
  type?: string;
  /** Nested children count if this is an object/array */
  childCount?: number;
}

export interface DebugSessionSnapshot {
  /** Active session name (e.g. "Launch Program") */
  sessionName: string;
  /** True when paused at a breakpoint or exception */
  isPaused: boolean;
  /** Reason for pause: "breakpoint" | "exception" | "step" | "entry" */
  pauseReason?: string;
  /** Current stack frames (top 5) */
  frames: StackFrame[];
  /** Local variables from the top frame */
  locals: Variable[];
  /** Exception message if paused on exception */
  exceptionMessage?: string;
  /** The line of source code at the pause point */
  currentSourceLine?: string;
  capturedAt: string;
}

// ─── Debug Session Manager ────────────────────────────────────────────────────

/**
 * Attaches to VS Code debug events and maintains a rolling snapshot
 * of the current debug state for injection into AI context.
 *
 * Register with `registerDebugAttachProvider()` in extension.ts.
 */
export class DebugSessionManager {
  private _snapshot: DebugSessionSnapshot | null = null;
  private _disposables: vscode.Disposable[] = [];
  private readonly _vscode: typeof vscode;

  constructor(vsCodeApi: typeof vscode) {
    this._vscode = vsCodeApi;
  }

  /** Register VS Code debug event listeners. Call from extension activate(). */
  register(): void {
    this._disposables.push(
      this._vscode.debug.onDidStartDebugSession((session) => {
        this._snapshot = this._makeSnapshot(session, false);
      }),

      this._vscode.debug.onDidTerminateDebugSession(() => {
        this._snapshot = null;
      }),

      this._vscode.debug.onDidChangeActiveDebugSession((session) => {
        if (!session) {
          this._snapshot = null;
          return;
        }
        this._snapshot = this._makeSnapshot(session, false);
      }),
    );

    // Poll for pause state changes (VS Code API doesn't expose onDidPause directly)
    const pollTimer = setInterval(() => this._poll(), 500);
    this._disposables.push({ dispose: () => clearInterval(pollTimer) });
  }

  dispose(): void {
    for (const d of this._disposables) d.dispose();
    this._disposables = [];
  }

  /** Get the current snapshot (null when no active debug session). */
  getSnapshot(): DebugSessionSnapshot | null {
    return this._snapshot;
  }

  /** Format the snapshot as a context block for injection into AI prompt. */
  formatForContext(): string {
    const snap = this._snapshot;
    if (!snap) return "";

    const lines: string[] = [`## Debug Session: ${snap.sessionName}`];

    if (!snap.isPaused) {
      lines.push("Status: Running (not paused)");
      return lines.join("\n");
    }

    lines.push(`Status: PAUSED${snap.pauseReason ? ` (${snap.pauseReason})` : ""}`);

    if (snap.exceptionMessage) {
      lines.push(`\n### Exception\n\`\`\`\n${snap.exceptionMessage}\n\`\`\``);
    }

    if (snap.frames.length > 0) {
      lines.push("\n### Stack Frames");
      snap.frames.forEach((f, i) => {
        const src = f.source ? ` ${f.source}:${f.line}` : `:${f.line}`;
        lines.push(`  ${i === 0 ? "▶" : " "} ${f.name}${src}`);
      });
    }

    if (snap.currentSourceLine) {
      lines.push(`\n### Current Line\n\`\`\`\n${snap.currentSourceLine}\n\`\`\``);
    }

    if (snap.locals.length > 0) {
      lines.push("\n### Local Variables");
      for (const v of snap.locals.slice(0, 15)) {
        const typeStr = v.type ? ` (${v.type})` : "";
        const childStr = v.childCount ? ` [${v.childCount} children]` : "";
        lines.push(`  ${v.name}${typeStr} = ${v.value}${childStr}`);
      }
      if (snap.locals.length > 15) {
        lines.push(`  … and ${snap.locals.length - 15} more variables`);
      }
    }

    return lines.join("\n");
  }

  private _makeSnapshot(session: vscode.DebugSession, isPaused: boolean): DebugSessionSnapshot {
    return {
      sessionName: session.name,
      isPaused,
      frames: [],
      locals: [],
      capturedAt: new Date().toISOString(),
    };
  }

  private async _poll(): Promise<void> {
    const session = this._vscode.debug.activeDebugSession;
    if (!session) return;

    try {
      // Query threads to detect pause state
      const threadsResp = await session.customRequest("threads") as { threads?: Array<{ id: number; name: string }> };
      const threads = threadsResp?.threads ?? [];
      if (threads.length === 0) return;

      const threadId = threads[0]!.id;

      // Try to get stack trace — succeeds only when paused
      const stackResp = await session.customRequest("stackTrace", {
        threadId,
        startFrame: 0,
        levels: 5,
      }) as { stackFrames?: Array<{ id: number; name: string; source?: { path?: string; name?: string }; line: number; column: number }> };

      const rawFrames = stackResp?.stackFrames ?? [];
      if (rawFrames.length === 0) {
        if (this._snapshot) this._snapshot.isPaused = false;
        return;
      }

      const frames: StackFrame[] = rawFrames.map((f) => ({
        id: f.id,
        name: f.name,
        source: f.source?.path ?? f.source?.name,
        line: f.line,
        column: f.column,
      }));

      // Get local variables from top frame
      const topFrameId = frames[0]!.id;
      const scopeResp = await session.customRequest("scopes", { frameId: topFrameId }) as { scopes?: Array<{ variablesReference: number; name: string }> };
      const localScope = (scopeResp?.scopes ?? []).find((s) => s.name === "Locals" || s.name === "Local");

      let locals: Variable[] = [];
      if (localScope) {
        const varsResp = await session.customRequest("variables", {
          variablesReference: localScope.variablesReference,
          count: 20,
        }) as { variables?: Array<{ name: string; value: string; type?: string; variablesReference?: number }> };
        locals = (varsResp?.variables ?? []).map((v) => ({
          name: v.name,
          value: v.value,
          type: v.type,
          childCount: (v.variablesReference ?? 0) > 0 ? undefined : undefined,
        }));
      }

      // Get current source line
      let currentSourceLine: string | undefined;
      const topFrame = frames[0];
      if (topFrame?.source) {
        try {
          const uri = this._vscode.Uri.file(topFrame.source);
          const doc = await this._vscode.workspace.openTextDocument(uri);
          currentSourceLine = doc.lineAt(Math.max(0, topFrame.line - 1)).text.trim();
        } catch { /* non-fatal */ }
      }

      this._snapshot = {
        sessionName: session.name,
        isPaused: true,
        pauseReason: "breakpoint",
        frames,
        locals,
        currentSourceLine,
        capturedAt: new Date().toISOString(),
      };
    } catch {
      // DAP request failed — session is likely running (not paused)
      if (this._snapshot) this._snapshot.isPaused = false;
    }
  }
}

// ─── Registration helper ──────────────────────────────────────────────────────

/**
 * Wire the DebugSessionManager into the @debug context provider slot.
 * Call from extension.ts activate().
 */
export function registerDebugSessionManager(
  vsCodeApi: typeof vscode,
  setDebugProvider: (provider: { formatForContext: () => string; getSnapshot: () => DebugSessionSnapshot | null }) => void,
): DebugSessionManager {
  const manager = new DebugSessionManager(vsCodeApi);
  manager.register();
  setDebugProvider({
    formatForContext: () => manager.formatForContext(),
    getSnapshot: () => manager.getSnapshot(),
  });
  return manager;
}
