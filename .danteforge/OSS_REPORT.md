# OSS Research Report: Agent Execution Quality

**Date:** 2026-04-01  
**Focus:** Retry logic, verification gates, UI/UX patterns, skill orchestration  
**Target:** Fix DanteCode execution loop to prevent retry storms and false success claims

## Repos Analyzed

### 1. LangGraph.js ⭐⭐⭐
**License:** MIT  
**Stars:** 10k+  
**URL:** https://github.com/langchain-ai/langgraphjs

**Key Patterns Extracted:**
- **Exponential backoff with jitter** (`libs/langgraph-core/src/pregel/retry.ts`)
  - Default: 500ms initial, 2x backoff, 128s max, 3 retries
  - Jitter: `Math.floor(interval + Math.random() * 1000)` prevents retry storms
  - Smart error categorization: 4xx = don't retry, 5xx/network = retry
  
```typescript
const DEFAULT_STATUS_NO_RETRY = [400, 401, 403, 404, 405, 409];
const retryOn = (error) => {
  if (error.message.startsWith("Cancel")) return false;
  if (error.status && NO_RETRY.includes(error.status)) return false;
  return true;
};
```

- **Retry logging:** Clear messages showing attempt count and interval
- **AbortSignal support:** Can cancel mid-retry
- **State-based retry tracking:** Stores attempt count in graph state

**Applicability:** HIGH - Direct pattern match for our retry detector

---

### 2. CrewAI ⭐⭐⭐
**License:** MIT  
**Stars:** 25k+  
**URL:** https://github.com/crewAIInc/crewAI

**Key Patterns Extracted:**
- **Guardrail validation** (`lib/crewai/src/crewai/task.py`)
  - Required fields: `description`, `expected_output`
  - Runtime validation of function signatures
  - Hallucination detection module
  
```python
@model_validator(mode="after")
def validate_required_fields(self):
    required_fields = ["description", "expected_output"]
    for field in required_fields:
        if getattr(self, field) is None:
            raise ValueError(f"{field} must be provided")
    return self
```

- **Task verification:** Tasks must specify expected output upfront
- **Hierarchical validation:** Manager validates agent outputs
- **Real-time tracing:** Visual task builder with step-by-step tracking

**Applicability:** HIGH - Evidence-based completion is exactly what we need

---

### 3. Aider ⭐⭐
**License:** Apache 2.0  
**Stars:** 15k+  
**URL:** https://github.com/Aider-AI/aider

**Key Patterns Extracted:**
- **Rich Console** for beautiful terminal output (`aider/io.py`)
  - Uses `rich.console.Console` for formatted output
  - Markdown rendering for structured text
  - Progress indicators with `prompt_toolkit`
  
```python
from rich.console import Console
from rich.markdown import Markdown

console = Console()
console.print(Markdown("## Phase Complete"))
```

- **Smart autocomplete:** Context-aware command completion
- **Multi-mode operation:** code/architect/ask/help modes with different UX
- **Token tracking:** Shows usage in progress bars

**Applicability:** MEDIUM - Inspiration for clean UX, but we'll use chalk instead of Rich (TypeScript ecosystem)

---

### 4. Mastra ⭐
**License:** Apache 2.0  
**Stars:** 5k+  
**URL:** https://github.com/mastra-ai/mastra

**Key Patterns Extracted:**
- **Built-in observability:** Tracing and logging as first-class features
- **TypeScript-native:** Designed for TS from the ground up (not Python port)
- **Agent builder pattern:** Fluent API for agent construction
- **Production-focused:** Error handling, retries, fallbacks baked in

**Applicability:** MEDIUM - Architectural inspiration, less tactical patterns

---

### 5. Vercel AI SDK ⭐
**License:** Apache 2.0  
**Stars:** 30k+  
**URL:** https://github.com/vercel/ai

**Key Patterns Extracted:**
- **Streaming-first:** Designed around SSE/streaming from the start
- **React Server Components:** Deep Next.js integration
- **Tool calling:** Clean abstraction for function calling
- **Edge runtime support:** Works in Vercel edge functions

**Applicability:** LOW for this task - More about streaming responses than execution quality

---

## Gap Analysis

| Priority | Pattern | Source | DanteCode Gap | Effort |
|----------|---------|--------|---------------|--------|
| **P0** | Exponential backoff retry | LangGraph | No retry detection | M |
| **P0** | Evidence-based validation | CrewAI | Claims success without proof | L |
| **P0** | Clean CLI UX | Aider | Raw JSON dumps | M |
| **P1** | Status tracking | CrewAI | Fabricates completion % | S |
| **P1** | Retry categorization | LangGraph | Retries 4xx errors | S |
| **P2** | Real-time tracing | CrewAI | Limited observability | L |

## Implementation Plan

Based on OSS patterns, implementing 5 components:

### 1. Retry Detector (from LangGraph)
- Track last 10 operations
- Jaccard similarity for semantic matching
- Return OK/WARNING/STUCK status
- **File:** `packages/core/src/retry-detector.ts`

### 2. Verification Gates (from CrewAI)
- 3-tier validation: file existence, build, tests
- Evidence-based success
- No false claims
- **File:** `packages/core/src/verification-gates.ts`

### 3. Clean Stream Renderer (from Aider)
- Icons for all operation types (✅❌⏳🔄)
- Progress bars with percentages
- Colored output (chalk)
- Phase transitions
- **File:** `packages/cli/src/stream-renderer.ts` (refactor)

### 4. Status Tracker (from CrewAI)
- Evidence objects (files, build, tests)
- Honest progress % calculation
- Can't proceed without verification
- **File:** `packages/core/src/status-tracker.ts`

### 5. Integration & E2E Testing
- Wire all components into agent-loop.ts
- E2E test reproducing user's bug
- **File:** `packages/cli/src/e2e-execution-quality.test.ts`

## Key Learnings

### What Works Well in Leading Frameworks

1. **Explicit error categorization** - Don't retry 4xx, do retry 5xx/network
2. **Jitter in backoff** - Prevents thundering herd problem
3. **Required validation upfront** - CrewAI forces `expected_output` field
4. **Visual progress** - Users need to see what's happening
5. **Evidence-based claims** - Never trust, always verify

### What to Avoid

1. **Silent retries** - LangGraph logs every retry clearly
2. **Bare except blocks** - Can swallow KeyboardInterrupt
3. **Assuming success** - CrewAI validates outputs before proceeding
4. **Technical dumps** - Aider shows intent, not implementation details

## Sources

Research conducted via WebSearch on 2026-04-01:

- [Top 5 TypeScript AI Agent Frameworks You Should Know in 2026](https://techwithibrahim.medium.com/top-5-typescript-ai-agent-frameworks-you-should-know-in-2026-5a2a0710f4a0)
- [LangGraph 2.0: The Definitive Guide to Building Production-Grade AI Agents in 2026](https://dev.to/richard_dillon_b9c238186e/langgraph-20-the-definitive-guide-to-building-production-grade-ai-agents-in-2026-4j2b)
- [A Beginner's Guide to Handling Errors in LangGraph with Retry Policies](https://dev.to/aiengineering/a-beginners-guide-to-handling-errors-in-langgraph-with-retry-policies-h22)
- [CrewAI Framework 2025: Complete Review](https://latenode.com/blog/ai-frameworks-technical-infrastructure/crewai-framework/crewai-framework-2025-complete-review-of-the-open-source-multi-agent-ai-platform)
- [CLI UX best practices: 3 patterns for improving progress displays](https://evilmartians.com/chronicles/cli-ux-best-practices-3-patterns-for-improving-progress-displays)
- [GitHub - Aider-AI/aider](https://github.com/Aider-AI/aider)
- [GitHub - mastra-ai/mastra](https://github.com/mastra-ai/mastra)

## Next Steps

All 5 implementation lanes launched in parallel worktrees:
- Lane 1: abbd53cc (Retry Detector)
- Lane 2: a550ed2c (Verification Gates)
- Lane 3: af28557e (Clean UX Renderer)
- Lane 4: a0e4671f (Status Tracker)
- Lane 5: ad3cff19 (Integration & E2E Testing)

Estimated completion: 30-60 minutes per lane.
