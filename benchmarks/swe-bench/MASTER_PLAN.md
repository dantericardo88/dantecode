# SWE-bench Integration Master Plan
## Systematic Fix for Edit Tool Failures

### Executive Summary
**Current Status:** Grok successfully analyzes code but Edit tool fails silently, causing infinite retry loops and timeouts.

**Root Cause:** Edit tool errors in Django workspace (likely file encoding or path issues on Windows).

**Goal:** Enable DanteCode to successfully complete SWE-bench tasks within timeout limits.

---

## Phase 1: Diagnose Edit Tool Failure (30 min)

### 1.1 Test Edit Tool in Isolation
```bash
cd django__django-11477
node C:/Projects/DanteCode/packages/cli/dist/index.js "Add a comment to tests/i18n/patterns/tests.py" --model grok/grok-3 --max-rounds 3 --yolo --verbose
```
**Expected:** See actual Edit error message in verbose output

### 1.2 Check File Encoding
```bash
file tests/i18n/patterns/tests.py  # Should be UTF-8
python -c "import sys; print(sys.getdefaultencoding())"  # Should be utf-8
```

### 1.3 Test Simple Edit
```bash
# Manual test: Can we edit the file at all?
echo "# Test comment" >> tests/i18n/patterns/tests.py
git diff tests/i18n/patterns/tests.py
git checkout tests/i18n/patterns/tests.py  # Revert
```

---

## Phase 2: Fix Edit Tool Issues (1-2 hours)

### Hypothesis 1: File Encoding Mismatch
**Symptom:** Windows cp1252 vs Django UTF-8
**Fix Options:**
- A) Force UTF-8 in Edit tool
- B) Set `PYTHONIOENCODING=utf-8` in subprocess
- C) Use binary mode for file operations

### Hypothesis 2: Line Ending Issues
**Symptom:** Unix `\n` vs Windows `\r\n`
**Fix:** Normalize line endings before comparison in Edit tool

### Hypothesis 3: File Too Large
**Symptom:** Django test files are 10K+ lines
**Fix:** Increase Edit tool buffer size or use streaming

### Hypothesis 4: Path Resolution
**Symptom:** Relative paths failing in subprocess
**Fix:** Use absolute paths in Edit tool

---

## Phase 3: Alternative Approach - Use Write Instead of Edit (1 hour)

If Edit tool is fundamentally broken, modify Grok's prompt to use Write tool:

### 3.1 Add System Prompt Override
```python
# In swe_bench_runner.py, modify DanteCode invocation:
cmd += [
    "--system-prompt",
    "CRITICAL: Use Write tool instead of Edit tool. Read the file, modify in memory, then Write the complete new content."
]
```

### 3.2 Test Write Approach
- Grok reads file
- Modifies content in reasoning
- Writes complete new file
- No Edit tool errors!

---

## Phase 4: Optimize for SWE-bench Success (2 hours)

### 4.1 Reduce Context Bloat
**Problem:** 13K/131K tokens (10%) used just reading test files
**Solution:**
- Use `--max-file-size 50000` to limit Read operations
- Add `--focus-mode` to skip unnecessary context building

### 4.2 Increase Timeout Dynamically
```python
# Based on problem complexity
if len(problem_statement) > 1000:
    timeout = 600  # 10 minutes for complex bugs
else:
    timeout = 240  # 4 minutes for simple fixes
```

### 4.3 Add Checkpointing
```python
# Save progress every 2 minutes
# If timeout, resume from last checkpoint instead of restarting
```

---

## Phase 5: Test on Multiple Instances (1 hour)

### 5.1 Run on Easy Instance First
- Find SWE-bench instance with simple fix (e.g., typo)
- Verify full workflow works
- Get first passing test!

### 5.2 Run on 5 Diverse Instances
- 1x typo fix
- 1x logic bug
- 1x test addition
- 1x refactoring
- 1x edge case handling

### 5.3 Calculate Pass Rate
- Target: >30% for first successful run
- Aider gets 88%, we should aim for >50% eventually

---

## Phase 6: Production Readiness (2 hours)

### 6.1 Add Retries
```python
MAX_RETRIES = 2
for attempt in range(MAX_RETRIES):
    result = run_dantecode(...)
    if result.pass_rate > 0:
        break
    # Retry with different random seed or temperature
```

### 6.2 Multi-Model Testing
```python
MODELS = [
    "grok/grok-3",
    "anthropic/claude-sonnet-4-20250514",
    "openai/gpt-4-turbo"
]
# Run same instance with all 3, take best result
```

### 6.3 Results Analysis
```python
# Generate detailed report:
# - Per-repo pass rates
# - Per-model performance
# - Common failure patterns
# - Token usage analysis
```

---

## Timeline

| Phase | Duration | Priority |
|-------|----------|----------|
| 1. Diagnose | 30 min | P0 - Must do |
| 2. Fix Edit Tool | 2 hours | P0 - Must do |
| 3. Alternative (Write) | 1 hour | P1 - Fallback |
| 4. Optimize | 2 hours | P1 - Nice to have |
| 5. Multi-test | 1 hour | P0 - Must do |
| 6. Production | 2 hours | P2 - Future work |
| **Total** | **8.5 hours** | **~1-2 days** |

---

## Success Criteria

### Minimum Viable (P0)
- [ ] Edit tool works without errors
- [ ] 1+ instance completes successfully
- [ ] Tests actually run and report results
- [ ] Pass rate > 0%

### Target (P1)
- [ ] 5 instances complete within timeout
- [ ] Pass rate ≥ 30%
- [ ] Full logs captured
- [ ] PDSE scores calculated

### Stretch (P2)
- [ ] Pass rate ≥ 50%
- [ ] Multi-model comparison complete
- [ ] Automated retry logic
- [ ] Detailed performance analysis

---

## Next Immediate Action

**RUN PHASE 1 NOW:**

```powershell
cd C:\Projects\DanteCode\benchmarks\swe-bench\.swe-bench-workspace\django__django-11477

# Test Edit tool with verbose logging
node C:/Projects/DanteCode/packages/cli/dist/index.js "Add comment '# Test' to line 1 of tests/i18n/patterns/tests.py" --model grok/grok-3 --max-rounds 1 --yolo --verbose 2>&1 | tee edit-test.log

# Check the error
grep -i "error\|fail\|exception" edit-test.log
```

This will reveal the **actual Edit error** so we can fix it properly.
