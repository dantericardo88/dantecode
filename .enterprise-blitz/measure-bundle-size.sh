#!/bin/bash
# Measure CLI bundle size for autoresearch optimization

# Build the CLI package
npm run build --workspace=packages/cli 2>&1 | grep -q "success" || exit 1

# Get the size of the main bundle
if [ -f "packages/cli/dist/index.js" ]; then
  stat -f%z packages/cli/dist/index.js 2>/dev/null || stat -c%s packages/cli/dist/index.js 2>/dev/null
else
  echo "0"
  exit 1
fi
