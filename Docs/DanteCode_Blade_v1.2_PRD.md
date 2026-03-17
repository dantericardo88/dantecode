# DanteCode Blade v1.2 — Full Implementation PRD
## "The Blade Version: All Strengths, Zero Weaknesses"
**Classification:** Titan Harvest V2 Clean-Room | Constitutional | YOLO-Safe
**Generated:** March 16, 2026 | **Council:** Claude (Architect) + Grok (Analyst)
**State Machine Target:** RELEASE → BLADE_READY → PUBLISHED

---

## SECTION 1 — EXECUTIVE SUMMARY

### The Situation

DanteCode v1.0.0 is at RELEASE state: 562 tests, 24 suites, 100% pass rate, 95.23%
statement coverage, all GStack gates green. The constitutional moat — DanteForge's
verification pipeline — is the only such capability in the OSS AI coding agent space,
scoring 10/10 against a field that averages 6.5/10 on built-in verification.

The problem: everything else scores 6.4/10 overall against a competitive field averaging
8.2/10. The gap is entirely in UX surface quality — not in correctness, not in safety,
not in architecture. The engine is ready. The cockpit is not.

### The Blade Thesis

A blade has no weak spots. Every edge is sharp. DanteCode Blade v1.2 preserves the
DanteForge constitutional moat (10/10) while closing all six UX gaps in a single
constitutional sprint. The result: the only coding agent with both best-in-class
verification AND best-in-class user experience.

### Gap → Target Scorecard

| Dimension | Current | Target | Gap Owner |
|---|---|---|---|
| Live Token Streaming | 7 | 9 | streamText() in model-router + providers |
| Visual Colored Diffs | 6 | 9 | DiffHunk in git-engine + webview render |
| Progress UX / Silent Mode | 5 | 9 | BladeProgressState + silent relay |
| Long Task Continuity | 6 | 9 | persistUntilGreen + 200-round ceiling |
| Self-Safety / No Crash | 3 | 9 | isSelfModificationTarget guard + release:check |
| Smart Cost Routing | 7 | 9 | Two-tier router + session cost display |
| **DanteForge Verification** | **10** | **10** | **PRESERVE — do not regress** |
| **Overall** | **6.4** | **9.0+** | — |

### Sprint Scope

7 deliverables across 4 packages (core, git-engine, vscode, danteforge) + config-types.
All changes are additive or surgical. No package architectures are changed. No new
external dependencies are added. All changes must pass the full GStack gate before
this PRD is considered executed.

---

## SECTION 2 — OSS HARVEST FINDINGS

*Titan Harvest V2 doctrine: mechanism extraction only. No verbatim code reproduction.
Each finding is restated as a behavioral contract for DanteCode's implementation.*

### 2.1 Continue.dev — Streaming + Silent Sidebar UX

**Harvest source:** `continuedev/continue` — VS Code extension, core/llm layer

**Streaming Architecture:**
Continue.dev's core uses an `AsyncGenerator<string>` pattern at the LLM provider
interface boundary. Each provider (Anthropic, OpenAI, Ollama) implements a
`streamComplete()` method that yields string chunks from SSE responses. The extension
host receives these chunks via an internal EventEmitter and immediately forwards each
chunk to the webview via `panel.webview.postMessage({ type: "chunk", text: chunk })`.
The webview appends each chunk to the active message DOM node using `innerHTML +=`
with sanitization, then scrolls to bottom. There is no batching delay — each chunk
triggers a DOM update. A blinking CSS cursor (`::after { content: "▌"; animation: blink 1s }`)
is added to the active message container and removed when the `done` event arrives.

**DanteCode pattern:** `streamText()` method returning `AsyncIterable<string>` in
`ModelRouterImpl`. Each chunk forwarded as `chat_response_chunk` to webview. Existing
`chat_response_done` message removes cursor and shows PDSE badge.

**Silent Sidebar UX:**
During long tasks, Continue.dev's sidebar shows a single collapsible "Thinking..."
disclosure widget, not individual tool logs. Internal tool calls (file reads, searches)
are hidden unless the user clicks "Show details". The widget updates its label
("Reading file...", "Running command...") but never expands automatically.

**DanteCode pattern:** `silentMode: boolean` flag in tool execution context. When true,
tool stdout/stderr is not forwarded to webview. A single `autoforge_progress` message
replaces all per-tool updates.

### 2.2 Aider — Visual Diffs and Git-Native Sessions

**Harvest source:** `Aider-AI/aider` — diff rendering, repo-map, session persistence

**Visual Diff Rendering:**
Aider computes diffs at the file level using Python's `difflib.unified_diff` algorithm
after every file write. The output is a structured list of hunk objects, each containing
a header line (`@@ -old,count +new,count @@`) and a sequence of context/add/remove lines.
In the terminal, Aider applies ANSI color codes directly: green for `+` lines, red for
`-` lines, dim/gray for `@@` headers. In the UI surface (when applicable), it renders
the same structure as colored `<span>` elements inside a `<pre>` block. Large diffs
are not truncated in the terminal but the UI caps at a configurable line count with
a "show more" link.

The key insight: the diff is computed on the *extension host* with access to the
file system (old content from disk before write, new content from the write result),
not in the model response. The model never "sees" the rendered diff.

**DanteCode pattern:** `generateColoredHunk(oldContent, newContent, filePath)` in
`git-engine/src/diff.ts`. Returns `DiffHunk` (structured, not ANSI). Webview renders
using CSS classes `.diff-add`, `.diff-remove`, `.diff-header`. Diffs are display-only
and never injected into model context.

**Long Session Persistence:**
Aider uses a git worktree per session and checkpoints the conversation history to a
`.aider.chat.history.md` file after each assistant turn. If the process crashes, on
next startup it reads the history file and restores the session. The agent loop has
no round limit — it continues until the model produces a response with no tool calls,
interpreted as "I'm done."

**DanteCode pattern:** `runUntilComplete` flag + `persistUntilGreen` flag. The existing
`worktreeEnabled` in STATE.yaml already provides the git isolation. The loop exit
condition is extended to the three-condition check.

### 2.3 OpenHands — Sandbox Safety and Persistent Agent Loop

**Harvest source:** `All-Hands-AI/OpenHands` — sandbox runtime, agent loop, self-safety

**Sandbox Safety / Self-Modification Guard:**
OpenHands runs all tool execution inside a Docker container where the agent's source
code is NOT mounted. The container has access only to the user's project directory.
This architectural boundary means self-modification is physically impossible in
OpenHands — there is no code path that can reach the agent source.

DanteCode's architecture is different (extension runs in the VS Code host process),
so a physical boundary is not possible. The equivalent is a **software boundary**: a
pre-execution path check on every Write/Edit tool call.

OpenHands also maintains an allow-list/block-list for file paths that the agent can
access. When a blocked path is requested, a `SecurityError` event is logged before
the tool is dispatched, and the agent receives an error message telling it the path
is restricted.

**DanteCode pattern:** `isSelfModificationTarget()` check before every Write/Edit
dispatch. Block-list covers 6 self-paths. On detection: audit event, loop pause,
user confirmation modal, `runReleaseCheck()` gate.

**Persistent Loop Architecture:**
OpenHands implements a `while True` agent loop with these exit conditions only:
(1) task marked complete by the model via a special `finish` action, (2) user sends
`stop` signal, (3) hard ceiling hit (configurable, default 100). The loop never exits
on round count alone. Each iteration emits an `AgentStateChangedObservation` event
to the UI so the user always knows the loop is alive.

**DanteCode pattern:** Three-condition exit logic in sidebar-provider.ts agent loop.
`loop_terminated` audit event on every exit. Progress events every round so the user
sees activity.

### 2.4 OpenCode — Build/Plan Modes and Model Routing

**Harvest source:** `anomalyco/opencode` — terminal TUI, model routing, plan mode

**Build/Plan Mode Architecture:**
OpenCode implements a permission model at the tool dispatcher level. In Plan mode,
only read-only tools are allowed (Read, ListDir, Glob, Grep). Any write-capable
tool call from the model in Plan mode returns a synthetic error message: "Write
operations are not permitted in Plan mode. Switch to Build mode to execute changes."
The mode is stored in session state and checked before every tool dispatch.

DanteCode already has this — `AgentMode`, `PLAN_MODE_TOOLS`, and `AgentConfig.permissions`
are all implemented in `sidebar-provider.ts`. This is a confirmed strength, not a gap.

**Model Routing:**
OpenCode routes to faster models for exploration tasks (file reads, searches) and
to capable models for generation tasks (writes, multi-file edits). The routing decision
is made at dispatch time based on the tool being called, not on input token count.
A `cost_tracker` accumulates session cost and displays it in the status bar.

**DanteCode pattern:** Hybrid routing — use both tool type AND token count to select
tier. Token count is the primary signal; tool type breaks ties. Session cost tracked
in `ModelRouterImpl.sessionCostUsd` accumulator.

### 2.5 LangGraph — Self-Healing Loop Patterns

**Harvest source:** `langchain-ai/langgraph` — graph orchestration, conditional edges

**Loop Safety Architecture:**
LangGraph's self-healing pattern uses conditional edges: after each node execution,
a router function evaluates the state and decides whether to continue, retry, or
terminate. The router has access to a `retry_count` field in the graph state, which
acts as the hard ceiling. Retries decrement a budget; when the budget is zero, the
terminal edge fires regardless of task completion status.

The key insight: the ceiling is **decremented**, not compared. This makes it
impossible for any node to reset or bypass the ceiling — there is no "set retry to
0" operation available to agent nodes.

**DanteCode pattern:** `roundsRemaining` counter (decrements each round) instead of
`round >= maxToolRounds` comparison. The ceiling cannot be extended by the model
because only `hardCeiling` (from STATE.yaml) initializes `roundsRemaining`.

**State Checkpointing:**
LangGraph checkpoints the full graph state to a `MemorySaver` (or external store)
after each node. If the process crashes, `graph.invoke(None, config)` resumes from
the last checkpoint. For DanteCode this maps to the existing `sessionHistory` array
in STATE.yaml + the audit log.

### 2.6 Sweep — Verification Gate Patterns

**Harvest source:** `BerriAI/sweep` — PR review, verification gates

**Gate-First Architecture:**
Sweep runs a static analysis pass before generating any code change. It verifies
that the proposed change is structurally sound (correct AST, no import errors) before
writing to disk. Only then does it commit. This "verify-before-write" pattern prevents
bad code from ever touching the file system.

DanteCode's DanteForge runs *after* the write (anti-stub → constitution → PDSE →
GStack). Sweep's pre-write pattern is architecturally incompatible with DanteCode's
iterative correction model, and produces worse results on complex multi-file rewrites.
DanteCode's post-write + iterate pattern is actually superior for agentic tasks.

**Decision:** Do NOT adopt Sweep's pre-write gate. DanteForge's post-write + IAL
is better. Confirm DanteForge advantage in the constitutional compliance matrix.

### 2.7 Harvest Summary Table

| Repo | Gap | Mechanism Extracted | DanteCode Contract |
|---|---|---|---|
| Continue.dev | Streaming | `AsyncGenerator<string>` at provider boundary | `streamText()` → `AsyncIterable<string>` |
| Continue.dev | Silent UX | Single disclosure widget, tool logs hidden | `silentMode` flag, single `autoforge_progress` msg |
| Aider | Visual Diffs | `DiffHunk` objects, CSS color classes in UI | `generateColoredHunk()` → `DiffHunk` interface |
| Aider | Long sessions | No round limit, exit on "no tool calls" | Three-condition exit + `persistUntilGreen` |
| OpenHands | Self-safety | Physical container boundary → software path check | `isSelfModificationTarget()` + audit event |
| OpenHands | Persistent loop | `while True` with decremented retry budget | `roundsRemaining` counter, three exit conditions |
| OpenCode | Cost routing | Tool-type + token-count two-tier dispatch | Hybrid routing: tokens primary, tool type secondary |
| LangGraph | Loop ceiling | Decrement-only ceiling counter | `roundsRemaining` initialized from `hardCeiling` |
| Sweep | Verification | Pre-write gate (REJECTED — inferior for agentic tasks) | DanteForge post-write + IAL is better |

---

## SECTION 3 — ARCHITECTURE DECISION LOG

**ADL-001: streamText returns accumulated fullText, not just chunks**
*Decision:* `streamText()` accumulates all chunks into `fullText` and returns it
alongside the stream. This allows tool call extraction (`extractToolCalls`) to run
on the complete response without changing the extraction logic.
*Rationale:* Changing tool call extraction to work on partial text would require
buffering logic and introduce race conditions. Accumulation is the simpler, safer path.
*Alternative rejected:* Stream-native tool call extraction (Continue.dev approach).
Too invasive for a sprint-scoped change.

**ADL-002: DiffHunk is structured, not ANSI**
*Decision:* `generateColoredHunk()` returns a `DiffHunk` object with typed `DiffLine[]`,
not ANSI escape sequences or raw HTML.
*Rationale:* The webview renders HTML, not ANSI. Structured output allows the webview
to apply theme-consistent colors via CSS variables. ANSI output would require a parser
in the webview. Structured output also enables the collapsible truncation feature.
*Alternative rejected:* ANSI strings (Aider's terminal approach). Not suitable for webview.

**ADL-003: Self-modification guard is always active, including YOLO mode**
*Decision:* `isSelfModificationTarget()` fires before every Write/Edit dispatch in
all agent modes. YOLO mode may auto-approve AFTER `runReleaseCheck()` passes —
it does not skip the check.
*Rationale:* YOLO mode means "no asking for permission on normal edits." It does not
mean "allow self-destruction." The guard is a constitutional protection, not a
convenience feature.
*Alternative rejected:* YOLO mode bypasses guard. Rejected as self-evidently dangerous.

**ADL-004: Cost accumulator resets on New Chat, not on session restart**
*Decision:* `sessionCostUsd` in `ModelRouterImpl` is an in-memory accumulator that
resets when the user clicks "New Chat". It does NOT persist to STATE.yaml.
*Rationale:* Cost tracking is informational UX, not financial accounting. Persisting
costs across restarts adds complexity (stale data, multi-session confusion) for
minimal benefit. Users who need billing precision use the xAI dashboard.
*Alternative rejected:* Persist to STATE.yaml. Too complex for informational display.

**ADL-005: BladeProgressEmitter is a class, not a function**
*Decision:* `BladeProgressEmitter` is a class that wraps `AutoforgeConfig` and holds
internal state (current phase, round counter, last PDSE score, accumulated cost).
*Rationale:* Multiple methods need to share state across the lifecycle of a single
autoforge run. A class with shared private state is cleaner than passing state
objects through pure functions.
*Alternative rejected:* Closure-based emitter factory. Harder to test, harder to type.

---

## SECTION 4 — DELIVERABLE SPECIFICATIONS

### DELIVERABLE 1 — Silent Progress Mode (Gap: Progress UX 5 → 9)

#### 1.1 New Types (add to `packages/config-types/src/index.ts`)

```typescript
/** Live state of a blade autoforge run, emitted as webview progress events. */
export interface BladeProgressState {
  /** Current autoforge phase number (1-based). */
  phase: number;
  /** Total phases configured in AutoforgeConfig.maxIterations. */
  totalPhases: number;
  /** Percent complete: floor((phase - 1) / totalPhases * 100). */
  percentComplete: number;
  /** Last PDSE score from runLocalPDSEScorer on the most recently written file. */
  pdseScore: number;
  /** Accumulated session cost in USD from ModelRouterImpl.getCostEstimate(). */
  estimatedCostUsd: number;
  /** Human-readable current task label (e.g., "Running GStack typecheck"). */
  currentTask: string;
  /** When true, tool logs and bash output are suppressed in the webview. */
  silentMode: boolean;
}

/** Extended autoforge config for Blade v1.2. */
export interface BladeAutoforgeConfig extends AutoforgeConfig {
  /** When true, ignore maxIterations and continue until allGStackPassed && pdse >= 90. */
  persistUntilGreen?: boolean;
  /** Absolute maximum rounds even when persistUntilGreen=true. Default 200. */
  hardCeiling?: number;
  /** Enable silent progress UX (suppress per-tool webview messages). Default false. */
  silentMode?: boolean;
}
```

#### 1.2 Add to WebviewOutboundMessage type union

In `packages/vscode/src/sidebar-provider.ts`, add to the `WebviewOutboundMessage.type` union:
- `"autoforge_progress"` — payload is `BladeProgressState`
- `"self_modification_blocked"` — payload is `{ filePath: string; reason: string }`
- `"loop_terminated"` — payload is `{ reason: string; roundsUsed: number; finalPdse: number }`
- `"diff_hunk"` — payload is `DiffHunk`
- `"cost_update"` — payload is `CostEstimate`

Add to `WebviewInboundMessage.type` union:
- `"user_confirmed_self_mod"` — payload is `{ filePath: string; confirmed: boolean }`

#### 1.3 Progress Bar Generator (add to `packages/danteforge/src/autoforge.ts`)

```typescript
/**
 * Generates a 10-block unicode progress bar string.
 * Example: percentComplete=65 → "██████░░░░"
 */
export function generateProgressBar(percentComplete: number): string {
  const filled = Math.floor(percentComplete / 10);
  const empty = 10 - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

/**
 * Formats a BladeProgressState into the canonical single-line status string.
 * Output: "🔄 Autoforge Phase 2/5  [██████░░░░]  62%  •  PDSE 91  •  Est. $0.003"
 */
export function formatBladeProgressLine(state: BladeProgressState): string {
  const bar = generateProgressBar(state.percentComplete);
  const cost = state.estimatedCostUsd.toFixed(3);
  return `🔄 Autoforge Phase ${state.phase}/${state.totalPhases}  [${bar}]  ${state.percentComplete}%  •  PDSE ${state.pdseScore}  •  Est. $${cost}`;
}
```

#### 1.4 Silent Mode in Agent Tools

In `packages/vscode/src/agent-tools.ts`, add `silentMode: boolean` to `ToolExecutionContext`:

```typescript
export interface ToolExecutionContext {
  projectRoot: string;
  workspaceFolder: vscode.WorkspaceFolder | undefined;
  silentMode: boolean;  // NEW: suppress stdout/stderr relay to webview when true
}
```

The `executeTool` function must check `context.silentMode`. When true:
- Do not forward bash stdout/stderr to webview via `onOutput` callbacks
- Do not emit `tool_result` messages for Read/Glob/Grep operations
- DO still emit `diff_hunk` messages after Write/Edit operations (diffs are never suppressed)
- DO still emit any `error` messages (errors are never suppressed)

#### 1.5 Slash Command Update

In `packages/cli/src/slash-commands.ts`, update the `/autoforge` handler:
- Add `--silent` flag: when present, sets `silentMode: true` in `BladeAutoforgeConfig`
- Add `--persist` flag: when present, sets `persistUntilGreen: true`
- Default behavior (no flags): silent=false, persist=false (backward compatible)

#### 1.6 Behavioral Contract

MUST:
- Show exactly one status line during any autoforge run when silentMode=true
- Update status line on every completed tool round (not more than once per 500ms — debounce)
- Always show phase, progress bar, percent, PDSE, and cost in the single line
- Emit a final `autoforge_progress` with `percentComplete: 100` on completion

MUST NOT:
- Suppress error messages, even in silent mode
- Suppress constitution violation alerts
- Suppress diff hunks (diffs always show regardless of silentMode)
- Suppress the final GStack gate results summary

#### 1.7 Tests (add to `packages/vscode/src/vscode.test.ts`)

```typescript
describe("BladeProgressState", () => {
  it("generateProgressBar returns correct blocks at 0%", ...)
  it("generateProgressBar returns correct blocks at 50%", ...)
  it("generateProgressBar returns correct blocks at 100%", ...)
  it("formatBladeProgressLine formats all fields correctly", ...)
  it("silentMode suppresses tool stdout in webview messages", ...)
  it("silentMode does NOT suppress diff_hunk messages", ...)
  it("silentMode does NOT suppress error messages", ...)
  it("BladeProgressState percentComplete = floor((phase-1)/totalPhases*100)", ...)
})
```

---

### DELIVERABLE 2 — True Token-by-Token Streaming (Gap: Live Streaming 7 → 9)

#### 2.1 New Method in ModelRouterImpl

Add to `packages/core/src/model-router.ts`:

```typescript
/**
 * Streams text from the selected model provider, yielding string chunks as they arrive.
 * Falls back to generateText() (non-streaming) if the provider does not support SSE.
 * Always returns the complete accumulated fullText alongside usage stats.
 *
 * @param messages - Conversation history
 * @param systemPrompt - System prompt string
 * @param options.onChunk - Called for each streamed string chunk
 * @param options.abortSignal - AbortSignal to cancel the stream mid-flight
 * @returns { fullText, tokensUsed, modelId, durationMs }
 */
async streamText(
  messages: SessionMessage[],
  systemPrompt: string,
  options?: {
    onChunk?: (chunk: string) => void;
    abortSignal?: AbortSignal;
  }
): Promise<{ fullText: string; tokensUsed: number; modelId: string; durationMs: number }>
```

Implementation contract:
1. Select provider using `selectTier()` (see Deliverable 6)
2. If provider implements `supportsStreaming: true`, call `provider.streamComplete()`
3. For each yielded chunk: append to `accumulated`, call `options.onChunk?.(chunk)`
4. If `options.abortSignal?.aborted`, break out of the async iterator cleanly
5. If provider does NOT implement streaming, call `provider.complete()` and call `onChunk` once with the full text
6. Return `{ fullText: accumulated, tokensUsed, modelId, durationMs }`

#### 2.2 Provider Streaming Interface

Add to each provider in `packages/core/src/providers/`:

```typescript
export interface ProviderStreamResult {
  chunks: AsyncIterable<string>;
  tokensUsed: () => Promise<number>; // resolved after stream completes
  modelId: string;
}

export interface StreamingProvider {
  supportsStreaming: true;
  streamComplete(
    messages: SessionMessage[],
    systemPrompt: string,
    abortSignal?: AbortSignal
  ): Promise<ProviderStreamResult>;
}
```

**grok.ts:** Implement using xAI's `/v1/chat/completions` with `stream: true`. Parse
SSE lines (`data: {...}`), extract `choices[0].delta.content`, yield non-null content
strings. Handle `data: [DONE]` as end-of-stream signal.

**anthropic.ts:** Implement using Anthropic's streaming Messages API. Listen for
`content_block_delta` events with `delta.type === "text_delta"`, yield `delta.text`.
Handle `message_stop` as end-of-stream signal.

**ollama.ts:** Implement using Ollama's `/api/chat` with `stream: true`. Parse NDJSON
lines, yield `message.content` from each non-final line. Handle `done: true` as end.

**openai.ts:** Implement using OpenAI's `/v1/chat/completions` with `stream: true`.
Same SSE pattern as Grok.

#### 2.3 Sidebar Provider Update

In `packages/vscode/src/sidebar-provider.ts`, replace the `generateText()` call in
the chat request handler with `streamText()`:

```typescript
// Store abort controller for stop_generation support
this._streamAbortController = new AbortController();

const result = await this._router.streamText(
  sessionMessages,
  systemPrompt,
  {
    onChunk: (chunk) => {
      this._postMessage({
        type: "chat_response_chunk",
        payload: { chunk, messageId }
      });
    },
    abortSignal: this._streamAbortController.signal,
  }
);
```

On `stop_generation` inbound message: call `this._streamAbortController.abort()`.
After abort: emit `chat_response_done` with `{ stopped: true }` so the webview
removes the cursor and shows a "Generation stopped" indicator.

#### 2.4 Webview HTML Update (in sidebar-provider.ts webview HTML string)

Add CSS for streaming cursor:
```css
.message-bubble.streaming::after {
  content: "▌";
  animation: blink 1s step-end infinite;
  color: var(--accent);
}
@keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
```

The `chat_response_chunk` message handler:
```javascript
case "chat_response_chunk": {
  const { chunk, messageId } = payload;
  let bubble = document.getElementById(`msg-${messageId}`);
  if (!bubble) {
    bubble = createMessageBubble("assistant", messageId);
    bubble.classList.add("streaming");
  }
  // Append chunk to existing text content
  const textNode = bubble.querySelector(".message-text");
  textNode.textContent += chunk;
  scrollToBottom();
  break;
}
case "chat_response_done": {
  const bubble = document.getElementById(`msg-${payload.messageId}`);
  if (bubble) bubble.classList.remove("streaming");
  if (payload.pdseScore) showPdseBadge(payload.messageId, payload.pdseScore);
  break;
}
```

#### 2.5 Behavioral Contract

MUST:
- Each `chat_response_chunk` message must be dispatched to the webview within 50ms of receiving the chunk from the provider
- The webview must append each chunk without re-rendering the entire message list
- `chat_response_done` must always fire, even if the stream was aborted
- Tool call extraction must run on `result.fullText` after the stream completes

MUST NOT:
- Buffer chunks and send them in batches (no batching delay)
- Re-render previous messages when appending a new chunk
- Leave the streaming cursor visible after `chat_response_done`

#### 2.6 Tests (add to `packages/core/src/model-router.test.ts`)

```typescript
describe("streamText", () => {
  it("yields at least 3 chunks from a mock streaming provider", ...)
  it("accumulates all chunks into fullText correctly", ...)
  it("calls onChunk for every yielded chunk", ...)
  it("falls back to generateText when provider.supportsStreaming is false", ...)
  it("calls onChunk exactly once with full text when falling back", ...)
  it("aborts cleanly when abortSignal fires mid-stream", ...)
  it("returns partial fullText when aborted mid-stream", ...)
  it("always fires chat_response_done even after abort", ...)
})
```

---

### DELIVERABLE 3 — Visual Colored Diffs (Gap: Visual Diffs 6 → 9)

#### 3.1 New Types (add to `packages/config-types/src/index.ts`)

```typescript
/** A single line in a colored diff hunk. */
export interface DiffLine {
  /** "add" = green, "remove" = red, "context" = gray, "hunk_header" = dim */
  type: "add" | "remove" | "context" | "hunk_header";
  /** The line content (without the leading +/-/space prefix character). */
  content: string;
  /** Line number in the old file (null for added lines). */
  oldLineNo: number | null;
  /** Line number in the new file (null for removed lines). */
  newLineNo: number | null;
}

/** A complete diff result for one file, ready for webview rendering. */
export interface DiffHunk {
  /** Relative file path from project root. */
  filePath: string;
  /** Total lines added across all hunks. */
  linesAdded: number;
  /** Total lines removed across all hunks. */
  linesRemoved: number;
  /** Ordered array of all diff lines across all hunks. */
  lines: DiffLine[];
  /** True if diff exceeded MAX_DIFF_LINES and was truncated. */
  truncated: boolean;
  /** Total line count in the full diff (for "Show N more lines" label). */
  fullLineCount: number;
}

/** Maximum diff lines to include before truncation. */
export const MAX_DIFF_LINES = 80;
```

#### 3.2 generateColoredHunk Function (add to `packages/git-engine/src/diff.ts`)

```typescript
/**
 * Generates a structured colored diff hunk between old and new file content.
 * Uses a simple Myers diff algorithm (no external deps required).
 * Returns a DiffHunk ready for webview rendering.
 *
 * @param oldContent - Previous file content (empty string for new files)
 * @param newContent - New file content
 * @param filePath - Relative path for display (e.g. "packages/core/src/model-router.ts")
 * @returns DiffHunk with typed DiffLine[] for webview rendering
 */
export function generateColoredHunk(
  oldContent: string,
  newContent: string,
  filePath: string
): DiffHunk
```

Implementation contract:
1. Split both contents into line arrays. Handle `\r\n` and `\n` line endings.
2. If `oldContent` is empty: all lines are `type: "add"`, `oldLineNo: null`, `newLineNo: 1..N`
3. If `newContent` is empty: all lines are `type: "remove"`, `oldLineNo: 1..N`, `newLineNo: null`
4. Otherwise: implement a 3-line context unified diff:
   - Produce `DiffLine` with `type: "hunk_header"` for `@@` lines
   - Produce `DiffLine` with `type: "add"` for `+` lines
   - Produce `DiffLine` with `type: "remove"` for `-` lines
   - Produce `DiffLine` with `type: "context"` for unchanged context lines (3 lines before/after each change)
5. Count `linesAdded` and `linesRemoved` from the `DiffLine[]` array
6. If `lines.length > MAX_DIFF_LINES`: set `truncated: true`, `fullLineCount: lines.length`, slice `lines` to `MAX_DIFF_LINES`
7. Binary file detection: if either content contains a null byte (`\x00`), return a single `hunk_header` line: `[Binary file — N bytes]` with `linesAdded: 0, linesRemoved: 0`

#### 3.3 Integration in agent-tools.ts

In `packages/vscode/src/agent-tools.ts`, in the `Write` and `Edit` tool executors:

```typescript
// Before executing the write:
let oldContent = "";
try {
  oldContent = await fs.readFile(resolvedPath, "utf-8");
} catch { /* file didn't exist before — oldContent stays "" */ }

// Execute the write...
await fs.writeFile(resolvedPath, newContent, "utf-8");

// After successful write: generate and emit the diff
const hunk = generateColoredHunk(oldContent, newContent, filePath);
context.onDiffHunk?.(hunk);  // relay to sidebar-provider for webview dispatch
```

Add `onDiffHunk?: (hunk: DiffHunk) => void` to `ToolExecutionContext`.

#### 3.4 Webview Rendering

In the sidebar-provider webview HTML, add `diff_hunk` message handler:

```javascript
case "diff_hunk": {
  const hunk = payload;
  const container = document.createElement("div");
  container.className = "diff-hunk-container";
  
  // Header: filename + stats
  const header = document.createElement("div");
  header.className = "diff-hunk-header";
  header.innerHTML = `📄 <span class="diff-filename">${hunk.filePath}</span>
    <span class="diff-stats">+${hunk.linesAdded} / -${hunk.linesRemoved}</span>`;
  container.appendChild(header);
  
  // Diff lines in a <pre> block
  const pre = document.createElement("pre");
  pre.className = "diff-body";
  hunk.lines.forEach(line => {
    const span = document.createElement("span");
    span.className = `diff-line diff-${line.type}`;
    span.textContent = line.content;
    pre.appendChild(span);
    pre.appendChild(document.createTextNode("\n"));
  });
  container.appendChild(pre);
  
  // Truncation notice
  if (hunk.truncated) {
    const more = document.createElement("button");
    more.className = "diff-show-more";
    more.textContent = `Show ${hunk.fullLineCount - 80} more lines`;
    more.onclick = () => sendPrompt(`/show-full-diff ${hunk.filePath}`);
    container.appendChild(more);
  }
  
  // Insert before the current assistant message bubble
  insertBeforeCurrentBubble(container);
  break;
}
```

CSS additions in `packages/vscode/assets/theme.css`:
```css
.diff-hunk-container { margin: 8px 0; border-radius: 4px; overflow: hidden; }
.diff-hunk-header { background: var(--surface-2); padding: 6px 10px; font-family: monospace; font-size: 12px; }
.diff-filename { color: var(--accent); font-weight: 600; }
.diff-stats { margin-left: 12px; color: var(--text-muted); }
.diff-body { margin: 0; padding: 8px; font-size: 12px; overflow-x: auto; }
.diff-line.diff-add { background: rgba(0,200,80,0.12); color: #4ade80; display: block; }
.diff-line.diff-remove { background: rgba(255,60,60,0.12); color: #f87171; display: block; }
.diff-line.diff-hunk_header { color: var(--text-muted); display: block; }
.diff-line.diff-context { display: block; }
.diff-show-more { background: none; border: 1px solid var(--border); color: var(--accent); padding: 4px 10px; cursor: pointer; font-size: 11px; border-radius: 3px; margin: 6px; }
```

#### 3.5 Behavioral Contract

MUST:
- Emit a `diff_hunk` message after every successful Write or Edit tool execution
- Render diff before the assistant's response text (chronologically accurate)
- Handle new files (no old content) by showing all lines as green adds
- Handle deleted files (empty new content) by showing all lines as red removes

MUST NOT:
- Include diff content in the model's message history (diffs are display-only)
- Block the agent loop while generating the diff (diff generation is synchronous and fast)
- Show diffs for non-code files (images, binary, node_modules) — skip silently

#### 3.6 Tests (add to `packages/git-engine/src/diff.test.ts`)

```typescript
describe("generateColoredHunk", () => {
  it("new file: all lines are type 'add' with correct newLineNo", ...)
  it("deleted file: all lines are type 'remove' with correct oldLineNo", ...)
  it("modified file: produces correct mix of add/remove/context lines", ...)
  it("hunk headers appear before changed sections", ...)
  it("truncation at MAX_DIFF_LINES sets truncated=true and fullLineCount", ...)
  it("binary file detection returns single hunk_header line", ...)
  it("linesAdded count matches add-type lines in DiffLine[]", ...)
  it("linesRemoved count matches remove-type lines in DiffLine[]", ...)
  it("CRLF line endings handled correctly", ...)
})
```

---

### DELIVERABLE 4 — Persistent Agent Loop (Gap: Long Task Continuity 6 → 9)

#### 4.1 Three-Condition Exit Logic

Replace the current `round >= maxToolRounds` check in the agent loop (both
`packages/vscode/src/sidebar-provider.ts` and `packages/cli/src/agent-loop.ts`)
with this three-condition gate:

```typescript
function shouldContinueLoop(
  response: string,
  toolCalls: ExtractedToolCall[],
  roundsRemaining: number,
  gstackPassed: boolean,
  pdseScore: number,
  config: BladeAutoforgeConfig
): { continue: boolean; reason: string } {
  // Condition 1: Natural completion (model produced no tool calls)
  if (toolCalls.length === 0) {
    return { continue: false, reason: "natural_completion" };
  }
  // Condition 2: Hard ceiling (decremented counter, cannot be reset by model)
  if (roundsRemaining <= 0) {
    return { continue: false, reason: "hard_ceiling_reached" };
  }
  // Condition 3: Quality gate met (only checked when persistUntilGreen=true)
  if (config.persistUntilGreen && gstackPassed && pdseScore >= 90) {
    return { continue: false, reason: "quality_gate_passed" };
  }
  return { continue: true, reason: "ongoing" };
}
```

#### 4.2 Decrement-Only Ceiling Counter

Initialize at loop start:
```typescript
const hardCeiling = config.hardCeiling ?? (config.persistUntilGreen ? 200 : config.maxToolRounds ?? 50);
let roundsRemaining = hardCeiling;
```

On each round: `roundsRemaining -= 1;`

Warning at 25% remaining:
```typescript
if (roundsRemaining === Math.floor(hardCeiling * 0.25)) {
  this._postMessage({
    type: "autoforge_progress",
    payload: { ...currentProgressState, currentTask: `⚠️ Approaching round limit (${roundsRemaining} remaining)` }
  });
}
```

#### 4.3 loop_terminated Audit Event

On every exit, emit via `appendAuditEvent`:
```typescript
await appendAuditEvent({
  type: "loop_terminated",
  payload: {
    reason: exitReason,        // "natural_completion" | "hard_ceiling_reached" | "quality_gate_passed" | "user_stopped" | "error"
    roundsUsed: hardCeiling - roundsRemaining,
    roundsRemaining,
    finalPdse: lastPdseScore,
    gstackPassed: lastGstackPassed,
    sessionId,
    modelId: lastModelId,
  }
});
```

Also emit to webview:
```typescript
this._postMessage({
  type: "loop_terminated",
  payload: { reason: exitReason, roundsUsed, finalPdse: lastPdseScore }
});
```

#### 4.4 persistUntilGreen in AutoforgeIAL

In `packages/danteforge/src/autoforge.ts`, update `runAutoforgeIAL`:

```typescript
export async function runAutoforgeIAL(
  initialCode: string,
  context: AutoforgeContext,
  config: BladeAutoforgeConfig,  // updated type
  router: ModelRouter,
): Promise<AutoforgeResult> {
  const hardCeiling = config.hardCeiling ?? (config.persistUntilGreen ? 200 : config.maxIterations);
  let roundsRemaining = hardCeiling;
  let currentCode = initialCode;
  const history: AutoforgeIteration[] = [];
  
  while (roundsRemaining > 0) {
    roundsRemaining -= 1;
    // ... run anti-stub → gstack → pdse → lessons ...
    const gstackPassed = allGStackPassed(gstackResults);
    const pdseScore = pdseResult.overall;
    
    if (pdseScore >= (config.pdseThreshold ?? 90) && gstackPassed) {
      if (!config.persistUntilGreen || (config.persistUntilGreen && pdseScore >= 90)) {
        return { ..., terminationReason: "passed" };
      }
    }
    if (roundsRemaining === 0) {
      return { ..., terminationReason: "max_iterations" };
    }
    // regenerate and loop
  }
}
```

#### 4.5 Behavioral Contract

MUST:
- Initialize `roundsRemaining` once at loop start from `hardCeiling` — never reset during the loop
- Emit `loop_terminated` audit event on every exit path without exception
- Emit a warning progress event at 25% of ceiling remaining
- When `runUntilComplete: true` in STATE.yaml, default `hardCeiling` to 200

MUST NOT:
- Allow the model (via any tool call or message) to reset `roundsRemaining`
- Stop early due to a round count check anywhere except the decrement-only ceiling gate
- Silently stop without emitting `loop_terminated`

#### 4.6 Tests

```typescript
describe("Persistent Agent Loop", () => {
  it("continues past maxToolRounds when persistUntilGreen=true and quality not met", ...)
  it("stops when toolCalls.length === 0 regardless of roundsRemaining", ...)
  it("stops when roundsRemaining reaches 0 even if quality not met", ...)
  it("stops when persistUntilGreen=true AND gstackPassed AND pdse>=90", ...)
  it("emits loop_terminated audit event on every exit path", ...)
  it("emits warning progress event at 25% ceiling remaining", ...)
  it("roundsRemaining cannot be reset by any model tool call", ...)
  it("hardCeiling defaults to 200 when persistUntilGreen=true", ...)
})
```

---

### DELIVERABLE 5 — Self-Safety Guard (Gap: Self-Safety 3 → 9)

#### 5.1 isSelfModificationTarget (add to `packages/vscode/src/agent-tools.ts`)

```typescript
import * as path from "node:path";

/**
 * Returns true if the given file path targets DanteCode's own source files,
 * configuration, or constitutional documents.
 *
 * This guard is ALWAYS active regardless of agent mode (plan/build/yolo).
 * It fires before ANY Write or Edit tool dispatch.
 *
 * @param filePath - The file path the agent wants to write (relative or absolute)
 * @param projectRoot - The project root from STATE.yaml
 */
export function isSelfModificationTarget(
  filePath: string,
  projectRoot: string
): boolean {
  const resolved = path.resolve(projectRoot, filePath);
  const selfPaths: string[] = [
    path.join(projectRoot, "packages", "vscode"),      // VS Code extension source
    path.join(projectRoot, "packages", "cli"),          // CLI source
    path.join(projectRoot, "packages", "danteforge"),   // Verification brain
    path.join(projectRoot, "packages", "core"),         // Model router
    path.join(projectRoot, ".dantecode"),               // Audit log + STATE.yaml
    path.join(projectRoot, "CONSTITUTION.md"),          // Constitutional law
  ];
  return selfPaths.some((sp) => resolved === sp || resolved.startsWith(sp + path.sep));
}
```

#### 5.2 Guard Integration in Tool Dispatcher

In `packages/vscode/src/agent-tools.ts`, before executing Write or Edit:

```typescript
if (toolName === "Write" || toolName === "Edit") {
  const filePath = toolInput["file_path"] as string;
  if (isSelfModificationTarget(filePath, context.projectRoot)) {
    // 1. Log audit event
    await appendAuditEvent({
      type: "self_modification_attempt",
      payload: { filePath, toolName, modelId: context.currentModelId, roundId: context.roundId }
    });
    // 2. Signal sidebar provider to pause and show confirmation modal
    context.onSelfModificationAttempt?.(filePath);
    // 3. Await user decision (resolved via promise stored in sidebar provider)
    const allowed = await context.awaitSelfModConfirmation?.();
    if (!allowed) {
      await appendAuditEvent({ type: "self_modification_denied", payload: { filePath } });
      return { success: false, output: `Self-modification denied: ${filePath} is protected.` };
    }
    // 4. Run release:check before allowing
    const releaseGreen = await context.runReleaseCheck?.();
    if (!releaseGreen) {
      await appendAuditEvent({ type: "self_modification_denied", payload: { filePath, reason: "release_check_failed" } });
      return { success: false, output: `Self-modification blocked: release:check did not pass 100% green.` };
    }
    await appendAuditEvent({ type: "self_modification_allowed", payload: { filePath } });
  }
}
```

#### 5.3 ToolExecutionContext Extensions

```typescript
export interface ToolExecutionContext {
  projectRoot: string;
  workspaceFolder: vscode.WorkspaceFolder | undefined;
  silentMode: boolean;
  currentModelId: string;                                    // NEW
  roundId: string;                                           // NEW (randomUUID per round)
  onDiffHunk?: (hunk: DiffHunk) => void;                    // NEW
  onSelfModificationAttempt?: (filePath: string) => void;   // NEW
  awaitSelfModConfirmation?: () => Promise<boolean>;         // NEW
  runReleaseCheck?: () => Promise<boolean>;                  // NEW
}
```

#### 5.4 Sidebar Provider: runReleaseCheck

In `packages/vscode/src/extension.ts`, register a command `dantecode.runReleaseCheck`:

```typescript
export async function runReleaseCheck(projectRoot: string): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = childProcess.spawn("npm", ["run", "release:doctor"], {
      cwd: projectRoot,
      shell: true,
      stdio: "pipe",
    });
    proc.on("close", (code) => resolve(code === 0));
    proc.on("error", () => resolve(false));
  });
}
```

#### 5.5 Sidebar Provider: Self-Mod Confirmation Modal

When `onSelfModificationAttempt` fires in the sidebar provider, post:
```typescript
this._postMessage({
  type: "self_modification_blocked",
  payload: {
    filePath,
    reason: "Agent wants to modify a protected DanteCode file."
  }
});
```

Create a `Promise` stored as `this._selfModConfirmationResolver` that resolves
when the webview sends `user_confirmed_self_mod` back.

The webview HTML shows a modal:
```
⚠️ Protected File Access
Agent wants to modify: packages/vscode/src/sidebar-provider.ts
This file is part of DanteCode itself.
[Allow — run release:check first]  [Deny]
```

YOLO mode auto-clicks Allow (but still runs `runReleaseCheck`).

#### 5.6 CLI Guard

In `packages/cli/src/tools.ts`, add the same `isSelfModificationTarget` check.
In CLI mode, the confirmation prompt is a `readline` y/N prompt:
```
⚠️ Agent wants to modify packages/cli/src/agent-loop.ts (protected DanteCode file).
Running release:doctor... [PASS]
Allow? [y/N]:
```

#### 5.7 Bash Tool Guard

The Bash tool can also be used to write files (e.g., `echo "..." > packages/cli/src/...`).
Add pattern detection in the Bash tool executor:

```typescript
const SELF_MOD_BASH_PATTERNS = [
  />\s*packages\/(vscode|cli|danteforge|core)\//,
  />\s*\.dantecode\//,
  />\s*CONSTITUTION\.md/,
  /echo\s+.*>\s*packages\//,
  /tee\s+packages\//,
];

if (SELF_MOD_BASH_PATTERNS.some(p => p.test(command))) {
  // Trigger same guard flow as Write/Edit
}
```

#### 5.8 New Audit Event Types (add to config-types)

```typescript
export type AuditEventType =
  | "session_start"
  | "chat_message"
  | "agent_loop"
  | "self_modification_attempt"    // NEW
  | "self_modification_allowed"    // NEW
  | "self_modification_denied"     // NEW
  | "loop_terminated"              // NEW
  | "tier_escalation"              // NEW (for Deliverable 6)
  | "cost_update";                 // NEW (for Deliverable 6)
```

#### 5.9 Tests

```typescript
describe("Self-Safety Guard", () => {
  it("isSelfModificationTarget returns true for packages/vscode path", ...)
  it("isSelfModificationTarget returns true for packages/cli path", ...)
  it("isSelfModificationTarget returns true for packages/danteforge path", ...)
  it("isSelfModificationTarget returns true for packages/core path", ...)
  it("isSelfModificationTarget returns true for .dantecode directory", ...)
  it("isSelfModificationTarget returns true for CONSTITUTION.md", ...)
  it("isSelfModificationTarget returns false for user project files", ...)
  it("isSelfModificationTarget returns false for packages/sandbox path", ...)
  it("self_modification_attempt audit event emitted on detection", ...)
  it("self_modification_denied emitted when user clicks Deny", ...)
  it("self_modification_allowed emitted after user confirms AND release:check passes", ...)
  it("self_modification_denied emitted when release:check fails even after user confirms", ...)
  it("YOLO mode still runs release:check before allowing", ...)
  it("Bash tool pattern detection catches echo redirect to cli source", ...)
})
```

---

### DELIVERABLE 6 — Smart Cost Routing (Gap: Cost Routing 7 → 9)

#### 6.1 New Types (add to `packages/config-types/src/index.ts`)

```typescript
/** Context used to select the appropriate model tier for a request. */
export interface RoutingContext {
  /** Estimated input tokens (character count / 4 heuristic). */
  estimatedInputTokens: number;
  /** Task type influences tier selection. */
  taskType: "chat" | "autoforge" | "edit" | "read";
  /** Number of consecutive GStack failures in this session. */
  consecutiveGstackFailures: number;
  /** Number of files in scope for this operation. */
  filesInScope: number;
  /** User manually forced Tier 2 for the session. */
  forceCapable: boolean;
}

/** Live cost estimate for the current session. */
export interface CostEstimate {
  /** Total session cost in USD since last "New Chat". */
  sessionTotalUsd: number;
  /** Cost of the most recent request in USD. */
  lastRequestUsd: number;
  /** Current model tier in use. */
  modelTier: "fast" | "capable";
  /** Total tokens used this session. */
  tokensUsedSession: number;
}
```

#### 6.2 selectTier Method (add to ModelRouterImpl)

```typescript
/**
 * Selects the appropriate model tier based on routing context.
 * Tier escalation is one-way within a session — once "capable" is selected,
 * it remains "capable" for all subsequent requests.
 *
 * Tier 2 "capable" is selected when ANY of:
 * - estimatedInputTokens > 2000
 * - taskType === "autoforge"
 * - consecutiveGstackFailures >= 2
 * - filesInScope >= 3
 * - forceCapable === true
 * - this._currentTier === "capable" (escalation is permanent within session)
 */
selectTier(context: RoutingContext): "fast" | "capable" {
  if (
    this._currentTier === "capable" ||
    context.forceCapable ||
    context.estimatedInputTokens > 2000 ||
    context.taskType === "autoforge" ||
    context.consecutiveGstackFailures >= 2 ||
    context.filesInScope >= 3
  ) {
    if (this._currentTier !== "capable") {
      this._currentTier = "capable";
      void appendAuditEvent({ type: "tier_escalation", payload: { reason: context } });
    }
    return "capable";
  }
  return "fast";
}
```

#### 6.3 Model ID Constants

```typescript
// In packages/core/src/model-router.ts
const TIER_FAST_MODEL_ID    = "grok/grok-4-1-fast-non-reasoning";
const TIER_CAPABLE_MODEL_ID = "grok/grok-4.20-multi-agent-beta-0309";

// Token cost constants (update via STATE.yaml override when xAI pricing changes)
const GROK_FAST_INPUT_PER_MTK    = 0.30;  // USD per million tokens
const GROK_FAST_OUTPUT_PER_MTK   = 0.60;
const GROK_CAPABLE_INPUT_PER_MTK    = 3.00;
const GROK_CAPABLE_OUTPUT_PER_MTK   = 6.00;

// Anthropic fallback costs (Sonnet 4 pricing)
const ANTHROPIC_INPUT_PER_MTK    = 3.00;
const ANTHROPIC_OUTPUT_PER_MTK   = 15.00;
```

#### 6.4 Cost Accumulator

```typescript
// Private fields added to ModelRouterImpl:
private _sessionCostUsd = 0;
private _sessionTokensUsed = 0;
private _currentTier: "fast" | "capable" = "fast";
private _consecutiveGstackFailures = 0;

/**
 * Estimates token count from character count using chars/4 heuristic.
 */
estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Records the cost of a completed request and accumulates session totals.
 */
recordRequestCost(inputTokens: number, outputTokens: number, tier: "fast" | "capable", provider: "grok" | "anthropic"): CostEstimate {
  let inputRate: number, outputRate: number;
  if (provider === "anthropic") {
    inputRate = ANTHROPIC_INPUT_PER_MTK;
    outputRate = ANTHROPIC_OUTPUT_PER_MTK;
  } else if (tier === "capable") {
    inputRate = GROK_CAPABLE_INPUT_PER_MTK;
    outputRate = GROK_CAPABLE_OUTPUT_PER_MTK;
  } else {
    inputRate = GROK_FAST_INPUT_PER_MTK;
    outputRate = GROK_FAST_OUTPUT_PER_MTK;
  }
  const lastCost = (inputTokens * inputRate + outputTokens * outputRate) / 1_000_000;
  this._sessionCostUsd += lastCost;
  this._sessionTokensUsed += inputTokens + outputTokens;
  return {
    sessionTotalUsd: this._sessionCostUsd,
    lastRequestUsd: lastCost,
    modelTier: this._currentTier,
    tokensUsedSession: this._sessionTokensUsed,
  };
}

/**
 * Resets session cost accumulator. Called on "new_chat" inbound message.
 */
resetSessionCost(): void {
  this._sessionCostUsd = 0;
  this._sessionTokensUsed = 0;
  this._currentTier = "fast";
  this._consecutiveGstackFailures = 0;
}

getCostEstimate(): CostEstimate {
  return {
    sessionTotalUsd: this._sessionCostUsd,
    lastRequestUsd: 0,
    modelTier: this._currentTier,
    tokensUsedSession: this._sessionTokensUsed,
  };
}
```

#### 6.5 Status Bar Display

In `packages/vscode/src/status-bar.ts`, add cost and tier to the status bar item:

```typescript
// Current: "DanteCode  grok/grok-4.2-fast  PDSE: 91"
// Updated: "🔱 DanteCode  grok-fast  PDSE: 91  ~$0.014"

updateWithCost(modelTier: "fast" | "capable", pdse: number, costUsd: number): void {
  const tierLabel = modelTier === "fast" ? "grok-fast" : "grok-capable";
  const costLabel = `~$${costUsd.toFixed(3)}`;
  this._statusBarItem.text = `🔱 DanteCode  ${tierLabel}  PDSE: ${pdse}  ${costLabel}`;
  this._statusBarItem.tooltip = `Model tier: ${modelTier}\nSession cost: $${costUsd.toFixed(4)}\nClick to force capable tier`;
  this._statusBarItem.command = "dantecode.forceTierCapable";
}
```

Register `dantecode.forceTierCapable` command in `extension.ts`:
```typescript
vscode.commands.registerCommand("dantecode.forceTierCapable", () => {
  this._router.forceCapable();
  vscode.window.showInformationMessage("DanteCode: Escalated to capable tier for this session.");
});
```

#### 6.6 Sidebar Cost Display

In the sidebar webview HTML, show a cost bar below the model selector:
```html
<div class="cost-bar">
  <span class="cost-tier" id="cost-tier">grok-fast</span>
  <span class="cost-estimate" id="cost-estimate">~$0.000</span>
  <button class="escalate-btn" onclick="sendPrompt('/escalate-tier')">↑ escalate</button>
</div>
```

Update on `cost_update` message:
```javascript
case "cost_update": {
  document.getElementById("cost-tier").textContent = payload.modelTier;
  document.getElementById("cost-estimate").textContent = `~$${payload.sessionTotalUsd.toFixed(3)}`;
  break;
}
```

#### 6.7 Behavioral Contract

MUST:
- Escalate to capable tier and never de-escalate within a session
- Track `consecutiveGstackFailures` and auto-escalate at 2+ failures
- Emit `cost_update` webview message after every completed `streamText` or `generateText` call
- Reset cost accumulator when webview sends `new_chat` inbound message
- Emit `tier_escalation` audit event when tier changes from fast to capable

MUST NOT:
- Block or delay any request based on cost threshold
- De-escalate tier after escalating
- Display costs as exact (always prefix with `~` to signal estimation)

#### 6.8 Tests

```typescript
describe("Smart Cost Routing", () => {
  it("selectTier returns 'fast' for 500-token chat context", ...)
  it("selectTier returns 'capable' for 3000-token context", ...)
  it("selectTier returns 'capable' for autoforge task type", ...)
  it("selectTier returns 'capable' when consecutiveGstackFailures >= 2", ...)
  it("selectTier returns 'capable' when filesInScope >= 3", ...)
  it("selectTier returns 'capable' when forceCapable=true regardless of tokens", ...)
  it("selectTier always returns 'capable' once escalated (no de-escalation)", ...)
  it("recordRequestCost accumulates correctly across 3 mock requests", ...)
  it("estimateTokens returns ceil(chars/4)", ...)
  it("resetSessionCost resets all accumulators to zero", ...)
  it("tier_escalation audit event emitted exactly once per session escalation", ...)
  it("cost_update message emitted after every streamText call", ...)
})
```

---

### DELIVERABLE 7 — blade-progress Skill

#### 7.1 Skill Manifest

Create `packages/danteforge/skills/blade-progress/SKILL.dc.md`:

```markdown
---
name: blade-progress
version: 1.0.0
trigger: autoforge
description: >
  Wraps any AutoforgeConfig with the Blade v1.2 progress UX: silent mode,
  single-line status updates, PDSE tracking, and cost-aware phase reporting.
  Imported automatically when silentMode=true in BladeAutoforgeConfig.
schema:
  input: BladeAutoforgeConfig
  output: BladeProgressState[]
constitution:
  pdseThreshold: 90
  antiStubEnabled: true
  maxIterations: null  # defer to hardCeiling
---

# blade-progress

Autoforge skill that encapsulates the Blade v1.2 progress UX. When activated,
replaces per-tool webview messages with a single-line phase indicator.

## Usage

```typescript
import { BladeProgressEmitter } from "@dantecode/danteforge";

const emitter = new BladeProgressEmitter(config, (state) => {
  webview.postMessage({ type: "autoforge_progress", payload: state });
});
```

## Triggers

This skill is triggered automatically when:
1. `/autoforge --silent` is invoked from the CLI
2. `agentMode === "yolo"` in AgentConfig
3. `BladeAutoforgeConfig.silentMode === true`
```

#### 7.2 BladeProgressEmitter Class

Create `packages/danteforge/skills/blade-progress/blade-progress.ts`:

```typescript
import type { BladeAutoforgeConfig, BladeProgressState, GStackResult, PDSEScore } from "@dantecode/config-types";
import type { AutoforgeResult } from "../../src/autoforge.js";
import { formatBladeProgressLine } from "../../src/autoforge.js";

/**
 * BladeProgressEmitter encapsulates the Blade v1.2 progress UX.
 * Wraps an AutoforgeConfig and emits BladeProgressState events to the provided
 * emit callback on every significant lifecycle event.
 *
 * Usage:
 *   const emitter = new BladeProgressEmitter(config, (state) => postMessage(state));
 *   emitter.onIterationStart(1);
 *   emitter.onPDSEScore(score);
 *   emitter.onComplete(result);
 */
export class BladeProgressEmitter {
  private readonly _config: BladeAutoforgeConfig;
  private readonly _emit: (state: BladeProgressState) => void;
  private _currentPhase = 0;
  private _currentRound = 0;
  private _lastPdseScore = 0;
  private _estimatedCostUsd = 0;
  private _currentTask = "Initializing...";

  constructor(
    config: BladeAutoforgeConfig,
    emit: (state: BladeProgressState) => void
  ) {
    this._config = config;
    this._emit = emit;
  }

  /** Called when a new autoforge iteration begins. */
  onIterationStart(iteration: number): void {
    this._currentPhase = iteration;
    this._currentTask = `Running iteration ${iteration}...`;
    this._emitState();
  }

  /** Called after each tool round completes. */
  onToolRound(round: number, toolName: string): void {
    this._currentRound = round;
    this._currentTask = `Tool: ${toolName} (round ${round})`;
    this._emitState();
  }

  /** Called with GStack results after each GStack run. */
  onGStackResult(result: GStackResult): void {
    const status = result.passed ? "✓" : "✗";
    this._currentTask = `GStack ${result.command}: ${status}`;
    this._emitState();
  }

  /** Called after PDSE scoring completes. */
  onPDSEScore(score: PDSEScore): void {
    this._lastPdseScore = score.overall;
    this._currentTask = `PDSE scored: ${score.overall}/100`;
    this._emitState();
  }

  /** Called with cost update from ModelRouterImpl. */
  onCostUpdate(costUsd: number): void {
    this._estimatedCostUsd = costUsd;
    this._emitState();
  }

  /** Called when the autoforge run completes (pass or fail). */
  onComplete(result: AutoforgeResult): void {
    this._currentTask = result.succeeded ? "✅ Complete" : "❌ Did not pass all gates";
    this._emit({
      phase: this._currentPhase,
      totalPhases: this._config.hardCeiling ?? this._config.maxIterations,
      percentComplete: 100,
      pdseScore: result.finalScore?.overall ?? this._lastPdseScore,
      estimatedCostUsd: this._estimatedCostUsd,
      currentTask: this._currentTask,
      silentMode: this._config.silentMode ?? false,
    });
  }

  private _emitState(): void {
    const totalPhases = this._config.hardCeiling ?? this._config.maxIterations;
    const percentComplete = this._currentPhase === 0
      ? 0
      : Math.floor(((this._currentPhase - 1) / totalPhases) * 100);
    const state: BladeProgressState = {
      phase: this._currentPhase,
      totalPhases,
      percentComplete,
      pdseScore: this._lastPdseScore,
      estimatedCostUsd: this._estimatedCostUsd,
      currentTask: this._currentTask,
      silentMode: this._config.silentMode ?? false,
    };
    this._emit(state);
  }
}

export { formatBladeProgressLine };
```

#### 7.3 Export from package index

In `packages/danteforge/src/index.ts`, add:
```typescript
export { BladeProgressEmitter, formatBladeProgressLine } from "../skills/blade-progress/blade-progress.js";
export { generateProgressBar } from "./autoforge.js";
```

#### 7.4 Tests

```typescript
describe("BladeProgressEmitter", () => {
  it("onIterationStart sets phase and emits correctly", ...)
  it("onToolRound updates currentTask with tool name", ...)
  it("onGStackResult shows pass/fail indicator in task", ...)
  it("onPDSEScore updates lastPdseScore in emitted state", ...)
  it("percentComplete at phase 3 of 5 = floor(2/5*100) = 40", ...)
  it("onComplete always emits percentComplete: 100", ...)
  it("onComplete sets succeeded message when result.succeeded=true", ...)
  it("onCostUpdate updates estimatedCostUsd in emitted state", ...)
})
```

---

## SECTION 5 — CONSTITUTIONAL COMPLIANCE MATRIX

| Requirement | D1 Progress | D2 Streaming | D3 Diffs | D4 Loop | D5 Self-Safety | D6 Cost | D7 Skill |
|---|---|---|---|---|---|---|---|
| Anti-Stub: no stubs/TODOs | ✅ Required | ✅ Required | ✅ Required | ✅ Required | ✅ Required | ✅ Required | ✅ Required |
| PDSE ≥ 90 on all new files | ✅ Gate | ✅ Gate | ✅ Gate | ✅ Gate | ✅ Gate | ✅ Gate | ✅ Gate |
| Zero Critical Constitution Violations | ✅ Gate | ✅ Gate | ✅ Gate | ✅ Gate | ✅ Gate | ✅ Gate | ✅ Gate |
| Strict TypeScript (no `any`) | ✅ Required | ✅ Required | ✅ Required | ✅ Required | ✅ Required | ✅ Required | ✅ Required |
| New interfaces in config-types | ✅ BladeProgressState, BladeAutoforgeConfig | ✅ — (method only) | ✅ DiffLine, DiffHunk | ✅ — (config extension) | ✅ AuditEventType extensions | ✅ RoutingContext, CostEstimate | ✅ — |
| Test Coverage (3+ per function) | ✅ 8 tests | ✅ 8 tests | ✅ 9 tests | ✅ 8 tests | ✅ 14 tests | ✅ 12 tests | ✅ 8 tests |
| One Door Doctrine (single postMessage) | ✅ via _postMessage | ✅ via _postMessage | ✅ via _postMessage | ✅ via _postMessage | ✅ via _postMessage | ✅ via _postMessage | N/A |
| Audit Chain (appendAuditEvent) | ✅ loop_terminated | N/A | N/A | ✅ loop_terminated | ✅ 3 new event types | ✅ tier_escalation | N/A |
| DanteForge Verification (10/10 preserved) | ✅ Unchanged | ✅ Unchanged | ✅ Unchanged | ✅ Unchanged | ✅ Unchanged | ✅ Unchanged | ✅ Extends |

---

## SECTION 6 — FULL TEST INVENTORY

### config-types — No test file (pure types, validated by tsc)
- TypeScript compilation of all 7 new interfaces/types: validated by `npm run typecheck`

### packages/core/src/model-router.test.ts (ADD: 20 new tests)
```
streamText / yields chunks → 8 tests (D2)
selectTier / tier logic → 6 tests (D6)
recordRequestCost / accumulation → 4 tests (D6)
resetSessionCost → 1 test (D6)
estimateTokens → 1 test (D6)
```

### packages/git-engine/src/diff.test.ts (ADD: 9 new tests)
```
generateColoredHunk / new file → 1 test (D3)
generateColoredHunk / deleted file → 1 test (D3)
generateColoredHunk / modified file → 3 tests (D3)
generateColoredHunk / binary file → 1 test (D3)
generateColoredHunk / truncation → 1 test (D3)
generateColoredHunk / line counts → 2 tests (D3)
```

### packages/danteforge/src/autoforge.test.ts (ADD: 16 new tests)
```
generateProgressBar → 3 tests (D1)
formatBladeProgressLine → 1 test (D1)
runAutoforgeIAL / persistUntilGreen → 4 tests (D4)
BladeProgressEmitter lifecycle → 8 tests (D7)
```

### packages/vscode/src/vscode.test.ts (ADD: 30 new tests)
```
BladeProgressState serialization → 3 tests (D1)
silentMode suppression logic → 3 tests (D1)
isSelfModificationTarget → 8 tests (D5)
Self-mod audit events → 5 tests (D5)
runReleaseCheck → 2 tests (D5)
YOLO mode + release:check → 2 tests (D5)
cost_update message dispatch → 3 tests (D6)
loop_terminated message dispatch → 4 tests (D4)
```

### Total New Tests: 75
### Combined Total: 562 + 75 = **637 tests**

---

## SECTION 7 — GSTACK EXPECTED OUTPUT (GREEN RUN)

```bash
> npm run typecheck

> dantecode@1.0.0 typecheck
> turbo typecheck

• Packages in scope: @dantecode/config-types, @dantecode/core, @dantecode/danteforge,
  @dantecode/git-engine, @dantecode/skill-adapter, @dantecode/sandbox, @dantecode/cli,
  dantecode (vscode), @dantecode/desktop
• Running typecheck in 9 packages
✓ 9/9 packages — 0 type errors

> npm run lint

> dantecode@1.0.0 lint
> turbo lint

• Running lint in 9 packages
✓ 9/9 packages — 0 ESLint violations

> npm test

> dantecode@1.0.0 test
> vitest run

✓ packages/core/src/model-router.test.ts (53 tests)     [pass]
✓ packages/core/src/audit.test.ts (12 tests)             [pass]
✓ packages/core/src/state.test.ts (15 tests)             [pass]
✓ packages/core/src/providers.test.ts (21 tests)         [pass]
✓ packages/core/src/integration.test.ts (7 tests)        [pass]
✓ packages/core/src/multi-agent.test.ts (18 tests)       [pass]
✓ packages/danteforge/src/anti-stub-scanner.test.ts (36 tests) [pass]
✓ packages/danteforge/src/pdse-scorer.test.ts (32 tests) [pass]
✓ packages/danteforge/src/constitution.test.ts (42 tests) [pass]
✓ packages/danteforge/src/gstack.test.ts (15 tests)      [pass]
✓ packages/danteforge/src/autoforge.test.ts (38 tests)   [pass]
✓ packages/danteforge/src/lessons.test.ts (17 tests)     [pass]
✓ packages/danteforge/src/e2e.test.ts (20 tests)         [pass]
✓ packages/git-engine/src/diff.test.ts (32 tests)        [pass]
✓ packages/git-engine/src/commit.test.ts (15 tests)      [pass]
✓ packages/git-engine/src/repo-map.test.ts (13 tests)    [pass]
✓ packages/git-engine/src/worktree.test.ts (13 tests)    [pass]
✓ packages/skill-adapter/src/wrap.test.ts (22 tests)     [pass]
✓ packages/skill-adapter/src/registry.test.ts (33 tests) [pass]
✓ packages/skill-adapter/src/importer.test.ts (28 tests) [pass]
✓ packages/skill-adapter/src/parsers.test.ts (30 tests)  [pass]
✓ packages/cli/src/cli.test.ts (30 tests)                [pass]
✓ packages/sandbox/src/sandbox.test.ts (14 tests)        [pass]
✓ packages/vscode/src/vscode.test.ts (81 tests)          [pass]
✓ packages/desktop/src/desktop.test.ts (18 tests)        [pass]

Test Suites: 25 passed, 25 total
Tests:       637 passed, 637 total
Duration:    ~18s

> npm run test:coverage

V8 Coverage Report — Stable Packages:
  core/src                   98.2% stmts  | 93.1% branch  | 100% funcs
  core/src/providers         100%  stmts  | 100%  branch  | 100% funcs
  danteforge/src             95.4% stmts  | 85.2% branch  | 97.8% funcs
  git-engine/src             94.8% stmts  | 83.1% branch  | 100% funcs
  skill-adapter/src          92.6% stmts  | 67.2% branch  | 100% funcs
  All stable packages        95.8% stmts  | 84.3% branch  | 99.4% funcs
  Thresholds: stmts>=30 ✓  funcs>=80 ✓  lines>=30 ✓

> npm run release:doctor

DanteCode Release Doctor v1.0.0
─────────────────────────────────────────────────
✓ Git: clean working tree, remote configured
✓ Node.js: v20.x (required: 20+)
✓ Build: all 9 packages build successfully
✓ Typecheck: 0 errors
✓ Tests: 637/637 passing
✓ Coverage: above all thresholds
✓ Constitution: CONSTITUTION.md present
✓ Changelog: CHANGELOG.md up to date
─────────────────────────────────────────────────
Release Doctor: ALL SYSTEMS GO ✅
```

---

## SECTION 8 — CANONICAL END-TO-END TEST PROMPT

Paste this into DanteCode (YOLO mode, after Blade v1.2 is implemented) to validate
all seven deliverables in a single long `/autoforge` run:

```
/autoforge --silent --persist

Add a new CLI slash command `/blade-status` to DanteCode that displays the current
Blade runtime state. This command must be fully implemented with no stubs.

Exact requirements:

1. Add handler in packages/cli/src/slash-commands.ts:
   - Command name: `/blade-status`
   - Display: current BladeProgressState from last autoforge run (or "No autoforge
     run in this session" if none)
   - Display: session CostEstimate from ModelRouterImpl.getCostEstimate()
   - Display: self-modification guard status ("ARMED — 6 paths protected" or custom)
   - Display: current model tier ("fast" | "capable") and session token count

2. Register in packages/cli/src/index.ts as a recognized slash command.

3. Add to packages/cli/src/banner.ts the `/blade-status` entry in the help table.

4. Add 6 test cases in packages/cli/src/cli.test.ts:
   - `/blade-status` outputs "No autoforge run" when no run has occurred
   - `/blade-status` shows correct phase/pdse/cost after a mock autoforge run
   - `/blade-status` shows "ARMED" for self-mod guard
   - `/blade-status` shows correct tier after escalation
   - `/blade-status` shows session token count
   - `/blade-status` is listed in `/help` output

5. Run GStack (typecheck + lint + test) after every file modification.
   Do not declare done until GStack is 100% green.

6. Every modified file must score PDSE ≥ 90 and zero constitution violations.

Constitution: anti-stub doctrine enforced. No stubs, no TODOs, no placeholder
implementations. Complete, production-ready TypeScript throughout.
```

**What this prompt validates:**
- D1 Silent progress: `/autoforge --silent` triggers BladeProgressEmitter
- D4 Persistent loop: `--persist` flag enables `persistUntilGreen`
- D5 Self-safety: command modifies CLI source → guard fires → user confirms → release:check runs
- D3 Visual diffs: every file write produces a `diff_hunk` message in the webview
- D2 Streaming: model responses stream token-by-token during the long run
- D6 Cost routing: cost display updates in status bar and sidebar throughout
- D7 blade-progress skill: BladeProgressEmitter drives all progress events

---

## SECTION 9 — GIT COMMANDS

```bash
cd C:\Projects\DanteCode

# Verify clean state before push
npm run typecheck && npm run lint && npm test && npm run release:doctor

# Stage all changes
git add -A

# Commit (HEREDOC format per AGENTS.dc.md)
git commit -m "feat: DanteCode Blade v1.2 — close all six UX gaps

Deliverables:
- D1: BladeProgressState + BladeProgressEmitter + silent autoforge UX (Progress 5->9)
- D2: streamText() + provider SSE streaming + webview chunk rendering (Streaming 7->9)  
- D3: DiffHunk + generateColoredHunk + webview colored diff rendering (Diffs 6->9)
- D4: persistUntilGreen + decrement ceiling + three-condition exit (Long Task 6->9)
- D5: isSelfModificationTarget + release:check gate + modal confirm (Self-Safety 3->9)
- D6: selectTier + recordRequestCost + session cost display (Cost Routing 7->9)
- D7: blade-progress skill + BladeProgressEmitter class export

Test delta: 562 -> 637 tests (75 new, 100% pass rate)
Coverage: 95.8% stmts on stable packages (above all thresholds)
Constitutional: PDSE>=90 all files | Zero criticals | GStack green | Anti-stub clean

State machine: RELEASE -> BLADE_READY"

# Push to remote
git push origin main

# Tag the Blade release
git tag -a v1.2.0 -m "DanteCode Blade v1.2 — all six UX gaps closed"
git push origin v1.2.0
```

---

## APPENDIX — PACKAGE MODIFICATION SUMMARY

| Package | Files Modified | Files Created | Net New Lines (est.) |
|---|---|---|---|
| config-types | src/index.ts | — | ~80 |
| core | src/model-router.ts, src/providers/grok.ts, src/providers/anthropic.ts, src/providers/ollama.ts, src/providers/openai.ts | — | ~250 |
| danteforge | src/autoforge.ts, src/index.ts | skills/blade-progress/SKILL.dc.md, skills/blade-progress/blade-progress.ts | ~200 |
| git-engine | src/diff.ts | — | ~150 |
| vscode | src/sidebar-provider.ts, src/agent-tools.ts, src/extension.ts, src/status-bar.ts, assets/theme.css | — | ~400 |
| cli | src/slash-commands.ts, src/agent-loop.ts, src/tools.ts | — | ~120 |
| **Total** | **16 files** | **2 files** | **~1,200 lines** |

No new external npm dependencies. All features implemented using existing packages:
- Streaming: native `fetch` with SSE response body reading (already available in Node 20)
- Diff generation: pure TypeScript Myers diff (no `diff` npm package needed)
- Self-mod guard: `node:path` (already imported everywhere)
- Cost tracking: in-memory arithmetic (no external deps)

---

*PRD status: IMPLEMENTATION-READY*
*Constitutional compliance: All 7 gates specified and testable*
*Execution mode: Paste into DanteCode YOLO mode or Claude Code*
*Council sign-off: Claude (Architect) ✓ | Grok (Analyst) ✓*
