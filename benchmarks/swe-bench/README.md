# SWE-bench Integration for DanteCode

Automated benchmarking system that runs DanteCode against the SWE-bench Verified test set to measure real-world code generation performance.

## Quick Start

### Prerequisites

1. **Python 3.8+** with pip
2. **DanteCode CLI** built and available
3. **Grok API Key** (or other LLM provider)

### Installation

```bash
# Install Python dependencies
pip install datasets huggingface-hub

# Ensure DanteCode is built
cd ../..
npm run build
```

### Running Benchmarks

**Windows (PowerShell):**
```powershell
# Set API key
$env:GROK_API_KEY="your-grok-key-here"

# Run small test (5 instances)
.\run_swe_bench.ps1

# Run with custom settings
.\run_swe_bench.ps1 10 verified grok/grok-3
```

**Linux/Mac (Bash):**
```bash
# Set API key
export GROK_API_KEY="your-grok-key-here"

# Run small test (5 instances)
./run_swe_bench.sh

# Run with custom settings
./run_swe_bench.sh 10 verified grok/grok-3
```

**Direct Python:**
```bash
python swe_bench_runner.py \
    --subset verified \
    --limit 10 \
    --model grok/grok-3 \
    --output-dir ./results
```

## Configuration

### Arguments

- `--subset` - Dataset to use:
  - `verified` (default) - SWE-bench Verified (500 high-quality instances)
  - `full` - Full SWE-bench (2,294 instances)

- `--limit` - Number of instances to run (default: all in subset)

- `--model` - Model to use (default: `grok/grok-3`)
  - `grok/grok-3` - Grok 3 (fast reasoning)
  - `anthropic/claude-opus-4` - Claude Opus
  - `openai/gpt-4` - GPT-4
  - Any model supported by DanteCode

- `--output-dir` - Where to save results (default: `./results`)

- `--execution-profile` - Optional DanteCode CLI execution profile to prefer when the CLI exposes the flag. The runner falls back to the legacy prompt guidance if the flag is unavailable.
  - Recommended value: `benchmark`
  - This keeps benchmark runs non-interactive and fail-closed when the CLI supports the flag.

- `--dry-run` - Print the planned DanteCode and test commands without running the benchmark.

### Environment Variables

- `GROK_API_KEY` - Required for Grok models
- `ANTHROPIC_API_KEY` - Required for Claude models
- `OPENAI_API_KEY` - Required for GPT models

## How It Works

### Benchmark Process

For each SWE-bench instance:

1. **Environment Setup** (30-60s)
   - Clone the repository
   - Checkout the base commit
   - Install dependencies

2. **Run DanteCode** (5-10 minutes)
   - Pass problem statement to DanteCode
   - Let DanteCode analyze and modify files
   - Capture all output and changes

3. **Evaluation** (10-30s)
   - Apply test patch from SWE-bench
   - Run test suite
   - Determine pass/fail

4. **Results Collection**
   - Save metrics (time, tokens, cost, PDSE score)
   - Generate summary statistics
   - Export to JSON

### Expected Runtime

| Instances | Subset | Time (estimated) |
|-----------|--------|------------------|
| 5 | verified | ~30 minutes |
| 10 | verified | ~1 hour |
| 50 | verified | ~5 hours |
| 100 | verified | ~10 hours |
| 500 | verified (all) | ~50 hours |

**Note:** Times vary based on:
- Problem complexity
- Model speed (Grok is faster than Claude)
- Test suite duration
- Network latency

### Results Format

Results are saved as JSON in `./results/`:

```json
{
  "run_id": "swe-bench-20260329-143022",
  "timestamp": "2026-03-29T14:30:22",
  "total_instances": 10,
  "passed": 7,
  "failed": 2,
  "errors": 1,
  "pass_rate": 0.70,
  "avg_time_seconds": 387.2,
  "total_tokens": 245000,
  "total_cost_usd": 12.50,
  "avg_pdse_score": 88.3,
  "status": "passed",
  "failure_stage": null,
  "failure_kind": null,
  "verified_write_count": 3,
  "verified_write_paths": ["src/module.py", "tests/test_module.py"],
  "results": [...]
}
```

## Benchmark Safety Guarantees

Benchmark runs are fail-closed by default.

- The runner prefers `--execution-profile benchmark` when the DanteCode CLI supports it.
- If the CLI does not expose that flag yet, the runner falls back to the legacy prompt guidance for compatibility.
- A run is only counted as a true pass when tests pass and verified writes exist beyond the applied SWE-bench test patch baseline.
- If tests pass but `verified_write_count` is `0`, the run is classified as `verification_failure`, not success.

## Failure Categories

Runner output collapses failures into stable categories for triage:

- `cli_crash`
- `tool_execution_failure`
- `verification_failure`
- `benchmark_task_failure`

These labels are intended to distinguish engine failures from repository/task failures during benchmark analysis.

## Interpreting Results

### Pass Rate

- **≥75%** - Excellent (competitive with Aider 88%, OpenHands 77.6%)
- **60-74%** - Good (above baseline)
- **<60%** - Needs improvement

### PDSE Score

DanteForge's verification score (0-100):
- **≥90** - Production-ready
- **70-89** - Good quality
- **<70** - Review required

### Cost Analysis

Typical costs per instance:
- Grok: $0.10 - $0.30
- Claude Opus: $0.50 - $2.00
- GPT-4: $0.30 - $1.00

## Troubleshooting

### "datasets library not found"
```bash
pip install datasets huggingface-hub
```

### "dantecode command not found"
```bash
# Build the CLI
cd ../..
npm run build

# Or use npm run cli
python swe_bench_runner.py --dantecode "npm run cli --"
```

### "Failed to clone repo"
- Check internet connection
- Verify git is installed
- Some repos may require authentication

### "Test execution timed out"
- Increase timeout with `--timeout 900` (15 minutes)
- Some instances legitimately take longer

### "Environment setup failed"
- Check Python version (3.8+ required)
- Ensure pip can install packages
- Some repos have complex dependencies

## Advanced Usage

### Parallel Execution

Run multiple instances in parallel (experimental):
```bash
# Terminal 1
python swe_bench_runner.py --subset verified --limit 10 --output-dir ./results/run1

# Terminal 2
python swe_bench_runner.py --subset verified --limit 10 --output-dir ./results/run2
```

### Custom Model Configuration

Create a custom model configuration:
```bash
python swe_bench_runner.py \
    --model "custom/model-name" \
    --limit 5
```

### Debug Mode

Run with verbose output:
```bash
python swe_bench_runner.py --subset verified --limit 1 --verbose
```

## Benchmark Goals

### Target Metrics (for 9.0/10 Benchmarks dimension)

- **Pass Rate**: ≥75% on SWE-bench Verified
- **PDSE Score**: ≥88% average
- **Cost**: Competitive with Aider/OpenHands
- **Speed**: <10 minutes per instance average

### Current Status

- **Infrastructure**: ✅ Complete
- **Evaluation Logic**: ✅ Implemented
- **Execution**: ⏳ Ready to run
- **Results**: ⏳ Pending first run

## Contributing

To improve the benchmark:

1. **Better Test Detection**: Enhance `_get_test_command()` to detect more test runners
2. **Faster Environment Setup**: Cache cloned repos
3. **Cost Tracking**: Improve token/cost extraction from output
4. **Parallel Execution**: Add proper job distribution
5. **Result Visualization**: Generate charts and graphs

## References

- [SWE-bench Paper](https://arxiv.org/abs/2310.06770)
- [SWE-bench Dataset](https://huggingface.co/datasets/princeton-nlp/SWE-bench)
- [Aider's Approach](https://aider.chat/docs/leaderboards/)
- [OpenHands Results](https://www.all-hands.dev/blog/swebench)
