# Tutorial: Your First AI-Assisted Code Change

This tutorial walks you through using DanteCode for a real task from start to finish. By the end you'll have made a code change, reviewed the diff, and committed it — all with AI assistance.

## Prerequisites

- DanteCode installed (`npm install -g @dantecode/cli`)
- A project configured (`dantecode init` run, API key set)
- A Node.js or TypeScript project to work on

If you haven't configured DanteCode yet, start with [Getting Started](../getting-started.md).

## The scenario

You have a `src/utils.ts` file with a helper function, and you want to add input validation. Let's walk through this together.

## Step 1: Start DanteCode in your project

Open a terminal in your project root:

```bash
cd my-project
```

Check that DanteCode knows about your project:

```bash
dantecode config validate
```

Expected output: `✓ Config is valid`

## Step 2: Describe what you want to do

Run DanteCode with a plain English description of your task:

```bash
dantecode "Add null checks and type guards to the processUser function in src/utils.ts"
```

DanteCode will:
1. Read `src/utils.ts` to understand the current code
2. Identify what `processUser` does and what inputs it accepts
3. Plan the changes needed
4. Show you a diff of the proposed edits

## Step 3: Review the diff

DanteCode shows a unified diff before making any changes:

```
  src/utils.ts
  +++ b/src/utils.ts
  @@ -12,6 +12,11 @@ export function processUser(user: unknown) {
  +  if (!user || typeof user !== 'object') {
  +    throw new TypeError('processUser: user must be a non-null object');
  +  }
  +  const u = user as Record<string, unknown>;
  +  if (typeof u['id'] !== 'string') throw new TypeError('processUser: id must be a string');
     return { id: user.id, name: user.name };
   }
```

Read through the diff carefully. Ask yourself:
- Does this match what I asked for?
- Are there any unintended changes?
- Does the logic look correct?

## Step 4: Approve or reject

Press **Enter** or type `y` to apply the change, or `n` to reject it and provide feedback.

If you reject:

```
DanteCode: rejected. What should be different?
> Also add a check for the name field being a non-empty string
```

DanteCode will revise the plan and show you a new diff.

## Step 5: Run tests

After approving, run your test suite to confirm nothing broke:

```bash
npm test
```

If tests fail, describe the failure to DanteCode:

```bash
dantecode "The test processUser_returns_name failed with 'Cannot read name of undefined'. Fix the guard logic."
```

## Step 6: Commit

Once tests pass, commit the change:

```bash
git add src/utils.ts
git commit -m "feat: add null checks to processUser"
```

Or ask DanteCode to write the commit message:

```bash
dantecode "Write a conventional commit message for the changes I just made to src/utils.ts"
```

## What you learned

- How to describe a task in plain English
- How to review and approve AI-generated diffs
- How to iterate by providing feedback when the first attempt isn't right
- How to combine DanteCode with your normal Git workflow

## Common patterns

**Adding a feature:**
```bash
dantecode "Add pagination to the /api/users endpoint in src/routes/users.ts"
```

**Fixing a bug:**
```bash
dantecode "Fix the race condition in src/cache.ts where two concurrent writes corrupt the cache"
```

**Refactoring:**
```bash
dantecode "Extract the email validation logic from src/auth.ts into a shared src/validators/email.ts module"
```

**Writing tests:**
```bash
dantecode "Write unit tests for the calculateTax function in src/billing.ts covering edge cases"
```

## Next steps

- [Configure provider](../how-to/configure-provider.md) — switch providers or add a fallback
- [Use FIM completions](../how-to/use-fim.md) — get inline suggestions while you type
- [CLI commands reference](../reference/cli-commands.md) — all available commands
