# DanteCode Benchmarks

Comprehensive benchmark suite for evaluating DanteCode's real-world performance against competitors.

## Benchmark Categories

### 1. SWE-bench (Software Engineering Benchmark)
- **Location**: `./swe-bench/`
- **Purpose**: Measure code generation quality on real-world GitHub issues
- **Competitors**: Aider (88%), OpenHands (77.6%), Claude Code (80.8%)
- **Target**: 75%+ pass rate

### 2. Provider Smoke Tests
- **Location**: `./providers/`
- **Purpose**: Verify live integration with Anthropic, OpenAI, and X.AI (Grok)
- **Output**: API logs, response times, costs, receipts

### 3. Speed Benchmarks
- **Location**: `./speed/`
- **Purpose**: Measure time-to-first-suggestion, task completion, deployment time
- **Metrics**: p50, p95, p99 latencies

### 4. Multi-Model Comparative
- **Location**: `./results/`
- **Purpose**: Compare same task across different models
- **Metrics**: Token usage, costs, quality scores

## Running Benchmarks

```bash
# SWE-bench
cd benchmarks/swe-bench && python swe_bench_runner.py

# Provider smoke tests
npm run benchmark:providers

# Speed benchmarks
npm run benchmark:speed

# Full suite
npm run benchmark:all
```

## Results

All benchmark results are stored in `./results/` with timestamps:
- `swe-bench-{date}.json`
- `provider-smoke-{provider}-{date}.json`
- `speed-metrics-{date}.json`
- `multi-model-{date}.json`

## Artifacts

- **CSV Exports**: `./results/*.csv`
- **Visual Charts**: `./results/*.svg`
- **Summary Reports**: `./results/summary-{date}.md`
