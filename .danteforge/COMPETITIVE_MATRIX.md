# DanteCode Double Hyper-Critical Competitive Matrix

Revised: 2026-04-23  
Canonical scope: 50 dimensions  
Harsh working composite: `392 / 500 = 7.84`

Scoring principle: `wired != user-visible quality`. A module earns `9` only when it demonstrably matches best-in-class behavior with main-path proof.

## Reconciliation method

Scores use the harshest credible interpretation of current repo evidence and current competitor evidence. DanteCode receives more confidence because its evidence is local and inspectable. Competitor rows remain provisional unless backed by official docs, changelogs, benchmark reports, or hands-on validation.

| Pass | Composite | Method |
|---|---:|---|
| Internal optimistic | `410 / 500 = 8.20` | Gives credit for implemented, tested, and integrated capability |
| Public defensible | `389 / 500 = 7.78` | Credits externally explainable, main-path behavior |
| Hostile diligence | `373 / 500 = 7.46` | Discounts seeded/proxy artifacts and missing broad benchmarks |
| Harsh working matrix | `392 / 500 = 7.84` | Practical planning score used for competitive gap work |

## Dimension key

| # | Dimension | What earns a 9 |
|---:|---|---|
| 1 | Ghost text / inline completions | Low-latency, accepted, context-aware FIM at Cursor/Copilot feel |
| 2 | LSP / diagnostics injection | Deep semantic diagnostics, hover, warning, and type context in prompts |
| 3 | Semantic codebase search | Fast hybrid retrieval with measured top-result relevance and outcome lift |
| 4 | Repo-level context | Symbol graph, import graph, runtime trace, and persistent context cache |
| 5 | SWE-bench / correctness | Broad reproducible benchmark pass rate and hard-task success trend |
| 6 | Inline edit UX | Streaming diff, partial accept, multi-cursor, low-friction edit control |
| 7 | Multi-file diff + review | Risk-ranked, severity-aware, explainable multi-file changes |
| 8 | Git-native workflow | Safe branch/commit/PR/conflict lifecycle with reviewable automation |
| 9 | Screenshot -> code | Vision-to-code pipeline with visual-diff refinement and usable preview |
| 10 | Full-app generation | Generate, verify, repair, and finish realistic apps across stacks |
| 11 | Chat UX polish | Premium transcript, context pills, proof surfacing, images, commands |
| 12 | @mention / context injection | Files, symbols, docs, URLs, git refs, and tools injected gracefully |
| 13 | Approval workflow | Per-tool/per-hunk approval, rollback, policy gates, clear risk state |
| 14 | Browser live preview | WebContainer/cloud sandbox, hot reload, and preview-driven repair |
| 15 | Agent / autonomous mode | Decisive task triage, repair loops, stop states, completion proof |
| 16 | Plan/Act control | Editable plan, per-step execution, rollback, and visible progress |
| 17 | Browser / computer use | Robust browser/computer observation and action loops |
| 18 | PR review surfaced in IDE | High-signal review comments, severity ranking, false-positive suppression |
| 19 | Test runner integration | Watch mode, inline failures, repair loop, and typed test evidence |
| 20 | Debug / runtime context | Stack frames, failing tests, watches, variables, and repair impact |
| 21 | Session memory | Validated, cited, stale-aware memory that improves outcomes |
| 22 | Skill / plugin system | Discoverable, versioned, policy-gated skill/plugin ecosystem |
| 23 | Security / sandboxing | Sandbox enforcement, secret scanning, policy, and auditability |
| 24 | Reliability / rollback | Checkpoint/resume, circuit breakers, loop detection, safe recovery |
| 25 | MCP / tool ecosystem | Dynamic tool discovery, schema validation, approval, observability |
| 26 | Local model routing | Strong local/cloud routing, failover, FIM detection, offline-friendly operation |
| 27 | Cost optimization | Cost-per-success routing, budgets, caching, and user-visible savings |
| 28 | Enterprise | SSO, RBAC, audit export, multi-user workspace, admin controls |
| 29 | Eval infrastructure quality | Reproducible eval harnesses, trends, regression gates, proof reports |
| 30 | UX trust / explainability | Users can understand, steer, and trust why the agent acted |
| 31 | Context governance | Context is cited, validated, expired, scoped, and user-controllable |
| 32 | Human-agent collaboration | Smooth interruption, steering, handoff, and shared editing during runs |
| 33 | Task decomposition quality | Large vague tasks become safe, sequenced, verifiable subtasks |
| 34 | Regression prevention | Improvements stay improved through CI, evals, and release gates |
| 35 | Onboarding / time-to-value | New users reach a successful first task quickly in a real repo |
| 36 | Ecosystem portability | Works across CLI, IDE, CI, local/cloud models, MCP, and hosted workflows |
| 37 | Model quality adaptation | Routing/prompt/model policy adapts to task, failures, cost, and outcome history |
| 38 | Latency / responsiveness | Whole product feels fast across chat, tools, completions, previews, and edits |
| 39 | Observability / telemetry | Maintainers can diagnose failures, regressions, cost, latency, and model drift |
| 40 | Configuration ergonomics | Providers, models, policies, tools, memory, and workspaces are easy to configure |
| 41 | Offline / degraded-mode behavior | Useful behavior survives provider, network, index, and tool failures |
| 42 | Data/privacy controls | Redaction, retention, local-only mode, telemetry opt-out, and secret handling |
| 43 | Documentation quality | Docs, recipes, examples, troubleshooting, and beta onboarding are clear |
| 44 | Extensibility developer experience | Plugins, tools, commands, skills, and providers are easy to build and test |
| 45 | Benchmark transparency | Eval results are reproducible, comparable, honestly published, and trended |
| 46 | Multi-repo / monorepo scale | Handles huge repos, workspaces, dependency graphs, and cross-repo tasks |
| 47 | Language/framework breadth | Works beyond TypeScript happy paths across common languages and stacks |
| 48 | Accessibility / inclusive UX | Keyboard, screen-reader, contrast, motion, and readable review UX are tested |
| 49 | Deployment / environment intelligence | Understands env vars, Docker, CI, cloud deploys, logs, and infra config |
| 50 | Learning loop / self-improvement | Failures safely feed future behavior, evals, lessons, and routing policies |

## DanteCode dimension row

| Dim | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| DC | 8 | 8 | 8 | 8.5 | 8 | 8 | 8 | 8.5 | 5 | 8.5 | 7.5 | 8 | 8.5 | 5.5 | 9 | 8.5 | 8 | 8 |

| Dim | 19 | 20 | 21 | 22 | 23 | 24 | 25 | 26 | 27 | 28 | 29 | 30 | 31 | 32 | 33 | 34 | 35 | 36 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| DC | 8.5 | 8.5 | 8.5 | 8 | 9 | 8.5 | 8 | 9 | 9 | 6 | 8 | 7.5 | 8 | 7.5 | 8.5 | 8.5 | 7.5 | 8 |

| Dim | 37 | 38 | 39 | 40 | 41 | 42 | 43 | 44 | 45 | 46 | 47 | 48 | 49 | 50 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| DC | 8 | 7 | 8.5 | 7 | 8 | 8 | 7 | 8 | 7.5 | 7 | 7 | 5.5 | 7.5 | 8 |

## Closed-source matrix

| Product | Sum | Avg | Main pressure |
|---|---:|---:|---|
| Cursor | 409 | 8.18 | Editor feel, collaboration, onboarding, UX trust |
| Codex | 403 | 8.06 | Agent breadth, computer use, plugins, eval momentum |
| DanteCode | 392 | 7.84 | Local proof, safety, routing, cost, autonomy discipline, enterprise foundation |
| Claude Code | 380 | 7.60 | Terminal agent quality, MCP/routines, task execution |
| GitHub Copilot | 366 | 7.32 | Enterprise, code review, memory, cloud agent |
| Windsurf | 359 | 7.18 | IDE polish, Cascade workflow, onboarding |
| Devin | 353 | 7.06 | Async autonomy, PR lifecycle, task delegation |
| JetBrains AI | 322 | 6.44 | Debugger/IDE depth |
| Cody | 307 | 6.14 | Search/repo context heritage |
| Replit | 290 | 5.80 | Hosted app loop and live preview |
| Bolt | 214 | 4.28 | Narrow app-generation and preview lane |
| v0 | 214 | 4.28 | Narrow UI/screenshot-to-code lane |

## OSS matrix

| Product | Sum | Avg | Main lesson |
|---|---:|---:|---|
| DanteCode | 392 | 7.84 | Broadest OSS-first proof posture |
| Continue | 308 | 6.16 | Context providers, IDE platform, portability |
| Cline | 303 | 6.06 | Human-agent steering and editor workflow |
| OpenHands | 302 | 6.04 | Autonomy, sandboxing, eval discipline |
| Aider | 294 | 5.88 | Git-native workflow and terminal ergonomics |
| Void | 283 | 5.66 | Editor UX ideas and inline edit feel |
| Tabby | 255 | 5.10 | Local completion and model routing |
| AppMap / Navie | 254 | 5.08 | Runtime-aware context |
| SWE-agent | 242 | 4.84 | Benchmark harness and task-solving loops |
| Refact | 240 | 4.80 | Local assistant and completion patterns |

## Closed-source compact score grid: core dimensions 1-36

Abbrev: `DC` DanteCode, `Cu` Cursor, `Cx` Codex, `Cl` Claude Code, `GH` GitHub Copilot, `Dv` Devin, `Ws` Windsurf, `JB` JetBrains AI, `Repl` Replit.

| Dim | DC | Cu | Cx | Cl | GH | Dv | Ws | JB | Cody | Repl | Bolt | v0 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 8 | 10 | 7 | 6 | 9 | 4 | 8 | 8 | 8 | 6 | 3 | 2 |
| 2 | 8 | 8 | 6 | 5 | 7 | 4 | 7 | 9 | 9 | 5 | 2 | 2 |
| 3 | 8 | 9 | 8 | 8 | 7 | 6 | 8 | 7 | 9 | 6 | 3 | 3 |
| 4 | 8.5 | 9 | 8 | 8 | 7 | 7 | 8 | 8 | 9 | 5 | 3 | 3 |
| 5 | 8 | 7 | 9 | 8.5 | 6 | 9 | 6 | 5 | 4 | 4 | 2 | 2 |
| 6 | 8 | 10 | 7 | 7 | 7 | 6 | 9 | 7 | 7 | 7 | 6 | 5 |
| 7 | 8 | 9 | 8 | 7 | 8 | 7 | 7 | 7 | 8 | 5 | 3 | 3 |
| 8 | 8.5 | 8 | 8 | 9 | 9 | 8 | 7 | 6 | 7 | 4 | 3 | 2 |
| 9 | 5 | 5 | 4 | 3 | 4 | 4 | 4 | 3 | 2 | 7 | 8 | 9 |
| 10 | 8.5 | 7 | 7 | 7 | 6 | 8 | 7 | 5 | 5 | 8 | 9 | 9 |
| 11 | 7.5 | 10 | 8 | 8 | 8 | 7 | 8 | 7 | 7 | 8 | 7 | 7 |
| 12 | 8 | 9 | 9 | 9 | 8 | 6 | 8 | 7 | 8 | 6 | 5 | 5 |
| 13 | 8.5 | 8 | 8 | 8.5 | 6 | 8 | 7 | 6 | 6 | 5 | 4 | 4 |
| 14 | 5.5 | 5 | 7 | 3 | 3 | 5 | 5 | 3 | 2 | 9 | 9 | 9 |
| 15 | 9 | 8 | 9 | 9 | 7 | 10 | 8 | 5 | 5 | 6 | 5 | 4 |
| 16 | 8.5 | 8 | 8 | 8 | 6 | 9 | 7 | 5 | 5 | 5 | 4 | 4 |
| 17 | 8 | 6 | 9 | 8 | 4 | 9 | 5 | 4 | 3 | 5 | 3 | 3 |
| 18 | 8 | 9 | 9 | 8 | 9 | 8 | 7 | 6 | 6 | 4 | 2 | 2 |
| 19 | 8.5 | 8 | 8 | 8 | 7 | 8 | 7 | 8 | 6 | 6 | 3 | 3 |
| 20 | 8.5 | 8 | 8 | 7 | 6 | 7 | 7 | 9 | 6 | 5 | 2 | 2 |
| 21 | 8.5 | 8 | 9 | 8.5 | 9 | 8 | 7 | 6 | 6 | 5 | 3 | 3 |
| 22 | 8 | 8 | 9 | 9 | 7 | 7 | 6 | 6 | 5 | 6 | 3 | 3 |
| 23 | 9 | 8 | 8 | 8 | 8 | 7 | 7 | 7 | 7 | 6 | 4 | 4 |
| 24 | 8.5 | 8 | 8 | 8 | 7 | 8 | 7 | 7 | 7 | 6 | 4 | 4 |
| 25 | 8 | 8 | 9 | 9 | 7 | 7 | 7 | 6 | 6 | 5 | 3 | 3 |
| 26 | 9 | 7 | 5 | 5 | 4 | 3 | 6 | 5 | 5 | 3 | 2 | 2 |
| 27 | 9 | 7 | 7 | 7 | 6 | 5 | 6 | 6 | 6 | 5 | 4 | 4 |
| 28 | 6 | 8 | 8 | 7.5 | 9 | 7 | 7 | 8 | 7 | 5 | 2 | 2 |
| 29 | 8 | 8 | 9 | 8.5 | 8 | 8 | 7 | 6 | 6 | 5 | 4 | 4 |
| 30 | 7.5 | 9 | 8 | 8 | 8 | 7 | 8 | 7 | 6 | 7 | 6 | 6 |
| 31 | 8 | 8 | 8 | 8.5 | 9 | 7 | 7 | 6 | 7 | 5 | 4 | 4 |
| 32 | 7.5 | 9 | 8 | 8 | 7 | 7 | 8 | 6 | 5 | 5 | 4 | 4 |
| 33 | 8.5 | 8 | 8 | 8.5 | 7 | 9 | 7 | 6 | 5 | 5 | 4 | 4 |
| 34 | 8.5 | 8 | 8 | 8 | 8 | 8 | 7 | 8 | 6 | 6 | 4 | 4 |
| 35 | 6.5 | 9 | 8 | 7 | 8 | 6 | 8 | 6 | 5 | 9 | 8 | 8 |
| 36 | 8 | 8 | 9 | 8.5 | 8 | 6 | 7 | 6 | 6 | 6 | 4 | 4 |

## OSS compact score grid: core dimensions 1-36

Abbrev: `OH` OpenHands, `Ai` Aider, `Cn` Cline, `Ct` Continue, `Tb` Tabby, `SWE` SWE-agent, `App` AppMap/Navie, `Ref` Refact.

| Dim | DC | OH | Ai | Cn | Ct | Tb | Void | SWE | App | Ref |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 8 | 2 | 3 | 5 | 8 | 9 | 6 | 1 | 2 | 7 |
| 2 | 8 | 3 | 4 | 6 | 9 | 7 | 8 | 2 | 7 | 6 |
| 3 | 8 | 6 | 8 | 7 | 8 | 8 | 7 | 5 | 8 | 6 |
| 4 | 8.5 | 6 | 7 | 7 | 8 | 7 | 7 | 5 | 9 | 5 |
| 5 | 8 | 8 | 6 | 4 | 4 | 4 | 3 | 9 | 4 | 4 |
| 6 | 8 | 4 | 6 | 7 | 7 | 5 | 8 | 2 | 4 | 6 |
| 7 | 8 | 5 | 7 | 6 | 6 | 5 | 6 | 4 | 6 | 5 |
| 8 | 8.5 | 6 | 9 | 6 | 6 | 5 | 6 | 7 | 5 | 5 |
| 9 | 5 | 2 | 2 | 2 | 2 | 2 | 2 | 1 | 2 | 2 |
| 10 | 8.5 | 7 | 7 | 6 | 5 | 4 | 5 | 6 | 5 | 4 |
| 11 | 7.5 | 6 | 5 | 7 | 7 | 5 | 6 | 4 | 5 | 5 |
| 12 | 8 | 6 | 6 | 8 | 8 | 5 | 7 | 3 | 6 | 5 |
| 13 | 8.5 | 6 | 5 | 6 | 6 | 4 | 6 | 4 | 4 | 4 |
| 14 | 5.5 | 3 | 2 | 2 | 2 | 2 | 2 | 1 | 2 | 2 |
| 15 | 9 | 9 | 8 | 7 | 5 | 4 | 5 | 9 | 4 | 4 |
| 16 | 8.5 | 7 | 6 | 6 | 5 | 4 | 5 | 7 | 4 | 4 |
| 17 | 8 | 7 | 4 | 5 | 3 | 3 | 4 | 5 | 3 | 3 |
| 18 | 8 | 5 | 5 | 5 | 5 | 4 | 5 | 4 | 5 | 4 |
| 19 | 8.5 | 6 | 6 | 6 | 6 | 4 | 6 | 6 | 6 | 5 |
| 20 | 8.5 | 6 | 5 | 5 | 5 | 4 | 5 | 5 | 5 | 4 |
| 21 | 8.5 | 5 | 5 | 5 | 6 | 4 | 5 | 3 | 4 | 4 |
| 22 | 8 | 5 | 6 | 6 | 6 | 4 | 5 | 3 | 4 | 4 |
| 23 | 9 | 6 | 6 | 6 | 6 | 5 | 6 | 5 | 5 | 5 |
| 24 | 8.5 | 7 | 7 | 6 | 6 | 5 | 6 | 5 | 5 | 5 |
| 25 | 8 | 6 | 5 | 7 | 6 | 4 | 6 | 3 | 4 | 4 |
| 26 | 9 | 5 | 8 | 6 | 7 | 9 | 7 | 3 | 5 | 8 |
| 27 | 9 | 6 | 7 | 6 | 7 | 8 | 7 | 4 | 5 | 7 |
| 28 | 6 | 4 | 3 | 4 | 4 | 4 | 3 | 3 | 4 | 3 |
| 29 | 8 | 8 | 6 | 6 | 6 | 5 | 5 | 9 | 6 | 5 |
| 30 | 7.5 | 6 | 5 | 7 | 6 | 4 | 6 | 4 | 5 | 4 |
| 31 | 8 | 6 | 5 | 6 | 7 | 4 | 5 | 4 | 6 | 4 |
| 32 | 7.5 | 6 | 5 | 7 | 6 | 4 | 6 | 4 | 4 | 4 |
| 33 | 8.5 | 8 | 7 | 6 | 5 | 4 | 5 | 7 | 5 | 4 |
| 34 | 8.5 | 7 | 6 | 6 | 6 | 5 | 5 | 6 | 5 | 5 |
| 35 | 6.5 | 5 | 6 | 6 | 6 | 6 | 5 | 3 | 4 | 4 |
| 36 | 8 | 6 | 6 | 7 | 8 | 7 | 6 | 4 | 5 | 5 |

## Frontier-extension grid: dimensions 37-50

| Dim | DanteCode | Cursor | Codex | Claude | Copilot | Windsurf | Devin | Continue | Cline | OpenHands | Best OSS teacher |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 37 Model adaptation | 8 | 8 | 9 | 8 | 8 | 7 | 7 | 7 | 6 | 7 | DSPy, LiteLLM, Aider |
| 38 Latency / responsiveness | 7 | 9 | 8 | 8 | 8 | 8 | 7 | 6 | 7 | 6 | Tabby, Void, Continue |
| 39 Observability / telemetry | 8.5 | 8 | 8 | 8 | 8 | 7 | 7 | 6 | 6 | 8 | OpenTelemetry, LangSmith-style evals |
| 40 Configuration ergonomics | 7 | 9 | 8 | 8 | 8 | 8 | 7 | 7 | 7 | 6 | Continue, Cline, Casdoor |
| 41 Offline / degraded mode | 8 | 7 | 7 | 7 | 5 | 6 | 5 | 7 | 6 | 6 | Tabby, LocalAI, Aider |
| 42 Data/privacy controls | 8 | 8 | 8 | 7 | 9 | 7 | 7 | 6 | 6 | 6 | Presidio, Gitleaks, Ory |
| 43 Documentation quality | 7 | 8 | 8 | 8 | 8 | 8 | 7 | 7 | 7 | 6 | Diataxis, Docusaurus, Nextra |
| 44 Extensibility DX | 8 | 8 | 9 | 9 | 7 | 6 | 7 | 8 | 7 | 6 | Continue, Cline, MCP |
| 45 Benchmark transparency | 7.5 | 7 | 9 | 8 | 7 | 6 | 8 | 5 | 5 | 8 | SWE-agent, OpenHands |
| 46 Monorepo scale | 7 | 8 | 8 | 7 | 8 | 7 | 7 | 7 | 6 | 6 | Nx, Turborepo, Sourcegraph |
| 47 Language breadth | 7 | 8 | 8 | 8 | 8 | 7 | 6 | 8 | 7 | 6 | tree-sitter, Continue, Tabby |
| 48 Accessibility | 5.5 | 8 | 7 | 6 | 8 | 7 | 6 | 6 | 6 | 5 | axe-core, VS Code accessibility |
| 49 Deployment intelligence | 7.5 | 8 | 9 | 7 | 7 | 7 | 8 | 5 | 6 | 7 | Dev Containers, E2B, OpenHands |
| 50 Learning loop | 8 | 8 | 8 | 8 | 8 | 7 | 8 | 7 | 6 | 7 | DSPy, LangGraph, OpenHands |

## Low-score OSS learning paths

| DanteCode gap | Current | OSS sources to learn from | Intended lift |
|---|---:|---|---|
| 9 Screenshot-to-code | 5 | `abi/screenshot-to-code`, WebSight, VisRefiner, ScreenCoder-style repos | Add visual-diff refinement and real user acceptance |
| 14 Browser live preview | 5.5 | StackBlitz WebContainers, E2B, OpenHands, Browser Use | Add WebContainer/cloud sandbox and preview-driven repair |
| 28 Enterprise | 6 | Keycloak, Ory, Cerbos, Permify, Zitadel, OpenFGA, Casdoor, OPAL, Kratos, Keto | Add real IdP integration, persistent org store, and admin UX |
| 35 Onboarding / time-to-value | 7.5 | Continue, Cline, Tabby, OpenHands | Improve guided first-task success |
| 38 Latency / responsiveness | 7 | Tabby, Void, Continue, VS Code shell/link UX | Add end-to-end beta latency SLOs |
| 40 Configuration ergonomics | 7 | Continue, Cline, Tabby, Casdoor | Add provider/policy/tool setup wizard polish |
| 43 Documentation quality | 7 | Diataxis, Docusaurus, Nextra, Astro Starlight | Build public beta docs, recipes, troubleshooting |
| 48 Accessibility / inclusive UX | 5.5 | axe-core, VS Code accessibility guidance | Add keyboard/screen-reader/contrast test pass |

## Cross-matrix summary

| Universe | DC | Best competitor | DC position | Target composite |
|---|---:|---|---|---:|
| Closed-source | 7.78 | Cursor 8.18 | Behind top cluster, close to frontier-adjacent | 9.0 |
| Open-source | 7.78 | Continue 6.16 | #1 in this harsh OSS read | 9.0 |
| Combined | 7.78 | Cursor 8.18 | Strong OSS leader, not full closed-source leader | 9.0 |

**Gap to 9.0 composite:** `61 dimension-points across 50 dimensions`.

## Next highest-leverage push

`18` PR review sharpness remains the best next score-efficient sprint: risk clustering, severity ranking, false-positive suppression, and review outcome correlation can compound correctness, memory, debug context, and diff quality.
