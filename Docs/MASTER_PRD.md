# DanteCode — Master PRD v2.0
**Synthesized from 43 planning documents** | March 2026 | Branch: `feat/all-nines`

---

## North Star

**Enable non-technical people to build production-quality software without writing or understanding code — and without trusting blindly.**

DanteCode is a verification-first, model-agnostic coding agent. The moat is not generation quality. The moat is the ability to show non-technical users *why they can trust the code*, not just *that the code works*. Code generation is commodity. Trust is the product.

---

## The Three Problems We Solve

### 1. Trust Gap (Primary Moat)
Non-technical builders can't review code, can't run tests, can't diff files. They must trust AI outputs blindly — or not ship.

**Solution**: DanteForge — mandatory mechanical verification. Anti-stub scans, constitution checks, PDSE scoring, GStack validation. Every change produces a human-readable verification report and a cryptographic receipt. User sees "Verified — no issues found" or "Caught 2 problems and fixed them." No understanding required.

### 2. Coordination Gap (The Postal Service)
Real projects span multiple sessions, multiple tools, multiple people. There's no way to carry work across AI workspaces without losing fidelity.

**Solution**: Run Reports + portable documents. Non-technical operator acts as postal service between AI workspaces. PRDs go in, Run Reports come out. AIs speak the same language. Human transports without translating. Cross-workspace verification closes the loop.

### 3. Complexity Gap (Progressive Disclosure)
23 packages, 200K+ LOC. DanteCode is deeply capable but that depth is invisible from session 1.

**Solution**: Progressive disclosure. User sees prompt → verification result. Everything else is invisible until needed. Every default chosen. No config required for 95% of use cases. Three successful sessions unlock advanced features.

---

## Who We Serve

- **Primary (95%)**: Non-technical builders — entrepreneurs, domain experts, business owners, product people, students. They know what to build; DanteCode knows how.
- **Secondary (5%)**: Developers who want verification infrastructure — multi-agent coordination, multi-provider routing, governance, audit trails.
- **NOT**: Raw generation speed chasers. That's not our moat.

---

## Product Architecture

### Layer 1 — Verification Spine (The Moat)

#### DanteForge Integration (4-Stage Pipeline)
Every code write passes all stages. Failure at any stage is shown in the report — not silently swallowed.

**Stage 1: Anti-Stub Scan**
- Detects: empty function bodies, `throw new Error("not implemented")`, TODO/FIXME markers, console.log-only bodies
- Hard violations → block write immediately
- Soft violations → advisory (shown in report, not blocking)
- Custom patterns via `.dantecode/anti-stub-patterns.json`
- CI gate: `node scripts/anti-stub-check.cjs` must exit 0

**Stage 2: Constitution Check**
- Binary pass/fail on policy rules: security, safety, compatibility, style
- Critical violations: hardcoded secrets, command injection, destructive commands without guards, platform-incompatible patterns
- Critical → block write; warnings → advisory

**Stage 3: PDSE Local Score**
- 4 dimensions: Completeness, Correctness, Clarity, Consistency (each 0–100)
- Default gate threshold: 85/100 (configurable in STATE.yaml)
- Heuristic-based — deterministic local scorer, no LLM required
- Violations: functions >50 lines, unused imports, naming, missing error handling

**Stage 4: GStack Validation**
- Project-defined commands: typecheck, tests, lint, custom
- Each command has `hardFailure` flag
- Captures stdout, stderr, exit code, duration; kills on timeout

#### Receipt Architecture (Cryptographic Accountability)
- Every run produces tamper-evident **run receipts** with: receiptId, correlationId, actor, action, beforeHash, afterHash
- Receipt chain stored at `.dantecode/receipts/<sessionId>.json`
- Session-end **Certification Seal** = Merkle root of all receipts + config hash + metrics
- `sealHash` = cryptographic proof of session integrity
- Determinism rule: same inputs + same repo state → identical hashes (except timestamp nonces)
- Implemented in `@dantecode/evidence-chain` (chain-verifier + chain-exporter)

#### D-11 Run Reports (Trust Layer)
Every `/party`, `/magic`, `/forge`, and mutation session produces `.dantecode/reports/run-{ISO-timestamp}.md`.

Per-PRD entries must include:
- Status: `COMPLETE`, `PARTIAL`, `FAILED`, `NOT ATTEMPTED`
- Files created/modified/deleted with line counts
- Verification outcomes (anti-stub, constitution, PDSE, tests)
- **"What was built"** — plain language, 1–2 sentences, non-technical
- **"What went wrong"** — honest diagnosis when failing
- **"What needs to happen"** — actionable next step
- Token usage + cost estimate
- Reproduction command at bottom

**Critical rule**: Report written even on crash or early termination (try/finally). A partial report is infinitely more useful than no report.

Report verifiable by a separate Claude Code session in under 5 minutes.

#### Failure Catalog
Every failure has a code, plain-language explanation, and fix instruction:
- `STUB-001`: Hard stub detected
- `CONST-001`: Constitution critical violation
- `PDSE-001..004`: Quality threshold failures (completeness, correctness, clarity, consistency)
- `GSTACK-001`: Project command failed
- `VERIFY-001/002`: Receipt integrity failure
- Advisory codes (non-blocking): soft stubs, console.log, constitution warnings, PR quality

---

### Layer 2 — Core Runtime

#### DanteSandbox (Mandatory Execution Spine)
Single execution authority between every caller and every executable operation. Not advisory — mandatory.

**Architecture**:
1. **Sandbox Engine**: Central decision brain — determines isolation mode, requests DanteForge gate
2. **Execution Proxy**: Intercepts all execSync/spawn calls; prevents bypass
3. **Docker Isolation** (primary): Containerized with mounts, env shaping, timeout/resource controls
4. **Worktree Isolation** (fallback): Git-native fallback, lower overhead
5. **Host Escape Layer**: Explicit opt-in only, loud warnings, requires strong gate
6. **DanteForge Gate**: Pre-execution policy check (allow/warn/block/override)
7. **Sandbox Audit Trail**: Records every request, decision, outcome, override, violation

**Hard rules**:
- Zero direct execSync/spawn in production code (only at audited escape points)
- No silent host execution — all host fallbacks are explicit and logged
- `/sandbox status` reflects actual runtime state, not in-memory intent
- Docker preferred; worktree fallback; host only with explicit gate

**Config modes**: `off` (legacy only), `docker`, `worktree`, `auto`, `host-escape`
Env kill switch: `DANTE_DISABLE_SANDBOX=1`

#### DurableExecution (Crash-Safe Checkpoint/Resume)
- `DurableExecutionEngine`: checkpoint every N steps, crash-safe `run()` with resume
- Checkpoints at `.dantecode/checkpoints/{sessionId}.json`
- Try/finally ensures partial results on crash
- `listCheckpoints()`, `clearAllCheckpoints()` for ops management
- Implemented in `packages/core/src/durable-execution.ts`

#### TaskComplexityRouter (Cost-Aware Model Selection)
- Classifies tasks: `simple` → haiku | `standard` → sonnet | `complex` → opus
- Signals: token count, file count, security keywords (secret/auth/token), reasoning keywords (analyze/design/architect)
- Simple: tokens <2000, max 1 file, no flags
- Complex: tokens >8000, 5+ files, or (security AND reasoning)
- Cost multipliers: Opus 5x, Sonnet 2x, Haiku 0.5x
- Implemented in `packages/core/src/task-complexity-router.ts`

---

### Layer 3 — Intelligence Machines

#### DanteThink (Configurable Reasoning Effort)
**Current**: 3 tiers (quick/deep/expert), PDSE-driven self-critique, auto-escalation, playbook distillation.

**Additions needed (8.0 to 9.0)**:
- `/think [quick|deep|expert|auto]` — override for next prompt
- `/think [tier] --session` — set for entire session
- `/think stats` — tier distribution + avg PDSE per tier
- `/think chain [N]` — last N steps with icons, PDSE, escalation
- **Cost-aware decideTier**: Add costMultiplier + remainingBudget; adjust thresholds by provider cost
- **Tier outcome tracking**: recordTierOutcome to getTierPerformance to getAdaptiveBias
- Backward compatible: decideTier works identically when new params undefined

#### DanteGaslight (Bounded Adversarial Refinement)
Detect challenge signals, iterative refinement, DanteForge gate each iteration, distill only verified lessons.

**Trigger channels**: Explicit user (`/gaslight on`, "is this really your best?"), weak verification score, policy-based on high-stakes tasks, random audit rate.

**Stop conditions**: DanteForge PASS, confidence threshold, budget exhausted (tokens/iterations/time), user stop signal.

**6 organs**: TriggerDetector, GaslighterRole, IterationEngine, DanteForge Gate, SkillbookWriter, BudgetController.

**Key rule**: Iteration history stored in debug; distilled lessons stored in Skillbook **only after PASS**.

Default config: disabled; maxIterations=5; maxTokens=10K; maxSeconds=120.

#### DanteFearSet (Fear-Setting Engine, inside DanteGaslight)
Tim Ferriss' fear-setting as default reasoning protocol for high-stakes tasks.

**5-column structure**: Define worst case, Prevent it, Repair if it happens, Benefits of action, Cost of inaction.

**Auto-triggers**: High-stakes task, long-horizon, destructive/hard-to-reverse actions, DanteForge flags plan as fragile.

**DanteForge robustness gate**: New dimension `FearSetRobustness` — no plan accepted without robustness decision.

**Lesson distillation**: Successful FearSet runs tagged into Skillbook as `FearSet-Prevent`, `FearSet-Repair`.

**Default behavior**: Only triggers on policy-defined high-stakes tasks — not every prompt (avoids analysis paralysis).

#### DanteSkillbook (ACE Reflection Loop)
Make every serious run teach the system something durable. Strategies from prior runs injected into future prompts.

**5 organs**: Skillbook Core, Role Engine (DanteAgent/DanteReflector/DanteSkillManager), Reflection Loop, DanteForge Gate, Runtime Integration.

**Storage**: `.dantecode/skillbook/skillbook.json` — Git-tracked, versioned, diffable.

**Hard rule**: No skillbook update without DanteForge PASS. REVIEW-REQUIRED goes to queue (never auto-applied). FAIL discards.

**Retrieval**: Top-K by recency + relevance + trust score + task type + project scope. No token bloat.

**Pruning**: Section caps enforced. Low-value/stale skills demoted. High-trust preserved longer.

**Distinction**: Memory Engine stores facts and history. Skillbook stores distilled strategies. Keep separate; cross-link by provenance only.

#### D-12A — Bounded Model Adaptation V1
Observe quirks, generate versioned prompt overrides, test in bounded experiments, promote only with gates.

**Quirk taxonomy (V1, 10 classes)**: tool_call_format_error, schema_argument_mismatch, markdown_wrapper_issue, stops_before_completion, skips_synthesis, ignores_prd_section_order, overly_verbose_preface, and 3 others.

**What can be modified**: Prompt framing, instruction ordering, tool-call formatting hints, synthesis requirement text, report-generation phrasing. NOT code, NOT policy, NOT engine.

**Override storage**: `.dantecode/model-adaptation/overrides/<provider>/<model>/<quirk>.v1.draft.json`

**Experiment limits**: Max 5/day per quirk. Test on synthetic mini-task + replayed real exchange + held-out control task.

**Promotion gates** (strict): PDSE +5%, completion verifier doesn't regress, control task doesn't regress, smoke passes, no new critical failure class, **human veto required for first 3 promotions per quirk family**.

**Rollback triggers**: PDSE regression, completion regression, control regression, repeated runtime failures, user-forced disable.

**Operational modes**: Default `staged`. Kill switch: `DANTE_DISABLE_MODEL_ADAPTATION=1`.

---

### Layer 4 — Orchestration

#### Council Orchestrator (Fleet Execution)
Multi-agent coordination across worktrees. State machine + AbortController + retry engine + write-mutex.

**5 features for 9.0**:
1. **Per-lane PDSE verification**: DanteForge on every lane output; retry up to `maxLaneRetries`; accept-with-warning if exhausted; emit `lane:verified` / `lane:accepted-with-warning`
2. **Fleet-wide budget** (`fleet-budget.ts`): maxTotalTokens, maxTokensPerAgent, maxTotalCostUsd, warningThreshold (0.8); emit `budget:warning` / `budget:exhausted`
3. **Live fleet dashboard** (`fleet-dashboard.ts`): ANSI in-place redraw (no Ink); per-lane: name, status icon, tokens, PDSE, elapsed; periodic 2s refresh
4. **Dynamic redistribution** (`task-redistributor.ts`): Idle agent takes from slow agent; heuristic-only decomposition (no LLM); respects file ownership; won't redistribute if agent >80% done
5. **Configurable nesting depth** (`CouncilConfig.maxNestingDepth`): default 1, can configure 0/1/2/etc

#### DanteServe (HTTP Server Mode)
Extract agent-loop into HTTP service. REPL becomes a client. No new dependencies (node:http only).

**Routes**:
- `GET /api/health` — status, version, uptime
- `GET /api/sessions` — list sessions
- `POST /api/sessions` — create session
- `GET /api/sessions/:id` — messages, tokens, model
- `POST /api/sessions/:id/message` — send message
- `GET /api/sessions/:id/stream` — SSE real-time output
- `POST /api/sessions/:id/approve` — human-in-loop approval
- `POST /api/verify` — PDSE check on code
- `GET /v1/models` — OpenAI-compat model list
- `POST /v1/chat/completions` — OpenAI-compat, stream: true supported

**SSE event types**: token, tool_start, tool_end, diff, pdse, status, error, done, approval_needed.

**Auth**: HTTP Basic or Bearer token; password from env `DANTECODE_SERVER_PASSWORD`.

**CLI**: `dantecode serve [--port 3210] [--host 127.0.0.1] [--token <bearer>]`

**Critical constraint**: Zero regressions on agent-loop tests. emitOrWrite adapter must be completely transparent when eventEmitter is undefined.

**Future unlocks**: Web UI, mobile PWA, JetBrains plugin, CI/CD API, multi-user session isolation, `/teleport`.

---

### Layer 5 — Surface

#### DanteTUI (Terminal UI, 8.0 to 9.0)
5 targeted upgrades. Zero new npm dependencies (ANSI only + existing ux-polish).

1. **Persistent status bar**: `[model: X] [ctx: 72%] [session: abc] [sandbox: on] [PDSE: 91]`
2. **Syntax-highlighted diff viewer**: Green +, red -, dim context, line numbers
3. **Token usage dashboard** (`/tokens`): Model, Provider, Input, Output, Est. cost, Context%
4. **`/theme` command**: list / set / reset; themes: default/minimal/hacker/light; persists to STATE.yaml
5. **Context-aware prompt**: When utilization >50%, prompt shows mini gauge; helper: `buildPromptString(utilPct)`
6. **`/diff` command**: Colored diff of last agent round's changes (+ green, - red)

All rendering pure functions (state to string). Side effects at REPL wiring layer only. Non-TTY graceful fallback.

#### DanteSession (Session Management, 7.5 to 9.0)
6 targeted additions:

1. **Session naming**: `--name <name>` flag + `/session name <name>` command; name column in `/session list`
2. **Session export**: `/session export [--format json|md] [--out <file>]`; JSON or Markdown table
3. **Session import**: `/session import <path>`; appends last 20 messages as system context
4. **Session branching**: `/session branch [<name>]`; forks with summary + recent messages; saves parent first
5. **Memory auto-retain**: After each round, store tools used + PDSE + files changed scoped to session; wrapped in try/catch (never blocks)
6. **Memory export**: `/memory export [--format json|md] [--out <file>]`

Storage: `packages/core/src/session-store.ts` — `rename()` + `branch()` methods.

#### DanteComplete (Inline Completions, 7.0 to 9.0)
4 additions to existing 1,444 LOC system:

1. **Accept/reject telemetry** (`CompletionTelemetry`): Track events (timestamp, model, language, outcome, latency, PDSE, cache hit); `recordAccept()` / `recordReject()` / `getAcceptanceRate()`; local-only `.dantecode/completion-telemetry.json`
2. **Smart cache invalidation**: Invalidate entry when edit occurs above last cursor position in `onDidChangeTextDocument`
3. **Completion prefetching**: After accept, fire-and-forget next completion; 500ms idle debounce; 2s TTL cache; instant return on match
4. **Accept-pattern learning**: `recordPrefixPattern(prefix)` (last 20 chars); `getMostAcceptedPrefixPatterns()` top 10; boost priority when prefix matches top pattern

Privacy: All telemetry local only. Add to `.gitignore` by default.

#### DanteSkills (Universal Skill Platform, 7.5 to 9.0)
**The moat**: Every other tool imports skills blindly. DanteCode constitutionally verifies every imported skill.

**8 skill format parsers**:
- Claude Code (`.claude/skills/`, `.claude/commands/`)
- Codex (`.codex/skills/`, TOML)
- Cursor (`.cursor/rules/*.mdc`, frontmatter)
- Qwen/Gemini (`.qwen/skills/`, JSON)
- OpenCode (`.opencode/skills/`)
- Continue.dev (`.continue/`)
- Antigravity (raw SKILL.md)
- DanteForge (`.danteforge/skills/`)

**Skill verifier**: Anti-stub, completeness, script safety (eval/exec/network/credential detection), security, quality score. Tiers: guardian/sentinel/sovereign.

**Skill catalog**: In-memory search + filter (name/tag/source/tier), JSON persistence at `.dantecode/skill-catalog.json`.

**Skill composition chains**: Link skills with `$input` and `$previous.output` substitution. DanteForge gates between steps.

**CLI commands**: `/skill install`, `/skill search`, `/skill list`, `/skill verify`, `/skill compose`, `/skill export`, `/skill import-all`, `skills import --source <codex|cursor|qwen>`

#### DanteEvents (Event-Driven Automation, 7.5 to 9.0)
Current infrastructure solid (2,239 LOC battle-ready). Gaps are surface + integration:

**5 additions**:
1. **Unified `/automate` command**: dashboard, list, create, stop, logs, template, templates
2. **5 built-in templates**: pr-review, daily-verify, test-on-change, security-scan, weekly-retro
3. **Agent-loop integration** (`automation-agent-bridge.ts`): agentMode on AutomationDefinition; `${var}` substitution from trigger context; headless session; DanteForge gate when `verifyOutput: true`
4. **File-pattern watcher**: Glob matching (`**`, `*`, `?`, `[abc]`); debounce + batch; no deps
5. **DanteForge gate on automation output**: Score <70 fires warning flag (no auto-revert; human reviews)

---

### Layer 6 — Verification Trend and Reporting

#### VerificationTrendTracker (Async JSONL Mode)
- Persistent JSONL storage per file/session
- `record(point)`, `loadPoints(limitDays?)`, `generateReport(periodDays?)`
- `isRegression(filePath, newScore)` — flags >5 point drop
- `getFileAverage(filePath, limitDays?)`
- Trend: improving/stable/degrading via quartile comparison; alert when avg <70
- Backward-compatible with existing synchronous API
- Implemented in `packages/core/src/verification-trend-tracker.ts`

#### Release Gate System (10/10 checks)
`scripts/release-check.mjs`:
1. Build (turbo)
2. Tests (turbo)
3. Typecheck (turbo)
4. Anti-stub scan
5. Version alignment (all at same semver)
6. CLI smoke (--help exits 0)
7. CLI commands registered (10 or more)
8. No circular dependencies
9. Export verification
10. License + README present

Scripts: `npm run release:check`, `npm run check:stubs`

---

## The Postal Service (Cross-Workspace Workflow)

### Workspace Map
| Label | Tool | Purpose |
|-------|------|---------|
| HQ | Claude.ai | Strategy, PRDs, scoring |
| DC-Build | Claude Code | Building/fixing DanteCode |
| DC-Run | DanteCode CLI | Using DanteCode on projects |
| DL-Build | Claude Code | Verifying project output |
| DL-HQ | Claude.ai | Project strategy |

### Three Canonical Documents
1. **PRD** — Specification (HQ creates, DC-Run/DC-Build consumes)
2. **Run Report** — Execution accounting (DC-Run produces, DL-Build verifies)
3. **Bug Report** — Technical diagnosis (DL-Build produces, DC-Build fixes)

### Golden Rules
1. **Never summarize** — transport documents whole (copy/paste)
2. **Always verify independently** — different AI than builder
3. **Run report is source of truth** — FAILED in report = failed
4. **One workspace, one repo** — don't ask wrong workspace
5. **When confused, come to HQ** — that's HQ's job

---

## Golden Flows (Ship Gates)

All 6 must pass on real repositories, not demos.

| Flow | Scenario | Pass Condition |
|------|----------|----------------|
| GF-01 | Clean install to first success | Under 10 min, help works, init creates STATE.yaml, task completes with report |
| GF-02 | Real bugfix with verification receipt | Verifier catches, patch applied, PDSE pass, receipt on disk with sealHash |
| GF-03 | Multi-file refactor with guardrails | Unsafe refactors blocked, undo safe and complete |
| GF-04 | Skill import and execution | Skill imported, listed with badge, task executes end-to-end, receipt produced |
| GF-05 | Provider failover | Fallback triggers without intervention, report records switch |
| GF-06 | Background task completion | Work persists across sessions, report integrity maintained |

---

## Release Gates

### Private Daily-Driver Gate (All must pass)
- [ ] P0: Truth spine — readiness artifacts generated from CI (not hand-written)
- [ ] P1: CI recovery — green on Node 18/20/22, Windows smoke, all 9 jobs
- [ ] P2: Verification spine — receipt schema, PDSE contract, failure catalog documented
- [ ] P3: CLI daily-driver — frictionless init, predictable commands, clear visibility
- [ ] P4: Live provider proof — Anthropic, OpenAI, Grok, Ollama confirmed working
- [ ] GF-01 through GF-05 green on real repos
- **Status artifact**: `current-readiness.json` → `"status": "private-ready"`

### Public OSS v1 Gate (All must pass)
- All private-ready gates
- [ ] P6: VS Code preview smoke — chat, diff, verification status, restart persistence
- [ ] P7: Selective OSS harvest — patterns from Aider, Qwen, Continue, OpenHands, Codex, Cursor
- [ ] P8: Public release seal — publish dry-run proven, README quickstart from clean clone
- [ ] GF-06 green
- **Status artifact**: `current-readiness.json` → `"status": "public-ready"`

---

## What Is Built (Current State as of March 2026)

| Component | Status | Location |
|-----------|--------|----------|
| Anti-stub scanner (4-stage gate) | Built | `scripts/anti-stub-check.cjs` |
| PDSE local scorer | Built | `@dantecode/danteforge` |
| D-11 Run Reports | Built | `packages/core/src/run-report.ts` |
| Evidence chain (Merkle + receipts) | Built | `packages/evidence-chain/` |
| Chain verifier + exporter | Built | evidence-chain v2 |
| DanteSandbox enforcement | Built | `packages/dante-sandbox/` |
| DurableExecution | Built | `packages/core/src/durable-execution.ts` |
| TaskComplexityRouter | Built | `packages/core/src/task-complexity-router.ts` |
| VerificationTrendTracker (async JSONL) | Built | `packages/core/src/verification-trend-tracker.ts` |
| Council Orchestrator + DanteFleet+ | Built | `packages/core/src/council/` |
| DanteGaslight + FearSet | Built | `packages/dante-gaslight/` |
| DanteSkillbook + ACE loop | Built | `packages/dante-skillbook/` |
| Memory Engine (hot-path wired) | Built | `packages/memory-engine/` |
| Debug Trail | Built | `packages/debug-trail/` |
| Release gate scripts (10/10) | Built | `scripts/release-check.mjs` |
| DanteServe (HTTP server) | Built | `packages/cli/src/commands/serve.ts` |
| DanteThink `/think` command | Built | `packages/cli/src/slash-commands.ts` |
| `/automate` unified command | Built | `packages/cli/src/commands/automate.ts` |
| Skill parsers (codex/cursor/qwen) | Built | `packages/skill-adapter/src/parsers/` |
| SkillBridge runtime | Built | `packages/skill-adapter/src/import-bridge.ts` |
| Session naming + export + branch | Partial | `packages/core/src/session-store.ts` |
| Completion telemetry (B1/B4) | Partial | `packages/vscode/src/completion-telemetry.ts` |
| DanteTUI status bar + `/theme` | Partial | `packages/cli/src/repl.ts` |
| D-12A Model Adaptation | Not started | — |
| Completion Verifier (D-12) | Not started | — |
| Progressive Disclosure unlock counter | Not started | — |
| GF-01 through GF-06 real-repo runs | Not attempted | — |
| Live provider proof (all 4) | Not attempted | — |

---

## What Remains (Priority Order)

### P0 — Execution Truth (Must have for daily-driver)
1. **Run report integration depth**: Ensure `/magic`, `/party`, `/forge` all write reports with honest COMPLETE/PARTIAL/FAILED per-PRD. Report must survive Ctrl+C.
2. **D-12 Completion Verifier**: Module that checks whether expected outputs were actually created (diff actual vs expected file list from PRD).
3. **DanteTUI full wiring**: Status bar, context gauge in prompt, `/diff`, `/theme`, `/tokens` all connected to live data.

### P1 — Trust Spine
4. **D-12A Model Adaptation (observe-only mode first)**: QuirkObservation logger that persists to `.dantecode/model-adaptation/observations.jsonl`. No learning yet — just data collection with full schema.
5. **Receipt integrity display**: Show receipt summary in run report footer. `sealHash` visible to user.
6. **PDSE contract in UI**: When PDSE fails, show exactly which dimension failed and why (e.g., "Completeness 41/100: createProduct() is empty").

### P2 — Session and Portability
7. **Session export/import roundtrip**: `/session export json` then `/session import` in new workspace. Test across sessions.
8. **Memory auto-retain per round**: Record tools used + PDSE + files changed per round. Wrapped in try/catch.
9. **Progressive disclosure unlock**: Counter for successful sessions. After 3: unlock `/fleet`, `/council`, `/gaslight`, `/fearset`.

### P3 — Provider and Golden Flows
10. **Live provider smoke matrix**: Anthropic, OpenAI, Grok, Ollama confirmed working with test output.
11. **GF-01 clean install proof**: `npm install -g dantecode`, `dantecode init`, first task on a real project. Time it.
12. **GF-05 provider failover**: Intentionally kill primary, verify fallback completes, report shows both.

### P4 — Intelligence Depth
13. **DanteThink cost-aware tier selection**: Add costMultiplier + remainingBudget params to `decideTier()`. Track tier outcomes for adaptive bias.
14. **Skillbook quality scorer + version manager**: Version history in `.dantecode/skillbook/`, pruning policy enforcement, quality score trends.
15. **Completion prefetch + pattern learning**: B3 + B4 from DanteComplete PRD. 500ms idle prefetch, top-10 prefix pattern boosting.

---

## Non-Negotiable Rules (from all 43 docs)

1. **Verification is mandatory** — DanteForge gate is fail-closed. No bypass. No silent passthrough.
2. **Reports are honest** — FAILED means FAILED. Not "passed with warnings." Never.
3. **All telemetry is local** — No external calls without explicit user consent. No tracking.
4. **Pure functions for rendering** — All status/dashboard/prompt rendering is state to string. Side effects only at wiring.
5. **Zero external dependencies where possible** — node:http for server, ANSI for TUI, no Ink, no Express.
6. **No skillbook update without PASS** — Iteration history is not knowledge. Only verified lessons persist.
7. **Try/finally for all long-running work** — Run reports, receipts, checkpoints must survive crash.
8. **Transport documents whole** — Never summarize PRDs, bug reports, or run reports when handing off.
9. **Test counts matter** — Each PRD specifies test count. Minimum 100s per PRD, not tens.
10. **No version bump unless intentional** — Version bumps break npm ci. Always verify workspace version alignment.

---

## Success Metrics

| Dimension | Private-Ready Target | Public-Ready Target |
|-----------|---------------------|---------------------|
| Engineering truth | All 9 CI jobs green | All 9 + Windows smoke |
| Verification moat | Deterministic receipts, plain-language reports | Cryptographic seals visible to user |
| Daily-driver usability | Frictionless init, run report every session | GF-01 through GF-06 on real repos |
| External credibility | Works on own projects | Published OSS, README quickstart |
| Non-technical trust | User sees "Verified" or "FAILED" | User can carry Run Report to verifier AI |

**North Star metric**: DanteCode is good enough to use on own real projects instead of defaulting to Claude Code.
