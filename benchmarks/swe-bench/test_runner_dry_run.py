#!/usr/bin/env python3
"""Dry-run coverage for the SWE-bench runner command planning and failure labels."""

import sys
from pathlib import Path

sys.path.insert(0, ".")

from swe_bench_runner import BenchmarkResult, SWEBenchRunner


class ProfileAwareRunner(SWEBenchRunner):
    def _supports_execution_profile_flag(self) -> bool:
        return True


class ProfileFallbackRunner(SWEBenchRunner):
    def _supports_execution_profile_flag(self) -> bool:
        return False


def _make_instance() -> dict:
    return {
        "repo": "owner/example-repo",
        "instance_id": "owner__example-repo-1",
        "problem_statement": "Fix the failing example.",
        "hints_text": "pytest tests",
        "test_patch": "",
    }


def test_execution_profile_is_used_when_supported() -> None:
    runner = ProfileAwareRunner(
        dantecode_path="dantecode",
        output_dir="./test-results",
        model="grok/grok-3",
        execution_profile="benchmark",
    )

    plan = runner.build_execution_plan(_make_instance(), Path(".swe-bench-workspace/example"))

    assert plan.uses_execution_profile is True
    assert plan.prompt_hack_used is False
    assert "--execution-profile" in plan.dantecode_command
    assert "benchmark" in plan.dantecode_command
    assert "Write tool instead of Edit tool" not in plan.prompt


def test_prompt_hack_is_retained_as_fallback() -> None:
    runner = ProfileFallbackRunner(
        dantecode_path="dantecode",
        output_dir="./test-results",
        model="grok/grok-3",
        execution_profile="benchmark",
    )

    plan = runner.build_execution_plan(_make_instance(), Path(".swe-bench-workspace/example"))

    assert plan.uses_execution_profile is False
    assert plan.prompt_hack_used is True
    assert "--execution-profile" not in plan.dantecode_command
    assert "Write tool instead of Edit tool" in plan.prompt


def test_failure_labels_are_specific() -> None:
    runner = SWEBenchRunner(
        dantecode_path="dantecode",
        output_dir="./test-results",
        model="grok/grok-3",
    )

    setup_failure = runner.classify_failure("setup", "git clone failed", exit_code=128)
    assert setup_failure.stage == "setup"
    assert setup_failure.kind == "environment"
    assert setup_failure.exit_code == 128

    test_failure = runner.classify_failure("tests", "pytest returned non-zero", exit_code=1)
    assert test_failure.stage == "tests"
    assert test_failure.kind == "test-failure"
    assert test_failure.exit_code == 1

    timeout_failure = runner.classify_failure("run", "DanteCode timed out", timed_out=True)
    assert timeout_failure.stage == "run"
    assert timeout_failure.kind == "timeout"
    assert timeout_failure.timed_out is True


def test_zero_write_success_is_classified_as_verification_failure() -> None:
    runner = SWEBenchRunner(
        dantecode_path="dantecode",
        output_dir="./test-results",
        model="grok/grok-3",
    )

    result = BenchmarkResult(
        instance_id="owner__example-repo-1",
        repo="owner/example-repo",
        issue_number=1,
        problem_statement="Fix the failing example.",
        pass_rate=0.0,
        time_seconds=1.0,
        tokens_used=100,
        cost_usd=0.01,
        pdse_score=None,
        error="Tests passed but no verified writes were detected beyond the applied test patch.",
        logs="[verification] Tests passed, but no verified writes were detected.",
        status="error",
        failure_stage="verification",
        failure_kind="verification_failure",
        verified_write_count=0,
    )

    assert runner._derive_failure_kind(result, tests_passed=True) == "verification_failure"


def test_verified_write_success_is_not_downgraded() -> None:
    runner = SWEBenchRunner(
        dantecode_path="dantecode",
        output_dir="./test-results",
        model="grok/grok-3",
    )

    result = BenchmarkResult(
        instance_id="owner__example-repo-2",
        repo="owner/example-repo",
        issue_number=2,
        problem_statement="Fix the second failing example.",
        pass_rate=1.0,
        time_seconds=1.0,
        tokens_used=120,
        cost_usd=0.02,
        pdse_score=None,
        error=None,
        logs="Tests passed and verified writes were detected.",
        status="passed",
        verified_write_count=2,
        verified_write_paths=["src/example.py", "tests/test_example.py"],
    )

    assert runner._derive_failure_kind(result, tests_passed=True) is None


def main() -> int:
    tests = [
        test_execution_profile_is_used_when_supported,
        test_prompt_hack_is_retained_as_fallback,
        test_failure_labels_are_specific,
        test_zero_write_success_is_classified_as_verification_failure,
        test_verified_write_success_is_not_downgraded,
    ]

    passed = 0
    failed = 0

    for test in tests:
        try:
            test()
            print(f"[OK] {test.__name__}")
            passed += 1
        except Exception as exc:  # pragma: no cover - direct script feedback
            print(f"[FAIL] {test.__name__}: {exc}")
            failed += 1

    print(f"\nResults: {passed} passed, {failed} failed")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
