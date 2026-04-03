#!/usr/bin/env bash
# ============================================================================
# Run SWE-bench with DanteCode using Grok
# ============================================================================

set -e

echo "==================================="
echo "DanteCode SWE-bench Runner"
echo "==================================="
echo ""

# Check for Grok API key
if [ -z "$GROK_API_KEY" ]; then
    echo "ERROR: GROK_API_KEY environment variable not set"
    echo "Please set it with: export GROK_API_KEY=\"your-key-here\""
    exit 1
fi

echo "✓ GROK_API_KEY is set"
echo ""

# Check Python version
if ! command -v python3 &> /dev/null; then
    echo "ERROR: python3 not found"
    exit 1
fi

PYTHON_VERSION=$(python3 --version | awk '{print $2}')
echo "✓ Python version: $PYTHON_VERSION"
echo ""

# Install dependencies if needed
echo "Installing Python dependencies..."
pip3 install -q datasets huggingface-hub || {
    echo "ERROR: Failed to install Python dependencies"
    exit 1
}
echo "✓ Dependencies installed"
echo ""

# Create results directory
mkdir -p results
echo "✓ Results directory ready"
echo ""

# Check if DanteCode CLI is available
if ! command -v dantecode &> /dev/null; then
    echo "WARNING: dantecode CLI not found in PATH"
    echo "Attempting to use npm run cli..."
    DANTECODE_CMD="npm run cli --"
else
    DANTECODE_CMD="dantecode"
    echo "✓ DanteCode CLI found"
fi
echo ""

# Default to small subset for testing
LIMIT=${1:-5}
SUBSET=${2:-verified}
MODEL=${3:-grok/grok-3}

echo "==================================="
echo "Configuration:"
echo "  Subset: $SUBSET"
echo "  Limit: $LIMIT instances"
echo "  Model: $MODEL"
echo "==================================="
echo ""

# Run the benchmark
echo "Starting benchmark run..."
echo ""

python3 swe_bench_runner.py \
    --subset "$SUBSET" \
    --limit "$LIMIT" \
    --model "$MODEL" \
    --output-dir "./results"

EXIT_CODE=$?

echo ""
echo "==================================="
if [ $EXIT_CODE -eq 0 ]; then
    echo "✓ Benchmark completed successfully!"
else
    echo "✗ Benchmark failed with exit code $EXIT_CODE"
fi
echo "==================================="

exit $EXIT_CODE
