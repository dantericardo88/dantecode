#!/bin/bash
# Measure peak RSS under 100 concurrent sessions
# Output: Peak RSS in MB

npm test --workspace=packages/cli -- --run -t "handles 100 concurrent" 2>&1 | \
  grep "Peak RSS:" | \
  sed 's/.*Peak RSS:[^0-9]*\([0-9.]*\) MB.*/\1/' | \
  head -1
