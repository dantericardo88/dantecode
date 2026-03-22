I’ve found Qwen’s core behavior for this exact problem: it has a real tool scheduler with explicit states (`validating`, `awaiting_approval`, `scheduled`, `executing`, terminal states), a request queue, and sequential execution for most tools. Now I’m checking whether DanteCode has an equivalent runtime or only pieces of it.

I’ve confirmed DanteCode already has useful building blocks—durable run state, workflow contracts, background execution, web search orchestration—but they are not welded into the same hard tool-state machine Qwen uses. I’m extracting the exact gap points and turning them into a concrete PRD rather than a vague comparison.

Thought for 8m 14s

I inspected the uploaded source trees for both repos and checked Qwen Code’s current public docs/releases. I did a static code review of the uploaded zips; I did not run end-to-end live executions of either repo.

## **Bottom line**

Your intuition is correct, but the important detail is this:

**Qwen Code does not solve “wait until the download finishes” with a prompt trick. It solves it with runtime architecture.**

In Qwen, tool execution is mediated by a real scheduler with explicit states, approval gating, queued requests, and blocking execution semantics. For most tools, it does **not** move on to the next step until the current tool promise has resolved and been marked terminal. Its public docs also show explicit approval modes, confirmation for web tools, and config-driven local model providers using OpenAI-compatible endpoints.

DanteCode already has useful pieces, but they are scattered:

* a sequential per-turn tool loop,  
* a durable run store,  
* a background agent runner,  
* a workflow contract layer,  
* a web-search orchestrator,  
* a web-fetch engine,  
* an Ollama provider.

What DanteCode is missing is the **single welded execution core** that turns those pieces into a deterministic tool runtime.

## **What Qwen Code is doing that matters**

### **1\) Qwen has a first-class tool state machine**

In `packages/core/src/core/coreToolScheduler.ts`, Qwen defines explicit tool-call states:

* `validating`  
* `scheduled`  
* `executing`  
* `awaiting_approval`  
* terminal states: `success`, `error`, `cancelled`

That is the center of gravity. It is not just “call a tool and hope.” It models the lifecycle directly (`coreToolScheduler.ts:82-159`).

It also has:

* `isRunning()` that treats `executing` and `awaiting_approval` as active blockers (`coreToolScheduler.ts:576-583`)  
* `requestQueue` \+ `schedule()` queuing if something is already running (`coreToolScheduler.ts:339-345`, `649-683`)  
* `_schedule()` refusing to schedule new calls while active calls are still running or waiting approval (`coreToolScheduler.ts:685-694`)

That is the architectural reason Qwen naturally waits.

### **2\) Qwen validates/approves the entire tool batch before execution**

The most important piece is `attemptExecutionOfScheduledCalls()` in `coreToolScheduler.ts:1327-1365`.

It checks that all tool calls are either:

* `scheduled`, or  
* already terminal.

Only then does it execute.

Then it explicitly does:

* **Task** tools concurrently  
* **all other tools sequentially in original order**

The code comment says exactly why: preserve implicit ordering the model may rely on (`coreToolScheduler.ts:1343-1361`).

That means if the model says:

1. fetch/download thing  
2. read/process thing  
3. edit file

Qwen’s runtime naturally holds step 2 until step 1 has actually finished.

### **3\) Qwen’s tool execution is promise-blocking, not advisory**

In `executeSingleToolCall()` Qwen moves the call to `executing`, invokes the tool, and `await`s the promise before marking `success` or `error` (`coreToolScheduler.ts:1368-1636`).

So for network/file tools, the runtime does not “assume” completion. It waits for the actual return.

That is the answer to your download example:

* Qwen would not continue because the tool has not yet produced a terminal result.

### **4\) Qwen wraps dangerous or external tools in confirmation \+ permission rules**

Qwen’s docs show approval modes like `plan`, `default`, `auto-edit`, and `yolo`. In auto-edit, file edits can be auto-approved while shell commands still require approval; in yolo, all tool calls are auto-approved.

In code:

* write operations default to `ask` (`write-file.ts:99-103`)  
* edit operations default to `ask` (`edit.ts:264-268`)  
* some external/out-of-workspace reads can require `ask` (`read-file.ts:83-100`)  
* web search defaults to `ask` (`web-search/index.ts:61-84`)  
* web fetch defaults to `ask` (`web-fetch.ts:155-193`)

And the settings/docs describe fine-grained permission rules and approval mode behavior.

### **5\) Qwen’s web tools are intentionally blocking and one-at-a-time**

Qwen’s docs for `web_fetch` say:

* it asks for confirmation,  
* fetches directly,  
* processes one URL at a time.

In code, `web-fetch.ts`:

* awaits `fetchWithTimeout(...)`  
* awaits `response.text()`  
* awaits model post-processing via `generateContent(...)`  
  (`web-fetch.ts:79-121`)

So even for network work, it is synchronous from the scheduler’s point of view.

### **6\) Qwen’s local LLM support is configuration-driven, not hard-wired**

Qwen’s docs show `modelProviders` with auth types and `baseUrl`, including local self-hosted OpenAI-compatible endpoints such as Ollama, vLLM, and LM Studio.

In the local docs section:

* local providers are configured through the `openai` auth type,  
* you can point to `http://localhost:11434/v1`, `:8000/v1`, `:1234/v1`, etc. (`docs/users/configuration/model-providers.md:188-255`)

This matters because the local LLM path is unified. It is not “if Ollama do X, if vLLM do Y” all over the runtime.

### **7\) Qwen also keeps evolving the runtime in this area**

Its current release notes include:

* auto-enable `WebFetch` and `WebSearch` in Plan mode,  
* enforce tool restrictions in subagents,  
* support session resume.

That suggests the runtime/tool layer is an active architectural priority, not an afterthought.

---

## **What DanteCode does today**

There is real progress in DanteCode. This is not a blank slate.

### **What is already good**

#### **Sequential tool execution exists**

In `packages/cli/src/agent-loop.ts`, extracted tool calls are executed in a simple loop and each tool call is awaited before moving to the next one (`agent-loop.ts:2050-2084`).

So DanteCode already has **basic serial execution** inside a single tool-call batch.

#### **Workflow rules exist**

`packages/core/src/workflow-runtime.ts` tells the model:

* execute stages in order,  
* stop immediately on blocked/failed tool steps,  
* do not claim completion without real tool evidence  
  (`workflow-runtime.ts:148-176`).

That is good governance, but it is mostly prompt/contract level, not runtime enforcement.

#### **Durable run state exists**

`packages/core/src/durable-run-store.ts` supports run persistence, checkpoints, evidence, and `waiting_user` status (`durable-run-store.ts:48-110`).

#### **Background work exists**

`packages/core/src/background-agent.ts` has a queue, concurrency control, resume/checkpointing, and async task handling (`background-agent.ts:1-120`).

#### **Search/fetch components exist**

* `web-search-orchestrator.ts` does concurrent provider search with fallback (`web-search-orchestrator.ts:202-250`)  
* `web-fetch-engine.ts` supports timeouts and confidence-based escalation (`web-fetch-engine.ts:149-245`)

#### **Local Ollama support exists**

`packages/core/src/providers/ollama.ts` uses an OpenAI-compatible wrapper with default `http://localhost:11434/v1` (`ollama.ts:12-38`).

So DanteCode has **pieces of the answer**.

---

## **The core gap: DanteCode has execution logic, but not a unified tool runtime**

Right now DanteCode’s foreground execution path is primarily:

* LLM output  
* extract tool calls  
* iterate tool calls  
* await each one  
* append plain-text result back into session

That works for simple flows, but it is much weaker than Qwen’s scheduler model.

### **The exact gaps**

## **Gap analysis**

### **Gap 1: No explicit foreground tool-call state machine**

DanteCode’s main loop has sequential execution, but not a first-class lifecycle like:  
`pending -> validating -> awaiting_approval -> scheduled -> executing -> success/error/cancelled`.

Instead, tool state is mostly implicit inside the loop (`agent-loop.ts:1990-2148`).

**Why this matters:**  
Without explicit states, you cannot reliably:

* pause/resume a specific tool call,  
* show “download pending / approval pending / running / done,”  
* block downstream operations based on exact dependency state,  
* recover after interruption at the tool-call level.

### **Gap 2: No central scheduler/queue for foreground tool batches**

Qwen has a scheduler with queue semantics. Dante has a loop.

Dante’s loop serializes current tool calls, but it does not provide a reusable runtime service that:

* validates a batch,  
* queues later requests,  
* coordinates approval,  
* guarantees scheduling invariants across subagents/tools/workflows.

**Effect:** behavior is correct in the happy path, but brittle across:

* nested tools,  
* pauses,  
* user approvals,  
* background/foreground mixing,  
* resumptions.

### **Gap 3: Approval is fragmented or missing at tool-runtime level**

Qwen treats permissions as a runtime primitive. Dante has safety checks, but not a comparable approval bus for all external/mutating tools.

Examples:

* `WebFetch` in Dante just validates URL and fetches it directly; no approval state (`packages/cli/src/tools.ts:908-998`)  
* `WebSearch` likewise just executes (`tools.ts:830-906`)  
* shell safety exists, but that is not the same as approval state (`executeTool()` and safety guards in `tools.ts:1505-1665`)

**Effect:** Dante can block some dangerous actions, but it cannot cleanly express:

* “this action is pending approval”  
* “this domain/tool is always allowed in this repo”  
* “this request was denied and therefore downstream steps must not run”

### **Gap 4: No typed dependency gating for downloads/artifacts**

This is the big one for your use case.

Dante does not appear to have a first-class “download artifact” contract such as:

* requested URL  
* target path  
* expected file type  
* checksum  
* expected bytes  
* completion verification  
* extraction verification  
* availability state

Today, a download is likely one of:

* a `WebFetch`  
* a `Bash curl/wget`  
* some MCP tool  
* maybe a future GitHub op

That means the runtime lacks a typed invariant like:

“Step B cannot start until artifact A exists, is non-empty, matches expected conditions, and the tool result marked it verified.”

**Effect:** the model can still be correct, but the runtime is not enforcing correctness.

### **Gap 5: Tool results are mostly text, not typed execution evidence**

In the loop, tool output is appended as:  
`Tool "X" result:\n...` (`agent-loop.ts:2141-2144`)

There is evidence tracking, which is good, but tool results are still largely plain text from the next-step planner’s perspective.

For orchestration, you want structured results like:

* `status`  
* `artifacts[]`  
* `filesTouched[]`  
* `urlsFetched[]`  
* `bytesDownloaded`  
* `checksumVerified`  
* `exitCode`  
* `retryable`  
* `blockedReason`  
* `requiresApproval`  
* `nextReadyConditions`

Without this, the model has to infer too much from prose.

### **Gap 6: Background execution can violate “do not move on yet”**

Dante’s `SubAgent` supports `background: true` and explicitly returns immediately with a task ID (`agent-loop.ts:1182-1212`, `tools.ts:1006-1063`, schema around `tools.ts:2047-2063`).

That is a powerful feature, but dangerous unless the runtime distinguishes:

* **foreground blocking dependencies**  
* **background fire-and-forget tasks**  
* **background tasks whose outputs are prerequisites**

Right now the runtime leaves that distinction too open to model judgment.

**Effect:** Dante can accidentally continue while a prerequisite job is still running.

### **Gap 7: Workflow contracts exist, but enforcement is mostly prompt-based**

`workflow-runtime.ts` says “stop immediately on blocked or failed tool steps,” which is correct. But that is still instruction text, not a scheduler-enforced DAG with step readiness.

**Effect:** a strong model may obey; a weaker/local model may drift.

### **Gap 8: Local model support is less unified than Qwen’s provider model**

Dante’s Ollama provider is fine, but it is a dedicated wrapper (`providers/ollama.ts:1-44`).

Qwen’s model-provider setup is more general:

* multiple providers,  
* provider metadata,  
* local endpoints through a unified config layer,  
* switchable via `/model`.

**Gap for Dante:**  
You need a model capability registry that explicitly tells the runtime:

* supports native tool calling?  
* structured output reliability?  
* streaming?  
* max timeout?  
* retry profile?  
* cost class?  
* local vs cloud?  
* safe for planner? safe for executor?

Right now the path is more ad hoc.

### **Gap 9: No explicit “foreground blocking” vs “async background” policy**

Dante has background infrastructure, but not a hard policy layer saying:

* downloads are blocking by default,  
* web fetches used as dependencies are blocking,  
* verification steps are blocking,  
* subagents are background only when declared non-prerequisite.

This is the difference between “supports async” and “stays correct.”

### **Gap 10: No artifact verification step for shell/network tools**

Dante’s sandbox and shell execution can wait for process completion (`sandbox-engine.ts:270-330`), but completion of the process is not the same as completion of the intent.

Example:

* `curl -o file.zip ...` returning 0 is not enough  
* you also need:  
  * file exists  
  * size \> 0  
  * optional checksum  
  * unzip succeeded  
  * extracted expected file(s)

Qwen solves the general waiting problem via scheduler; Dante must go one step further and add **artifact verification semantics**.

### **Gap 11: Search/fetch are strong utilities, but not integrated into a dependency graph**

Dante’s search is actually pretty good:

* concurrent providers  
* fallback  
* result fusion  
  (`web-search-orchestrator.ts:202-261`)

Its fetch engine is also decent:

* timeout  
* auto-escalation on low confidence  
  (`web-fetch-engine.ts:149-245`)

But these are utilities, not part of a unified execution DAG.

### **Gap 12: File-use policy is less granular than Qwen’s**

Qwen has explicit per-tool permission defaults and path-sensitive read behavior:

* write/edit default ask,  
* external reads may ask,  
* web tools ask,  
* permission rules can persist. (`write-file.ts`, `edit.ts`, `read-file.ts`, `web-search/index.ts`, `web-fetch.ts`; plus docs)

Dante has strong safety hooks, but not a comparable unified permission grammar for:

* file reads outside repo,  
* file edits,  
* network access,  
* MCP domains/tools,  
* shell command classes.

---

## **What DanteCode should learn from Qwen**

Not “copy Qwen’s tools.”

Copy Qwen’s **runtime discipline**.

The winning pattern is:

1. **Every tool call has an explicit state**  
2. **Nothing executes without validation**  
3. **Nothing mutating/external executes without permission resolution**  
4. **Nothing dependent executes until prerequisite tool calls are terminal**  
5. **Tool outputs are structured evidence, not just text**  
6. **Background execution is opt-in and typed as non-blocking**  
7. **Local/cloud model providers are normalized behind capability metadata**

That is the part DanteCode needs.

---

# **PRD — Deterministic Tool Runtime for DanteCode**

## **1\) Product name**

**DanteCode Deterministic Tool Runtime (DTR)**

## **2\) Problem statement**

DanteCode can execute tools sequentially, but it lacks a unified scheduler/state machine for blocking dependencies, approvals, artifact verification, and deterministic pause/resume. As a result, operations involving downloads, web search/fetch, shell commands, subagents, and local model execution are more brittle than they should be.

## **3\) Goal**

Make DanteCode behave like a reliable operator:

* it must **not** move to dependent steps until prerequisites are truly complete,  
* it must distinguish foreground blocking work from background async work,  
* it must treat downloads/artifacts as verified entities, not plain text,  
* it must expose a deterministic execution state model across tool, workflow, and run levels.

## **4\) Non-goals**

* Replacing existing search/fetch/sandbox implementations immediately  
* Building a new IDE first  
* Solving all agent planning quality issues  
* Full distributed orchestration in v1

## **5\) Primary users**

* Richard / power user running Dante locally  
* Local-LLM-driven execution flows  
* Repo automation flows with shell \+ fetch \+ write \+ test  
* Future subagent / MCP / workflow users

## **6\) User stories**

1. As a user, if Dante downloads a file needed for the next step, it must not continue until the file is verified present and usable.  
2. As a user, if Dante fetches docs from the web before editing code, it must not edit until the fetch succeeds or fails terminally.  
3. As a user, if a tool requires approval, I want Dante to pause in a real `awaiting_approval` state.  
4. As a user, if Dante is resumed after interruption, I want tool-level state to restore correctly.  
5. As a user, I want background tasks only when explicitly safe to run asynchronously.  
6. As a user, I want local models to be configurable through one provider registry, not special-case code.

## **7\) Functional requirements**

### **FR-1: Introduce a foreground Tool Scheduler**

Create a core service:  
`packages/core/src/tool-runtime/tool-scheduler.ts`

Responsibilities:

* accept tool call requests  
* validate request schema  
* resolve permission  
* enqueue  
* schedule  
* execute  
* persist status changes  
* emit structured events  
* only release dependent steps when prerequisites are terminal

### **FR-2: Tool-call state machine**

Every tool call must have:

* `created`  
* `validating`  
* `awaiting_approval`  
* `scheduled`  
* `executing`  
* `verifying`  
* `success`  
* `error`  
* `cancelled`  
* `timed_out`

`verifying` is the new Dante addition beyond Qwen’s visible pattern.

### **FR-3: Typed dependency graph**

Each workflow/tool batch must support explicit dependencies:

* `dependsOn: toolCallId[]`

Rules:

* a call can enter `scheduled` only when dependencies are terminal and successful where required  
* dependent calls must not start if prerequisite verification failed  
* failed prerequisite marks downstream as `blocked_by_dependency`

### **FR-4: Artifact/result contracts**

Add typed result envelopes:

type ToolExecutionResult \= {  
 status: "success" | "error" | "cancelled" | "timed\_out";  
 summary: string;  
 evidence: {  
   filesRead?: string\[\];  
   filesWritten?: string\[\];  
   urlsFetched?: string\[\];  
   commandsRun?: string\[\];  
   artifacts?: ArtifactRecord\[\];  
   exitCode?: number;  
   durationMs: number;  
 };  
 verification?: {  
   passed: boolean;  
   checks: VerificationCheck\[\];  
 };  
 retryable?: boolean;  
 blockedReason?: string;  
};

Artifact contract:

type ArtifactRecord \= {  
 id: string;  
 kind: "download" | "archive" | "document" | "search-result" | "generated-file";  
 sourceUri?: string;  
 localPath?: string;  
 exists: boolean;  
 sizeBytes?: number;  
 mimeType?: string;  
 sha256?: string;  
 verified: boolean;  
};

### **FR-5: Dedicated Download/Acquire tool**

Do not force downloads through generic Bash if Dante needs deterministic behavior.

Add:

* `AcquireUrl`  
* `AcquireGitHubAsset`  
* `AcquireArchive`

Each must:

* download  
* verify file exists  
* verify size \> 0  
* optionally verify hash  
* optionally unpack  
* emit artifact record  
* stay blocking by default

### **FR-6: Approval Gateway**

Create:  
`packages/core/src/tool-runtime/approval-gateway.ts`

Capabilities:

* per-tool rules  
* per-domain rules  
* per-path rules  
* session/project/user scopes  
* states compatible with durable run store

Examples:

* `WebFetch(example.com) => allow`  
* `Write(src/**) => ask`  
* `Bash(npm test) => allow`  
* `Bash(curl *) => ask`  
* `Read(/outside/workspace/**) => ask`

### **FR-7: Hard distinction between blocking and background tools**

Each tool declares:

* `executionClass: "blocking" | "background" | "parallel-safe"`

Defaults:

* Write/Edit/Bash/WebFetch/WebSearch/Acquire\*: `blocking`  
* SubAgent: `blocking` unless caller explicitly sets `background=true`  
* only non-dependent background tasks may be detached

If a background task is referenced by a future dependency, the scheduler must convert it to tracked prerequisite mode.

### **FR-8: Tool execution must be structured, not only textual**

Agent loop must stop treating tool output as mainly prose.

Replace the current primary contract from:

* `Tool "X" result:\n...`

to:

* structured result persisted,  
* short text summary derived from structured result,  
* planner reads structured state first.

### **FR-9: Planner/executor split**

Introduce two roles in runtime:

* **planner** proposes steps and dependencies  
* **scheduler/executor** decides readiness and execution

The model can suggest sequence; the runtime owns truth.

### **FR-10: Model capability registry**

Create:  
`packages/core/src/model-runtime/model-capabilities.ts`

For each configured model:

* provider  
* baseUrl  
* local/cloud  
* supportsToolCalls  
* supportsStreaming  
* supportsReasoning  
* maxContext  
* timeoutMs  
* retries  
* safeExecutionProfile

This should subsume the current more specialized Ollama path while still reusing it internally.

### **FR-11: Unify local model provider config**

Adopt a Qwen-like configuration approach:

* generic OpenAI-compatible provider entries  
* arbitrary local `baseUrl`  
* env-key based credentials  
* named model profiles

This gives Dante one path for:

* Ollama  
* vLLM  
* LM Studio  
* OpenRouter-compatible  
* local gateways

Qwen’s docs are a strong model here.

### **FR-12: Verification stage for external operations**

For download/fetch/shell operations, a tool is not done at process completion. It is done only after verification.

Examples:

* `curl -o x.zip` → verify `x.zip` exists and size \> 0  
* `unzip x.zip -d dir` → verify expected directory/files exist  
* `npm install` → verify lockfile/node\_modules delta or expected package presence  
* `WebFetch` → verify response status/content non-empty  
* `Git clone` → verify target path contains repo metadata

### **FR-13: Resume-safe tool persistence**

Persist tool calls in durable run store with exact state.

Add to durable run payload:

* toolCallId  
* state  
* dependencyIds  
* approval status  
* artifact records  
* verification checks  
* resumable payload

### **FR-14: Event stream**

Emit canonical events:

* `tool.requested`  
* `tool.validated`  
* `tool.awaitingApproval`  
* `tool.scheduled`  
* `tool.started`  
* `tool.progress`  
* `tool.verifying`  
* `tool.completed`  
* `tool.failed`  
* `tool.blocked`  
* `artifact.available`  
* `artifact.verified`

This fits your Dante event-oriented architecture.

---

## **8\) UX requirements**

### **CLI**

Show exact states:

* `[validating] WebFetch https://...`  
* `[awaiting approval] Bash npm test`  
* `[executing] AcquireUrl model.gguf`  
* `[verifying] /models/model.gguf`  
* `[success] AcquireUrl model.gguf (1.8 GB, sha256 verified)`

### **Approval UX**

User should approve:

* once  
* session  
* project  
* user/global

### **Background UX**

If background is allowed:

* show task id  
* show whether it is blocking downstream work  
* scheduler should say:  
  `Task started in background, but workflow remains blocked until artifact X is verified.`

---

## **9\) Implementation plan**

### **Phase 1 — Runtime spine**

Build:

* `tool-call-types.ts`  
* `tool-scheduler.ts`  
* `approval-gateway.ts`  
* `tool-result-types.ts`  
* `artifact-store.ts`

Refactor `packages/cli/src/agent-loop.ts` to stop directly executing tools in the loop.  
Instead:

* extract tool calls  
* submit them to scheduler  
* await scheduler output

### **Phase 2 — Tool adapters**

Wrap current tools behind runtime adapters:

* Read  
* Write  
* Edit  
* Bash  
* WebSearch  
* WebFetch  
* SubAgent  
* MCP tools

### **Phase 3 — Artifact-aware tools**

Add:

* `AcquireUrl`  
* `AcquireArchive`  
* `VerifyPath`  
* `VerifyChecksum`

### **Phase 4 — Durable integration**

Persist tool states through `DurableRunStore`.

### **Phase 5 — Model/provider normalization**

Add generic provider registry and capability map.

### **Phase 6 — Policy hardening**

Add:

* approval scopes  
* per-domain/per-command rules  
* background safety rules  
* dependency blocking rules

---

## **10\) File-level recommendations for DanteCode**

### **Highest-priority files to change**

#### **`packages/cli/src/agent-loop.ts`**

Current problem:

* it directly executes tools in a `for` loop (`agent-loop.ts:2050-2084`)

Change:

* make it a planner/orchestrator only  
* submit tool calls to scheduler  
* consume structured results

#### **`packages/cli/src/tools.ts`**

Current problem:

* tools return mostly freeform text  
* `WebFetch` and `WebSearch` execute directly with no approval-state integration (`tools.ts:830-998`, `1505-1665`)

Change:

* migrate tool return contract to structured `ToolExecutionResult`  
* leave human-readable summary as derived field, not source of truth

#### **`packages/core/src/workflow-runtime.ts`**

Current problem:

* rule text exists, but enforcement is mostly instruction-level

Change:

* allow workflow steps to declare dependencies and blocking classes

#### **`packages/core/src/durable-run-store.ts`**

Current opportunity:

* already supports status/evidence/checkpointing

Change:

* persist tool-call state machine and artifact records

#### **`packages/core/src/background-agent.ts`**

Current opportunity:

* already has async queue \+ resume logic

Change:

* integrate with scheduler as explicit background lane only

#### **`packages/core/src/web-fetch-engine.ts`**

Current opportunity:

* strong utility already exists

Change:

* use it as execution engine behind a scheduler-aware `WebFetch` adapter with approval \+ verification

#### **`packages/core/src/web-search-orchestrator.ts`**

Current opportunity:

* strong provider orchestration

Change:

* wrap into scheduler-aware search tool with structured citations/result contract

#### **`packages/core/src/providers/ollama.ts`**

Current opportunity:

* can be absorbed into a generic local-provider registry

---

## **11\) Specific design rules DanteCode should enforce**

1. **No dependent step may run on text claims alone.**  
2. **Only terminal tool states unlock dependents.**  
3. **Process exit is not artifact success. Verification is required.**  
4. **Background tasks never satisfy dependencies until verified.**  
5. **Approval is a runtime state, not just a prompt.**  
6. **Search/fetch/download must emit structured evidence.**  
7. **Model decides intent; runtime decides readiness.**  
8. **Local/cloud model providers share one capability contract.**

---

## **12\) Acceptance criteria**

DanteCode is considered fixed for this PRD when all are true:

### **AC-1**

If asked to download a file and then process it, Dante does not process until:

* download tool is `success`  
* artifact exists  
* verification passed

### **AC-2**

If web fetch/search needs approval, Dante enters `awaiting_approval` and does not continue.

### **AC-3**

If a background subagent is launched for a prerequisite task, downstream steps remain blocked until completion \+ verification.

### **AC-4**

If execution is interrupted mid-tool, resume restores the exact tool-call state.

### **AC-5**

Every tool result includes structured evidence and verification metadata.

### **AC-6**

Every configured local LLM endpoint can be registered through one provider config model.

### **AC-7**

The agent loop no longer directly owns tool execution semantics.

---

## **13\) Test plan**

### **Unit tests**

* scheduler state transitions  
* dependency graph blocking  
* approval resolution  
* artifact verification  
* timeout \-\> `timed_out`  
* cancel \-\> `cancelled`

### **Integration tests**

1. `AcquireUrl -> VerifyPath -> Read`  
2. `WebSearch -> WebFetch -> Edit`  
3. `SubAgent(background=false) -> Write`  
4. `SubAgent(background=true)` with downstream dependency blocked  
5. resume during `awaiting_approval`  
6. resume during `verifying`  
7. local provider config for Ollama/vLLM/LM Studio

### **Failure-path tests**

* HTTP 404  
* partial download  
* zero-byte file  
* unzip failure  
* checksum mismatch  
* approval denied  
* dependency failed  
* network timeout  
* model without native tool calls

---

## **14\) Brutally honest assessment**

DanteCode is not failing because it lacks intelligence.  
It is failing because the **execution contract is too soft**.

Right now it has:

* decent utilities,  
* decent safety,  
* decent persistence,  
* decent search/fetch pieces.

But the system is still too dependent on the model “behaving correctly” in the moment.

Qwen’s advantage here is not that it has some secret smarter prompt.  
Its advantage is that its runtime assumes the model is fallible and therefore **enforces sequencing, approval, and completion structurally**.

That is the gap.

If you close only one thing, close this:

**Move tool correctness out of the prompt and into a deterministic scheduler with verification-aware dependencies.**

That will do more for DanteCode than another round of prompt tuning or another tool.

If you want, next I can turn this into a **Codex-ready V+E execution packet** with exact file paths, modules, interfaces, and implementation order for DanteCode.

Please create the V+E Execution packet

I’m turning the gap analysis into an implementation packet with exact modules, sequencing, gates, and acceptance criteria, and I’m re-checking the uploaded repos so the file paths match your codebase rather than staying generic.

I’ve confirmed the current Dante path is still loop-first, not scheduler-first. I’m locking the packet to your real file layout now so it tells Codex exactly what to add, what to refactor, and in what order.

Thought for 1m 31s

Below is a **Codex-ready V+E Execution Packet** for closing the tool/runtime gaps in DanteCode.

This is based on the uploaded DanteCode repo structure and the earlier Qwen comparison. It is written to be **implementation-first**, **fail-closed**, and aligned with your Dante naming/API style.

---

# **V+E Execution Packet**

## **DTR-01 — Deterministic Tool Runtime for DanteCode**

## **0\. Packet intent**

Build the missing runtime spine that makes DanteCode behave like a disciplined operator instead of a best-effort prompt loop.

The target outcome is simple:

* if Dante starts a download, fetch, shell command, or sub-agent task that is a prerequisite,  
* Dante **must not** continue to the next dependent step  
* until the current step is **terminal and verified**.

This packet hardens that behavior across:

* file use  
* tool use  
* approvals  
* local LLM execution  
* downloads/artifacts  
* background work  
* resume/recovery

---

# **1\. Executive diagnosis**

## **Current state in DanteCode**

DanteCode already has valuable pieces:

* `packages/cli/src/agent-loop.ts` executes tool calls serially in a loop  
* `packages/cli/src/tools.ts` contains `WebSearch`, `WebFetch`, `SubAgent`, `Bash`, file tools  
* `packages/core/src/workflow-runtime.ts` defines ordered workflow rules  
* `packages/core/src/durable-run-store.ts` gives durable run persistence  
* `packages/core/src/background-agent.ts` supports queued async work  
* `packages/core/src/web-search-orchestrator.ts` and `web-fetch-engine.ts` are strong utilities  
* `packages/core/src/providers/ollama.ts` already supports local OpenAI-compatible Ollama

## **Core gap**

The repo is still **loop-first**, not **scheduler-first**.

That means DanteCode currently has:

* tool execution  
* some persistence  
* some policy  
* some async

But it does **not** yet have a unified execution runtime that owns:

* tool states  
* approvals  
* dependency readiness  
* artifact verification  
* blocking vs background rules  
* deterministic resume

That is the gap this packet closes.

---

# **2\. Product goal**

Create a **Deterministic Tool Runtime** inside DanteCode so that:

1. every tool call has an explicit lifecycle  
2. every external/mutating action can be gated by approval policy  
3. every prerequisite action blocks dependents until terminal  
4. every artifact-producing action must be verified  
5. every background task is explicit and never silently satisfies dependencies  
6. every local/cloud model path is normalized behind a capability registry

---

# **3\. Non-negotiables**

These are hard rules for the implementation.

1. **No stubs**  
   * No TODOs  
   * No placeholder returns  
   * No “future implementation” comments without working code  
2. **Generation discipline**  
   * 1–4 files per generation  
   * each file under 500 LOC where practical  
   * tests included in the same generation  
   * CI must remain green  
3. **Fail-closed**  
   * unknown tool state \= blocked  
   * missing artifact verification \= blocked  
   * ambiguous approval \= ask  
   * dependency failure \= downstream blocked  
4. **Runtime over prompt**  
   * the model may propose  
   * the runtime decides readiness and execution truth  
5. **Structured evidence**  
   * tool results must be typed  
   * human-readable summaries are derived, not source of truth

---

# **4\. In-scope systems**

## **Must change**

* `packages/cli/src/agent-loop.ts`  
* `packages/cli/src/tools.ts`  
* `packages/core/src/durable-run-store.ts`  
* `packages/core/src/workflow-runtime.ts`  
* `packages/core/src/background-agent.ts`  
* `packages/core/src/providers/index.ts`  
* `packages/core/src/providers/ollama.ts`  
* `packages/core/src/unified-llm-client.ts`

## **Must add**

Under `packages/core/src/tool-runtime/`:

* `tool-call-types.ts`  
* `tool-result-types.ts`  
* `tool-scheduler.ts`  
* `approval-gateway.ts`  
* `artifact-store.ts`  
* `dependency-graph.ts`  
* `tool-events.ts`  
* `verification-rules.ts`

Under `packages/core/src/model-runtime/`:

* `model-capabilities.ts`  
* `provider-registry.ts`

Optional but strongly recommended:

* `packages/core/src/tool-runtime/acquire-tools.ts`  
* `packages/core/src/tool-runtime/tool-adapters.ts`

## **Must test**

* `packages/core/src/tool-runtime/*.test.ts`  
* `packages/cli/src/agent-loop.tool-runtime.test.ts`  
* `packages/cli/src/tools.runtime-adapter.test.ts`

---

# **5\. Architectural target**

## **New control split**

### **Planner lane**

Responsible for:

* interpreting user intent  
* proposing steps  
* proposing tool calls  
* proposing dependencies

### **Runtime lane**

Responsible for:

* validation  
* approval  
* scheduling  
* dependency resolution  
* execution  
* verification  
* persistence  
* resume

The planner can suggest sequence.  
The runtime owns truth.

---

# **6\. Canonical target architecture**

## **6.1 Tool runtime state machine**

Every tool call must move through:

export type ToolCallState \=  
 | "created"  
 | "validating"  
 | "awaiting-approval"  
 | "scheduled"  
 | "executing"  
 | "verifying"  
 | "success"  
 | "error"  
 | "cancelled"  
 | "timed-out"  
 | "blocked-by-dependency";

### **State rules**

* `created -> validating` always  
* `validating -> awaiting-approval` if policy requires approval  
* `validating -> scheduled` if auto-allowed  
* `awaiting-approval -> scheduled` only after approval  
* `scheduled -> executing` only if dependencies are satisfied  
* `executing -> verifying` for artifact/external tools  
* `verifying -> success` only when checks pass  
* any failure goes to terminal error state  
* downstream dependencies cannot unlock unless upstream terminal conditions are met

---

## **6.2 Tool call contract**

export interface ToolCallRecord {  
 id: string;  
 toolName: string;  
 input: Record\<string, unknown\>;  
 state: ToolCallState;  
 executionClass: "blocking" | "background" | "parallel-safe";  
 dependsOn: string\[\];  
 createdAt: string;  
 updatedAt: string;  
 roundId?: string;  
 sessionId?: string;  
 startedAt?: string;  
 endedAt?: string;  
 approval?: ApprovalResolution;  
 result?: ToolExecutionResult;  
 errorCode?: string;  
 blockedReason?: string;  
}  
---

## **6.3 Tool result contract**

export interface ToolExecutionResult {  
 status: "success" | "error" | "cancelled" | "timed-out";  
 summary: string;  
 evidence: {  
   filesRead: string\[\];  
   filesWritten: string\[\];  
   urlsFetched: string\[\];  
   commandsRun: string\[\];  
   artifacts: ArtifactRecord\[\];  
   durationMs: number;  
   exitCode?: number;  
 };  
 verification?: {  
   passed: boolean;  
   checks: VerificationCheck\[\];  
 };  
 retryable?: boolean;  
 blockedReason?: string;  
}  
---

## **6.4 Artifact contract**

export interface ArtifactRecord {  
 id: string;  
 kind: "download" | "archive" | "document" | "search-result" | "generated-file";  
 sourceUri?: string;  
 localPath?: string;  
 exists: boolean;  
 sizeBytes?: number;  
 mimeType?: string;  
 sha256?: string;  
 verified: boolean;  
}  
---

## **6.5 Verification checks**

export interface VerificationCheck {  
 name: string;  
 passed: boolean;  
 message: string;  
 code:  
   | "path-exists"  
   | "non-empty-file"  
   | "checksum-match"  
   | "http-ok"  
   | "expected-output-present"  
   | "archive-expanded"  
   | "command-exit-zero";  
}  
---

# **7\. New modules to add**

## **7.1 `packages/core/src/tool-runtime/tool-call-types.ts`**

Owns:

* `ToolCallState`  
* `ToolCallRecord`  
* `ApprovalResolution`  
* `ExecutionClass`

## **7.2 `packages/core/src/tool-runtime/tool-result-types.ts`**

Owns:

* `ToolExecutionResult`  
* `ArtifactRecord`  
* `VerificationCheck`

## **7.3 `packages/core/src/tool-runtime/dependency-graph.ts`**

Owns:

* dependency readiness  
* downstream blocking  
* cycle detection  
* dependency failure propagation

Exports:

* `areDependenciesSatisfied`  
* `getBlockedReason`  
* `markDependentsBlocked`  
* `detectDependencyCycle`

## **7.4 `packages/core/src/tool-runtime/approval-gateway.ts`**

Owns:

* tool policy lookup  
* path/domain/command approval resolution  
* session/project/global scopes  
* durable approval recording

Exports:

* `resolveApproval`  
* `recordApprovalDecision`  
* `isToolAutoAllowed`

## **7.5 `packages/core/src/tool-runtime/verification-rules.ts`**

Owns:

* file verification  
* command result verification  
* web fetch verification  
* archive verification

Exports:

* `verifyToolResult`  
* `verifyArtifactPath`  
* `verifyChecksum`  
* `verifyArchiveExpansion`

## **7.6 `packages/core/src/tool-runtime/artifact-store.ts`**

Owns:

* artifact registration  
* artifact lookup  
* artifact verification status  
* durable artifact persistence

Exports:

* `registerArtifacts`  
* `getArtifactById`  
* `getArtifactsForToolCall`

## **7.7 `packages/core/src/tool-runtime/tool-events.ts`**

Owns event kinds and event payloads.

Use dotted string unions:

export type ToolEventKind \=  
 | "tool.requested"  
 | "tool.validated"  
 | "tool.awaiting-approval"  
 | "tool.scheduled"  
 | "tool.started"  
 | "tool.progress"  
 | "tool.verifying"  
 | "tool.completed"  
 | "tool.failed"  
 | "tool.blocked"  
 | "artifact.available"  
 | "artifact.verified";

## **7.8 `packages/core/src/tool-runtime/tool-scheduler.ts`**

This is the heart.

Responsibilities:

* receive a batch of tool calls  
* validate all calls  
* resolve approvals  
* queue/schedule them  
* enforce dependency ordering  
* execute them  
* verify them  
* persist results  
* emit events  
* resume safely

Exports:

* `ToolScheduler`  
* `submitToolCalls`  
* `resumeToolCalls`  
* `cancelToolCall`

---

# **8\. New model runtime modules**

## **8.1 `packages/core/src/model-runtime/model-capabilities.ts`**

Define:

export interface ModelCapabilityRecord {  
 modelId: string;  
 provider: string;  
 baseUrl?: string;  
 local: boolean;  
 supportsToolCalls: boolean;  
 supportsStreaming: boolean;  
 supportsReasoning: boolean;  
 maxContext?: number;  
 timeoutMs: number;  
 retries: number;  
 safeExecutionProfile: "planner" | "executor" | "balanced";  
}

## **8.2 `packages/core/src/model-runtime/provider-registry.ts`**

Normalize local/cloud provider config.

Goal:

* Ollama  
* vLLM  
* LM Studio  
* custom OpenAI-compatible  
* OpenAI  
* Anthropic  
* Google  
* Groq

all through one provider registry.

---

# **9\. Existing files to refactor**

## **9.1 `packages/cli/src/agent-loop.ts`**

### **Current role**

Too much tool execution logic lives here.

### **New role**

Planner/orchestrator only.

### **Required changes**

* stop directly executing tool calls in the loop  
* extract tool calls  
* translate them into scheduler submission payloads  
* await structured scheduler results  
* append concise summaries to conversation state  
* stop storing tool truth as plain text blobs

### **Hard rule**

No direct call path like:

* execute tool  
* stringify result  
* continue blindly

The scheduler must own sequencing.

---

## **9.2 `packages/cli/src/tools.ts`**

### **Current role**

Contains real execution logic but returns mostly freeform content.

### **New role**

Tool implementations \+ adapter targets only.

### **Required changes**

* all tools return `ToolExecutionResult`  
* any human-readable output is derived from structured result  
* `WebFetch`, `WebSearch`, `SubAgent`, `Bash`, `Write`, `Edit` must declare execution class  
* add verification metadata where applicable

### **Special handling**

* `WebFetch` and `WebSearch` should be runtime-wrapped  
* `SubAgent` must never silently satisfy prerequisites when backgrounded  
* `Bash` must distinguish process completion from verified intent completion

---

## **9.3 `packages/core/src/durable-run-store.ts`**

### **Required changes**

Add persistence for:

* `toolCallId`  
* `toolName`  
* `state`  
* `dependsOn`  
* `approval`  
* `artifacts`  
* `verificationChecks`  
* `errorCode`  
* `resumePayload`

This file becomes the canonical persistence layer for tool runtime state.

---

## **9.4 `packages/core/src/workflow-runtime.ts`**

### **Required changes**

Upgrade workflow contract from prompt-only guidance to runtime metadata.

Add optional fields:

* `dependsOn`  
* `executionClass`  
* `verificationRequired`  
* `approvalPolicy`

---

## **9.5 `packages/core/src/background-agent.ts`**

### **Required changes**

Integrate with scheduler instead of bypassing it.

Rules:

* background tasks must be registered as tool calls  
* background tasks cannot unlock dependencies until complete and verified  
* detached work must explicitly mark itself as non-prerequisite

---

## **9.6 `packages/core/src/providers/index.ts`**

### **Required changes**

Delegate provider resolution to `provider-registry.ts`.

## **9.7 `packages/core/src/providers/ollama.ts`**

### **Required changes**

Keep implementation, but normalize registration through provider registry.

## **9.8 `packages/core/src/unified-llm-client.ts`**

### **Required changes**

Use capability registry for:

* timeout defaults  
* retry rules  
* execution profile  
* local/cloud classification

---

# **10\. New execution classes**

Each tool must declare one of:

export type ExecutionClass \=  
 | "blocking"  
 | "background"  
 | "parallel-safe";

## **Default mapping**

* `Read` → `blocking`  
* `Write` → `blocking`  
* `Edit` → `blocking`  
* `Bash` → `blocking`  
* `WebSearch` → `blocking`  
* `WebFetch` → `blocking`  
* `SubAgent` → `blocking` by default  
* `SubAgent` with explicit detached mode → `background`  
* future pure analysis-only tools → `parallel-safe`

---

# **11\. Approval model**

Use explicit policy resolution, not ad hoc checks.

## **Approval scopes**

* once  
* session  
* project  
* global

## **Policy surfaces**

* by tool name  
* by domain  
* by path  
* by shell command pattern

## **Canonical defaults**

* `Read` inside workspace → allow  
* `Read` outside workspace → ask  
* `Write` → ask  
* `Edit` → ask  
* `WebSearch` → ask  
* `WebFetch` → ask  
* `Bash` harmless read-only commands → allow  
* `Bash` network/file mutation/install commands → ask

## **Error codes**

Use kebab-case:

* `approval-required`  
* `approval-denied`  
* `dependency-not-satisfied`  
* `artifact-verification-failed`  
* `invalid-tool-input`  
* `tool-timeout`  
* `external-fetch-failed`

---

# **12\. Artifact-aware tools to add**

These should be first-class tools, not shell conventions.

## **12.1 `AcquireUrl`**

Input:

* `url`  
* `targetPath`  
* `expectedSha256?`  
* `expectedMimeType?`  
* `extract?`

Behavior:

* download  
* verify exists  
* verify non-empty  
* verify checksum if present  
* extract if requested  
* verify extracted content if applicable  
* emit artifact record

## **12.2 `AcquireArchive`**

Input:

* `archivePath`  
* `targetDir`  
* `expectedEntries?`

Behavior:

* unpack  
* verify target dir exists  
* verify expected entries if provided

## **12.3 `VerifyPath`**

Input:

* `path`  
* `mustExist`  
* `minBytes?`

## **12.4 `VerifyChecksum`**

Input:

* `path`  
* `sha256`

These tools reduce shell ambiguity.

---

# **13\. Scheduler behavior rules**

## **Batch scheduling rules**

1. validate all tool calls first  
2. resolve approval status  
3. mark ready calls as `scheduled`  
4. execute only calls with satisfied dependencies  
5. verify completion where required  
6. only then unlock downstream nodes

## **Parallelism rules**

* default execution is sequential  
* only `parallel-safe` tools may run in parallel  
* blocking tools keep order  
* background tools do not unlock downstream nodes until verified if they are dependencies

## **Resume rules**

On resume:

* `executing` becomes `verifying` or `error` depending on persisted execution evidence  
* `awaiting-approval` resumes as `awaiting-approval`  
* `scheduled` resumes as `scheduled`  
* dependency graph is rebuilt from persisted tool records

---

# **14\. Concrete implementation generations**

Below is the execution order Codex should follow.

---

## **Generation 1 — Runtime contracts spine**

### **Files**

* `packages/core/src/tool-runtime/tool-call-types.ts`  
* `packages/core/src/tool-runtime/tool-result-types.ts`  
* `packages/core/src/tool-runtime/tool-events.ts`  
* `packages/core/src/tool-runtime/tool-call-types.test.ts`

### **Deliverable**

Canonical runtime types only.

### **Acceptance**

* types compile  
* tests validate state unions and result contracts  
* no runtime behavior yet

---

## **Generation 2 — Dependency graph**

### **Files**

* `packages/core/src/tool-runtime/dependency-graph.ts`  
* `packages/core/src/tool-runtime/dependency-graph.test.ts`

### **Deliverable**

Dependency readiness \+ block propagation.

### **Acceptance**

* dependencies unlock only when upstream is terminal/success  
* failed upstream marks downstream blocked  
* cycle detection works

---

## **Generation 3 — Approval gateway**

### **Files**

* `packages/core/src/tool-runtime/approval-gateway.ts`  
* `packages/core/src/tool-runtime/approval-gateway.test.ts`

### **Deliverable**

Scoped policy resolution.

### **Acceptance**

* path/domain/tool policies resolve deterministically  
* approval-required path returns `awaiting-approval`  
* denied approval blocks execution

---

## **Generation 4 — Verification rules**

### **Files**

* `packages/core/src/tool-runtime/verification-rules.ts`  
* `packages/core/src/tool-runtime/verification-rules.test.ts`

### **Deliverable**

Artifact verification engine.

### **Acceptance**

* file exists checks  
* min-bytes checks  
* checksum checks  
* archive extraction checks  
* HTTP OK verification checks

---

## **Generation 5 — Artifact store**

### **Files**

* `packages/core/src/tool-runtime/artifact-store.ts`  
* `packages/core/src/tool-runtime/artifact-store.test.ts`

### **Deliverable**

Artifact registration \+ lookup.

### **Acceptance**

* artifacts can be registered from tool results  
* artifacts can be queried by toolCallId  
* verification status persists in memory/store abstraction

---

## **Generation 6 — Tool scheduler core**

### **Files**

* `packages/core/src/tool-runtime/tool-scheduler.ts`  
* `packages/core/src/tool-runtime/tool-scheduler.test.ts`  
* `packages/core/src/index.ts` update exports

### **Deliverable**

Minimal scheduler with:

* create  
* validate  
* schedule  
* execute  
* verify  
* persist hooks

### **Acceptance**

* state transitions are deterministic  
* dependent calls do not run early  
* approval state pauses correctly

---

## **Generation 7 — Durable run integration**

### **Files**

* `packages/core/src/durable-run-store.ts`  
* `packages/core/src/durable-run-store.test.ts`  
* `packages/core/src/tool-runtime/tool-scheduler.ts`

### **Deliverable**

Tool runtime state persistence.

### **Acceptance**

* tool call records persist  
* resume restores tool states  
* artifacts and verification checks survive restart

---

## **Generation 8 — Tool adapters**

### **Files**

* `packages/core/src/tool-runtime/tool-adapters.ts`  
* `packages/cli/src/tools.ts`  
* `packages/cli/src/tools.runtime-adapter.test.ts`

### **Deliverable**

Wrap existing CLI tools behind structured runtime adapters.

### **Acceptance**

* `WebSearch`, `WebFetch`, `Bash`, `Read`, `Write`, `Edit`, `SubAgent` emit `ToolExecutionResult`  
* old string-only paths are removed from runtime truth path

---

## **Generation 9 — Agent loop refactor**

### **Files**

* `packages/cli/src/agent-loop.ts`  
* `packages/cli/src/agent-loop.tool-runtime.test.ts`

### **Deliverable**

Agent loop submits tool calls to scheduler instead of executing directly.

### **Acceptance**

* no direct sequential tool truth path remains in loop  
* loop becomes planner/orchestrator  
* downstream step waits for verified result

---

## **Generation 10 — Background/subagent hardening**

### **Files**

* `packages/core/src/background-agent.ts`  
* `packages/cli/src/tools.ts`  
* `packages/core/src/tool-runtime/tool-scheduler.ts`

### **Deliverable**

Background work becomes explicit and safe.

### **Acceptance**

* background subagent never silently satisfies dependency  
* tracked background prerequisite blocks downstream until verified  
* detached background work is non-prerequisite only when declared

---

## **Generation 11 — Acquire tools**

### **Files**

* `packages/core/src/tool-runtime/acquire-tools.ts`  
* `packages/core/src/tool-runtime/acquire-tools.test.ts`  
* `packages/cli/src/tools.ts`

### **Deliverable**

First-class artifact acquisition tools.

### **Acceptance**

* `AcquireUrl`  
* `AcquireArchive`  
* `VerifyPath`  
* `VerifyChecksum`  
  all work end-to-end

---

## **Generation 12 — Workflow runtime uplift**

### **Files**

* `packages/core/src/workflow-runtime.ts`  
* `packages/core/src/workflow-runtime.test.ts`

### **Deliverable**

Workflow contracts carry runtime metadata.

### **Acceptance**

* workflow stages can define dependencies and execution class  
* runtime consumes those fields  
* “stop on blocked tool step” is enforced by code, not prompt only

---

## **Generation 13 — Model capability registry**

### **Files**

* `packages/core/src/model-runtime/model-capabilities.ts`  
* `packages/core/src/model-runtime/provider-registry.ts`  
* `packages/core/src/providers/index.ts`  
* `packages/core/src/unified-llm-client.ts`

### **Deliverable**

Unified local/cloud provider metadata.

### **Acceptance**

* Ollama still works  
* custom OpenAI-compatible local endpoint works  
* capability record drives timeout/retry/execution profile

---

## **Generation 14 — Final weld and e2e tests**

### **Files**

* `packages/cli/src/agent-loop.tool-runtime.test.ts`  
* `tests/integration/tool-runtime-download.test.ts`  
* `tests/integration/tool-runtime-approval.test.ts`  
* `tests/integration/tool-runtime-resume.test.ts`

### **Deliverable**

Battle-hardened runtime behavior.

### **Acceptance**

All golden flows pass.

---

# **15\. Golden flows**

These are mandatory.

## **GF-01 — Download then process**

Prompt intent:

1. download file  
2. inspect file  
3. edit code based on file

Pass condition:

* step 2 never runs before artifact verification  
* step 3 never runs before step 2 terminal success

## **GF-02 — Search then fetch then edit**

Prompt intent:

1. search docs  
2. fetch target page  
3. edit code

Pass condition:

* fetch must not begin if search blocked/denied  
* edit must not begin before fetch success

## **GF-03 — Background subagent as prerequisite**

Prompt intent:

1. subagent researches dependency  
2. main loop waits  
3. applies result

Pass condition:

* downstream blocked until background task terminal \+ verified

## **GF-04 — Resume during approval**

Prompt intent:

1. request tool needing approval  
2. process interrupted  
3. resume session

Pass condition:

* tool remains `awaiting-approval`  
* no downstream execution occurred

## **GF-05 — Resume during verification**

Prompt intent:

1. acquire archive  
2. process interrupted while verifying  
3. resume

Pass condition:

* verification resumes correctly  
* downstream remains blocked until verification terminal

---

# **16\. Required tests**

## **Unit tests**

* state transition validity  
* dependency blocking  
* cycle detection  
* approval resolution  
* file verification  
* checksum mismatch  
* archive expansion verification  
* timeout transition  
* cancel transition

## **Integration tests**

* `AcquireUrl -> VerifyPath -> Read`  
* `WebSearch -> WebFetch -> Edit`  
* `Bash(curl) -> VerifyPath -> Edit`  
* `SubAgent(background=true as dependency) -> Write`  
* resume from `awaiting-approval`  
* resume from `verifying`

## **Regression tests**

* existing simple one-step tools still function  
* Ollama local provider still works  
* sandbox Bash path still works

---

# **17\. CI gates**

Codex must not declare completion unless all gates pass.

## **Build gates**

* root build  
* package build for `@dantecode/core`  
* package build for `@dantecode/cli`

## **Type gates**

* `tsc --noEmit`

## **Lint gates**

* eslint passes

## **Test gates**

* all new unit tests pass  
* golden flow integration tests pass

## **Runtime gates**

* no direct `Tool "X" result:` string path remains as orchestration truth  
* scheduler owns tool sequencing  
* tool results are structured

## **Hygiene gates**

* no file over 500 LOC unless justified and documented  
* no duplicate runtime abstractions  
* no split-brain between CLI and core tool state models

---

# **18\. Evidence bundle required per generation**

Each generation must produce:

* changed file list  
* tests added/updated  
* acceptance criteria pass/fail  
* any deviations from packet  
* known risks  
* next generation recommendation

Final generation must also produce:

* `Docs/tool-runtime-gap-closure-report.md`  
* `Docs/tool-runtime-golden-flows.md`

---

# **19\. Backout plan**

If a generation destabilizes the CLI:

1. preserve existing tool implementations  
2. keep scheduler behind a feature flag during early generations  
3. switch CLI from legacy loop path to scheduler path only after:  
   * scheduler tests pass  
   * durable state tests pass  
   * adapter tests pass

Recommended temporary feature flag:

* `DANTE_TOOL_RUNTIME_V1=true`

Remove flag only after GF-01 through GF-05 pass.

---

# **20\. Exact acceptance definition of “done”**

This packet is complete only when all are true:

1. Dante does not move past a prerequisite download until the artifact is verified  
2. Dante does not move past approval-gated operations until approval is resolved  
3. Dante does not allow background work to silently satisfy prerequisites  
4. Dante persists and resumes tool-call state correctly  
5. Dante tool truth is structured, not prose-first  
6. Dante local model config is normalized through a capability/provider registry  
7. agent-loop no longer owns tool execution semantics directly

---

# **21\. Known risks**

## **Risk 1**

Scheduler added in core but CLI still bypasses it.

Mitigation:

* explicit agent-loop refactor generation  
* grep gate for direct execution path

## **Risk 2**

Background-agent remains a side channel.

Mitigation:

* all background tasks must register as tool runtime records

## **Risk 3**

Verification becomes inconsistent across tools.

Mitigation:

* central `verification-rules.ts`  
* no tool-specific hidden verification logic unless delegated to central checks

## **Risk 4**

Provider registry duplicates runtime-catalog logic.

Mitigation:

* registry owns capability/provider execution details  
* catalog remains descriptive, not runtime-truth

---

# **22\. Recommended file export additions**

Update `packages/core/src/index.ts` to export:

* `ToolScheduler`  
* `resolveApproval`  
* `verifyToolResult`  
* `registerArtifacts`  
* `getArtifactById`  
* `ModelCapabilityRecord`  
* `ProviderRegistry`

Do not hide the runtime spine.

---

# **23\. Codex handoff prompt**

Use this exact prompt with Codex.

You are implementing DTR-01 for DanteCode.

Objective:  
Refactor DanteCode from a loop-first tool execution model to a scheduler-first deterministic tool runtime with explicit tool states, dependency gating, approval gating, artifact verification, and resume-safe persistence.

Hard rules:  
\- No stubs  
\- No TODO placeholders  
\- 1–4 files per generation  
\- Prefer files under 500 LOC  
\- Include tests in every generation  
\- Keep CI green  
\- Use kebab-case filenames  
\- Prefer named exports  
\- Use camelCase JSON keys  
\- Use kebab-case error codes  
\- Fail closed on ambiguous runtime states

Required new modules:  
\- packages/core/src/tool-runtime/tool-call-types.ts  
\- packages/core/src/tool-runtime/tool-result-types.ts  
\- packages/core/src/tool-runtime/tool-scheduler.ts  
\- packages/core/src/tool-runtime/approval-gateway.ts  
\- packages/core/src/tool-runtime/artifact-store.ts  
\- packages/core/src/tool-runtime/dependency-graph.ts  
\- packages/core/src/tool-runtime/tool-events.ts  
\- packages/core/src/tool-runtime/verification-rules.ts  
\- packages/core/src/model-runtime/model-capabilities.ts  
\- packages/core/src/model-runtime/provider-registry.ts

Required refactors:  
\- packages/cli/src/agent-loop.ts  
\- packages/cli/src/tools.ts  
\- packages/core/src/durable-run-store.ts  
\- packages/core/src/workflow-runtime.ts  
\- packages/core/src/background-agent.ts  
\- packages/core/src/providers/index.ts  
\- packages/core/src/providers/ollama.ts  
\- packages/core/src/unified-llm-client.ts

Architectural requirements:  
\- Every tool call must have state:  
 created, validating, awaiting-approval, scheduled, executing, verifying, success, error, cancelled, timed-out, blocked-by-dependency  
\- Runtime, not planner, owns dependency readiness  
\- Tool results must be structured, not text-only  
\- Downloads/artifacts must be verified before downstream steps unlock  
\- Background work must never silently satisfy dependencies  
\- Agent loop must submit tool calls to scheduler, not execute them directly

Golden flows that must pass:  
\- Download \-\> verify \-\> read  
\- Search \-\> fetch \-\> edit  
\- Background subagent as prerequisite  
\- Resume during awaiting-approval  
\- Resume during verifying

Implementation order:  
Follow Generations 1 through 14 from the V+E Execution Packet exactly.  
At the end of each generation, report:  
\- files changed  
\- tests added  
\- acceptance result  
\- risks  
\- next generation

Do not skip generations.  
Do not claim completion without passing tests.  
---

# **24\. Brutally honest close**

This is the missing weld.

DanteCode already has many sharp parts. The problem is not lack of features. The problem is that the tool/runtime contract is still too soft. Until this packet is implemented, Dante will remain vulnerable to:

* moving forward too early  
* trusting text over execution truth  
* confusing background progress with prerequisite completion  
* treating process completion as real completion

This packet closes that gap directly.

Next best move is to use this packet in strict generations and force Codex to report per-gen evidence instead of trying to do the whole thing in one leap.

