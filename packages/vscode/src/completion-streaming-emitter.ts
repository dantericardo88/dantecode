// packages/vscode/src/completion-streaming-emitter.ts
// Tabby-harvested: early ghost text emission pattern.
// Emits partial InlineCompletionItem text after the first line arrives,
// enabling sub-300ms ghost text TTFB for single-line completions.

export interface PartialCompletionEvent {
  /** Partial text accumulated so far */
  text: string;
  /** True when stream has finished */
  done: boolean;
  /** Milliseconds to first chunk from stream start */
  firstChunkMs?: number;
}

export type PartialCompletionCallback = (event: PartialCompletionEvent) => void;

export interface StreamingEmitterOptions {
  /** Emit after first \n arrives — single-line fast path (default: true) */
  emitOnFirstLine?: boolean;
  /** Emit after this many ms even without \n (default: 600) */
  firstLineTimeoutMs?: number;
  /** Stop streaming after this many ms total (default: 4000) */
  maxStreamMs?: number;
  /** Stop sequences to truncate output at */
  stopSequences?: string[];
  /** Emit a partial event after each complete line (default: false) */
  emitPerLine?: boolean;
}

export class CompletionStreamingEmitter {
  private readonly _abortController = new AbortController();
  private readonly _startTime = Date.now();
  private _firstChunkMs: number | undefined = undefined;

  get abortSignal(): AbortSignal {
    return this._abortController.signal;
  }

  abort(): void {
    this._abortController.abort();
  }

  /**
   * Consume an AsyncIterable<string> token stream.
   * Calls onPartial when:
   *   1. First \n received (single-line fast path)
   *   2. firstLineTimeoutMs elapses (fallback for slow models)
   *   3. A stop sequence is detected in accumulated text
   *   4. Stream completes (done: true)
   * Returns final accumulated text.
   */
  async emit(
    stream: AsyncIterable<string>,
    onPartial: PartialCompletionCallback,
    options: StreamingEmitterOptions = {},
  ): Promise<string> {
    const {
      emitOnFirstLine = true,
      firstLineTimeoutMs = 600,
      maxStreamMs = 4000,
      stopSequences = [],
      emitPerLine = false,
    } = options;

    let text = "";
    let emittedFirstLine = false;
    let lastLineEnd = 0;
    const deadline = this._startTime + maxStreamMs;
    let stopped = false;

    let firstLineTimeout: ReturnType<typeof setTimeout> | undefined;
    if (emitOnFirstLine) {
      firstLineTimeout = setTimeout(() => {
        if (!emittedFirstLine && text.length > 0) {
          emittedFirstLine = true;
          onPartial({ text: text.trimEnd(), done: false, firstChunkMs: this._firstChunkMs });
        }
      }, firstLineTimeoutMs);
    }

    try {
      for await (const chunk of stream) {
        if (this._abortController.signal.aborted || Date.now() > deadline) break;

        if (this._firstChunkMs === undefined) {
          this._firstChunkMs = Date.now() - this._startTime;
        }

        text += chunk;

        // Check stop sequences — truncate at first match
        for (const seq of stopSequences) {
          const idx = text.indexOf(seq);
          if (idx !== -1) {
            text = text.slice(0, idx);
            stopped = true;
            break;
          }
        }
        if (stopped) break;

        // Single-line fast path: emit after first newline
        if (emitOnFirstLine && !emittedFirstLine && text.includes("\n")) {
          emittedFirstLine = true;
          clearTimeout(firstLineTimeout);
          onPartial({ text: text.trimEnd(), done: false, firstChunkMs: this._firstChunkMs });
        }

        // Per-line emission: fire after each complete newline-terminated line
        if (emitPerLine) {
          let newlineIdx = text.indexOf("\n", lastLineEnd);
          while (newlineIdx !== -1) {
            lastLineEnd = newlineIdx + 1;
            onPartial({ text, done: false, firstChunkMs: this._firstChunkMs });
            newlineIdx = text.indexOf("\n", lastLineEnd);
          }
        }
      }
    } finally {
      clearTimeout(firstLineTimeout);
    }

    const finalText = text.trimEnd();
    onPartial({ text: finalText, done: true, firstChunkMs: this._firstChunkMs });
    return finalText;
  }
}

/**
 * Registry of active emitters keyed by document URI.
 * Calling startFor() cancels any in-flight emitter for that document first.
 */
export class EmitterRegistry {
  private readonly _active = new Map<string, CompletionStreamingEmitter>();

  startFor(docUri: string): CompletionStreamingEmitter {
    this._active.get(docUri)?.abort();
    const emitter = new CompletionStreamingEmitter();
    this._active.set(docUri, emitter);
    return emitter;
  }

  cancelFor(docUri: string): void {
    this._active.get(docUri)?.abort();
    this._active.delete(docUri);
  }

  cancelAll(): void {
    for (const emitter of this._active.values()) emitter.abort();
    this._active.clear();
  }
}

export const globalEmitterRegistry = new EmitterRegistry();

/** Default ms to wait for the first newline before emitting a partial ghost text. */
export const DEFAULT_FIRST_LINE_TIMEOUT_MS = 200;
