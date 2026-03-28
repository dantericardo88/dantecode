#!/usr/bin/env python3
"""
SWE-bench Runner for DanteCode

Runs DanteCode against the SWE-bench Verified test set and measures pass rate.
Based on Aider's approach but adapted for DanteCode's agent loop.

Usage:
    python swe_bench_runner.py --subset verified --limit 10
    python swe_bench_runner.py --full
"""

import argparse
import json
import subprocess
import sys
import time
from dataclasses import dataclass, asdict
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Any, Optional

@dataclass
class BenchmarkResult:
    """Result for a single SWE-bench test case"""
    instance_id: str
    repo: str
    issue_number: int
    problem_statement: str
    pass_rate: float
    time_seconds: float
    tokens_used: int
    cost_usd: float
    pdse_score: Optional[float]
    error: Optional[str]
    logs: str

@dataclass
class BenchmarkSummary:
    """Aggregate results for the benchmark run"""
    run_id: str
    timestamp: str
    total_instances: int
    passed: int
    failed: int
    errors: int
    pass_rate: float
    avg_time_seconds: float
    total_tokens: int
    total_cost_usd: float
    avg_pdse_score: Optional[float]
    results: List[BenchmarkResult]

class SWEBenchRunner:
    """Runner for SWE-bench tests using DanteCode"""

    def __init__(self, dantecode_path: str = "dantecode", output_dir: str = "../results"):
        self.dantecode_path = dantecode_path
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)

    def load_swe_bench_dataset(self, subset: str = "verified", limit: Optional[int] = None) -> List[Dict[str, Any]]:
        """Load SWE-bench dataset from Hugging Face or local cache"""
        print(f"Loading SWE-bench {subset} dataset...")

        try:
            from datasets import load_dataset
            dataset = load_dataset("princeton-nlp/SWE-bench_Verified" if subset == "verified" else "princeton-nlp/SWE-bench")
            instances = list(dataset["test"])

            if limit:
                instances = instances[:limit]

            print(f"Loaded {len(instances)} instances")
            return instances
        except ImportError:
            print("ERROR: datasets library not found. Install with: pip install datasets")
            sys.exit(1)
        except Exception as e:
            print(f"ERROR loading dataset: {e}")
            sys.exit(1)

    def run_instance(self, instance: Dict[str, Any], timeout: int = 600) -> BenchmarkResult:
        """Run a single SWE-bench instance with DanteCode"""
        instance_id = instance["instance_id"]
        repo = instance["repo"]
        issue_number = instance.get("issue_number", 0)
        problem_statement = instance["problem_statement"]

        print(f"\n{'='*80}")
        print(f"Running: {instance_id}")
        print(f"Repo: {repo}")
        print(f"{'='*80}")

        start_time = time.time()
        result = BenchmarkResult(
            instance_id=instance_id,
            repo=repo,
            issue_number=issue_number,
            problem_statement=problem_statement[:200] + "...",
            pass_rate=0.0,
            time_seconds=0.0,
            tokens_used=0,
            cost_usd=0.0,
            pdse_score=None,
            error=None,
            logs=""
        )

        try:
            # Create temporary workspace for this instance
            workspace_dir = Path(f".swe-bench-workspace/{instance_id}")
            workspace_dir.mkdir(parents=True, exist_ok=True)

            # Clone repo (simplified - real implementation would use SWE-bench's environment setup)
            print(f"Setting up environment...")

            # Run DanteCode with the problem statement
            cmd = [
                self.dantecode_path,
                "agent",
                problem_statement,
                "--cwd", str(workspace_dir),
                "--timeout", str(timeout),
                "--json"  # Output results as JSON
            ]

            print(f"Running: {' '.join(cmd)}")
            proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=timeout
            )

            elapsed = time.time() - start_time
            result.time_seconds = elapsed
            result.logs = proc.stdout + proc.stderr

            # Parse DanteCode output
            try:
                output = json.loads(proc.stdout)
                result.tokens_used = output.get("tokens_used", 0)
                result.cost_usd = output.get("cost_usd", 0.0)
                result.pdse_score = output.get("pdse_score")
            except json.JSONDecodeError:
                print("WARNING: Could not parse DanteCode JSON output")

            # Run SWE-bench evaluation to check if solution passes
            # (Simplified - real implementation would run test suite)
            tests_passed = self._evaluate_solution(instance, workspace_dir)
            result.pass_rate = 1.0 if tests_passed else 0.0

            print(f"✓ Completed in {elapsed:.1f}s - {'PASSED' if tests_passed else 'FAILED'}")

        except subprocess.TimeoutExpired:
            elapsed = time.time() - start_time
            result.time_seconds = elapsed
            result.error = f"Timeout after {timeout}s"
            print(f"✗ Timeout after {timeout}s")

        except Exception as e:
            elapsed = time.time() - start_time
            result.time_seconds = elapsed
            result.error = str(e)
            print(f"✗ Error: {e}")

        return result

    def _evaluate_solution(self, instance: Dict[str, Any], workspace_dir: Path) -> bool:
        """Evaluate if the solution passes SWE-bench tests"""
        # Placeholder - real implementation would:
        # 1. Apply the solution patch
        # 2. Run the test suite from instance["test_patch"]
        # 3. Check if tests pass
        # For now, return False as placeholder
        return False

    def run_benchmark(self, subset: str = "verified", limit: Optional[int] = None) -> BenchmarkSummary:
        """Run full benchmark suite"""
        run_id = f"swe-bench-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
        print(f"\n{'='*80}")
        print(f"Starting SWE-bench run: {run_id}")
        print(f"{'='*80}\n")

        instances = self.load_swe_bench_dataset(subset, limit)
        results = []

        for i, instance in enumerate(instances, 1):
            print(f"\n[{i}/{len(instances)}] ", end="")
            result = self.run_instance(instance)
            results.append(result)

        # Calculate summary statistics
        passed = sum(1 for r in results if r.pass_rate > 0 and not r.error)
        failed = sum(1 for r in results if r.pass_rate == 0 and not r.error)
        errors = sum(1 for r in results if r.error)

        pass_rate = passed / len(results) if results else 0.0
        avg_time = sum(r.time_seconds for r in results) / len(results) if results else 0.0
        total_tokens = sum(r.tokens_used for r in results)
        total_cost = sum(r.cost_usd for r in results)

        pdse_scores = [r.pdse_score for r in results if r.pdse_score is not None]
        avg_pdse = sum(pdse_scores) / len(pdse_scores) if pdse_scores else None

        summary = BenchmarkSummary(
            run_id=run_id,
            timestamp=datetime.now().isoformat(),
            total_instances=len(results),
            passed=passed,
            failed=failed,
            errors=errors,
            pass_rate=pass_rate,
            avg_time_seconds=avg_time,
            total_tokens=total_tokens,
            total_cost_usd=total_cost,
            avg_pdse_score=avg_pdse,
            results=results
        )

        # Save results
        output_file = self.output_dir / f"{run_id}.json"
        with open(output_file, "w") as f:
            json.dump(asdict(summary), f, indent=2)

        print(f"\n{'='*80}")
        print(f"SUMMARY")
        print(f"{'='*80}")
        print(f"Pass Rate: {pass_rate*100:.1f}% ({passed}/{len(results)})")
        print(f"Failed: {failed}")
        print(f"Errors: {errors}")
        print(f"Avg Time: {avg_time:.1f}s")
        print(f"Total Tokens: {total_tokens:,}")
        print(f"Total Cost: ${total_cost:.2f}")
        if avg_pdse:
            print(f"Avg PDSE Score: {avg_pdse:.1f}")
        print(f"\nResults saved to: {output_file}")
        print(f"{'='*80}\n")

        return summary

def main():
    parser = argparse.ArgumentParser(description="Run SWE-bench benchmarks with DanteCode")
    parser.add_argument("--subset", choices=["verified", "full"], default="verified",
                       help="Dataset subset to use (default: verified)")
    parser.add_argument("--limit", type=int, help="Limit number of instances to run")
    parser.add_argument("--dantecode", default="dantecode", help="Path to dantecode CLI")
    parser.add_argument("--output-dir", default="../results", help="Output directory for results")

    args = parser.parse_args()

    runner = SWEBenchRunner(dantecode_path=args.dantecode, output_dir=args.output_dir)
    summary = runner.run_benchmark(subset=args.subset, limit=args.limit)

    # Exit with success if pass rate >= 75%
    sys.exit(0 if summary.pass_rate >= 0.75 else 1)

if __name__ == "__main__":
    main()
