# DanteCode Tutorials

Three real-world scenarios showing DanteCode's full capability.

---

## Tutorial 1: Fix a Failing Test

**Scenario:** Your CI is failing with a test regression. You want DanteCode to diagnose and fix it without breaking anything else.

### Step 1: Show DanteCode the failure

```bash
dantecode "Fix the failing test in src/auth/login.test.ts — the test 'rejects empty password' is failing"
```

DanteCode will:
1. Read the failing test
2. Read the implementation under test
3. Identify the root cause (not just suppress the test)
4. Make the minimal change to fix the test
5. Run `npm test` to verify the fix didn't break other tests

### Step 2: Review the change

```bash
git diff
```

DanteCode always makes targeted changes. If it's touching files you didn't expect, ask:

```bash
dantecode "why did you edit src/auth/validators.ts?"
```

### Step 3: Approve or reject

```bash
git add -p  # review changes interactively
git commit -m "fix: reject empty password in login validation"
```

### Pro tip: plan mode

For a larger regression, use plan mode to review the approach first:

```bash
/plan fix the failing auth tests without breaking the existing ones
# → DanteCode proposes a plan
# → You approve or edit it
# → Then it executes
```

---

## Tutorial 2: Build a Feature Spec-First

**Scenario:** You want to add a new API endpoint. You want tests written before the implementation.

### Step 1: Describe the feature

```bash
dantecode "Add a POST /api/users/reset-password endpoint that:
- Accepts { email: string }
- Validates the email format
- Returns 200 on success, 400 on invalid email, 404 if user not found
- Sends a password reset email (mock the email service in tests)"
```

### Step 2: Watch the PDSE pipeline

DanteCode runs in 4 phases, each visible in the output:

```
[Plan]    Proposing: create route handler, write unit tests, mock email service
[Design]  Files: src/api/routes/users.ts, src/api/routes/users.test.ts
[Spec]    Writing failing tests first...
[Execute] Implementing route to make tests pass...
```

### Step 3: Check the PDSE score

```bash
/pdse-report --last 1
```

Output:
```
Session  │ Score │ Task                           │ Duration │ Cost
─────────┼───────┼────────────────────────────────┼──────────┼──────
sess_001 │  88   │ "Add POST /api/users/reset-..." │   3m22s  │ $0.06
```

Scores above 85 mean the change is well-tested and consistent with the codebase.

### Step 4: Verify the receipt

Every completed session has a cryptographic receipt:

```bash
/verify-receipt ev_abc123
```

Output:
```
✓ Receipt ev_abc123 valid
  Task:    "Add POST /api/users/reset-password endpoint"
  Session: sess_001
  Time:    2026-04-07 10:23:41 UTC
  Merkle:  root=a1b2c3... block=4/4 verified
```

This proves the session happened as described — tamper-evident.

---

## Tutorial 3: Run the Autonomous Stress Test

**Scenario:** You want to verify DanteCode's evaluation harness works without any human oversight.

### Step 1: Run the stress test

```bash
dantecode stress-test --instances 5
```

DanteCode autonomously:
1. Loads 5 built-in TypeScript coding tasks
2. Evaluates the reference solution against each test using the in-process VM
3. Reports pass@1 score
4. Saves a signed EvalReport

### Expected output

```
Running stress test on 5 instances...

  ✓ ts-utils__001 (4ms)
  ✓ ts-utils__002 (2ms)
  ✓ ts-utils__003 (3ms)
  ✓ ts-utils__004 (2ms)
  ✓ ts-utils__005 (8ms)

────────────────────────────────────────────────────────────
Results — self-validation (reference patches)
  Instances: 5
  Passed:    5/5
  pass@1:    100.0%

Note: Self-validation mode — tests run against reference patches.
Use 'dantecode stress-test --agent' to run against the live agent.

Report saved: .dantecode/stress-test-results/stress-test-1712500000000.json
```

### Step 2: Run all 20 instances

```bash
dantecode stress-test --instances all
```

### Step 3: Check the efficiency report after a few sessions

```bash
/efficiency-report
```

Output:
```
Token Efficiency Report
────────────────────────────────────────────────────────────

Sessions analyzed:    24
Total tokens used:    1,240,000 input tokens
Total cost:           $2.14
Avg cost/session:     $0.0892

Model Routing Breakdown
────────────────────────────────────────────────────────────
  Haiku sessions:  8 / 24 (33.3%)
  Sonnet sessions: 16 / 24

Haiku Routing Savings
────────────────────────────────────────────────────────────
  Actual cost (haiku routed):    $2.14
  Projected (all-Sonnet):        $2.89
  Savings:                       $0.75 (26.0% cheaper)
```

---

## Next Steps

- Read [ARCHITECTURE.md](ARCHITECTURE.md) to understand how the agent loop, council, and self-improvement systems work
- Check [THREAT_MODEL.md](THREAT_MODEL.md) for security boundaries
- Run `/verify` to get an honest health score for your codebase
- Use `/council` for multi-agent parallel execution on large tasks
