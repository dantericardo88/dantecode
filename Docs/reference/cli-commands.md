# CLI Commands Reference

DanteCode is invoked as `dantecode <command> [options]`.

## Global options

| Flag | Description |
| ---- | ----------- |
| `--help`, `-h` | Show help for any command |
| `--version` | Print the installed DanteCode version |
| `--project <path>` | Set project root (default: current directory) |

---

## `dantecode init`

Initialize DanteCode in the current project directory.

```bash
dantecode init
```

Creates `.dantecode/STATE.yaml` and `.dantecode/config.json` with interactive prompts for:
- Provider selection (anthropic / openai / ollama / azure)
- API key entry
- Model selection
- Feature toggles (FIM, browser preview)

**Repo readiness check:** `init` checks for `package.json`, a `dev` script, and `.git`. It prints a readiness summary before creating config files.

---

## `dantecode config`

Manage DanteCode configuration. All subcommands operate on `.dantecode/config.json`.

### `dantecode config get <key>`

Print the value at a dotted key path.

```bash
dantecode config get provider.model
# claude-sonnet-4-6

dantecode config get features.fim
# true
```

### `dantecode config set <key> <value>`

Set a config value. The value is auto-coerced: `"true"`/`"false"` → boolean, numeric strings → number, everything else → string.

```bash
dantecode config set provider.model claude-opus-4-7
dantecode config set features.fim true
dantecode config set ui.theme dark
dantecode config set provider.baseUrl https://my-endpoint.openai.azure.com
```

### `dantecode config list`

Show the full configuration with the API key masked.

```bash
dantecode config list
```

### `dantecode config validate`

Check configuration for errors. Prints actionable fix hints for each error.

```bash
dantecode config validate
# ✓ Config is valid
# — or —
# 1 error(s):
#   [provider.apiKey] API key is required for provider "anthropic"
#   → Run: dantecode config set provider.apiKey <your-api-key>
```

### `dantecode config reset`

Restore configuration to factory defaults.

```bash
dantecode config reset
# ✓ Config reset to defaults
```

### `dantecode config show`

Show the full STATE.yaml (project-level agent state), not config.json.

```bash
dantecode config show
```

### `dantecode config models`

List configured models: default, fallbacks, and per-task overrides.

```bash
dantecode config models
```

---

## `dantecode review`

Run an AI code review on staged or recent changes.

```bash
# Review staged changes (like a pre-commit check)
dantecode review

# Review a specific file
dantecode review src/auth.ts

# Review with a custom focus
dantecode review --focus "security and input validation"
```

The review output includes:
- Overall assessment (approved / needs changes / blocked)
- Specific comments with line references
- Severity labels (critical / major / minor / suggestion)

---

## `dantecode bench`

Run performance benchmarks and capability tests.

```bash
# Run default benchmark suite
dantecode bench

# Run FIM latency benchmark (measures p50/p95 completion time)
dantecode bench --fim

# Run SWE-bench sample (measures task completion rate)
dantecode bench --swe

# Run N iterations for statistical accuracy
dantecode bench --runs 10
```

Results are saved to `.danteforge/bench-results.json` and printed as a summary table.

---

## `dantecode generate`

Generate code from a description or template.

```bash
# Generate a React component
dantecode generate "A card component with title, body, and action button"

# Generate from screenshot (requires vision-capable model)
dantecode generate --from-screenshot screenshot.png --framework react

# Generate with a specific output path
dantecode generate "REST API endpoint for user login" --output src/routes/auth.ts
```

---

## `dantecode skills`

Manage DanteCode skills — reusable task templates.

```bash
# List installed skills
dantecode skills list

# Run a skill
dantecode skills run review-security

# Import a skill from a URL
dantecode skills import https://example.com/skill.json

# Show skill details
dantecode skills show review-security
```

---

## `dantecode browse`

Launch browser automation for web tasks.

```bash
# Open a URL and describe what to do
dantecode browse "https://example.com" "Click the login button and extract the form fields"

# Take a screenshot of a URL
dantecode browse screenshot "https://example.com"
```

Requires Playwright to be installed (`npm install playwright && npx playwright install chromium`).

---

## Configuration

All commands read from `.dantecode/config.json` in the current project root. Use `dantecode config set` to change settings or see [Configuration Schema Reference](config-schema.md) for full field documentation.

---

## Exit codes

| Code | Meaning |
| ---- | ------- |
| 0 | Success |
| 1 | General error (invalid args, API error, etc.) |
| 2 | Configuration error (missing or invalid config) |
| 3 | Task completed but with warnings |
