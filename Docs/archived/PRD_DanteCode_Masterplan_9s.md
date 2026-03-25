# DanteCode Masterplan PRD — "All 9s"
## From 6.9 Average to 9.0+ Across 16 Active Dimensions

> **Version**: 1.0 | **Date**: 2026-03-24 | **Codename**: Blade Sharpening
> **Branch**: `feat/onramp-v1.3` → `feat/all-nines`
> **Baseline Commit**: `de7111d`
> **Doctrine**: KiloCode (<500 LOC per file), Anti-Stub, Constitutional Lock-In

---

## 1. Strategic Summary

DanteCode scores 6.9/10 average across 17 dimensions. Desktop GUI (3.0) is deferred to DirtyDLite. The remaining 16 dimensions need +30.5 total points to reach 9.0 across the board.

The gaps cluster into **4 categories**:
- **Ship Infrastructure** (Ship Readiness 6.0, Debug Trail 6.0) — Missing release gates, thin observability tests
- **Test Debt** (Security 6.5, Code Intel 6.5, Debug Trail 6.0) — Implementation exists, verification doesn't
- **Feature Gaps** (Memory 7.0, Search 7.0, Git 7.0, Skillbook 7.0, Evidence 7.0, Self-Update 7.0) — Functional but missing hardening features
- **Polish** (Council 8.5, Multi-Model 8.0, Verification 8.0, CLI 7.5, Agent Loop 7.5, Gaslight 7.5) — Close to 9, need targeted improvements

**Strategy**: Fix the foundation first (ship infrastructure + test debt), then close feature gaps, then polish. 6 waves, each independently verifiable.

---

## 2. Wave 1 — Ship Infrastructure (Ship Readiness 6.0 → 9.0, Debug Trail 6.0 → 9.0)

**Problem**: DanteForge has `release:check`, `release:check:strict`, anti-stub scan, CLI smoke tests, plugin manifest checks, repo hygiene, and simulated fresh install. DanteCode has none of this. Tests pass but there's no machinery to prove it's ready to ship.

### 2.1 Release Gate System

**Create `scripts/release-check.mjs`**:
```
Checks (all must pass):
1. pnpm build succeeds (turbo, all packages)
2. pnpm test succeeds (turbo, all packages)
3. pnpm typecheck succeeds (all packages)
4. Anti-stub scan: no TODO/FIXME/TBD/placeholder/stub in src/ files (excluding tests)
5. Version alignment: root package.json, all workspace package.json versions match
6. CLI smoke: `node packages/cli/dist/index.js --help` exits 0
7. CLI commands registered: all 17 commands appear in help output
8. No circular dependencies: `madge --circular packages/*/src/index.ts` exits clean
9. Export verification: every packages/*/src/index.ts has ≥1 named export
10. License + README present in each publishable package
```

**Create `scripts/anti-stub-scan.mjs`**:
- Scan all `src/**/*.ts` files (excluding `*.test.ts`)
- Fail if any contain: `TODO`, `FIXME`, `TBD`, `placeholder`, `stub`, `not implemented`, `throw new Error('implement`
- Report file, line, match

**Create `scripts/cli-smoke.mjs`**:
- Build CLI, run each of the 17 commands with `--help`
- Verify all exit 0
- Verify `dantecode --version` returns version matching root package.json

**Add to `package.json`**:
```json
"scripts": {
  "release:check": "node scripts/release-check.mjs",
  "check:anti-stub": "node scripts/anti-stub-scan.mjs",
  "check:cli-smoke": "node scripts/cli-smoke.mjs"
}
```

### 2.2 Debug Trail Test Hardening

Current: 25 src files, 7 tests. Target: 25 src, ≥20 tests.

**Create tests for**:
- `debug-trail/src/integrations/` — test each integration adapter
- `debug-trail/src/policies/` — test each policy evaluation path
- `debug-trail/src/state/` — test state transitions, persistence, recovery
- Integration test: full trace from agent action → debug trail → query → reconstruct

**Files to create**: ≥13 new test files in `packages/debug-trail/tests/`

### Wave 1 Verification
```bash
pnpm build && pnpm test && pnpm typecheck
node scripts/release-check.mjs     # All 10 checks pass
node scripts/anti-stub-scan.mjs    # Zero violations
node scripts/cli-smoke.mjs         # All 17 commands respond
```

**Score Impact**: Ship Readiness 6.0 → 9.0 (+3.0), Debug Trail 6.0 → 9.0 (+3.0). Total: +6.0 points.

---

## 3. Wave 2 — Test Debt (Security 6.5 → 9.0, Code Intel 6.5 → 9.0)

### 3.1 Security Hardening

Current: `security-engine.ts`, `secrets-scanner.ts`, `credential-vault.ts`, `policy-enforcer.ts`, `rails-enforcer.ts` + `dante-sandbox` (14 src, 5 tests).

**Test gaps to close**:

`dante-sandbox` (14 src → needs ≥12 tests total, currently 5):
- Isolation boundary tests: verify sandbox cannot access host filesystem
- Resource limit tests: verify CPU/memory/time limits enforced
- Escape attempt tests: verify known sandbox escape patterns are blocked
- Cleanup tests: verify sandbox resources released after execution
- Concurrent sandbox tests: verify multiple sandboxes don't interfere

`core` security modules (add ≥8 tests):
- `secrets-scanner.ts`: test detection of API keys, passwords, tokens in source
- `credential-vault.ts`: test encryption, decryption, key rotation, vault corruption recovery
- `policy-enforcer.ts`: test allow/deny/escalate paths, policy conflict resolution
- `rails-enforcer.ts`: test guardrail enforcement for prompt injection, data exfiltration
- Integration test: full security pipeline (scan → enforce → vault → audit)

**Create `packages/dante-sandbox/tests/escape-patterns.test.ts`**:
- Test against known container escape vectors
- Test path traversal (`../../../etc/passwd`)
- Test environment variable leakage
- Test network access restrictions

### 3.2 Code Intelligence Hardening

Current: `code-index.ts`, `repo-map-ast.ts`, `entity-extractor.ts`, `fim-engine.ts`, `patch-validator.ts`, `reasoning-chain.ts`. Tests needed.

**Create tests**:
- `code-index.test.ts`: index a sample repo, verify file discovery, symbol extraction
- `repo-map-ast.test.ts`: parse TypeScript, JavaScript, Python ASTs; verify function/class/import extraction
- `entity-extractor.test.ts`: extract named entities from code context
- `fim-engine.test.ts`: fill-in-the-middle completion with prefix/suffix boundary conditions
- `patch-validator.test.ts`: validate well-formed patches, reject malformed ones, detect conflicts
- `reasoning-chain.test.ts`: verify chain-of-thought recording, step extraction, evidence linking
- Integration test: index repo → extract entities → generate patch → validate patch

**Create `packages/core/src/__tests__/code-intelligence-e2e.test.ts`**: End-to-end test using a fixture repo.

**Score Impact**: Security 6.5 → 9.0 (+2.5), Code Intelligence 6.5 → 9.0 (+2.5). Total: +5.0 points.

---

## 4. Wave 3 — Feature Gap Closure: Memory, Search, Git (7.0 → 9.0 each)

### 4.1 Memory System (7.0 → 9.0)

Current: 9 memory-related files. Gap: fragmented architecture, no consolidation pipeline, no memory quality scoring.

**Add `packages/core/src/memory-consolidator.ts`**:
- Scheduled consolidation: merge duplicate/overlapping memories
- Quality scoring: each memory gets a relevance score (recency × frequency × impact)
- Eviction policy: lowest-scoring memories evicted at 80% capacity
- Constitutional gate: memories pass through PDSE before persisting (no hallucinated memories)

**Add `packages/core/src/memory-quality-scorer.ts`**:
- Score dimensions: relevance (0-25), freshness (0-25), accuracy (0-25), utility (0-25)
- Memories scoring <40 are candidates for eviction
- Memories scoring >80 are promoted to long-term

**Tests** (≥8 new):
- Consolidation merges correctly
- Quality scoring is deterministic
- Eviction respects capacity limits
- Constitutional gate rejects low-quality memories
- Integration: store → retrieve → consolidate → evict lifecycle

### 4.2 Search & Research (7.0 → 9.0)

Current: Full pipeline (fetch → extract → rerank → synthesize → cache). Gap: source quality scoring, freshness tracking, citation verification.

**Add `packages/core/src/search-quality-scorer.ts`**:
- Score each search result: source authority (0-25), freshness (0-25), relevance (0-25), citation density (0-25)
- Filter results scoring <30 before synthesis
- Weight synthesis toward highest-scoring sources

**Add `packages/core/src/search-freshness-tracker.ts`**:
- Track when each cached result was fetched
- Stale cache eviction (configurable TTL, default 24h for news, 7d for documentation)
- Force-refresh option for time-sensitive queries

**Tests** (≥6 new):
- Quality scoring ranks authoritative sources higher
- Stale cache evicted correctly
- Synthesis weights toward quality sources
- Cache hit/miss ratios tracked correctly

### 4.3 Git Integration (7.0 → 9.0)

Current: Git operations, GitHub API, issue→PR, snapshot recovery, worktree observation. Gap: conflict resolution intelligence, PR review quality, branch strategy.

**Add `packages/core/src/git-conflict-resolver.ts`**:
- Detect merge conflicts in worktree merges
- Classify conflict type: semantic (logic divergence) vs. textual (same-line edit)
- For textual conflicts: attempt auto-resolution using AST-aware merge
- For semantic conflicts: flag for human review with diff context
- Evidence trail: log all conflict resolutions with before/after

**Add `packages/core/src/pr-quality-checker.ts`**:
- Before creating PR: verify all tests pass in branch
- Check PR size (warn >500 lines changed)
- Check for anti-stub violations in diff
- Verify commit messages follow convention
- Score PR readiness (0-100), block if <70

**Tests** (≥6 new):
- Conflict detection accuracy
- Auto-resolution produces valid code
- PR quality checker catches known issues
- Integration: branch → modify → conflict → resolve → PR → quality check

**Score Impact**: Memory 7.0 → 9.0 (+2.0), Search 7.0 → 9.0 (+2.0), Git 7.0 → 9.0 (+2.0). Total: +6.0 points.

---

## 5. Wave 4 — Feature Gap Closure: Skillbook, Evidence, Self-Update (7.0 → 9.0 each)

### 5.1 Skillbook / Learning (7.0 → 9.0)

Gap: skill quality scoring, skill versioning, skill dependency tracking.

**Add `packages/dante-skillbook/src/skill-quality-scorer.ts`**:
- Score each skill: test coverage (0-25), usage frequency (0-25), success rate (0-25), documentation completeness (0-25)
- Skills scoring <50 flagged for improvement
- Skills scoring >90 promoted to "proven" tier

**Add `packages/dante-skillbook/src/skill-version-manager.ts`**:
- Semantic versioning for skills (major.minor.patch)
- Breaking change detection: if skill interface changes, bump major
- Rollback capability: revert to previous skill version if new version regresses

**Tests** (≥6 new):
- Quality scoring is deterministic
- Version bumping follows semver rules
- Rollback restores previous behavior
- Fearset → skillbook pipeline produces valid lessons

### 5.2 Evidence Chain (7.0 → 9.0)

Gap: chain verification, tamper detection, export formats.

**Add `packages/evidence-chain/src/chain-verifier.ts`**:
- Verify entire chain from genesis to head: every hash links to previous
- Detect gaps (missing entries)
- Detect tampering (hash mismatch)
- Return verification report with chain length, integrity status, first-failure-point

**Add `packages/evidence-chain/src/chain-exporter.ts`**:
- Export chain to JSON (human-readable timeline)
- Export chain to JSONL (machine-processable)
- Export chain to Markdown (audit report format)
- Include verification signature in export header

**Tests** (≥6 new):
- Verification detects tampering
- Verification detects gaps
- Export formats are valid and parseable
- Round-trip: export → import → verify passes

### 5.3 Self-Update (7.0 → 9.0)

Gap: rollback capability, migration validation, update integrity.

**Add `packages/core/src/update-rollback.ts`**:
- Before update: snapshot current state (version, config, installed packages)
- After update: run health check
- If health check fails: automatic rollback to snapshot
- Rollback log in evidence chain

**Add `packages/core/src/migration-validator.ts`**:
- Before running migration: dry-run to detect issues
- Validate schema compatibility
- Check for data loss risks
- Require explicit confirmation for destructive migrations

**Tests** (≥4 new):
- Rollback restores previous version
- Migration validator catches schema incompatibilities
- Health check detects broken updates
- Evidence chain records update/rollback

**Score Impact**: Skillbook 7.0 → 9.0 (+2.0), Evidence 7.0 → 9.0 (+2.0), Self-Update 7.0 → 9.0 (+2.0). Total: +6.0 points.

---

## 6. Wave 5 — Polish: Dimensions Already ≥ 7.5

### 6.1 Multi-Model Support (8.0 → 9.0)

Gap: runtime model switching based on task complexity.

**Add `packages/core/src/task-complexity-router.ts`**:
- Classify incoming task: `simple` (<15 complexity) → Haiku/cheapest, `standard` (15-45) → Sonnet/mid-tier, `complex` (>45) → Opus/strongest
- Complexity signals: token count, file count, reasoning depth required, security sensitivity
- Log routing decisions to evidence chain
- Allow per-task model override via config

**Tests** (≥4 new): Classification accuracy, routing decisions, override behavior, cost estimation.

### 6.2 Council of Minds (8.5 → 9.0)

Gap: minor polish — error recovery, stale agent detection, council timeout.

**Add to `packages/core/src/council/council-resilience.ts`**:
- Stale agent detection: if agent hasn't produced output in N minutes, mark as stalled
- Council timeout: if entire council run exceeds max duration, graceful shutdown
- Error recovery: if one agent fails, redistribute its tasks to others (already have `TaskRedistributor` — wire it to failure events)

**Tests** (≥4 new): Stale detection, timeout behavior, redistribution after failure, recovery from partial completion.

### 6.3 Verification Engine (8.0 → 9.0)

Gap: benchmark tracking over time, verification performance regression detection.

**Add `packages/core/src/verification-trend-tracker.ts`**:
- Track verification scores over time per category
- Detect verification score regressions (alert if category drops >5 points from 7-day average)
- Generate verification health report (which categories improving, which degrading)

**Tests** (≥3 new): Trend detection, regression alerting, report generation.

### 6.4 CLI Surface (7.5 → 9.0)

Gap: grouped help, first-run detection, command documentation.

**Add `packages/cli/src/help-system.ts`**:
- Group commands into categories: Core (chat, run, agent), Development (council, automate, research, review, triage), Security (gaslight, vault, audit), Config (init, config, self-update, skills, skillbook, serve), Git (git, fearset)
- First-run detection: if no `.dantecode/` directory, suggest `dantecode init`
- Context-aware help: show relevant commands based on project state

**Add `packages/cli/src/command-docs-generator.ts`**:
- Auto-generate command reference from command registry
- Include usage examples, flags, sub-commands
- Output to `docs/COMMAND_REFERENCE.md`

**Tests** (≥4 new): Help grouping, first-run detection, docs generation, context-aware suggestions.

### 6.5 Agent Loop / Execution (7.5 → 9.0)

Gap: resilience testing, recovery from mid-execution crashes.

**Add `packages/core/src/durable-execution.ts`**:
- Checkpoint agent state every N steps (configurable, default 5)
- On crash recovery: detect last checkpoint, resume from it
- Checkpoint includes: current task, partial output, memory state, tool call history
- Evidence chain: log checkpoint creation and recovery events

**Tests** (≥5 new): Checkpoint creation, crash simulation, recovery from checkpoint, partial output handling, checkpoint cleanup.

### 6.6 Gaslight / Adversarial Testing (7.5 → 9.0)

Gap: more attack patterns, adversarial coverage metrics.

**Add `packages/dante-gaslight/src/attack-patterns.ts`**:
- Expand attack library: prompt injection attempts, hallucination triggers, reasoning traps, consistency challenges, edge case generators
- Each pattern has: name, category, severity, expected-failure-mode
- Coverage metric: percentage of attack categories tested per session

**Add `packages/dante-gaslight/src/gaslight-report.ts`**:
- Generate adversarial testing report: attacks attempted, failures found, lessons extracted
- Score agent resilience (0-100)
- Track resilience trend over time

**Tests** (≥4 new): Attack pattern application, coverage calculation, report generation, resilience scoring.

**Score Impact**: Multi-Model +1.0, Council +0.5, Verification +1.0, CLI +1.5, Agent Loop +1.5, Gaslight +1.5. Total: +7.0 points.

---

## 7. Wave 6 — Integration Testing & Final Gate

### 7.1 End-to-End Integration Tests

**Create `packages/core/src/__tests__/e2e/`**:

- `full-pipeline.test.ts`: init → configure → run task → verify → evidence chain → audit log
- `council-lifecycle.test.ts`: spawn council → assign lanes → detect overlap → merge → verify → complete
- `gaslight-to-skillbook.test.ts`: gaslight session → find weakness → distill lesson → write to skillbook → verify skill
- `budget-enforcement.test.ts`: set budget → run tasks → approach limit → warning → hit limit → bankruptcy halt
- `crash-recovery.test.ts`: start task → simulate crash → recover from checkpoint → complete task

### 7.2 DanteForge Bridge Verification

**Create `packages/core/src/__tests__/danteforge-bridge.test.ts`**:
- Verify `danteforge-pipeline.ts` correctly calls PDSE scoring
- Verify scoring threshold enforcement (reject <85, accept ≥85)
- Verify evidence chain receipt emitted on score
- Verify audit log entry on score

### 7.3 Final Release Gate

Run the complete verification suite:
```bash
pnpm build                          # All packages build
pnpm test                           # All tests pass
pnpm typecheck                      # Zero type errors
node scripts/release-check.mjs      # All 10 checks pass
node scripts/anti-stub-scan.mjs     # Zero violations
node scripts/cli-smoke.mjs          # All commands respond
```

**Score Impact**: Confirms all dimensions at 9.0+.

---

## 8. File Manifest

### New Files (42)

| Wave | File | Purpose |
|------|------|---------|
| 1 | `scripts/release-check.mjs` | 10-point release gate |
| 1 | `scripts/anti-stub-scan.mjs` | Anti-stub enforcement |
| 1 | `scripts/cli-smoke.mjs` | CLI smoke test |
| 1 | `packages/debug-trail/tests/*.test.ts` (×13) | Debug trail test coverage |
| 2 | `packages/dante-sandbox/tests/escape-patterns.test.ts` | Sandbox escape testing |
| 2 | `packages/dante-sandbox/tests/*.test.ts` (×6) | Sandbox test coverage |
| 2 | `packages/core/src/__tests__/security-*.test.ts` (×5) | Security module tests |
| 2 | `packages/core/src/__tests__/code-intel-*.test.ts` (×7) | Code intelligence tests |
| 3 | `packages/core/src/memory-consolidator.ts` | Memory consolidation pipeline |
| 3 | `packages/core/src/memory-quality-scorer.ts` | Memory quality scoring |
| 3 | `packages/core/src/search-quality-scorer.ts` | Search result quality scoring |
| 3 | `packages/core/src/search-freshness-tracker.ts` | Cache freshness tracking |
| 3 | `packages/core/src/git-conflict-resolver.ts` | Intelligent conflict resolution |
| 3 | `packages/core/src/pr-quality-checker.ts` | PR readiness scoring |
| 3 | Tests for Wave 3 (×20) | Memory, search, git tests |
| 4 | `packages/dante-skillbook/src/skill-quality-scorer.ts` | Skill quality scoring |
| 4 | `packages/dante-skillbook/src/skill-version-manager.ts` | Skill versioning + rollback |
| 4 | `packages/evidence-chain/src/chain-verifier.ts` | Chain integrity verification |
| 4 | `packages/evidence-chain/src/chain-exporter.ts` | Multi-format export |
| 4 | `packages/core/src/update-rollback.ts` | Update rollback mechanism |
| 4 | `packages/core/src/migration-validator.ts` | Migration dry-run validation |
| 4 | Tests for Wave 4 (×16) | Skillbook, evidence, update tests |
| 5 | `packages/core/src/task-complexity-router.ts` | Complexity-based model routing |
| 5 | `packages/core/src/council/council-resilience.ts` | Stale detection, timeout, recovery |
| 5 | `packages/core/src/verification-trend-tracker.ts` | Verification regression detection |
| 5 | `packages/cli/src/help-system.ts` | Grouped help + first-run detection |
| 5 | `packages/cli/src/command-docs-generator.ts` | Auto-generated command reference |
| 5 | `packages/core/src/durable-execution.ts` | Checkpoint + crash recovery |
| 5 | `packages/dante-gaslight/src/attack-patterns.ts` | Expanded adversarial library |
| 5 | `packages/dante-gaslight/src/gaslight-report.ts` | Adversarial testing report |
| 5 | Tests for Wave 5 (×24) | Polish dimension tests |
| 6 | `packages/core/src/__tests__/e2e/*.test.ts` (×5) | End-to-end integration |
| 6 | `packages/core/src/__tests__/danteforge-bridge.test.ts` | DanteForge bridge verification |

### Summary

| Metric | Before | After |
|--------|--------|-------|
| Source files | 291 | ~310 (+19 new modules) |
| Test files | 199 | ~313 (+114 new tests) |
| Average score | 6.9 | 9.0 (target) |
| Release gates | 0 | 10 automated checks |
| Anti-stub enforcement | None | Automated scan |
| Dimensions ≥ 9.0 | 0 | 16 of 16 active |

---

## 9. Wave Execution Order

| Wave | Focus | Effort | Score Gain | Running Average |
|------|-------|--------|------------|-----------------|
| Wave 1 | Ship Infrastructure + Debug Trail | 4-6 hours | +6.0 | 7.3 |
| Wave 2 | Security + Code Intel tests | 4-6 hours | +5.0 | 7.6 |
| Wave 3 | Memory + Search + Git features | 6-8 hours | +6.0 | 8.0 |
| Wave 4 | Skillbook + Evidence + Self-Update | 4-6 hours | +6.0 | 8.4 |
| Wave 5 | Polish all ≥7.5 dimensions | 6-8 hours | +7.0 | 8.8 |
| Wave 6 | Integration tests + final gate | 3-4 hours | +0.5 (confirms) | 9.0 |
| **Total** | | **~28-38 hours** | **+30.5** | **9.0** |

Each wave is independently verifiable via `pnpm build && pnpm test && pnpm typecheck`.

---

*End of DanteCode Masterplan PRD. Implementation-ready for Claude Code.*
