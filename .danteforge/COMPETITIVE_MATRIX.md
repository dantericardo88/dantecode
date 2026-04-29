# DanteCode Competitive Matrix
_Updated: 2026-04-29 | Harsh double competitive matrix | Target: 9.0 across 50 dimensions_

This matrix is intentionally unforgiving. A feature earns a high score only when
it works on the main path, is visible to a user, survives real verification, and
has evidence that would convince a skeptical outsider.

## Executive Score

| Metric | Value |
|---|---:|
| DanteCode current harsh score | 303.2 / 500 |
| DanteCode current average | 6.06 / 10 |
| Target for "9s across the board" | 450 / 500 |
| Remaining lift to target | 146.8 dimension-points |
| Matrix dimensions | 50 |
| Machine-readable matrix | `.danteforge/compete/matrix.json` |
| Machine-readable rubric | `.danteforge/rubric.json` |

Important caveat: the repo-level matrix and rubric are now 50-dimensional, and
`danteforge frontier-gap` reads all 50 dimensions. The installed global
`danteforge score` implementation still reports its older bundled dimension set
until the scorer itself is rewired to consume this rubric.

## Scoring Rule

| Score | Meaning |
|---:|---|
| 9 | Frontier or near-frontier behavior, user-visible, main-path, benchmarked or end-to-end verified, with no known release-blocking local gate failures. |
| 7 | Credible product capability with tests and smoke proof, but weaker polish, breadth, scale, or external evidence than the frontier. |
| 5 | Partial capability exists, but proof is narrow, mocked, fragile, or not consistently surfaced in the shipped workflow. |
| 3 | Prototype, scaffold, or internal-only capability with little credible user-facing proof. |
| 1 | Missing, misleading, or non-functional. |

## Peer Set

Closed-source and source-available peers tracked: Cursor, GitHub Copilot,
Claude Code, OpenAI Codex, Windsurf, Devin, Replit Agent, Google Antigravity,
Augment Code, Amazon Q Developer, Tabnine, Sourcegraph Cody, Bolt.new, v0,
Base44, and JetBrains AI / Junie.

OSS and adjacent OSS teachers tracked: OpenHands, Cline, Aider, Continue,
Kilo Code, Roo Code, OpenCode, Tabby, Void, SWE-agent, Plandex, Browser Use,
LangGraph, CrewAI, axe-core, OpenTelemetry, LiteLLM, Semgrep, Nx, Docusaurus,
OpenFGA, Presidio, and DSPy.

These peer scores are planning estimates, not public benchmark claims. They are
used to decide what to learn next and where DanteCode is behind.

## Provisional Peer Ranking

| Rank | Tool | Class | Planning score | Why it matters |
|---:|---|---|---:|---|
| 1 | Cursor | Closed | 8.9 | Best editor-native polish, inline edits, completion feel, and trust UX. |
| 2 | GitHub Copilot | Closed | 8.6 | Strong enterprise posture, PR workflow, IDE breadth, and GitHub-native agent loop. |
| 3 | OpenAI Codex | Closed | 8.5 | Strong cloud/local agent story, sandboxed task execution, benchmark orientation, and model quality. |
| 4 | Claude Code | Closed | 8.4 | Strong terminal agent UX, memory, subagents, MCP, and developer workflow depth. |
| 5 | Devin | Closed | 8.0 | Long-running autonomous task execution, machine setup, review, and session management. |
| 6 | Windsurf | Closed | 7.9 | Strong code-agent/editor convergence and Cascade-style workflow. |
| 7 | Replit Agent | Closed | 7.5 | Strong full-app generation, preview, deploy, and beginner time-to-value. |
| 8 | Augment Code | Closed | 7.4 | Strong large-repo semantic context and enterprise codebase understanding. |
| 9 | OpenHands | OSS | 7.3 | Best OSS teacher for autonomous agent execution, web/terminal use, and SWE-bench-style proof. |
| 10 | Cline | OSS | 7.1 | Best OSS teacher for VS Code permissioned autonomy, browser use, and human-in-loop control. |
| 11 | Aider | OSS | 7.0 | Best OSS teacher for git-native terminal editing, repo map, and disciplined diffs. |
| 12 | Continue | OSS | 7.0 | Best OSS teacher for model/provider portability, IDE assistant architecture, and context configuration. |
| 13 | Kilo Code / Roo Code | OSS | 6.8 | Fast OSS iteration around agent modes, sessions, reviews, and IDE workflows. |
| 14 | DanteCode | Local | 6.1 | Strong foundation and verification culture, now materially stronger on accessibility, regression gates, and benchmark transparency, but still weak on SWE-bench correctness, UX polish, breadth, and enterprise posture. |

## Full 50-Dimension Matrix

| ID | Dimension | Category | DanteCode | Closed-source frontier | OSS teacher | Gap to 9 | Proof required for 9 |
|---|---|---|---:|---|---|---:|---|
| ghost_text_inline_completions | Ghost text / inline completions | editor | 5.5 | Cursor 9.5 | Tabby 8.5 | 3.5 | Measure p95 latency, acceptance rate, cancellation, stale suggestion rate, and multi-line FIM quality against a real repo workload. |
| lsp_diagnostics_injection | LSP / diagnostics injection | context | 6.0 | JetBrains AI/Junie 9.0 | Continue 8.0 | 3.0 | Inject diagnostics, hovers, symbols, definitions, and problem-panel context into live repairs with IDE smoke tests. |
| semantic_codebase_search | Semantic codebase search | context | 5.5 | Augment Code 9.5 | Continue 8.0 | 3.5 | Run a relevance benchmark on large repos and prove search improves repair completion, not just retrieval scores. |
| repo_level_context | Repo-level context | context | 5.7 | Augment Code 9.5 | Aider 8.0 | 3.3 | Combine symbol graph, import graph, runtime evidence, and cited snippets in flagship workflows. |
| swe_bench_correctness | SWE-bench / correctness | evaluation | 3.5 | OpenAI Codex 9.0 | OpenHands 8.5 | 5.5 | Publish reproducible SWE-bench or equivalent results with DanteForge on/off A/B and raw traces. |
| inline_edit_ux | Inline edit UX | editor | 5.8 | Cursor 9.5 | Void 7.5 | 3.2 | Support streaming edits, partial accept, hunk steering, rollback, and measured edit acceptance. |
| multi_file_diff_review | Multi-file diff + review | workflow | 6.4 | Cursor 9.0 | Aider 7.5 | 2.6 | Risk-rank diffs, suppress false positives, correlate comments with later fixes, and expose review proof in IDE. |
| git_native_workflow | Git-native workflow | workflow | 7.2 | GitHub Copilot 9.0 | Aider 9.0 | 1.8 | Complete branch, commit, PR, conflict, rollback, and issue-to-PR flow under e2e tests. |
| screenshot_to_code | Screenshot -> code | multimodal | 4.0 | v0 9.0 | screenshot-to-code 8.0 | 5.0 | Add visual-diff refinement, responsive preview, and acceptance tests on realistic UI screenshots. |
| full_app_generation | Full-app generation | generation | 5.8 | Replit Agent 8.5 | OpenHands 7.0 | 3.2 | Generate, run, inspect, repair, and ship realistic apps with tests and deployment proof. |
| chat_ux_polish | Chat UX polish | ux | 5.4 | Cursor 9.5 | Cline 7.0 | 3.6 | Build premium transcript, context pills, proof cards, image handling, and no-dead-end command states. |
| mention_context_injection | @mention / context injection | context | 5.8 | Claude Code 9.0 | Continue 8.0 | 3.2 | Support files, symbols, folders, docs, URLs, git refs, terminal, problems, and debugger context with citations. |
| approval_workflow | Approval workflow | safety | 6.5 | Claude Code 8.5 | Cline 8.0 | 2.5 | Give per-tool, per-command, per-hunk approvals with rollback and policy explanations. |
| browser_live_preview | Browser live preview | runtime | 4.0 | Replit Agent 9.0 | OpenHands 7.0 | 5.0 | Run apps in a managed preview, inspect DOM/screenshots, hot-reload, and repair from preview failures. |
| agent_autonomous_mode | Agent / autonomous mode | autonomy | 6.4 | Devin 9.0 | OpenHands 8.5 | 2.6 | Complete long-running tasks with planning, tool use, self-healing, stop conditions, and reviewable evidence. |
| plan_act_control | Plan/Act control | autonomy | 6.5 | Devin 8.5 | Plandex 8.0 | 2.5 | Expose editable plan steps, dependencies, progress, rollback, and proof per step. |
| browser_computer_use | Browser / computer use | runtime | 5.2 | OpenAI Codex 9.0 | Browser Use 8.0 | 3.8 | Use browser observations and actions to research docs, verify apps, and repair UI workflows. |
| pr_review_in_ide | PR review surfaced in IDE | review | 5.5 | GitHub Copilot 9.0 | Continue 7.5 | 3.5 | Surface high-signal severity-ranked PR comments in IDE and verify fixes through status checks. |
| test_runner_integration | Test runner integration | quality | 7.0 | OpenAI Codex 8.5 | OpenHands 7.5 | 2.0 | Connect watch-mode failures, inline diagnostics, repair prompts, and passing proof across CLI and IDE. |
| debug_runtime_context | Debug / runtime context | runtime | 6.2 | JetBrains AI/Junie 9.0 | Continue 6.5 | 2.8 | Inject stack frames, watches, locals, failing requests, and logs into repair loops. |
| session_memory | Session memory | learning | 6.8 | Claude Code 8.5 | Continue 6.5 | 2.2 | Prove memory changes later success rates and include freshness, source, and removal controls. |
| skill_plugin_system | Skill / plugin system | ecosystem | 7.2 | Claude Code 9.0 | Continue 8.0 | 1.8 | Make skills discoverable, versioned, policy-gated, testable, and easy to publish. |
| security_sandboxing | Security / sandboxing | safety | 6.8 | GitHub Copilot 9.0 | OpenHands 8.0 | 2.2 | Enforce sandbox execution in main paths, secret scanning, policy gates, audit logs, and prompt-injection defenses. |
| reliability_rollback | Reliability / rollback | reliability | 6.4 | Cursor 8.5 | Cline 8.5 | 2.6 | Provide checkpoint restore, safe resume, circuit breakers, loop detection, and failure-mode tests. |
| mcp_tool_ecosystem | MCP / tool ecosystem | ecosystem | 6.7 | Claude Code 9.0 | Cline 8.0 | 2.3 | Support dynamic discovery, schema validation, approval, logs, marketplace docs, and real third-party servers. |
| local_model_routing | Local model routing | models | 7.5 | Cursor 7.0 | Aider 9.0 | 1.5 | Route by task, quality, cost, privacy, offline availability, and provider health with real failure tests. |
| cost_optimization | Cost optimization | models | 6.8 | OpenAI Codex 7.0 | Aider 8.5 | 2.2 | Track cost per successful task, budget stops, prompt caching, model fallback savings, and user-visible spend. |
| enterprise_readiness | Enterprise | enterprise | 3.5 | GitHub Copilot 9.0 | OpenFGA 8.0 | 5.5 | Implement SSO, RBAC, org model, audit export, admin policies, retention controls, and enterprise docs. |
| eval_infrastructure_quality | Eval infrastructure quality | evaluation | 5.5 | OpenAI Codex 9.0 | SWE-agent 8.5 | 3.5 | Create reproducible evals, fixtures, traces, dashboards, regression gates, and score deltas. |
| ux_trust_explainability | UX trust / explainability | ux | 5.8 | Cursor 8.5 | Cline 7.5 | 3.2 | Show why the agent acted, what evidence it used, what risk remains, and how to steer or undo. |
| context_governance | Context governance | context | 5.5 | GitHub Copilot 8.5 | Continue 7.5 | 3.5 | Cite context, scope it, expire it, dedupe it, let users inspect it, and measure context usefulness. |
| human_agent_collaboration | Human-agent collaboration | collaboration | 5.2 | Cursor 9.0 | Cline 8.0 | 3.8 | Allow interruption, steering, shared editing, task handoff, pause/resume, and multi-agent visibility. |
| task_decomposition_quality | Task decomposition quality | planning | 6.2 | Devin 9.0 | OpenHands 8.0 | 2.8 | Turn vague tasks into dependency-aware, verifiable subtasks and prove completion quality. |
| regression_prevention | Regression prevention | quality | 9.0 | Cursor 9.0 | Semgrep 8.0 | 0.0 | Score-claim gate passed with green typecheck, lint, test, coverage, and frontier-gap evidence, zero blocking failures, and zero waiver errors. |
| onboarding_time_to_value | Onboarding / time-to-value | adoption | 4.5 | Cursor 9.0 | Continue 7.0 | 4.5 | Prove first successful task in under 10 minutes on a fresh machine and fresh repo. |
| ecosystem_portability | Ecosystem portability | ecosystem | 6.5 | OpenAI Codex 8.0 | Continue 8.5 | 2.5 | Run consistently across CLI, VS Code, CI, local/cloud models, MCP, and hosted workflows. |
| model_quality_adaptation | Model quality adaptation | models | 6.4 | OpenAI Codex 9.0 | LiteLLM 8.5 | 2.6 | Adapt model, prompt, budget, and retry policy by task type, failures, and measured outcomes. |
| latency_responsiveness | Latency / responsiveness | performance | 5.2 | Cursor 9.5 | Tabby 8.0 | 3.8 | Set and enforce p50/p95 latency SLOs for chat, tools, FIM, indexing, preview, and apply. |
| observability_telemetry | Observability / telemetry | operations | 7.0 | OpenAI Codex 8.5 | OpenTelemetry 9.0 | 2.0 | Trace cost, latency, model choice, tool calls, failures, evals, and score movement in one dashboard. |
| configuration_ergonomics | Configuration ergonomics | dx | 4.8 | Cursor 9.0 | Continue 8.0 | 4.2 | Make provider, model, policy, tools, memory, and workspace setup guided, validated, and recoverable. |
| offline_degraded_mode | Offline / degraded-mode behavior | reliability | 6.8 | Tabnine 8.5 | Tabby 9.0 | 2.2 | Keep useful behavior when providers, network, index, credentials, and tools fail. |
| data_privacy_controls | Data/privacy controls | safety | 6.2 | GitHub Copilot 9.0 | Presidio 8.5 | 2.8 | Add redaction, retention controls, telemetry opt-out, local-only mode, and admin-enforced privacy policy. |
| documentation_quality | Documentation quality | adoption | 6.4 | OpenAI Codex 9.0 | Docusaurus 8.0 | 2.6 | Ship public docs with quickstart, recipes, troubleshooting, API docs, architecture, and migration guides. |
| extensibility_developer_experience | Extensibility developer experience | ecosystem | 6.5 | Claude Code 9.0 | Continue 8.0 | 2.5 | Give extension authors templates, tests, manifests, local dev server, validation, docs, and publish path. |
| benchmark_transparency | Benchmark transparency | evaluation | 9.0 | OpenAI Codex 9.0 | SWE-agent 9.0 | 0.0 | Verified local proof: `dantecode bench transparency --suite builtin --seed 45 --output-dir benchmarks/transparency --evidence --format json` produced command, seed, dataset hash, raw report, markdown report, selected instances, per-instance logs, trace refs, checksums, score history, limitations, and Dim45 evidence. |
| multi_repo_monorepo_scale | Multi-repo / monorepo scale | scale | 5.5 | Sourcegraph Cody 9.5 | Nx 8.0 | 3.5 | Handle huge repos, workspace graphs, dependency boundaries, and cross-repo changes with measured retrieval quality. |
| language_framework_breadth | Language/framework breadth | scale | 4.8 | GitHub Copilot 9.0 | Aider 8.0 | 4.2 | Prove useful repair and generation across TypeScript, Python, Go, Java, Rust, C#, PHP, and common frameworks. |
| accessibility_inclusive_ux | Accessibility / inclusive UX | ux | 9.0 | GitHub Copilot 8.0 | axe-core 9.0 | 0.0 | Shared gate, CLI audit, VS Code webview hardening, trend log, and evidence artifacts now cover keyboard, screen reader, contrast, high contrast, reduced motion, focus order, and live regions. |
| deployment_environment_intelligence | Deployment / environment intelligence | runtime | 4.8 | OpenAI Codex 9.0 | OpenHands 8.0 | 4.2 | Understand env vars, Docker, CI, deploy logs, cloud config, services, and runtime failures. |
| learning_loop_self_improvement | Learning loop / self-improvement | learning | 7.0 | Cursor 8.5 | DSPy 8.0 | 2.0 | Safely convert failures and successes into evals, lessons, routing policy, prompts, and regression gates. |

## P0 Gap Stack

These dimensions create the most score lift and credibility risk:

1. SWE-bench / correctness: 3.5, gap 5.5.
2. Enterprise readiness: 3.5, gap 5.5.
3. Screenshot -> code: 4.0, gap 5.0.
4. Browser live preview: 4.0, gap 5.0.
5. Onboarding / time-to-value: 4.5, gap 4.5.
6. Configuration ergonomics: 4.8, gap 4.2.
7. Language/framework breadth: 4.8, gap 4.2.
8. Deployment / environment intelligence: 4.8, gap 4.2.
9. Browser / computer use: 5.2, gap 3.8.
10. Human-agent collaboration: 5.2, gap 3.8.

## What To Learn From OSS First

| Need | Best OSS teachers | Why |
|---|---|---|
| Autonomous agent loop | OpenHands, SWE-agent | Execution traces, browser/terminal interaction, benchmark framing. |
| Permissioned VS Code autonomy | Cline, Roo Code, Kilo Code | Human-in-loop tool approval, browser actions, editor-native flow. |
| Git-native edits | Aider | Small, reviewable diffs and repo-map-based context. |
| Model/provider portability | Continue, LiteLLM | Configurable model routing and IDE integration. |
| Local/offline completion | Tabby | Local FIM and degraded-mode assistant behavior. |
| Observability | OpenTelemetry | Standard traces for latency, costs, tool calls, and failures. |
| Accessibility | axe-core | Concrete automated checks for surfaces that currently lack proof. |

## Evidence Sources

Primary public references used for peer positioning:

- GitHub Copilot coding agent docs: https://docs.github.com/en/copilot/concepts/coding-agent/about-copilot-coding-agent
- OpenAI Codex overview: https://platform.openai.com/docs/codex/overview
- Cursor Bugbot docs and Background Agent changelog: https://docs.cursor.com/en/bugbot and https://cursor.com/changelog/1-0
- Claude Code subagents and memory docs: https://docs.claude.com/en/docs/claude-code/subagents and https://code.claude.com/docs/en/memory
- Devin docs: https://docs.devin.ai/
- OpenHands repo/site: https://github.com/OpenHands/OpenHands and https://openhands.dev/
- Cline repo/site: https://github.com/cline/cline and https://cline.bot/
- Aider repo: https://github.com/aider-ai/aider
- Kilo docs: https://kilo.ai/docs

## Operating Rule

Do not claim a score increase unless the relevant proof exists, the rubric entry
explains why the higher score is earned, and local gates are green. When in
doubt, score lower and turn the missing proof into the next task.
