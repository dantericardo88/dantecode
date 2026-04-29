# Examples

Runnable examples that show how to use DanteCode primitives without booting the
full agent loop. Each example is self-contained — no shared state — so you can
copy one into your own project and run it.

## Structure

| File | What it shows |
|------|---------------|
| [01-validation.mjs](./01-validation.mjs) | Boundary-point input validation (path traversal, SSRF, shell metachar, HTML escape) using `@dantecode/core`. |
| [02-resilience.mjs](./02-resilience.mjs) | Retry with exponential backoff + timeout wrapping for flaky external calls. |
| [03-skill-import.mjs](./03-skill-import.mjs) | Importing a Claude-style skill bundle and inspecting the bridge metadata. |
| [04-tool-runtime.mjs](./04-tool-runtime.mjs) | Verifying that a Bash tool call's claimed effects (clone, mkdir, file write) actually happened. |

## Running

These examples assume you've installed the workspace from the repo root:

```bash
npm install
npm run build
```

Then from the repo root:

```bash
node examples/01-validation.mjs
node examples/02-resilience.mjs
# ...
```

Each script prints a small narrative explaining what it just demonstrated. Use
them as templates — none of them allocate file handles or network sockets you'd
need to clean up.

## When you're stuck

- Ask `danteforge explain <term>` for a one-paragraph definition of any
  scoring or workflow concept used in the examples.
- The full API surface lives in `packages/core/src/index.ts`.
- For end-to-end agent loop usage, see `packages/cli/src/repl.ts`.
