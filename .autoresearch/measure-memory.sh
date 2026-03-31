#!/bin/bash
# Measure peak RSS under 100 concurrent sessions
# Output: Peak RSS in MB

npm test --workspace=packages/cli -- --run --reporter=verbose "handles 100 concurrent" 2>&1 | \
  grep "Peak RSS:" | \
  head -1 | \
  grep -o "[0-9.]*" | \
  head -1

# Fallback if no match
if [ ${PIPESTATUS[0]} -ne 0 ]; then
  echo "999"
fi
