#!/bin/bash
# Measure test suite execution time for autoresearch optimization

# Run core tests and extract duration
START=$(date +%s%N)
npm test --workspace=packages/core 2>&1 >/dev/null
END=$(date +%s%N)

# Calculate duration in milliseconds
DURATION=$(( ($END - $START) / 1000000 ))
echo $DURATION
