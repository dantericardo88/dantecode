# Golden Flow GF-04 — Skill Import and Execution

> **Gate:** Must pass before public OSS v1 declaration.
> **Purpose:** Prove that DanteCode can import a skill from a supported format and
> execute it end to end, producing a verification receipt.

---

## What is a skill?

A **skill** is a reusable instruction set that tells DanteCode how to perform a
specific task (e.g. "write a commit message", "run a code review", "refactor to
follow a pattern"). Skills can be imported from:

- **Claude Code** (`--from-claude`) — Claude Code slash commands in `~/.claude/commands/`
- **Continue.dev** (`--from-continue`) — Continue slash commands in `.continuerc.json`
- **OpenCode** (`--from-opencode`) — OpenCode task definitions
- **A local file** (`--file <path>`) — A `.dc.md` or `.yaml` skill file
- **A SkillBridge bundle** (`import-bridge <dir>`) — A pre-compiled DanteForge bundle

---

## Option A — Import from Claude Code

If you have Claude Code installed, DanteCode can scan and import its slash commands:

```
dantecode skills import --from-claude
```

Expected output:

```
Scanning ~/.claude/commands/ for skills...
  Found 3 skill(s):
    commit-message.md    → [green] ready to import
    code-review.md       → [green] ready to import
    refactor-extract.md  → [amber] warning: uses 1 Claude-specific tool

Import all? (y/n): y

Imported 3 skill(s) to .dantecode/skills/
```

---

## Option B — Import a local skill file

Create a simple skill file at `my-skill.dc.md`:

```markdown
---
name: add-error-handling
description: Wraps any function with proper error handling
version: 1.0.0
---

# Add Error Handling

Wrap the target function with a try/catch block.
Log the error with context before rethrowing.
Return a typed Result<T, Error> if the language supports it.
```

Import it:

```
dantecode skills import --file my-skill.dc.md
```

Expected output:

```
Importing skill from my-skill.dc.md...
  Parsed:    add-error-handling v1.0.0
  Validated: PASSED (0 warnings)
  Installed: .dantecode/skills/add-error-handling.dc.md

✓ Skill imported successfully.
```

---

## Step 2 — List skills

```
dantecode skills list
```

Expected output:

```
Registered skills (1):

  add-error-handling   v1.0.0   [green]   Add Error Handling
```

The `[green]` / `[amber]` / `[red]` badge indicates the SkillBridge compatibility:
- **green** — fully compatible, all tools available
- **amber** — partially compatible, some tools have warnings
- **red** — blocked, required tools are unavailable

---

## Step 3 — Show skill details

```
dantecode skills show add-error-handling
```

Expected output:

```
Skill: add-error-handling
Version: 1.0.0
Description: Wraps any function with proper error handling
Source: local-file
Status: [green] ready

Instructions:
  Wrap the target function with a try/catch block.
  Log the error with context before rethrowing.
  Return a typed Result<T, Error> if the language supports it.
```

---

## Step 4 — Execute the skill

Reference the skill in a prompt using its name:

```
dantecode "Apply the add-error-handling skill to src/parser.ts — the parseConfig function"
```

Or in the REPL:

```
dantecode
> /skills add-error-handling
> Apply it to the parseConfig function in src/parser.ts
```

DanteCode loads the skill instructions and executes the task:

```
Loading skill: add-error-handling
Applying to: src/parser.ts → parseConfig()

[Task executes — DanteCode reads the file, applies the skill instructions]

Running DanteForge verification...
  ✓ Anti-stub scan:     PASSED
  ✓ Constitution check: PASSED
  ✓ PDSE score:         85/100

✓ Verified — changes ready for review.
```

---

## Step 5 — Review and accept

```
/diff
# Review the error handling that was added

/commit
# Accept the change
```

---

## Acceptance criteria

- [ ] `skills import` imports a skill file without errors
- [ ] `skills list` shows the imported skill with a correct badge
- [ ] `skills show` displays the skill instructions accurately
- [ ] A task that references the skill by name executes it end to end
- [ ] Verification receipt is produced (anti-stub + constitution + PDSE all run)
- [ ] `/diff` shows only the skill-guided changes

---

## Fail codes

| Code | Symptom |
|------|---------|
| `GF-005` | Skill is listed but the skill instructions are never actually used in the task |
| `GF-002` | No verification report after skill-guided task |
| `CLI-001` | `skills import --from-claude` reports no skills when Claude skills exist |
