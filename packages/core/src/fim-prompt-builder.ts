// ============================================================================
// DanteCode Core — FIM Prompt Builder
// Utility helpers for detecting FIM-capable Ollama models and constructing
// the model-specific fill-in-the-middle prompt format.
//
// Supported formats:
//   deepseek-coder  → <PRE>…<SUF>…<MID>
//   starcoder2      → <fim_prefix>…<fim_suffix>…<fim_middle>
//   codellama       → <PRE> … <SUF> … <MID>  (space-padded)
//   unknown         → prefix only (chat-path fallback)
// ============================================================================

/**
 * Discriminated union of all FIM-capable model families recognised by
 * DanteCode, plus an "unknown" sentinel for chat-path fallback.
 */
export type FimModel = "deepseek-coder" | "starcoder2" | "codellama" | "unknown";

/**
 * Identify which FIM family a model belongs to by matching its name against
 * well-known prefixes/substrings (case-insensitive).
 *
 * @param modelName - Raw model identifier, e.g. "deepseek-coder:6.7b" or
 *   "ollama/starcoder2:3b".
 * @returns The matched {@link FimModel} family, or `"unknown"`.
 */
export function detectFimModel(modelName: string): FimModel {
  const n = modelName.toLowerCase();
  if (n.includes("deepseek-coder")) return "deepseek-coder";
  if (n.includes("starcoder2") || n.includes("starcoder")) return "starcoder2";
  if (n.includes("codellama")) return "codellama";
  return "unknown";
}

/**
 * Assemble a fill-in-the-middle prompt using the token format appropriate for
 * the given model family.
 *
 * @param model  - The model family returned by {@link detectFimModel}.
 * @param prefix - Code before the cursor.
 * @param suffix - Code after the cursor.
 * @returns The assembled prompt string.  When `model` is `"unknown"` the
 *   function returns the raw prefix so the caller can handle it via the
 *   standard chat path.
 */
export function buildFimPrompt(model: FimModel, prefix: string, suffix: string): string {
  switch (model) {
    case "deepseek-coder":
      return `<PRE>${prefix}<SUF>${suffix}<MID>`;
    case "starcoder2":
      return `<fim_prefix>${prefix}<fim_suffix>${suffix}<fim_middle>`;
    case "codellama":
      return `<PRE> ${prefix} <SUF> ${suffix} <MID>`;
    default:
      // Unknown model — return prefix only; caller routes through chat path
      return `${prefix}`;
  }
}

/**
 * Returns `true` when `modelName` belongs to a known FIM-capable model family
 * (i.e. {@link detectFimModel} returns something other than `"unknown"`).
 *
 * @param modelName - Raw model identifier, e.g. "deepseek-coder:6.7b".
 */
export function isFimCapable(modelName: string): boolean {
  return detectFimModel(modelName) !== "unknown";
}
