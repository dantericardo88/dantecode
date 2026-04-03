# SWE-bench Quick Reference Card

## 🚀 Run Baseline (First Time)

```powershell
cd C:\Projects\DanteCode\benchmarks\swe-bench
$env:GROK_API_KEY = "your-key"
.\run_baseline.ps1
# Wait ~50 min, cost ~$0.016
```

## 📊 Analyze Results

```powershell
.\analyze_baseline.ps1
# Shows: EXCELLENT/GOOD/FAIR/NEEDS WORK
# Gives: Specific next step recommendation
```

## 🎯 Next Steps by Result

| Pass Rate | Assessment | Action |
|-----------|------------|--------|
| 80%+ | EXCELLENT | `.\RUN_BENCHMARK.ps1 -Limit 50` |
| 60-80% | GOOD | Scale to 50 or optimize first |
| 40-60% | FAIR | Optimize, re-run baseline |
| <40% | NEEDS WORK | Debug systematically |

## 📁 Key Files

| File | Purpose |
|------|---------|
| `run_baseline.ps1` | Quick 10-instance validation |
| `analyze_baseline.ps1` | Automated results analysis |
| `DECISION_TREE.md` | Detailed guidance for each scenario |
| `RUN_BASELINE_MANUAL.md` | Full execution instructions |
| `SESSION_SUMMARY.md` | Complete session overview |

## 💰 Cost Reference

| Task | Grok-3 | Claude Opus |
|------|--------|-------------|
| 10-instance baseline | $0.016 | $0.66 |
| 50-instance validation | $0.08 | $3.30 |
| 500-instance full | $0.80 | $33.00 |

## 📈 Score Targets

- **9.2:** 50%+ on 50 instances
- **9.5:** 65%+ on 50 instances
- **9.8:** 75%+ on 50 instances

## 🔧 Troubleshooting

**"API key not provided"**
```powershell
echo $env:GROK_API_KEY  # Should show your key
```

**"No provider API keys found"**
```powershell
.\run_baseline.ps1 -ApiKey "your-key"
```

**Script won't run**
```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

## ⚡ Commands Cheat Sheet

```powershell
# Run 10-instance baseline
.\run_baseline.ps1

# Analyze results
.\analyze_baseline.ps1

# Run 50-instance validation
.\RUN_BENCHMARK.ps1 -Limit 50

# Run with different model
.\RUN_BENCHMARK.ps1 -Limit 50 -Model "anthropic/claude-sonnet-4-6"

# Check latest results
ls results\ | sort -Descending | select -First 1
```

## 📖 Documentation Navigation

1. **Start here:** `SESSION_SUMMARY.md`
2. **Run baseline:** `RUN_BASELINE_MANUAL.md`
3. **After results:** `analyze_baseline.ps1` then `DECISION_TREE.md`
4. **Full details:** `NOVA_PROGRESS.md` and `EXECUTIVE_SUMMARY.md`
5. **Implementation plan:** `.danteforge/PLAN.md`

## ✅ Current Status

- ✅ Infrastructure complete
- ✅ Cost tracking working
- ✅ Baseline script ready
- ⏳ Awaiting baseline execution
- 📋 Need: Run baseline with API key

## 🎯 Success Path

```
Run Baseline (50 min)
    ↓
Analyze Results (5 min)
    ↓
Follow Decision Tree
    ↓ (if >40%)
Scale to 50 Instances (4-6 hours)
    ↓
Achieve 9.5+ Score
```

## 💡 Key Insights

- Use Grok for testing (200x cheaper than Opus)
- Baseline ($0.016) validates approach
- Data drives optimization priorities
- Total cost to 9.5: <$1.00

---

**Ready?** Run baseline now! See `RUN_BASELINE_MANUAL.md`
