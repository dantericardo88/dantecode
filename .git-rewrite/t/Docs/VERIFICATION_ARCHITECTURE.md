# Verification & Trust Architecture

**Status:** Production-ready
**Last Updated:** 2026-03-28

## Overview

DanteCode implements a multi-layered verification system to ensure code quality and build trust:

1. **DanteForge PDSE Verification** - Precision, Detail, Safety, Effectiveness scoring
2. **Evidence Chain** - Cryptographic receipts with Merkle trees and hash chains
3. **Gaslight** - Adversarial refinement with bounded iterations
4. **FearSet** - Negative outcome prediction (fear-setting engine)
5. **Skillbook ACE** - Reflection loop for continuous learning

---

## Layer 1: DanteForge PDSE Verification

### What It Does

Scores generated code on four dimensions (0-100 scale):

- **Precision** - Does code match requirements exactly?
- **Detail** - Is implementation thorough (no TODOs/stubs)?
- **Safety** - Are security best practices followed?
- **Effectiveness** - Does code solve the problem efficiently?

**Passing score:** 70+ (configurable)

### How It Works

```typescript
import { runDanteForge } from "@dantecode/cli/danteforge-pipeline.js";

const { passed, summary, pdseScore } = await runDanteForge(
  filePath,
  fileContent,
  originalPrompt
);

if (passed) {
  console.log(`✓ Verification passed (${pdseScore}/100)`);
} else {
  console.log(`✗ Verification failed (${pdseScore}/100): ${summary}`);
}
```

### Integration Points

**Agent loop** (packages/cli/src/agent-loop.ts):
```typescript
// After each file modification
for (const filePath of touchedFiles) {
  const { passed, summary, pdseScore } = await runDanteForge(
    filePath,
    content,
    userPrompt
  );

  if (!passed) {
    // Record failure in evidence chain
    evidenceTracker.recordVerificationFailure(filePath, summary);

    // Nudge agent to fix issues
    systemPrompt += `\n\nVerification failed for ${filePath}: ${summary}`;
  } else {
    // Record success
    evidenceTracker.recordVerificationPass(filePath, pdseScore);
  }
}
```

**CLI commands**:
- `/autoforge` - Automatic verification after each Blade iteration
- `/verify` - Manual verification trigger

---

## Layer 2: Evidence Chain (Cryptographic Receipts)

### Architecture

```
Evidence Chain = Hash Chain + Merkle Tree + Receipt Log
```

**Components:**

1. **Hash Chain** - Tamper-evident sequence of events
   ```typescript
   block_n.hash = sha256(block_n.data + block_n-1.hash)
   ```

2. **Merkle Tree** - Efficient batch verification
   ```
   Root Hash
      ├── Hash(A, B)
      │   ├── A: receipt_1
      │   └── B: receipt_2
      └── Hash(C, D)
          ├── C: receipt_3
          └── D: receipt_4
   ```

3. **Receipt** - Cryptographic proof of action
   ```typescript
   {
     receiptId: "rec_abc123",
     action: "verification_pass",
     actor: "DanteForge",
     beforeHash: "sha256(...)",
     afterHash: "sha256(...)",
     timestamp: "2026-03-28T22:00:00Z"
   }
   ```

### Creating Evidence

```typescript
import { createEvidenceBundle, EvidenceSealer } from "@dantecode/evidence-chain";

// 1. Collect evidence
const evidence = {
  "verification_001": {
    filePath: "src/index.ts",
    pdseScore: 85,
    passed: true,
    timestamp: new Date().toISOString(),
  },
  "verification_002": {
    filePath: "src/utils.ts",
    pdseScore: 92,
    passed: true,
    timestamp: new Date().toISOString(),
  },
};

// 2. Create bundle with Merkle tree
const bundle = createEvidenceBundle({
  sessionId: "session-123",
  evidence,
  metadata: { agent: "DanteCode", version: "0.9.2" },
});

// 3. Seal with cryptographic hash
const sealer = new EvidenceSealer();
const seal = sealer.seal(
  bundle.bundleId,
  "session-123",
  bundle.evidenceRootHash,
  { model: "claude-opus-4-6", tokensUsed: 15000 },
  { totalVerifications: 2, passRate: 1.0 }
);

console.log(`Sealed: ${seal.sealHash}`);
```

### Verification

```typescript
// Verify seal integrity
const isValid = sealer.verify(seal);
console.log(`Seal valid: ${isValid}`);

// Verify specific receipt in Merkle tree
import { MerkleTree } from "@dantecode/evidence-chain";

const tree = MerkleTree.fromLeaves(Object.keys(evidence));
const proof = tree.getProof(0); // Get proof for first receipt

const verified = MerkleTree.verifyProof(
  proof,
  evidence["verification_001"],
  tree.getRoot()
);
console.log(`Receipt verified: ${verified}`);
```

---

## Layer 3: Gaslight (Adversarial Refinement)

### Concept

> "Gaslight critiques drafts adversarially to surface hidden flaws before they reach production."

**Process:**

1. Agent generates code draft
2. **Gaslighter** (adversarial role) critiques for flaws
3. Agent refines based on critique
4. DanteForge gates the final result (pass/fail)
5. If pass → distill lesson for Skillbook

### Configuration

```typescript
// packages/dante-gaslight/src/gaslight-types.ts
export interface GaslightConfig {
  enabled: boolean;           // Default: false (opt-in)
  maxIterations: number;      // Default: 5
  maxTokens: number;          // Default: 10,000
  maxSeconds: number;         // Default: 120
  confidenceThreshold: number; // Default: 0.8
  triggerChannels: string[];  // Default: ["explicit-user"]
}
```

### Usage

```bash
# Enable globally
dantecode gaslight on

# Trigger for specific task
dantecode gaslight review src/feature.ts

# View stats
dantecode gaslight stats
```

### Integration

```typescript
import { DanteGaslightIntegration } from "@dantecode/dante-gaslight";

const gaslight = new DanteGaslightIntegration({ /* config */ });

// Auto-trigger on verification failure
if (!verificationPassed) {
  const session = await gaslight.maybeGaslight({
    draft: generatedCode,
    context: { filePath, userPrompt },
    trigger: { channel: "verification", reason: "PDSE score below threshold" },
  });

  if (session && session.outcome === "PASS") {
    // Use refined code
    generatedCode = session.finalDraft;
  }
}
```

---

## Layer 4: FearSet (Negative Outcome Prediction)

### Concept

> "FearSet performs pre-mortem analysis: what could go wrong if we ship this code?"

**Fears assessed (7 categories):**

1. **Runtime Errors** - Will this crash?
2. **Security Vulnerabilities** - Can this be exploited?
3. **Performance Issues** - Will this be slow?
4. **Data Loss** - Could we lose user data?
5. **Breaking Changes** - Will this break existing code?
6. **Edge Cases** - What corner cases are unhandled?
7. **Maintenance Burden** - Is this tech debt?

### Configuration

```typescript
export interface FearSetConfig {
  enabled: boolean;              // Default: false (opt-in)
  maxFearsPerCategory: number;   // Default: 3
  minSeverity: "low" | "medium" | "high"; // Default: "medium"
  includeCategories: string[];   // Default: all 7
}
```

### Usage

```bash
# Enable globally
dantecode fearset on

# Analyze specific file
dantecode fearset analyze src/critical-path.ts

# View report
dantecode fearset report
```

### Example Output

```json
{
  "sessionId": "fear-session-001",
  "filePath": "src/payment-processor.ts",
  "fears": [
    {
      "category": "security",
      "severity": "high",
      "description": "SQL injection risk in line 42: unsanitized user input",
      "mitigation": "Use parameterized queries or ORM"
    },
    {
      "category": "data-loss",
      "severity": "high",
      "description": "No transaction rollback on payment failure",
      "mitigation": "Wrap payment + order creation in database transaction"
    },
    {
      "category": "edge-cases",
      "severity": "medium",
      "description": "No handling for duplicate payment attempts",
      "mitigation": "Add idempotency key check"
    }
  ],
  "overallRisk": "high",
  "recommendation": "DO_NOT_SHIP"
}
```

---

## Layer 5: Skillbook ACE (Continuous Learning)

### Concept

> "Skillbook distills lessons from successful tasks and failed attempts, creating institutional memory."

**ACE Loop:**

1. **Attempt** - Agent tries a task
2. **Critique** - Result is evaluated (Gaslight + DanteForge)
3. **Extract** - Lessons are distilled and stored

### Lesson Format

```typescript
export interface Skill {
  skillId: string;
  title: string;
  category: string; // "testing" | "refactoring" | "debugging" | etc.
  trustScore: number; // 0-1 based on repeated success
  content: {
    problem: string;      // What was the challenge?
    solution: string;     // What worked?
    antipattern: string;  // What didn't work?
    context: string;      // When is this applicable?
  };
  evidence: {
    sessionIds: string[];  // Which sessions confirmed this?
    successRate: number;   // How often does this approach work?
  };
}
```

### Integration

```typescript
import { DanteSkillbookIntegration } from "@dantecode/dante-skillbook";

const skillbook = new DanteSkillbookIntegration({ /* config */ });

// After task completion
const lesson = await skillbook.distillLesson({
  sessionId: session.id,
  task: userPrompt,
  outcome: "success",
  code: generatedCode,
  metrics: { pdseScore: 85, iterations: 3 },
});

if (lesson) {
  // Store for future retrieval
  await skillbook.store(lesson);

  console.log(`Lesson learned: ${lesson.title}`);
}

// Before next task, recall relevant lessons
const relevantLessons = await skillbook.recall(newUserPrompt, limit: 5);
systemPrompt += formatLessons(relevantLessons);
```

---

## Trust Metrics

### 1. Verification Pass Rate

```typescript
const passRate = verificationsPassed / totalVerifications;
// Target: > 85%
```

### 2. Evidence Chain Integrity

```typescript
const intact = await verifyHashChain(evidenceChain);
// Target: 100% (any break indicates tampering)
```

### 3. Gaslight Refinement Rate

```typescript
const refinementRate = gaslightSessionsWithImprovement / totalGaslightSessions;
// Target: > 70% (shows adversarial critique is valuable)
```

### 4. FearSet Accuracy

```typescript
const accuracy = fearsAverted / fearsIdentified;
// Target: > 60% (fears were real, not false positives)
```

### 5. Skillbook Utility

```typescript
const utilization = lessonsApplied / totalTasks;
// Target: > 40% (lessons are being reused)
```

---

## Publishing Verification Receipts

### Step 1: Generate Receipt

```typescript
import { EvidenceSealer } from "@dantecode/evidence-chain";

const sealer = new EvidenceSealer();
const receipt = sealer.seal(
  bundleId,
  sessionId,
  evidenceRootHash,
  config,
  metrics
);
```

### Step 2: Export to JSON

```typescript
import { writeFileSync } from "node:fs";

writeFileSync(
  "docs/verification/receipts/2026-03-28-session.json",
  JSON.stringify({
    date: new Date().toISOString(),
    sessionId: session.id,
    sealHash: receipt.sealHash,
    metrics: receipt.metricsHash,
    evidence: bundle.evidence,
    proof: merkleTree.getRoot(),
  }, null, 2)
);
```

### Step 3: Publish to GitHub

```bash
git add docs/verification/receipts/
git commit -m "feat: add verification receipt for session XXX"
git push origin main
```

### Step 4: Link in README

```markdown
## Verification Receipts

See [docs/verification/receipts/](./docs/verification/receipts/) for cryptographic proofs of code quality.

- [2026-03-28 Session](./docs/verification/receipts/2026-03-28-session.json) - Seal: `abc123...`
```

---

## Comparison to Competitors

| Feature | DanteCode | Cursor | Aider | Cline |
|---------|-----------|--------|-------|-------|
| **PDSE Scoring** | ✅ Built-in | ❌ None | ⚠️ Basic | ❌ None |
| **Cryptographic Receipts** | ✅ Evidence Chain | ❌ None | ❌ None | ❌ None |
| **Adversarial Refinement** | ✅ Gaslight | ❌ None | ❌ None | ❌ None |
| **Fear-Setting** | ✅ FearSet | ❌ None | ❌ None | ❌ None |
| **Continuous Learning** | ✅ Skillbook | ⚠️ Basic | ⚠️ Repo map | ❌ None |
| **Public Proof** | ✅ Receipts | ❌ None | ⚠️ Logs only | ❌ None |

**Verdict:** DanteCode has the most comprehensive verification system in the agentic coding space.

---

## References

- [Evidence Chain Package](../../packages/evidence-chain/)
- [DanteForge Pipeline](../../packages/cli/src/danteforge-pipeline.ts)
- [Gaslight Engine](../../packages/dante-gaslight/)
- [FearSet Engine](../../packages/dante-gaslight/src/fearset-engine.ts)
- [Skillbook Integration](../../packages/dante-skillbook/)
