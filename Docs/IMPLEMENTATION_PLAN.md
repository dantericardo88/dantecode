# DanteCode Agent Loop Critical Fixes - Implementation Plan

**Goal**: Fix 4 critical bugs causing agent loop failures
**Branch**: `fix/agent-loop-critical-bugs`
**Estimated Files**: 11 modified, 4 new, ~50 tests added
**Priority**: P0 - Blocks all workflows using cd commands or multi-round planning

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Agent Loop (CLI)                         │
│  ┌────────────────────────────────────────────────────┐    │
│  │ 1. Receive user prompt                              │    │
│  │ 2. Build system prompt + context                    │    │
│  │ 3. Call LLM → get response with tool calls          │    │
│  │ 4. Parse tool calls (tool-call-parser.ts) ←─ FIX 2 │    │
│  │ 5. Execute tools (tools.ts) ←─────────── FIX 1 & 4 │    │
│  │ 6. Check for confabulation ←─────────── FIX 3      │    │
│  │ 7. Add results to message history                   │    │
│  │ 8. Loop until done                                  │    │
│  └────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
              │                    │                    │
              ▼                    ▼                    ▼
    ┌─────────────────┐  ┌──────────────────┐  ┌──────────────┐
    │ Core Policies   │  │ Tool Parser      │  │ Safety       │
    │ (FIX 1)        │  │ (FIX 2)         │  │ (FIX 3)     │
    └─────────────────┘  └──────────────────┘  └──────────────┘
```

---

## Fix 1: `isRepoInternalCdChain` Logic Inversion

### Files Modified
- `packages/core/src/self-improvement-policy.ts` (lines 132-150)
- `packages/core/src/self-improvement-policy.test.ts` (add new tests)

### Changes

#### Before (BROKEN)
```typescript
export function isRepoInternalCdChain(command: string, projectRoot: string): boolean {
  // ...
  return (
    resolvedDestination !== resolve(projectRoot) &&
    (resolvedDestination === resolve(projectRoot) ||
     resolvedDestination.startsWith(`${resolve(projectRoot)}${sep}`))
  );
}
```

**Logic**: Returns `true` (block) for ALL internal subdirs ❌

#### After (FIXED)
```typescript
export function isRepoInternalCdChain(command: string, projectRoot: string): boolean {
  const trimmed = command.trim();
  const match = trimmed.match(/^cd\s+(.+?)\s*&&/i);
  if (!match?.[1]) {
    return false; // Not a cd chain, don't block
  }

  const destination = match[1].trim().replace(/^["']|["']$/g, "");
  
  // Allow cd to current dir
  if (destination === "." || destination === "./") {
    return false;
  }

  const resolvedDestination = resolveProjectPath(destination, projectRoot);
  const rootPath = resolve(projectRoot);

  // Block if destination is OUTSIDE the project root
  // Return true = block, false = allow
  const isInternalPath = 
    resolvedDestination === rootPath ||
    resolvedDestination.startsWith(`${rootPath}${sep}`);
  
  return !isInternalPath; // Invert: block external, allow internal
}
```

**Logic**: Returns `false` (allow) for internal subdirs, `true` (block) for external ✅

### Tests to Add
```typescript
describe('isRepoInternalCdChain - FIXED', () => {
  const projectRoot = '/home/user/project';
  
  it('should ALLOW cd to internal subdir', () => {
    expect(isRepoInternalCdChain('cd frontend && npm install', projectRoot)).toBe(false);
    expect(isRepoInternalCdChain('cd src/lib && npm test', projectRoot)).toBe(false);
  });
  
  it('should ALLOW cd to current dir', () => {
    expect(isRepoInternalCdChain('cd . && npm install', projectRoot)).toBe(false);
    expect(isRepoInternalCdChain('cd ./ && npm test', projectRoot)).toBe(false);
  });
  
  it('should BLOCK cd to external dir', () => {
    expect(isRepoInternalCdChain('cd /etc && cat passwd', projectRoot)).toBe(true);
    expect(isRepoInternalCdChain('cd ../other-repo && rm -rf .', projectRoot)).toBe(true);
  });
  
  it('should NOT block non-cd commands', () => {
    expect(isRepoInternalCdChain('npm install', projectRoot)).toBe(false);
    expect(isRepoInternalCdChain('echo "cd test" && ls', projectRoot)).toBe(false);
  });
});
```

---

## Fix 2: Tool Call Parser Diagnostics

### Files Modified
- `packages/cli/src/tool-call-parser.ts` (lines 140-160, 22-65)
- `packages/cli/src/tool-call-parser.test.ts` (add new tests)
- `packages/cli/src/agent-loop.ts` (emit parseErrors immediately)

### Changes

#### 2A: Return Diagnostic Errors

**Before**
```typescript
export function parseToolCallPayload(payload: string): {...} | null {
  try {
    return JSON.parse(payload);
  } catch {
    try {
      return JSON.parse(escapeLiteralControlCharsInJsonStrings(payload));
    } catch {
      return null; // ❌ No feedback
    }
  }
}
```

**After**
```typescript
export type ParseResult<T> = 
  | { success: true; data: T }
  | { success: false; error: string; context: string };

export function parseToolCallPayload(
  payload: string
): ParseResult<{ name?: string; input?: Record<string, unknown>; dependsOn?: string[] }> {
  // Try raw parse
  try {
    const data = JSON.parse(payload) as {
      name?: string;
      input?: Record<string, unknown>;
      dependsOn?: string[];
    };
    return { success: true, data };
  } catch (e1) {
    // Try with escape fixes
    try {
      const escaped = escapeLiteralControlCharsInJsonStrings(payload);
      const data = JSON.parse(escaped) as {
        name?: string;
        input?: Record<string, unknown>;
        dependsOn?: string[];
      };
      return { success: true, data };
    } catch (e2) {
      // Return detailed error
      const error = e2 instanceof Error ? e2.message : String(e2);
      const context = payload.slice(0, 200);
      return { success: false, error, context };
    }
  }
}
```

#### 2B: Enhance Escape Function

**Add to `escapeLiteralControlCharsInJsonStrings`**:
```typescript
// Handle Windows paths: C:\Users → C:\\Users
if (inString && char === '\\' && !escaping) {
  const next = payload[i + 1];
  // If not already escaping a known sequence, escape the backslash
  if (next && !'nrtbf"\\'.includes(next)) {
    result += '\\\\';
    continue;
  }
}

// Handle unescaped quotes in attribute names (common LLM error)
// "file_path": "don't edit" → "file_path": "don\"t edit"
// This is tricky - need better state tracking
```

#### 2C: Immediate Error Feedback in Agent Loop

**In `agent-loop.ts`, after `extractToolCalls`**:
```typescript
const { cleanText, toolCalls, parseErrors } = extractToolCalls(responseText);

// ✅ NEW: Immediate feedback on parse errors
if (parseErrors.length > 0) {
  const errorDetails = parseErrors.map((err, i) => 
    `Parse error ${i + 1}: ${err.error}\nContext: ${err.context}...`
  ).join('\n\n');
  
  messages.push({
    role: 'user',
    content: `❌ Tool call parsing failed for ${parseErrors.length} block(s):\n\n${errorDetails}\n\nFix the JSON syntax and retry. Common issues:\n- Unescaped quotes: use \\" inside strings\n- Unescaped backslashes: use \\\\ for paths\n- Missing commas between fields\n- Template literals: escape $ as \\$`,
  });
  
  // Continue loop to let model fix
  continue;
}
```

### Tests to Add
```typescript
describe('parseToolCallPayload - Enhanced Diagnostics', () => {
  it('should return success for valid JSON', () => {
    const result = parseToolCallPayload('{"name":"Read","input":{"file_path":"test.ts"}}');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('Read');
    }
  });
  
  it('should return error details for invalid JSON', () => {
    const result = parseToolCallPayload('{"name":"Read","input":{"bad}');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('Unexpected token');
      expect(result.context).toContain('{"name":"Read"');
    }
  });
  
  it('should auto-fix escaped control chars', () => {
    const withNewline = '{"name":"Write","input":{"content":"line1\nline2"}}';
    const result = parseToolCallPayload(withNewline);
    expect(result.success).toBe(true);
  });
  
  it('should auto-fix Windows paths', () => {
    const withPath = '{"input":{"file_path":"C:\\Users\\test.ts"}}';
    const result = parseToolCallPayload(withPath);
    expect(result.success).toBe(true);
  });
});
```

---

## Fix 3: Anti-Confabulation False Positives

### Files Modified
- `packages/cli/src/agent-loop.ts` (lines 1942-1972)
- `packages/cli/src/verification-pipeline.ts` (enhance `extractClaimedFiles`)
- `packages/cli/src/agent-loop.test.ts` (add scenarios)

### Strategy: Time-Window + Action Verb Detection

**Current (BROKEN)**:
- Triggers on ANY file mention in model response
- No distinction between "I will edit foo.ts" vs "I edited foo.ts"
- No grace period for read-heavy planning phases

**Fixed Approach**:
1. **Action verb detection**: Only flag past-tense claims ("Created", "Modified", "Updated")
2. **Time window**: Allow 3 consecutive read-only rounds before flagging
3. **Write quota**: Distinguish exploration (5+ reads, 0 writes) from confabulation

### Changes

```typescript
// NEW: Track rounds without writes
let roundsWithoutWrites = 0;
let consecutiveReadOnlyRounds = 0;

// In agent loop, after tool execution:
if (toolCalls.length > 0) {
  const hasWriteTools = toolCalls.some(tc => 
    tc.name === 'Write' || tc.name === 'Edit' || tc.name === 'GitCommit'
  );
  
  if (hasWriteTools) {
    roundsWithoutWrites = 0;
    consecutiveReadOnlyRounds = 0;
  } else {
    roundsWithoutWrites++;
    consecutiveReadOnlyRounds++;
  }
}

// Modified confabulation check:
if (touchedFiles.length > 0) {
  const lastAssistant = messages.filter((m) => m.role === "assistant").pop();
  if (lastAssistant) {
    // ✅ NEW: Only extract past-tense action claims
    const claimedFiles = extractClaimedFiles(lastAssistant.content, { 
      actionVerbsOnly: true 
    });
    
    if (claimedFiles.length > 0) {
      const actualSet = new Set(touchedFiles.map((f) => f.replace(/\\/g, "/")));
      const unverified = claimedFiles.filter(
        (f: string) => !actualSet.has(f.replace(/\\/g, "/")),
      );
      
      // ✅ NEW: Only flag if multiple rounds without writes AND claims exist
      const shouldFlag = 
        unverified.length > 0 && 
        roundsWithoutWrites >= 3 &&  // Grace period
        consecutiveReadOnlyRounds >= 2;  // Not just one read round
      
      if (shouldFlag) {
        const color = isPipelineWorkflow ? RED : YELLOW;
        const tag = isPipelineWorkflow ? "confab-block" : "confab-diff";
        process.stdout.write(
          `\n${color}[${tag}] Confabulation detected: ${roundsWithoutWrites} rounds without writes, but claimed: ${unverified.join(", ")}${RESET}\n`,
        );
        
        if (isPipelineWorkflow) {
          confabulationNudges++;
          messages.push({
            role: 'user',
            content: CONFABULATION_WARNING,
          });
        }
      }
    }
  }
}
```

**Enhance `extractClaimedFiles`**:
```typescript
export function extractClaimedFiles(
  text: string, 
  options?: { actionVerbsOnly?: boolean }
): string[] {
  const files: string[] = [];
  
  if (options?.actionVerbsOnly) {
    // Only match past-tense action verbs
    const actionPattern = /(?:Created|Modified|Updated|Fixed|Wrote|Edited|Added|Removed|Deleted)\s+`?([a-zA-Z0-9_/-]+\.(?:ts|js|tsx|jsx|json|md|yml|yaml|toml))`?/gi;
    let match;
    while ((match = actionPattern.exec(text)) !== null) {
      if (match[1]) files.push(match[1]);
    }
  } else {
    // Original behavior: extract all file mentions
    const filePattern = /`([a-zA-Z0-9_/-]+\.(?:ts|js|tsx|jsx|json|md|yml|yaml|toml))`/g;
    let match;
    while ((match = filePattern.exec(text)) !== null) {
      if (match[1]) files.push(match[1]);
    }
  }
  
  return [...new Set(files)]; // Dedupe
}
```

### Tests to Add
```typescript
describe('Anti-confabulation - False Positive Prevention', () => {
  it('should NOT flag legitimate read-before-write workflow', async () => {
    // Round 1-2: Read multiple files
    // Round 3: Explain structure (mentions files but no claims)
    // Round 4: Write files
    // Expected: No confabulation warning
  });
  
  it('should flag actual confabulation after grace period', async () => {
    // Round 1-3: Read only
    // Round 4-5: Claims "Modified foo.ts" but no Write tool
    // Expected: Confabulation warning after round 5
  });
  
  it('should distinguish action verbs from mentions', () => {
    const planning = "I will edit foo.ts next round";
    const claim = "Modified foo.ts to add logging";
    
    expect(extractClaimedFiles(planning, { actionVerbsOnly: true })).toEqual([]);
    expect(extractClaimedFiles(claim, { actionVerbsOnly: true })).toEqual(['foo.ts']);
  });
});
```

---

## Fix 4: Command Translation Suggestions

### Files to Create
- `packages/cli/src/command-translator.ts` (new)
- `packages/cli/src/command-translator.test.ts` (new)

### Files Modified
- `packages/cli/src/tools.ts` (lines 2219-2227)

### Implementation

**New file: `command-translator.ts`**
```typescript
/**
 * Translates blocked `cd ... &&` commands to equivalent single-command forms
 * that execute from the repo root.
 */

export interface TranslationResult {
  suggested: string;
  explanation: string;
  confidence: 'high' | 'medium' | 'low';
}

export function translateCdCommand(command: string): TranslationResult {
  const match = command.match(/^cd\s+(.+?)\s*&&\s*(.+)$/);
  if (!match) {
    return {
      suggested: command,
      explanation: 'Not a cd chain command',
      confidence: 'low',
    };
  }

  const [, dir, rest] = match;
  const cleanDir = dir.trim().replace(/^["']|["']$/g, '');
  const cleanRest = rest.trim();

  // npm commands
  if (cleanRest.startsWith('npm ')) {
    return {
      suggested: `npm --prefix ${cleanDir} ${cleanRest.slice(4)}`,
      explanation: 'npm --prefix runs the command in the specified directory',
      confidence: 'high',
    };
  }

  // pnpm commands
  if (cleanRest.startsWith('pnpm ')) {
    return {
      suggested: `pnpm -C ${cleanDir} ${cleanRest.slice(5)}`,
      explanation: 'pnpm -C changes directory before executing',
      confidence: 'high',
    };
  }

  // yarn commands
  if (cleanRest.startsWith('yarn ')) {
    return {
      suggested: `yarn --cwd ${cleanDir} ${cleanRest.slice(5)}`,
      explanation: 'yarn --cwd specifies the working directory',
      confidence: 'high',
    };
  }

  // turbo commands
  if (cleanRest.startsWith('turbo ')) {
    return {
      suggested: `turbo ${cleanRest.slice(6)} --cwd ${cleanDir}`,
      explanation: 'turbo --cwd runs in the specified directory',
      confidence: 'high',
    };
  }

  // Generic: use subshell (works for any command)
  return {
    suggested: `(cd ${cleanDir} && ${cleanRest})`,
    explanation: 'Subshell ( ) executes in a separate process, returns to original directory after',
    confidence: 'medium',
  };
}
```

**Modified: `tools.ts` error message**
```typescript
if (name === "Bash") {
  const command = input["command"] as string | undefined;
  if (command && isRepoInternalCdChain(command, projectRoot)) {
    // ✅ NEW: Provide translation
    const translation = translateCdCommand(command);
    
    return {
      content:
        `Error: Chaining 'cd ... &&' is blocked to ensure consistent audit paths.\n\n` +
        `❌ Blocked command:\n  ${command}\n\n` +
        `✅ Suggested alternative (${translation.confidence} confidence):\n  ${translation.suggested}\n\n` +
        `💡 Explanation: ${translation.explanation}\n\n` +
        `This runs the command from the repo root while targeting the subdirectory.`,
      isError: true,
    };
  }
}
```

### Tests to Add
```typescript
describe('translateCdCommand', () => {
  it('should translate npm commands', () => {
    const result = translateCdCommand('cd frontend && npm install');
    expect(result.suggested).toBe('npm --prefix frontend install');
    expect(result.confidence).toBe('high');
  });

  it('should translate pnpm commands', () => {
    const result = translateCdCommand('cd packages/cli && pnpm test');
    expect(result.suggested).toBe('pnpm -C packages/cli test');
  });

  it('should use subshell for generic commands', () => {
    const result = translateCdCommand('cd dist && ls -la');
    expect(result.suggested).toBe('(cd dist && ls -la)');
    expect(result.confidence).toBe('medium');
  });
});
```

---

## Testing Strategy

### Unit Tests (Per Fix)
- ✅ Fix 1: 6 tests for `isRepoInternalCdChain`
- ✅ Fix 2: 8 tests for parser diagnostics
- ✅ Fix 3: 5 tests for confabulation detection
- ✅ Fix 4: 6 tests for command translation

**Total: ~25 new unit tests**

### Integration Tests

**Test Suite: `agent-loop-fixes.integration.test.ts`**
```typescript
describe('Agent Loop Fixes - Integration', () => {
  it('Fix 1: should execute cd frontend && npm install', async () => {
    // Mock LLM returns Bash tool with cd command
    // Verify: tool executes successfully, no block error
  });

  it('Fix 2: should provide parse error feedback', async () => {
    // Mock LLM returns malformed JSON tool call
    // Verify: model receives specific error message
  });

  it('Fix 3: should allow read-heavy planning phase', async () => {
    // Mock LLM: 3 rounds of Read tools, 1 round of Write
    // Verify: no confabulation warning
  });

  it('Fix 4: should suggest npm --prefix alternative', async () => {
    // Mock LLM: cd frontend && npm test
    // Verify: error message contains "npm --prefix frontend test"
  });

  it('SettleThis scenario replay', async () => {
    // Replay exact SettleThis conversation
    // Verify: completes in <10 rounds, 0 retry loops
  });
});
```

### Regression Tests
- ✅ Run full existing test suite: `npm test`
- ✅ Ensure 0 failures introduced by changes
- ✅ Check coverage doesn't drop below 80%

---

## File Modification Summary

### Modified Files (7)
1. `packages/core/src/self-improvement-policy.ts` - Fix 1
2. `packages/core/src/self-improvement-policy.test.ts` - Fix 1 tests
3. `packages/cli/src/tool-call-parser.ts` - Fix 2
4. `packages/cli/src/tool-call-parser.test.ts` - Fix 2 tests
5. `packages/cli/src/agent-loop.ts` - Fix 2 & 3
6. `packages/cli/src/agent-loop.test.ts` - Fix 3 tests
7. `packages/cli/src/tools.ts` - Fix 4

### New Files (4)
8. `packages/cli/src/command-translator.ts` - Fix 4 impl
9. `packages/cli/src/command-translator.test.ts` - Fix 4 tests
10. `packages/cli/src/agent-loop-fixes.integration.test.ts` - Integration tests
11. `Docs/DANTECODE_ROOT_CAUSE_ANALYSIS.md` - Already created ✅

---

## Success Criteria

### Functional Requirements
- ✅ `cd frontend && npm install` executes successfully
- ✅ Tool parse errors show specific JSON syntax issues
- ✅ Model can do 5+ Read operations without false confab warnings
- ✅ Blocked cd commands receive actionable translation suggestions

### Quality Gates
- ✅ All new unit tests pass (25+)
- ✅ All integration tests pass (5)
- ✅ Zero regressions in existing 400+ tests
- ✅ TypeScript builds clean: `npm run typecheck`
- ✅ Linter passes: `npm run lint`
- ✅ Code coverage ≥ 80%

### Performance
- ✅ No measurable slowdown in agent loop latency
- ✅ Parser changes add <5ms per round

### Documentation
- ✅ Root cause analysis complete
- ✅ Implementation plan complete
- ✅ MEMORY.md updated with lessons
- ✅ UPR.md synthesized

---

## Execution Phases

### Phase 1: Implement Fixes (Estimated: 2-3 hours)
1. Fix 1: `isRepoInternalCdChain` + tests → 30 min
2. Fix 2: Parser diagnostics + tests → 45 min
3. Fix 3: Anti-confab refinement + tests → 45 min
4. Fix 4: Command translator + tests → 30 min
5. Integration tests → 30 min

### Phase 2: Verification (Estimated: 30 min)
1. Run unit tests: `npm test`
2. Run typecheck: `npm run typecheck`
3. Run lint: `npm run lint`
4. Check coverage report
5. Manual smoke test with SettleThis scenario

### Phase 3: Synthesis (Estimated: 15 min)
1. Update MEMORY.md with lessons
2. Generate UPR.md
3. Create final summary report

---

## Risk Mitigation

### Risk 1: Breaking Existing Workflows
**Mitigation**: Comprehensive regression testing + gradual rollout via feature flag

### Risk 2: Parser Changes Too Aggressive
**Mitigation**: Fallback to original behavior if enhanced parsing fails

### Risk 3: Anti-Confab Too Permissive
**Mitigation**: Keep logging even when not blocking, monitor for real confabulation

### Risk 4: Command Translation Edge Cases
**Mitigation**: Conservative suggestions (medium/low confidence → generic subshell)

---

**Ready to execute. Starting Phase 1: Implementation...**
