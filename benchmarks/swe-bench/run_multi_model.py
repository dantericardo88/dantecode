#!/usr/bin/env python3
"""
Multi-Model SWE-bench Comparison

Runs the same SWE-bench instances across different models to compare:
- Pass rates
- Token usage
- Cost
- Speed
- Quality (PDSE scores)
"""

import json
import sys
from pathlib import Path
from datetime import datetime
from swe_bench_runner import SWEBenchRunner

# Models to test (from fastest/cheapest to most capable)
MODELS_TO_TEST = [
    {
        "name": "Claude Haiku 4.5",
        "id": "anthropic/claude-haiku-4-5",
        "expected_cost": "$0.10-0.30 per instance",
        "expected_speed": "Fast",
    },
    {
        "name": "GPT-4o Mini",
        "id": "openai/gpt-4o-mini",
        "expected_cost": "$0.05-0.15 per instance",
        "expected_speed": "Very Fast",
    },
    {
        "name": "Grok 3",
        "id": "grok/grok-3",
        "expected_cost": "$0.15-0.40 per instance",
        "expected_speed": "Fast",
    },
    {
        "name": "Claude Sonnet 4.6",
        "id": "anthropic/claude-sonnet-4-6",
        "expected_cost": "$0.50-1.50 per instance",
        "expected_speed": "Medium",
    },
]

def run_model_comparison(limit: int = 5, offset: int = 0):
    """Run benchmark across all models and compare results"""

    print("=" * 80)
    print("Multi-Model SWE-bench Comparison")
    print("=" * 80)
    print(f"\nTesting {len(MODELS_TO_TEST)} models on {limit} instances each")
    print(f"Starting at offset {offset} in dataset\n")

    all_results = {}
    output_dir = Path("./results/multi-model")
    output_dir.mkdir(parents=True, exist_ok=True)

    for model_config in MODELS_TO_TEST:
        model_id = model_config["id"]
        model_name = model_config["name"]

        print("\n" + "=" * 80)
        print(f"Testing: {model_name} ({model_id})")
        print(f"Expected Cost: {model_config['expected_cost']}")
        print(f"Expected Speed: {model_config['expected_speed']}")
        print("=" * 80 + "\n")

        try:
            runner = SWEBenchRunner(
                output_dir=str(output_dir),
                model=model_id
            )

            # Run benchmark
            summary = runner.run_benchmark(subset="verified", limit=limit)

            # Store results
            all_results[model_name] = {
                "model_id": model_id,
                "pass_rate": summary.pass_rate,
                "passed": summary.passed,
                "failed": summary.failed,
                "errors": summary.errors,
                "avg_time": summary.avg_time_seconds,
                "total_tokens": summary.total_tokens,
                "total_cost": summary.total_cost_usd,
                "avg_pdse": summary.avg_pdse_score,
                "run_id": summary.run_id,
            }

            print(f"\n✓ {model_name} completed!")
            print(f"  Pass Rate: {summary.pass_rate*100:.1f}%")
            print(f"  Avg Time: {summary.avg_time_seconds:.1f}s")
            print(f"  Total Cost: ${summary.total_cost_usd:.2f}")

        except Exception as e:
            print(f"\n✗ {model_name} failed: {e}")
            all_results[model_name] = {
                "model_id": model_id,
                "error": str(e),
            }

    # Generate comparison report
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    comparison_file = output_dir / f"comparison-{timestamp}.json"

    with open(comparison_file, "w") as f:
        json.dump(all_results, f, indent=2)

    # Print summary table
    print("\n\n" + "=" * 80)
    print("COMPARISON SUMMARY")
    print("=" * 80)
    print(f"\n{'Model':<25} {'Pass Rate':<12} {'Avg Time':<12} {'Total Cost':<12} {'Avg PDSE':<12}")
    print("-" * 80)

    for model_name, results in all_results.items():
        if "error" in results:
            print(f"{model_name:<25} {'ERROR':<12} {'-':<12} {'-':<12} {'-':<12}")
        else:
            pass_rate = f"{results['pass_rate']*100:.1f}%"
            avg_time = f"{results['avg_time']:.1f}s"
            total_cost = f"${results['total_cost']:.2f}"
            avg_pdse = f"{results['avg_pdse']:.1f}" if results['avg_pdse'] else "N/A"
            print(f"{model_name:<25} {pass_rate:<12} {avg_time:<12} {total_cost:<12} {avg_pdse:<12}")

    print("\n" + "=" * 80)
    print(f"Results saved to: {comparison_file}")
    print("=" * 80)

    return all_results

def main():
    import argparse
    parser = argparse.ArgumentParser(description="Run multi-model SWE-bench comparison")
    parser.add_argument("--limit", type=int, default=5, help="Number of instances per model")
    parser.add_argument("--offset", type=int, default=0, help="Offset in dataset (skip first N)")

    args = parser.parse_args()

    results = run_model_comparison(limit=args.limit, offset=args.offset)

    # Exit with success if any model got >0% pass rate
    any_passed = any(r.get("pass_rate", 0) > 0 for r in results.values())
    sys.exit(0 if any_passed else 1)

if __name__ == "__main__":
    main()
