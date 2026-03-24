// ============================================================================
// D-12A Replay Fixtures — 10 typed replay scenarios for experiment validation
// Each fixture triggers exactly one quirk class when passed to detectQuirks().
// ============================================================================

import type { QuirkKey, WorkflowType } from "../model-adaptation-types.js";
import type { ModelAdaptationKey } from "../model-adaptation-store.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AdaptationReplayFixture {
  name: string;
  description: string;
  response: string;
  context: {
    modelKey: ModelAdaptationKey;
    sessionId: string;
    promptType?: "tool-call" | "planning" | "implementation" | "verification";
    hadToolCalls?: boolean;
    toolCallsInRound?: number;
    workflow?: WorkflowType;
  };
  expectedQuirk: QuirkKey;
  expectedTags: string[];
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_KEY: ModelAdaptationKey = {
  provider: "anthropic",
  modelId: "claude-sonnet-4-6",
};

export const REPLAY_FIXTURES: AdaptationReplayFixture[] = [
  {
    name: "formatting-quirk",
    description: "Model emits KaTeX math notation in a non-planning implementation context",
    response:
      "The time complexity can be calculated as follows:\n" +
      "$$O(n \\log n)$$\n" +
      "This means the algorithm is efficient for large inputs.\n" +
      "Let me now implement the sorting function.",
    context: {
      modelKey: BASE_KEY,
      sessionId: "replay-fmt-001",
      promptType: "implementation",
      hadToolCalls: false,
      toolCallsInRound: 0,
      workflow: "repl",
    },
    expectedQuirk: "katex_format_requirement",
    expectedTags: ["katex-formatting"],
  },
  {
    name: "early-stop-quirk",
    description: "Model stops abruptly after acknowledging a tool execution",
    response: "I ran the search command and found 3 matching files.",
    context: {
      modelKey: BASE_KEY,
      sessionId: "replay-stop-001",
      promptType: "implementation",
      hadToolCalls: true,
      toolCallsInRound: 1,
      workflow: "magic",
    },
    expectedQuirk: "stops_before_completion",
    expectedTags: ["stops-after-tool"],
  },
  {
    name: "schema-mismatch-quirk",
    description: "Model references an unknown parameter name from a tool schema",
    response:
      "I tried to call the tool but got an error: unknown parameter 'fileName' was provided. " +
      "Let me fix this and use the correct parameter name 'file_path' instead.",
    context: {
      modelKey: BASE_KEY,
      sessionId: "replay-schema-001",
      promptType: "tool-call",
      hadToolCalls: true,
      toolCallsInRound: 1,
      workflow: "forge",
    },
    expectedQuirk: "schema_argument_mismatch",
    expectedTags: ["schema-mismatch"],
  },
  {
    name: "overly-verbose-preface",
    description: "Model produces an excessively verbose response (>1000 words) in implementation context",
    response:
      "Let me provide a comprehensive and detailed explanation of the entire approach. " +
      "First, I want to make sure we understand the full context of what we're building here. " +
      "The architecture involves multiple layers of abstraction that need to be carefully considered. " +
      Array(200).fill("This is additional verbose content that adds unnecessary length to the response.").join(" ") +
      " Now let me actually implement the function.",
    context: {
      modelKey: BASE_KEY,
      sessionId: "replay-verbose-001",
      promptType: "implementation",
      hadToolCalls: false,
      toolCallsInRound: 0,
      workflow: "magic",
    },
    expectedQuirk: "overly_verbose_preface",
    expectedTags: ["excessive-verbosity"],
  },
  {
    name: "tool-call-format-error",
    description: "Model emits malformed JSON in a tool call response",
    response:
      'I\'ll read the file now.\n```json\n{"name": "read_file", "args": /src/index.ts}\n```\n' +
      "Let me try again with the correct format.",
    context: {
      modelKey: BASE_KEY,
      sessionId: "replay-json-001",
      promptType: "tool-call",
      hadToolCalls: true,
      toolCallsInRound: 1,
      workflow: "forge",
    },
    expectedQuirk: "tool_call_format_error",
    expectedTags: ["malformed-json"],
  },
  {
    name: "skips-synthesis",
    description: "Model plans extensively but never executes any tool calls",
    response:
      "Here is my plan:\n\n" +
      "First, I'll create the new component file.\n" +
      "Then, I'll update the imports in the index file.\n" +
      "Next, I'll add the necessary tests.\n" +
      "Finally, I'll update the documentation.\n\n" +
      "This approach ensures we follow best practices and maintain code quality throughout the implementation process. " +
      "The plan covers all aspects of the feature including error handling and edge cases.",
    context: {
      modelKey: BASE_KEY,
      sessionId: "replay-synthesis-001",
      promptType: "implementation",
      hadToolCalls: false,
      toolCallsInRound: 0,
      workflow: "magic",
    },
    expectedQuirk: "skips_synthesis",
    expectedTags: ["planning-without-execution"],
  },
  {
    name: "ignores-prd-section-order",
    description: "Model references stages/steps but doesn't number them in a long implementation response",
    response:
      "I'll implement this feature following the stage requirements. " +
      "For stage 2, we need to set up the database schema. " +
      "Moving to stage 3 of the implementation, we handle the API routes. " +
      "In the next step of stage 4, we'll add validation. " +
      "A".repeat(600) +
      " The phase for testing comes after all stages are complete.",
    context: {
      modelKey: BASE_KEY,
      sessionId: "replay-order-001",
      promptType: "implementation",
      hadToolCalls: false,
      toolCallsInRound: 0,
      workflow: "forge",
    },
    expectedQuirk: "ignores_prd_section_order",
    expectedTags: ["skipped-stages"],
  },
  {
    name: "markdown-wrapper-issue",
    description: "Model uses markdown headers in a tool-call context where plain text is expected",
    response:
      "# Analysis Results\n## File Structure\n" +
      "The project contains 15 modules with the following tool call output.",
    context: {
      modelKey: BASE_KEY,
      sessionId: "replay-markdown-001",
      promptType: "tool-call",
      hadToolCalls: true,
      toolCallsInRound: 1,
      workflow: "forge",
    },
    expectedQuirk: "markdown_wrapper_issue",
    expectedTags: ["markdown-in-tool-call"],
  },
  {
    name: "regeneration-trigger-pattern",
    description: "Model enters a retry loop with multiple regeneration attempts instead of diagnosing",
    response:
      "The build failed with exit code 1. Let me try again with the correct configuration. " +
      "The second attempt also failed. Attempting again with updated dependencies. " +
      "Still encountering issues. Re-generating the configuration from scratch.",
    context: {
      modelKey: BASE_KEY,
      sessionId: "replay-regen-001",
      promptType: "implementation",
      hadToolCalls: true,
      toolCallsInRound: 2,
      workflow: "magic",
    },
    expectedQuirk: "regeneration_trigger_pattern",
    expectedTags: ["regeneration-loop"],
  },
  {
    name: "provider-specific-dispatch-shape",
    description: "Model emits XML-style tool calls instead of JSON dispatch format",
    response:
      "I'll search the codebase now.\n<function_call>grep -r 'TODO' src/</function_call>\n" +
      "This will find all TODO comments in the source directory.",
    context: {
      modelKey: BASE_KEY,
      sessionId: "replay-dispatch-001",
      promptType: "tool-call",
      hadToolCalls: true,
      toolCallsInRound: 1,
      workflow: "forge",
    },
    expectedQuirk: "provider_specific_dispatch_shape",
    expectedTags: ["non-standard-dispatch"],
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function getReplayFixture(name: string): AdaptationReplayFixture | undefined {
  return REPLAY_FIXTURES.find((f) => f.name === name);
}
