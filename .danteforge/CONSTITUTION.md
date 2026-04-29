# DanteCode Constitution
_Established: 2026-04-14 | Revised: 2026-04-29 | Phase: Personal -> Enterprise_

---

## Clarification: Zero Ambiguity Policy

Every decision in this document is final. No ambiguity is tolerated: a feature either
works end-to-end or it does not exist. Scores are binary pass/fail at the gate level
even if the matrix is continuous. When in doubt, the Iron Law resolves all ambiguity.

## Local-First Architecture

DanteCode operates local-first: all code context, completions, and session memory stay
on the developer's machine by default. Cloud APIs are used for intelligence only; no
source code leaves the machine without explicit user consent. Local models via Ollama
are first-class citizens. Network failures degrade gracefully.

## Mission

Build the best AI coding tool in existence, scoring 9+ on every dimension of a
50-dimension competitive matrix against the major closed-source and OSS coding-agent peers.
Start as the author's own daily driver. Architect for enterprise from day one.

---

## Core Principles

### 1. Hyper-Critical Honesty

Scores are earned, never rounded up. A feature that is wired but not smoke-tested
in VS Code does not count. Dead code paths do not count. Sprint memories that claim
scores without end-to-end validation are inflated and must be corrected. The matrix
is the truth. The composite is the average of 50 honest scores.

### 2. Moat-First Architecture

Competitive advantages compound. Strong foundations such as local model routing,
git-native workflow, the skill/plugin system, test runner integration, telemetry,
and the learning loop must not regress while weaker dimensions are closed. A moat
exists only when it is still working in the product path and verified by gates.

### 3. Constitutional OSS Harvesting

OSS patterns are extracted constitutionally via `/harvest` before `/nova` or
`/inferno` executes them. We learn mechanics, never copy code. Every harvest track
is immutable and traceable. Partial harvests leave value on the table; exhaust each
source completely before moving on.

### 4. Enterprise-Ready from Day One

Current user: solo developer. Future user: engineering teams of 100+. Every
architectural decision must support multi-user sessions, org-level configuration,
audit trails, and compliance requirements, even when these features are not yet
built. Never paint into a corner that blocks the enterprise path.

### 5. Self-Improving Autonomy

The primary development method is the autocycle: `assess -> masterplan -> forge ->
verify -> repeat`. Manual sprint decisions are a fallback, not the default.
`danteforge self-improve` is the correct entry point for gap closure. `/autoresearch`
handles metric-driven overnight optimization. Human judgment is reserved for goal
specification, metric definition, and strategic pivots.

### 6. Zero Tolerance for Incomplete Code

No incomplete implementations, no `throw new Error(/* not wired */)`, no deferred
wiring comments. Every declared variable must be used (`noUnusedLocals: true`).
Every exported function must have a real call path. The completeness gate is
mandatory before every commit.

### 7. Atomic Commit Discipline

Every commit is atomic: it compiles, passes all tests, and passes the completeness
gate. Partial work is never committed. The rule: verify before commit; run all 6
gates before a score improvement is recorded. A commit that breaks the build is
reverted immediately.

---

## Non-Negotiable Quality Gates

Every sprint output must pass all of the following before a score improvement is claimed:

| Gate | Tool | Threshold |
|---|---|---|
| TypeScript compilation | `npm run typecheck` | 0 errors in production files |
| Test suite | `npx vitest run` | 0 new failures; all prior tests still pass |
| Completeness gate | `node scripts/anti-stub-check.cjs` | 0 violations in new files |
| PDSE artifact scores | `danteforge_score_all` | All present artifacts >= 7.0 |
| Verify receipt | `danteforge_verify` | status: completed, 0 failures |
| Smoke test | Manual VS Code test OR `/browse` automation | Feature visible + working end-to-end |

A feature exists only when all 6 gates pass.

---

## Architecture Constraints

- **Language:** TypeScript strict mode (`noUnusedLocals`, `noUnusedParameters`, `strictNullChecks`)
- **Runtime:** Node.js 24.x, ESM modules, no CommonJS in new packages
- **Build:** tsup via Turborepo; no webpack, no rollup, no custom build scripts
- **Tests:** Vitest 3.x; no Jest, no Mocha
- **Dependencies:** MIT / Apache-2.0 / BSD only; no GPL, no AGPL, no proprietary SDKs
- **Security:** All Bash execution routes through DanteSandbox fail-closed. No `git clean`, no `rm -rf`, no shell string injection; use `execFileSync(cmd, args[])` everywhere.
- **Monorepo:** 35 packages under `packages/`; new packages only when a domain boundary justifies it
- **Commits:** `[DanteForge]` prefix for autonomous commits. All commits pass pre-commit hook.

---

## Competitive Quality Standards

**Target:** 9+ on all 50 dimensions simultaneously.

**Current harsh baseline (2026-04-29):** 287.2 / 500 = 5.74 composite

**Strongest foundations to protect (never regress):**

- local model routing: 7.5 -> target 9
- git-native workflow: 7.2 -> target 9
- skill / plugin system: 7.2 -> target 9
- test runner integration: 7.0 -> target 9
- observability / telemetry: 7.0 -> target 9
- learning loop / self-improvement: 7.0 -> target 9

**Biggest gaps to close (in ROI order):**

1. accessibility / inclusive UX: 2.5 -> 9
2. SWE-bench / correctness: 3.5 -> 9
3. enterprise readiness: 3.5 -> 9
4. benchmark transparency: 3.5 -> 9
5. screenshot -> code: 4.0 -> 9
6. browser live preview: 4.0 -> 9
7. onboarding / time-to-value: 4.5 -> 9

---

## Phase Roadmap

### Phase 1 - Personal Power Tool (current)

- Author as primary user
- All 50 dims at 9+ on the competitive matrix
- Zero daily friction in VS Code
- Full autonomous self-improvement loop operational

### Phase 2 - Team Alpha (next)

- Invite 3-5 developers as early users
- Multi-user session sharing (read-only observer mode)
- Skill sharing across team members
- Usage telemetry for quality signal

### Phase 3 - Enterprise Product (future; date to be scheduled)

- SSO/SAML, org management, role-based access
- Compliance audit logs (SOC2-ready)
- Team dashboards, cost allocation per user
- Enterprise SLA and support tier

---

## Self-Edit Policy

`selfEditPolicy: deny` - DanteCode must never modify its own core agent loop,
circuit breakers, or safety systems autonomously. These require human review.
Sprint code can be auto-committed. Infrastructure changes require explicit human
approval.

---

## The Iron Law

**The competitive matrix is the source of truth. Every number must be earned.
No score inflation. No rounding. No claiming credit for dead code.
A dimension improves only when the feature works end-to-end and all 6 gates pass.**

---

_Constitution ratified 2026-04-14. Revised 2026-04-29 by explicit user instruction._
