# DanteCode Vision

## Product statement

DanteCode is a portable, model-agnostic skill runtime and coding agent.

The long-term goal is not to win by lock-in. The goal is to make coding workflows portable so developers can switch models without throwing away the skills and habits they already built.

## Core thesis

The real moat in coding agents is not just raw model intelligence. It is the accumulated library of reusable skills, prompts, workflows, and team habits around the tool.

If that layer stays vendor-locked, the best model does not necessarily win. The ecosystem with the highest switching cost wins.

DanteCode exists to break that dynamic.

## Strategic position

- Default provider: Grok
- Product identity: model-agnostic
- Verification layer: DanteForge
- Main wedge: Claude-style skill interoperability and portable runtime behavior

Grok is the default path because it is the clearest market gap today, not because DanteCode should become xAI-only infrastructure.

## What DanteForge does

DanteForge is the trust engine behind DanteCode:

- Anti-stub enforcement
- PDSE scoring
- Constitution checks
- GStack validation
- Autoforge iteration and lessons

The portability story only matters if the imported workflows are also trustworthy.

## OSS v1 ship target

Public OSS v1 is deliberately scoped:

- Stable CLI install path through npm
- Published core libraries
- Preview VS Code extension
- Beta desktop shell
- Strong local validation gates

It is not full GA across every surface.

## Principles

- Portable first: favor reusable skills and capability-based abstractions over vendor-shaped assumptions.
- Verification first: imported or generated workflows should prove themselves before landing.
- Clean-room interoperability: translate and validate external skill formats without relying on messy provenance stories.
- Honest surface area: stable, preview, and beta labels should reflect reality.
- Open ecosystem gravity: make DanteCode useful enough that vendors adapt to it, not the other way around.

## Non-goals for OSS v1

- Full enterprise release automation
- Zero-touch credential setup
- Every surface held to the same release-critical bar
- Perfect live-provider parity before the first public repo push

## Success signals

- Developers can import Claude-style skills without rebuilding them from scratch.
- Teams can switch providers without losing workflow leverage.
- DanteForge catches low-quality or unsafe output before it becomes trusted code.
- The project becomes more valuable as shared skills accumulate, without forcing a single-model future.
