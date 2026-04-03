# DanteCode Root Cause Analysis
*Analysis Date: 2026-04-02*
*Context: SettleThis build failures due to DanteCode agent loop issues*

## Executive Summary

Three critical bugs in DanteCode's agent loop are causing legitimate workflows to fail:

1. **`isRepoInternalCdChain` has inverted logic** - blocks ALL internal `cd` commands
2. **Tool call parser lacks robustness** - fails on valid JSON with escape sequences
3. **Anti-confabulation detector has false positives** - blocks legitimate read-then-write workflows

## Root Cause #1: `cd` Command Blocking Bug

### Location
`packages/core/src/self-improvement-policy.ts:132-150`

### The Bug
```typescript
export function isRepoInternalCdChain(command: string, projectRoot: string): boolean {
  // ... validation code ...
  const resolvedDestination = resolveProjectPath(destination, projectRoot);
  return (
    resolvedDestination !== resolve(projectRoot) &&  // ❌ BUG LINE 146
    (resolvedDestination === resolve(projectRoot) ||  // ❌ BUG LINE 147
     resolvedDestination.startsWith(`${resolve(projectRoot)}${sep}`))  // LINE 148
  );
}
```

### Logic Analysis
For command: `cd frontend && npm install`
- `resolvedDestination` = `/path/to/project/frontend`
- `resolve(projectRoot)` = `/path/to/project`

Evaluation:
- Line 146: `"/project/frontend" !== "/project"` → **TRUE** ✅
- Line 147: `"/project/frontend" === "/project"` → **FALSE** ❌
- Line 148: `"/project/frontend".startsWith("/project/")` → **TRUE** ✅
- **Result**: `TRUE && (FALSE || TRUE)` = `TRUE` → **BLOCKS the command** ❌

### Intent vs Reality
- **Intent**: Block external `cd`, allow internal subdirs
- **Reality**: Blocks ALL internal subdirs, allows nothing

### The Fix
```typescript
export function isRepoInternalCdChain(command: string, projectRoot: string): boolean {
  // ... validation code ...
  const resolvedDestination = resolveProjectPath(destination, projectRoot);
  
  // Block if destination is OUTSIDE the project root
  const rootPath = resolve(projectRoot);
  return !(
    resolvedDestination === rootPath ||
    resolvedDestination.startsWith(`${rootPath}${sep}`)
  );
}
```

**Inverted logic**: Return `true` (block) only if destination is NOT in project tree.

---

## Root Cause #2: Tool Call Parser Brittleness

### Location
`packages/cli/src/tool-call-parser.ts:22-65, 140-160`

### The Bug
```typescript
export function parseToolCallPayload(payload: string): {...} | null {
  try {
    return JSON.parse(payload);
  } catch {
    try {
      return JSON.parse(escapeLiteralControlCharsInJsonStrings(payload));
    } catch {
      return null;  // ❌ Silent failure - no diagnostic info
    }
  }
}
```

### Issues

1. **No error feedback**: Returns `null` instead of error details
2. **Incomplete escape handling**: Only escapes `\n`, `\r`, `\t` - misses:
   - Template literals: `${variable}`
   - Unescaped quotes: `"don't"` → `"don\"t"`
   - Windows paths: `C:\Users\...` → `C:\\Users\\...`
3. **Silent `parseErrors` array**: Populated but not shown to model until next round

### Observed Failure Pattern (from SettleThis conversation)
```
Tool parse error — 3 malformed <tool_use> block(s), nothing executed.
```

Model receives no guidance on WHAT was malformed → keeps retrying same syntax → loop.

### The Fix

1. **Return diagnostic errors**:
```typescript
export function parseToolCallPayload(
  payload: string
): { success: true; data: {...} } | { success: false; error: string } {
  try {
    return { success: true, data: JSON.parse(payload) };
  } catch (e1) {
    try {
      const escaped = escapeLiteralControlCharsInJsonStrings(payload);
      return { success: true, data: JSON.parse(escaped) };
    } catch (e2) {
      return { 
        success: false, 
        error: `JSON parse failed: ${e2.message}. Near: ${payload.slice(0, 100)}...`
      };
    }
  }
}
```

2. **Enhance escape function**:
```typescript
export function escapeLiteralControlCharsInJsonStrings(payload: string): string {
  // Add handling for:
  // - Unescaped backslashes: \ → \\
  // - Template literals: ${...} → \\${...}
  // - Single quotes in double-quoted strings
  // ...existing logic + additions
}
```

3. **Immediate error feedback**: Show parseErrors to model in same round, not next round

---

## Root Cause #3: Anti-Confabulation False Positives

### Location
`packages/cli/src/agent-loop.ts:1942-1972`

### The Bug
```typescript
// Diff-based anti-confabulation: compare claimed vs actual file changes.
if (touchedFiles.length > 0) {
  const lastAssistant = messages.filter((m) => m.role === "assistant").pop();
  if (lastAssistant) {
    const claimedFiles = extractClaimedFiles(lastAssistant.content);
    if (claimedFiles.length > 0) {
      const actualSet = new Set(touchedFiles.map((f) => f.replace(/\\/g, "/")));
      const unverified = claimedFiles.filter(
        (f: string) => !actualSet.has(f.replace(/\\/g, "/")),
      );
      // ❌ FALSE POSITIVE: Claims in planning/explanation are flagged as confabulation
    }
  }
}
```

### Issue
The detector triggers on:
- Model mentions files in planning: "I will edit `foo.ts` next..."
- Model references files in explanations: "Based on reading `bar.ts`..."
- Model does legitimate read-before-write: Read(foo.ts) → explain → Write(foo.ts) next round

### Observed Pattern (from SettleThis conversation, Round 5-9)
```
Anti-confabulation v2 (1/4) — reads-only pattern, 0 files written.
Anti-confabulation v2 (2/4) — reads-only pattern, 0 files written.
```

Model reads 5+ files to understand structure → explains what it learned → flagged as confabulation.

### The Fix

**Option 1: Time-window grace period**
```typescript
// Only flag confabulation if model claimed writes but produced 0 writes for 3+ consecutive rounds
const recentRounds = session.messages.slice(-6); // Last 3 rounds (user+assistant pairs)
const consecutiveReadOnlyRounds = countConsecutiveReadOnlyRounds(recentRounds);
if (consecutiveReadOnlyRounds >= 3 && claimedFiles.length > 0) {
  // Now flag confabulation
}
```

**Option 2: Distinguish claims from mentions**
```typescript
// Only extract claims with strong action verbs: "Created", "Modified", "Updated", "Fixed"
// Ignore planning/explanation: "will edit", "reading", "based on"
const claimedFiles = extractClaimedFiles(lastAssistant.content, { 
  actionVerbsOnly: true 
});
```

**Option 3: Writes-per-round quota**
```typescript
// Only trigger if model has been reading for 5+ rounds with ZERO writes
// Allow read-heavy planning phases
if (roundsWithoutWrites >= 5 && claimedFiles.length > 0) {
  // Flag confabulation
}
```

---

## Root Cause #4: No Command Translation Suggestions

### Location
`packages/cli/src/tools.ts:2219-2227`

### The Bug
```typescript
if (name === "Bash") {
  const command = input["command"] as string | undefined;
  if (command && isRepoInternalCdChain(command, projectRoot)) {
    return {
      content:
        "Error: Run this from the repository root instead of chaining `cd ... &&`. " +
        "Re-issue the command from the root worktree so verification and audit paths stay consistent.",
      isError: true,
    };
  }
}
```

### Issue
Error message is vague - model doesn't know HOW to "run from root".

### Observed Pattern
Model repeatedly tries:
- `cd frontend && npm install` → blocked
- `cd frontend && npm run build` → blocked  
- Gives up or loops

### The Fix
```typescript
if (command && isRepoInternalCdChain(command, projectRoot)) {
  const suggested = translateCdCommand(command);
  return {
    content:
      `Error: Chaining 'cd ... &&' is blocked to ensure audit consistency.\n\n` +
      `Instead of:\n  ${command}\n\n` +
      `Use:\n  ${suggested}\n\n` +
      `This runs the command from the repo root while targeting the subdirectory.`,
    isError: true,
  };
}

function translateCdCommand(cmd: string): string {
  const match = cmd.match(/^cd\s+(.+?)\s*&&\s*(.+)$/);
  if (!match) return cmd;
  
  const [, dir, rest] = match;
  
  // npm/pnpm/yarn: use --prefix or -C
  if (rest.startsWith('npm ')) return `npm --prefix ${dir} ${rest.slice(4)}`;
  if (rest.startsWith('pnpm ')) return `pnpm -C ${dir} ${rest.slice(5)}`;
  
  // Generic: use (cd ... && ...) subshell
  return `(cd ${dir} && ${rest})`;
}
```

---

## Impact Assessment

### SettleThis Build Failure Timeline

| Round | What Happened | Root Cause |
|-------|---------------|------------|
| 3-4   | `cd frontend && npx drizzle-kit` → blocked | Bug #1: cd blocking |
| 5-9   | Multiple Read operations → "Anti-confabulation v2 (1/4)" | Bug #3: False positive |
| 10-14 | Tool parse errors on Write calls with template literals | Bug #2: Parser brittleness |
| 15+   | Loop: retry same blocked commands | Bug #4: No guidance |

**Result**: Build stalled after 18 rounds with <10% actual progress.

---

## Recommended Fix Priority

### P0 (Critical - breaks legitimate workflows)
1. ✅ Fix `isRepoInternalCdChain` logic inversion
2. ✅ Add command translation suggestions

### P1 (High - causes retry loops)
3. ✅ Enhance tool call parser with diagnostics
4. ✅ Refine anti-confabulation detector (time-window approach)

### P2 (Medium - polish)
5. ✅ Add parser support for template literals, Windows paths
6. ✅ Emit parseErrors in same round, not next round

---

## Testing Strategy

### Unit Tests
```typescript
// packages/core/src/self-improvement-policy.test.ts
describe('isRepoInternalCdChain - FIXED', () => {
  it('should ALLOW cd to internal subdir', () => {
    const result = isRepoInternalCdChain('cd frontend && npm install', '/project');
    expect(result).toBe(false); // false = allow
  });
  
  it('should BLOCK cd to external dir', () => {
    const result = isRepoInternalCdChain('cd /etc && ls', '/project');
    expect(result).toBe(true); // true = block
  });
});
```

### Integration Test
```typescript
// Replay SettleThis scenario
it('should handle full SettleThis build sequence', async () => {
  // Round 1: Read PRD
  // Round 2: cd frontend && npm install (should work now)
  // Round 3-5: Multiple reads (should not trigger anti-confab)
  // Round 6: Write files (should succeed)
});
```

---

## Implementation Plan

1. **Create fix branch**: `fix/agent-loop-critical-bugs`
2. **Fix in order**:
   - P0.1: `isRepoInternalCdChain` logic + tests
   - P0.2: Command translation helper
   - P1.3: Parser diagnostics
   - P1.4: Anti-confab time-window
3. **Run regression suite**: All existing agent-loop tests must pass
4. **Add new tests**: Coverage for each root cause
5. **Verify SettleThis**: Re-run the build that failed

---

## Success Criteria

- ✅ `cd frontend && npm install` executes successfully
- ✅ Tool parse errors show specific JSON issues
- ✅ Model can do 5+ Read operations without false confab warnings
- ✅ SettleThis build completes in <10 rounds with 0 retry loops

---

## Appendix: Code References

### Files to Modify
1. `packages/core/src/self-improvement-policy.ts` (lines 132-150)
2. `packages/cli/src/tool-call-parser.ts` (lines 140-160, 22-65)
3. `packages/cli/src/agent-loop.ts` (lines 1942-1972)
4. `packages/cli/src/tools.ts` (lines 2219-2227)

### Files to Create
1. `packages/cli/src/command-translator.ts` (new helper)

### Test Files to Update
1. `packages/core/src/self-improvement-policy.test.ts`
2. `packages/cli/src/tool-call-parser.test.ts`
3. `packages/cli/src/agent-loop.test.ts`

---

**Generated by DanteCode Root Cause Analysis**
*Next: Run `/nova` to implement fixes with planning + verification*
