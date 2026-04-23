# DanteCode Gap Execution Board

Updated: 2026-04-20  
Status legend: `shipped`, `in_progress`, `needs_proof`, `infra_ceiling`

## 28-Dimension Board

| # | Dimension | Current | Target | Status | Next move | Evidence / blocker |
|---|---|:---:|:---:|---|---|---|
| 1 | Ghost text / inline completions | 6 | 8 | in_progress | Measure latency and acceptance; reduce noisy completions | No hard data yet |
| 2 | LSP / diagnostics injection | 8 | 9 | in_progress | Add richer diagnostic and symbol context injection | Good base already exists |
| 3 | Semantic codebase search | 7 | 8 | in_progress | Add retrieval quality evals and stronger graph context | Needs benchmarked retrieval quality |
| 4 | Repo-level context | 7 | 8 | in_progress | Add symbol graph and runtime/debug trace retrieval | Still missing richer graph proof |
| 5 | SWE-bench / correctness | 5 | 8 | needs_proof | Run small benchmark tranche, cluster failures, store results | No published benchmark yet |
| 6 | Inline edit UX | 8 | 9 | in_progress | Add stronger diff streaming and invocation polish | Good but not frontier |
| 7 | Multi-file diff + review | 8 | 9 | in_progress | Improve issue surfacing and file risk summaries | Strong base exists |
| 8 | Git-native workflow | 8 | 9 | in_progress | Keep improving auto-commit and conflict UX | Strong base exists |
| 9 | Screenshot -> code | 2 | 3 | infra_ceiling | Defer until vision-specific work is justified | Needs vision stack |
| 10 | Full-app generation | 8 | 9 | shipped | Extend incremental verify from stop-on-fail to repair loop | New user-facing verify gate shipped |
| 11 | Chat UX polish | 7 | 8 | in_progress | Add context pills, clearer result summaries, stronger rendering | Slash commands alone are not enough |
| 12 | @mention / context injection | 8 | 9 | in_progress | Finish URL/image/git-ref injection | Good but not complete |
| 13 | Approval workflow | 8 | 9 | in_progress | Add richer batch review / rollback UX | Strong, but polish remains |
| 14 | Browser live preview | 2 | 3 | infra_ceiling | Defer until sandbox preview exists | Needs preview infra |
| 15 | Agent / autonomous mode | 7 | 8 | in_progress | Integrate `AutonomyOrchestrator` into the main agent loop | Helper exists; main path still incomplete |
| 16 | Plan/Act control | 8 | 9 | in_progress | Improve step progress surfacing and rollback UX | Good foundation |
| 17 | Browser / computer use | 8 | 9 | shipped | Add more action-state observation and task memory | DOM + a11y + screenshot context shipped |
| 18 | PR review surfaced in IDE | 8 | 9 | shipped | Add richer inline issue surfacing from review result | Real GitHub-backed review path shipped |
| 19 | Test runner integration | 8 | 9 | in_progress | Improve watch-mode and jump-to-failure UX | Strong but not premium |
| 20 | Debug / runtime context | 7 | 8 | in_progress | Keep improving runtime prompt injection | Helpful, still not elite |
| 21 | Session memory | 7 | 8 | in_progress | Add deduping, ranking, preference retention | Current recall is useful but not premium |
| 22 | Skill / plugin system | 8 | 9 | in_progress | Add stronger discovery and install UX | Ecosystem maturity gap |
| 23 | Security / sandboxing | 9 | 9 | shipped | Hold the line | Current moat |
| 24 | Reliability / rollback | 8 | 9 | in_progress | Improve visible resume/restore UX | Good, not yet `9` |
| 25 | MCP / tool ecosystem | 8 | 9 | in_progress | Add tool health and latency surfacing | Breadth is strong, polish remains |
| 26 | Local model routing | 9 | 9 | shipped | Hold the line | Current moat |
| 27 | Cost optimization | 9 | 9 | shipped | Hold the line | Current moat |
| 28 | Enterprise | 3 | 5 | infra_ceiling | Defer | Needs backend and org features |

## Wave 1 Delivered

- Real PR review path shared between CLI and VS Code
- Diff evidence now included in PR review prompt output
- Diff-derived annotations now feed review comments
- `generate` now performs incremental verification during file generation
- `generate` now stops early when incremental verification fails
- `browse` now captures DOM text, interactive elements, accessibility tree, and screenshot context
- New matrix package written with stricter score guardrails

## Next Highest-Yield Moves

1. Integrate `AutonomyOrchestrator` into the main agent loop so verify output drives the next wave through a real shared path.
2. Run a real SWE-bench tranche and commit the results as evidence.
3. Add retrieval quality benchmarks for semantic search and repo context.
4. Improve session memory ranking and visible recall quality.
5. Tighten chat UX so the main surface feels premium rather than just feature-complete.

## Evidence Pointers

- PR review runner: `packages/core/src/pr-review-runner.ts`
- IDE PR review wiring: `packages/vscode/src/sidebar-provider.ts`
- Browser context capture: `packages/core/src/browser-agent.ts`
- Browser prompt wiring: `packages/cli/src/commands/browse.ts`
- Incremental generation verification: `packages/cli/src/commands/generate.ts`
