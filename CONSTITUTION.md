# CONSTITUTION.md

## DanteCode Constitutional Rules

> Non-negotiable rules that every code generation, agent action, and system output must satisfy.
> Violation of any HARD rule is a build failure — not a warning.

---

## 1. Anti-Stub Absolute

**HARD RULE — Zero tolerance.**

The following patterns are **build failures** when found in generated or modified code:

| Pattern | Type |
|---------|------|
| `TODO` | Hard violation |
| `FIXME` | Hard violation |
| `HACK` | Hard violation |
| `XXX` | Hard violation |
| `raise NotImplementedError` | Hard violation |
| `pass` followed by comment | Hard violation |
| `...` (ellipsis body) | Hard violation |
| `throw new Error("not implemented")` | Hard violation |
| `// @ts-ignore` | Hard violation |
| `as any` | Hard violation |
| `placeholder` | Hard violation |
| `shim` | Hard violation |
| Empty function/method bodies | Hard violation |

**Enforcement layers:**
1. **Layer 1** — Anti-Stub Scanner (pre-write)
2. **Layer 2** — PDSE Clarity gate (score = 0 on stubs)
3. **Layer 3** — GStack (typecheck + lint catch remaining)
4. **Layer 4** — CI pipeline (final guard)

If a stub is detected, the file is **not written to disk**. The Autoforge IAL regenerates with lesson injection (max 3 attempts). If all attempts fail, the task is marked BLOCKED and logged.

---

## 2. PDSE Quality Gate

**HARD RULE — Fail-closed.**

Every generated file must pass PDSE scoring before being written to disk.

| Metric | Weight | Description |
|--------|-------:|-------------|
| Completeness | 35% | All requirements addressed, no missing implementations |
| Correctness | 30% | Logic is sound, edge cases handled, no obvious bugs |
| Clarity | 20% | Readable, well-named, no dead code, no stubs |
| Consistency | 15% | Matches project conventions, naming patterns, style |

- **Threshold**: 85/100
- **Hard violations allowed**: 0
- **Max regeneration attempts**: 3
- If the gate doesn't pass after max attempts, the file is rejected and a lesson is recorded.

---

## 3. Model Agnosticism (NOMA)

**HARD RULE — No vendor lock-in.**

- All LLM calls route through the provider-agnostic Model Router.
- Zero hardcoded model strings in agent logic.
- Default provider: Grok (`x-ai/grok-3`).
- Fallback: Anthropic Claude Sonnet 4.6.
- Any OpenAI-compatible endpoint can be used via `custom/<model>`.
- Model switching must complete in < 2 seconds.
- No model-specific assumptions in core logic — all providers implement the same interface.

---

## 4. Security & Credential Protection

**HARD RULE — Hard reject on violation.**

Generated code must **never** contain:

| Category | Examples |
|----------|---------|
| API keys | `sk-...`, `xai-...`, `AKIA...`, hardcoded key strings |
| Passwords | Plaintext passwords, default credentials |
| Secrets | JWT secrets, encryption keys, signing keys |
| Tokens | OAuth tokens, session tokens, bearer tokens |
| Connection strings | Database URLs with embedded credentials |
| Private keys | PEM files, SSH keys, certificate private keys |

**Enforcement**: Constitution checker scans all generated output. Violations are hard-rejected — no regeneration, no override.

---

## 5. Git-Native Operations

**SOFT RULE — Default behavior.**

- Every accepted edit is auto-committed with a structured commit message.
- Commit messages use HEREDOC format.
- Long-running tasks use git worktree isolation.
- Worktrees are created in `.dantecode/worktrees/`.
- Branch naming: `dc/{session_id_short}/{task_slug}`.
- Merge conflicts are build failures — NOMA ensures no two agents touch the same file.

---

## 6. Evidence Chain & Audit

**HARD RULE — Immutable logging.**

- Every decision, gate score, lesson, and action is logged to `.dantecode/audit.jsonl`.
- Audit log is append-only — never modified or truncated during a session.
- Each entry includes: timestamp, session ID, event type, payload, and result.
- Log rotation occurs at 100MB boundary.

---

## 7. NOMA Compliance

**HARD RULE — No overlapping file access in parallel agents.**

- Non-Overlapping Multi-Agent parallelism: no two agent lanes touch the same file.
- Merge conflicts from parallel agent execution are a build failure.
- Max concurrent agents: 4 (configurable in STATE.yaml).
- Each agent operates in its own worktree when running in parallel.

---

## 8. Sandbox Boundaries

**SOFT RULE — Defense in depth.**

- When sandbox mode is enabled, all bash commands execute inside Docker containers.
- Network isolation: bridge mode by default, no host network access.
- Resource limits: 2GB memory, 2 CPU cores, 5-minute timeout.
- When sandbox is disabled, a local fallback executor is used with warnings.
- Test execution always runs in sandbox when available.

---

## 9. Skill Portability

**SOFT RULE — Ecosystem interop.**

- Skills imported from Claude Code, Continue.dev, or OpenCode are wrapped with DanteForge adapters.
- Adapter injection adds: Anti-Stub Doctrine, PDSE Clarity Gate, Constitution Rules.
- Imported skills are validated (anti-stub + constitution check) before registration.
- Skills that fail validation are logged and skipped — never silently accepted.

---

## 10. Actionable Errors

**SOFT RULE — Developer experience.**

- Error messages must tell the user **what to do**, not just what went wrong.
- Bad: `"Error: ENOENT"`. Good: `"File not found: ./src/auth.ts — ensure the file exists or check your path"`.
- Stack traces are logged to audit, not shown to users unless `--verbose` is set.

---

## Rule Classification

| Rule | Type | On Violation |
|------|------|-------------|
| Anti-Stub Absolute | HARD | Block write, regenerate, log lesson |
| PDSE Quality Gate | HARD | Block write, regenerate, log lesson |
| Model Agnosticism | HARD | Build failure |
| Security/Credentials | HARD | Hard reject, no retry |
| NOMA Compliance | HARD | Build failure |
| Evidence Chain | HARD | System error |
| Git-Native | SOFT | Degraded functionality |
| Sandbox Boundaries | SOFT | Warning + local fallback |
| Skill Portability | SOFT | Skip + log |
| Actionable Errors | SOFT | Poor UX (non-blocking) |
