// ============================================================================
// @dantecode/core — CompletionGate
// Evaluates whether an agent response genuinely completes a task, preventing
// premature exits from stub/placeholder responses and short low-confidence replies.
// ============================================================================

export interface GateVerdict {
  shouldExit: boolean;
  confidence: number; // 0.0 - 1.0
  reason: string;
}

// Soft signals: completion vocabulary that adds confidence
const SOFT_SIGNALS = [
  "task complete",
  "done",
  "finished",
  "all tests pass",
  "no errors",
  "successfully",
  "implemented",
  "created",
  "fixed",
];

// Hard reject: stub/placeholder detection
const STUB_PATTERNS = ["TODO", "placeholder", "not implemented"];

// Evidence markers: code blocks, file references, test output, diffs — indicates real work was done
const EVIDENCE_PATTERNS = [
  /```[\s\S]{10,}/,           // code block with content
  /\.(ts|js|py|rs|go|tsx|jsx|css|json|md)\b/,  // file references
  /✓|✗|PASS|FAIL|passed|failed/i,              // test output
  /^\+{1,3}[^+]|^-{1,3}[^-]/m,                // diff output
  /\bfunction\b|\bclass\b|\bconst\b|\bimport\b/, // actual code keywords
];

export class CompletionGate {
  evaluate(response: string, toolsCalledCount: number): GateVerdict {
    const lower = response.toLowerCase();
    let confidence = 0.0;

    // HARD prerequisite: no tool calls = no exit.
    // An agent that claims completion without having called any tool is lying.
    if (toolsCalledCount === 0) {
      return {
        shouldExit: false,
        confidence: 0.0,
        reason: "no tools called — cannot verify completion without any tool usage",
      };
    }

    // SOFT signals — each matching signal adds 0.15, max 4 signals (0.6 total)
    // Reduced per-signal weight (was 0.2) so 3 soft signals alone can't hit threshold
    let softHits = 0;
    for (const signal of SOFT_SIGNALS) {
      if (lower.includes(signal.toLowerCase())) {
        softHits++;
        if (softHits >= 4) break;
      }
    }
    confidence += Math.min(softHits, 4) * 0.15;

    // HARD signal: response has no tool call syntax AND at least 1 tool was called this session
    const hasToolCallSyntax =
      response.includes("<tool_use") ||
      response.includes("<function_calls>") ||
      response.includes('"tool_call"') ||
      (response.includes('"name":') && response.includes('"input":'));
    if (!hasToolCallSyntax && toolsCalledCount >= 1) {
      confidence += 0.4;
    }

    // EVIDENCE bonus: response contains actual evidence of work (code, file refs, test output)
    const hasEvidence = EVIDENCE_PATTERNS.some((pat) => pat.test(response));
    if (hasEvidence) {
      confidence += 0.15;
    }

    // STUB detection — hard reject regardless of confidence
    for (const pattern of STUB_PATTERNS) {
      if (response.includes(pattern)) {
        return {
          shouldExit: false,
          confidence,
          reason: `stub detected ("${pattern}" present in response)`,
        };
      }
    }

    // CLAIMS-WITHOUT-EVIDENCE: pure completion vocabulary with no evidence of actual work
    // This catches adversarial completions like "I have completed the task successfully."
    const isPureClaimWithoutEvidence = softHits >= 2 && !hasEvidence && toolsCalledCount < 2;
    if (isPureClaimWithoutEvidence) {
      return {
        shouldExit: false,
        confidence: Math.min(confidence, 0.55),
        reason: "completion claimed without evidence — response contains only completion language, no code/files/test output",
      };
    }

    // TOO SHORT: response under 50 chars with low confidence
    if (response.trim().length < 50 && confidence < 0.8) {
      return {
        shouldExit: false,
        confidence,
        reason: "response too short — appears to be a one-liner without verification output",
      };
    }

    // PASS
    if (confidence >= 0.6) {
      return {
        shouldExit: true,
        confidence,
        reason: `confidence ${confidence.toFixed(2)} ≥ 0.6 threshold with ${softHits} soft signal(s)${!hasToolCallSyntax && toolsCalledCount >= 1 ? " + no-tool-call hard signal" : ""}${hasEvidence ? " + evidence" : ""}`,
      };
    }

    return {
      shouldExit: false,
      confidence,
      reason: `confidence ${confidence.toFixed(2)} below 0.6 threshold`,
    };
  }
}

/** Singleton instance for use across the agent loop */
export const completionGate = new CompletionGate();
