#!/usr/bin/env python3
"""Test if environment variables pass from Python to Node.js subprocess on Windows"""
import os
import subprocess
import sys

print("Python parent process:")
print(f"  GROK_API_KEY: {'SET' if os.getenv('GROK_API_KEY') else 'NOT SET'}")
print(f"  XAI_API_KEY: {'SET' if os.getenv('XAI_API_KEY') else 'NOT SET'}")
print()

# Test 1: No explicit env (should inherit from parent)
print("Test 1: subprocess.run() with no env parameter")
result = subprocess.run(
    ["node", "-e", "console.log('GROK_API_KEY:', process.env.GROK_API_KEY ? 'SET' : 'NOT SET')"],
    capture_output=True,
    text=True
)
print(f"  Output: {result.stdout.strip()}")
print()

# Test 2: Explicit env=os.environ
print("Test 2: subprocess.run() with env=os.environ")
result = subprocess.run(
    ["node", "-e", "console.log('GROK_API_KEY:', process.env.GROK_API_KEY ? 'SET' : 'NOT SET')"],
    capture_output=True,
    text=True,
    env=os.environ
)
print(f"  Output: {result.stdout.strip()}")
print()

# Test 3: Explicit env=os.environ.copy() with manual set
print("Test 3: subprocess.run() with env=os.environ.copy() + manual set")
env = os.environ.copy()
env['GROK_API_KEY'] = os.getenv('GROK_API_KEY') or 'test_key_123'
env['XAI_API_KEY'] = env['GROK_API_KEY']
result = subprocess.run(
    ["node", "-e", "console.log('GROK_API_KEY:', process.env.GROK_API_KEY || 'NOT SET'); console.log('XAI_API_KEY:', process.env.XAI_API_KEY || 'NOT SET')"],
    capture_output=True,
    text=True,
    env=env
)
print(f"  Output: {result.stdout.strip()}")
