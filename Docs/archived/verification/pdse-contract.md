# DanteCode — PDSE Verification Contract

> Source of truth: `packages/danteforge/dist/index.d.ts` + `packages/cli/src/danteforge-pipeline.ts`

---

## What PDSE means

**PDSE** = Production, Deterministic, Secure, Efficient.

It is a 0–100 composite score that DanteForge assigns to every code file that
DanteCode writes or modifies. The score is computed across four dimensions:

| Dimension | What it measures |
|-----------|-----------------|
| **Completeness** | All required logic is present; no TODOs, stubs, or placeholder bodies |
| **Correctness** | Code follows language conventions; error handling is present; types are sound |
| **Clarity** | Functions are small and focused; naming is consistent; logic is readable |
| **Consistency** | Style, structure, and patterns are uniform with the surrounding project |

Each dimension is scored 0–100. The `overall` score is the mean of the four.

---

## Score bands (plain language)

| Score | Status | Meaning |
|-------|--------|---------|
| 0–40 | **FAIL** | Significant structural or completeness problems. Code cannot be accepted. |
| 41–69 | **WARN** | Below the gate threshold. Code has issues but may be borderline. Regeneration triggered. |
| 70–85 | **PASS** | Acceptable quality for normal tasks. Gate is cleared. |
| 86–100 | **EXCELLENT** | High-quality output. Matches or exceeds target standards. |

**Default gate threshold: 70.**

The gate threshold can be overridden via `PDSEGateConfig` in the project config.
A score below the gate causes `passedGate = false` and blocks the write.

---

## How PDSE is computed

DanteCode uses two scorers depending on context:

### 1. Local scorer (`runLocalPDSEScorer`)
Heuristic-based. No LLM required. Used in the default pipeline.

Checks:
- **Function length**: deducts for functions > 50 lines
- **Naming conventions**: camelCase for functions, PascalCase for classes/interfaces/types
- **Import usage**: deducts for imports that appear unused
- **Error handling**: presence of try/catch, `.catch()`, or error callbacks
- **Anti-stub violations**: always checked (hard violations collapse the score)

### 2. LLM scorer (`runPDSEScorer`)
Model-based. Sends code to the configured LLM for evaluation. Used when
`PDSE_USE_LLM=true` is set in config. More accurate, slower, and costs tokens.

Both scorers return the same `PDSEScore` shape with all four dimensions,
`overall`, `passedGate`, and `violations[]`.

---

## Anti-stub rules

An **anti-stub** violation is a code pattern that indicates incomplete or
placeholder implementation. Hard violations **always block**; soft violations
are flagged as warnings.

### Hard violations (blocking)
These patterns cause `antiStubPassed = false` regardless of PDSE score:

- Empty function bodies: `() => {}`, `function foo() {}`
- Explicit not-implemented markers: `throw new Error("not implemented")`,
  `throw new Error("TODO")`, `throw new Error("stub")`
- Placeholder return values: `return null; // TODO`, `return []; // placeholder`
- Obvious stubs: `// TODO: implement`, `/* ... */` as function body
- Comments indicating pending work inside a function that has no real logic

### Soft violations (advisory)
Flagged but non-blocking:
- Long TODO comments in logic (not in tests)
- `console.log` left in production code paths
- Commented-out blocks of code

Custom patterns can be added to `.dantecode/anti-stub-patterns.json`.

---

## Constitution check

The **constitution check** (`runConstitutionCheck`) evaluates code against a
set of policy rules. Unlike PDSE, it is binary: each rule either passes or
produces a violation with a severity.

| Severity | Behavior |
|----------|----------|
| `critical` | **Blocking**. Any critical violation causes `constitutionPassed = false`. |
| `warning` | **Advisory**. Shown in the verification report but does not block. |

Constitution rules cover:
- Security: no hardcoded secrets, no command injection via template literals
- Safety: destructive commands (rm -rf, git clean) require confirmation guards
- Compatibility: no platform-specific shell commands in cross-platform code
- Style: enforced project-level patterns defined in `.dantecode/constitution.json`

---

## GStack validation

**GStack** (Guardrail Stack) runs user-defined verification commands as child
processes. These are project-specific checks like build, test, lint, or type-check.

GStack commands are defined in `.dantecode/STATE.yaml`:

```yaml
gstack:
  - name: typecheck
    command: npm run typecheck
    timeoutMs: 60000
    hardFailure: true
  - name: tests
    command: npm test
    timeoutMs: 120000
    hardFailure: true
  - name: lint
    command: npm run lint
    timeoutMs: 30000
    hardFailure: false
```

A GStack run:
1. Executes each command sequentially as a child process
2. Captures stdout, stderr, exit code, and duration
3. Kills the process if it exceeds `timeoutMs`
4. Sets `passed = (exitCode === 0)`

All commands with `hardFailure: true` must pass for the overall GStack to pass.
Commands with `hardFailure: false` are advisory.

---

## Pipeline execution order

The DanteForge pipeline runs in this exact order on every file written:

```
1. Anti-stub scan       → blocking on hard violations
2. Constitution check   → blocking on critical violations
3. PDSE local score     → blocking if score < gate threshold
4. PR quality check     → advisory only, never blocks
```

Steps 1–3 all gate independently. If step 1 fails, steps 2–3 still run
(for full diagnostics), but the overall result is `passed = false`.

The PR quality check (step 4) is always informational and contributes to
the session report but cannot block a write.
