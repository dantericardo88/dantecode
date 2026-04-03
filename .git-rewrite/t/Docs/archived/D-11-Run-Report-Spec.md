# D-11: Run Report Generation — The Trust Layer

**Addition to PRD: DanteCode v1.3 "OnRamp"**  
**Root Causes Addressed:** 2 (scoring measures engineering, not experience), 3 (self-referential loop)  
**Date:** March 22, 2026

---

## Problem

When DanteCode runs `/party` or `/magic` against a project with multiple PRDs, the user has no reliable way to know what actually happened. DanteCode says "done" but:

- Did it actually create all the files it said it would?
- Did verification pass on everything or did some tasks silently fail?
- Were all PRDs attempted or did execution stop early?
- What needs manual attention?

The user cannot read code. The user cannot run tests. The user cannot diff files. The only thing the user can do is carry a document from one AI workspace to another and ask "is this true?" That document must exist, must be honest, and must be machine-readable so other AIs can verify it.

---

## Success Criteria

| # | Criterion | Measurement |
|---|-----------|-------------|
| SC-D11-1 | Every `/party` and `/magic` run produces a report file in `.dantecode/reports/` | File exists after run |
| SC-D11-2 | A separate Claude Code session can read the report and verify every claim against the actual filesystem within 5 minutes | Timed test |
| SC-D11-3 | The report clearly distinguishes COMPLETE / PARTIAL / FAILED / NOT ATTEMPTED for every task | Visual inspection |
| SC-D11-4 | The report lists every file created, modified, and deleted with before/after evidence | Diff against filesystem |
| SC-D11-5 | The report is honest — if DanteCode failed, the report says FAILED, not "passed with warnings" | Adversarial test: deliberately break a PRD and verify report catches it |

---

## Report Format

**File location:** `.dantecode/reports/run-{ISO-timestamp}.md`  
**Example:** `.dantecode/reports/run-2026-03-22T14-30-00Z.md`

```markdown
# DanteCode Run Report

**Project:** DirtyDLite  
**Command:** /party --prds ./prds/*.md  
**Started:** 2026-03-22T14:30:00Z  
**Completed:** 2026-03-22T15:45:00Z  
**Duration:** 1h 15m  
**Model:** Claude Sonnet 4 (Anthropic)  
**Cost estimate:** ~$4.20 (input: 125K tokens, output: 89K tokens)

## Summary

| Status | Count |
|--------|-------|
| ✅ Complete | 20 |
| ⚠️ Partial | 3 |
| ❌ Failed | 1 |
| ⏭️ Not attempted | 1 |
| **Total** | **25** |

**Completion rate: 80% (20/25)**  
**Needs attention: PRDs 3, 14, 21, 22, 25**

---

## PRD Results

### PRD 1: User Authentication ✅ COMPLETE

**Files created:**
- `src/auth/login.ts` (142 lines)
- `src/auth/register.ts` (98 lines)  
- `src/auth/middleware.ts` (67 lines)
- `src/auth/__tests__/login.test.ts` (89 lines)
- `src/auth/__tests__/register.test.ts` (76 lines)

**Files modified:**
- `src/app.ts` — added auth route imports and middleware registration
- `src/routes/index.ts` — added /auth/* route group
- `package.json` — added bcrypt, jsonwebtoken dependencies

**Verification:**
- Anti-stub: ✅ Passed (0 violations)
- Constitution: ✅ Passed (0 violations)  
- PDSE: 94/100
- Tests: 12 tests, 12 passing

**What was built:** Login and registration endpoints with JWT tokens, password hashing with bcrypt, auth middleware that validates tokens on protected routes. Tests cover successful login, wrong password, missing fields, expired tokens, and middleware bypass attempts.

---

### PRD 3: API Endpoints ❌ FAILED

**Files created:**
- `src/routes/users.ts` (45 lines)
- `src/routes/products.ts` (38 lines)

**Files modified:**
- `src/app.ts` — added route imports

**Verification:**
- Anti-stub: ❌ FAILED (3 hard violations)
  - Line 12: `createProduct()` — empty function body
  - Line 24: `updateProduct()` — empty function body  
  - Line 36: `deleteProduct()` — empty function body
- Constitution: ✅ Passed
- PDSE: 41/100 (below threshold 85)
- Regeneration attempts: 3/3 exhausted
- Tests: 0 created (blocked by implementation failure)

**What went wrong:** The model generated route handlers for GET endpoints correctly but returned empty function bodies for all write operations (POST, PUT, DELETE). Three regeneration attempts all produced the same pattern. This may indicate the model needs more context about the database schema (PRD 2) to generate write operations.

**What needs to happen:** The three empty functions in `src/routes/products.ts` need real implementations. Run DanteCode again on this file with `/add src/db/schema.ts` in context first, or implement manually.

---

### PRD 14: Email Notifications ⚠️ PARTIAL

**Files created:**
- `src/email/templates.ts` (120 lines)
- `src/email/sender.ts` (85 lines)

**Files modified:**
- `package.json` — added nodemailer dependency

**Verification:**
- Anti-stub: ✅ Passed
- Constitution: ⚠️ 1 warning — hardcoded SMTP config (should use environment variables)
- PDSE: 78/100 (below threshold 85, but no hard violations)
- Regeneration attempts: 3/3 exhausted (could not raise PDSE above 85)
- Tests: 6 created, 6 passing (but only test template rendering, not actual sending)

**What was built:** Email template system and sender are functional but SMTP configuration is hardcoded to localhost:587 instead of reading from environment variables. Test coverage is shallow — only tests template string generation, not the send path.

**What needs to happen:** Move SMTP config to environment variables in `src/email/sender.ts`. Add integration tests for the send path (or at minimum, mock tests that verify nodemailer is called correctly).

---

### PRD 25: Deployment Configuration ⏭️ NOT ATTEMPTED

**Reason:** Execution stopped after PRD 24 due to context window exhaustion (98.2% utilization). The `/party` orchestrator ran out of context space before reaching this PRD.

**What needs to happen:** Run `/party --prds ./prds/25-deployment.md` as a standalone follow-up.

---

## Filesystem Manifest

Complete list of all files touched during this run:

| Action | File | Lines |
|--------|------|-------|
| CREATED | src/auth/login.ts | 142 |
| CREATED | src/auth/register.ts | 98 |
| CREATED | src/auth/middleware.ts | 67 |
| CREATED | src/auth/__tests__/login.test.ts | 89 |
| CREATED | src/auth/__tests__/register.test.ts | 76 |
| MODIFIED | src/app.ts | +15 -2 |
| MODIFIED | src/routes/index.ts | +8 -1 |
| MODIFIED | package.json | +3 -0 |
| CREATED | src/routes/users.ts | 45 |
| CREATED | src/routes/products.ts | 38 |
| ... | ... | ... |

**Total: 47 files created, 12 files modified, 0 files deleted**

## Verification Summary

| Check | Passed | Failed | Total |
|-------|--------|--------|-------|
| Anti-stub scan | 23 | 1 | 24 |
| Constitution check | 22 | 0 | 24 (2 warnings) |
| PDSE ≥ 85 | 20 | 4 | 24 |
| Tests passing | 20 | 1 | 24 (3 no tests) |

## Reproduction

To re-run failed/partial PRDs:
```bash
dantecode --one-shot "/party --prds ./prds/03-api-endpoints.md ./prds/14-email.md ./prds/21-search.md ./prds/22-caching.md ./prds/25-deployment.md"
```

## Environment

- DanteCode version: 1.3.0
- Node.js: v20.11.1
- OS: macOS 14.3
- Provider: anthropic
- Model: claude-sonnet-4-20250514
- PDSE threshold: 85
- GStack: tsc + eslint + vitest
```

---

## Implementation

### Where report generation hooks in

The report is generated by the `/party` and `/magic` command handlers in `packages/cli/src/slash-commands.ts`. These commands already orchestrate multi-PRD execution. The report is a side-effect collected during execution, not a post-hoc analysis.

### Data collection during execution

Add a `RunReport` accumulator that each PRD execution step writes to:

```typescript
interface RunReportEntry {
  prdName: string;
  prdFile: string;
  status: "complete" | "partial" | "failed" | "not_attempted";
  filesCreated: Array<{ path: string; lines: number }>;
  filesModified: Array<{ path: string; added: number; removed: number }>;
  filesDeleted: string[];
  verification: {
    antiStub: { passed: boolean; violations: number; details: string[] };
    constitution: { passed: boolean; violations: number; warnings: number; details: string[] };
    pdseScore: number;
    pdseThreshold: number;
    regenerationAttempts: number;
    maxAttempts: number;
  };
  tests: { created: number; passing: number; failing: number };
  summary: string;       // Human-readable "what was built"
  failureReason?: string; // Human-readable "what went wrong"
  actionNeeded?: string;  // Human-readable "what needs to happen"
  startedAt: string;
  completedAt: string;
  tokenUsage: { input: number; output: number };
}

interface RunReport {
  project: string;
  command: string;
  startedAt: string;
  completedAt: string;
  model: { provider: string; modelId: string };
  entries: RunReportEntry[];
  filesManifest: Array<{ action: "created" | "modified" | "deleted"; path: string; lines?: number; diff?: string }>;
  tokenUsage: { input: number; output: number };
  costEstimate: number;
  dantecodeVersion: string;
  environment: { nodeVersion: string; os: string };
}
```

### Report writing

After `/party` or `/magic` completes (including on early termination), serialize the `RunReport` to markdown using the format above and write to `.dantecode/reports/run-{timestamp}.md`.

**Critical rule:** The report must be written even on crash or early termination. Wrap the party/magic execution in a try/finally that writes whatever was collected. A partial report is infinitely more useful than no report.

### The "What was built" / "What went wrong" / "What needs to happen" fields

These are the most important fields in the entire report. They are NOT generated by string-templating violation counts. They are generated by asking the model to summarize in plain language:

```typescript
// After each PRD execution, ask the model for a plain-language summary
const summaryPrompt = `
You just executed a coding task. Here are the results:
- Files created: ${entry.filesCreated.map(f => f.path).join(", ")}
- Files modified: ${entry.filesModified.map(f => f.path).join(", ")}  
- Verification: ${entry.verification.antiStub.passed ? "passed" : "failed"}, PDSE ${entry.verification.pdseScore}
- Test results: ${entry.tests.passing}/${entry.tests.created} passing

Write a 1-2 sentence summary of what was built, in plain language that a non-developer can understand.
${!entry.verification.antiStub.passed || entry.verification.pdseScore < entry.verification.pdseThreshold
  ? "Also write 1 sentence explaining what went wrong and 1 sentence explaining what needs to happen next."
  : ""}
`;
```

This costs a small number of tokens per PRD but transforms the report from infrastructure metrics into human communication.

### Git integration

After writing the report, if git auto-commit is enabled, commit the report file:

```
dantecode: run report for /party (20/25 complete)
```

This means the report is version-controlled alongside the code it describes. A verifier in another workspace can see exactly what DanteCode claimed at the time of execution.

---

## Acceptance Tests

1. Run `/party` with 3 test PRDs (1 that should pass, 1 that should partially fail, 1 that's impossible). Verify report file exists with correct statuses.
2. Verify report file is valid markdown that renders correctly.
3. Kill DanteCode mid-run (Ctrl+C). Verify partial report was written with entries for completed PRDs and "not_attempted" for remaining.
4. Open the report in a separate Claude Code session pointed at the same project. Ask "read the DanteCode run report and verify every claim." Claude Code should be able to confirm or dispute each file creation/modification claim within 5 minutes.
5. Verify the "What was built" summaries are understandable by someone who can't read code.
6. Verify the "Reproduction" command at the bottom of the report actually works when copy-pasted.
