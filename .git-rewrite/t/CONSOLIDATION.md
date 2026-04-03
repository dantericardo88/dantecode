# DanteCode Package Consolidation Plan

**Status:** Plan only — no code changes in this document
**Target:** 23 packages → 10 packages
**Sprint:** Post-OnRamp

## Current State

| # | Package | LOC | Runtime Deps | Dependents | Action |
|---|---------|-----|-------------|------------|--------|
| 1 | cli | 25,132 | 15 @dantecode/*, yaml, zod | — | KEEP (entry point) |
| 2 | core | 42,033 | @ai-sdk/anthropic, @ai-sdk/openai, @octokit/rest, ai, yaml, zod | 15 packages | KEEP (anchor) |
| 3 | config-types | 1,051 | — | 15 packages | KEEP (shared types) |
| 4 | danteforge | 1,185 | sql.js, zod | 6 packages | KEEP (compiled binary) |
| 5 | git-engine | 6,646 | yaml | 5 packages | KEEP |
| 6 | memory-engine | 3,915 | — | 2 packages | KEEP |
| 7 | debug-trail | 6,167 | @dantecode/evidence-chain | 2 packages | KEEP |
| 8 | ux-polish | 6,263 | — | 3 packages | KEEP |
| 9 | skill-adapter | 6,132 | yaml | 3 packages | KEEP |
| 10 | vscode | 11,466 | @dantecode/danteforge, @dantecode/git-engine, @dantecode/skill-adapter, @dantecode/ux-polish | 0 packages | KEEP |
| 11 | sandbox | 876 | dockerode | 3 packages | MERGE → sandbox |
| 12 | dante-sandbox | 1,968 | @dantecode/sandbox, zod | 2 packages | MERGE → sandbox |
| 13 | runtime-spine | 840 | zod | 9 packages | ABSORB → core |
| 14 | agent-orchestrator | 274 | @dantecode/web-research, zod | 2 packages | ABSORB → core |
| 15 | web-research | 813 | cheerio, node-fetch, zod | 4 packages | ABSORB → core |
| 16 | web-extractor | 781 | zod | 3 packages | ABSORB → core |
| 17 | evidence-chain | 691 | — (node:crypto) | 2 packages | ABSORB → core |
| 18 | dante-gaslight | 3,079 | zod | 2 packages | SPLIT → core + cli |
| 19 | dante-skillbook | 994 | zod | 2 packages | SPLIT → core + cli |
| 20 | mcp | 1,891 | @modelcontextprotocol/sdk, zod | 1 package | FOLD → cli |
| 21 | temp-ddgs-harvest | 0 (Python) | duckduckgo-search | 0 packages | REMOVE (dead) |
| 22 | jetbrains | 0 (Kotlin) | — | 0 packages | REMOVE (dead) |
| 23 | desktop | 249 | — | 0 packages | REMOVE (beta, not shipped) |

## Target State: 10 Packages

1. **config-types** — shared type definitions (unchanged)
2. **core** — absorbs runtime-spine, agent-orchestrator, web-research, web-extractor, evidence-chain, gaslight-core, skillbook-core
3. **danteforge** — compiled binary (unchanged)
4. **git-engine** — git operations + automation (unchanged)
5. **skill-adapter** — skill parsing and bridging (unchanged)
6. **sandbox** — absorbs dante-sandbox (unified sandbox)
7. **memory-engine** — semantic memory (unchanged)
8. **debug-trail** — debug/trace infrastructure (unchanged)
9. **ux-polish** — UX enhancements (unchanged)
10. **cli** — absorbs mcp, gaslight-cli, skillbook-cli
11. **vscode** — VSCode extension (unchanged)

## Consolidation Waves

### Wave 1: Remove Dead Packages (Zero Risk)
- Remove `temp-ddgs-harvest` — Python code, not a workspace member, 0 TS LOC
- Remove `jetbrains` — Kotlin/Gradle, 0 TS LOC, no dependents
- Remove `desktop` — 249 LOC, beta, no dependents
- **Estimated effort:** 1 hour (delete dirs, update workspace config)

### Wave 2: Absorb Leaf Packages (Low Risk)
- Absorb `runtime-spine` (840 LOC) → `core/runtime/` — pure types/schemas, many dependents
  - Risk: 9 packages import from `@dantecode/runtime-spine` (agent-orchestrator, cli, dante-gaslight, dante-sandbox, dante-skillbook, mcp, web-extractor, web-research, plus runtime-spine itself)
  - Mitigation: Create re-export shim package for 1 release cycle
- Absorb `evidence-chain` (691 LOC) → `core/evidence/` — zero deps, only `node:crypto`
  - Risk: Minimal — only debug-trail depends on it
  - Mitigation: Update debug-trail imports in same wave
- **Estimated effort:** 4-6 hours

### Wave 3: Absorb Small Packages (Medium Risk)
- Absorb `agent-orchestrator` (274 LOC) → `core/agent-orchestrator/`
- Absorb `web-research` (813 LOC) → `core/web-research/`
  - Risk: Brings `cheerio` + `node-fetch` into core dependencies
  - Mitigation: Lazy dynamic imports for optional deps
- Absorb `web-extractor` (781 LOC) → `core/web-extractor/`
- **Estimated effort:** 4-6 hours

### Wave 4: Merge & Fold (Medium Risk)
- Merge `sandbox` (876 LOC) + `dante-sandbox` (1,968 LOC) → unified `sandbox` package (2,844 LOC combined)
  - dante-sandbox already depends on sandbox
  - Keep `dockerode` as optional peer dep
- Fold `mcp` (1,891 LOC) → `cli`
  - MCP server is a CLI subcommand, natural fit
  - Brings `@modelcontextprotocol/sdk` into CLI deps
- **Estimated effort:** 6-8 hours

### Wave 5: Split & Redistribute (Higher Risk)
- Split `dante-gaslight` (3,079 LOC): core logic → `core/gaslight/`, CLI integration → `cli/commands/gaslight.ts`
- Split `dante-skillbook` (994 LOC): core logic → `core/skillbook/`, CLI integration → `cli/commands/skillbook.ts`
- **Estimated effort:** 8-10 hours
- **Risk:** Complex re-export paths, potential circular deps
- **Mitigation:** Integration tests before and after, re-export shims

## Dependency Graph Risks

1. **runtime-spine absorption is highest risk** — 9 packages import from it. Every import path must be updated. Consider keeping a `@dantecode/runtime-spine` package that re-exports from `@dantecode/core` for 1 major version.

2. **cheerio/node-fetch in core** — web-research absorption brings runtime deps into core. Use lazy `await import("cheerio")` to keep them optional.

3. **evidence-chain into core (not danteforge)** — danteforge is a compiled binary; source-level integration isn't possible. Absorb into core instead.

## Build Graph Impact

- **Before:** 23 packages, turbo resolves ~40 dependency edges, builds take ~45s
- **After:** 10 packages, ~15 dependency edges, estimated build time ~25s
- **Each remaining package has >1K LOC** and a clear independent lifecycle

## Backward Compatibility Strategy

For any absorbed package with external consumers (runtime-spine):
1. Keep the original package.json
2. Replace all source with re-exports from the new location
3. Publish as a "shim" package for 1 major version
4. Deprecate with `npm deprecate` message pointing to new import path
5. Remove shim in next major version
