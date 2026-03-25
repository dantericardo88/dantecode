# The Postal Service: Cross-Workspace Workflow for Non-Technical Founders

**Version:** 1.0  
**Date:** March 22, 2026  
**For:** Ricky and anyone building products by directing AI agents across multiple workspaces

---

## What This Document Is

You work across multiple AI workspaces simultaneously:

- **Claude.ai chats** for strategy, PRDs, FearSets, and analysis
- **Claude Code sessions** for each project's codebase
- **DanteCode CLI** for AI-powered code generation with verification

You can't read code. You can't debug. You can't tell if an AI is lying about what it built. Your only superpower is communication — carrying information between workspaces and asking the right questions.

This document is your playbook for doing exactly that. It defines what to say, when to say it, and what to carry between each workspace so that the AIs do the technical verification you can't.

---

## Your Workspaces

Label every workspace so you don't lose track:

| Label | Tool | Purpose | Example |
|-------|------|---------|---------|
| **HQ** | Claude.ai | Strategy, PRDs, scoring, FearSets | This chat right now |
| **DC-Build** | Claude Code | Building/fixing DanteCode itself | The session working on Phase 0 |
| **DC-Run** | DanteCode CLI | Using DanteCode to build other projects | Running /party on DirtyDLite |
| **DL-Build** | Claude Code | Building/fixing DirtyDLite directly | Verifying DanteCode's output |
| **DL-HQ** | Claude.ai | DirtyDLite strategy and PRDs | Your other chat |

You are the postal service between all of these. You carry documents, not understanding. The documents do the talking.

---

## The Three Documents You Carry

Everything in this workflow revolves around three types of documents. You never need to write these yourself — the AIs produce them. You just carry them to the right place.

### Document 1: The PRD

**Who produces it:** You + Claude.ai (HQ)  
**Who consumes it:** DanteCode (DC-Run) or Claude Code (DC-Build / DL-Build)  
**What it is:** A specification of what to build  
**Where it lives:** In the project repo under `/prds/` or `/Docs/`

### Document 2: The Run Report

**Who produces it:** DanteCode (DC-Run) after executing PRDs  
**Who consumes it:** Claude Code (DL-Build) for verification  
**What it is:** An honest accounting of what DanteCode did, what worked, what failed  
**Where it lives:** In the project repo under `.dantecode/reports/`

### Document 3: The Bug Report

**Who produces it:** Claude Code (DL-Build) after verifying a Run Report  
**Who consumes it:** Claude Code (DC-Build) to fix DanteCode itself  
**What it is:** A specific technical diagnosis of what went wrong in DanteCode  
**Where it lives:** You paste it — it travels through you

---

## Automatic Report Generation

As of v1.3, DanteCode automatically produces run reports for `/magic`, `/party`, `/forge`, and any REPL session that modifies files. You no longer need to remember to ask for a summary — the report is written for you every time.

Reports are saved to `.dantecode/reports/<timestamp>-<command>.md`. Each report contains six mandatory sections:

1. **What was built** — the features, files, and PRDs that were addressed
2. **What needs attention** — anything incomplete, skipped, or flagged by verification
3. **Completion status** — per-PRD pass/partial/fail breakdown
4. **Verification summary** — PDSE score, anti-stub results, and any DanteForge findings
5. **Files changed** — every file created, modified, or deleted during the run
6. **Reproduction** — the exact command and arguments used, so the run can be repeated

Reports are crash-safe. They are written inside a `try/finally` block, so even if DanteCode fails mid-run, you still get a partial report explaining what happened before the failure. A missing report means something went wrong before the session even started — not during it.

This automates what was previously a manual carry step. In the workflows below, every reference to "the run report" now points to a file that DanteCode produced automatically. You carry it to the verifier workspace (Step 3 in Workflow A) the same way as before — the only difference is that you no longer have to ask for it.

---

## Workflow A: Building a Project with DanteCode

This is your primary workflow. You have PRDs, you want code.

### Step 1: Create PRDs at HQ

**Where:** Claude.ai (HQ or DL-HQ)  
**You say:**

> I want to build [description of what you want]. Create a PRD for [specific feature]. Make it detailed enough that a coding AI can implement it without asking questions.

**You get:** A PRD document. Save it or copy it to the project.

### Step 2: Run DanteCode

**Where:** DanteCode CLI (DC-Run)  
**You paste:**

```
/party --prds ./prds/01-feature-name.md ./prds/02-feature-name.md
```

Or for a single PRD:

```
/magic ./prds/01-feature-name.md
```

**You wait.** DanteCode runs. When it finishes, it produces a run report at `.dantecode/reports/run-{timestamp}.md`.

### Step 3: Verify with Claude Code

**Where:** Claude Code (DL-Build) — pointed at the project DanteCode just worked on  
**You say:**

> Read the file `.dantecode/reports/run-{timestamp}.md`. This is a DanteCode run report. For every PRD marked COMPLETE, verify that the files it claims to have created actually exist and contain real code (not stubs or empty functions). For every PRD marked PARTIAL or FAILED, tell me what's actually missing. Give me your honest assessment — did DanteCode do what it said?

**You get:** One of three responses:

**Response A: "Everything checks out."**  
→ You're done. Move to the next set of PRDs.

**Response B: "The project code has issues but they're in the generated code, not DanteCode's fault."**  
→ Say to Claude Code: "Fix these issues." It will fix them in the project repo directly.

**Response C: "DanteCode has a bug — it's doing something wrong."**  
→ Go to Step 4.

### Step 4: Report DanteCode bugs

**Where:** Claude Code (DL-Build) — still in the project repo  
**You say:**

> Write a bug report for the DanteCode team. Describe exactly what DanteCode did wrong, what the expected behavior should be, and include specific evidence (file paths, line numbers, what's missing). Format it so I can paste it into another Claude Code session that has the DanteCode repo open.

**You get:** A bug report. Copy the entire thing.

### Step 5: Fix DanteCode

**Where:** Claude Code (DC-Build) — pointed at the DanteCode repo  
**You paste:**

> Here's a bug report from using DanteCode on a real project. Read it and fix the issue.
> 
> [paste the bug report]

**Claude Code fixes the bug in DanteCode.**

### Step 6: Retest

Go back to Step 2. Run the failed PRDs again. This time DanteCode should handle them correctly because the bug is fixed.

---

## Workflow B: Improving DanteCode Based on Usage

This is your secondary workflow. You used DanteCode, something felt wrong (not a bug, but a design problem), and you want to improve DanteCode itself.

### Step 1: Document the pain at HQ

**Where:** Claude.ai (HQ)  
**You say:**

> I just used DanteCode to build [project]. Here's what happened: [describe your experience]. Here's what confused me: [describe confusion]. Here's what I expected: [describe expectation]. What's the root cause and how should we fix it?

**You get:** Analysis, possibly a FearSet, possibly a PRD addition.

### Step 2: Create the fix spec

**Where:** Claude.ai (HQ)  
**You say:**

> Write a Claude Code prompt to fix this. Remember the DanteCode repo is at [branch name] and the relevant files are [whatever HQ tells you].

**You get:** A prompt for Claude Code.

### Step 3: Implement the fix

**Where:** Claude Code (DC-Build)  
**You paste:** The prompt from Step 2.

### Step 4: Retest on the original project

**Where:** DanteCode CLI (DC-Run)  
Run the same PRDs that caused the original pain. Verify the experience is better.

---

## Workflow C: Strategic Planning

This is your high-level workflow. No code involved.

### Step 1: Gather data

**Where:** Claude.ai (HQ)  
**You say:**

> Pull the DanteCode repo at [branch]. Audit [specific thing]. Be hyper-critical. Compare the scoring matrix claims against what's actually in the code.

### Step 2: Analyze

**Where:** Claude.ai (HQ)  
**You say:**

> Run a FearSet on [topic]. Go 7 levels deep. Find every root cause.

### Step 3: Plan

**Where:** Claude.ai (HQ)  
**You say:**

> Based on [FearSet / analysis], create a PRD that solves all the root causes.

### Step 4: Execute

Hand the PRD to Claude Code (DC-Build) via Workflow B Step 3.

---

## The Golden Rules

### Rule 1: Never translate — transport

You are not a technical translator. You don't need to understand the bug report to carry it. Copy the entire thing, paste the entire thing. Don't summarize, don't paraphrase, don't skip the parts you don't understand. The AIs on both ends understand each other. You're the envelope, not the editor.

### Rule 2: Always verify through a different AI than the one that did the work

DanteCode claims it built 25 PRDs? Don't ask DanteCode if it did a good job. Ask Claude Code — a completely separate AI session — to check the files. This is the same principle as having an independent auditor. The builder should never be the verifier.

### Rule 3: The run report is the source of truth

If DanteCode doesn't produce a run report, the run didn't happen. If the run report says FAILED, it failed — even if DanteCode said "done" in the chat. If the run report says COMPLETE but Claude Code says the files are wrong, the run report has a bug (go to Workflow A Step 4).

### Rule 4: One workspace, one job

Don't ask Claude Code in DirtyDLite to fix DanteCode. It doesn't have the DanteCode repo. Don't ask Claude Code in DanteCode to verify DirtyDLite's files. It doesn't have the DirtyDLite repo. Each workspace sees one repo. You are the only entity that sees all repos.

### Rule 5: When confused, come to HQ

If you don't understand what Claude Code is telling you, if you don't know which workspace to go to, if something doesn't make sense — come back to Claude.ai (HQ). Paste what you're seeing. Ask: "What does this mean and what should I do next?" HQ's job is to translate technical output into actions you can take.

### Rule 6: Ask for copy-paste commands

Never let an AI tell you "just run the tests" or "check the output." Always say: "Give me the exact command to copy and paste." Every instruction should be something you can select-all → copy → paste → hit Enter. If an AI gives you instructions that require you to make a judgment call (like "edit the config file to match your setup"), push back: "Give me the exact text to paste. I don't know what 'match my setup' means."

---

## Quick Reference: What to Say Where

| Situation | Where to go | What to say |
|-----------|-------------|-------------|
| I want to plan a new feature | HQ (Claude.ai) | "Create a PRD for [feature]" |
| I want DanteCode to build something | DC-Run (DanteCode CLI) | `/party --prds [file paths]` |
| I want to check if DanteCode did its job | DL-Build (Claude Code, project repo) | "Read .dantecode/reports/[latest].md and verify every claim" |
| DanteCode has a bug | DL-Build → DC-Build | Ask DL-Build for bug report, paste into DC-Build |
| The generated code has issues (not DanteCode's fault) | DL-Build (Claude Code, project repo) | "Fix these issues" |
| I'm confused about what happened | HQ (Claude.ai) | "Here's what I'm seeing: [paste]. What does it mean?" |
| I want to improve DanteCode's UX | HQ (Claude.ai) | "I just used DanteCode and [describe experience]. How do we fix this?" |
| I need exact commands to run | HQ or any Claude Code | "Give me the exact command to copy and paste" |
| I want to update DanteCode's code | DC-Build (Claude Code, DanteCode repo) | Paste the prompt from HQ |
| I want to score/audit DanteCode | HQ (Claude.ai) | "Pull the repo at [branch], audit [thing], be hyper-critical" |

---

## Example: Full Cycle

Here's a complete example of building one feature for DirtyDLite, hitting a bug, fixing it, and retesting.

**1. HQ:** "Create a PRD for user authentication in DirtyDLite"  
→ Claude.ai produces PRD, you save it to `DirtyDLite/prds/01-auth.md`

**2. DC-Run:** `/party --prds ./prds/01-auth.md`  
→ DanteCode runs, produces `.dantecode/reports/run-2026-03-22T14-30-00Z.md`

**3. DL-Build:** "Read .dantecode/reports/run-2026-03-22T14-30-00Z.md and verify every claim"  
→ Claude Code says: "The login endpoint exists but the password hashing function is empty. DanteCode's report says COMPLETE but it's actually PARTIAL. The anti-stub scanner missed this because the function has a comment instead of a throw statement."

**4. DL-Build:** "Write a bug report for the DanteCode team about the anti-stub scanner missing empty functions with comments"  
→ Claude Code produces:

```
BUG: Anti-stub scanner doesn't detect empty function bodies that contain only comments.

File: packages/danteforge/src/index.ts
Component: runAntiStubScanner() → DEFAULT_STUB_PATTERNS

The scanner checks for `throw new Error("not implemented")` and TODO markers,
but does not flag functions where the body contains only comments and no 
executable code.

Example that passes scanner but is a stub:
  function hashPassword(password: string): string {
    // TODO: implement bcrypt hashing
    return password;
  }

The `return password` on the last line prevents the TODO pattern from 
triggering because the scanner sees executable code after the comment.

Expected: This should be flagged as a stub because the implementation 
is trivially wrong (returning plaintext password).

Suggested fix: Add a pattern that flags functions where the return 
statement is suspiciously simple relative to the function name 
(e.g., returning an input parameter unchanged).
```

**5. DC-Build:** Paste: "Here's a bug report from using DanteCode on a real project. Read it and fix the issue. [paste bug report]"  
→ Claude Code fixes the anti-stub scanner in DanteCode.

**6. DC-Run:** `/party --prds ./prds/01-auth.md` (rerun)  
→ This time DanteCode catches the stub and regenerates with real bcrypt implementation.

**7. DL-Build:** "Read the new run report and verify"  
→ "All claims check out. Auth is fully implemented."

**Done.** One feature, one bug found, one bug fixed, verified by an independent AI. Total technical knowledge required from you: zero. Total commands you needed to understand: zero. You just carried documents.

---

## When This Process Breaks

This process fails when:

1. **You forget to verify.** If you skip Step 3 and trust DanteCode blindly, bugs accumulate silently. Always verify.

2. **You summarize instead of copying.** If you paraphrase the bug report instead of pasting it whole, DC-Build loses the specific file paths, line numbers, and evidence it needs. Always paste the full text.

3. **You go to the wrong workspace.** If you ask DC-Build (DanteCode repo) to fix a DirtyDLite issue, it can't see the files. Follow Rule 4: one workspace, one repo.

4. **The run report doesn't exist.** If DanteCode crashes before writing the report, you have no source of truth. This is why D-11 specifies try/finally — the report must be written even on crash. If it still doesn't exist, tell DC-Build: "DanteCode crashed without producing a report. Look at the git log for the last N commits and tell me what was changed."

5. **Two AIs disagree.** DanteCode says COMPLETE, Claude Code says FAILED. Trust Claude Code (the independent verifier). Go to Step 4 and report the discrepancy as a DanteCode bug.
