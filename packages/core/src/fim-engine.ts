/**
 * Fill-in-the-Middle (FIM) prompt builder for inline completions.
 * Model-agnostic — supports StarCoder, CodeLlama, DeepSeek-Coder, Claude, GPT, and generic formats.
 */

import { basename, extname } from "node:path";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Supported FIM model families. */
export type FIMModel =
  | "starcoder"
  | "codellama"
  | "deepseek-coder"
  | "claude"
  | "gpt"
  | "generic";

/** Context gathered at the cursor position. */
export interface FIMContext {
  /** Code before the cursor. */
  prefix: string;
  /** Code after the cursor. */
  suffix: string;
  /** Source language (e.g. "typescript"). Detected automatically when omitted. */
  language?: string;
  /** Absolute path to the file being edited. */
  filePath?: string;
  /** 0-based line index of the cursor. */
  cursorLine: number;
  /** 0-based column index of the cursor. */
  cursorCol: number;
  /** Optional memory / RAG snippet to inject into the prompt. */
  memoryContext?: string;
}

/** A fully-built FIM prompt ready to send to a model. */
export interface FIMPrompt {
  model: FIMModel;
  /** The raw prompt string (or structured representation serialised to string). */
  prompt: string;
  /** Tokens that signal end-of-completion for this model. */
  stopTokens: string[];
  maxTokens: number;
  temperature: number;
}

/** A post-processed completion returned by the engine. */
export interface FIMCompletion {
  text: string;
  /** 0-1 confidence score. */
  confidence: number;
  model: FIMModel;
  /** Estimated token count (characters / 4). */
  tokens: number;
}

/** Construction options for {@link FIMEngine}. */
export interface FIMEngineOptions {
  /** Default max tokens for completions. Default: 256 */
  defaultMaxTokens?: number;
  /** Default temperature. Default: 0.2 */
  defaultTemperature?: number;
  /** Number of prefix (before-cursor) lines to include. Default: 50 */
  prefixLines?: number;
  /** Number of suffix (after-cursor) lines to include. Default: 20 */
  suffixLines?: number;
}

// ---------------------------------------------------------------------------
// Language extension map
// ---------------------------------------------------------------------------

const EXT_LANGUAGE_MAP: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".cs": "csharp",
  ".cpp": "cpp",
  ".cc": "cpp",
  ".cxx": "cpp",
  ".c": "c",
  ".h": "c",
  ".hpp": "cpp",
  ".rb": "ruby",
  ".php": "php",
  ".swift": "swift",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".scala": "scala",
  ".r": "r",
  ".R": "r",
  ".sh": "bash",
  ".bash": "bash",
  ".zsh": "bash",
  ".lua": "lua",
  ".sql": "sql",
  ".html": "html",
  ".htm": "html",
  ".css": "css",
  ".scss": "scss",
  ".json": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".toml": "toml",
  ".md": "markdown",
};

// ---------------------------------------------------------------------------
// Stop-token registry
// ---------------------------------------------------------------------------

const STOP_TOKENS: Record<FIMModel, string[]> = {
  starcoder: ["<fim_prefix>", "<fim_suffix>", "<fim_middle>", "<|endoftext|>"],
  codellama: ["<PRE>", "<SUF>", "<MID>", "</s>", "<EOT>"],
  "deepseek-coder": [
    "<｜fim▁begin｜>",
    "<｜fim▁hole｜>",
    "<｜fim▁end｜>",
    "<|EOT|>",
  ],
  claude: ["</completion>", "\n\nHuman:", "\n\nAssistant:"],
  gpt: ["// FILL IN THE BLANK", "<|endoftext|>"],
  generic: ["[FILL]"],
};

// ---------------------------------------------------------------------------
// FIMEngine
// ---------------------------------------------------------------------------

/**
 * Builds model-specific FIM prompts and post-processes raw completions.
 *
 * @example
 * ```typescript
 * const engine = new FIMEngine({ prefixLines: 30 });
 * const ctx = engine.buildContext("/src/app.ts", code, cursorOffset);
 * const prompt = engine.buildPrompt(ctx, "starcoder");
 * ```
 */
export class FIMEngine {
  private readonly defaultMaxTokens: number;
  private readonly defaultTemperature: number;
  private readonly prefixLines: number;
  private readonly suffixLines: number;

  constructor(options: FIMEngineOptions = {}) {
    this.defaultMaxTokens = options.defaultMaxTokens ?? 256;
    this.defaultTemperature = options.defaultTemperature ?? 0.2;
    this.prefixLines = options.prefixLines ?? 50;
    this.suffixLines = options.suffixLines ?? 20;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Build a model-specific FIM prompt from the given context.
   *
   * @param context - Cursor context (prefix, suffix, optional memory).
   * @param model   - Target model family. Defaults to "generic".
   * @returns A fully-populated {@link FIMPrompt}.
   */
  buildPrompt(context: FIMContext, model: FIMModel = "generic"): FIMPrompt {
    const prefix = this.truncateToLines(context.prefix, this.prefixLines, true);
    const suffix = this.truncateToLines(context.suffix, this.suffixLines, false);
    const language =
      context.language ??
      (context.filePath ? this.detectLanguage(context.filePath) : "unknown");

    const memoryBlock =
      context.memoryContext
        ? `\n// Context:\n${context.memoryContext
            .split("\n")
            .map((l) => `// ${l}`)
            .join("\n")}\n`
        : "";

    let prompt: string;

    switch (model) {
      case "starcoder":
        prompt = `<fim_prefix>${memoryBlock}${prefix}<fim_suffix>${suffix}<fim_middle>`;
        break;

      case "codellama":
        prompt = `<PRE> ${memoryBlock}${prefix} <SUF> ${suffix} <MID>`;
        break;

      case "deepseek-coder":
        prompt = `<｜fim▁begin｜>${memoryBlock}${prefix}<｜fim▁hole｜>${suffix}<｜fim▁end｜>`;
        break;

      case "claude":
        prompt = JSON.stringify({
          system: [
            `You are an expert ${language} programmer completing code inline.`,
            "Produce ONLY the code that replaces the <cursor> marker.",
            "Do not repeat the prefix or suffix. Output raw code only.",
            memoryBlock ? `Background context:\n${context.memoryContext}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
          user: `Complete the code at <cursor>:\n\`\`\`${language}\n${prefix}<cursor>${suffix}\n\`\`\``,
        });
        break;

      case "gpt":
        prompt = [
          memoryBlock,
          prefix,
          "// FILL IN THE BLANK",
          suffix,
        ]
          .filter((s) => s !== "")
          .join("\n");
        break;

      default: // "generic"
        prompt = `${memoryBlock}${prefix}[FILL]${suffix}`;
        break;
    }

    return {
      model,
      prompt,
      stopTokens: this.getStopTokens(model),
      maxTokens: this.defaultMaxTokens,
      temperature: this.defaultTemperature,
    };
  }

  /**
   * Post-process a raw model completion by removing artefacts and clamping to
   * a single logical code block.
   *
   * @param raw     - Raw text returned by the model.
   * @param context - Original FIM context (used to strip repeated prefix/suffix).
   * @returns Cleaned completion text.
   */
  postProcess(raw: string, context: FIMContext): string {
    let text = raw;

    // Strip all known stop tokens
    for (const model of Object.keys(STOP_TOKENS) as FIMModel[]) {
      for (const token of STOP_TOKENS[model]) {
        text = text.split(token).join("");
      }
    }

    // Remove prefix repetition (first 20 chars of prefix)
    const prefixSnippet = context.prefix.slice(-20).trimStart();
    if (prefixSnippet && text.startsWith(prefixSnippet)) {
      text = text.slice(prefixSnippet.length);
    }

    // Remove suffix repetition (first 20 chars of suffix)
    const suffixSnippet = context.suffix.slice(0, 20).trimEnd();
    if (suffixSnippet && text.endsWith(suffixSnippet)) {
      text = text.slice(0, text.length - suffixSnippet.length);
    }

    // Clamp to single logical block — stop at the first double newline
    const doubleNewline = text.indexOf("\n\n");
    if (doubleNewline !== -1) {
      text = text.slice(0, doubleNewline);
    }

    return text.trimEnd();
  }

  /**
   * Validate whether a completion is syntactically plausible and non-trivial.
   *
   * @param completion - Post-processed completion text.
   * @param context    - Original FIM context.
   * @returns `true` when the completion is acceptable.
   */
  validateCompletion(completion: string, _context: FIMContext): boolean {
    if (!completion || completion.trim().length === 0) return false;

    // Must not simply echo the end of the prefix
    const prefixTail = _context.prefix.slice(-50);
    if (prefixTail && completion.trimStart().startsWith(prefixTail.trimStart())) {
      return false;
    }

    // Balanced bracket/paren check for the completion itself
    let depth = 0;
    for (const ch of completion) {
      if (ch === "(" || ch === "[" || ch === "{") depth++;
      else if (ch === ")" || ch === "]" || ch === "}") depth--;
      if (depth < -1) return false; // more closes than opens is suspicious
    }

    return true;
  }

  /**
   * Build a {@link FIMContext} from a full file source string and a cursor
   * byte offset.
   *
   * @param filePath     - Absolute path (used for language detection).
   * @param code         - Full file content.
   * @param cursorOffset - Character offset of the cursor inside `code`.
   * @returns A populated {@link FIMContext}.
   */
  buildContext(filePath: string, code: string, cursorOffset: number): FIMContext {
    const safeOffset = Math.max(0, Math.min(cursorOffset, code.length));
    const prefix = code.slice(0, safeOffset);
    const suffix = code.slice(safeOffset);

    const lines = prefix.split("\n");
    const cursorLine = lines.length - 1;
    const cursorCol = lines[cursorLine]?.length ?? 0;

    return {
      prefix,
      suffix,
      filePath,
      language: this.detectLanguage(filePath),
      cursorLine,
      cursorCol,
    };
  }

  /**
   * Estimate a 0-1 confidence score for a completion.
   *
   * Scoring breakdown:
   * - 0.3 — completion is non-empty
   * - 0.3 — passes {@link validateCompletion}
   * - 0.2 — length is reasonable (1–200 chars)
   * - 0.2 — indentation matches surrounding context
   *
   * @param completion - Post-processed completion text.
   * @param context    - Original FIM context.
   */
  estimateConfidence(completion: string, context: FIMContext): number {
    if (!completion) return 0;

    let score = 0;

    // Non-empty
    score += 0.3;

    // Validates
    if (this.validateCompletion(completion, context)) {
      score += 0.3;
    }

    // Reasonable length
    if (completion.length >= 1 && completion.length <= 200) {
      score += 0.2;
    }

    // Indentation match — check leading whitespace of first completion line
    // vs the last non-empty line of the prefix
    const completionFirstLine = completion.split("\n")[0] ?? "";
    const completionIndent = completionFirstLine.match(/^(\s*)/)?.[1] ?? "";

    const prefixLines = context.prefix.split("\n");
    const lastPrefixLine =
      [...prefixLines].reverse().find((l) => l.trim().length > 0) ?? "";
    const prefixIndent = lastPrefixLine.match(/^(\s*)/)?.[1] ?? "";

    if (completionIndent.length >= prefixIndent.length) {
      score += 0.2;
    }

    return Math.min(1, score);
  }

  /**
   * Take the last `maxLines` lines from `text` (when `fromEnd` is true) or
   * the first `maxLines` lines (when `fromEnd` is false).
   *
   * @param text     - Multi-line text.
   * @param maxLines - Maximum number of lines to retain.
   * @param fromEnd  - When true, keep the *last* N lines (prefix context).
   */
  truncateToLines(text: string, maxLines: number, fromEnd = false): string {
    const lines = text.split("\n");
    if (lines.length <= maxLines) return text;
    if (fromEnd) {
      return lines.slice(lines.length - maxLines).join("\n");
    }
    return lines.slice(0, maxLines).join("\n");
  }

  /**
   * Detect the programming language from a file extension.
   *
   * @param filePath - Absolute or relative path.
   * @returns Language name, or `"unknown"` when unrecognised.
   */
  detectLanguage(filePath: string): string {
    const ext = extname(basename(filePath)).toLowerCase();
    return EXT_LANGUAGE_MAP[ext] ?? "unknown";
  }

  /**
   * Return the stop tokens appropriate for a given model family.
   *
   * @param model - Target model family.
   */
  getStopTokens(model: FIMModel): string[] {
    return STOP_TOKENS[model] ?? STOP_TOKENS["generic"];
  }
}
