# Competitive Landscape Masterplan

Date: 2026-04-23  
Lens: serious solo builder, adoption ignored  
Rule: no product gets credit for wiring alone; a high score requires visible, current, source-backed capability.

## Executive truth

The canonical matrix is now 50 dimensions. The original 28 dimensions remain the
capability core, dimensions `29-36` score product-frontier quality, and dimensions
`37-50` score frontier operating quality: adaptation, responsiveness,
observability, configuration, degraded-mode behavior, privacy, docs,
extensibility, benchmark transparency, scale, language breadth, accessibility,
deployment intelligence, and self-improvement.

DanteCode is now a very strong OSS-first coding-agent system and a frontier-adjacent
engineering project. It is not honestly the overall closed-source leader yet.
Cursor and Codex remain ahead in the harsh full-universe read, while Claude Code is
still close because of its terminal/MCP/routines surface. DanteCode's strongest
advantages are verification, safety, local routing, cost posture, and proof-heavy
engineering discipline.

## Provisional current scores

These are provisional `/500` composites. Third-party rows remain lower confidence
than DanteCode because their evidence is mostly official docs, changelogs, and
limited public proof rather than local inspection.

### Closed source

| Product | Provisional score | Why |
|---|---:|---|
| Cursor | 8.2 | Strongest editor-native product feel: completions, multi-agent workflows, responsiveness, collaboration, and onboarding |
| Codex | 8.1 | Very strong agent breadth: computer use, plugins, PR review, SSH/devbox workflow, eval momentum, and model adaptation |
| DanteCode | 7.8 | Proof-heavy OSS leader with strong autonomy, routing, safety, cost, memory, retrieval, debug evidence, and learning loops |
| Claude Code | 7.6 | Excellent terminal-first agent with strong MCP/tooling, git/CI workflows, routines, and broad surface area |
| GitHub Copilot | 7.3 | Strong enterprise/cloud agent, review, memory, admin, privacy, and governance story |
| Windsurf | 7.2 | Strong IDE agent with Cascade, terminal, MCP, memories, workflows, and polished interaction |
| Devin | 7.1 | Autonomy-forward, with strong async delegation and environment handling |
| JetBrains AI | 6.3 | Strong debugger/IDE depth, weaker full-spectrum agent posture |
| Cody | 6.0 | Strong search/context heritage, weaker current frontier agent story |
| Replit | 5.7 | Strong hosted app-building loop, different center of gravity |
| Bolt | 4.1 | Excellent in narrow app-generation lanes, weak as a general coding agent |
| v0 | 4.1 | Excellent in narrow UI/screenshot-to-code lanes, weak as a general coding agent |

### Open source

| Product | Provisional score | Why |
|---|---:|---|
| DanteCode | 7.8 | Most balanced OSS-first coding-agent system when safety, verification, routing, breadth, and proof are considered together |
| Continue | 6.2 | Strong context-provider, IDE, configuration, docs, and portability lessons |
| Cline | 6.1 | Strong real-world editor agent, human-agent steering, and onboarding lessons |
| OpenHands | 6.0 | Best OSS autonomy/sandbox/eval/deployment-environment reference |
| Aider | 5.9 | Best terminal-native git workflow reference |
| Void | 5.5 | Useful editor UX and inline-edit ideas, with lower momentum confidence |
| Tabby | 5.1 | Strong local/self-hosted completion and offline behavior reference |
| AppMap / Navie | 4.8 | Important runtime-aware context lesson |
| Refact | 4.6 | Useful local assistant/completion reference |
| SWE-agent | 4.4 | Important benchmark/autonomy niche, narrow product breadth |

## What the new dimensions changed

The expanded matrix exposes gaps that the 28-dimension capability matrix hid:

- `29 Eval infrastructure`: DanteCode is strong, but needs repeatable release gates and larger public eval tranches.
- `30 UX trust`: proof artifacts exist, but user-facing explainability is not yet Cursor-grade.
- `31 Context governance`: memory staleness and context proof exist, but citation/expiry controls need productization.
- `32 Collaboration`: approvals and plans exist, but mid-run steering/handoff can become much better.
- `33 Task decomposition`: DanteCode is strong after the autonomy and triage sprints.
- `34 Regression prevention`: tests are strong, but score regression dashboards should become first-class.
- `35 Onboarding`: this is a real weakness; first-run time-to-value trails polished products.
- `36 Portability`: CLI/editor/model/provider flexibility is a DanteCode strength.
- `37-50 Frontier operating dimensions`: DanteCode remains strong on observability, offline posture, privacy, extensibility, and learning loops; the biggest new drag is accessibility plus beta docs/configuration polish.

## Low-score dimensions with OSS teachers

| Dimension | DanteCode gap | OSS teachers |
|---|---|---|
| 9 Screenshot-to-code | No integrated vision-to-code lane | `abi/screenshot-to-code`, WebSight, VisRefiner, ScreenCoder-style repos |
| 14 Browser live preview | No sandbox preview/hot-reload loop | StackBlitz WebContainers, E2B, OpenHands, Browser Use |
| 28 Enterprise | No SSO/RBAC/audit/admin backend | Keycloak, Ory, Cerbos, Permify, Zitadel, OpenFGA |
| 35 Onboarding | Powerful but not beginner-smooth | Continue, Cline, Tabby, OpenHands |
| 38 Latency | Full-system SLOs not yet measured | Tabby, Void, Continue |
| 40 Configuration | Powerful but not delightful | Continue, Cline, Casdoor |
| 43 Documentation | Public beta docs need depth | Diataxis, Docusaurus, Nextra |
| 48 Accessibility | Explicit accessibility testing is thin | axe-core, VS Code accessibility guidance |

## Rebuild protocol

1. Keep the canonical 50 dimensions as the source of truth.
2. Require every `8` or `9` to cite one of: official product docs, official changelog, benchmark result, local artifact, or hands-on validation.
3. Split evidence types into `docs_claim`, `user_visible_verified`, `benchmark_verified`, `local_artifact`, and `inferred`.
4. Mark any score with more than 30% inference as provisional.
5. Keep `/280` and `/360` totals only as historical references.

## Next work

The next matrix-improving research target should be `18` PR review sharpness:
diff risk clustering, severity ranking, false-positive suppression, and review
outcome correlation. It compounds correctness, memory, debug context, diff quality,
and user trust faster than another instrumentation-only sprint.

## Current source set

- Cursor: https://cursor.com/changelog
- Cursor docs: https://docs.cursor.com/
- OpenAI Codex: https://openai.com/codex/
- OpenAI Codex update: https://openai.com/index/codex-for-almost-everything/
- Claude Code overview: https://code.claude.com/docs/en/overview
- Claude Code MCP: https://code.claude.com/docs/en/mcp
- Claude Code routines: https://claude.com/blog/introducing-routines-in-claude-code
- GitHub Copilot coding agent: https://docs.github.com/en/copilot/concepts/coding-agent/about-copilot-coding-agent
- GitHub Copilot memory: https://docs.github.com/en/copilot/concepts/agents/copilot-memory
- Windsurf docs: https://docs.windsurf.com/windsurf/getting-started
- Devin docs: https://docs.devin.ai/
- OpenHands: https://github.com/All-Hands-AI/OpenHands
- Aider: https://aider.chat/docs/git.html
- Continue: https://docs.continue.dev/
- Tabby: https://github.com/TabbyML/tabby
