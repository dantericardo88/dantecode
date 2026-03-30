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

    def __init__(self, dantecode_path: str = "dantecode", output_dir: str = "../results", model: Optional[str] = None):
        # On Windows, try to find the PowerShell script if not explicitly provided
        if dantecode_path == "dantecode":
            import platform
            if platform.system() == "Windows":
                # Try common npm global install location
                npm_path = Path.home() / "AppData" / "Roaming" / "npm" / "dantecode.ps1"
                if npm_path.exists():
                    dantecode_path = str(npm_path)

        self.dantecode_path = dantecode_path
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.model = model or "grok/grok-3"  # Default to Grok for fast reasoning

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

            # Set up the repository environment
            print(f"Setting up environment...")
            env_success = self._setup_swe_bench_env(instance, workspace_dir)
            if not env_success:
                result.error = "Failed to set up environment"
                print(f"✗ Environment setup failed")
                return result

            # CRITICAL: Apply test patch BEFORE running DanteCode
            # The test patch adds tests to the original code
            # DanteCode will then try to make those tests pass
            print("Applying test patch...")
            patch_success = self._apply_test_patch(instance, workspace_dir)
            if not patch_success:
                result.error = "Failed to apply test patch"
                print(f"✗ Test patch failed to apply")
                return result

            # Run DanteCode with the problem statement
            # DanteCode runs in the cwd, so we need to execute from workspace_dir
            # Use --max-rounds to limit execution time
            # Use --silent to minimize output noise

            # On Windows, if dantecode is a .ps1 script, we need to invoke it through PowerShell
            import platform
            if platform.system() == "Windows" and self.dantecode_path.endswith(".ps1"):
                cmd = [
                    "powershell.exe",
                    "-ExecutionPolicy", "Bypass",
                    "-File", self.dantecode_path,
                    problem_statement,
                    "--model", self.model,
                    "--max-rounds", "10",
                    "--silent"
                ]
            else:
                cmd = [
                    self.dantecode_path,
                    problem_statement,
                    "--model", self.model,
                    "--max-rounds", "10",
                    "--silent"
                ]

            print(f"Running: {self.dantecode_path} \"<problem_statement>\" --model {self.model}")
            proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=timeout,
                cwd=str(workspace_dir)  # Run in the workspace directory
            )

            elapsed = time.time() - start_time
            result.time_seconds = elapsed
            result.logs = proc.stdout + proc.stderr

            # Extract metrics from DanteCode output
            # Look for patterns like "tokens: 1234" or "cost: $0.12" in output
            output_text = proc.stdout + proc.stderr

            # Try to extract token count (rough estimate from output length if not found)
            import re
            token_match = re.search(r'tokens?:\s*(\d+)', output_text, re.IGNORECASE)
            if token_match:
                result.tokens_used = int(token_match.group(1))
            else:
                # Rough estimate: 1 token ~= 4 characters
                result.tokens_used = len(output_text) // 4

            # Try to extract cost
            cost_match = re.search(r'cost:\s*\$?([0-9.]+)', output_text, re.IGNORECASE)
            if cost_match:
                result.cost_usd = float(cost_match.group(1))

            # Try to extract PDSE score
            pdse_match = re.search(r'pdse.*?:?\s*([0-9.]+)', output_text, re.IGNORECASE)
            if pdse_match:
                result.pdse_score = float(pdse_match.group(1))

            # Run the tests to check if DanteCode's solution passes
            tests_passed = self._run_tests(instance, workspace_dir)
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

    def _setup_swe_bench_env(self, instance: Dict[str, Any], workspace_dir: Path) -> bool:
        """Set up the repository environment for a SWE-bench instance"""
        try:
            repo = instance.get("repo", "")
            base_commit = instance.get("base_commit", "")

            if not repo or not base_commit:
                print(f"ERROR: Missing repo ({repo}) or base_commit ({base_commit})")
                return False

            # Convert repo name to GitHub URL
            # Format: "owner/repo" -> "https://github.com/owner/repo.git"
            repo_url = f"https://github.com/{repo}.git"

            # Clone repository if not already present
            if not (workspace_dir / ".git").exists():
                print(f"Cloning {repo}...")
                clone_result = subprocess.run(
                    ["git", "clone", "--depth", "1", "--no-single-branch", repo_url, "."],
                    cwd=workspace_dir,
                    capture_output=True,
                    text=True,
                    timeout=120  # 2 minute timeout for clone
                )

                if clone_result.returncode != 0:
                    print(f"ERROR: Failed to clone repo: {clone_result.stderr}")
                    return False

            # Fetch the specific commit (in case depth=1 didn't get it)
            print(f"Fetching commit {base_commit[:8]}...")
            subprocess.run(
                ["git", "fetch", "origin", base_commit],
                cwd=workspace_dir,
                capture_output=True,
                text=True,
                timeout=60
            )

            # Checkout the base commit
            print(f"Checking out {base_commit[:8]}...")
            checkout_result = subprocess.run(
                ["git", "checkout", base_commit],
                cwd=workspace_dir,
                capture_output=True,
                text=True
            )

            if checkout_result.returncode != 0:
                print(f"ERROR: Failed to checkout commit: {checkout_result.stderr}")
                return False

            # Install dependencies - try multiple common patterns
            installed_something = False

            # 1. Install from requirements.txt if it exists
            if (workspace_dir / "requirements.txt").exists():
                print("Installing Python dependencies...")
                subprocess.run(
                    ["pip", "install", "-q", "-r", "requirements.txt"],
                    cwd=workspace_dir,
                    capture_output=True,
                    timeout=300
                )
                installed_something = True

            # 2. Install from setup.py (development mode)
            if (workspace_dir / "setup.py").exists():
                print("Installing package in development mode...")
                subprocess.run(
                    ["pip", "install", "-q", "-e", "."],
                    cwd=workspace_dir,
                    capture_output=True,
                    timeout=300
                )
                installed_something = True

            # 3. Install test dependencies (common patterns)
            test_req_files = [
                "requirements-dev.txt",
                "test-requirements.txt",
                "dev-requirements.txt",
                ".requirements-dev.txt"
            ]
            for test_req in test_req_files:
                if (workspace_dir / test_req).exists():
                    print(f"Installing test dependencies from {test_req}...")
                    subprocess.run(
                        ["pip", "install", "-q", "-r", test_req],
                        cwd=workspace_dir,
                        capture_output=True,
                        timeout=300
                    )
                    installed_something = True
                    break

            # 4. Install common test dependencies for astropy and similar projects
            # This handles the "hypothesis" module error we saw
            if "astropy" in repo.lower():
                print("Installing common astropy test dependencies...")
                subprocess.run(
                    ["pip", "install", "-q", "hypothesis", "pytest-astropy", "pytest-xdist", "pytest-cov"],
                    cwd=workspace_dir,
                    capture_output=True,
                    timeout=300
                )

            # 5. Try setup.py with [test] extras if available
            if (workspace_dir / "setup.py").exists() and not installed_something:
                print("Installing package with test extras...")
                subprocess.run(
                    ["pip", "install", "-q", "-e", ".[test]"],
                    cwd=workspace_dir,
                    capture_output=True,
                    timeout=300
                )

            print("✓ Environment ready")
            return True

        except subprocess.TimeoutExpired:
            print("ERROR: Environment setup timed out")
            return False
        except Exception as e:
            print(f"ERROR during environment setup: {e}")
            return False

    def _apply_test_patch(self, instance: Dict[str, Any], workspace_dir: Path) -> bool:
        """Apply the test patch to add tests to the repository"""
        try:
            # Extract test information from instance
            test_patch = instance.get("test_patch", "")
            if not test_patch:
                print("WARNING: No test_patch found in instance")
                return False

            # Write test patch to a temporary file
            test_patch_file = workspace_dir / "test.patch"
            with open(test_patch_file, "w") as f:
                f.write(test_patch)

            # Apply test patch using git apply
            # Use just the filename since we're setting cwd to workspace_dir
            apply_result = subprocess.run(
                ["git", "apply", "test.patch"],
                cwd=str(workspace_dir),
                capture_output=True,
                text=True
            )

            if apply_result.returncode != 0:
                print(f"WARNING: Failed to apply test patch: {apply_result.stderr}")
                # Try --3way merge as fallback
                apply_result = subprocess.run(
                    ["git", "apply", "--3way", "test.patch"],
                    cwd=str(workspace_dir),
                    capture_output=True,
                    text=True
                )
                if apply_result.returncode != 0:
                    print(f"ERROR: Could not apply test patch even with --3way")
                    return False

            print("✓ Test patch applied successfully")
            return True

        except Exception as e:
            print(f"ERROR applying test patch: {e}")
            return False

    def _run_tests(self, instance: Dict[str, Any], workspace_dir: Path) -> bool:
        """Run the tests to check if DanteCode's solution passes"""
        try:
            # Determine test command based on repo
            # Most SWE-bench repos use pytest, but some use unittest or other runners
            repo_name = instance.get("repo", "")
            test_cmd = self._get_test_command(repo_name, instance)

            print(f"Running tests: {' '.join(test_cmd)}")
            test_result = subprocess.run(
                test_cmd,
                cwd=workspace_dir,
                capture_output=True,
                text=True,
                timeout=300  # 5 minute timeout for tests
            )

            # Parse test output to determine pass/fail
            # Most test runners exit with 0 for success, non-zero for failure
            tests_passed = test_result.returncode == 0

            if not tests_passed:
                print(f"Tests failed with exit code {test_result.returncode}")
                print(f"Output: {test_result.stdout[-500:]}")  # Last 500 chars
                print(f"Errors: {test_result.stderr[-500:]}")

            return tests_passed

        except subprocess.TimeoutExpired:
            print("ERROR: Test execution timed out (300s)")
            return False
        except Exception as e:
            print(f"ERROR during test evaluation: {e}")
            return False

    def _get_test_command(self, repo_name: str, instance: Dict[str, Any]) -> List[str]:
        """Determine the appropriate test command for the repository"""
        # Extract test file path if specified in hints_text
        hints = instance.get("hints_text", "")

        # Common patterns for test runners
        if "pytest" in hints.lower() or "test_" in hints.lower():
            # Most repos use pytest
            return ["python", "-m", "pytest", "-xvs"]
        elif "unittest" in hints.lower():
            return ["python", "-m", "unittest", "discover"]
        elif "django" in repo_name.lower():
            return ["python", "manage.py", "test"]
        elif "flask" in repo_name.lower():
            return ["python", "-m", "pytest", "-xvs"]
        else:
            # Default to pytest (most common)
            return ["python", "-m", "pytest", "-xvs"]

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
    parser.add_argument("--model", default="grok/grok-3", help="Model to use (default: grok/grok-3)")

    args = parser.parse_args()

    runner = SWEBenchRunner(dantecode_path=args.dantecode, output_dir=args.output_dir, model=args.model)
    summary = runner.run_benchmark(subset=args.subset, limit=args.limit)

    # Exit with success if pass rate >= 75%
    sys.exit(0 if summary.pass_rate >= 0.75 else 1)

if __name__ == "__main__":
    main()
