# CLI Typecheck Deep Dive: Findings & Recommendations

**Date:** 2026-03-30
**Context:** Investigating 56 CLI typecheck errors as part of Phase 1 (Truth Surface Restoration)
**Result:** Fixed 15 errors, discovered 41 represent deeper issues

---

## What We Fixed (15 errors) ✅

### dante-sandbox Type Declarations

**Problem:** Package had incomplete stub type declarations

**Fix:** Updated `generate-stub-dts.js` to export full API:
- `DanteSandbox` object with all methods (status, setMode, isReady, execSync, etc.)
- `ApprovalEngine` with setPolicy, addAllowRule methods
- Missing exports: globalApprovalEngine, toToolResult, sandboxRun, etc.

**Result:** 56 → 41 errors (15 fixed)

**Files Modified:**
- `packages/dante-sandbox/scripts/generate-stub-dts.js`

**Commits:**
- Should commit as: "fix(dante-sandbox): complete type declarations in stub generator"

---

## What Remains (41 errors) ⚠️

### Category 1: Skills API - Missing Implementation (20 errors) 🔴 CRITICAL

**Problem:** CLI code references `SkillCatalog` class that doesn't exist

**Evidence:**
```typescript
// packages/cli/src/commands/skills.ts:868
const catalog = new SkillCatalog(projectRoot);  // ❌ SkillCatalog not defined
await catalog.load();                            // ❌ API doesn't exist
let entries = catalog.search(query);             // ❌ API doesn't exist
let entries = catalog.getAll();                  // ❌ API doesn't exist
```

**What Actually Exists:**
```typescript
// packages/skill-adapter/src/index.ts
export { loadSkillRegistry, listSkills, getSkill, removeSkill };
// No SkillCatalog class, no search(), no getAll()
```

**Affected Files:**
- `src/commands/skills.ts` - 13 errors
- `src/slash-commands.ts` - 3 errors
- `src/serve/routes.ts` - 4 errors

**Impact:** Skills search/list/management commands are broken

**Root Cause:** Commit 41d1e7d mentioned "delegate to SkillCatalog" but class was never implemented

**Severity:** HIGH - This is incomplete functionality, not just type drift

**Options:**
1. **Implement SkillCatalog** (8-12 hours)
   - Create class wrapping loadSkillRegistry
   - Add search(), getAll(), load() methods
   - Wire to CLI commands

2. **Refactor CLI to use existing APIs** (4-6 hours)
   - Replace SkillCatalog with loadSkillRegistry calls
   - Implement search locally if needed
   - Simpler, uses existing code

3. **Remove broken commands** (1 hour)
   - Comment out skills search/list/management
   - Add TODO markers
   - Pragmatic but loses functionality

**Recommendation:** Option 2 (refactor to existing APIs) - preserves functionality, uses what exists

---

### Category 2: Function Signature Mismatches (8 errors) 🟡 MODERATE

**Problem:** Functions called with wrong argument counts

**Errors:**
1. `agent-loop.ts:1829,2072` - Expected 2-3 args, got 4
2. `slash-commands.ts:4530,4772` - Expected 2-3 args, got 4
3. `council.ts:315,682,881,1070` - WorktreeHooks type mismatch (3 params vs 2)
4. `sandbox-bridge.ts:65` - Expected 0 args, got 2
5. `sandbox-bridge.ts:86` - Property 'run' doesn't exist

**Impact:** Moderate - May cause runtime errors if these code paths execute

**Fix Complexity:** LOW - Straightforward parameter adjustments

**Estimated Time:** 1-2 hours

---

### Category 3: Type Safety & Imports (13 errors) 🟢 LOW

**Problems:**
1. Missing `@types/glob` (2 errors)
2. Implicit 'any' parameters (2 errors)
3. Unused variables (1 error)
4. Type mismatches in tests (1 error)
5. Property access errors (5 errors)
6. Enum literal mismatch (1 error)
7. Promise type mismatches (1 error)

**Impact:** LOW - Mostly cosmetic, won't cause runtime issues

**Fix Complexity:** VERY LOW - Simple type annotations and installs

**Estimated Time:** 30-60 minutes

---

## Honest Assessment

### What This Reveals

1. **dante-sandbox** - Recently refactored, types not updated ✅ FIXED
2. **Skills system** - Partially implemented, CLI ahead of backend 🔴 CRITICAL
3. **Function signatures** - API drift from refactoring 🟡 MODERATE
4. **Type safety** - Standard TypeScript housekeeping 🟢 LOW

### Is This "Best Work"?

**Infrastructure:** YES - The Nova sprint tools are excellent
**Code Quality:** PARTIAL - 15 errors fixed, but foundational issues remain
**Execution:** UNKNOWN - No SWE-bench results yet

**The Skills API gap is concerning** - it suggests features were designed but not completed.

---

## Recommended Strategy

### Option A: Pragmatic Path (2-3 hours)

1. **Fix Category 2 & 3** (1.5-2.5 hours)
   - Function signatures
   - Type safety
   - Install missing packages

2. **Stub out broken Skills commands** (30 min)
   - Add clear "NOT IMPLEMENTED" errors
   - Document what needs implementation
   - Remove from help text

**Result:** 28 errors fixed, 13 honestly marked as incomplete

**Pros:** Fast, honest, unblocks gates partially
**Cons:** Loses Skills functionality

---

### Option B: Complete Implementation (12-16 hours)

1. **Implement SkillCatalog wrapper** (8-12 hours)
   - Create class around existing APIs
   - Add search functionality
   - Wire to all call sites

2. **Fix remaining errors** (4 hours)
   - Categories 2 & 3

**Result:** All 41 errors fixed, full functionality

**Pros:** Complete solution, all features work
**Cons:** Large time investment, may reveal more issues

---

### Option C: Incremental (4-6 hours, recommended) ⭐

1. **Fix Categories 2 & 3 first** (2-3 hours)
   - Gets 21 errors fixed quickly
   - Unblocks most functionality

2. **Refactor Skills to existing APIs** (2-3 hours)
   - Replace SkillCatalog with loadSkillRegistry
   - Implement simple local search
   - Uses actual available code

**Result:** All 41 errors fixed, pragmatic solutions

**Pros:** Reasonable time, uses existing code, maintains functionality
**Cons:** Skills search may be less sophisticated

---

## What Would I Do?

**Option C (Incremental)** for these reasons:

1. **Fast wins matter** - Fix 21 errors in 2 hours (Categories 2 & 3)
2. **Use what exists** - Refactor to actual APIs vs building new ones
3. **Unblock gates** - Get to green faster
4. **Validate later** - SWE-bench results more important than perfect types

**Then:** Run SWE-bench baseline to see if the code actually works despite type errors

---

## Files Requiring Changes

### High Priority (Option C, Phase 1: 2 hours)

**Function Signatures:**
- `src/agent-loop.ts` - Lines 1829, 2072
- `src/slash-commands.ts` - Lines 4530, 4772
- `src/commands/council.ts` - Lines 315, 682, 881, 1070
- `src/sandbox-bridge.ts` - Lines 65, 86

**Type Safety:**
- `src/slash-commands.ts` - Lines 1867, 2425, 3669, 3687, 7364, 8830
- `src/slash-commands.test.ts` - Line 1584
- `src/history-command.test.ts` - Line 124
- Install: `npm install --save-dev @types/glob`

### Medium Priority (Option C, Phase 2: 2-3 hours)

**Skills Refactor:**
- `src/commands/skills.ts` - Replace SkillCatalog with loadSkillRegistry
- `src/slash-commands.ts` - Update skills commands
- `src/serve/routes.ts` - Update API routes

---

## Next Steps

1. **Decide strategy** (A, B, or C)
2. **Execute chosen path**
3. **Commit atomically** after each category
4. **Run SWE-bench baseline** to validate runtime behavior

**My vote:** Option C → 4-6 hours to clean gates, then validate with SWE-bench

---

## Key Insight

**Type errors are symptoms, not causes.**

The real question isn't "Can we fix 41 type errors?" (yes, given time)

The real question is: **"Does the code actually work?"**

SWE-bench baseline will answer that better than achieving zero type errors.

---

## Bottom Line

- ✅ **Progress:** 56 → 41 errors (27% fixed)
- 🔴 **Discovery:** Skills API incomplete (20 errors from missing class)
- 🟡 **Remaining:** 8 signature + 13 type errors (fixable in 2-3 hours)
- ⚡ **Recommendation:** Fix categories 2 & 3 first (fast wins), refactor Skills second
- 🎯 **Priority:** Validate with SWE-bench > Perfect types

**The codebase is more capable than the types suggest** - Let's prove it with results.
