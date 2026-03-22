# CLARIFY.md

## Ambiguities Found
- PRD part 3 spans a full verification platform; this continuation wave closes the biggest remaining deterministic gaps with a checkpointed verification graph, generated QA cases, benchmark persistence, reasoning-chain hooks, subagent critic bridging, and a VS Code verification view.

## Missing Requirements
- The PRD still does not define a single canonical schema for output verification criteria, so the implementation keeps the deterministic local schema centered on keywords, sections, length, and rails.
- The PRD asks for "full integration" with reasoning chains and subagent spawning without prescribing exact API shapes, so this wave adds direct verification hooks and critic-opinion derivation rather than introducing a second orchestration system.

## Consistency Issues
- Earlier `.danteforge` artifacts described only the initial CLI/MCP verification slice and did not reflect the later benchmark, graph, and VS Code work.
- The repo already had checkpointer, reasoning-chain, and subagent primitives, but they were not yet tied into the verification layer.

## Clarification Defaults Used
1. Treat hard rails as blocking and soft rails as advisory warnings.
2. Use deterministic heuristics for output QA until model-backed critics or factual verification are wired in.
3. Reuse the existing event-sourced checkpointer to persist verification graph traces instead of adding a separate graph runtime package.
4. Default QA benchmark IDs to the CLI plan ID so benchmark history appears without extra user setup.
5. Use JSON input files for CLI verification commands so the slash-command surface stays stable and schema-compatible with the MCP tool contracts.

## Scope Boundary
- In scope: generated QA cases, verification graph traces, benchmark persistence, reasoning-chain verification hooks, subagent critic bridging, VS Code verification visualization, tests, and package verification.
- Out of scope: multimodal verification, model-optimized self-improvement loops, and automated PR-level QA for git-engine outputs.

## Spec Snapshot
See `.danteforge/SPEC.md` for the accepted PRD part 3 execution scope completed in this `/magic` run.
