# Wave 3 Implementation Plan: Context & Skills

**Status:** Planning
**Date:** 2026-03-28
**Estimated Duration:** 2 weeks (12 working days)
**Gaps Closed:** A5 + A6

---

## Task Breakdown

### Task 3.1: Tree-Sitter Repo Map Upgrade (P0 - 3 days)

**Objective:** Replace regex-based symbol extraction with tree-sitter for precision

**Current state:**
- `packages/core/src/repo-map.ts` uses regex for symbol extraction
- Works but misses nested symbols and has false positives
- PageRank scoring already exists

**Implementation:**

1. Install tree-sitter dependencies:
```bash
npm install --workspace=packages/core tree-sitter tree-sitter-typescript tree-sitter-python tree-sitter-javascript tree-sitter-go tree-sitter-rust
```

2. Create `packages/core/src/repo-map-tree-sitter.ts`:
```typescript
export interface TreeSitterParser {
  language: string;
  parse(source: string): TreeNode;
  extractSymbols(tree: TreeNode): Symbol[];
}

export class TypeScriptParser implements TreeSitterParser {
  // Uses tree-sitter-typescript
  // Extracts: classes, interfaces, functions, types, enums
}

export class PythonParser implements TreeSitterParser {
  // Uses tree-sitter-python
  // Extracts: classes, functions, imports, decorators
}

// Similar for JavaScript, Go, Rust
```

3. Extend `RepoMapAST` class:
```typescript
export class RepoMapAST {
  private parsers: Map<string, TreeSitterParser> = new Map();

  constructor() {
    this.parsers.set('.ts', new TypeScriptParser());
    this.parsers.set('.tsx', new TypeScriptParser());
    this.parsers.set('.js', new JavaScriptParser());
    this.parsers.set('.jsx', new JavaScriptParser());
    this.parsers.set('.py', new PythonParser());
    this.parsers.set('.go', new GoParser());
    this.parsers.set('.rs', new RustParser());
  }

  async extractSymbols(filePath: string, source: string): Promise<Symbol[]> {
    const ext = path.extname(filePath);
    const parser = this.parsers.get(ext);

    if (parser) {
      try {
        return parser.extractSymbols(parser.parse(source));
      } catch (err) {
        // Fallback to regex on parse error
        return this.extractSymbolsRegex(source);
      }
    }

    // Fallback for unsupported languages
    return this.extractSymbolsRegex(source);
  }
}
```

4. Wire into `buildRepoMap()`:
   - Replace regex extraction with tree-sitter extraction
   - Keep regex fallback for unsupported files
   - Preserve existing PageRank scoring
   - Benchmark: <500ms for 1000-file repo

5. Write 40 tests:
   - TypeScript parsing (10 tests)
   - Python parsing (8 tests)
   - JavaScript parsing (6 tests)
   - Go parsing (4 tests)
   - Rust parsing (4 tests)
   - Fallback logic (4 tests)
   - Performance benchmarks (4 tests)

**Files created:**
- `packages/core/src/repo-map-tree-sitter.ts`
- `packages/core/src/repo-map-tree-sitter.test.ts`
- `packages/core/src/parsers/typescript-parser.ts`
- `packages/core/src/parsers/python-parser.ts`
- `packages/core/src/parsers/javascript-parser.ts`
- `packages/core/src/parsers/go-parser.ts`
- `packages/core/src/parsers/rust-parser.ts`

**Files modified:**
- `packages/core/src/repo-map.ts`
- `packages/core/package.json` (add tree-sitter deps)
- `packages/core/src/index.ts` (exports)

**Success criteria:**
- 40/40 tests passing
- Tree-sitter coverage >80% (5 languages)
- Repo map speed <500ms for 1000 files
- Zero regressions (fallback preserves old behavior)

---

### Task 3.2: Background Semantic Index (P0 - 3 days)

**Objective:** Build asynchronous semantic index with readiness gauge

**Pattern source:** KiloCode codebase indexing with background workers

**Implementation:**

1. Create `packages/core/src/semantic-index.ts`:
```typescript
export interface SemanticIndex {
  start(): Promise<void>;
  stop(): Promise<void>;
  search(query: string, limit?: number): Promise<IndexEntry[]>;
  getReadiness(): IndexReadiness;
}

export interface IndexReadiness {
  status: 'indexing' | 'ready' | 'error';
  progress: number; // 0-100
  filesIndexed: number;
  totalFiles: number;
  error?: string;
}

export class BackgroundSemanticIndex implements SemanticIndex {
  private worker: Worker;
  private readiness: IndexReadiness;

  async start(): Promise<void> {
    // Spawn worker thread
    // Start indexing in background
    // Update readiness as files are processed
  }

  async search(query: string, limit = 10): Promise<IndexEntry[]> {
    // Fast keyword search if index incomplete
    // Semantic search when index ready
  }
}
```

2. Index storage format (JSONL):
```jsonl
{"path":"src/index.ts","symbols":["main","App"],"imports":["react"],"keywords":["export","default"]}
{"path":"src/app.tsx","symbols":["App","render"],"imports":["react"],"keywords":["component","jsx"]}
```

3. Wire into agent-loop startup:
```typescript
// In repl.ts startup
const semanticIndex = new BackgroundSemanticIndex(projectRoot);
await semanticIndex.start(); // Non-blocking, returns immediately
replState.semanticIndex = semanticIndex;
```

4. Add readiness to status bar:
```typescript
// In status-bar.ts
const indexReadiness = replState.semanticIndex?.getReadiness();
const indexBadge = indexReadiness?.status === 'ready'
  ? '[idx: ✓]'
  : `[idx: ${indexReadiness?.progress ?? 0}%]`;
```

5. Write 35 tests:
   - Index building (10 tests)
   - Search (keyword + semantic) (12 tests)
   - Readiness tracking (5 tests)
   - Worker lifecycle (4 tests)
   - Error handling (4 tests)

**Files created:**
- `packages/core/src/semantic-index.ts`
- `packages/core/src/semantic-index.test.ts`
- `packages/core/src/semantic-index-worker.ts`

**Files modified:**
- `packages/cli/src/repl.ts`
- `packages/ux-polish/src/surfaces/status-bar.ts`
- `packages/core/src/index.ts` (exports)

**Success criteria:**
- 35/35 tests passing
- Index builds in background (non-blocking startup)
- Readiness gauge visible in status bar
- Search works with partial index

---

### Task 3.3: Context Condensing (P1 - 2 days)

**Objective:** Condense context when pressure exceeds 80%

**Pattern source:** KiloCode context management

**Implementation:**

1. Create `packages/core/src/context-condenser.ts`:
```typescript
export interface ContextPressure {
  usedTokens: number;
  maxTokens: number;
  percent: number;
  status: 'green' | 'yellow' | 'red';
}

export function calculatePressure(messages: Message[], maxTokens: number): ContextPressure {
  const usedTokens = messages.reduce((sum, m) => sum + estimateTokens(m), 0);
  const percent = (usedTokens / maxTokens) * 100;

  return {
    usedTokens,
    maxTokens,
    percent,
    status: percent > 80 ? 'red' : percent > 50 ? 'yellow' : 'green'
  };
}

export async function condenseContext(messages: Message[], targetPercent = 50): Promise<Message[]> {
  // Keep: system prompt, last 3 rounds, all receipts, file paths
  // Condense: middle rounds into summaries
  // Use cheap model (haiku) for summarization

  const keep = [
    messages[0], // system
    ...messages.slice(-6) // last 3 rounds (user + assistant)
  ];

  const toCondense = messages.slice(1, -6);
  const summary = await summarizeRounds(toCondense);

  return [messages[0], summary, ...keep];
}
```

2. Wire into agent-loop:
```typescript
// Before each model call
const pressure = calculatePressure(messages, contextWindow);

if (pressure.status === 'red') {
  logger.warn(`Context pressure: ${pressure.percent}% - condensing...`);
  messages = await condenseContext(messages);
}
```

3. Add pressure to status bar:
```typescript
// In status-bar.ts
const pressure = calculateContextPressure(replState);
const pressureBadge = `[ctx: ${pressure.percent}%]`;
// Color: green <50%, yellow 50-80%, red >80%
```

4. Write 25 tests:
   - Pressure calculation (8 tests)
   - Condensing logic (10 tests)
   - Status bar display (4 tests)
   - Edge cases (3 tests)

**Files created:**
- `packages/core/src/context-condenser.ts`
- `packages/core/src/context-condenser.test.ts`

**Files modified:**
- `packages/cli/src/agent-loop.ts`
- `packages/ux-polish/src/surfaces/status-bar.ts`
- `packages/core/src/index.ts` (exports)

**Success criteria:**
- 25/25 tests passing
- Condensing triggers at >80% pressure
- Context size reduced to <50% after condense
- No loss of critical information (receipts, file paths)

---

### Task 3.4: Skill Event Emission (P0 - 2 days)

**Objective:** Emit events for skill load and execution

**Pattern source:** Qwen Code skills with explicit invocation

**Current state:**
- `packages/skills-runtime` exists
- Skill loading happens but no events emitted
- Wave 2 added event kinds: `run.skill.loaded`, `run.skill.executed`

**Implementation:**

1. Modify `packages/skills-runtime/src/run-skill.ts`:
```typescript
export async function runSkill(
  skillName: string,
  input: string,
  context: SkillContext,
  eventEngine?: EventEngine
): Promise<SkillResult> {
  // Load skill definition
  const skill = await loadSkill(skillName);

  // Emit skill.loaded event
  eventEngine?.emit({
    kind: 'run.skill.loaded',
    payload: {
      skillName,
      source: skill.source,
      license: skill.license,
      trustTier: skill.trustTier,
      timestamp: new Date().toISOString()
    }
  });

  // Execute skill
  const result = await executeSkill(skill, input, context);

  // Emit skill.executed event
  eventEngine?.emit({
    kind: 'run.skill.executed',
    payload: {
      skillName,
      success: result.success,
      pdseScore: result.pdseScore,
      duration: result.duration,
      timestamp: new Date().toISOString()
    }
  });

  return result;
}
```

2. Wire EventEngine into skill execution paths:
   - CLI: `packages/cli/src/slash-commands.ts` (/skills run)
   - Agent loop: `packages/cli/src/agent-loop.ts`

3. Add skill tracking to run report:
```typescript
// In run-report.ts
export interface RunReport {
  // ... existing fields
  skillsLoaded: string[];
  skillsExecuted: { name: string; success: boolean; pdse: number }[];
}
```

4. Write 20 tests:
   - Skill load event (6 tests)
   - Skill execute event (8 tests)
   - Event payload validation (4 tests)
   - Run report integration (2 tests)

**Files modified:**
- `packages/skills-runtime/src/run-skill.ts`
- `packages/cli/src/slash-commands.ts`
- `packages/cli/src/agent-loop.ts`
- `packages/core/src/run-report.ts`

**Success criteria:**
- 20/20 tests passing
- 100% of skill loads emit event
- 100% of skill executions emit event
- Events include provenance (source, license, trust)

---

### Task 3.5: Skill Composition with Gating (P0 - 3 days)

**Objective:** Chain skills with DanteForge verification between steps

**Pattern source:** VoltAgent workflow composition

**Implementation:**

1. Create `packages/skills-runtime/src/skill-chain.ts`:
```typescript
export interface SkillChain {
  name: string;
  steps: SkillStep[];
  gating: 'none' | 'pdse' | 'manual';
  pdseThreshold?: number;
}

export interface SkillStep {
  skillName: string;
  input: string | SkillOutputRef;
  onFailure: 'abort' | 'continue' | 'prompt';
}

export interface SkillOutputRef {
  type: 'previous' | 'step';
  stepIndex?: number;
  field: string; // e.g., "output", "files", "summary"
}

export async function executeChain(
  chain: SkillChain,
  initialInput: string,
  context: SkillContext,
  forgeGate?: (result: SkillResult) => Promise<boolean>
): Promise<ChainResult> {
  const results: SkillResult[] = [];

  for (const [index, step] of chain.steps.entries()) {
    // Resolve input (substitute $previous.output)
    const input = resolveInput(step.input, results);

    // Execute skill
    const result = await runSkill(step.skillName, input, context);
    results.push(result);

    // Gate check
    if (chain.gating === 'pdse' && forgeGate) {
      const approved = await forgeGate(result);
      if (!approved) {
        return handleGateFailure(step.onFailure, index, results);
      }
    }
  }

  return { success: true, results };
}
```

2. Add `/skills chain` command:
```typescript
// In slash-commands.ts
async function skillsChainCommand(replState: ReplState, chainName: string): Promise<void> {
  const chain = loadChain(chainName); // From .dantecode/skills/chains/<name>.json

  const forgeGate = async (result: SkillResult) => {
    if (!result.pdseScore || result.pdseScore < (chain.pdseThreshold ?? 70)) {
      return false;
    }
    return true;
  };

  const chainResult = await executeChain(chain, userInput, context, forgeGate);
  displayChainResult(chainResult);
}
```

3. Chain definition format (`.dantecode/skills/chains/review-and-test.json`):
```json
{
  "name": "review-and-test",
  "description": "Review PR then run tests",
  "steps": [
    {
      "skillName": "review-pr",
      "input": "$initial",
      "onFailure": "abort"
    },
    {
      "skillName": "run-tests",
      "input": "$previous.changedFiles",
      "onFailure": "prompt"
    }
  ],
  "gating": "pdse",
  "pdseThreshold": 70
}
```

4. Write 30 tests:
   - Chain execution (10 tests)
   - Input substitution ($previous.output) (6 tests)
   - PDSE gating (8 tests)
   - Failure handling (abort/continue/prompt) (6 tests)

**Files created:**
- `packages/skills-runtime/src/skill-chain.ts`
- `packages/skills-runtime/src/skill-chain.test.ts`

**Files modified:**
- `packages/cli/src/slash-commands.ts`
- `packages/skills-runtime/src/index.ts` (exports)

**Success criteria:**
- 30/30 tests passing
- Multi-step chains execute sequentially
- PDSE gating works between steps
- Failed steps respect onFailure strategy

---

### Task 3.6: CLI/VS Code Parity (P1 - 2 days)

**Objective:** Skills and context features work identically in CLI and VS Code

**Implementation:**

1. VS Code status bar updates:
   - Add index readiness badge
   - Add context pressure badge
   - Color-code based on pressure

2. VS Code skills integration:
   - Skills tree view (similar to checkpoints)
   - Execute skill from tree context menu
   - Chain execution from command palette

3. Wire semantic index into VS Code:
   - Start index on extension activation
   - Show readiness in status bar
   - Use index for "Go to Symbol" enhancements

4. Write 20 tests:
   - Status bar badges (6 tests)
   - Skills tree view (8 tests)
   - Chain execution (6 tests)

**Files modified:**
- `packages/vscode/src/sidebar-provider.ts`
- `packages/vscode/src/extension.ts`
- `packages/vscode/src/status-bar.ts` (NEW or modify existing)
- `packages/vscode/src/skills-tree-provider.ts` (NEW)
- `packages/vscode/src/vscode.test.ts`
- `packages/vscode/package.json`

**Success criteria:**
- 20/20 tests passing
- Index readiness visible in VS Code
- Context pressure visible in VS Code
- Skills execute identically to CLI

---

## Test Plan

### Unit Tests
- Tree-sitter parsing: 40 tests
- Semantic index: 35 tests
- Context condensing: 25 tests
- Skill events: 20 tests
- Skill composition: 30 tests
- VS Code integration: 20 tests

**Total new tests: 170**

### Integration Tests
- End-to-end repo map generation (3 tests)
- Background index + search (4 tests)
- Multi-skill chain with gating (4 tests)

**Total integration tests: 11**

**Total Wave 3 tests: 181**

### Manual Validation
- [ ] Repo map generates <500ms for 1000-file repo
- [ ] Index builds in background without blocking
- [ ] Status bar shows index readiness
- [ ] Context condenses at >80% pressure
- [ ] Skill events appear in event log
- [ ] Multi-skill chain with PDSE gating works
- [ ] CLI and VS Code behavior identical

---

## Success Metrics

| Metric | Target | Validation Method |
|--------|--------|-------------------|
| Tree-sitter coverage | >80% languages | Manual test 5 languages |
| Repo map speed | <500ms for 1000 files | Benchmark test |
| Index startup | Non-blocking | Agent loop timing |
| Context condensing | Triggers at >80% | Simulation test |
| Skill event coverage | 100% | Event log verification |
| Chain gating success | 100% | PDSE gate tests |
| CLI/VS Code parity | 100% | Manual cross-platform test |
| Test coverage | >90% | Vitest coverage report |

---

## Critical Files

### New Files (11)
- `packages/core/src/repo-map-tree-sitter.ts`
- `packages/core/src/repo-map-tree-sitter.test.ts`
- `packages/core/src/parsers/{typescript,python,javascript,go,rust}-parser.ts` (5 files)
- `packages/core/src/semantic-index.ts`
- `packages/core/src/semantic-index.test.ts`
- `packages/core/src/semantic-index-worker.ts`
- `packages/core/src/context-condenser.ts`
- `packages/core/src/context-condenser.test.ts`
- `packages/skills-runtime/src/skill-chain.ts`
- `packages/skills-runtime/src/skill-chain.test.ts`
- `packages/vscode/src/skills-tree-provider.ts`

### Modified Files (12)
- `packages/core/src/repo-map.ts`
- `packages/core/package.json`
- `packages/cli/src/agent-loop.ts`
- `packages/cli/src/repl.ts`
- `packages/cli/src/slash-commands.ts`
- `packages/ux-polish/src/surfaces/status-bar.ts`
- `packages/skills-runtime/src/run-skill.ts`
- `packages/core/src/run-report.ts`
- `packages/vscode/src/sidebar-provider.ts`
- `packages/vscode/src/extension.ts`
- `packages/vscode/src/vscode.test.ts`
- `packages/vscode/package.json`

**Total files: 23 (11 new + 12 modified)**

---

## Dependencies

- ✅ Wave 1 complete (permission engine for skill scoping)
- ✅ Wave 2 complete (event store for skill tracking)
- ✅ Tree-sitter packages available on npm
- ✅ Skills runtime package exists

---

## Risk Mitigation

### Risk: Tree-sitter binary compatibility
**Mitigation:** Graceful fallback to regex. Test on Windows/Mac/Linux.

### Risk: Background indexing memory usage
**Mitigation:** Stream processing, limited cache size, configurable concurrency.

### Risk: Context condensing loses information
**Mitigation:** Preserve receipts, file paths, recent rounds. Test recovery.

### Risk: Skill chain infinite loops
**Mitigation:** Max steps limit (default: 10). Detect circular dependencies.

---

**Status:** Ready for task breakdown
**Next Action:** Create WAVE_3_TASKS.md and begin implementation
