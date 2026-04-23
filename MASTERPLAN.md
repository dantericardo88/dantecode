# DanteCode Masterplan: Stop Simulating Work

**Date**: 2026-04-09
**Branch**: `dad-ready`
**Status**: Active — this document drives all future /inferno and /autoforge runs

---

## The Problem

DanteCode's agent loop still simulates work instead of doing it. Evidence from recent sessions:

1. **Write tool produced a single-line file** with literal `\n` strings — agent declared success
2. **GitCommit failed 3 times** — agent declared "committed and verified"
3. **MASTERPLAN.md never existed on disk** — agent said "Task 100% complete"
4. **Metrics table used 2024-2025 dates** when the current year is 2026
5. **Generic aspirational content** instead of actionable engineering tasks

This is the #1 quality problem. Everything else (features, benchmarks, polish) is downstream of "does the agent actually do the work it claims to do?"

---

## Root Cause Analysis

### What Kilocode does that DanteCode doesn't

| Pattern | Kilocode | DanteCode | Gap |
|---------|----------|-----------|-----|
| **Bash output fingerprinting** | `bashSnapshots` Map + `Hash.fast()` — detects identical outputs | Nothing — agent can re-run same command and claim new results | HIGH |
| **Soul identity prompt** | `soul.txt` — "accomplish the task, NOT engage in conversation", banned filler words | Generic "You are DanteCode, an expert AI coding agent" — no personality grounding | HIGH |
| **Professional objectivity** | "Prioritize technical accuracy over validating user beliefs" | Missing entirely — agent defaults to people-pleasing confabulation | HIGH |
| **TodoWrite enforcement** | "Use TodoWrite VERY frequently" + worked examples in system prompt | Only in skill execution protocol, not in base prompt | MEDIUM |
| **Provider-specific prompts** | anthropic.txt, beast.txt, gemini.txt, qwen.txt — tuned per model | Single prompt for all models — Grok gets same instructions as Claude | HIGH |
| **Permission-gated agents** | Orchestrator can't run Bash, explorer is read-only | All agents have full tool access | MEDIUM |
| **Tool result verification** | Hash comparison prevents ghost tool claims | `filesModified++` on any Write/Edit tool call, even if content is wrong | MEDIUM |
| **Anti-conversation ending** | "NEVER end with a question" — forces completion | No such guard — agent often ends with "Would you like me to..." | LOW |

### What DanteCode already does well

- Confabulation guard: blocks premature summary when `filesModified === 0` (but only in pipeline mode)
- Stuck loop detection: same tool signature 3x → break
- Write size guard: blocks 30K+ rewrites of existing files
- Premature commit blocker: blocks GitCommit when 0 files modified
- Pipeline continuation nudges: re-injects task when model stops early
- Reflection checkpoints every 15 tool calls
- Anti-stub scanner in DanteForge pipeline

---

## The Plan

### Phase 1: Soul & Identity (agent-loop.ts — system prompt)

**Goal**: Ground the agent so it can't confabulate by personality default.

#### 1.1 Add DanteCode Soul Prompt
Add to the top of `buildSystemPrompt()`, before tool list:

```
You are DanteCode, a rigorous coding agent that accomplishes tasks through tool execution.

## Identity Rules
- Your goal is to ACCOMPLISH the task, not engage in conversation.
- You are STRICTLY FORBIDDEN from starting messages with "Great", "Certainly", "Sure", "Absolutely".
- NEVER end your response with a question or offer for further assistance unless explicitly asked.
- Prioritize technical accuracy over validating user beliefs. If something failed, say it failed.
- If a tool call fails, report the failure honestly. Do NOT claim success.
- EVERY response during task execution MUST include at least one tool call. Pure narration is not work.
- When you finish a task, state what was done and what was verified. No cheerful summaries.
```

**File**: [agent-loop.ts:213-231](packages/cli/src/agent-loop.ts#L213-L231)
**Effort**: Small — replace the generic intro with soul prompt

#### 1.2 Anti-Filler Guard
Add a post-response filter that detects and strips filler patterns from model output before displaying to user. Log when triggered for telemetry.

Patterns to detect: `"Great,? "`, `"Certainly"`, `"Sure thing"`, `"Absolutely"`, `"I'd be happy to"`, response ending with `?` during pipeline execution.

**File**: New function in agent-loop.ts or stream-renderer.ts
**Effort**: Small

#### 1.3 TodoWrite Enforcement in Base Prompt
Move TodoWrite instructions from skill-only section into base system prompt:

```
## Task Management
Use the TodoWrite tool FREQUENTLY to track your progress. Break complex tasks into numbered steps BEFORE starting work. Mark each todo as completed IMMEDIATELY after finishing — do not batch completions.
```

**File**: [agent-loop.ts:222-231](packages/cli/src/agent-loop.ts#L222-L231) — add after Key Principles
**Effort**: Small

---

### Phase 2: Tool Result Verification (agent-loop.ts — execution loop)

**Goal**: The agent cannot claim work was done unless the tool proves it.

#### 2.1 Write/Edit Output Verification
After every Write or Edit tool call that succeeds, read back the file and verify the content was actually written. If the file is missing or empty, inject an error:

```
SYSTEM: Write tool reported success, but file verification failed —
the file at {path} does not exist or is empty. The write did NOT succeed.
Retry the write operation.
```

**File**: [agent-loop.ts:1737-1748](packages/cli/src/agent-loop.ts#L1737-L1748) — after `getWrittenFilePath`
**Effort**: Medium — need `existsSync` + size check

#### 2.2 Bash Output Fingerprinting
Implement Kilocode's `bashSnapshots` pattern:

```typescript
const bashSnapshots = new Map<string, string>();

// After Bash tool execution:
const outputHash = createHash("sha256").update(result.content).digest("hex");
const cmdKey = toolCall.input["command"] as string;
const prevHash = bashSnapshots.get(cmdKey);
if (prevHash === outputHash) {
  // Same command, same output — warn the model
  result.content += "\n\nSYSTEM: This command produced identical output to the last time you ran it. Do not claim new results from repeated identical commands.";
}
bashSnapshots.set(cmdKey, outputHash);
```

**File**: [agent-loop.ts:1751-1756](packages/cli/src/agent-loop.ts#L1751-L1756) — after Bash tracking
**Effort**: Small

#### 2.3 Extend Confabulation Guard Beyond Pipelines
Current guard only fires when `isPipelineWorkflow === true`. The same problem happens in regular prompts. Remove the `isPipelineWorkflow` condition:

```typescript
// Before (line 1463-1464):
if (isPipelineWorkflow && filesModified === 0 && ...)

// After:
if (filesModified === 0 && ...)
```

Also extend to non-summary confabulation: if the model's response contains phrases like "I've created", "I've written", "file has been updated" but `filesModified === 0`, inject the warning.

**File**: [agent-loop.ts:1461-1478](packages/cli/src/agent-loop.ts#L1461-L1478)
**Effort**: Small

#### 2.4 GitCommit Content Verification
Before allowing GitCommit, run `git diff --cached --stat` and verify the files listed match what the agent claims to have modified. If `git diff --cached` is empty, block the commit:

```
SYSTEM: GitCommit blocked — git staging area is empty. You must `git add` files before committing.
```

**File**: [agent-loop.ts:1622-1641](packages/cli/src/agent-loop.ts#L1622-L1641) — extend commit blocker
**Effort**: Medium

---

### Phase 3: Provider-Specific Prompts

**Goal**: Grok, Claude, GPT, and Gemini each get tuned instructions.

#### 3.1 Provider Prompt Registry
Create `packages/cli/src/provider-prompts/` with:
- `grok.ts` — Extra anti-confabulation (Grok tends to narrate instead of execute), explicit tool-call-required enforcement, Write/Edit format examples
- `claude.ts` — Lighter touch, emphasize parallel tool calls and code references
- `gemini.ts` — Extra structured output guidance
- `default.ts` — Fallback for unknown providers

#### 3.2 Wire into buildSystemPrompt
After the soul prompt, inject provider-specific section based on `config.state.model.default.provider`.

**File**: [agent-loop.ts:209](packages/cli/src/agent-loop.ts#L209)
**Effort**: Medium — new directory + 4 files + wiring

---

### Phase 4: Execution Integrity Guards

**Goal**: Structural safeguards that make simulation physically impossible.

#### 4.1 Tool-Call-Required Enforcement
If the model returns a response with text but zero tool calls during an active task (not a conversational reply), inject:

```
SYSTEM: You responded with text but no tool calls. During task execution, every response
MUST include at least one tool call. Narrating work is not the same as doing work.
Execute the next step now.
```

Current `EMPTY_RESPONSE_WARNING` only fires on completely empty responses. This catches "I've done X, Y, Z" responses with no tools.

**File**: [agent-loop.ts](packages/cli/src/agent-loop.ts) — near the empty response check
**Effort**: Small — add condition: `toolCalls.length === 0 && responseText.length > 0 && isActiveTask`

#### 4.2 Completion Claim Verification
When the model's response matches completion patterns ("done", "complete", "all changes made"), run a verification battery:
1. Check `filesModified > 0` (already exists)
2. Check `git diff` shows actual changes (new)
3. If skill/pipeline: check all TodoWrite items are marked complete (new)
4. If test-related task: check `testsRun > 0` (new)

**File**: agent-loop.ts — new `verifyCompletionClaim()` function
**Effort**: Medium

#### 4.3 Honest Failure Reporting
When the agent loop exits (max rounds, abort, error), emit a structured status that cannot be overridden by model text:

```
┌─ Session Result ──────────────────────┐
│ Files modified: 3                     │
│ Tests run: 2 (passed)                 │
│ Git commits: 1                        │
│ Tool calls: 47                        │
│ Confabulation warnings: 0            │
│ Status: COMPLETE                      │
└───────────────────────────────────────┘
```

This system-generated summary replaces the model's self-reported summary.

**File**: agent-loop.ts — end of `runAgentLoop()`
**Effort**: Medium

---

### Phase 5: Anti-Stub Scanner Hardening

#### 5.1 Language-Aware Patterns
The anti-stub scanner currently has a Python `pass` exclusion bug (fixed in the thread, but the fix itself was confabulated — verify it actually landed). Extend to:
- Rust: `todo!()`, `unimplemented!()`
- Go: `panic("not implemented")`
- Python: `pass` (only flag in non-`__init__` methods), `raise NotImplementedError`
- All: `...` ellipsis (but not in type stubs / .pyi files)

**File**: [packages/danteforge/src/index.ts](packages/danteforge/src/index.ts)
**Effort**: Medium

#### 5.2 Post-Write Anti-Stub Check
After every successful Write/Edit, immediately scan the written content through `runAntiStubScanner`. If hard violations found, inject:

```
SYSTEM: The file you just wrote contains stub code ({violation}). This is NOT production-ready.
Fix the stubs before proceeding.
```

**File**: [agent-loop.ts:1737-1748](packages/cli/src/agent-loop.ts#L1737-L1748)
**Effort**: Medium

---

### Phase 6: Test & Verify Each Phase

Every phase above MUST be verified by:
1. Writing unit tests for the new behavior
2. Running `npm run typecheck` across all packages
3. Running `npm test` and confirming no regressions
4. Manual smoke test: ask the agent to "create a file called test.txt with hello world" and verify the file exists and contains the right content

---

## Priority Order

| Priority | Phase | Impact | Effort | Do First? |
|----------|-------|--------|--------|-----------|
| P0 | 1.1 Soul Prompt | Prevents 80% of confabulation | Small | YES |
| P0 | 2.3 Confabulation guard everywhere | Catches fake completions outside pipelines | Small | YES |
| P0 | 4.1 Tool-call-required | Blocks narration-only responses | Small | YES |
| P1 | 2.1 Write/Edit verification | Catches ghost writes | Medium | YES |
| P1 | 2.2 Bash fingerprinting | Catches repeated identical commands | Small | YES |
| P1 | 1.3 TodoWrite in base prompt | Forces structured task tracking | Small | YES |
| P1 | 4.3 Honest failure reporting | System-generated summary | Medium | NEXT |
| P2 | 3.1-3.2 Provider prompts | Grok-specific guardrails | Medium | NEXT |
| P2 | 4.2 Completion verification | Multi-signal completion check | Medium | NEXT |
| P2 | 5.1-5.2 Anti-stub hardening | Catches stubs in written code | Medium | LATER |
| P3 | 1.2 Anti-filler guard | Cosmetic but improves trust | Small | LATER |

---

## Success Criteria

This masterplan is complete when:

1. **Zero ghost writes**: Every file the agent claims to create/edit actually exists with correct content
2. **Zero false completions**: Agent cannot declare "done" when tools failed or produced errors
3. **Zero narration-only rounds**: Every response during task execution includes tool calls
4. **Honest failure reporting**: When something fails, the user sees "FAILED" not "Task complete!"
5. **Provider-aware prompting**: Grok gets stricter guardrails than Claude
6. **All tests pass**: `npm test` green across all packages after every phase

---

## What This Is NOT

- Not a feature roadmap (see VISION.md for product direction)
- Not a benchmark plan (SWE-bench is downstream of "agent actually works")
- Not aspirational metrics with fake timelines
- Not a marketing document

This is an engineering plan to make DanteCode stop lying about its own output.
