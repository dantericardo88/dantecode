// File: packages/vscode/src/debug-attach-provider.ts
// Injects active debug session context (stack frames, variables, exceptions)
// into DanteCode chat via @debug context mention.
import * as vscode from "vscode";
import { DebugContextManager } from "@dantecode/core";

export interface DebugFrame {
  name: string; // function/method name
  source: string; // file path or "<unknown>"
  line: number;
  variables: Record<string, string>; // name → string representation
}

export interface DebugSnapshot {
  threadId: number;
  stopReason: string; // "exception", "breakpoint", "step", "entry"
  frames: DebugFrame[];
  exceptionMessage?: string;
}

export class DebugAttachProvider implements vscode.Disposable {
  private _lastSnapshot: DebugSnapshot | null = null;
  private _snapshotConsumed = true;
  private _disposables: vscode.Disposable[] = [];
  /** Full-featured debug context manager — wired Sprint 15 */
  readonly debugContextManager: DebugContextManager = new DebugContextManager("vscode-debug");

  getSnapshot(): DebugSnapshot | null {
    return this._lastSnapshot;
  }

  /** True when a new snapshot has been set since the last markConsumed() call. */
  hasNewSnapshot(): boolean {
    return !this._snapshotConsumed && this._lastSnapshot !== null;
  }

  /** Mark the current snapshot as consumed so hasNewSnapshot() returns false. */
  markConsumed(): void {
    this._snapshotConsumed = true;
  }

  formatForContext(): string {
    if (!this._lastSnapshot) {
      return "";
    }
    const snap = this._lastSnapshot;
    const topFrame = snap.frames[0];
    const lines: string[] = [
      `**Status**: paused at ${snap.stopReason}`,
    ];
    if (topFrame) {
      lines.push(`**Location**: ${topFrame.source}:${topFrame.line}`);
    }
    lines.push(`**Call stack depth**: ${snap.frames.length} frame${snap.frames.length === 1 ? "" : "s"}`);
    if (snap.exceptionMessage) {
      lines.push(`**Exception**: ${snap.exceptionMessage.slice(0, 200)}`);
    }
    if (topFrame && Object.keys(topFrame.variables).length > 0) {
      lines.push(`**Variables** (top frame):`);
      for (const [name, val] of Object.entries(topFrame.variables).slice(0, 10)) {
        const truncated = val.length > 200 ? val.slice(0, 197) + "..." : val;
        lines.push(`  \u2022 ${name}: ${truncated}`);
      }
    }
    const managerContext = this.debugContextManager.formatForPrompt();
    if (managerContext) {
      lines.push(managerContext);
    }
    return `## Debug Context\n${lines.join("\n")}`;
  }

  activate(context: vscode.ExtensionContext): vscode.Disposable[] {
    void context; // reserved for future asset URIs
    const d1 = vscode.debug.onDidStartDebugSession(() => {
      this._lastSnapshot = null; // Clear on new session
    });
    const d3 = vscode.debug.onDidTerminateDebugSession(() => {
      // Keep last snapshot available for post-mortem analysis
    });

    // DebugAdapterTrackerFactory fires for ALL adapters (Node, Python, Go, Rust…)
    // unlike onDidReceiveDebugSessionCustomEvent which only fires for custom events.
    let trackerFactory: vscode.Disposable | undefined;
    try {
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      const self = this;
      trackerFactory = vscode.debug.registerDebugAdapterTrackerFactory("*", {
        createDebugAdapterTracker(session: vscode.DebugSession): vscode.DebugAdapterTracker {
          return {
            onDidSendMessage(msg: { type: string; event?: string; body?: { reason?: string; threadId?: number } }) {
              if (msg.type === "event" && msg.event === "stopped") {
                void self._captureSnapshot(session, msg.body ?? {});
              }
            },
          };
        },
      });
    } catch {
      // Fallback: use the legacy event listener if registerDebugAdapterTrackerFactory is unavailable
      const d2 = vscode.debug.onDidReceiveDebugSessionCustomEvent((e) => {
        if (e.event === "stopped") {
          void this._captureSnapshot(e.session, e.body as { reason: string; threadId?: number });
        }
      });
      this._disposables = [d1, d2, d3];
      return [d1, d2, d3];
    }

    this._disposables = [d1, trackerFactory, d3];
    return [d1, trackerFactory, d3];
  }

  dispose(): void {
    this._disposables.forEach((d) => d.dispose());
    this._disposables = [];
    this._lastSnapshot = null;
  }

  private async _captureSnapshot(
    session: vscode.DebugSession,
    body: { reason?: string; threadId?: number },
  ): Promise<void> {
    try {
      // Try the stopped thread first, then fall back to threads 1 and 2
      const candidateThreadIds: number[] = [];
      if (body.threadId != null) candidateThreadIds.push(body.threadId);
      for (const fallback of [1, 2, 3]) {
        if (!candidateThreadIds.includes(fallback)) candidateThreadIds.push(fallback);
      }

      let threadId = candidateThreadIds[0]!;
      let stackTraceResponse: { stackFrames: Array<{ id: number; name: string; source?: { path?: string }; line: number }> } | null = null;

      // Find the first thread that has stack frames
      for (const tid of candidateThreadIds.slice(0, 3)) {
        try {
          const resp = (await session.customRequest("stackTrace", {
            threadId: tid, startFrame: 0, levels: 5,
          })) as { stackFrames: Array<{ id: number; name: string; source?: { path?: string }; line: number }> };
          if (resp.stackFrames?.length > 0) {
            threadId = tid;
            stackTraceResponse = resp;
            break;
          }
        } catch {
          // Thread not suspended — try next
        }
      }

      const stackFrames = stackTraceResponse?.stackFrames ?? [];
      const topFrames = stackFrames.slice(0, 3);

      // Step 3: For each top frame, get scopes and variables
      const frames: DebugFrame[] = [];
      for (const sf of topFrames) {
        const scopesResponse = (await session.customRequest("scopes", {
          frameId: sf.id,
        })) as { scopes: Array<{ variablesReference: number }> };

        const variablesRef = scopesResponse.scopes[0]?.variablesReference ?? 0;
        const variablesResponse = (await session.customRequest("variables", {
          variablesReference: variablesRef,
          count: 20,
        })) as { variables: Array<{ name: string; value: string; type?: string }> };

        const variables: Record<string, string> = {};
        const rawVars = variablesResponse.variables ?? [];
        const capped = rawVars.slice(0, 20);
        for (const v of capped) {
          variables[v.name] = v.type ? `${v.type}(${v.value})` : String(v.value);
        }

        frames.push({
          name: sf.name,
          source: sf.source?.path ?? "<unknown>",
          line: sf.line,
          variables,
        });
      }

      // Step 4: If stopped by exception, get full exception info (Sprint 24)
      let exceptionMessage: string | undefined;
      let capturedExceptionInfo: {
        description?: string; stackTrace?: string; source?: string;
        line?: number; caught?: boolean;
      } | undefined;
      if (body.reason === "exception" || !body.reason) {
        try {
          const exceptionInfo = (await session.customRequest("exceptionInfo", {
            threadId,
          })) as { description?: string; stackTrace?: string; source?: string; line?: number; caught?: boolean };
          exceptionMessage = exceptionInfo.description;
          capturedExceptionInfo = exceptionInfo;
        } catch {
          // Non-fatal: exception info unavailable
        }
      }

      // Step 5: Store snapshot — mark as unconsumed for runtime loop injection (dim 20)
      this._lastSnapshot = {
        threadId,
        stopReason: body.reason ?? "stopped",
        frames,
        exceptionMessage,
      };
      this._snapshotConsumed = false;

      // Push event + enriched frames into DebugContextManager (Sprint 15 + Sprint 24)
      const coreFrames = frames.map((f) => ({
        id: Math.floor(Math.random() * 100000),
        name: f.name,
        source: f.source,
        line: f.line,
        column: 0,
        isUserCode: !f.source.includes("node_modules"),
      }));

      const exceptionExtras: Record<string, unknown> = { frames: coreFrames, threadId };
      if (capturedExceptionInfo) {
        exceptionExtras.exception = {
          exceptionId: "runtime-exception",
          description: capturedExceptionInfo.description ?? "",
          stackTrace: capturedExceptionInfo.stackTrace,
          source: capturedExceptionInfo.source,
          line: capturedExceptionInfo.line,
          caught: capturedExceptionInfo.caught ?? false,
        };
      }

      if (body.reason === "exception") {
        this.debugContextManager.pushEvent("exception", exceptionExtras);
        this.debugContextManager.pushEvent("stopped", { frames: coreFrames, threadId });
      } else {
        this.debugContextManager.pushEvent("breakpoint_hit", exceptionExtras);
      }

      const allVars = frames.flatMap((f) =>
        Object.entries(f.variables).map(([name, val]) => ({
          name,
          value: val,
          type: "string" as const,
          frameId: 0,
          depth: 0,
          hasChildren: false,
        })),
      );
      if (allVars.length > 0) {
        this.debugContextManager.setVariables(allVars);
      }

      // Step 6: Evaluate watch expressions (Sprint 24)
      const topFrameId = stackFrames[0]?.id;
      const watchList = this.debugContextManager.watches.all;
      if (topFrameId !== undefined && watchList.length > 0) {
        for (const watch of watchList) {
          try {
            const evalResult = (await session.customRequest("evaluate", {
              expression: watch.expression,
              frameId: topFrameId,
              context: "watch",
            })) as { result: string };
            this.debugContextManager.watches.updateResult(watch.id, evalResult.result);
          } catch (err) {
            this.debugContextManager.watches.updateError(watch.id, String((err as Error).message ?? err));
          }
        }
      }
    } catch {
      // Never throw — silently swallow errors
    }
  }
}
