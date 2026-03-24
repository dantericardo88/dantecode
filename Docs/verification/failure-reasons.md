# DanteCode — Verification Failure Reasons

This catalog explains every reason DanteCode can block a code change,
in plain language. Each entry includes what triggered the block and what to do next.

---

## STUB-001 — Hard stub violation detected

**Why this blocked:**
The generated code contains a pattern that signals an incomplete or placeholder
implementation. Examples: empty function body, `throw new Error("not implemented")`,
`// TODO: implement`, or a function that only returns `null` with a TODO comment.

**What to fix:**
Ask DanteCode to complete the implementation. Be specific about what the function
should do: its inputs, outputs, and any edge cases. DanteCode will regenerate
and re-verify automatically.

**Which step:** Anti-stub scan (Step 1)

---

## CONST-001 — Constitution critical violation

**Why this blocked:**
The generated code violates a project policy rule at the critical level.
Common causes:
- A hardcoded API key or secret was found in the code
- A shell command was constructed via template literal (command injection risk)
- A destructive operation (`rm -rf`, `git clean`) was added without a
  confirmation guard
- A platform-specific shell command was used in a cross-platform file

**What to fix:**
Review the specific violation message shown in the verification report.
Ask DanteCode to fix the specific policy violation (e.g., "move the API key
to an environment variable" or "add a confirmation prompt before deleting files").

**Which step:** Constitution check (Step 2)

---

## PDSE-001 — PDSE score below gate threshold

**Why this blocked:**
The overall PDSE score for the generated file was below 70 (the default gate).
This means the code has quality issues across one or more of the four dimensions:
Completeness, Correctness, Clarity, or Consistency.

**What to fix:**
Review the score breakdown in the verification report:
- Low **Completeness**: the code is missing logic — ask DanteCode to finish it
- Low **Correctness**: error handling is absent — ask DanteCode to add try/catch
  or check for null/undefined before using values
- Low **Clarity**: functions are too long or naming is unclear — ask DanteCode
  to refactor the functions
- Low **Consistency**: style differs from the rest of the project — ask DanteCode
  to match the existing code patterns

**Which step:** PDSE local score (Step 3)

---

## PDSE-002 — PDSE score below gate (function length)

**Why this blocked:**
One or more functions in the generated file are too long (> 50 lines).
Long functions reduce clarity and increase the risk of hidden bugs.

**What to fix:**
Ask DanteCode to break the function into smaller, named helpers with clear
single responsibilities.

**Which step:** PDSE local score (Step 3) — Clarity dimension

---

## PDSE-003 — PDSE score below gate (error handling absent)

**Why this blocked:**
The generated code calls external APIs, reads files, or performs async operations
without any error handling. Missing try/catch, no `.catch()` on promises, and
no null-safety guards were detected.

**What to fix:**
Ask DanteCode to add error handling to the specific functions identified in
the report. Be explicit: "wrap the file read in try/catch and handle the
case where the file does not exist."

**Which step:** PDSE local score (Step 3) — Correctness dimension

---

## PDSE-004 — PDSE score below gate (naming convention)

**Why this blocked:**
Function, variable, or class names do not follow the expected convention.
Functions and variables should use camelCase; classes, interfaces, and type
aliases should use PascalCase.

**What to fix:**
Ask DanteCode to rename the flagged identifiers to follow the project convention.
If your project uses a different convention, update the project config.

**Which step:** PDSE local score (Step 3) — Clarity/Consistency dimension

---

## GSTACK-001 — GStack command failed

**Why this blocked:**
One or more of the project's configured verification commands (typecheck, tests,
lint, or custom commands) exited with a non-zero code after DanteCode made changes.

The verification report includes the command name and the exit code.

**What to fix:**
1. Read the command output shown in the report for the specific error
2. Ask DanteCode to fix the error: "The typecheck command failed with: [error message]"
3. DanteCode will analyze the output and propose a fix

**Which step:** GStack verification (after PDSE)

---

## VERIFY-001 — Verification receipt missing

**Why this blocked:**
The session ended without producing a verification receipt. This can happen if:
- The session was force-quit before DanteForge completed
- An unexpected error occurred in the evidence chain

This is not a code quality issue — it is a session integrity issue.

**What to fix:**
Re-run the task. If the problem persists, check `.dantecode/receipts/` for
partial session data and run `dantecode config show` to verify the session state.

---

## VERIFY-002 — Seal hash mismatch

**Why this blocked:**
The `CertificationSeal` hash does not match the computed hash of the evidence
stored in the session. This indicates the receipt data was modified after
being written, or there was a disk corruption event.

**What to fix:**
Do not trust any code changes from this session. Re-run the task from the
last clean state. If the mismatch is reproducible, report it as a bug.

---

## Advisory reasons (non-blocking)

These appear in the report but **never block** a write:

| Code | Reason |
|------|--------|
| `PDSE-WARN-001` | Soft stub violation — TODO comment in logic |
| `PDSE-WARN-002` | `console.log` left in production code path |
| `CONST-WARN-001` | Constitution warning (non-critical policy hint) |
| `PR-WARN-001` | PR quality score below 70 — advisory review suggested |
