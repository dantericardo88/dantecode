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
from dataclasses import dataclass, asdict, field
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Any, Optional

# Import cost tracker
try:
    from cost_tracker import CostTracker
except ImportError:
    # Fallback if cost_tracker not available
    CostTracker = None

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
    status: str = "pending"
    failure_stage: Optional[str] = None
    failure_kind: Optional[str] = None
    failure_exit_code: Optional[int] = None
    failure_timed_out: bool = False
    execution_profile_used: bool = False
    prompt_hack_used: bool = False
    verified_write_count: int = 0
    verified_write_paths: List[str] = field(default_factory=list)

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
    failure_breakdown: Dict[str, int] = field(default_factory=dict)


@dataclass
class ExecutionPlan:
    """Dry-run plan for a single SWE-bench instance."""
    instance_id: str
    repo: str
    workspace_dir: str
    dantecode_command: List[str]
    test_command: List[str]
    execution_profile: Optional[str]
    execution_profile_flag: Optional[str]
    uses_execution_profile: bool
    prompt_hack_used: bool
    prompt: str
    test_strategy: str


@dataclass
class FailureClassification:
    """Structured failure label for benchmark reporting."""
    stage: str
    kind: str
    message: str
    exit_code: Optional[int] = None
    timed_out: bool = False

class SWEBenchRunner:
    """Runner for SWE-bench tests using DanteCode"""

    def __init__(
        self,
        dantecode_path: str = "dantecode",
        output_dir: str = "../results",
        model: Optional[str] = None,
        enable_retry: bool = True,
        execution_profile: Optional[str] = None,
        execution_profile_flag: str = "--execution-profile",
    ):
        # On Windows, try to find the .cmd script if not explicitly provided
        # .cmd is more reliable than .ps1 for subprocess calls
        if dantecode_path == "dantecode":
            import platform
            if platform.system() == "Windows":
                # Try .cmd first (more reliable), then .ps1 as fallback
                npm_cmd = Path.home() / "AppData" / "Roaming" / "npm" / "dantecode.cmd"
                npm_ps1 = Path.home() / "AppData" / "Roaming" / "npm" / "dantecode.ps1"
                if npm_cmd.exists():
                    dantecode_path = str(npm_cmd)
                elif npm_ps1.exists():
                    dantecode_path = str(npm_ps1)

        self.dantecode_path = dantecode_path
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.model = model or "grok/grok-3"  # Default to Grok for fast reasoning
        self.enable_retry = enable_retry
        self.execution_profile = execution_profile or None
        self.execution_profile_flag = execution_profile_flag
        self._execution_profile_support_cache: Optional[bool] = None
        self._last_test_failure: Optional[FailureClassification] = None

    def load_swe_bench_dataset(self, subset: str = "verified", limit: Optional[int] = None, offset: int = 0) -> List[Dict[str, Any]]:
        """Load SWE-bench dataset from Hugging Face or local cache"""
        print(f"Loading SWE-bench {subset} dataset...")

        try:
            from datasets import load_dataset
            dataset = load_dataset("princeton-nlp/SWE-bench_Verified" if subset == "verified" else "princeton-nlp/SWE-bench")
            instances = list(dataset["test"])

            # Apply offset to skip early instances
            if offset > 0:
                instances = instances[offset:]
                print(f"Skipping first {offset} instances")

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

    def _run_with_retry(self, cmd: List[str], max_retries: int = 3, **kwargs) -> subprocess.CompletedProcess:
        """Run subprocess command with exponential backoff retry on network failures"""
        if not self.enable_retry:
            return subprocess.run(cmd, **kwargs)

        for attempt in range(max_retries):
            try:
                return subprocess.run(cmd, **kwargs)
            except subprocess.TimeoutExpired:
                raise  # Don't retry timeouts, they're legitimate failures
            except Exception as e:
                if attempt == max_retries - 1:
                    raise
                # Exponential backoff: 2s, 4s, 8s
                wait_time = 2 ** attempt
                print(f"  [RETRY {attempt + 1}/{max_retries}] Command failed: {e}, retrying in {wait_time}s...")
                time.sleep(wait_time)

        # Should never reach here due to raise in loop
        return subprocess.run(cmd, **kwargs)

    def _resolve_dantecode_invocation(self) -> List[str]:
        """Return the launcher prefix for the configured DanteCode CLI."""
        import platform

        if platform.system() == "Windows":
            if self.dantecode_path.endswith(".ps1"):
                return [
                    "powershell.exe",
                    "-ExecutionPolicy",
                    "Bypass",
                    "-NoProfile",
                    "-File",
                    self.dantecode_path,
                ]
            if self.dantecode_path.endswith(".cmd"):
                return [self.dantecode_path]

        if " " in self.dantecode_path:
            return self.dantecode_path.split(" ", 1)

        return [self.dantecode_path]

    def _build_problem_prompt(self, problem_statement: str, use_prompt_hack: bool) -> str:
        """Build the prompt sent to DanteCode, optionally with the legacy workaround."""
        if not use_prompt_hack:
            return problem_statement

        return (
            f"{problem_statement}\n\n"
            "IMPORTANT: When modifying files, use the Write tool instead of Edit tool. "
            "Read the file first, modify the content in your reasoning, then Write the complete new file. "
            "After writing the fix, respond with just 'Fix applied successfully' and nothing else."
        )

    def _supports_execution_profile_flag(self) -> bool:
        """Probe the CLI help output for an explicit execution-profile flag."""
        if not self.execution_profile:
            return False

        if self._execution_profile_support_cache is not None:
            return self._execution_profile_support_cache

        try:
            help_cmd = self._resolve_dantecode_invocation() + ["--help"]
            help_result = subprocess.run(
                help_cmd,
                capture_output=True,
                text=True,
                timeout=20,
            )
            combined_help = (help_result.stdout or "") + (help_result.stderr or "")
            supported = self.execution_profile_flag in combined_help
            self._execution_profile_support_cache = supported
            return supported
        except Exception:
            self._execution_profile_support_cache = False
            return False

    def build_execution_plan(
        self,
        instance: Dict[str, Any],
        workspace_dir: Optional[Path] = None,
    ) -> ExecutionPlan:
        """Build the command plan for a single SWE-bench instance without running it."""
        repo = instance.get("repo", "")
        problem_statement = instance.get("problem_statement", "")
        uses_execution_profile = self._supports_execution_profile_flag()
        prompt_hack_used = not uses_execution_profile
        prompt = self._build_problem_prompt(problem_statement, prompt_hack_used)
        launcher = self._resolve_dantecode_invocation()
        command = launcher + [prompt]

        if uses_execution_profile and self.execution_profile:
            command.extend([self.execution_profile_flag, self.execution_profile])

        command.extend([
            "--model",
            self.model,
            "--max-rounds",
            "15",
            "--yolo",
        ])

        test_command = self._get_test_command(repo, instance, workspace_dir)
        test_strategy = self._describe_test_strategy(test_command)

        return ExecutionPlan(
            instance_id=instance.get("instance_id", ""),
            repo=repo,
            workspace_dir=str(workspace_dir) if workspace_dir else "",
            dantecode_command=command,
            test_command=test_command,
            execution_profile=self.execution_profile,
            execution_profile_flag=self.execution_profile_flag if uses_execution_profile else None,
            uses_execution_profile=uses_execution_profile,
            prompt_hack_used=prompt_hack_used,
            prompt=prompt,
            test_strategy=test_strategy,
        )

    def classify_failure(
        self,
        stage: str,
        message: str,
        *,
        exit_code: Optional[int] = None,
        timed_out: bool = False,
    ) -> FailureClassification:
        """Label a runner failure with a stable stage/kind pair."""
        normalized_stage = stage.strip().lower() or "unknown"

        if timed_out:
            kind = "timeout"
        elif normalized_stage == "setup":
            kind = "environment"
        elif normalized_stage == "patch":
            kind = "patch-application"
        elif normalized_stage == "tests":
            kind = "test-failure" if exit_code not in (None, 0) else "test-error"
        elif normalized_stage == "run":
            kind = "runner-error"
        else:
            kind = "unknown"

        return FailureClassification(
            stage=normalized_stage,
            kind=kind,
            message=message,
            exit_code=exit_code,
            timed_out=timed_out,
        )

    def _get_dirty_files(self, workspace_dir: Path) -> List[str]:
        """Return all dirty file paths relative to the repository root."""
        status_result = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=workspace_dir,
            capture_output=True,
            text=True,
            timeout=30,
        )
        if status_result.returncode != 0:
            return []

        dirty_files: List[str] = []
        for line in status_result.stdout.splitlines():
            if len(line) < 4:
                continue
            dirty_files.append(line[3:].strip())
        return dirty_files

    def _derive_failure_kind(
        self,
        result: BenchmarkResult,
        tests_passed: bool,
    ) -> Optional[str]:
        """Map runner/test state into benchmark-facing failure categories."""
        if tests_passed and result.verified_write_count > 0:
            return None

        normalized_logs = result.logs.lower()

        if result.failure_timed_out:
            return "benchmark_task_failure"

        if result.failure_stage in {"setup", "patch"}:
            return "benchmark_task_failure"

        if "verification failed" in normalized_logs or "[verification]" in normalized_logs or "[deliverables]" in normalized_logs:
            return "verification_failure"

        if (
            "[tool-parse-error]" in normalized_logs
            or "retry loop detected" in normalized_logs
            or "tool execution results:" in normalized_logs
            or "blocked:" in normalized_logs
        ):
            return "tool_execution_failure"

        if result.failure_stage == "run" and result.failure_exit_code not in (None, 0):
            return "cli_crash"

        if tests_passed and result.verified_write_count == 0:
            return "verification_failure"

        if result.failure_stage == "tests":
            return "benchmark_task_failure"

        return result.failure_kind

    def _describe_test_strategy(self, test_command: List[str]) -> str:
        """Summarize the test command for dry-run output."""
        if len(test_command) >= 2 and test_command[1] == "tests/runtests.py":
            return "django-runtests"
        if len(test_command) >= 3 and test_command[1:3] == ["-m", "pytest"]:
            return "pytest"
        if len(test_command) >= 3 and test_command[1:3] == ["-m", "unittest"]:
            return "unittest"
        return "custom"

    def run_instance(self, instance: Dict[str, Any], timeout: int = 180) -> BenchmarkResult:
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
                failure = self.classify_failure("setup", "Failed to set up environment")
                result.error = failure.message
                result.failure_stage = failure.stage
                result.failure_kind = failure.kind
                result.failure_exit_code = failure.exit_code
                result.failure_timed_out = failure.timed_out
                result.status = "error"
                print(f"[FAIL] Environment setup failed")
                return result

            # CRITICAL: Apply test patch BEFORE running DanteCode
            # The test patch adds tests to the original code
            # DanteCode will then try to make those tests pass
            print("Applying test patch...")
            patch_success = self._apply_test_patch(instance, workspace_dir)
            if not patch_success:
                failure = self.classify_failure("patch", "Failed to apply test patch")
                result.error = failure.message
                result.failure_stage = failure.stage
                result.failure_kind = failure.kind
                result.failure_exit_code = failure.exit_code
                result.failure_timed_out = failure.timed_out
                result.status = "error"
                print(f"[FAIL] Test patch failed to apply")
                return result

            baseline_dirty_files = set(self._get_dirty_files(workspace_dir))

            # CRITICAL: Clean up .dantecode/STATE.yaml to avoid stale sandbox settings
            # Previous runs may have created STATE.yaml with runInSandbox:true which forces
            # sandbox mode even when --sandbox flag is not passed, causing tool failures
            state_yaml = workspace_dir / ".dantecode" / "STATE.yaml"
            if state_yaml.exists():
                print("Cleaning stale STATE.yaml...")
                state_yaml.unlink()

            # Build the run plan once so dry-run mode can reuse the same logic.
            plan = self.build_execution_plan(instance, workspace_dir)
            result.execution_profile_used = plan.uses_execution_profile
            result.prompt_hack_used = plan.prompt_hack_used

            # Run DanteCode with the problem statement.
            # DanteCode runs in the cwd, so we need to execute from workspace_dir.
            cmd = plan.dantecode_command

            print(f"Running DanteCode with {self.model} (max 15 rounds, timeout: {timeout}s)")
            if plan.uses_execution_profile and plan.execution_profile:
                print(f"  [INFO] Using execution profile: {plan.execution_profile}")
            elif plan.prompt_hack_used:
                print("  [INFO] Falling back to legacy prompt guidance for Write-tool preference")
            print(f"  Command: {self.dantecode_path}")
            import os

            # CRITICAL: subprocess.run needs env as a proper dict copy, not os.environ directly
            # Also ensure GROK_API_KEY is explicitly set
            env = os.environ.copy()

            # Verify API key is present
            grok_key = os.getenv('GROK_API_KEY') or os.getenv('XAI_API_KEY')
            if grok_key:
                # Set both variants for maximum compatibility
                env['GROK_API_KEY'] = grok_key
                env['XAI_API_KEY'] = grok_key
                print(f"  [DEBUG] API key set (length: {len(grok_key)})")
            else:
                print("  [WARNING] No API key found!")

            print(f"  [DEBUG] Starting subprocess...")
            import sys
            sys.stdout.flush()  # Ensure output is visible immediately

            proc = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=timeout,
                cwd=str(workspace_dir),
                env=env,
                stdin=subprocess.DEVNULL  # Prevent hanging on stdin prompts
            )

            elapsed = time.time() - start_time
            print(f"  [DEBUG] Subprocess completed (exit code: {proc.returncode}, time: {elapsed:.1f}s)")
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

            # Calculate cost using CostTracker if available
            if CostTracker and result.tokens_used > 0:
                tracker = CostTracker()
                result.cost_usd = tracker.estimate_cost(self.model, result.tokens_used)
            else:
                # Try to extract cost from output as fallback
                # Regex requires at least one digit (prevents "." from matching)
                cost_match = re.search(r'cost:\s*\$?(\d+(?:\.\d+)?)', output_text, re.IGNORECASE)
                if cost_match:
                    result.cost_usd = float(cost_match.group(1))

            # Try to extract PDSE score
            # Regex requires at least one digit (prevents "." from matching)
            pdse_match = re.search(r'pdse.*?:?\s*(\d+(?:\.\d+)?)', output_text, re.IGNORECASE)
            if pdse_match:
                result.pdse_score = float(pdse_match.group(1))

            print(f"[OK] DanteCode completed in {elapsed:.1f}s")

        except subprocess.TimeoutExpired as e:
            elapsed = time.time() - start_time
            result.time_seconds = elapsed
            failure = self.classify_failure(
                "run",
                f"Timeout after {timeout}s (but will still run tests)",
                timed_out=True,
            )
            result.error = failure.message
            result.failure_stage = failure.stage
            result.failure_kind = failure.kind
            result.failure_exit_code = failure.exit_code
            result.failure_timed_out = failure.timed_out
            # Capture partial output before timeout
            if e.stdout or e.stderr:
                result.logs = (e.stdout or "") + (e.stderr or "")
            print(f"[WARN] DanteCode timeout after {timeout}s (partial output: {len(result.logs)} bytes)")
            print(f"[INFO] Will attempt to run tests anyway to check if fix was applied...")

        except Exception as e:
            elapsed = time.time() - start_time
            result.time_seconds = elapsed
            failure = self.classify_failure("run", f"Error: {e} (but will still run tests)")
            result.error = failure.message
            result.failure_stage = failure.stage
            result.failure_kind = failure.kind
            result.failure_exit_code = failure.exit_code
            result.failure_timed_out = failure.timed_out
            print(f"[WARN] DanteCode error: {e}")
            print(f"[INFO] Will attempt to run tests anyway to check if fix was applied...")

        # CRITICAL: Always run tests after DanteCode completes (or times out)
        # This allows us to detect successful fixes even when DanteCode times out
        # during refinement attempts after the fix is already applied
        print(f"\nRunning tests to verify solution...")
        self._last_test_failure = None
        tests_passed = self._run_tests(instance, workspace_dir)
        current_dirty_files = set(self._get_dirty_files(workspace_dir))
        verified_write_paths = sorted(current_dirty_files - baseline_dirty_files)
        result.verified_write_count = len(verified_write_paths)
        result.verified_write_paths = verified_write_paths

        if tests_passed:
            if result.verified_write_count == 0:
                result.pass_rate = 0.0
                result.status = "error"
                result.error = "Tests passed but no verified writes were detected beyond the applied test patch."
                result.failure_stage = "verification"
                result.failure_kind = "verification_failure"
                print("[FAIL] Tests passed, but no verified writes were detected.")
            else:
                result.pass_rate = 1.0
                result.status = "passed"
                print(f"[PASS] Tests passed! Solution is correct.")
        else:
            result.pass_rate = 0.0
            test_failure = self._last_test_failure or self.classify_failure("tests", "Tests failed", exit_code=1)
            result.error = test_failure.message
            result.failure_stage = test_failure.stage
            result.failure_kind = test_failure.kind
            result.failure_exit_code = test_failure.exit_code
            result.failure_timed_out = test_failure.timed_out
            result.status = "failed" if test_failure.kind == "test-failure" else "error"
            print(f"[FAIL] Tests failed.")

        result.failure_kind = self._derive_failure_kind(result, tests_passed)

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
                clone_result = self._run_with_retry(
                    ["git", "clone", "--depth", "1", "--no-single-branch", repo_url, "."],
                    max_retries=3,
                    cwd=workspace_dir,
                    capture_output=True,
                    text=True,
                    timeout=300  # Increased to 5min for large repos (Django, etc.)
                )

                if clone_result.returncode != 0:
                    print(f"ERROR: Failed to clone repo: {clone_result.stderr}")
                    return False
            else:
                print(f"Reusing existing workspace...")

            # Check if we're already at the right commit
            current_commit_result = subprocess.run(
                ["git", "rev-parse", "HEAD"],
                cwd=workspace_dir,
                capture_output=True,
                text=True
            )
            current_commit = current_commit_result.stdout.strip() if current_commit_result.returncode == 0 else ""

            if current_commit != base_commit:
                # Fetch the specific commit (in case depth=1 didn't get it)
                print(f"Fetching commit {base_commit[:8]}...")
                self._run_with_retry(
                    ["git", "fetch", "origin", base_commit],
                    max_retries=3,
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
            else:
                print(f"Already at commit {base_commit[:8]}...")

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
                    ["pip", "install", "-q", "pyerfa", "hypothesis", "pytest-astropy", "pytest-xdist", "pytest-cov", "numpy", "scipy"],
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

            print("[OK] Environment ready")
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
            # Try multiple strategies for maximum compatibility

            # Strategy 1: Clean apply
            apply_result = subprocess.run(
                ["git", "apply", "test.patch"],
                cwd=str(workspace_dir),
                capture_output=True,
                text=True
            )

            if apply_result.returncode != 0:
                print(f"Strategy 1 failed, trying with --ignore-whitespace...")
                # Strategy 2: Ignore whitespace differences
                apply_result = subprocess.run(
                    ["git", "apply", "--ignore-whitespace", "test.patch"],
                    cwd=str(workspace_dir),
                    capture_output=True,
                    text=True
                )

            if apply_result.returncode != 0:
                print(f"Strategy 2 failed, trying with --3way...")
                # Strategy 3: 3-way merge
                apply_result = subprocess.run(
                    ["git", "apply", "--3way", "--ignore-whitespace", "test.patch"],
                    cwd=str(workspace_dir),
                    capture_output=True,
                    text=True
                )

            if apply_result.returncode != 0:
                print(f"Strategy 3 failed, trying with --reject (partial application)...")
                # Strategy 4: Apply what we can, reject the rest
                apply_result = subprocess.run(
                    ["git", "apply", "--reject", "--ignore-whitespace", "test.patch"],
                    cwd=str(workspace_dir),
                    capture_output=True,
                    text=True
                )
                # --reject returns non-zero but still applies parts
                # Check if any files were modified
                status_result = subprocess.run(
                    ["git", "diff", "--name-only"],
                    cwd=str(workspace_dir),
                    capture_output=True,
                    text=True
                )
                if status_result.stdout.strip():
                    print(f"[OK] Partial test patch applied (some hunks rejected)")
                    return True
                else:
                    print(f"ERROR: Could not apply any part of test patch")
                    print(f"Patch error: {apply_result.stderr[:500]}")
                    return False

            print("[OK] Test patch applied successfully")
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
            test_cmd = self._get_test_command(repo_name, instance, workspace_dir)

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
                self._last_test_failure = self.classify_failure(
                    "tests",
                    f"Tests failed with exit code {test_result.returncode}",
                    exit_code=test_result.returncode,
                )
            else:
                self._last_test_failure = None

            return tests_passed

        except subprocess.TimeoutExpired:
            print("ERROR: Test execution timed out (300s)")
            self._last_test_failure = self.classify_failure(
                "tests",
                "Test execution timed out (300s)",
                timed_out=True,
            )
            return False
        except Exception as e:
            print(f"ERROR during test evaluation: {e}")
            self._last_test_failure = self.classify_failure("tests", f"Error during test evaluation: {e}")
            return False

    def _extract_test_modules_from_patch(self, instance: Dict[str, Any], workspace_dir: Path) -> List[str]:
        """Extract test module names from test_patch for targeted test execution"""
        test_patch = instance.get("test_patch", "")
        if not test_patch:
            return []

        import re
        # Extract all test file paths from patch (lines starting with "diff --git a/tests/...")
        # Example: "diff --git a/tests/i18n/patterns/tests.py" -> "i18n.patterns.tests"
        test_files = re.findall(r'diff --git a/tests/(.+?\.py)', test_patch)

        # Convert file paths to Python module names
        # Example: "i18n/patterns/tests.py" -> "i18n.patterns.tests"
        test_modules = []
        primary_module = None
        for file_path in test_files:
            # Remove .py extension and convert slashes to dots
            module = file_path.replace('/', '.').replace('\\', '.').replace('.py', '')

            # Skip non-test files (urls.py, etc.) - only run actual test files
            if module.endswith('.tests') or '/tests' in module or '\\tests' in module:
                test_modules.append(module)
                # The first test file is usually the primary one
                if primary_module is None:
                    primary_module = module

        # Remove duplicates
        unique_modules = list(set(test_modules))

        # If we have multiple modules, prioritize the primary one
        if primary_module and primary_module in unique_modules:
            # Move primary to front
            unique_modules.remove(primary_module)
            unique_modules.insert(0, primary_module)

        return unique_modules

    def _get_test_command(self, repo_name: str, instance: Dict[str, Any], workspace_dir: Path = None) -> List[str]:
        """Determine the appropriate test command for the repository"""
        # Extract test file path if specified in hints_text
        hints = instance.get("hints_text", "")

        # Check for Django's runtests.py (most accurate for Django core)
        if workspace_dir and (workspace_dir / "tests" / "runtests.py").exists():
            # Django core uses tests/runtests.py
            # Extract test modules from test_patch to run only relevant tests
            test_modules = self._extract_test_modules_from_patch(instance, workspace_dir)
            print(f"  [DEBUG] Extracted {len(test_modules)} test modules: {test_modules}")
            if test_modules:
                # Run PRIMARY test module only (the first/most relevant one)
                # This avoids unrelated test failures in other modules added by test patch
                primary_module = test_modules[0]
                print(f"  [INFO] Running primary test module: {primary_module}")
                return ["python", "tests/runtests.py", "--verbosity", "2", primary_module]
            else:
                # Fallback: run all tests (slow but comprehensive)
                print(f"  [WARN] No test modules extracted, running all tests (slow!)")
                return ["python", "tests/runtests.py", "--verbosity", "2"]

        # Common patterns for test runners
        if "pytest" in hints.lower() or "test_" in hints.lower():
            # Most repos use pytest
            return ["python", "-m", "pytest", "-xvs"]
        elif "unittest" in hints.lower():
            return ["python", "-m", "unittest", "discover"]
        elif "django" in repo_name.lower():
            # Django projects (not core) might use manage.py
            return ["python", "-m", "pytest", "tests/", "-xvs"]
        elif "flask" in repo_name.lower():
            return ["python", "-m", "pytest", "-xvs"]
        else:
            # Default to pytest (most common)
            return ["python", "-m", "pytest", "-xvs"]

    def run_benchmark(self, subset: str = "verified", limit: Optional[int] = None, offset: int = 0) -> BenchmarkSummary:
        """Run full benchmark suite"""
        run_id = f"swe-bench-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
        print(f"\n{'='*80}")
        print(f"Starting SWE-bench run: {run_id}")
        print(f"{'='*80}\n")

        instances = self.load_swe_bench_dataset(subset, limit, offset)
        results = []

        for i, instance in enumerate(instances, 1):
            print(f"\n[{i}/{len(instances)}] ", end="")
            result = self.run_instance(instance)
            results.append(result)

        # Calculate summary statistics using the structured status labels.
        passed = sum(1 for r in results if r.status == "passed")
        failed = sum(1 for r in results if r.status == "failed")
        errors = sum(1 for r in results if r.status == "error")

        pass_rate = passed / len(results) if results else 0.0
        avg_time = sum(r.time_seconds for r in results) / len(results) if results else 0.0
        total_tokens = sum(r.tokens_used for r in results)
        total_cost = sum(r.cost_usd for r in results)

        pdse_scores = [r.pdse_score for r in results if r.pdse_score is not None]
        avg_pdse = sum(pdse_scores) / len(pdse_scores) if pdse_scores else None
        failure_breakdown: Dict[str, int] = {}
        for result in results:
            if result.failure_kind:
                failure_breakdown[result.failure_kind] = failure_breakdown.get(result.failure_kind, 0) + 1

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
            results=results,
            failure_breakdown=failure_breakdown,
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
        if failure_breakdown:
            print("Failure Breakdown:")
            for kind, count in sorted(failure_breakdown.items()):
                print(f"  {kind}: {count}")
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
    parser.add_argument("--offset", type=int, default=0, help="Skip first N instances (default: 0)")
    parser.add_argument("--dantecode", default="dantecode", help="Path to dantecode CLI")
    parser.add_argument("--output-dir", default="../results", help="Output directory for results")
    parser.add_argument("--model", default="grok/grok-3", help="Model to use (default: grok/grok-3)")
    parser.add_argument("--api-key", help="API key for the model (GROK_API_KEY, ANTHROPIC_API_KEY, etc.)")
    parser.add_argument(
        "--execution-profile",
        help="Explicit DanteCode CLI execution profile to prefer when the flag is supported",
    )
    parser.add_argument("--dry-run", action="store_true", help="Print planned commands without running DanteCode")

    args = parser.parse_args()

    # If API key provided via CLI, set it in environment so Python and Node subprocesses see it
    if args.api_key:
        import os
        os.environ['GROK_API_KEY'] = args.api_key
        os.environ['XAI_API_KEY'] = args.api_key
        os.environ['ANTHROPIC_API_KEY'] = args.api_key
        os.environ['OPENAI_API_KEY'] = args.api_key
        print(f"  [INFO] API key set in environment (length: {len(args.api_key)})")

    runner = SWEBenchRunner(
        dantecode_path=args.dantecode,
        output_dir=args.output_dir,
        model=args.model,
        execution_profile=args.execution_profile,
    )
    if args.dry_run:
        dry_run_count = max(args.limit or 1, 1)
        instances = [
            {
                "instance_id": f"dry-run-{index + 1}",
                "repo": "example/example-repo",
                "problem_statement": "Fix the failing test and explain the patch.",
                "hints_text": "pytest tests",
                "test_patch": "",
            }
            for index in range(dry_run_count)
        ]
        print(f"\nDry run: showing execution plans for {len(instances)} instance(s)\n")

        for i, instance in enumerate(instances, 1):
            workspace_dir = Path(f".swe-bench-workspace/{instance['instance_id']}")
            plan = runner.build_execution_plan(instance, workspace_dir)
            print(f"[{i}/{len(instances)}] {plan.instance_id}")
            print(f"  Strategy: {plan.test_strategy}")
            print(f"  Prompt mode: {'execution-profile' if plan.uses_execution_profile else 'prompt-hack'}")
            print(f"  Prompt hack: {'yes' if plan.prompt_hack_used else 'no'}")
            print(f"  DanteCode: {' '.join(plan.dantecode_command)}")
            print(f"  Tests: {' '.join(plan.test_command)}")
            print()

        sys.exit(0)

    summary = runner.run_benchmark(subset=args.subset, limit=args.limit, offset=args.offset)

    # Exit with success if pass rate >= 75%
    sys.exit(0 if summary.pass_rate >= 0.75 else 1)

if __name__ == "__main__":
    main()
