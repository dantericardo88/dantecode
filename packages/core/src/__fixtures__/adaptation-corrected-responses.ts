// ============================================================================
// D-12A Corrected Fixture Responses — What the model would produce if it
// obeyed the override instruction. Each corrected response must NOT trigger
// its respective quirk detector when passed to detectQuirks().
// ============================================================================

export interface CorrectedResponse {
  fixtureName: string;
  description: string;
  response: string;
}

/**
 * Map of fixture name → corrected response.
 * Used by `createDetectionBasedRunner` to test override effectiveness.
 */
export const CORRECTED_RESPONSES: Map<string, CorrectedResponse> = new Map([
  [
    "formatting-quirk",
    {
      fixtureName: "formatting-quirk",
      description: "KaTeX notation replaced with plain text (no $$, \\[, \\begin)",
      response:
        "The time complexity can be calculated as follows:\n" +
        "O(n log n)\n" +
        "This means the algorithm is efficient for large inputs.\n" +
        "Let me now implement the sorting function.",
    },
  ],
  [
    "early-stop-quirk",
    {
      fixtureName: "early-stop-quirk",
      description: "Tool acknowledgement followed by >200 chars of synthesis and next action",
      response:
        "I ran the search command and found 3 matching files. " +
        "The first file contains the configuration module with database connection settings and pool management. " +
        "The second file has the router setup including path mappings for all API endpoints. " +
        "The third file contains test fixtures for the integration tests. " +
        "Based on this analysis, the router configuration needs updating to include the new endpoint. " +
        "Let me proceed with editing the configuration file to add the missing route definition and update the corresponding test fixtures to cover the new behavior.",
    },
  ],
  [
    "schema-mismatch-quirk",
    {
      fixtureName: "schema-mismatch-quirk",
      description: "No 'unknown parameter/argument/field' error text — uses correct param name directly",
      response:
        "I called the tool with the correct parameter name 'file_path' and it returned the file contents successfully. " +
        "The file contains the module configuration with 45 lines of TypeScript. " +
        "Let me now update the configuration to include the new settings.",
    },
  ],
  [
    "overly-verbose-preface",
    {
      fixtureName: "overly-verbose-preface",
      description: "Concise response under 1000 words — leads with action, not explanation",
      response:
        "I'll implement the sorting function using a divide-and-conquer approach.\n\n" +
        "function mergeSort(arr: number[]): number[] {\n" +
        "  if (arr.length <= 1) return arr;\n" +
        "  const mid = Math.floor(arr.length / 2);\n" +
        "  return merge(mergeSort(arr.slice(0, mid)), mergeSort(arr.slice(mid)));\n" +
        "}\n\n" +
        "This handles numeric comparison correctly with O(n log n) time complexity.",
    },
  ],
  [
    "tool-call-format-error",
    {
      fixtureName: "tool-call-format-error",
      description: "Properly quoted JSON values — no unquoted paths or values",
      response:
        'I\'ll read the file now.\n```json\n{"name": "read_file", "arguments": {"path": "/src/index.ts"}}\n```\n' +
        "Let me process the results.",
    },
  ],
  [
    "skips-synthesis",
    {
      fixtureName: "skips-synthesis",
      description: "No plan:/approach:/strategy:/steps: language — shows execution output instead",
      response:
        "I created the new component file at src/components/Toggle.tsx with the render logic and event handlers. " +
        "I updated the imports in src/index.ts to include the Toggle export. " +
        "I added 3 unit tests covering the toggle state, click handler, and accessibility attributes. " +
        "The documentation in README.md now includes the Toggle component API reference. " +
        "All tests are passing and the build completes without errors.",
    },
  ],
  [
    "ignores-prd-section-order",
    {
      fixtureName: "ignores-prd-section-order",
      description: "Numbered stages at line starts (matches /^\\d+[.)]/m)",
      response:
        "I'll implement this feature following the stage requirements.\n" +
        "1. Setting up the database schema with the required tables and indexes.\n" +
        "2. Implementing the API routes for CRUD operations on the resource.\n" +
        "3. Adding input validation with proper error handling for edge cases.\n" +
        "4. Running the full test suite to verify all endpoints work correctly.\n" +
        "A".repeat(500) +
        "\n5. Deploying to staging environment for integration testing.",
    },
  ],
  [
    "markdown-wrapper-issue",
    {
      fixtureName: "markdown-wrapper-issue",
      description: "No markdown headers (no ^#{1,3} at line start) — plain text output",
      response:
        "Analysis Results: The project contains 15 modules organized by feature area. " +
        "The tool call returned file structure data showing 3 core packages and 12 utility modules. " +
        "The main entry point is at src/index.ts with exports for all public APIs.",
    },
  ],
  [
    "regeneration-trigger-pattern",
    {
      fixtureName: "regeneration-trigger-pattern",
      description: "Root cause diagnosis instead of retry phrases — no 'try again/attempting again/retrying/re-generating'",
      response:
        "The build failed with exit code 1. The error log shows a missing dependency: @types/node is not installed. " +
        "I'll add it to devDependencies and run the build with verbose logging to confirm the fix. " +
        "The root cause was an incomplete package.json that omitted the type declarations.",
    },
  ],
  [
    "provider-specific-dispatch-shape",
    {
      fixtureName: "provider-specific-dispatch-shape",
      description: "JSON dispatch format — no XML tags like <function_call>, <tool_use>, <invoke>",
      response:
        'I\'ll search the codebase now.\n{"name": "grep", "arguments": {"pattern": "TODO", "path": "src/"}}\n' +
        "This will find all TODO comments in the source directory.",
    },
  ],
]);
