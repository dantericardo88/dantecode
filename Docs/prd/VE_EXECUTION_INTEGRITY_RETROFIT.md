# V+E Execution Packet: DanteCode Execution Integrity Retrofit

## Classification

| Field | Value |
|-------|-------|
| **Packet ID** | VE-EIR-001 |
| **Priority** | P0 — Constitutional |
| **Type** | Retrofit + Gap Closure |
| **Affected packages** | `@dantecode/core`, `@dantecode/cli`, `@dantecode/evidence-chain`, `@dantecode/runtime-spine` |
| **Branch** | `feat/execution-integrity-retrofit` |
| **Estimated scope** | 9 machines, ~1800 LOC production + ~1200 LOC tests |

---

## 1. Executive Problem Statement

DanteCode already has substantial execution integrity infrastructure:
- `ExecutionIntegrityManager` with ledger and completion gate
- Read-before-write enforcement via `canWriteFile()`
- `MutationRecord` and `ValidationRecord` tracking
- `evidence-chain` package with SHA-256 hash chains, Merkle trees, receipt chains
- Mode-based tool exclusions in `approval-modes.ts`
- `ExecutionTruthPayload` persistence to `.dantecode/execution-integrity/`

**The problem is not missing architecture. The problem is 9 specific holes that allow the agent to bypass or degrade the existing integrity layer.**

This V+E packet closes every hole with surgical precision.

---

## 2. Gap Registry

Each gap has been verified against the actual codebase with file:line references.

| # | Gap | Severity | Root Location |
|---|-----|----------|---------------|
| G1 | Edit `beforeHash` silently becomes `""` on debug-trail import failure | Medium | `tools.ts:634`, `execution-integrity.ts:263` |
| G2 | Bash tool emits `observableMutation: false` unconditionally — file writes invisible | **Critical** | `tools.ts:800` |
| G3a | `inferenceScalingDone` break skips completion gate | High | `agent-loop.ts:1225` |
| G3b | Confabulation circuit-breaker break skips gate | Medium | `agent-loop.ts:2149` |
| G3c | `config.silent` (serve/SDK mode) disables gate entirely | **Critical** | `agent-loop.ts:2472` |
| G3d | `config.taskMode` set → gate skipped | High | `agent-loop.ts:2471` |
| G3e | `execResult.action === "return"` hard-returns before gate | High | `agent-loop.ts:2876-2879` |
| G4 | Grok provider: no tool-call repair, JSDoc/code mismatch, zero normalization | Medium | `grok.ts:13,34` |
| G5 | `canWriteFile()` stores mtime only; `hash` field is always `""` | Medium | `execution-integrity.ts:124,341-350` |
| G6 | Persisted truth payload omits `toolCalls`, `validations`, prompt, response | High | `execution-truth.ts:18-46` |
| G7 | SubAgent evidence never merged to parent ledger | High | `tools.ts:1579-1638` |
| G8 | TodoWrite marks tasks "done" with zero evidence check | Medium | `tools.ts:1326-1355` |
| G9 | No tests for G2, G3c, G5-hash, G6, G7, G8, or Grok streaming | High | all test files |

---

## 3. Verification Contract (V)

These are binary pass/fail requirements. Every one must be provably true at ship time.

### V1 — No Narrative-Only Completion (closes G3a-G3e)

**Rule**: Every exit path from the agent loop's main `while` block that represents task success MUST pass through the completion gate or an equivalent evidence check.

**Concrete requirement**: Audit every `break` and `return` inside `agent-loop.ts`'s main loop. For each one that currently bypasses `runCompletionGate()`:
- Either route it through the gate, OR
- Prove it cannot represent a "task completed successfully" outcome and document why.

**Specific fixes required**:
- G3a (`inferenceScalingDone`): route through gate before break
- G3b (confab circuit-breaker): route through gate before break; if gate fails, the confab counter should still increment but the break should not fire
- G3c (`config.silent`): **remove the silent exemption**. Serve/SDK mode is a production path — it needs the gate most. If gate failure blocks the response, emit a structured error in the serve response instead of suppressing the check.
- G3d (`config.taskMode`): only skip gate for truly read-only modes (`observe-only`, `diagnose-only`). Other task modes must still pass the gate.
- G3e (`execResult.action === "return"`): if the return is due to approval-required or hard-stop, tag the session as `interrupted`, not `completed`. If it's a normal completion, gate it.

**Acceptance test**: No code path from `while (maxToolRounds > 0)` to session end can produce `completionStatus: "success"` without a gate evaluation.

### V2 — Bash Mutation Visibility (closes G2)

**Rule**: When a Bash command modifies files that the system can observe, those mutations must be recorded.

**Concrete requirement**: After every Bash tool execution:
1. Capture `git diff --name-only` (or equivalent filesystem scan) to detect changed files
2. For each changed file, compute `afterHash` (and `beforeHash` if previously read)
3. Emit `MutationRecord` entries for each changed file
4. Set `observableMutation: true` when changes are detected

**Boundary**: This does NOT require tracking every possible bash side-effect (network calls, process spawning, etc.). It tracks observable file mutations in the project tree.

**Acceptance test**: `bash("echo hello > newfile.txt")` produces a `MutationRecord` with `filePath: "newfile.txt"` and valid hashes.

### V3 — Edit Before-Hash Reliability (closes G1)

**Rule**: If `beforeHash` cannot be captured, the mutation record must flag it, not silently store `""`.

**Concrete requirement**: In `tools.ts`, when the debug-trail snapshot fails:
1. Fall back to direct `readFile` + `sha256` for `beforeHash`
2. If that also fails, set `beforeHash: null` (not `""`) and add `beforeHashUnavailable: true` to metadata
3. In `execution-integrity.ts`, treat `beforeHash: null` records as degraded evidence (log warning, still record mutation)

**Acceptance test**: Mutation record with import failure has `beforeHashUnavailable: true`, not a silent empty string.

### V4 — Content-Hash Stale Protection (closes G5)

**Rule**: `canWriteFile()` must detect content changes even when mtime is unchanged.

**Concrete requirement**: In `execution-integrity.ts`:
1. `updateFileReadState()` must compute and store `contentHash = sha256(fileContent)` at read time
2. `canWriteFile()` must re-read the file and compare content hash, not just mtime
3. If `currentHash !== storedHash`, reject write with `STALE_READ` reason

**Performance guard**: Only hash files < 1MB. For larger files, fall back to mtime-only (document this explicitly).

**Acceptance test**: File modified externally with identical mtime → write rejected.

### V5 — SubAgent Evidence Propagation (closes G7)

**Rule**: When a SubAgent completes, its mutation/validation evidence must merge into the parent session's ledger.

**Concrete requirement**:
1. Extend `SubAgentResult` interface with `evidence?: { mutations: MutationRecord[]; validations: ValidationRecord[]; gateResult?: CompletionGateResult }`
2. In the SubAgent executor, run the child's completion gate and capture its result
3. In `toolSubAgent` (tools.ts), merge child evidence into parent's `executionIntegrity.recordSubAgentEvidence(childResult.evidence)`
4. Add `ExecutionIntegrityManager.recordSubAgentEvidence()` method that appends child records with a `source: "subagent:{childSessionId}"` tag

**Acceptance test**: Parent ledger contains mutation records from child agent's file edits.

### V6 — TodoWrite Evidence Coupling (closes G8)

**Rule**: Tasks can only be marked `completed` if the completion gate has passed for the current session, OR if the task is explicitly non-mutating.

**Concrete requirement**:
1. Pass `context` (or at minimum `executionIntegrity` reference) to `toolTodoWrite`
2. When a todo's status transitions to `completed`:
   - If the todo's description implies code changes, check that at least one `MutationRecord` exists in the current session
   - If no mutations exist, downgrade status to `in_progress` and return a warning message
3. Allow `completed` without mutations for research/documentation/review-type todos (classify by keyword or explicit `type` field)

**Acceptance test**: `TodoWrite({status: "completed", content: "implement feature X"})` with zero mutations → status stays `in_progress`.

### V7 — Provider Normalization (closes G4)

**Rule**: xAI/Grok tool calls must be normalized and repaired before reaching the orchestration layer.

**Concrete requirement**:
1. Fix JSDoc to match actual code (`compatible`, not `strict`)
2. Add `GrokToolCallNormalizer` (or inline in the provider):
   - Parse and repair malformed JSON in tool-call arguments
   - Handle xAI's known quirk of emitting partial JSON across streaming chunks
   - Reject irrecoverably malformed tool calls with `TOOL_CALL_PARSE_FAILURE` instead of silently degrading
3. Add Grok-specific model capability flags (supports streaming: yes, supports parallel tool calls: check, supports structured output: check)
4. Test with representative Grok streaming payloads

**Acceptance test**: Malformed Grok tool-call JSON is either repaired or rejected — never silently treated as text.

### V8 — Complete Evidence Persistence (closes G6)

**Rule**: The persisted execution truth must be sufficient to reconstruct what the agent did, claimed, and proved.

**Concrete requirement**: Extend `persistExecutionEvidenceBundle` to write:
- `summary.json` — existing fields + `roundCount`, `totalToolCalls`, `requestType`, `prompt` (truncated to first 500 chars)
- `mutations.json` — existing (already adequate)
- `validations.json` — **new**: the `ValidationRecord[]` from the ledger
- `tool-calls.json` — **new**: the `ToolExecutionRecord[]` from the ledger (tool name, args summary, success/fail, timestamp)
- `gate-results.json` — existing fields + full `CompletionGateResult` with `missingEvidence[]`
- `read-files.json` — **new**: list of files read during session with timestamps

**Acceptance test**: After a session, `.dantecode/execution-integrity/` contains all 6 files and a human can determine exactly which tools ran, what changed, and why the gate passed or failed.

---

## 4. Evidence Contract (E)

### E1 — Artifact Bundle Schema

Every session must produce artifacts at `.dantecode/execution-integrity/{sessionId}/`:

```
summary.json          — session metadata + gate status
mutations.json        — MutationRecord[] with before/after hashes
validations.json      — ValidationRecord[] with tool + result
tool-calls.json       — ToolExecutionRecord[] (name, args summary, success, timestamp)
gate-results.json     — CompletionGateResult with fail codes and missing evidence
read-files.json       — files read during session with timestamps + content hashes
```

### E2 — Evidence Chain Integration

The existing `SessionEvidenceTracker` in `evidence-chain-bridge.ts` must record:
- Every gate evaluation (pass or fail) as a receipt
- Every bash-detected mutation as a receipt
- Every subagent evidence merge as a receipt

### E3 — Truth Surface

CLI must display after every mutating turn:
- Files changed (from mutation records, not from assistant text)
- Tool used per file
- Additions/deletions count
- Gate status (pass / fail + reason code)
- Provider/model

This rendering must derive from `ExecutionLedger`, not from chat output.

---

## 5. Machine Specifications

### Machine 1: Completion Gate Universalization

**Closes**: G3a, G3b, G3c, G3d, G3e

**Target files**:
- `packages/cli/src/agent-loop.ts` — lines 1225, 2149, 2471-2472, 2876-2879

**Changes**:
1. Extract a `runUniversalCompletionGate()` function that wraps `executionIntegrity.runCompletionGate()` and `completionGate.evaluate()` into one call
2. Before every `break` that exits the main while loop, call `runUniversalCompletionGate()`:
   - Line 1225 (`inferenceScalingDone`): add gate call
   - Line 2149 (confab breaker): add gate call; on fail, mark session as `interrupted`
   - Line 2472 (`config.silent`): **remove exemption**; on gate fail in silent mode, set `session.completionStatus = "gate_failed"` and include gate result in the structured response
   - Line 2471 (`config.taskMode`): only exempt `observe-only` and `diagnose-only`
   - Line 2879 (`execResult.action === "return"`): classify as `interrupted` if approval-required, gate if normal
3. Add `session.completionStatus` field: `"success" | "gate_failed" | "interrupted" | "error"`

**Tests** (add to `execution-integrity-e2e.test.ts`):
- Silent mode mutation request without tool calls → `gate_failed`
- Inference scaling done with narrative only → `gate_failed`
- Confab breaker fires on explanation-only → `success` (no mutation needed)
- Confab breaker fires on code-change request → `interrupted`
- `execResult.action === "return"` → `interrupted`, not `success`

**Acceptance**: `grep -rn 'break' agent-loop.ts` inside the main while loop — every break either passes through the gate or is provably non-completion.

---

### Machine 2: Bash Mutation Detection

**Closes**: G2

**Target files**:
- `packages/cli/src/tools.ts` — around line 800 (`toolBash`)
- `packages/core/src/execution-integrity.ts` — `recordToolCall()` mutation path

**New file**:
- `packages/cli/src/bash-mutation-detector.ts`

**Changes**:
1. Create `BashMutationDetector`:
   ```typescript
   interface BashMutationDetectorOptions {
     projectRoot: string;
     executionIntegrity: ExecutionIntegrityManager;
   }
   
   class BashMutationDetector {
     // Snapshot changed files before bash execution
     async snapshotBefore(): Promise<FileSnapshot[]>
     
     // Detect changes after bash execution
     async detectMutations(before: FileSnapshot[]): Promise<DetectedMutation[]>
     
     // Record detected mutations to the ledger
     async recordDetected(mutations: DetectedMutation[]): Promise<void>
   }
   ```
2. Detection strategy: use `git status --porcelain` + `git diff --name-only` to detect changed files in the project tree. For files outside git, fall back to mtime comparison of known project files.
3. For each detected changed file: compute `afterHash`, look up `beforeHash` from read tracker or pre-bash snapshot, emit `MutationRecord` with `source: "bash"`.
4. Wire into `toolBash`: call `snapshotBefore()` before exec, `detectMutations()` + `recordDetected()` after exec.
5. Set `observableMutation: mutations.length > 0` on the tool result.

**Tests** (new file `packages/cli/src/bash-mutation-detector.test.ts`):
- Bash creates new file → mutation detected with hash
- Bash modifies existing file → mutation detected with before/after hash
- Bash command that changes nothing → no mutation, `observableMutation: false`
- Bash deletes file → mutation detected with `afterHash: null`
- Bash outside project root → no mutation detected (scoped to project)

**Acceptance**: `echo "x" > test.txt` via Bash tool → `MutationRecord` in ledger with valid hashes.

---

### Machine 3: Edit Before-Hash Hardening

**Closes**: G1

**Target files**:
- `packages/cli/src/tools.ts` — line 634 (catch block in `toolEdit`)
- `packages/core/src/execution-integrity.ts` — line 263 (empty string fallback)

**Changes**:
1. In `toolEdit` catch block (line 634): fall back to `await readFile(filePath)` → `sha256(content)` for beforeHash
2. If fallback also fails: set `beforeHash: null` (not `""`)
3. Add `beforeHashUnavailable?: boolean` to `MutationRecord` interface
4. In `execution-integrity.ts` line 263: when `metadata.beforeHash` is null/undefined, store `beforeHash: null` and set `beforeHashUnavailable: true`
5. Log a degraded-evidence warning when this happens

**Tests** (add to existing `tools.test.ts` or `execution-integrity.test.ts`):
- Debug-trail import fails → `beforeHash` is still populated from fallback read
- Both paths fail → `beforeHash: null`, `beforeHashUnavailable: true`
- Normal path → `beforeHash` is a valid 64-char hex string

---

### Machine 4: Content-Hash Stale Protection

**Closes**: G5

**Target files**:
- `packages/core/src/execution-integrity.ts` — lines 124, 341-350, 355-371

**Changes**:
1. In `updateFileReadState()`: read file content and compute `contentHash = sha256(content)` for files < 1MB. For files >= 1MB, set `contentHash: "mtime_only"`.
2. In `canWriteFile()`: re-read the file, compute current content hash, compare against stored `contentHash`. If different, return `{ allowed: false, reason: "STALE_READ" }`.
3. Keep mtime check as a fast-path optimization (skip hash comparison if mtime matches).
4. Update `FileState` interface: rename `hash` to `contentHash`, make it `string | "mtime_only"`.

**Tests** (add to `execution-integrity.test.ts`):
- File modified externally with same mtime (simulate by writing same-length content) → write rejected
- File unmodified → write allowed
- File > 1MB → mtime-only fallback, content hash not computed
- File modified with different mtime → write rejected (existing test, verify still passes)

---

### Machine 5: SubAgent Evidence Propagation

**Closes**: G7

**Target files**:
- `packages/cli/src/tools.ts` — lines 79-101 (`SubAgentResult`), 1579-1638 (`toolSubAgent`)
- `packages/core/src/execution-integrity.ts` — add `recordSubAgentEvidence()`
- `packages/cli/src/sub-agent-executor.ts` (or wherever the executor lives)

**Changes**:
1. Extend `SubAgentResult`:
   ```typescript
   interface SubAgentResult {
     // ... existing fields
     evidence?: {
       mutations: MutationRecord[];
       validations: ValidationRecord[];
       gateResult?: CompletionGateResult;
       toolCalls: ToolExecutionRecord[];
     };
   }
   ```
2. In the sub-agent executor: after the child agent loop completes, extract the child's execution ledger and attach it to the result.
3. Add `ExecutionIntegrityManager.recordSubAgentEvidence(childSessionId: string, evidence: SubAgentEvidence)`:
   - Append child mutations to parent ledger with `source: "subagent:{childSessionId}"` tag
   - Append child validations similarly
   - If child gate failed, propagate that as a warning on the parent ledger
4. In `toolSubAgent`: after receiving result, call `executionIntegrity.recordSubAgentEvidence()`.
5. The parent's completion gate must consider child evidence when evaluating.

**Tests**:
- SubAgent edits file → parent ledger contains the mutation
- SubAgent gate fails → parent ledger records warning
- SubAgent with no mutations (research-only) → parent ledger has no false mutations

---

### Machine 6: TodoWrite Evidence Coupling

**Closes**: G8

**Target files**:
- `packages/cli/src/tools.ts` — lines 1326-1355 (`toolTodoWrite`)

**Changes**:
1. Add `context` parameter to `toolTodoWrite` (or pass `executionIntegrity` reference)
2. When any todo transitions to `status: "completed"`:
   - Check if the todo content implies code changes (contains keywords: implement, fix, add, create, modify, refactor, update, wire, build)
   - If code-change-implied: verify `executionIntegrity.getCurrentLedger().mutations.length > 0`
   - If no mutations: set `status: "in_progress"` and append warning `"[INTEGRITY] Cannot mark as completed — no file mutations recorded. Complete the implementation first."`
3. Non-code todos (research, review, analyze, investigate, read, understand, document, plan) can be completed without mutations.

**Tests**:
- `TodoWrite({status: "completed", content: "implement the login page"})` with no mutations → stays `in_progress`
- `TodoWrite({status: "completed", content: "research best practices"})` with no mutations → allowed `completed`
- `TodoWrite({status: "completed", content: "fix the bug in auth"})` with mutations → allowed `completed`

---

### Machine 7: Grok Provider Hardening

**Closes**: G4

**Target files**:
- `packages/core/src/providers/grok.ts`

**New file**:
- `packages/core/src/providers/grok-normalizer.ts`
- `packages/core/src/providers/grok.test.ts`

**Changes**:
1. Fix JSDoc: change "strict" to "compatible" in the comment
2. Create `GrokToolCallNormalizer`:
   ```typescript
   export function normalizeGrokToolCall(raw: unknown): NormalizedToolCall | ToolCallParseError {
     // Attempt JSON.parse on arguments
     // If malformed: try common repairs (trailing comma, unclosed brace, truncated string)
     // If still malformed: return ToolCallParseError
     // Validate tool name against known tool registry
     // Return normalized tool call
   }
   ```
3. Add `repairMalformedJson(input: string): string | null`:
   - Fix trailing commas
   - Close unclosed braces/brackets
   - Fix unescaped quotes in strings
   - Return null if irrecoverable
4. Wire normalizer into the Grok provider's streaming path: intercept tool-call events before they reach the agent loop
5. Add model capability flags for Grok models:
   ```typescript
   const GROK_CAPABILITIES: ModelCapabilities = {
     supportsStreaming: true,
     supportsToolCalls: true,
     supportsParallelToolCalls: false, // verify this
     supportsStructuredOutput: false,
     maxToolCallsPerTurn: 1, // conservative default
     requiresToolCallNormalization: true,
   };
   ```

**Tests** (`grok.test.ts`):
- Valid Grok tool call → passes through normalized
- Tool call with trailing comma in JSON → repaired
- Tool call with truncated JSON → repaired if possible, error if not
- Tool call with completely invalid JSON → `ToolCallParseError`
- Streaming chunks assembled correctly
- Provider config uses correct endpoint and auth

---

### Machine 8: Evidence Persistence Completion

**Closes**: G6

**Target files**:
- `packages/core/src/execution-truth.ts`
- `packages/cli/src/agent-loop.ts` — lines 454-477 (`writeExecutionTruthPayload`)

**Changes**:
1. Extend `ExecutionTruthPayload`:
   ```typescript
   interface ExecutionTruthPayload {
     // existing
     mode: string;
     provider: string;
     model: string;
     changedFiles: string[];
     mutationCount: number;
     validationCount: number;
     gateStatus: string;
     reasonCode: string | null;
     lastVerifiedAt: string;
     // new
     roundCount: number;
     totalToolCalls: number;
     requestType: string;
     promptPreview: string; // first 500 chars
     sessionId: string;
     timestamp: string;
   }
   ```
2. Add new file writers to `persistExecutionEvidenceBundle`:
   - `validations.json` — `ledger.validations`
   - `tool-calls.json` — `ledger.toolCalls` (strip large args, keep name + summary + success + timestamp)
   - `read-files.json` — `ledger.fileState` entries with timestamps and content hashes
3. Session-scope the output directory: `.dantecode/execution-integrity/{sessionId}/`

**Tests**:
- After session, all 6 files exist
- `tool-calls.json` contains expected tool names
- `validations.json` contains test/lint results if they were run
- `read-files.json` contains files that were read during session

---

### Machine 9: Regression Test Suite

**Closes**: G9

**New files**:
- `packages/core/src/execution-integrity-regression.test.ts`
- `packages/cli/src/bash-mutation-detector.test.ts`
- `packages/core/src/providers/grok.test.ts`
- Additions to existing test files as noted in each machine above

**Golden Flow Tests**:

| ID | Scenario | Expected |
|----|----------|----------|
| GF-01 | User asks for explanation only | Gate passes, no mutations required |
| GF-02 | User asks for code fix, model edits file via Edit tool | Gate passes, mutation record has before/after hash |
| GF-03 | User asks for code fix, model narrates change, no tool call | Gate fails: `NARRATIVE_WITHOUT_MUTATION` |
| GF-04 | File modified externally after read, write attempted | Write rejected: `STALE_READ` |
| GF-05 | File modified externally with same mtime | Write rejected via content-hash check |
| GF-06 | Bash `echo > file.txt` | Mutation detected and recorded |
| GF-07 | SubAgent edits file, parent checks evidence | Parent ledger contains child mutation |
| GF-08 | TodoWrite "implement X" with no mutations | Status stays `in_progress` |
| GF-09 | Grok streams malformed tool-call JSON | Repaired or rejected, never narrative fallback |
| GF-10 | Silent/serve mode, code-change request, no tool calls | Gate fails (not exempted) |
| GF-11 | Plan mode attempts source file Edit | Blocked by tool exclusion |
| GF-12 | Claimed "tests pass" without Bash test execution | Gate fails: `CLAIMED_VALIDATION_NOT_RUN` |

**Adversarial Tests**:

| ID | Scenario | Expected |
|----|----------|----------|
| AT-01 | Model says "I've updated the file" in assistant text only | Gate blocks |
| AT-02 | Model emits Edit tool with no actual content change | `NO_OBSERVABLE_MUTATION` |
| AT-03 | Rapid consecutive writes to same file | Serialized by file lock |
| AT-04 | SubAgent claims completion but child gate failed | Parent receives warning |
| AT-05 | All break paths in agent-loop tested for gate coverage | No unguarded success path |

---

## 6. Build Order

Machines must be built in this order due to dependencies:

```
Phase 1 — Core contracts (no behavioral change yet)
  Machine 3: Edit before-hash hardening
  Machine 4: Content-hash stale protection
  Machine 8: Evidence persistence completion

Phase 2 — Critical behavioral fixes
  Machine 1: Completion gate universalization     ← highest impact
  Machine 2: Bash mutation detection              ← closes biggest blind spot

Phase 3 — Evidence propagation
  Machine 5: SubAgent evidence propagation
  Machine 6: TodoWrite evidence coupling

Phase 4 — Provider hardening
  Machine 7: Grok provider hardening

Phase 5 — Regression suite
  Machine 9: Full regression tests (tests for all above)
```

Within each phase, machines are independent and can be built in parallel.

---

## 7. File Change Manifest

### New files
| File | Machine | Purpose |
|------|---------|---------|
| `packages/cli/src/bash-mutation-detector.ts` | M2 | Detect file changes from Bash commands |
| `packages/cli/src/bash-mutation-detector.test.ts` | M9 | Tests for bash mutation detection |
| `packages/core/src/providers/grok-normalizer.ts` | M7 | xAI tool-call repair logic |
| `packages/core/src/providers/grok.test.ts` | M7/M9 | Grok provider + normalizer tests |
| `packages/core/src/execution-integrity-regression.test.ts` | M9 | Golden flow + adversarial tests |

### Modified files
| File | Machine(s) | Changes |
|------|------------|---------|
| `packages/cli/src/agent-loop.ts` | M1 | Gate every break/return path |
| `packages/cli/src/tools.ts` | M1, M2, M3, M5, M6 | Bash mutation wiring, edit hash fallback, subagent evidence, todo coupling |
| `packages/core/src/execution-integrity.ts` | M3, M4, M5 | Hash storage, content-hash stale check, subagent evidence method |
| `packages/core/src/execution-truth.ts` | M8 | Extended payload + new file writers |
| `packages/core/src/providers/grok.ts` | M7 | JSDoc fix, normalizer wiring, capability flags |
| `packages/core/src/execution-integrity.test.ts` | M3, M4, M9 | New test cases |
| `packages/cli/src/execution-integrity-e2e.test.ts` | M1, M9 | Gate bypass tests |

---

## 8. Acceptance Charter

The build is not complete unless ALL of these are provably true:

| # | Criterion | Machine | How to verify |
|---|-----------|---------|---------------|
| AC-1 | Every `break`/`return` in the main while loop either passes through the gate or is provably non-completion | M1 | Grep + manual audit |
| AC-2 | `config.silent` mode runs the completion gate | M1 | Test GF-10 |
| AC-3 | Bash file writes produce `MutationRecord` entries | M2 | Test GF-06 |
| AC-4 | Edit `beforeHash` is never silently `""` | M3 | Test in M3 |
| AC-5 | Stale-read detection works with same-mtime changes | M4 | Test GF-05 |
| AC-6 | SubAgent mutations appear in parent ledger | M5 | Test GF-07 |
| AC-7 | TodoWrite rejects completion without evidence for code tasks | M6 | Test GF-08 |
| AC-8 | Grok malformed tool calls are repaired or rejected | M7 | Test GF-09 |
| AC-9 | Persisted truth payload includes all 6 files | M8 | Test in M8 |
| AC-10 | Narrative-only "I changed X" is blocked | M1 | Test GF-03 |
| AC-11 | All 12 golden flows pass | M9 | Test suite |
| AC-12 | All 5 adversarial tests pass | M9 | Test suite |
| AC-13 | Existing test suite still passes (no regressions) | All | `npm test` |

---

## 9. Anti-Patterns to Avoid

1. **Do NOT add more prompting as the fix.** Rules and system instructions are advisory. The runtime gate is the real lock.
2. **Do NOT mock the completion gate in tests.** Test the real gate with real ledger state.
3. **Do NOT make the gate optional via config.** There is no valid reason for a production path to skip evidence checking.
4. **Do NOT log evidence — persist it.** Logs are ephemeral. The truth payload must survive the session.
5. **Do NOT treat Bash as special/exempt.** Bash is just another tool that can mutate files. Detect and record.
6. **Do NOT block on SubAgent evidence if the child crashed.** Record the crash as evidence, mark the child as `error`, let the parent gate decide.

---

## 10. Codex Handoff Block

Copy this verbatim as the build prompt:

```
Implement the DanteCode Execution Integrity Retrofit per V+E Packet VE-EIR-001.

Read the packet at docs/prd/VE_EXECUTION_INTEGRITY_RETROFIT.md first.

There are 9 machines. Build them in the specified phase order.

The codebase ALREADY HAS substantial integrity infrastructure:
- ExecutionIntegrityManager in packages/core/src/execution-integrity.ts
- MutationRecord, ValidationRecord, CompletionGateResult types
- canWriteFile() read-before-write check
- Evidence chain in packages/evidence-chain/
- Mode-based tool exclusions in packages/core/src/approval-modes.ts
- ExecutionTruthPayload persistence

You are CLOSING GAPS, not building from scratch. The 9 gaps are documented
with exact file:line references in the packet.

Build order:
Phase 1: Machine 3 (edit hash), Machine 4 (content hash), Machine 8 (persistence)
Phase 2: Machine 1 (gate universalization), Machine 2 (bash detection)
Phase 3: Machine 5 (subagent evidence), Machine 6 (todo coupling)
Phase 4: Machine 7 (grok hardening)
Phase 5: Machine 9 (regression tests)

Non-negotiable rules:
- Assistant text is never proof of completion
- Every break/return in agent-loop.ts main loop must pass through the gate
- Bash file mutations must be detected and recorded
- config.silent must NOT skip the gate
- Tests must use real gate logic, not mocks of the gate itself

Acceptance: all 13 criteria in Section 8 must pass. Run npm test after each phase.

Do not return a design-only answer. Implement the code.
```

---

## 11. KiloCode Design Principles Referenced

This packet was informed by inspecting KiloCode's actual implementation:

| KiloCode Pattern | DanteCode Equivalent | Status |
|-----------------|---------------------|--------|
| Provider-specific adapters with normalization | `providers/grok.ts` | Exists but thin — **M7 closes** |
| Tool-call repair for malformed provider output | None | **M7 adds** |
| Read-before-write with stale protection | `canWriteFile()` | Exists, mtime-only — **M4 closes** |
| Structured diff metadata from mutating tools | `buildMutationEvidence()` | Exists, mostly complete — **M3 hardens** |
| Mode-based tool permissions | `approval-modes.ts` tool exclusions | Exists and functional |
| Rules/instruction loading | `.dantecode/rules.md` + config | Exists |
| Diff truth surface in UI | Stream renderer + evidence tracker | Exists, needs M8 for completeness |

The key gap between DanteCode and KiloCode is not missing features — it's **bypass paths in the completion gate** (G3a-G3e) and **blind spots in mutation detection** (G2, G7). This packet closes both.
