# OSS Dimension Learning Map

Date: 2026-04-20  
Lens: serious solo builder, adoption ignored  
Rule: open source can teach patterns, but it does not automatically close the last mile to `9`

## Executive Truth

The current OSS universe is strong enough to teach DanteCode a lot of the path to leadership, but not all of it.

The honest pattern is:

- some dimensions have a clear OSS teacher
- some dimensions have multiple partial teachers
- some dimensions can only get to `8` or `8.5` from OSS alone
- the last mile to a true `9` often requires original engineering, product taste, model work, or infrastructure

That is good news, not bad news. It means the project has already harvested much of the easy OSS surface area and is now competing in the harder, more valuable part of the landscape.

## Dimension Map

| # | Dimension | Best OSS teacher(s) now | Can OSS get us to 9? | Honest ceiling from OSS alone | What OSS teaches well | What still requires original engineering | Priority |
|---|---|---|---|---|---|---|---|
| 1 | Ghost text / FIM | Tabby, Continue, Void | Partial | 8.0-8.5 | Local completion infra, FIM routing, context budgeting, model flexibility | Truly elite latency, acceptance quality, edit-trained completion behavior, ranking | High |
| 2 | LSP / diagnostics | Continue, Void, AppMap | Partial | 8.0-8.5 | Context providers, editor plumbing, diagnostics enrichment patterns | Premium inline error UX, semantic token fusion, “feels native” polish | Medium |
| 3 | Semantic search | Continue, Aider, AppMap | Partial | 8.0-8.5 | Retrieval layers, context providers, repo/document search patterns | Measured retrieval quality, ranking discipline, low-latency hot path | High |
| 4 | Repo-level context | AppMap, Continue, OpenHands | Partial | 8.0-8.5 | Runtime traces, context assembly, task-aware repo navigation | Cross-file reasoning quality, dynamic context ranking, deep repo graph productization | High |
| 5 | SWE-bench / correctness | SWE-agent, OpenHands, Refact-bench | Yes, for benchmark discipline | 8.5 | Benchmark harnesses, issue-solving loops, failure analysis, reproducible evaluation | DanteCode-specific benchmark wins, benchmark publication, continuous correctness culture | Highest |
| 6 | Inline edit UX | Void, Continue, Cline | Partial | 8.0-8.5 | Editor-side edit flows, diff application, local-model-friendly UX | Best-in-class partial-accept, confidence tuning, very low-friction day-to-day polish | Medium |
| 7 | Multi-file diff / review | Aider, Continue | Partial | 8.0-8.5 | Git-aware diffs, review surfaces, file grouping | Premium review ergonomics, trust-building explanations, better IDE-native polish | Medium |
| 8 | Git-native workflow | Aider | Yes, close | 9.0 | Commit discipline, dirty-tree awareness, diff-first workflow, terminal-native habits | Stronger AI-assisted commit/rebase/PR sequencing tailored to DanteCode philosophy | Medium |
| 9 | Screenshot -> code | `abi/screenshot-to-code`, WebSight, VisRefiner, ScreenCoder-style repos | Partial | 6.0-7.0 | Image preprocessing, vision prompting, visual-diff refinement, live preview patterns | Product-grade UI parsing, model quality, visual eval harness, editor integration | Medium |
| 10 | Full-app generation | OpenHands, DevOps-GPT, Continue | Partial | 8.0 | Scaffolding flows, tool calling, project generation structure | Reliable “generate -> verify -> repair” experience on real stacks | High |
| 11 | Chat UX polish | Cline, Continue, Void | Partial | 7.5-8.0 | Basic chat ergonomics, slash/context patterns, local-first flexibility | Premium interaction design, transcript polish, trust signals, product taste | High |
| 12 | @mention / context injection | Continue, Cline | Yes, close | 8.5-9.0 | Context providers, docs/web/file references, MCP-fed context | Better discoverability, better ranking, more graceful UX under load | Medium |
| 13 | Approval workflow | OpenHands, Continue, Cline | Partial | 8.0 | Explicit tool approval and controlled execution patterns | Great inline approval UX, diff-before-approve, rollback confidence | Medium |
| 14 | Browser live preview | StackBlitz WebContainers, E2B, OpenHands, Browser Use | Partial | 6.0-7.0 | Sandboxed execution, browser automation, environment lifecycle, preview affordances | Tight IDE preview loop, hot reload, secure local/cloud routing, repair integration | Medium |
| 15 | Agent / autonomous mode | OpenHands, SWE-agent | Yes, close | 8.5-9.0 | Long-running execution loops, issue-solving structure, recovery patterns | Hot-path integration, practical autonomy trust, lower-friction local operator loop | Highest |
| 16 | Plan / Act control | OpenHands, Plan-oriented agent repos | Yes, close | 8.5-9.0 | Structured planning, task decomposition, explicit execution stages | Premium rollback UX, better plan editing surface, richer state visibility | High |
| 17 | Browser / computer use | OpenHands, browser automation repos | Partial | 8.0-8.5 | Browser action loops, screenshots, environment interaction patterns | Higher-fidelity observation, visual grounding quality, more robust real-world behavior | High |
| 18 | PR review in IDE | Continue, AppMap, review-specific OSS tools | Partial | 7.5-8.0 | PR context plumbing, issue-aware review hints | Truly excellent IDE-native review UX, trustable review judgment, real diff intelligence | High |
| 19 | Test runner integration | OpenHands, Continue, editor tooling repos | Yes, close | 8.5-9.0 | Test watching, failure parsing, agent-test loops | Richer inline diagnostics, smoother fix/retry loop, premium developer feedback | Medium |
| 20 | Debug / runtime context | AppMap, OpenHands | Yes, close | 8.5-9.0 | Runtime-aware context, trace-informed reasoning, test/runtime loops | Best-in-class integration of traces, stack frames, watches, and actionability | Medium |
| 21 | Session memory | Continue, OpenHands, memory/knowledge OSS | Partial | 7.5-8.0 | Basic memory stores, recall, context persistence | Truly relevant long-horizon memory quality, preference learning, memory trust | High |
| 22 | Skill / plugin system | Continue, Cline, MCP ecosystem | Partial | 7.5-8.0 | Extensibility models, context/tool plugin structure | Durable ecosystem quality, discoverability, developer experience, curated plugin trust | Medium |
| 23 | Security / sandboxing | OpenHands, sandbox repos, container tooling | Partial | 7.5-8.0 | Sandbox patterns, explicit tool controls, execution isolation | Deep security posture, policy depth, enterprise-grade confidence and auditability | Medium |
| 24 | Reliability / rollback | OpenHands, Aider | Yes, close | 8.5 | Retry/repair loops, rollback patterns, bounded execution | “Boring” production confidence, UX around failure recovery, fewer surprising edges | High |
| 25 | MCP / tool ecosystem | Cline, Continue, OpenHands | Partial | 8.0 | Open tool federation, MCP-first architecture, tool composability | Higher-quality tool UX, retries, observability, consistent error handling | Medium |
| 26 | Local model routing | Aider, Tabby, LocalAI | Yes | 9.0 | Local-provider pragmatism, routing flexibility, self-hosted friendliness | Better automatic routing policy and tuning for DanteCode-specific tasks | Medium |
| 27 | Cost optimization | Aider, Tabby, local-model ecosystems | Partial | 8.5 | Practical cost awareness, local-first usage patterns, model selection | Better user-visible cost controls, dashboards, cross-session insights | Medium |
| 28 | Enterprise | Keycloak, Ory, Cerbos, Permify, Zitadel, OpenFGA | Partial | 6.0-7.0 | SSO, identity, RBAC/ABAC/ReBAC, policy decisions, audit foundations | Product packaging, admin UX, procurement trust, org-scale operations | Medium |
| 29 | Eval infrastructure quality | SWE-agent, OpenHands, benchmark harnesses, LangSmith-style evals | Yes, close | 8.5-9.0 | Reproducible task harnesses, benchmark trend tracking, failure clustering | DanteCode-specific eval corpus, release gates, public proof discipline | Highest |
| 30 | UX trust / explainability | Cline, Continue, OpenHands proof summaries | Partial | 8.0-8.5 | Transparent tool calls, summaries, status narration, reviewable outputs | Premium trust UX, confidence calibration, human-readable proof design | High |
| 31 | Context governance | Continue providers, memory systems, citation/expiry patterns | Partial | 8.0-8.5 | Context providers, scoping, retrieval controls, configurable memory | Validated memory citations, stale-context suppression, user-controlled governance | High |
| 32 | Human-agent collaboration | Cline, Continue, Cursor/Windsurf-style steering patterns | Partial | 8.0-8.5 | Interruptions, approvals, chat-driven steering, context handoff | Best-in-class shared work feel, mid-run editing, seamless recovery | High |
| 33 | Task decomposition quality | OpenHands, Plandex, SWE-agent, LangGraph | Yes, close | 8.5-9.0 | Plan graphs, decomposition, execution stages, repair loops | DanteCode-specific ambiguity handling and proof-backed task routing | Highest |
| 34 | Regression prevention | reviewdog, Semgrep, CI gates, benchmark regression tracking | Yes, close | 8.5-9.0 | CI checks, static analysis, trend gates, release blocking | Unified release-quality dashboard and score regression prevention | Highest |
| 35 | Onboarding / time-to-value | Continue, Cline, Tabby, OpenHands | Partial | 8.0 | Setup flows, provider configuration, quick-start ergonomics | First-run success path, guided repo readiness, delightful defaults | High |
| 36 | Ecosystem portability | Continue, Cline, MCP ecosystem, Tabby, Aider | Yes, close | 8.5-9.0 | IDE/CLI/provider portability, MCP/tool ecosystems, local-first models | Consistent cross-surface UX and policy behavior | High |
| 37 | Model quality adaptation | DSPy, LiteLLM, Aider, OpenRouter-style routing | Partial | 8.0-8.5 | Model selection, prompt optimization, routing rules, provider fallbacks | Outcome-aware routing tuned to DanteCode tasks | High |
| 38 | Latency / responsiveness | Tabby, Void, Continue, VS Code terminal/link UX | Partial | 8.0 | Low-latency completion paths, UI responsiveness patterns | End-to-end latency SLOs across chat/tools/preview | High |
| 39 | Observability / telemetry | OpenTelemetry, LangSmith-style evals, Helicone-style LLM telemetry | Yes, close | 8.5-9.0 | Traces, cost/latency logs, eval runs, failure attribution | Unified DanteCode maintainer dashboard | Highest |
| 40 | Configuration ergonomics | Continue, Cline, Tabby, Casdoor | Partial | 8.0 | Provider setup, config schemas, onboarding wizards | Delightful policy/model/tool setup in CLI and IDE | High |
| 41 | Offline / degraded-mode behavior | Tabby, LocalAI, Ollama, Aider | Yes, close | 8.5-9.0 | Local models, fallback behavior, offline-first habits | Better degraded-mode UX and proof artifacts | Medium |
| 42 | Data/privacy controls | Presidio, Gitleaks, TruffleHog, Ory, OpenFGA | Partial | 8.0-8.5 | Redaction, secret detection, identity/policy primitives | Productized privacy controls and retention policy | High |
| 43 | Documentation quality | Diataxis, Docusaurus, Nextra, Astro Starlight | Partial | 8.0 | Docs structure, recipes, tutorials, reference layout | DanteCode-specific beta docs and examples | High |
| 44 | Extensibility developer experience | Continue, Cline, MCP ecosystem, VS Code extension APIs | Yes, close | 8.5-9.0 | Provider/tool/plugin APIs, examples, extension patterns | Stable plugin SDK and marketplace workflow | High |
| 45 | Benchmark transparency | SWE-agent, OpenHands, benchmark harness repos | Yes, close | 8.5-9.0 | Reproducible benchmark harnesses and public methodology | Publishable DanteCode benchmark reports | Highest |
| 46 | Multi-repo / monorepo scale | Nx, Turborepo, Sourcegraph/Cody patterns | Partial | 8.0 | Workspace graph, caching, repo-scale indexing | Measured huge-repo performance and cross-repo context | High |
| 47 | Language/framework breadth | tree-sitter ecosystem, Continue, Tabby | Partial | 8.0 | Parser/index breadth and language-specific routing | Proof across Python, Rust, Go, Java, infra, and frontend stacks | High |
| 48 | Accessibility / inclusive UX | axe-core, VS Code accessibility guidance | Partial | 7.0-8.0 | Automated a11y checks, keyboard/screen-reader patterns | Real VS Code extension accessibility verification | Medium |
| 49 | Deployment / environment intelligence | Dev Containers, Docker Compose, Nix, E2B, OpenHands | Partial | 8.0-8.5 | Environment detection, sandbox lifecycle, deploy context | Agent repair loop tied to env/deploy evidence | High |
| 50 | Learning loop / self-improvement | DSPy, LangGraph, OpenHands, DanteForge artifacts | Yes, close | 8.5-9.0 | Feedback loops, outcome traces, policy improvement | Safe automated promotion of winning patterns | Highest |

## What This Means By Category

### Dimensions With Strong OSS Teachers

These are the dimensions where the OSS universe is already rich enough to materially move DanteCode toward `9`:

- `5` SWE-bench / correctness
- `8` Git-native workflow
- `12` Context injection / mentions
- `15` Agent autonomy
- `16` Plan / Act control
- `19` Test runner integration
- `20` Debug / runtime context
- `24` Reliability / rollback
- `26` Local model routing

### Dimensions Where OSS Gets Us Most Of The Way

These dimensions have good OSS lessons, but the last mile is still product and systems work:

- `1` Ghost text / FIM
- `3` Semantic search
- `4` Repo-level context
- `6` Inline edit UX
- `7` Multi-file diff
- `10` Full-app generation
- `11` Chat UX polish
- `17` Browser / computer use
- `18` PR review in IDE
- `21` Session memory
- `22` Skills / plugin ecosystem
- `23` Security
- `25` MCP ecosystem
- `27` Cost optimization

### Dimensions Where OSS Is Not Enough

These are the dimensions where we should stop expecting a clean OSS teacher to solve the whole problem:

- `9` Screenshot -> code still requires original vision-to-code product work, even though OSS can now teach a usable pipeline.
- `14` Browser live preview still requires original sandbox/preview integration, even though OSS can teach the execution substrate.
- `28` Enterprise still requires original product packaging and admin UX, even though OSS can teach identity and policy foundations.

These likely require proprietary-quality model work, infrastructure, or productization layers, even if OSS contributes some pieces.

## Expand The OSS Universe?

Yes, but selectively.

The next harvest should be dimension-driven, not “find more coding agents.”

### Expand Into Adjacent OSS Categories

| Target dimensions | Adjacent OSS universe to study | Why |
|---|---|---|
| 1, 6, 11 | Editor UX, completion, and next-edit systems | The best ideas may come from editor or completion projects, not full coding agents |
| 3, 4, 20, 21 | Retrieval, observability, runtime intelligence, knowledge systems | Repo context and memory quality depend on better ranking and runtime context, not just chat plumbing |
| 15, 16, 24 | Agent frameworks, orchestrators, benchmark harnesses | The autonomy gap is about loop quality and reliability more than UI |
| 17, 14 | Browser automation and computer-use systems | Coding-agent OSS is not the strongest teacher here |
| 18 | Diff/review tools, code intelligence, static analysis surfaces | PR review quality depends on analysis quality and UX, not just a review prompt |
| 23 | Sandboxing, policy engines, secret scanning, container isolation | Security leadership comes from depth, not a single regex scanner |

### Suggested Adjacent OSS Repos / Ecosystems To Add

These are not all coding-agent products, but they are relevant teachers:

- browser/control: Playwright ecosystem, BrowserGym-adjacent repos
- retrieval/context: search and ranking libraries, tree-sitter-heavy code intelligence repos
- runtime understanding: AppMap and similar execution-trace tools
- benchmark/eval: SWE-agent ecosystem, Live-SWE-Agent, related harnesses
- local completion/editing: Tabby and next-edit / FIM-oriented research implementations
- security: OSS secret scanners, policy engines, sandbox/container runtimes

## Original Engineering Still Required

Even after a strong OSS harvest, these are the main “invent it here” areas:

1. A premium DanteCode interaction layer  
   OSS can teach the structure, but not the exact taste. The last mile in chat UX, review UX, and confidence-building behavior is product craft.

2. A trusted autonomy loop in the main path  
   OpenHands and SWE-agent teach the loop, but DanteCode still needs its own operator-friendly version that feels safe, explainable, and useful in daily work.

3. Retrieval quality that wins on real repositories  
   Many OSS systems show how to assemble context. Fewer show how to rank the right context reliably under real latency budgets.

4. A memory system users trust  
   Remembering more is easy. Remembering the right things, at the right time, without becoming noisy, is hard.

5. Verification as product, not just philosophy  
   DanteCode’s moat is strongest here, but leadership requires benchmark proof, not just a strong design story.

## Highest-Leverage Next Moves

If the goal is to move DanteCode fastest with the best ROI, the next priorities should be:

1. `15` Wire the real autonomy loop into the main agent path  
   Learn from OpenHands and SWE-agent, but integrate it in DanteCode’s primary workflows.

2. `5` Run and publish a reproducible benchmark tranche  
   Learn from SWE-agent discipline and evaluation culture. This is the fastest path to stronger credibility.

3. `3` and `4` Upgrade retrieval and repo context with measurement  
   Learn from Continue and AppMap, then measure quality and latency in DanteCode directly.

4. `18` and `11` Improve the user-visible review and chat surfaces  
   Learn from Continue/Cline/adjacent review tooling, then out-execute with better integration and clarity.

5. `21` Turn memory into a better later-session experience  
   Learn from memory/knowledge OSS, but optimize for relevance, deduplication, and trust.

## 90-Day Build Map

### Track A — Must-win proof

- `5` benchmark tranche and failure clustering
- `15` autonomy loop integrated in primary path
- `24` reliability improvements tied to that loop

### Track B — Retrieval and context

- `3` semantic search quality measurement
- `4` repo context graph + runtime trace retrieval
- `20` tighter debug/runtime context flow

### Track C — Product quality

- `11` chat UX polish
- `18` PR review UX
- `21` visible memory quality

## Source Notes

Current OSS references used for this map include:

- OpenHands: https://openhands.dev/
- Aider git workflow docs: https://aider.chat/docs/git.html
- Continue Agent mode and context providers: https://docs.continue.dev/ide-extensions/agent/quick-start and https://docs.continue.dev/customize/custom-providers
- Continue changelog: https://changelog.continue.dev/
- Tabby: https://www.tabbyml.com/ and https://github.com/TabbyML/tabby
- AppMap / Navie: https://appmap.io/docs/using-navie-ai/using-navie.html and https://appmap.io/docs/appmap-docs.html
- SWE-agent: https://github.com/SWE-agent/SWE-agent and https://swe-agent-bench.github.io/
- Void changelog / releases: https://voideditor.com/changelog and https://github.com/voideditor/void/releases
- screenshot-to-code: https://github.com/abi/screenshot-to-code
- WebContainers: https://developer.stackblitz.com/platform/api/webcontainer-api
- E2B: https://github.com/e2b-dev/code-interpreter
- Browser Use: https://docs.browser-use.com/open-source/introduction
- Keycloak: https://www.keycloak.org/
- Ory: https://www.ory.com/open-source/
- Cerbos: https://www.cerbos.dev/
- Permify: https://github.com/Permify/permify
- OpenFGA: https://openfga.dev/
- Zitadel: https://zitadel.com/
- Casdoor: https://github.com/casdoor/casdoor
- OPAL: https://github.com/permitio/opal
- Ory Kratos: https://github.com/ory/kratos
- Ory Keto: https://github.com/ory/keto
- OpenTelemetry: https://opentelemetry.io/
- axe-core: https://github.com/dequelabs/axe-core
- Nx: https://nx.dev/
- Turborepo: https://turbo.build/repo

This document is intentionally more useful than flattering. If a dimension says OSS only gets us to `8`, that is a sign the remaining work is where the real value is.
