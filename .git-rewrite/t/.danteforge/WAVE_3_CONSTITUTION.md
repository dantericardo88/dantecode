# Wave 3 Constitution: Context & Skills

**Status:** Active
**Date:** 2026-03-28
**Gaps Addressed:** A5 (Skills runtime v2), A6 (Repo awareness v2)

---

## Core Principles

### 1. Skills Are First-Class Citizens
- Skill loading is explicit and visible
- Every skill execution is tracked and receipted
- Skills can compose with gating between steps
- Provenance (source, license, trust) is always known

### 2. Context Is Precious
- Repo map provides fast overview of codebase structure
- Semantic index builds asynchronously (never blocks startup)
- Context pressure is visible to operator
- Condensing happens before context collapse

### 3. Tree-Sitter Over Regex
- Precise syntax-aware extraction beats pattern matching
- Language-specific parsers for accurate symbols
- Fallback to regex when tree-sitter unavailable
- Upgrade path preserves existing functionality

### 4. Background Work Doesn't Block
- Semantic indexing runs asynchronously
- Index readiness shown in status bar
- Partial index is usable (incremental value)
- Failed index doesn't crash agent loop

### 5. Composition Requires Gating
- Multi-skill chains have verification between steps
- DanteForge gates prevent cascading failures
- Each step produces receipts
- Failed steps don't auto-continue

---

## Pattern Sources

### Aider (Repo Map)
- `RepoMap` class with tree-sitter tag extraction
- PageRank scoring for symbol importance
- Fast context assembly for prompts
- Language-specific parsers

**What we adopt:** Tree-sitter integration, PageRank, structured tag extraction

### Qwen Code (Skills)
- Explicit skill invocation (`/skills run <name>`)
- Visible skill inventory
- Permission scoping per skill
- Skill composition support

**What we adopt:** Explicit invocation, visible inventory, event emission on load/use

### KiloCode (Indexing)
- Background codebase indexing
- Index readiness gauge in status bar
- Context condensing under pressure
- Incremental index updates

**What we adopt:** Background indexing, readiness gauge, context pressure visibility

---

## Success Criteria

| Metric | Target | Validation |
|--------|--------|------------|
| Tree-sitter coverage | >80% of common languages | Manual test: TS, JS, Python, Go, Rust |
| Repo map speed | <500ms for 1000-file repo | Benchmark test |
| Semantic index startup | Non-blocking | Agent loop starts before index completes |
| Index readiness visibility | Always shown in status | Manual UI check |
| Skill event emission | 100% of load/use | Event log verification |
| Skill composition gating | PDSE between steps | Multi-skill test |
| Context condensing | Triggers at >80% pressure | Pressure simulation test |
| CLI/VS Code parity | Skills work identically | Cross-platform test |

---

## Architecture Constraints

### Repo Map
- **Storage:** In-memory (regenerated on demand)
- **Format:** Structured tags with PageRank scores
- **Parsers:** Tree-sitter for TS/JS/Python/Go/Rust, regex fallback
- **Update:** On file change via watch (debounced)

### Semantic Index
- **Storage:** `.dantecode/index/<sessionId>.index` (SQLite or JSONL)
- **Build:** Asynchronous on startup, incremental on file change
- **Query:** Fast keyword/semantic search
- **Readiness:** Shown in status bar: `[idx: 45%]` → `[idx: ✓]`

### Skill Composition
```typescript
interface SkillChain {
  steps: SkillStep[];
  gating: 'none' | 'pdse' | 'manual';
  threshold?: number; // for pdse gating
}

interface SkillStep {
  skillName: string;
  input: string | SkillOutputRef; // e.g., "$previous.output"
  onFailure: 'abort' | 'continue' | 'prompt';
}
```

### Context Pressure
- **Metric:** `usedTokens / maxContextWindow`
- **Thresholds:**
  - <50%: green
  - 50-80%: yellow (warn)
  - >80%: red (condense)
- **Condensing:** Summarize older rounds, preserve recent context

---

## Non-Goals for Wave 3

- ❌ Full LSP integration (future)
- ❌ Multi-repo indexing (single repo only)
- ❌ Skill marketplace/discovery (local only)
- ❌ Real-time collaborative indexing (single-user)
- ❌ GPU-accelerated embeddings (CPU-only for now)

---

## Dependencies

- ✅ Wave 1 complete (mode enforcement, permission engine)
- ✅ Wave 2 complete (event store, checkpoints)
- ✅ `packages/skills-runtime` exists (created in earlier work)
- ✅ `packages/core/src/repo-map.ts` exists (regex-based, needs upgrade)
- ✅ Tree-sitter bindings available via npm (`tree-sitter`, `tree-sitter-typescript`, etc.)

---

## Risk Mitigation

### Risk: Tree-sitter parsing failures
**Mitigation:** Fallback to regex-based extraction. Log parser errors but don't crash.

### Risk: Semantic index grows unbounded
**Mitigation:** Session-scoped index files. Old sessions can be archived/deleted.

### Risk: Background indexing starves agent loop
**Mitigation:** Low-priority worker thread. Yield to main loop on back-pressure.

### Risk: Skill composition chains fail unpredictably
**Mitigation:** PDSE gating between steps. Each step is a checkpoint.

### Risk: Context condensing loses critical information
**Mitigation:** Preserve receipts, file paths, and recent rounds. Condense summaries only.

---

## Event Kinds (from Wave 2)

Already defined in Wave 2:
- `run.skill.loaded` - Skill loaded into runtime
- `run.skill.executed` - Skill execution completed
- `run.context.assembled` - Context prepared for prompt

No new event kinds needed for Wave 3.

---

**Status:** Ready for implementation
**Next Action:** Break into executable tasks
