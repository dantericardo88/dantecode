# CLI Typecheck Compliance Plan

**Goal:** Fix all 56 CLI package typecheck errors to achieve full gate compliance

**Status:** Phase 1 of Blade Master Plan (Truth Surface Restoration) - Final 5%

**Priority:** HIGH - Blocking full green gates and may indicate integration issues

---

## Architecture Overview

### Problem Analysis

The CLI package has 56 typecheck errors across 3 categories:

1. **API Drift** (35 errors) - Recent package changes not reflected in CLI
2. **Type Safety** (15 errors) - Missing type annotations and declarations
3. **Import Issues** (6 errors) - Missing exports or type declarations

### Root Causes

1. **DanteSandbox refactoring** - API changed but CLI not updated
2. **Skills system evolution** - SkillCatalog API changed
3. **Function signature changes** - Agent-loop, sandbox-bridge parameter mismatches
4. **Missing type packages** - glob types not installed

### Impact Assessment

- **Blocking:** Full green gates (engineering maturity)
- **Risk:** May indicate runtime issues if types reflect actual API changes
- **Confidence:** Integration between packages may be broken

---

## Implementation Phases

### Phase 1: DanteSandbox API Alignment [M effort, 2-3 hours]

**Problem:** 15+ errors related to DanteSandbox missing exports and properties

**Files:**
- `src/slash-commands.ts` - 11 `setMode` errors, 1 `status` error
- `src/tools.ts` - Missing `toToolResult`, `isReady`

**Tasks:**
1. **Check DanteSandbox actual API** (S)
   - Read `packages/dante-sandbox/src/index.ts`
   - Identify actual exports and API surface
   - Document what's available vs what CLI expects

2. **Fix missing exports** (M)
   - Add `globalApprovalEngine` export if it exists
   - Add `toToolResult` export if it exists
   - OR remove usage if features don't exist

3. **Fix DanteSandbox.setMode calls** (M)
   - 11 instances in slash-commands.ts
   - Check if `setMode` is static method or instance method
   - Update all call sites consistently

4. **Fix DanteSandbox.status access** (S)
   - Line 3835: Property 'status' doesn't exist
   - Check actual API for status checking

5. **Fix DanteSandbox.isReady check** (S)
   - tools.ts line 485
   - Verify correct property name

**Success Criteria:**
- All DanteSandbox-related errors resolved
- No runtime breaks (existing functionality preserved)
- API usage matches actual dante-sandbox exports

---

### Phase 2: Skills API Modernization [M effort, 2-3 hours]

**Problem:** 15+ errors related to Skills system API changes

**Files:**
- `src/commands/skills.ts` - 13 errors
- `src/slash-commands.ts` - 3 errors
- `src/serve/routes.ts` - 3 errors

**Error Categories:**
1. **Wrong argument counts** (7 errors) - Functions expecting different signatures
2. **Missing properties** (6 errors) - `bucket`, `conversionScore`, `runtimeWarnings`, `getAll`
3. **Wrong argument types** (5 errors) - Objects passed where strings expected

**Tasks:**
1. **Audit SkillCatalog API** (S)
   - Read `packages/skills-registry/src/index.ts`
   - Check `getAll()` method existence
   - Document current API surface

2. **Fix importSkills signature** (M)
   - Lines 565, 767, 790: Expected 1 arg, got 2
   - Lines 625, 834, 1036, 1468: Wrong object types
   - Update to match actual signature

3. **Fix SkillCatalog.getAll** (S)
   - Lines 868, 871, 3210, 3212
   - Add method or use alternative API

4. **Fix bridge metadata access** (M)
   - Lines 771, 775, 778, 781, 783, 785
   - Properties: `bucket`, `conversionScore`, `runtimeWarnings`
   - Check if these exist on return type
   - Add type guards if needed

**Success Criteria:**
- All skills command typecheck passes
- Import/export/list/convert commands work
- Bridge metadata accessible

---

### Phase 3: Function Signature Alignment [S effort, 1-2 hours]

**Problem:** 8 errors related to argument count mismatches

**Files:**
- `src/agent-loop.ts` - 2 errors (lines 1829, 2072)
- `src/commands/council.ts` - 4 errors (lines 315, 682, 881, 1070)
- `src/sandbox-bridge.ts` - 2 errors (lines 65, 86)
- `src/slash-commands.ts` - 2 errors (lines 4530, 4772)

**Tasks:**
1. **Fix agent-loop calls** (S) [P]
   - Lines 1829, 2072: Expected 2-3 args, got 4
   - Identify function being called
   - Adjust arguments to match signature

2. **Fix council worktree hooks** (M) [P]
   - Lines 315, 682, 881, 1070
   - WorktreeHooks type mismatch
   - Function has 3 params, interface expects 2
   - Align function signature or update type

3. **Fix sandbox-bridge calls** (S) [P]
   - Line 65: Expected 0 args, got 2
   - Line 86: Property 'run' doesn't exist
   - Check SandboxExecutor/LocalExecutor API
   - Update to match actual interface

4. **Fix slash-commands calls** (S) [P]
   - Lines 4530, 4772: Expected 2-3 args, got 4
   - Same issue as agent-loop
   - Consistent fix

**Success Criteria:**
- All function calls match signatures
- No argument count errors
- Runtime behavior preserved

---

### Phase 4: Type Safety & Imports [S effort, 1 hour]

**Problem:** 12 errors related to types and imports

**Files:**
- `src/slash-commands.ts` - 5 errors
- `src/history-command.test.ts` - 1 error
- `src/serve/routes.ts` - 2 errors

**Tasks:**
1. **Install missing type packages** (S) [P]
   - Lines 1867, 7364: Could not find declaration for 'glob'
   - `npm install --save-dev @types/glob`
   - Verify import resolves

2. **Add missing type annotations** (S) [P]
   - Line 3669: Parameter 'r' implicitly 'any'
   - Line 3687: Parameter 'm' implicitly 'any'
   - Line 1584: Unused 'command' variable
   - Add explicit types or remove unused vars

3. **Fix StoredEvent.timestamp** (S)
   - Line 2425: Property 'timestamp' doesn't exist
   - Check RuntimeEventKindSchema for correct property
   - Update to use actual property name

4. **Fix ReplState type mismatch** (M)
   - history-command.test.ts line 124
   - Large type mismatch in test fixture
   - Update fixture to match current ReplState interface

5. **Fix HelpCategory enum** (S)
   - Line 8830: "quality" not assignable
   - Check valid HelpCategory values
   - Use correct enum value

6. **Fix SkillCatalog Promise type** (S)
   - serve/routes.ts lines 758, 759, 764, 787
   - Type mismatch in promise return
   - Align types consistently

**Success Criteria:**
- All imports resolve
- No implicit 'any' types
- Test fixtures match current interfaces
- Enum values valid

---

## Technology Decisions

### Approach

**Conservative fixes** - Align CLI to current package APIs without changing core packages
- Rationale: Core packages are passing typecheck, CLI needs to catch up
- Risk: Low - we're fixing drift, not introducing changes

**No `any` escapes** - Fix types properly, don't use `as any`
- Rationale: Constitution forbids `as any` (hard violation)
- Benefit: Maintains type safety

**Test after each phase** - Run typecheck between phases
- Rationale: Early detection of cascading issues
- Command: `cd packages/cli && npx tsc --noEmit`

### Dependencies

- `@types/glob` (install via npm)
- No new runtime dependencies

### Constraints

- **Must not break runtime** - These are type errors, code may work
- **Must honor Constitution** - No `as any`, no stubs
- **Must preserve git history** - Commit after each phase

---

## Risk Mitigation

### Risk 1: API changes break runtime

**Probability:** Medium
**Impact:** High
**Mitigation:**
- Read actual package exports before fixing
- Test critical paths after fixes (skills import, council, sandbox)
- Keep git commits granular for easy revert

### Risk 2: Cascading type errors

**Probability:** Medium
**Impact:** Medium
**Mitigation:**
- Fix by category (DanteSandbox, Skills, Functions, Types)
- Run typecheck after each phase
- Don't proceed if errors multiply

### Risk 3: Missing functionality

**Probability:** Low
**Impact:** High
**Mitigation:**
- If exports truly missing, check if features half-implemented
- Document incomplete features vs fix attempts
- Escalate if APIs genuinely broken

---

## File-Level Change Map

### High-Impact Files (>5 errors each)

| File | Errors | Category | Risk |
|------|--------|----------|------|
| `src/slash-commands.ts` | 23 | DanteSandbox + Skills + Types | Medium |
| `src/commands/skills.ts` | 13 | Skills API | Low |
| `src/commands/council.ts` | 4 | Function signatures | Low |
| `src/serve/routes.ts` | 4 | Skills + Types | Low |
| `src/agent-loop.ts` | 2 | Function signatures | Medium |
| `src/tools.ts` | 3 | DanteSandbox | Medium |
| `src/sandbox-bridge.ts` | 2 | Function signatures | Low |
| `src/history-command.test.ts` | 1 | Type fixture | Low |

### Change Strategy

**Phase 1:** Focus on slash-commands.ts DanteSandbox errors (11 errors)
**Phase 2:** Fix skills.ts Skills API errors (13 errors)
**Phase 3:** Fix all function signature errors (8 errors)
**Phase 4:** Cleanup types, imports, tests (12 errors)

---

## Success Metrics

### Definition of Done

✅ **Zero typecheck errors** in CLI package
✅ **All CI gates green** (build, typecheck, lint, test)
✅ **No runtime regressions** - Critical commands still work
✅ **No Constitution violations** - No `as any`, no stubs
✅ **Commits are atomic** - One phase per commit

### Validation Commands

```bash
# After each phase
cd packages/cli && npx tsc --noEmit

# Final validation
npm run typecheck  # All packages
npm test -- packages/cli  # CLI tests
npm run lint -- packages/cli  # Lint check
```

### Acceptance Criteria

1. `npm run typecheck` passes for CLI
2. CLI commands functional (manual smoke test):
   - `dantecode --help`
   - `dantecode skills list`
   - `dantecode --sandbox-mode docker echo test`
3. No new errors in other packages
4. Git history is clean (no WIP commits)

---

## Effort Estimates

| Phase | Complexity | Time | Parallelizable |
|-------|------------|------|----------------|
| Phase 1: DanteSandbox | M | 2-3h | Partially |
| Phase 2: Skills | M | 2-3h | Partially |
| Phase 3: Signatures | S | 1-2h | Yes [P] |
| Phase 4: Types | S | 1h | Yes [P] |
| **Total** | **M** | **6-9h** | **50%** |

### Parallelization Strategy

- Phase 3 & 4 tasks marked [P] can run in parallel
- Phases 1 & 2 have some independent tasks
- Conservative estimate: 6-9 hours serial, 5-7 hours parallel

---

## Next Steps

1. **Execute Phase 1** - Fix DanteSandbox API drift
2. **Run typecheck** - Verify progress (56 → ~40 errors expected)
3. **Execute Phase 2** - Fix Skills API drift
4. **Run typecheck** - Verify progress (~40 → ~25 errors expected)
5. **Execute Phase 3** - Fix function signatures
6. **Run typecheck** - Verify progress (~25 → ~15 errors expected)
7. **Execute Phase 4** - Fix types and imports
8. **Final validation** - Zero errors, all tests pass
9. **Commit with message** - "fix(cli): resolve 56 typecheck errors - full gate compliance"

---

## References

- SPEC.md - Package responsibilities and architecture
- CONSTITUTION.md - Hard rules (no `as any`, no stubs)
- Current typecheck errors: 56 total
- Target: 0 errors (full green gates)
- Related: Blade Master Plan Phase 1 (Truth Surface Restoration)
