# Competitive Landscape Masterplan

_Updated: 2026-04-29 | Canonical matrix: 50 dimensions_

The active competitive landscape is now governed by:

- `.danteforge/COMPETITIVE_MATRIX.md`
- `.danteforge/compete/matrix.json`
- `.danteforge/rubric.json`

## Executive Truth

DanteCode is a serious local-first coding-agent system with real strengths in
model routing, git-native workflow, skill/plugin extensibility, test integration,
observability, and self-improvement discipline. It is not yet a frontier product
against the full closed-source and OSS peer set.

Current harsh baseline: `287.2 / 500 = 5.74`.

The primary weakness is not ambition. The weakness is missing proof and product
finish across broad user-visible dimensions: accessibility, reproducible
benchmarks, enterprise readiness, browser preview, screenshot-to-code, onboarding,
configuration ergonomics, language breadth, and deployment intelligence.

## Current Peer Read

| Peer group | Leaders to learn from | DanteCode stance |
|---|---|---|
| Editor-native closed source | Cursor, GitHub Copilot, Claude Code, Windsurf | Behind on polish, completions, inline edit UX, collaboration, onboarding, and PR review surface. |
| Cloud/autonomous agents | OpenAI Codex, Devin, Replit Agent | Behind on cloud task execution, benchmarks, environment intelligence, preview/deploy loops, and public proof. |
| Large-repo context | Augment Code, Sourcegraph Cody | Behind on measured semantic search and monorepo/cross-repo scale. |
| OSS autonomous agents | OpenHands, Cline, SWE-agent | Strong enough to learn from, not yet above them on public eval transparency or browser/terminal autonomy proof. |
| OSS git/editor assistants | Aider, Continue, Kilo Code, Roo Code, Tabby | Competitive in architecture, behind on time-to-value, docs, and broad usage/adoption evidence. |

## Closing Strategy

1. Make the local gates green before claiming any score lift.
2. Convert the 50-dimension rubric into the scorer path so `danteforge score` and
   `frontier-gap` share the same source.
3. Attack P0 catch-up gaps first: accessibility, SWE-bench/correctness,
   enterprise, benchmark transparency, screenshot-to-code, browser preview, and
   onboarding.
4. Harvest OSS mechanics from OpenHands, Cline, Aider, Continue, Tabby,
   SWE-agent, axe-core, OpenTelemetry, and LiteLLM.
5. Promote a dimension only when its proof would survive hostile diligence:
   end-to-end test, smoke path, trace, benchmark artifact, or repeatable release
   gate evidence.

## Working Rule

Every score increase must answer: what proof changed, why does that proof map to
the rubric, and why would a skeptical evaluator agree?
