# Manual Baseline Execution Guide

The baseline validation requires your Grok API key to be set as an environment variable.

## Quick Start

### Option 1: PowerShell (Recommended)

```powershell
# Open PowerShell in benchmarks/swe-bench directory
cd C:\Projects\DanteCode\benchmarks\swe-bench

# Set your Grok API key (replace with your actual key)
$env:GROK_API_KEY = "your-grok-api-key-here"

# Run the baseline
.\run_baseline.ps1

# Expected output:
# - Runtime: ~50 minutes
# - Cost: ~$0.016
# - Results saved to: results/baseline-TIMESTAMP/
```

### Option 2: Pass API Key as Parameter

```powershell
.\run_baseline.ps1 -ApiKey "your-grok-api-key-here"
```

### Option 3: Python Direct (If PowerShell Fails)

```bash
# Set environment variable
export GROK_API_KEY="your-grok-api-key-here"

# Run Python script directly
python swe_bench_runner.py \
    --subset verified \
    --limit 10 \
    --model grok/grok-3 \
    --dantecode "node C:\Projects\DanteCode\packages\cli\dist\index.js" \
    --api-key "$GROK_API_KEY" \
    --output-dir "results/baseline-$(date +%Y%m%d-%H%M%S)"
```

## After Baseline Completes

1. **Analyze Results:**
   ```powershell
   .\analyze_baseline.ps1
   ```

2. **Check Output:**
   - Results directory: `results/baseline-TIMESTAMP/`
   - JSON results file with pass rate, costs, timing
   - Assessment will show: EXCELLENT/GOOD/FAIR/NEEDS WORK

3. **Follow Decision Tree:**
   - See `DECISION_TREE.md` for next steps based on results
   - >60% pass rate → Scale to 50 instances
   - 40-60% pass rate → Optimize first
   - <40% pass rate → Debug systematically

## Troubleshooting

### "API key not provided" Error
- Ensure environment variable is set: `echo $env:GROK_API_KEY` (PowerShell)
- Try passing as parameter: `-ApiKey "your-key"`

### "No provider API keys found" Error
- The API key isn't reaching DanteCode subprocess
- Use the --api-key parameter explicitly in the Python script

### "subprocess hung/timeout" Error
- Check if approval mode is interfering
- Ensure STATE.yaml doesn't have sandbox: true
- Run with --yolo flag

## Expected Timeline

| Step | Duration | Cost |
|------|----------|------|
| Baseline (10 instances) | ~50 min | $0.016 |
| Analysis | ~5 min | $0 |
| Decision | ~5 min | $0 |
| **Total** | **~1 hour** | **$0.016** |

## What Happens Next

Based on the baseline results, you'll take one of three paths:

1. **EXCELLENT (80%+):** Scale to 50 instances immediately
2. **GOOD (60-80%):** Minor optimizations, then scale to 50
3. **FAIR (40-60%):** Implement optimizations, re-run baseline
4. **NEEDS WORK (<40%):** Debug systematically

See `DECISION_TREE.md` for detailed guidance on each scenario.

---

**Current Status:** Waiting for baseline execution with valid API key

**Next Step:** Run baseline using one of the methods above
