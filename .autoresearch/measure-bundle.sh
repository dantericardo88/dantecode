#!/bin/bash
# Measure total bundle size across all packages
# Output: total size in bytes

# Build all packages
npm run build 2>&1 | grep -q "success" || npm run build >/dev/null 2>&1

# Calculate total dist size
find packages/*/dist -name "*.js" -type f -exec stat -c%s {} + 2>/dev/null | awk '{sum+=$1} END {print sum}' || \
find packages/*/dist -name "*.js" -type f -exec stat -f%z {} + 2>/dev/null | awk '{sum+=$1} END {print sum}'
