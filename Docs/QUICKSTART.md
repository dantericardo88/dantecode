# DanteCode — 5-Minute Quickstart

Get your first autonomous coding session running in under 5 minutes.

---

## 1. Install

```bash
npm install -g @dantecode/cli
```

Verify:
```bash
dantecode --version
# → DanteCode v0.9.2
```

## 2. Configure API Key

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

Or create `.dantecode/config.json` in your project root:
```json
{
  "provider": "anthropic",
  "model": "claude-sonnet-4-6"
}
```

## 3. First Prompt

Navigate to any project folder:
```bash
cd my-project
dantecode "explain this codebase in 3 sentences"
```

DanteCode will:
1. Build a repo map
2. Select relevant files
3. Give you a grounded explanation (not hallucinated)

## 4. First Spec-Driven Task

```bash
dantecode "add input validation to the login form — reject empty username and password"
```

This triggers the PDSE pipeline:
- **Plan** — proposes the change
- **Design** — identifies files to edit
- **Spec** — writes a failing test first
- **Execute** — makes the change, runs tests

When complete, DanteCode prints a receipt:
```
✓ Receipt ev_a1b2c3 sealed
  Task: "add input validation to the login form"
  PDSE score: 87/100
  Files: src/auth/login.ts, src/auth/login.test.ts
```

Verify any receipt later:
```bash
dantecode verify-receipt ev_a1b2c3
```

## 5. Useful First Commands

| Command | What it does |
|---------|-------------|
| `/verify` | Run GREEN/RED health check on the codebase |
| `/test src/auth/login.ts` | Generate missing tests for a file |
| `/pdse-report` | See last 10 sessions with PDSE scores |
| `/cost-history` | Total spend + Haiku routing stats |
| `/stress-test --instances 5` | Autonomous self-test (no human input needed) |
| `/gaslight stats` | Show adversarial refinement stats |
| `/plan <goal>` | Generate + review a plan before coding |

## 6. IDE Integration

**VS Code:**
1. Install the DanteCode extension (`.vsix` from releases)
2. Open the DanteCode panel from the sidebar
3. All slash commands work identically in the panel

**CLI interactive mode:**
```bash
dantecode  # starts interactive REPL
```

---

## What Makes DanteCode Different

- **Spec-Driven by default**: writes tests BEFORE code
- **Self-improving**: Gaslight engine critiques its own output
- **Cryptographic receipts**: every session is verifiably signed
- **Honest scoring**: PDSE score reflects real code quality, not vibes
- **Cost-aware**: automatically routes simple tasks to Haiku (8× cheaper)

---

*Full docs:* `docs/ARCHITECTURE.md` | *Tutorials:* `docs/TUTORIALS.md`
