#!/usr/bin/env python
"""
Quick test to verify DanteCode can be called from subprocess
"""
import subprocess
import sys
import os
from pathlib import Path

# Find dantecode.cmd
npm_cmd = Path.home() / "AppData" / "Roaming" / "npm" / "dantecode.cmd"
npm_ps1 = Path.home() / "AppData" / "Roaming" / "npm" / "dantecode.ps1"

print("Looking for DanteCode executable...")
print(f"  .cmd exists: {npm_cmd.exists()}")
print(f"  .ps1 exists: {npm_ps1.exists()}")

if npm_cmd.exists():
    dantecode_path = str(npm_cmd)
    print(f"\nUsing: {dantecode_path}")
elif npm_ps1.exists():
    dantecode_path = str(npm_ps1)
    print(f"\nUsing: {dantecode_path}")
else:
    print("\nERROR: No DanteCode executable found!")
    sys.exit(1)

# Test with a simple prompt
test_prompt = "What is 2+2? Respond with just the number."

print(f"\nTesting DanteCode with simple prompt...")
print(f"Prompt: {test_prompt}")

# Set up environment
env = os.environ.copy()
grok_key = os.getenv('GROK_API_KEY') or os.getenv('XAI_API_KEY')
if grok_key:
    env['GROK_API_KEY'] = grok_key
    env['XAI_API_KEY'] = grok_key
    print(f"API key set (length: {len(grok_key)})")
else:
    print("WARNING: No API key found!")

# Build command
if dantecode_path.endswith(".cmd"):
    cmd = [dantecode_path, test_prompt, "--model", "grok/grok-3", "--max-rounds", "1", "--yolo"]
else:  # .ps1
    cmd = ["powershell.exe", "-ExecutionPolicy", "Bypass", "-NoProfile", "-File",
           dantecode_path, test_prompt, "--model", "grok/grok-3", "--max-rounds", "1", "--yolo"]

print(f"\nCommand: {' '.join(cmd[:3])}... (truncated)")
print("\nRunning with 60s timeout...")
sys.stdout.flush()

try:
    proc = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=60,
        stdin=subprocess.DEVNULL,
        env=env
    )

    print(f"\nCompleted!")
    print(f"Exit code: {proc.returncode}")
    print(f"Stdout length: {len(proc.stdout)} chars")
    print(f"Stderr length: {len(proc.stderr)} chars")

    if proc.stdout:
        print(f"\nStdout (first 500 chars):")
        print(proc.stdout[:500])

    if proc.stderr:
        print(f"\nStderr (first 500 chars):")
        print(proc.stderr[:500])

    if proc.returncode == 0:
        print("\n✓ SUCCESS - DanteCode executed successfully!")
    else:
        print(f"\n✗ FAILED - Exit code {proc.returncode}")

except subprocess.TimeoutExpired:
    print("\n✗ TIMEOUT - DanteCode hung for 60+ seconds")
    print("This indicates the subprocess issue is still present")
except Exception as e:
    print(f"\n✗ ERROR: {e}")
