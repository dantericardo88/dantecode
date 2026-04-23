// ============================================================================
// packages/vscode/src/architect-editor-orchestrator.ts
//
// Two-pass Aider-inspired orchestrator for multi-file chat edits.
//
// Pass 1 — Architect:
//   The model receives a special system prompt instructing it to output a JSON
//   plan only (no code). The plan lists which files to change and the intent
//   for each change.
//
// Pass 2 — Editor (parallel):
//   One model call per file in the plan. Each call receives the file's current
//   content and outputs a single SEARCH/REPLACE block. All editor calls run
//   concurrently via Promise.all.
//
// Usage:
//   const orch = new ArchitectEditorOrchestrator(modelCall, getFileContent);
//   const plan = await orch.plan(userMessage, systemPrompt);
//   const edits = await orch.edit(plan, userMessage);
//   // edits: Map<filePath, rawModelResponse>  (each contains a SEARCH/REPLACE block)
// ============================================================================

// ── Types ─────────────────────────────────────────────────────────────────────

/** The JSON structure returned by the architect pass. */
export interface ArchitectPlan {
  /** One-sentence summary of the overall approach. */
  overallApproach: string;
  /** Files that need to be changed, in dependency order. */
  files: Array<{
    /** Relative path from project root. */
    path: string;
    /** Intent for this file — what to change and why. */
    intent: string;
  }>;
}

// ── Architect system prompt ───────────────────────────────────────────────────

const ARCHITECT_SUFFIX = `

ARCHITECT MODE — OUTPUT JSON ONLY:
You must respond with ONLY a valid JSON object. No prose, no code, no markdown.
Schema:
{
  "overallApproach": "<one sentence describing the approach>",
  "files": [
    { "path": "<relative/file/path.ts>", "intent": "<what to change in this file and why>" }
  ]
}
Do NOT output any code. Do NOT output SEARCH/REPLACE blocks. JSON only.`;

// ── ArchitectEditorOrchestrator ───────────────────────────────────────────────

/**
 * Two-pass multi-file edit orchestrator.
 *
 * `modelCall` — injectable model invocation function (system, userMessage) → response string.
 *   In production this wraps the ModelRouter. In tests it's a vi.fn().
 *
 * `getFileContent` — injectable file reader (relativePath) → content string.
 *   Falls back to "" if the file cannot be read (new file case).
 */
export class ArchitectEditorOrchestrator {
  constructor(
    private readonly modelCall: (system: string, userMessage: string) => Promise<string>,
    private readonly getFileContent: (relativePath: string) => Promise<string>,
  ) {}

  // ── Pass 1: Architect ───────────────────────────────────────────────────────

  /**
   * Ask the model to produce a JSON plan for the given user request.
   * Throws if the response contains no parseable JSON object.
   */
  async plan(userMessage: string, systemPrompt: string): Promise<ArchitectPlan> {
    const architectSystem = systemPrompt + ARCHITECT_SUFFIX;
    const raw = await this.modelCall(architectSystem, userMessage);

    // Extract the first JSON object from the response (handles markdown wrapping)
    const jsonMatch = /\{[\s\S]*\}/.exec(raw);
    if (!jsonMatch) {
      throw new Error(
        `ArchitectEditorOrchestrator: model returned no JSON in architect pass. Response: ${raw.slice(0, 200)}`,
      );
    }
    return JSON.parse(jsonMatch[0]) as ArchitectPlan;
  }

  // ── Pass 2: Editor (parallel) ────────────────────────────────────────────────

  /**
   * For each file in the plan, calls the model with the file's current content
   * and the per-file intent. All calls run concurrently.
   *
   * Returns a Map from file path → raw model response (each contains a
   * SEARCH/REPLACE block ready for parseSearchReplaceBlocks()).
   *
   * Files with duplicate paths are deduplicated (last intent wins).
   */
  async edit(plan: ArchitectPlan, userMessage: string): Promise<Map<string, string>> {
    // Deduplicate by path — later entries win
    const uniqueFiles = Array.from(
      new Map(plan.files.map((f) => [f.path, f])).values(),
    );

    if (uniqueFiles.length === 0) return new Map();

    const results = await Promise.all(
      uniqueFiles.map(async ({ path, intent }) => {
        const content = await this.getFileContent(path).catch(() => "");

        const editorSystem = [
          `EDITOR MODE — single file: ${path}`,
          `Intent: ${intent}`,
          `Original user request: ${userMessage}`,
          "",
          "Output ONLY a SEARCH/REPLACE block for this file. No explanations, no prose.",
          "<<<<<<< SEARCH",
          "(exact text to replace)",
          "=======",
          "(replacement text)",
          ">>>>>>> REPLACE",
        ].join("\n");

        const response = await this.modelCall(
          editorSystem,
          `Current file content:\n\`\`\`\n${content}\n\`\`\``,
        );

        return [path, response] as [string, string];
      }),
    );

    return new Map(results);
  }
}
