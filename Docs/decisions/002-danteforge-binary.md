# ADR-002: DanteForge as Compiled Binary

**Status:** Accepted  
**Date:** 2026-03-31  
**Deciders:** Core team, security review  

## Context

DanteForge provides PDSE (Plan-Do-Study-Execute) verification scoring. We need to decide:
1. **Open source:** Ship verification logic as TypeScript source
2. **Compiled binary:** Ship as opaque compiled binary

## Decision

DanteForge ships as a **compiled binary** (`@dantecode/danteforge`), not source code.

## Rationale

### Benefits
- ✅ **IP protection:** Verification scoring algorithm is proprietary
- ✅ **Tamper-proof:** Users cannot modify scoring logic
- ✅ **Clean separation:** DanteCode = runtime (OSS), DanteForge = judge (closed)
- ✅ **Rapid iteration:** Can improve scoring without DanteCode releases

### Tradeoffs
- ⚠️ **Trust issue:** Users must trust black-box scoring
- ⚠️ **Debugging:** Only DanteForge team can debug scoring issues
- ⚠️ **Binary size:** ~500 KB vs source would be smaller when bundled

## Consequences

### Positive
- Verification integrity maintained (no gaming the metric)
- Business model viable (value in verification quality)
- Security-sensitive scoring logic protected

### Negative
- Community cannot audit scoring decisions
- Debugging requires DanteForge team involvement
- Platform-specific builds needed (x64, ARM)

## Alternatives Considered

### Full Open Source (Rejected)
- **Pro:** Complete transparency, community trust
- **Con:** Scoring could be gamed, IP loss, competitors copy algorithm

### Hybrid (Partial Open Source) (Rejected)
- **Pro:** Some transparency for core logic
- **Con:** Still reveals enough to game, complex licensing

## Status

**Active.** Binary distribution working well. Users accept tradeoff for quality verification.

## Implementation Details

```typescript
// DanteCode imports as opaque binary
import { pdseScore } from "@dantecode/danteforge";

const score = await pdseScore(artifact, constitution);
// Returns 0-100, no visibility into how
```

**Type definitions provided** (`.d.ts`) for IDE support, but implementation is compiled.

## Related

- [ADR-003: Sandbox Isolation Strategy](./003-sandbox-isolation.md)
- [Security Model](../../ARCHITECTURE.md#security-model)
