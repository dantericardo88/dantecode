# Golden Flow GF-01 — Clean Install to First Success

> **Gate:** Must pass before private daily-driver declaration.
> **Target time:** Under 10 minutes on a clean machine.

---

## Prerequisites

- Node.js 18 or later
- npm 9 or later
- An API key for at least one provider (Anthropic, Grok, OpenAI, Google, or Ollama running locally)

---

## Step 1 — Install

```
npm install -g @dantecode/cli
```

Verify:

```
dantecode --version
# Expected: DanteCode v0.9.0

dantecode --help
# Expected output includes: "Build software by describing what you want"
```

---

## Step 2 — Initialize a project

Navigate to a project you want to work on:

```
cd /path/to/your/project
dantecode init
```

> **Auto-init:** `dantecode init` is optional. The CLI automatically initializes
> `.dantecode/STATE.yaml` via `tryAutoInit()` on the first task run if the file does not
> exist. The README quickstart (`dantecode "build me a todo app"`) is accurate — no manual
> init step is required before running your first prompt.

Expected output:

```
DanteCode v0.9.0 — Project Initialization
─────────────────────────────────────────

Detecting project stack...
  Detected: typescript (package.json + tsconfig.json found)

Scanning for API keys...
  ✓ Found ANTHROPIC_API_KEY — setting primary provider to anthropic

GStack defaults for typescript:
  typecheck: npm run typecheck
  test:      npm test
  lint:      npm run lint

Writing .dantecode/STATE.yaml...
Writing .dantecode/AGENTS.dc.md...
Creating .dantecode/skills/...
Creating .dantecode/agents/...

✓ Initialized. Run "dantecode config show" to review your configuration.
```

The following are created under `.dantecode/`:

```
.dantecode/
  STATE.yaml          ← canonical project config
  AGENTS.dc.md        ← agent instruction template
  skills/             ← imported skills go here
  agents/             ← agent definitions go here
```

---

## Step 3 — Review configuration

```
dantecode config show
```

Expected output includes:

```
Configuration source: /path/to/your/project/.dantecode/STATE.yaml

Model:
  provider:     anthropic
  modelId:      claude-sonnet-4-20250514
  contextWindow: 200000

GStack commands:
  typecheck:    npm run typecheck  (hardFailure: true)
  test:         npm test           (hardFailure: true)
  lint:         npm run lint       (hardFailure: false)

Providers available:
  anthropic     ✓ (ANTHROPIC_API_KEY found)
  grok          ✗ (XAI_API_KEY not set)
  openai        ✗ (OPENAI_API_KEY not set)
```

To change the model:

```
dantecode config set model.default.modelId claude-opus-4-6
```

To switch provider:

```
dantecode config set model.default.provider grok
```

---

## Step 4 — Run a first task

Start the interactive REPL:

```
dantecode
```

Or run a one-shot prompt:

```
dantecode "add a hello-world function to src/utils.ts"
```

Expected REPL prompt: `> `

At the end of a task, DanteCode prints a verification report:

```
✓ Verified — no issues found
  Anti-stub scan:     PASSED (0 hard violations)
  Constitution check: PASSED
  PDSE score:         82/100
```

---

## Step 5 — Inspect the diff

After DanteCode proposes changes:

```
/diff
```

Prints a colored unified diff of all proposed changes.

---

## Step 6 — Accept or undo

Accept:

```
/commit
```

Or undo the last change:

```
/undo
```

---

## Acceptance criteria

- [ ] `dantecode --help` outputs expected product description
- [ ] `dantecode init` creates `.dantecode/STATE.yaml`
- [ ] `dantecode config show` reports the `.dantecode/STATE.yaml` path and detected provider
- [ ] A simple one-shot task completes with a verification report
- [ ] `/diff` shows the proposed changes
- [ ] `/undo` reverts the last change without errors
- [ ] Total time from `npm install` to first verified task under 10 minutes

---

## Fail codes

| Code | Symptom |
|------|---------|
| `CLI-001` | Help output differs from README quickstart |
| `CLI-002` | `init` does not create STATE.yaml |
| `CLI-003` | `config show` does not report STATE.yaml path |
| `CLI-004` | Verification report not shown after task |
| `CLI-005` | Cost / provider state unclear during session |
