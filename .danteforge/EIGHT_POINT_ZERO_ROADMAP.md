# DanteCode 8.0 Roadmap
Updated: 2026-04-21

This roadmap defines the shortest honest path from the current DanteCode
hostile-diligence score to a real `8.0+` overall product score on the canonical
50-dimension matrix.

Current baseline:

- Internal: `406 / 500 = 8.12`
- Publicly defensible: `386 / 500 = 7.72`
- Hostile diligence: `373 / 500 = 7.46`

Target:

- Hostile diligence: `400 / 500 = 8.00`

This is not a feature wishlist. It is a gap-closing plan against the top-tier
closed-source tools: `Cursor`, `Codex`, `Claude Code`, and `Devin`.

## Principles

- Score only what is wired, user-visible, and proven.
- Prefer outcome improvements over new subsystem count.
- Each roadmap item must produce a durable proof artifact.
- The main question is not "did we build it?" but "did this measurably improve
  the live user experience against the best tools?"

## Score Map

| Dimension | Current HD | Target HD | Gain | Main competitor pressure |
|---|---:|---:|---:|---|
| 1 Ghost text / FIM | 8 | 9 | +1 | Cursor |
| 6 Inline edit UX | 7 | 8 | +1 | Cursor |
| 8 Git-native workflow | 7 | 8 | +1 | Copilot, Devin |
| 10 Full-app generation | 7 | 8 | +1 | Codex, Devin |
| 11 Chat UX polish | 7 | 8 | +1 | Claude Code, Cursor |
| 13 Approval workflow | 8 | 9 | +1 | Devin, Copilot |
| 15 Agent / autonomy | 8 | 9 | +1 | Claude Code, Codex, Devin |
| 18 PR review | 8 | 9 | +1 | Copilot, Devin |
| 21 Session memory | 7 | 8 | +1 | Claude Code, Codex |
| 23 Security scanning | 8 | 9 | +1 | Copilot, Amazon Q |
| 27 Cost optimization | 8 | 9 | +1 | Codex, Claude Code |
| 20 Debug / runtime | 8 | 9 | +1 | Junie, Devin |
| 24 Reliability / health | 8 | 9 | +1 | Cursor, Copilot |
| 5 SWE-bench proof | 7 | 8 | +1 | Devin, OpenHands |
| 22 Skill / plugin system | 7 | 8 | +1 | Claude Code, Continue |
| 17 Browser / computer use | 7 | 8 | +1 | Devin, OpenHands |
| 29 Eval infrastructure | 8 | 9 | +1 | SWE-agent, OpenHands |
| 30 UX trust / explainability | 7 | 8 | +1 | Cursor, Claude Code, Cline |
| 31 Context governance | 8 | 9 | +1 | Copilot memory, Continue |
| 32 Human-agent collaboration | 7 | 8 | +1 | Cursor, Windsurf, Cline |
| 33 Task decomposition | 8 | 9 | +1 | OpenHands, Plandex, LangGraph |
| 34 Regression prevention | 8 | 9 | +1 | Semgrep, reviewdog, CI/eval systems |
| 35 Onboarding / time-to-value | 6 | 8 | +2 | Cursor, Continue, Tabby |
| 36 Ecosystem portability | 8 | 9 | +1 | Continue, Cline, MCP ecosystem |
| 37 Model quality adaptation | 8 | 9 | +1 | DSPy, LiteLLM, Aider |
| 38 Latency / responsiveness | 7 | 8 | +1 | Tabby, Void, Continue |
| 39 Observability / telemetry | 8 | 9 | +1 | OpenTelemetry, LangSmith-style evals |
| 40 Configuration ergonomics | 7 | 8 | +1 | Continue, Cline, Casdoor |
| 42 Data/privacy controls | 8 | 9 | +1 | Presidio, Gitleaks, Ory |
| 43 Documentation quality | 7 | 8 | +1 | Diataxis, Docusaurus, Nextra |
| 45 Benchmark transparency | 7 | 8 | +1 | SWE-agent, OpenHands |
| 46 Multi-repo / monorepo scale | 7 | 8 | +1 | Nx, Turborepo, Sourcegraph |
| 47 Language/framework breadth | 7 | 8 | +1 | tree-sitter, Continue, Tabby |
| 48 Accessibility / inclusive UX | 5 | 7 | +2 | axe-core, VS Code accessibility guidance |
| 49 Deployment / environment intelligence | 7 | 8 | +1 | Dev Containers, E2B, OpenHands |

Potential gain shown above: `+38`

That is enough to move DanteCode from `370` to `408`, just above the `8.0`
hostile-diligence threshold.

## Brutal Priority Table

| Priority | Dimension | Current HD | Target HD | Exact move | Proof required | Why it matters |
|---|---|---:|---:|---|---|---|
| P0 | 15 Agent / autonomy | 8 | 9 | Improve finish rate on ambiguous multi-step tasks; reduce loopiness; add failure-class routing to recovery, model selection, and verification plans | Real task-outcome trend showing higher completion rate on hard tasks, fewer retries, lower failure concentration | This is the biggest gap vs Claude Code, Codex, and Devin |
| P0 | 18 PR review | 8 | 9 | Turn review-history + review-comments into sharper review prompts, better comment prioritization, better false-positive suppression | Review-history trend showing higher resolution rate and lower follow-up churn, plus benchmarked review quality set | Strong review quality changes buyer perception fast |
| P0 | 29 Eval infrastructure | 8 | 9 | Convert seeded proof artifacts into reproducible eval commands and release gates | Eval trend report with repeatable tasks, failure clusters, and score-regression checks | Makes every other score defensible |
| P0 | 35 Onboarding / time-to-value | 6 | 8 | Create a guided first-run path that proves value in a real repo within minutes | First-run success artifact and setup friction log | Adoption ceiling, not just capability ceiling |
| P0 | 28 Enterprise | 6 | 7 | Add real IdP integration, persistent org store, and admin UX on top of harvested OSS leaders | Enterprise integration smoke test, admin policy UX, audit export, and role-check tests | Still a major enterprise-buying gap |
| P0 | 48 Accessibility | 5 | 7 | Add keyboard, contrast, and screen-reader checks for VS Code/webview surfaces | Accessibility report with axe/manual checks and fixed blockers | Beta readiness depends on inclusive UX |
| P0 | 1 Ghost text / FIM | 8 | 9 | Improve ranking and latency together; use per-language acceptance history in ranking, not just debounce | FIM acceptance trend improves materially across top languages; acceptance artifact updated from real sessions | Cursor pressure |
| P0 | 13 Approval workflow | 8 | 9 | Add richer approval states, line-level comment carry-forward, unresolved thread tracking, accept-per-file/hunk | Diff-quality and review-comment artifacts show actual approval depth and better downstream outcomes | Moves Dante from workflow plumbing to trustworthy collaboration |
| P0 | 10 Full-app generation | 7 | 8 | Improve end-to-end finish quality on app-building tasks by feeding outcome/review/security context into generation loops | Real app-task outcome set with higher verified finish rate | Codex and Devin pressure |
| P1 | 23 Security scanning | 8 | 9 | Merge static CVE list, npm audit, Semgrep, and SARIF into one first-class policy path with user-visible severity gates | Security artifact with multi-engine source attribution and lower false-positive rate | Strong enterprise-style credibility |
| P1 | 20 Debug / runtime | 8 | 9 | Make debug updates actionable in the loop: debugger-guided remediation, state-aware retries, watch-driven diagnosis | Debug-outcome artifact showing fewer repeated runtime failures after debug context injection | Junie/Devin pressure |
| P1 | 24 Reliability / health | 8 | 9 | Use provider health to rebalance routing and auto-fallback decisions, not only skip degraded providers | Health log + session outcomes showing lower provider-induced task failure rate | Trust compounder |
| P1 | 21 Session memory | 7 | 8 | Turn lessons and task outcomes into stronger per-task adaptation; promote what actually improves results | Memory artifact showing recalled patterns that correlate with better outcome success | Claude Code pressure |
| P1 | 27 Cost optimization | 8 | 9 | Use routing logs to actually optimize spend without hurting completion rate; add cost-per-success metrics | Cost-routing artifact + task outcomes showing lower cost per successful task | Lets Dante be "better and cheaper" credibly |
| P2 | 8 Git-native workflow | 7 | 8 | Improve branch naming, PR lifecycle, review-close loop, and commit/PR summary quality | Real PR lifecycle artifact chain from edit to close | Copilot/Devin pressure |
| P2 | 6 Inline edit UX | 7 | 8 | Reduce friction and increase precision in inline edits; improve partial acceptance and confidence signaling | Inline-edit acceptance / reversal metrics | Cursor pressure |
| P2 | 5 SWE-bench proof | 7 | 8 | Push from 10 runs to a stronger repeatable series with stable methodology and trend tracking | Larger benchmark artifact set with reproducible methodology | Benchmark credibility |
| P2 | 22 Skill / plugin system | 7 | 8 | Go beyond built-ins into real plugin ergonomics, policy, and outcome-aware execution | Plugin usage and outcome artifacts from real commands | Ecosystem credibility |
| P2 | 17 Browser / computer use | 7 | 8 | Better browser task recovery, state persistence, and outcome tracking | Browser-task artifact set with higher success rate | Helps close Devin/OpenHands gap |
| P3 | 11 Chat UX polish | 7 | 8 | Better summaries, state surfacing, proof visibility, and calmer turn structure | User-visible session/result artifacts with improved proof summaries | Important, but not the main moat |

## By Competitor

### Cursor

Main gaps:

- Ghost text quality
- Inline edit fluidity
- Everyday interaction polish

How to close:

- Use language-specific acceptance history to rank completions before display
- Improve acceptance-aware latency strategy rather than only debounce tuning
- Add edit confidence signals and better partial-accept flows

### Claude Code

Main gaps:

- Judgment under ambiguity
- Memory usefulness
- Trust in end-to-end execution

How to close:

- Feed lessons, task outcomes, review outcomes, and security outcomes back into
  the main loop as behavioral policy, not just prompt context
- Improve task success on messy requests
- Keep making proof artifacts first-class in every major workflow

### Codex

Main gaps:

- End-to-end task finishing power
- Hard-problem execution sharpness
- Full-app build confidence

How to close:

- Improve autonomy routing and failure recovery
- Increase verified finish rate on app tasks
- Reduce retries per successful task

### Devin

Main gaps:

- Async autonomy confidence
- Review lifecycle depth
- Browser/runtime orchestration

How to close:

- Use review close/history and task outcomes to create a tighter async loop
- Improve browser-task statefulness and recovery
- Raise completion quality on long-running tasks

## Execution Waves

### Wave 1: Outcome Superiority

Goal:

- Raise actual success rate on hard tasks.

Build:

- outcome-aware autonomy routing
- review sharpness tuning from review-history
- app-task benchmark set
- cost-per-success metric

Must prove:

- higher verified completion rate
- fewer retry loops
- fewer unresolved review findings

### Wave 2: Editor Superiority

Goal:

- Make Dante feel better in live IDE use.

Build:

- acceptance-aware FIM ranking
- per-language debounce and ranking feedback loop
- stronger inline edit confidence + partial acceptance UX

Must prove:

- better completion acceptance trend
- lower dismissal / reversal rate

### Wave 3: Trust Superiority

Goal:

- Make Dante easier to trust than a typical OSS tool.

Build:

- unified security policy path
- reliability routing from health events
- debug-guided repair loop
- proof-first summaries across sessions

Must prove:

- fewer provider-induced failures
- fewer repeated runtime failures
- stronger security finding quality

## Hard Gates For 8.0

Do not claim `8.0` hostile unless these are true:

- FIM acceptance history shows sustained gains in the main languages.
- Bench trend is based on enough runs to be meaningful, not just seeded data.
- Review-history and task-outcome artifacts show measurable quality improvement.
- The 50-dimension matrix is updated consistently and all `/280` and `/360` numbers are labeled historical.
- New dimensions `37-50` have evidence records, not narrative-only scores.
- Cost routing demonstrates lower cost per successful task, not just logging.
- Security combines multiple sources in the production path with usable outputs.
- Autonomy shows a visibly better finish rate on hard tasks.

## What Does Not Get Us To 8

These are tempting but not enough:

- more audit logs without behavior changes
- more seeded artifacts without real production emission
- more built-in commands without stronger plugin ergonomics
- more UI chrome without better outcomes
- more benchmark files without stronger benchmark performance

## Success Criteria

DanteCode reaches a real `8.0+` hostile-diligence score when:

- it is visibly best-in-class in at least a few important areas
- it is no longer obviously behind the top closed-source tools on trust
  fundamentals
- its artifact trail proves outcome quality, not just engineering effort

At that point, DanteCode is valuable not only as a product, but as proof that a
small, disciplined system can close on the market leaders through compounding
execution.
