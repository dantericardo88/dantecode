# DanteCode Security Model

This document describes the security controls built into DanteCode. Every claim is tied to a specific source file so it can be independently verified in under 5 minutes.

---

## What Is Protected and How

### 1. Shell Injection — Eliminated at the Source

All subprocess invocations use `execFileSync(cmd, args[])` with a separate arguments array, never string interpolation. This eliminates shell injection at the call site rather than relying on input sanitization.

**Verified in:**
- [`packages/cli/src/commands/git.ts`](packages/cli/src/commands/git.ts) — git operations
- [`packages/cli/src/commands/council.ts`](packages/cli/src/commands/council.ts) — council subprocess launch
- [`packages/cli/src/commands/init.ts`](packages/cli/src/commands/init.ts) — project initialization
- [`packages/core/src/council/bridge-listener.ts`](packages/core/src/council/bridge-listener.ts) — bridge subprocess
- [`packages/cli/src/commands/self-update.ts`](packages/cli/src/commands/self-update.ts) — self-update flow

No production code paths use `exec(command)` with string interpolation for system commands.

**Verify it yourself:**
```bash
# Should return only execFileSync calls, no raw exec(string) calls
grep -rn "exec(" packages/*/src/ --include="*.ts" | grep -v "execFile\|execSync\|test\|spec\|//\|mock"
```

---

### 2. Prompt Injection Detection

Every user message passes through `sanitizeUserPrompt()` before entering the agent loop.

- **Source:** [`packages/core/src/prompt-sanitizer.ts`](packages/core/src/prompt-sanitizer.ts)
- **Wired at:** [`packages/cli/src/agent-loop.ts:481`](packages/cli/src/agent-loop.ts)

The sanitizer applies 11 detection rules and logs warnings to stderr **without modifying the input** (audit-only):

| Rule | Detects |
|------|---------|
| `backtick-expression` | Shell injection via backtick execution |
| `command-substitution` | Shell injection via `$(...)` |
| `rm-pipe` | Chained `; rm` commands |
| `sudo-pipe` | Pipe to sudo |
| `ignore-previous-instructions` | Classic prompt injection phrase |
| `ignore-all-prior` | Prompt injection variant |
| `system-prompt-keyword` | Prompt injection via `system prompt:` |
| `new-instructions` | Prompt injection via `new instructions:` |
| `unix-path-traversal` | Directory traversal `../` |
| `windows-path-traversal` | Directory traversal `..\` |

**Verify it yourself:**
```bash
grep -n "sanitizeUserPrompt" packages/cli/src/agent-loop.ts
grep -c "name:" packages/core/src/prompt-sanitizer.ts  # should be 11
```

---

### 3. Multi-Layer Security Engine

[`packages/core/src/security-engine.ts`](packages/core/src/security-engine.ts) runs a zero-trust evaluation pipeline at four layers before any action executes:

| Layer | What It Evaluates |
|-------|------------------|
| `prompt` | User message content before model invocation |
| `tool` | Tool name, arguments, and file paths before execution |
| `execution` | Shell commands — path traversal, rm-rf, fork bombs |
| `output` | Model responses before they reach the user |

Each evaluation produces a `RiskLevel` (`safe` / `low` / `medium` / `high` / `critical`) and an `ActionDecision` (`allow` / `warn` / `block` / `quarantine`). Quarantined actions are held for review rather than silently executed or dropped.

---

### 4. Secret Redaction in Audit Logs

`secretsScanner` is called at two checkpoints before any content is persisted:

- **Per-round** ([`agent-loop.ts:2954`](packages/cli/src/agent-loop.ts)): round content scanned before writing to session history
- **Session close** ([`agent-loop.ts:3317`](packages/cli/src/agent-loop.ts)): full session summary scanned before storage

API keys that appear in tool output (e.g., from accidentally printed environment variables) are redacted before reaching disk.

**Verify it yourself:**
```bash
grep -n "secretsScanner.scan" packages/cli/src/agent-loop.ts
```

---

### 5. Sandbox Isolation — Fail-Closed

[`packages/dante-sandbox`](packages/dante-sandbox/) wraps all tool execution behind an isolation chain:

```
Docker container  →  Git worktree isolation  →  Host (fail-closed)
```

The `ExecutionProxy` ([`packages/dante-sandbox/src/execution-proxy.ts`](packages/dante-sandbox/src/execution-proxy.ts)) fails **closed** — if no isolation layer is available, execution throws rather than silently falling back to the host. Production configuration sets `allowHostEscape: false` in `repl.ts`.

**Verify it yourself:**
```bash
grep -n "fails closed\|allowHostEscape" packages/dante-sandbox/src/execution-proxy.ts
```

---

### 6. Secret Scanning on Every Commit

[`.github/workflows/gitleaks.yml`](.github/workflows/gitleaks.yml) runs [Gitleaks](https://github.com/gitleaks/gitleaks) on every push and pull request with `fetch-depth: 0` (full history scan). Any hardcoded API key or token in any commit fails the check.

---

### 7. Path Traversal — Two Independent Layers

Path traversal (`../`, `..\`) is blocked at two independent layers:

1. **PromptSanitizer** — detects traversal patterns in user input before model invocation
2. **SecurityEngine** — enforces path traversal rules at the `execution` layer for all file-path tool calls

Skill imports use `sanitizeSlug()` to strip `../../`, path separators, and non-alphanumeric characters before they reach the filesystem.

---

## What Is Not Covered (Honest Gaps)

| Gap | Status |
|-----|--------|
| SOC 2 Type II | Not certified — requires external audit engagement |
| ISO 27001 / ISO 42001 | Not certified |
| Independent penetration test | Not performed — self-assessed threat model only |
| SSO / SAML for teams | Not implemented — single-user model only |
| Network egress controls | No egress filtering on outbound HTTP from tool calls |
| Supply chain provenance | npm packages not signed; no SLSA attestation |

---

## Reporting Vulnerabilities

**Do not open a public issue for security vulnerabilities.**

Email: **security@dantecode.dev**  
Or open a [GitHub Security Advisory](https://github.com/dantericardo88/dantecode/security/advisories/new)

Include: description, reproduction steps, impact assessment, and suggested fix if known.

**Response commitment:** Acknowledgement within 48 hours. Fix timeline within 7 days. Critical fixes within 30 days.

---

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.9.x   | ✅ Yes |
| < 0.9   | ❌ No |

---

*Every claim in this document is tied to a source file. If a claim is wrong, it is a documentation bug — open an issue.*  
*Last updated: 2026-04-08*
