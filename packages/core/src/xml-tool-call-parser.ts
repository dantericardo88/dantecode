// packages/core/src/xml-tool-call-parser.ts
//
// Streaming XML state machine that detects complete <tool_use>...</tool_use> blocks
// as chunks arrive mid-stream. Fires events immediately when a block closes so the
// caller can cut the stream or execute tools without waiting for the full response.
//
// Key invariant: IN_JSON_STRING state does NOT scan for </tool_use> — all chars are
// literal while inside a double-quoted JSON string. This makes the parser immune to
// </tool_use> appearing inside string values.

export const enum XmlParserState {
  SCANNING,
  IN_OPEN_TAG,
  IN_PAYLOAD,
  IN_JSON_STRING,
  IN_CLOSE_TAG,
}

export interface XmlToolBlock {
  payload: string;
  startOffset: number;
  endOffset: number;
}

export type XmlParserEvent =
  | { type: "tool_block_complete"; block: XmlToolBlock }
  | { type: "tool_block_start" }
  | { type: "text_chunk"; text: string };

const OPEN_TAG = "<tool_use>";
const CLOSE_TAG = "</tool_use>";

export class XmlToolCallParser {
  private _state: XmlParserState = XmlParserState.SCANNING;
  private _pendingPayload = "";
  private _tentativeTag = "";
  private _tentativeClose = "";
  private _escapedNext = false;
  private _blockStartOffset = 0;
  private _bytesProcessed = 0;
  private readonly _onEvent: (event: XmlParserEvent) => void;

  constructor(onEvent: (event: XmlParserEvent) => void) {
    this._onEvent = onEvent;
  }

  feed(chunk: string): void {
    for (let ci = 0; ci < chunk.length; ci++) {
      const ch = chunk[ci]!;
      this._bytesProcessed++;

      switch (this._state) {
        case XmlParserState.SCANNING: {
          if (ch === "<") {
            this._tentativeTag = "<";
            this._state = XmlParserState.IN_OPEN_TAG;
          } else {
            this._onEvent({ type: "text_chunk", text: ch });
          }
          break;
        }

        case XmlParserState.IN_OPEN_TAG: {
          this._tentativeTag += ch;
          if (OPEN_TAG.startsWith(this._tentativeTag)) {
            if (this._tentativeTag === OPEN_TAG) {
              this._blockStartOffset = this._bytesProcessed - OPEN_TAG.length;
              this._pendingPayload = "";
              this._escapedNext = false;
              this._state = XmlParserState.IN_PAYLOAD;
              this._onEvent({ type: "tool_block_start" });
            }
            // else: still accumulating — stay in IN_OPEN_TAG
          } else {
            // False open — emit accumulated chars as text and return to SCANNING
            this._onEvent({ type: "text_chunk", text: this._tentativeTag });
            this._tentativeTag = "";
            this._state = XmlParserState.SCANNING;
          }
          break;
        }

        case XmlParserState.IN_PAYLOAD: {
          if (ch === '"') {
            this._pendingPayload += ch;
            this._escapedNext = false;
            this._state = XmlParserState.IN_JSON_STRING;
          } else if (ch === "<") {
            this._tentativeClose = "<";
            this._state = XmlParserState.IN_CLOSE_TAG;
          } else {
            this._pendingPayload += ch;
          }
          break;
        }

        case XmlParserState.IN_JSON_STRING: {
          this._pendingPayload += ch;
          if (this._escapedNext) {
            this._escapedNext = false;
          } else if (ch === "\\") {
            this._escapedNext = true;
          } else if (ch === '"') {
            this._state = XmlParserState.IN_PAYLOAD;
          }
          break;
        }

        case XmlParserState.IN_CLOSE_TAG: {
          this._tentativeClose += ch;
          if (CLOSE_TAG.startsWith(this._tentativeClose)) {
            if (this._tentativeClose === CLOSE_TAG) {
              const endOffset = this._bytesProcessed;
              this._onEvent({
                type: "tool_block_complete",
                block: {
                  payload: this._pendingPayload,
                  startOffset: this._blockStartOffset,
                  endOffset,
                },
              });
              this._tentativeClose = "";
              this._state = XmlParserState.SCANNING;
            }
            // else: still accumulating close tag chars
          } else {
            // False close — these chars belong to the payload, not a close tag
            this._pendingPayload += this._tentativeClose;
            this._tentativeClose = "";
            this._state = XmlParserState.IN_PAYLOAD;
          }
          break;
        }
      }
    }
  }

  flush(): void {
    // Discard any in-flight partial state — no complete block to emit
    this._state = XmlParserState.SCANNING;
    this._pendingPayload = "";
    this._tentativeTag = "";
    this._tentativeClose = "";
    this._escapedNext = false;
  }

  reset(): void {
    this._state = XmlParserState.SCANNING;
    this._pendingPayload = "";
    this._tentativeTag = "";
    this._tentativeClose = "";
    this._escapedNext = false;
    this._blockStartOffset = 0;
    this._bytesProcessed = 0;
  }

  get state(): XmlParserState {
    return this._state;
  }
}
