---
triggers:
  - typescript
  - tsc
  - tsconfig
  - "type error"
  - "ts error"
---

# TypeScript Development Patterns

## Type Checking
```bash
# Check types without emitting
npx tsc --noEmit

# Check specific file (faster)
npx tsc --noEmit --skipLibCheck path/to/file.ts

# See all errors
npx tsc --noEmit 2>&1 | grep "error TS"
```

## Common Fixes
- `TS2339: Property does not exist`: Add to interface or use optional chaining
- `TS2345: Argument not assignable`: Check type compatibility, add explicit cast if needed
- `TS6133: declared but never read`: Remove unused variable or prefix with `_`
- `TS2305: Module has no exported member`: Check the export in the source file, may need rebuild

## Module Imports
- Always use `.js` extensions in ESM imports: `import { x } from "./file.js"`
- After adding new exports, run `npm run build --workspace=packages/<name>` before cross-package typecheck
