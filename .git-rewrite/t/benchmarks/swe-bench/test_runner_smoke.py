#!/usr/bin/env python3
"""
Smoke test for SWE-bench runner - verifies basic functionality without running actual benchmarks.
"""

import sys

def test_imports():
    """Test that all required modules can be imported"""
    print("Testing imports...")
    try:
        from swe_bench_runner import SWEBenchRunner, BenchmarkResult, BenchmarkSummary
        print("[OK] Imports successful")
        return True
    except ImportError as e:
        print(f"[FAIL] Import failed: {e}")
        return False

def test_runner_initialization():
    """Test that runner can be initialized"""
    print("\nTesting runner initialization...")
    try:
        from swe_bench_runner import SWEBenchRunner
        runner = SWEBenchRunner(
            dantecode_path="dantecode",
            output_dir="./test-results",
            model="grok/grok-3"
        )
        print(f"[OK] Runner initialized with model: {runner.model}")
        return True
    except Exception as e:
        print(f"[FAIL] Initialization failed: {e}")
        return False

def test_helper_methods():
    """Test helper methods work correctly"""
    print("\nTesting helper methods...")
    try:
        from swe_bench_runner import SWEBenchRunner
        runner = SWEBenchRunner()

        # Test _get_test_command
        cmd = runner._get_test_command("django/django", {"hints_text": "pytest tests"})
        assert "pytest" in cmd, f"Expected pytest in command, got {cmd}"
        print(f"[OK] Test command detection works: {cmd}")

        return True
    except Exception as e:
        print(f"[FAIL] Helper methods failed: {e}")
        return False

def test_dataclasses():
    """Test that dataclasses work correctly"""
    print("\nTesting dataclasses...")
    try:
        from swe_bench_runner import BenchmarkResult, BenchmarkSummary

        # Test BenchmarkResult
        result = BenchmarkResult(
            instance_id="test-1",
            repo="test/repo",
            issue_number=123,
            problem_statement="Test problem",
            pass_rate=1.0,
            time_seconds=10.5,
            tokens_used=1000,
            cost_usd=0.50,
            pdse_score=88.5,
            error=None,
            logs="Test logs"
        )
        assert result.instance_id == "test-1"
        print(f"[OK] BenchmarkResult works: {result.instance_id}")

        # Test BenchmarkSummary
        summary = BenchmarkSummary(
            run_id="test-run",
            timestamp="2026-03-29T10:00:00",
            total_instances=1,
            passed=1,
            failed=0,
            errors=0,
            pass_rate=1.0,
            avg_time_seconds=10.5,
            total_tokens=1000,
            total_cost_usd=0.50,
            avg_pdse_score=88.5,
            results=[result]
        )
        assert summary.passed == 1
        print(f"[OK] BenchmarkSummary works: pass_rate={summary.pass_rate}")

        return True
    except Exception as e:
        print(f"[FAIL] Dataclasses failed: {e}")
        return False

def main():
    print("=" * 60)
    print("SWE-bench Runner Smoke Test")
    print("=" * 60)
    print()

    tests = [
        ("Imports", test_imports),
        ("Runner Initialization", test_runner_initialization),
        ("Helper Methods", test_helper_methods),
        ("Dataclasses", test_dataclasses),
    ]

    passed = 0
    failed = 0

    for name, test_func in tests:
        try:
            if test_func():
                passed += 1
            else:
                failed += 1
        except Exception as e:
            print(f"[FAIL] {name} crashed: {e}")
            failed += 1

    print()
    print("=" * 60)
    print(f"Results: {passed} passed, {failed} failed")
    print("=" * 60)

    if failed == 0:
        print("\n[OK] All smoke tests passed! Runner is ready to use.")
        return 0
    else:
        print(f"\n[FAIL] {failed} smoke test(s) failed. Fix issues before running benchmarks.")
        return 1

if __name__ == "__main__":
    sys.exit(main())
