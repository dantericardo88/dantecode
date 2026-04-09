# Autoresearch Pass 2 — Real-World Integration Tests

**Date**: 2026-03-22
**Branch**: `feat/dantecode-9plus-complete-matrix`

## Test Matrix

| Test | Package | Assertions | Result |
|------|---------|-----------|--------|
| 2.1 Evidence Chain Consumer | @dantecode/evidence-chain | 39/39 | PASS |
| 2.2 DanteForge PDSE Scorer | @dantecode/danteforge | 29/29 | PASS |
| 2.3 Memory Cross-Session | @dantecode/core (PersistentMemory) | 11/11 | PASS |
| 2.4 Skill Adapter Import | @dantecode/skill-adapter | 105/105 | PASS |
| 2.5 Debug Trail Load | @dantecode/debug-trail | 12/12 | PASS |
| 2.6 VSCode Extension VSIX | dantecode (VSCode) | Build OK | PASS |
| **Total** | | **196** | **6/6 PASS** |

## API Discoveries

### evidence-chain
- `HashChain` requires genesis data in constructor, starts at length=1
- `exportToJSON()` returns `{ chain: [], ... }` not `{ blocks: [] }`
- `MerkleTree.verifyProof()` is static
- `ReceiptChain` uses `.size` not `.length`
- `verifyBundle()` returns boolean not object
- `EvidenceSealer.verifySeal()` requires original config + metrics

### danteforge (compiled binary)
- `PDSEScore` uses `overall` (not `score`) and `passedGate` (not `passed`)
- `runLocalPDSEScorer` works without LLM — pure static analysis
- `runConstitutionCheck` catches eval/injection patterns
- `scanFile` propagates filePath to result

### memory-engine
- `PersistentMemory.search()` is synchronous
- Requires explicit `await memory.load()` on new instances before searching
- `store()` calls `load()` internally

### debug-trail
- `TrailQueryEngine({ storageRoot })` — takes config not store
- Query uses `kinds: ["tool_call"]` (plural array) not `kind: "tool_call"`
- `DebugTrailResult.results` not `.events`
- `FlushResult.analyzedCount` not `.flushedCount`

### skill-adapter
- 40+ function exports, 2 class exports (SkillCatalog, SkillChain)
- `scanClaudeSkills` handles empty/missing dirs gracefully
- `verifySkill` returns tier-based scoring (sovereign/sentinel/guardian)
- `sanitizeSlug` strips path traversal

### VSCode Extension
- VSIX packages to 924KB (8 files)
- Contents: extension.js, extension.d.ts, .js.map, package.json, sidebar-icon.svg, theme.css
