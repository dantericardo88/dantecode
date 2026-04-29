# Maintainability Cycle 1 — Progress Note

**Sprint:** "9s across the board, harsh-mode"
**Plan:** `C:\Users\richa\.claude\plans\ethereal-booping-locket.md`
**This session date:** 2026-04-29

## What shipped

Three commits attacking 6 functions ≥100 LOC across the cli + vscode
packages. Each was a mechanical extraction with no behavior change.

| Commit | Function | Before | After | Method |
|---|---|:---:|:---:|---|
| `f6ddbe8` | `getToolDefinitions` (cli/tools.ts) | 393 LOC | ~5 LOC | Hoisted array literal to module-level `TOOL_DEFINITIONS` const |
| `f6ddbe8` | `getAISDKTools` (cli/tool-schemas.ts) | 236 LOC | ~5 LOC | Hoisted record literal to module-level `NATIVE_TOOL_SCHEMAS` const |
| `6c3d9c0` | `bgCommand` (cli/slash-commands.ts) | 104 LOC | ~75 LOC | Extracted `formatBackgroundTaskList` |
| `6c3d9c0` | `historyCommand` (cli/slash-commands.ts) | 113 LOC | ~58 LOC | Extracted `formatSessionDetails` |
| `6c3d9c0` | `toolWebFetch` (cli/tools.ts) | 116 LOC | ~75 LOC | Extracted `formatFetchedResponse` |
| `6c3d9c0` | `toolReplaceInFile` (vscode/agent-tools.ts) | 118 LOC | ~75 LOC | Extracted `applyAllBlocks` + `writeAndSummarize` |

**Large-fn count: 57 → 51 (−6).**
**All 1340 vscode + 2256 cli tests still pass. No `--no-verify`.**

## Why the maintainability dim didn't move

Score formula (`scoreMaintainability` in DanteForge):

```
score = pdseBase - scaledPenalty
```

Where:
- `pdseBase ≈ 66` (back-calculated from current state; max 100)
- `scaledPenalty` is tiered:
  - X ≤ 6:  linear (penalty = X*2)
  - X ≤ 20: 6 + (X*2 - 6) * 0.5
  - X >  20: 13 + min(17, (X*2 - 20) * 0.3) **capped at 30**

Currently X = 51, raw = 102 → penalty hits the 30 cap. Cutting to X = 40
(raw 80) still caps at 30. Need X ≤ 26 (raw 52) to start dropping the
penalty.

**To move the dim score**, we need either:
- Drop X to ≤ 26 (kill 25 more large fns). Practically requires breaking
  up `runAgentLoop` (2,633 LOC), `getWebviewHtml` (2,224 LOC),
  `activateInner` (613 LOC), and the rest of the 100-200 LOC band.
- **OR** raise `pdseBase` by improving PDSE testability + constitution
  artifact scores. This means running the PDSE pipeline (specify →
  clarify → plan → tasks → verify) on a real feature.

## Real-quality value of this session's work (independent of score)

Each extracted helper is a focused, testable unit:
- `formatBackgroundTaskList` — replaceable for different output formats; status-icon table is data-driven, easy to extend.
- `formatSessionDetails` — clean async fn; could be unit-tested against a fake SessionStore.
- `formatFetchedResponse` — owns the Response → string transform; easier to add formats (e.g., XML, RSS) without touching the parent.
- `applyAllBlocks` + `writeAndSummarize` — separate the per-block iteration from the IO + summary text.
- `TOOL_DEFINITIONS` / `NATIVE_TOOL_SCHEMAS` consts — tool metadata is now data, not code; easier to diff, easier to filter at runtime.

## Continued progress (2026-04-29 evening) — 16 commits cumulative

| Commit | Change | Δ |
|---|---|:---:|
| `efe0da9` | registerCommands + parseArgs split | -2 |
| `83ec6db` | runAutoforgeIAL split (collectInputViolations, regenerateFromFailure) | -1 |
| `c74a289` | computeDashboardMetrics + createDefaultToolHandlers split | -2 |
| `48c0851` | toolWrite + grepDir + toolGitHubSearch split | -3 |
| `479b4c9` | listenCommand split (status, executor, banner helpers) | -1 |

**Cumulative: 57 → 41 large fns (-16). All 1340 vscode + 2256 cli + 3005 core + 69 mcp tests pass. No `--no-verify`.**

The score wall (penalty caps at 30 until X<26) still hasn't been broken — we're at 41, need 15 more kills. But real-engineering quality is meaningfully improved: every extraction produced a self-contained, named, separately testable helper. The biggest functions (runAgentLoop 2,633L, partyCommand 398L, autoforgeCommand 369L, buildSystemPrompt 377L, runAscendLoopCore 326L) remain to be tackled in future sessions.

## What's left for the maintainability dim (next sessions)

In ROI order:

1. **`runAgentLoop`** (2,633 LOC, biggest). Extract turn-handler,
   tool-dispatcher, stream-handler, completion-gate, retry-shell. Each
   piece will likely still be ≥100 LOC, but the parent becomes a small
   orchestrator. Net: −1 (replaces 1 big with 1 small + 5 medium-large).

2. **`getWebviewHtml`** (2,224 LOC). Mostly template-literal content.
   Split per-section: `renderCss`, `renderBodyHtml`, `renderInlineScript`.
   Each section is itself splittable into ~5 sub-helpers (slash-menu,
   stream-handler, input-area, history, settings). Net: -1 to -7
   depending on depth.

3. **`activateInner`** (613 LOC). Group registrations by domain:
   `registerCommands`, `registerProviders`, `registerStatusBar`,
   `registerMcp`, `registerSecretStorage`. Net: -1.

4. **Long-tail medium fns** (100-300 LOC each). Roughly 30 functions
   in this band. Each takes 5-15 minutes to extract one helper out
   of. Net: -1 per kill.

5. **Improve `pdseBase`** by running PDSE pipeline cycles. Independent
   lever — even with X = 51, if pdseBase reaches 100, score = 70 (7.0/10)
   without any further refactoring.

## Stop conditions (for the maintainability cycle)

- **Real-quality stop:** when extractions stop improving readability
  (forcing helpers smaller than the cohesion boundary). We are NOT at
  this point yet — runAgentLoop and getWebviewHtml are clearly too big.
- **Score-movement stop:** when X drops below ~26, the penalty starts
  decreasing and dim score moves. Until then it's ledger work.
- **Composite stop:** when the whole-project composite hits 9.0+ and
  the verdict clears `acceptable`. Far away.

## Recommendation for next session

Pick **`getWebviewHtml`** as the next target — it's the lowest-risk big
function (mostly template literals, well-covered by 32 regression-guard
assertions). Splitting into 5-7 per-section helpers should be 2-3 hours
and demonstrates the pattern for `runAgentLoop` afterward.

## Wall-break batch (2026-04-29 afternoon)

After the earlier session brought count to 35, this turn drove
maintainability past the wall (X<26) and through the steady-gradient
zone.

| Commit | Function(s) | Count Δ | Method |
|---|---|:---:|---|
| `0b138c8` | `runInitCommand` + `cmdBrowse` | 35→33 | per-step helpers (ensureInitDir/File, executeAndRecordBrowserAction, buildBrowsePromptContext) |
| `23f565a` | `nodeApiFiles` + `reactTsFiles` | 33→31 | per-file builders + module-level template consts |
| `1f6cb34` | `executeAction` | 31→30 | per-action handlers (execCmdRun, execFileRead/Edit/Write/AgentFinish) |
| `aa40da5` | `classifyApiError` | 30→29 | CLASSIFICATION_RULES table replacing 9-arm if-cascade |
| `7831f16` | `parseUdiffResponse` + drift fixes | 29→28 | readFileHeader + readHunkBody, plus typecheck-drift cleanup from concurrent agent edits |
| `c27185c` | `cmdGenerate` | 28→27 | persistGenerateOutcome (was closure) + writeAndVerifyOne, PersistContext bundles shared state |
| `af88c2a` | `renderProofPayloadForTesting` | 27→26 | renderProofBadge + renderProofFields + 4 per-event field renderers, `field()` helper |
| `782419b` | `runAutoforgeIAL` re-extract | 26→25 | **WALL BREAK.** emitIterationProgress + recordAutoforgeSuccess. Penalty cap (30) starts releasing |
| `29f157a` | `handleGitHubWebhook` | 25→24 | parseGitHubWebhookEnvelope + dispatchIssueToPRPipeline |
| `00f7c2e` | `handleSlackWebhook` | 24→23 | verifySlackEnvelope |
| `2329291` | `dispatchCloud` | 23→22 | cloudResult envelope helper + consumeCloudSseStream |
| `566b7fa` | `chunkBrace` | 22→21 | emitImportChunk + advanceBraceScan + mergeTinyChunks |

**Cumulative session: 57 → 21 (−36 large-fn kills).**

### Score gradient observed

| X (count) | Maintainability | Composite |
|---:|:---:|:---:|
| 57 | 3.6 | 7.8 |
| 35 | 3.6 (still capped) | 7.8 |
| 26 | 4.3 (cap broke) | 8.0 |
| 25 | 4.4 | 8.0 |
| 24 | 4.5 | 8.0 |
| 22 | 4.6 | 8.0 |
| 21 | 4.6 | 8.0 |

Gradient ≈ +0.1 per 1-2 kills below the wall. To reach 9.0 needs ~60
more kills (linear). Realistic — the long tail of medium-fn extraction
plus the three big orchestrators (runAgentLoop 2,633L, partyCommand
398L, autoforgeCommand 369L) carries us most of the way.

Side-effect dims that moved during this work:
- `ecosystemMcp`: 6.0 → 9.0 (other agents shipped MCP work concurrently)
- `selfImprovement`: 7.8 → 8.3 (retros + lessons accumulated)
- `enterpriseReadiness`: ceiling reached (9.0)

### Drift to be aware of

Three concurrent-agent typecheck regressions surfaced and were cleared
in `7831f16`: ascendCycle write-only field in sidebar-provider, unused
getNonce in webview-html, optional-array-access lints in
slash-commands.test, lsp-context-provider.test, and the
edit-history-tracker captured-but-unused listener. Watch for these
returning — concurrent edits keep introducing the same patterns.

Alternative: pursue `pdseBase` instead via a real PDSE pipeline run on
the maintainability work itself (specify the refactor, plan it, execute,
verify). Earns score AND validates the PDSE pipeline.
