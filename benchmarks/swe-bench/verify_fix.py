#!/usr/bin/env python3
"""
Verify that a fix in the workspace actually passes the tests.
This is used when DanteCode times out before running tests.
"""
import subprocess
import sys
from pathlib import Path

def run_tests_for_instance(instance_id: str) -> bool:
    """Run tests for a specific SWE-bench instance"""
    workspace_dir = Path(f".swe-bench-workspace/{instance_id}")

    if not workspace_dir.exists():
        print(f"ERROR: Workspace not found: {workspace_dir}")
        return False

    print(f"Running tests for {instance_id}...")
    print(f"Workspace: {workspace_dir}")

    # Django uses tests/runtests.py
    if "django" in instance_id:
        # Run the specific tests added by the test patch
        # For django__django-11477, the main test is URLTranslationTests.test_translate_url_utility
        test_cmd = ["python", "tests/runtests.py", "i18n.patterns.tests.URLTranslationTests", "-v", "2"]
        print(f"Test command: {' '.join(test_cmd)}")

        try:
            result = subprocess.run(
                test_cmd,
                cwd=workspace_dir,
                capture_output=True,
                text=True,
                timeout=120
            )

            print("=" * 80)
            print("STDOUT:")
            print(result.stdout)
            print("=" * 80)
            if result.stderr:
                print("STDERR:")
                print(result.stderr)
                print("=" * 80)

            tests_passed = result.returncode == 0

            if tests_passed:
                print(f"\n[PASS] All tests passed for {instance_id}")
            else:
                print(f"\n[FAIL] Tests failed for {instance_id}")
                print(f"Exit code: {result.returncode}")

            return tests_passed

        except subprocess.TimeoutExpired:
            print("ERROR: Test execution timed out")
            return False
        except Exception as e:
            print(f"ERROR: {e}")
            return False

    else:
        print(f"ERROR: Don't know how to run tests for {instance_id}")
        return False

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python verify_fix.py <instance_id>")
        print("Example: python verify_fix.py django__django-11477")
        sys.exit(1)

    instance_id = sys.argv[1]
    passed = run_tests_for_instance(instance_id)
    sys.exit(0 if passed else 1)
