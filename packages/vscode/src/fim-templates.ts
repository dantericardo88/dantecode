// ============================================================================
// DanteCode VS Code Extension — FIM Template Library
// Per-model Fill-in-the-Middle token templates for inline completion.
// Maps provider/model combinations to their native FIM token formats
// (CodeLlama, StarCoder, DeepSeek, Qwen) with a generic fallback.
// ============================================================================

/**
 * Token delimiters a model uses for Fill-in-the-Middle inference.
 */
export interface FIMTemplate {
  prefix: string;
  suffix: string;
  middle: string;
}

/**
 * The raw code context fed into the FIM prompt builder.
 */
export interface FIMInput {
  /** Code before the cursor position. */
  prefix: string;
  /** Code after the cursor position. */
  suffix: string;
  /** Optional additional context gathered from other open files. */
  crossFileContext?: string;
}

/**
 * A fully-assembled FIM prompt ready to send to the model, together with
 * the stop sequences the model should halt at.
 */
export interface FIMPrompt {
  prompt: string;
  stop: string[];
}

// ---------------------------------------------------------------------------
// Built-in template definitions
// ---------------------------------------------------------------------------

const CODELLAMA_TEMPLATE: FIMTemplate = {
  prefix: "<PRE>",
  suffix: "<SUF>",
  middle: "<MID>",
};

const STARCODER_TEMPLATE: FIMTemplate = {
  prefix: "<fim_prefix>",
  suffix: "<fim_suffix>",
  middle: "<fim_middle>",
};

const DEEPSEEK_TEMPLATE: FIMTemplate = {
  prefix: "<|fim_begin|>",
  suffix: "<|fim_hole|>",
  middle: "<|fim_end|>",
};

// Qwen models reuse the StarCoder token convention.
const QWEN_TEMPLATE: FIMTemplate = STARCODER_TEMPLATE;

/**
 * Generic fallback template that wraps code in labelled markdown blocks.
 * Works reasonably well with instruction-tuned models that lack native FIM
 * tokens.
 */
const GENERIC_TEMPLATE: FIMTemplate = {
  prefix: "```prefix\n",
  suffix: "\n```\n```suffix\n",
  middle: "\n```\n```middle\n",
};

// ---------------------------------------------------------------------------
// Template dispatcher
// ---------------------------------------------------------------------------

/**
 * Returns the FIM token template appropriate for the given provider and
 * model ID. The dispatcher uses `startsWith` / `includes` heuristics so
 * that versioned model names (e.g. `codellama-34b-instruct`) are matched.
 *
 * @param provider - The model provider key (e.g. "ollama", "openai").
 * @param modelId  - The model identifier (e.g. "codellama-7b", "starcoder2-3b").
 * @returns The matching {@link FIMTemplate}.
 */
export function getFIMTemplate(provider: string, modelId: string): FIMTemplate {
  const id = modelId.toLowerCase();

  if (id.startsWith("codellama") || id.includes("codellama")) {
    return CODELLAMA_TEMPLATE;
  }

  if (id.startsWith("starcoder") || id.includes("starcoder")) {
    return STARCODER_TEMPLATE;
  }

  if (id.startsWith("deepseek-coder") || id.includes("deepseek-coder")) {
    return DEEPSEEK_TEMPLATE;
  }

  if (id.startsWith("qwen") || id.includes("qwen")) {
    return QWEN_TEMPLATE;
  }

  // Provider-level fallback: Ollama frequently serves Code Llama or
  // StarCoder variants under short aliases — but without an explicit match
  // we fall through to the generic template.
  void provider; // referenced for documentation; no provider-only logic yet

  return GENERIC_TEMPLATE;
}

/**
 * Builds a complete FIM prompt string and its stop sequences for the
 * specified provider / model combination.
 *
 * When {@link FIMInput.crossFileContext} is provided the context block is
 * prepended before the prefix section so the model can reference symbols
 * from neighbouring files.
 *
 * @param provider - The model provider key.
 * @param modelId  - The model identifier.
 * @param input    - The raw FIM input (prefix, suffix, optional cross-file context).
 * @returns A {@link FIMPrompt} containing the assembled prompt and stop tokens.
 */
export function buildFIMPromptForModel(
  provider: string,
  modelId: string,
  input: FIMInput,
): FIMPrompt {
  const template = getFIMTemplate(provider, modelId);

  const contextBlock =
    input.crossFileContext && input.crossFileContext.length > 0
      ? `${input.crossFileContext}\n`
      : "";

  const prompt = [
    template.prefix,
    contextBlock,
    input.prefix,
    template.suffix,
    input.suffix,
    template.middle,
  ].join("");

  // The model should stop generating when it emits any of the FIM tokens
  // or hits the end-of-text sentinel.
  const stop = [template.prefix, template.suffix, template.middle, "<|endoftext|>"].filter(
    // Deduplicate — some templates may share tokens (defensive).
    (tok, idx, arr) => arr.indexOf(tok) === idx,
  );

  return { prompt, stop };
}
