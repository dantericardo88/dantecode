# Golden Flow GF-02 — Real Repo Edit with Verification Receipt

> **Gate:** Must pass before private daily-driver declaration.
> **Purpose:** Prove DanteCode can fix a real bug, produce a verification receipt, and support undo.

---

## Prerequisites

- GF-01 (clean install) already passing
- A real project with a known bug or small improvement to make
- Provider configured and reachable

---

## Step 1 — Navigate to your repo

```
cd /path/to/real-project
```

Make sure DanteCode is initialized:

```
dantecode config show
# Verify STATE.yaml path and provider
```

---

## Step 2 — Describe the task

Use a specific prompt that references the actual issue:

```
dantecode "Fix the null pointer in src/parser.ts line 42 — the result of
readConfig() can be null but it's used without a null check"
```

Or open the REPL for interactive work:

```
dantecode
> Fix the null pointer in src/parser.ts — readConfig() can return null
```

---

## Step 3 — Watch DanteCode work

DanteCode will:

1. Read the file(s) involved
2. Propose a diff
3. Run the DanteForge verification pipeline on the changed code

You will see output like:

```
Reading src/parser.ts...
Planning fix...

  Proposed change: src/parser.ts
  ─────────────────────────────
  + const config = readConfig();
  + if (!config) {
  +   throw new Error("Configuration not found — check your .dantecode/STATE.yaml");
  + }
  - const config = readConfig();
    processConfig(config);

Running DanteForge verification...
  ✓ Anti-stub scan:     PASSED
  ✓ Constitution check: PASSED
  ✓ PDSE score:         88/100
    Completeness 87 | Correctness 92 | Clarity 86 | Consistency 87

✓ Verified — changes ready for review.
```

---

## Step 4 — Review the diff

```
/diff
```

Review every changed line. Confirm the fix addresses the actual problem.

---

## Step 5 — Inspect the verification receipt

```
/status
```

Expected output includes:

```
Session: sess_20260324_xxxxx
Receipts recorded: 1
Merkle root: a1b2c3...
Provider: anthropic / claude-sonnet-4-6
Cost this session: $0.0018
```

---

## Step 6 — Accept or undo

Accept and commit:

```
/commit
# Enter commit message when prompted
```

Or undo if the fix is not right:

```
/undo
```

Then refine:

```
> The null check should log a warning instead of throwing — fix that
```

---

## Step 7 — Verify the receipt is on disk

```
ls .dantecode/receipts/
# Expected: sess_20260324_xxxxx.json

cat .dantecode/receipts/sess_20260324_xxxxx.json | grep overallPassed
# Expected: "overallPassed": true
```

---

## Acceptance criteria

- [ ] DanteCode correctly identifies and fixes the stated issue
- [ ] Verification report shows all stages passed
- [ ] `/diff` shows only the expected change and nothing unrelated
- [ ] `/undo` reverts the change and restores the original file
- [ ] Receipt file is written to `.dantecode/receipts/`
- [ ] Receipt contains `overallPassed: true` and a non-empty `sealHash`

---

## Fail codes

| Code | Symptom |
|------|---------|
| `GF-002` | No verification report printed after task |
| `GF-003` | `/undo` fails or does not restore original state |
| `CLI-003` | `/diff` is unreliable or shows wrong changes |
