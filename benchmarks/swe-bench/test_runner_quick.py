#!/usr/bin/env python3
"""Quick test of the updated runner's test execution"""
import sys
sys.path.insert(0, '.')

from swe_bench_runner import SWEBenchRunner
from pathlib import Path

# Create runner
runner = SWEBenchRunner(
    dantecode_path='node C:/Projects/DanteCode/packages/cli/dist/index.js',
    output_dir='./results',
    model='grok/grok-3'
)

# Test instance
instance = {
    'repo': 'django/django',
    'instance_id': 'django__django-11477',
    'hints_text': ''
}

workspace_dir = Path('.swe-bench-workspace/django__django-11477')

print("=" * 80)
print("Testing updated runner's _run_tests method")
print("=" * 80)
print(f"Instance: {instance['instance_id']}")
print(f"Workspace: {workspace_dir}")
print()

# This is what the runner will do after DanteCode times out
print("Calling _run_tests (simulating post-timeout test execution)...")
tests_passed = runner._run_tests(instance, workspace_dir)

print()
print("=" * 80)
if tests_passed:
    print("✓ RESULT: Tests PASSED")
    print("✓ This instance will count as PASSED (pass_rate = 1.0)")
    print("✓ Official SWE-bench score: 1/1 (100%)")
else:
    print("✗ RESULT: Tests FAILED")
    print("✗ This instance will count as FAILED")

print("=" * 80)

sys.exit(0 if tests_passed else 1)
