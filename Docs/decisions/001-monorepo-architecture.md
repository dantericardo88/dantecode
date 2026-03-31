# ADR-001: Monorepo Architecture

**Status:** Accepted  
**Date:** 2026-03-31  
**Deciders:** Core team  

## Context

DanteCode consists of 27 packages with shared dependencies. We need to decide between:
1. **Monorepo:** All packages in single repository
2. **Polyrepo:** Each package in separate repository

## Decision

We will use a **monorepo with Turborepo** for all packages.

## Rationale

### Benefits
- ✅ **Atomic changes:** Refactor across packages in single PR
- ✅ **Shared tooling:** TypeScript, ESLint, Vitest, tsup configs shared
- ✅ **Type safety:** Cross-package imports are type-checked
- ✅ **Single version:** Simplified release process
- ✅ **Build caching:** Turbo speeds up CI (345ms for 52 typecheck tasks)

### Tradeoffs
- ⚠️ **Build complexity:** Requires Turbo orchestration
- ⚠️ **Larger repo:** ~100 MB vs individual repos
- ⚠️ **Circular deps:** Need careful dependency management

## Consequences

### Positive
- Developers can refactor fearlessly across package boundaries
- CI runs faster with Turbo caching (52 tasks in 345ms)
- No version mismatch issues between packages

### Negative  
- New contributors face steeper learning curve
- Circular dependencies emerged (core ↔ git-engine) requiring DI patterns
- Build failures affect entire workspace

## Alternatives Considered

### Polyrepo (Rejected)
- **Pro:** Simpler per-package, no circular dep risk
- **Con:** Cross-package refactoring requires coordinated PRs, version hell

### Lerna Monorepo (Rejected)  
- **Pro:** More mature than Turbo
- **Con:** Slower builds, less modern

## Status

**Active.** Monorepo is working well. Future optimization: Consider consolidating 27 packages to ~15-20 to reduce complexity.

## Related

- [ADR-002: Package Dependency Strategy](./002-package-dependencies.md)
- [ARCHITECTURE.md](../../ARCHITECTURE.md)
