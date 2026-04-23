# DanteCode Competitive Matrix Rebuilt

Updated: 2026-04-23  
Scope: canonical 50-dimension competitive matrix  
Scoring rule: wired code does not earn a `9`; only main-path, user-visible, proof-backed, best-in-class behavior does.

## What changed

- The canonical matrix expanded from 36 dimensions to 50 dimensions.
- Dimensions `29-36` remain first-class product-frontier dimensions:
  - `29` Eval infrastructure quality
  - `30` UX trust / explainability
  - `31` Context governance
  - `32` Human-agent collaboration
  - `33` Task decomposition quality
  - `34` Regression prevention
  - `35` Onboarding / time-to-value
  - `36` Ecosystem portability
- Dimensions `37-50` are now first-class frontier-operating dimensions:
  - `37` Model quality adaptation
  - `38` Latency / responsiveness
  - `39` Observability / telemetry
  - `40` Configuration ergonomics
  - `41` Offline / degraded-mode behavior
  - `42` Data/privacy controls
  - `43` Documentation quality
  - `44` Extensibility developer experience
  - `45` Benchmark transparency
  - `46` Multi-repo / monorepo scale
  - `47` Language/framework breadth
  - `48` Accessibility / inclusive UX
  - `49` Deployment / environment intelligence
  - `50` Learning loop / self-improvement
- Primary totals now use `/500`. Historical `/280` and `/360` totals are retained only for comparison.
- DanteCode gets credit for the recent proof-heavy sprints in dimensions `1`, `3`, `5`, `9`, `14`, `15`, `20`, `21`, and `35`, but the expanded product-frontier dimensions lower the headline slightly versus a pure capability-only read.

## Rubric summary

| Rubric | DanteCode score | Interpretation |
|---|---:|---|
| Internal optimistic | `410 / 500 = 8.20` | Credits implemented and tested main-path capability |
| Public defensible | `389 / 500 = 7.78` | Credits claims an outsider could reasonably verify |
| Hostile diligence | `373 / 500 = 7.46` | Discounts seeded artifacts, proxy metrics, weak docs, and unbenchmarked claims |
| Harsh double-matrix working score | `392 / 500 = 7.84` | Planning score that blends current repo evidence with beta/productization gaps |

## DanteCode dimension truth

| # | Dimension | Score | Evidence standard met | Notes |
|---:|---|---:|---|---|
| 1 | Ghost text / inline completions | 8 | Partial | Latency histogram, cancellation tracking, and stale suppression exist; not Cursor/Copilot-tier yet |
| 2 | LSP / diagnostics injection | 8 | Yes | Real editor wiring, still not JetBrains-tier |
| 3 | Semantic codebase search | 8 | Partial | Retrieval impact artifact exists; needs actual top-snippet eval at larger scale |
| 4 | Repo-level context | 8.5 | Partial | Stronger context path, still needs richer graph/runtime proof |
| 5 | SWE-bench / correctness | 8 | Partial | Resolution ladder exists; still lacks broad Docker-backed benchmark tranche |
| 6 | Inline edit UX | 8 | Yes | Strong, not yet premium Cursor-style interaction |
| 7 | Multi-file diff + review | 8 | Yes | Good review scaffolding, sharper severity/risk ranking remains |
| 8 | Git-native workflow | 8.5 | Yes | Strong local workflow and patch discipline |
| 9 | Screenshot -> code | 5 | Partial | Two-pass pipeline and framework detection exist; visual-diff refinement and real acceptance are still missing |
| 10 | Full-app generation | 8.5 | Yes | Verification-aware generation path is credible |
| 11 | Chat UX polish | 7.5 | Partial | Useful, still behind Cursor/Windsurf/Codex polish |
| 12 | @mention / context injection | 8 | Yes | Solid, still incomplete for URLs/images/git refs |
| 13 | Approval workflow | 8.5 | Yes | Strong safety posture and reviewable execution |
| 14 | Browser live preview | 5.5 | Partial | VS Code preview and dev-server lifecycle exist; WebContainer/cloud sandbox loop is still missing |
| 15 | Agent / autonomous mode | 9 | Yes | Triage, repair budget, and completion verdicts are main-path behavior |
| 16 | Plan/Act control | 8.5 | Yes | Good structure; plan editing and visible state can improve |
| 17 | Browser / computer use | 8 | Yes | Real browser state capture; broader computer-use still trails frontier |
| 18 | PR review surfaced in IDE | 8 | Yes | Real review result path; next gap is review sharpness |
| 19 | Test runner integration | 8.5 | Yes | Strong, especially when paired with repair loops |
| 20 | Debug / runtime context | 8.5 | Partial | Stack/test context injection exists; debugger protocol integration remains |
| 21 | Session memory | 8.5 | Partial | Memory-outcome correlation exists; needs broader causal proof |
| 22 | Skill / plugin system | 8 | Yes | Strong architecture, thin ecosystem maturity |
| 23 | Security / sandboxing | 9 | Yes | Real moat |
| 24 | Reliability / rollback | 8.5 | Yes | Strong recovery posture, still needs universal resume UX |
| 25 | MCP / tool ecosystem | 8 | Yes | Broad and credible, not yet polished enough for `9` |
| 26 | Local model routing | 9 | Yes | Real moat |
| 27 | Cost optimization | 9 | Yes | Real moat |
| 28 | Enterprise | 6 | Partial | SSO config validation, RBAC traces, audit export, and admin policy foundation exist; real IdP integration and persistent org store remain |
| 29 | Eval infrastructure quality | 8 | Partial | Good artifacts and sprint tests; needs reproducible eval runner culture |
| 30 | UX trust / explainability | 7.5 | Partial | Proof artifacts help; user-facing trust UX still trails leaders |
| 31 | Context governance | 8 | Partial | Memory staleness and evidence links exist; needs stronger citation/expiry controls |
| 32 | Human-agent collaboration | 7.5 | Partial | Approval and plan flow exist; mid-run steering/handoff still limited |
| 33 | Task decomposition quality | 8.5 | Yes | Strong triage/decomposition posture after autonomy work |
| 34 | Regression prevention | 8.5 | Yes | Strong tests and proof posture; needs release-level regression dashboards |
| 35 | Onboarding / time-to-value | 7.5 | Partial | Funnel metrics and repo readiness exist; guided first-task success still needs beta proof |
| 36 | Ecosystem portability | 8 | Yes | CLI/editor/model-provider portability is a strength |
| 37 | Model quality adaptation | 8 | Partial | Routing, FIM, cost, and provider health already adapt by task signals |
| 38 | Latency / responsiveness | 7 | Partial | FIM latency is measured; full-system responsiveness is not yet proven |
| 39 | Observability / telemetry | 8.5 | Yes | Artifact/logging culture is unusually strong |
| 40 | Configuration ergonomics | 7 | Partial | Powerful but not yet frictionless |
| 41 | Offline / degraded-mode behavior | 8 | Yes | Local routing/offline posture is strong |
| 42 | Data/privacy controls | 8 | Yes | Local-first and security posture help; admin controls remain thin |
| 43 | Documentation quality | 7 | Partial | Strong internal docs, weaker public beta docs |
| 44 | Extensibility developer experience | 8 | Partial | Skills/MCP/plugin base is strong, ecosystem DX needs polish |
| 45 | Benchmark transparency | 7.5 | Partial | Good proof chain, needs larger reproducible public runs |
| 46 | Multi-repo / monorepo scale | 7 | Partial | Repo context exists, huge-workspace proof is thin |
| 47 | Language/framework breadth | 7 | Partial | TypeScript strongest; broader language proof needs measurement |
| 48 | Accessibility / inclusive UX | 5.5 | No | Likely under-tested; needs explicit accessibility pass |
| 49 | Deployment / environment intelligence | 7.5 | Partial | Debug/runtime/dev-server work helps, deploy-specific context is thin |
| 50 | Learning loop / self-improvement | 8 | Yes | Outcome correlation and proof artifacts create a real compounding loop |

**Current DanteCode harsh working composite:** `392 / 500 = 7.84`

## Closed-source matrix

| Product | Composite | Position vs DanteCode | Confidence |
|---|---:|---|---|
| Cursor | `409 / 500 = 8.18` | Ahead by `0.34` | Medium |
| Codex | `403 / 500 = 8.06` | Ahead by `0.22` | Medium |
| DanteCode | `392 / 500 = 7.84` | Current line | High for local row |
| Claude Code | `380 / 500 = 7.60` | Behind by `0.24` | Medium |
| GitHub Copilot | `366 / 500 = 7.32` | Behind by `0.52` | Medium |
| Windsurf | `359 / 500 = 7.18` | Behind by `0.66` | Medium |
| Devin | `353 / 500 = 7.06` | Behind by `0.78` | Low-medium |
| JetBrains AI | `322 / 500 = 6.44` | Behind by `1.40` | Low-medium |
| Cody | `307 / 500 = 6.14` | Behind by `1.70` | Low-medium |
| Replit | `290 / 500 = 5.80` | Behind by `2.04` | Low-medium |
| Bolt | `214 / 500 = 4.28` | Behind by `3.56` | Low |
| v0 | `214 / 500 = 4.28` | Behind by `3.56` | Low |

Competitor rows are provisional. Any `8+` score for a third-party product requires official docs, changelog evidence, benchmark evidence, or hands-on validation before it should be cited publicly.

## Open-source matrix

| Product | Composite | Position vs DanteCode | Confidence |
|---|---:|---|---|
| DanteCode | `392 / 500 = 7.84` | Current OSS leader | High for local row |
| Continue | `308 / 500 = 6.16` | Behind by `1.68` | Medium |
| Cline | `303 / 500 = 6.06` | Behind by `1.78` | Medium |
| OpenHands | `302 / 500 = 6.04` | Behind by `1.80` | Medium |
| Aider | `294 / 500 = 5.88` | Behind by `1.96` | Medium |
| Void | `283 / 500 = 5.66` | Behind by `2.18` | Low-medium |
| Tabby | `255 / 500 = 5.10` | Behind by `2.74` | Medium |
| AppMap / Navie | `254 / 500 = 5.08` | Behind by `2.76` | Low-medium |
| SWE-agent | `242 / 500 = 4.84` | Behind by `3.00` | Medium for benchmark niche |
| Refact | `240 / 500 = 4.80` | Behind by `3.04` | Low-medium |

## OSS learn map

| Gap | Best source to learn from |
|---|---|
| Inline completions | Tabby, Continue, Void, Twinny |
| SWE-bench rigor | OpenHands, SWE-agent |
| Repo graph / context depth | AppMap, Continue, Sourcegraph/Cody patterns |
| Terminal-native git sharpness | Aider |
| Autonomy loop discipline | OpenHands, SWE-agent, LangGraph |
| Editor polish | Continue, Void, Cline |
| Screenshot-to-code | `abi/screenshot-to-code`, WebSight, VisRefiner, ScreenCoder-style repos |
| Browser preview / sandbox | StackBlitz WebContainers, E2B, OpenHands, Browser Use |
| Enterprise auth / policy | Keycloak, Ory, Cerbos, Permify, Zitadel, OpenFGA |
| PR review sharpness | PR-Agent, reviewdog, Semgrep, CodeRabbit/Sourcery-style patterns |
| Eval infrastructure | SWE-agent, OpenHands, benchmark harnesses, LangSmith-style evals |
| UX trust / explainability | Cline, Continue, OpenHands proof summaries |
| Context governance | Continue providers, Copilot-style memory validation, citation/expiry systems |
| Collaboration | Cline, Continue, Cursor/Windsurf interaction patterns |
| Task decomposition | OpenHands, Plandex, SWE-agent, LangGraph |
| Regression prevention | reviewdog, Semgrep, CI gates, benchmark regression tracking |
| Onboarding | Continue, Cline, Tabby, OpenHands setup flows |
| Portability | Continue, Cline, MCP ecosystem, Tabby, Aider |
| Model adaptation | LiteLLM, DSPy, OpenRouter-style routing, Aider model settings |
| Latency / responsiveness | Tabby, Void, Continue, VS Code terminal/link UX patterns |
| Observability / telemetry | OpenTelemetry, LangSmith-style evals, Helicone-style LLM observability |
| Configuration ergonomics | Continue, Cline, Tabby, Casdoor setup patterns |
| Offline / degraded mode | Tabby, LocalAI, Ollama ecosystems, Aider |
| Data/privacy controls | Presidio, Gitleaks, TruffleHog, OpenFGA, Ory |
| Documentation quality | Diataxis-style docs, Docusaurus/Nextra OSS docs systems |
| Extensibility DX | Continue, Cline, MCP ecosystem, VS Code extension APIs |
| Benchmark transparency | SWE-agent, OpenHands, Live-SWE-agent style harnesses |
| Monorepo scale | Nx, Turborepo, Sourcegraph/Cody patterns |
| Language breadth | tree-sitter ecosystem, Continue, Tabby |
| Accessibility | axe-core, VS Code accessibility guidance |
| Deployment intelligence | Dev Containers, Docker Compose, Nix, E2B, OpenHands |
| Learning loop | DSPy, LangGraph, OpenHands, DanteForge outcome artifacts |

## Hard ceilings vs code-closeable gaps

| Dimension | Current | Near ceiling | Type | Why |
|---|---:|---:|---|---|
| 9 Screenshot -> code | 5 | 7 | Product/model gap | V1 pipeline exists; needs visual-diff refinement and real user acceptance |
| 14 Browser live preview | 5.5 | 7 | Infra gap | V1 preview exists; needs WebContainer/cloud sandbox preview and hot-reload repair loop |
| 28 Enterprise | 6 | 7 | Backend/org gap | Foundation exists; needs real IdP integration, persistent org storage, admin UX, and multi-user workspace flows |
| 35 Onboarding / time-to-value | 7.5 | 9 | Product gap | Needs human beta first-run success and guided first task |
| 38 Latency / responsiveness | 7 | 9 | Product/perf gap | Needs end-to-end latency SLOs beyond FIM |
| 40 Configuration ergonomics | 7 | 9 | Product gap | Needs provider/policy/tool setup wizard polish |
| 43 Documentation quality | 7 | 9 | Product gap | Needs public beta docs, recipes, troubleshooting |
| 48 Accessibility / inclusive UX | 5.5 | 8 | Product gap | Needs explicit keyboard/screen-reader/contrast testing |
| 18 PR review sharpness | 8 | 9 | Code + proof | Best next high-ROI push: severity ranking, false-positive suppression, outcome correlation |

## Score guardrails

- Do not claim `8+` hostile overall until benchmark and product-frontier gaps are proven beyond seeded artifacts.
- Do not claim `9` on search, memory, autonomy, correctness, or review without measured outcome lift.
- Do not cite competitor rankings externally until each `8+` has a source-backed rationale.
- Treat `/500` as canonical. Any `/280` or `/360` number is historical only.
