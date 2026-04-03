#!/bin/bash
# SWE-bench 20-instance validation runner
# Sets environment and runs validation with proper logging

export GROK_API_KEY="${XAI_API_KEY}" # Use environment variable instead of hardcoding

echo "================================"
echo "SWE-bench Validation Runner"
echo "================================"
echo "Start time: $(date)"
echo "API Key: ${GROK_API_KEY:0:15}..."
echo "Working dir: $(pwd)"
echo ""
echo "First testing DanteCode subprocess call..."
python test_dantecode_call.py

if [ $? -ne 0 ]; then
    echo ""
    echo "ERROR: DanteCode test call failed!"
    echo "Fix the subprocess issue before running full validation"
    exit 1
fi

echo ""
echo "================================"
echo "Test successful! Starting full validation..."
echo "================================"
echo ""

python swe_bench_runner.py --subset verified --limit 20 --offset 50

echo ""
echo "================================"
echo "Validation complete: $(date)"
echo "================================"
