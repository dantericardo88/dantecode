---
triggers:
  - swe-bench
  - swe_bench
  - swebench
  - "fix issue"
  - "github issue"
---

# SWE-bench Task Protocol

When solving a SWE-bench task, follow this exact protocol:

## Step 1: Understand the Issue
Read the problem statement carefully. Identify:
- What is the bug or missing feature?
- Which files are likely involved?
- What tests will verify the fix?

## Step 2: Reproduce First
Run the FAIL_TO_PASS tests BEFORE making any changes:
```bash
python -m pytest {test_files} -x 2>&1 | head -50
```
Confirm they fail. If they pass already, the issue may be in a different area.

## Step 3: Locate the Bug
Use Read and Grep to find the relevant code. Look at:
- The error message traceback for file/line hints
- The test itself to understand expected behavior
- Import chains to find the root implementation

## Step 4: Apply Minimal Fix
Make the smallest change that fixes the issue. Prefer:
- Modifying existing logic over adding new functions
- Fixing the root cause over adding workarounds
- Preserving existing API contracts

## Step 5: Verify
Run the tests again and confirm FAIL_TO_PASS tests now pass:
```bash
python -m pytest {test_files} -x
```
