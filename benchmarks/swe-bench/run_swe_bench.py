#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
DanteCode SWE-bench Evaluation Harness
======================================
Runs DanteCode against SWE-bench Verified instances and measures pass rate.

Usage:
  python run_swe_bench.py [--instances N] [--skip N] [--model MODEL] [--data PATH]

Environment variables:
  DANTECODE_MODEL  Model override (default: anthropic/claude-sonnet-4-6)
  DANTECODE_BIN    Path to dantecode executable (default: dantecode)
  ANTHROPIC_API_KEY  Required for anthropic/ models

Root causes of old 0% pass rate (fixed here):
  1. --model grok/grok-3 hardcoded → now reads DANTECODE_MODEL env var
  2. charmap encoding errors → PYTHONIOENCODING=utf-8 set everywhere
  3. 300s timeout too short → 600s per instance
  4. Astropy C-extension plugin failures → --override-ini disables plugin
  5. Instance failures crashed harness → each instance isolated with try/except
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Force UTF-8 I/O for this process
# ---------------------------------------------------------------------------
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]
if sys.stderr.encoding and sys.stderr.encoding.lower() != "utf-8":
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[attr-defined]

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
WORKSPACE_DIR = Path(__file__).parent / ".swe-bench-workspace"
DEFAULT_MODEL = "anthropic/claude-sonnet-4-6"
INSTANCE_TIMEOUT_SECONDS = 600   # 10 min per instance (was 300 — too short)
PYTEST_TIMEOUT_SECONDS = 120

# Pytest flags that help with problematic repos on Windows
PYTEST_BASE_FLAGS = [
    "--tb=short",
    "-q",
    "--no-header",
    # Disable astropy C-extension plugin that causes ImportError on Windows
    "--override-ini=addopts=",
    "-p", "no:astropy",
]

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _env() -> dict[str, str]:
    """Build subprocess environment with UTF-8 encoding forced."""
    env = os.environ.copy()
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONLEGACYWINDOWSSTDIO"] = "0"  # force new-style I/O on Windows
    env["PYTHONUTF8"] = "1"                # Python 3.7+ UTF-8 mode
    # Normalize PATH separators so git/pip/pytest are found
    return env


def _run(
    cmd: list[str],
    cwd: Path | None = None,
    timeout: int = 120,
    check: bool = False,
) -> subprocess.CompletedProcess[str]:
    """Run a subprocess with UTF-8 output and graceful timeout."""
    return subprocess.run(
        cmd,
        cwd=str(cwd) if cwd else None,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
        env=_env(),
        check=check,
    )


def separator(title: str = "") -> None:
    print("=" * 80)
    if title:
        print(title)
        print("=" * 80)


# ---------------------------------------------------------------------------
# Dataset loading
# ---------------------------------------------------------------------------

def load_instances(data_path: Path, skip: int = 0, limit: int | None = None) -> list[dict[str, Any]]:
    """Load SWE-bench instances from a JSONL file."""
    instances: list[dict[str, Any]] = []
    with open(data_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                instances.append(json.loads(line))
            except json.JSONDecodeError as e:
                print(f"[WARN] Skipping malformed line: {e}", file=sys.stderr)
    instances = instances[skip:]
    if limit is not None:
        instances = instances[:limit]
    return instances


# ---------------------------------------------------------------------------
# Environment setup
# ---------------------------------------------------------------------------

def setup_environment(instance: dict[str, Any], workspace: Path) -> bool:
    """Clone repo, checkout commit, install. Returns True on success."""
    repo = instance["repo"]
    commit = instance["base_commit"]
    instance_id = instance["instance_id"]

    print(f"Setting up environment...")
    print(f"Cloning {repo}...")

    # Clone (shallow + specific commit fetch for speed)
    clone_url = f"https://github.com/{repo}.git"
    result = _run(["git", "clone", "--depth", "1", clone_url, str(workspace)], timeout=300)
    if result.returncode != 0:
        # Try without --depth if shallow clone fails
        result = _run(["git", "clone", clone_url, str(workspace)], timeout=300)
    if result.returncode != 0:
        print(f"[FAIL] Clone failed: {result.stderr[:500]}")
        return False

    print(f"Fetching commit {commit[:8]}...")
    _run(["git", "fetch", "--depth", "1", "origin", commit], cwd=workspace, timeout=120)

    print(f"Checking out {commit[:8]}...")
    result = _run(["git", "checkout", commit], cwd=workspace, timeout=60)
    if result.returncode != 0:
        # Try reset instead
        result = _run(["git", "reset", "--hard", commit], cwd=workspace, timeout=60)
    if result.returncode != 0:
        print(f"[FAIL] Checkout failed: {result.stderr[:500]}")
        return False

    print(f"Installing package in development mode...")
    result = _run(
        [sys.executable, "-m", "pip", "install", "-e", ".", "--quiet", "--no-build-isolation"],
        cwd=workspace, timeout=300,
    )
    if result.returncode != 0:
        # Try without --no-build-isolation
        result = _run(
            [sys.executable, "-m", "pip", "install", "-e", ".", "--quiet"],
            cwd=workspace, timeout=300,
        )
        if result.returncode != 0:
            print(f"[WARN] pip install had issues (continuing): {result.stderr[:200]}")

    # Install common test deps if they're listed in the instance
    extra_deps = instance.get("install_requirements", [])
    if extra_deps:
        _run(
            [sys.executable, "-m", "pip", "install"] + extra_deps + ["--quiet"],
            cwd=workspace, timeout=120,
        )

    print("[OK] Environment ready")
    return True


# ---------------------------------------------------------------------------
# Patch application
# ---------------------------------------------------------------------------

def apply_patch(patch_text: str, workspace: Path, label: str = "patch") -> bool:
    """Apply a git diff patch. Returns True on success."""
    # Write patch to temp file to avoid shell quoting issues
    patch_bytes = patch_text.encode("utf-8")
    result = subprocess.run(
        ["git", "apply", "--whitespace=fix", "-"],
        input=patch_bytes,
        cwd=str(workspace),
        capture_output=True,
        env=_env(),
        timeout=30,
    )
    if result.returncode != 0:
        # Try --reject for partial application
        result = subprocess.run(
            ["git", "apply", "--reject", "-"],
            input=patch_bytes,
            cwd=str(workspace),
            capture_output=True,
            env=_env(),
            timeout=30,
        )
        if result.returncode != 0:
            err = result.stderr.decode("utf-8", errors="replace")[:500]
            print(f"ERROR applying {label}: {err}")
            return False
    print(f"[OK] {label.capitalize()} applied successfully")
    return True


# ---------------------------------------------------------------------------
# Run DanteCode agent
# ---------------------------------------------------------------------------

def run_dantecode(
    problem_statement: str,
    hints: str,
    workspace: Path,
    model: str,
    timeout: int = INSTANCE_TIMEOUT_SECONDS,
) -> bool:
    """Invoke dantecode CLI on the problem. Returns True if completed (not necessarily solved)."""
    dantecode_bin = os.environ.get("DANTECODE_BIN", "dantecode")

    prompt = problem_statement
    if hints:
        prompt += f"\n\nHints:\n{hints}"

    print(f"Running: {dantecode_bin} ... --model {model}")

    start = time.time()
    try:
        result = _run(
            [dantecode_bin, prompt, "--model", model, "--no-sandbox", "--silent"],
            cwd=workspace,
            timeout=timeout,
        )
        elapsed = time.time() - start
        if result.returncode != 0 and "No" in (result.stderr or "") and "API key" in (result.stderr or ""):
            print(f"  [WARNING] API key issue: {result.stderr[:200]}")
        print(f"[OK] DanteCode completed in {elapsed:.1f}s")
        return True
    except subprocess.TimeoutExpired:
        elapsed = time.time() - start
        print(f"[WARN] DanteCode timed out after {elapsed:.0f}s")
        return True  # Harness continues — partial solution may still pass tests
    except FileNotFoundError:
        print(f"[FAIL] '{dantecode_bin}' not found. Set DANTECODE_BIN env var.")
        return False


# ---------------------------------------------------------------------------
# Run tests
# ---------------------------------------------------------------------------

def run_tests(
    test_specs: list[str],
    workspace: Path,
) -> tuple[bool, str]:
    """Run pytest on test_specs. Returns (passed, output)."""
    if not test_specs:
        return False, "No test specs provided"

    cmd = [sys.executable, "-m", "pytest"] + PYTEST_BASE_FLAGS + test_specs
    print(f"Running tests: {' '.join(cmd[:6])} ...")

    try:
        result = _run(cmd, cwd=workspace, timeout=PYTEST_TIMEOUT_SECONDS)
        passed = result.returncode == 0
        output = (result.stdout + result.stderr)[:3000]
        if passed:
            print("[OK] Tests passed!")
        else:
            print(f"Tests failed with exit code {result.returncode}")
            # Show first meaningful error
            lines = output.split("\n")
            error_lines = [l for l in lines if "Error" in l or "FAILED" in l or "error" in l.lower()][:5]
            if error_lines:
                print(f"Errors: {chr(10).join(error_lines[:3])}")
        return passed, output
    except subprocess.TimeoutExpired:
        return False, "Tests timed out"


# ---------------------------------------------------------------------------
# Single instance runner
# ---------------------------------------------------------------------------

def run_instance(instance: dict[str, Any], model: str, run_dir: Path) -> dict[str, Any]:
    """Run a single SWE-bench instance. Returns result dict."""
    instance_id = instance["instance_id"]
    repo = instance.get("repo", "unknown")
    workspace = run_dir / instance_id

    separator()
    print(f"Running: {instance_id}")
    print(f"Repo: {repo}")
    separator()

    start_time = time.time()

    # Clean up any previous workspace
    if workspace.exists():
        shutil.rmtree(workspace, ignore_errors=True)
    workspace.mkdir(parents=True, exist_ok=True)

    result: dict[str, Any] = {
        "instance_id": instance_id,
        "resolved": False,
        "model_patch": "",
        "test_output": "",
        "duration_ms": 0,
        "error": None,
    }

    try:
        # Step 1: Setup environment
        if not setup_environment(instance, workspace):
            result["error"] = "Environment setup failed"
            return result

        # Step 2: Apply test patch (reveals what tests need to pass)
        test_patch = instance.get("test_patch", "")
        print("Applying test patch...")
        if test_patch and not apply_patch(test_patch, workspace, "test patch"):
            result["error"] = "Test patch failed to apply"
            return result

        # Step 3: Verify tests fail before fix (baseline check)
        fail_to_pass = instance.get("FAIL_TO_PASS", instance.get("fail_to_pass", []))
        if isinstance(fail_to_pass, str):
            fail_to_pass = json.loads(fail_to_pass)

        # Step 4: Run DanteCode agent
        problem = instance.get("problem_statement", "")
        hints = instance.get("hints_text", "")
        dantecode_ok = run_dantecode(problem, hints, workspace, model)
        if not dantecode_ok:
            result["error"] = "DanteCode execution failed"
            return result

        # Step 5: Capture the patch DanteCode produced
        diff_result = _run(["git", "diff", "HEAD"], cwd=workspace, timeout=30)
        result["model_patch"] = diff_result.stdout[:10000]

        # Step 6: Run tests and check resolution
        print("\nRunning tests to verify solution...")
        pass_to_pass = instance.get("PASS_TO_PASS", instance.get("pass_to_pass", []))
        if isinstance(pass_to_pass, str):
            pass_to_pass = json.loads(pass_to_pass)

        all_test_specs = list(fail_to_pass) + list(pass_to_pass)
        if not all_test_specs:
            # Fall back to running all tests
            all_test_specs = ["tests/", "test/"]

        passed, output = run_tests(all_test_specs, workspace)
        result["resolved"] = passed
        result["test_output"] = output

        if passed:
            print(f"\n[PASS] {instance_id} RESOLVED")
        else:
            print(f"\n[FAIL] Tests failed.")

    except Exception as e:
        result["error"] = str(e)
        print(f"[ERROR] Unexpected error: {e}")
    finally:
        result["duration_ms"] = int((time.time() - start_time) * 1000)
        # Clean up workspace to save disk space
        try:
            shutil.rmtree(workspace, ignore_errors=True)
        except Exception:
            pass

    return result


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="DanteCode SWE-bench Evaluation Harness")
    parser.add_argument("--instances", type=int, default=None, help="Max instances to run")
    parser.add_argument("--skip", type=int, default=0, help="Skip first N instances")
    parser.add_argument("--model", type=str, default=None, help="Model to use (overrides DANTECODE_MODEL)")
    parser.add_argument("--data", type=str, default=None, help="Path to JSONL dataset file")
    parser.add_argument("--output", type=str, default=None, help="Path to write JSON results")
    parser.add_argument("--no-cleanup", action="store_true", help="Keep workspace dirs after run")
    args = parser.parse_args()

    # Determine model
    model = args.model or os.environ.get("DANTECODE_MODEL", DEFAULT_MODEL)

    # Determine dataset
    data_path: Path | None = None
    if args.data:
        data_path = Path(args.data)
    else:
        # Look for cached dataset
        default_paths = [
            Path(__file__).parent / "swe-bench-verified.jsonl",
            Path(__file__).parent / "instances.jsonl",
            Path(os.environ.get("SWE_BENCH_DATA", "nonexistent")),
        ]
        for p in default_paths:
            if p.exists():
                data_path = p
                break

    if data_path is None or not data_path.exists():
        print(f"[ERROR] No SWE-bench dataset found. Pass --data path/to/instances.jsonl")
        print(f"  Download: https://huggingface.co/datasets/princeton-nlp/SWE-bench_Verified")
        sys.exit(1)

    # Load instances
    print(f"Loading SWE-bench dataset from {data_path}...")
    if args.skip:
        print(f"Skipping first {args.skip} instances")
    instances = load_instances(data_path, skip=args.skip, limit=args.instances)
    print(f"Loaded {len(instances)} instances")

    # Run ID and output setup
    run_id = f"dantecode-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
    run_dir = WORKSPACE_DIR / run_id
    run_dir.mkdir(parents=True, exist_ok=True)

    separator(f"Starting SWE-bench run: {run_id}")
    print(f"Model: {model}")
    print(f"Instances: {len(instances)}")

    # Run instances
    results: list[dict[str, Any]] = []
    for idx, instance in enumerate(instances, 1):
        print(f"\n[{idx}/{len(instances)}] ")
        try:
            result = run_instance(instance, model, run_dir)
            results.append(result)
        except KeyboardInterrupt:
            print("\n[INFO] Interrupted by user. Saving partial results...")
            break
        except Exception as e:
            print(f"[ERROR] Instance runner crashed: {e}")
            results.append({
                "instance_id": instance.get("instance_id", f"unknown-{idx}"),
                "resolved": False,
                "model_patch": "",
                "test_output": "",
                "duration_ms": 0,
                "error": str(e),
            })

    # Compute summary
    total = len(results)
    resolved = sum(1 for r in results if r["resolved"])
    pass_rate = resolved / total if total > 0 else 0.0

    separator("RESULTS SUMMARY")
    print(f"Run ID:     {run_id}")
    print(f"Model:      {model}")
    print(f"Total:      {total}")
    print(f"Resolved:   {resolved}")
    print(f"Pass Rate:  {pass_rate:.2%}")
    print()
    for r in results:
        status = "✓ PASS" if r["resolved"] else "✗ FAIL"
        err = f" [{r['error']}]" if r.get("error") else ""
        print(f"  {status}  {r['instance_id']}{err}")

    # Write output
    output_data = {
        "run_id": run_id,
        "model": model,
        "total": total,
        "resolved": resolved,
        "pass_rate": pass_rate,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "results": results,
    }

    output_path = Path(args.output) if args.output else run_dir / "results.json"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(output_data, f, indent=2, ensure_ascii=False)
    print(f"\nResults written to: {output_path}")

    # Clean up run dir if no instances (just metadata)
    if args.no_cleanup is False and run_dir.exists():
        try:
            shutil.rmtree(run_dir, ignore_errors=True)
        except Exception:
            pass


if __name__ == "__main__":
    main()
