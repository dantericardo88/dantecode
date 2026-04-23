// packages/cli/src/markdown-renderer.ts
// Streaming ANSI markdown renderer for terminal chat output.
// Zero dependencies — pure ANSI escape sequences.
// Renders line-by-line: headers, bold, italic, inline code, code fences,
// blockquotes, bullet/numbered lists, horizontal rules, and links.
//
// Closes dim 8 (chat UX) gap: Cursor/Copilot render syntax-highlighted
// markdown in their chat panels. This gives DanteCode equivalent quality
// in the terminal with ANSI colors.

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const ITALIC = "\x1b[3m";
const UNDERLINE = "\x1b[4m";
const CYAN = "\x1b[36m";
const BLUE = "\x1b[34m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const MAGENTA = "\x1b[35m";
const BG_DARK = "\x1b[48;5;235m";  // Dark gray background for code blocks
const BG_RESET = "\x1b[49m";

// ─── Language → Color Mapping ────────────────────────────────────────────────

// Keywords for basic syntax coloring inside code fences
const KEYWORDS_TS = /\b(const|let|var|function|class|interface|type|return|export|import|from|async|await|new|if|else|for|while|switch|case|break|continue|try|catch|throw|void|string|number|boolean|null|undefined|true|false)\b/g;
const KEYWORDS_PY = /\b(def|class|return|import|from|as|if|elif|else|for|while|try|except|with|yield|lambda|pass|break|continue|raise|None|True|False|and|or|not|in|is)\b/g;
const KEYWORDS_RUST = /\b(fn|let|mut|pub|use|mod|struct|enum|impl|trait|where|for|if|else|match|return|self|Self|true|false|Some|None|Ok|Err|async|await|crate|super|move|ref|dyn|unsafe|extern)\b/g;
const KEYWORDS_GENERIC = /\b(function|return|class|if|else|for|while|const|let|var|import|export|true|false|null|undefined)\b/g;

const LANG_KEYWORD_MAP: Record<string, RegExp> = {
  typescript: KEYWORDS_TS, tsx: KEYWORDS_TS,
  javascript: KEYWORDS_TS, jsx: KEYWORDS_TS,
  python: KEYWORDS_PY, py: KEYWORDS_PY,
  rust: KEYWORDS_RUST, rs: KEYWORDS_RUST,
};

function colorKeywords(code: string, lang: string): string {
  const pattern = LANG_KEYWORD_MAP[lang] ?? KEYWORDS_GENERIC;
  // Reset the regex lastIndex (global flag)
  pattern.lastIndex = 0;
  return code.replace(pattern, (kw) => `${YELLOW}${kw}${RESET}`);
}

function colorStrings(code: string): string {
  // Color string literals green
  return code
    .replace(/(["'`])((?:[^\\]|\\.)*?)\1/g, (_, q, s) => `${GREEN}${q}${s}${q}${RESET}`)
    .replace(/\/\/.*/g, (c) => `${DIM}${c}${RESET}`)  // single-line comments
    .replace(/(\/\*[\s\S]*?\*\/)/g, (c) => `${DIM}${c}${RESET}`);  // block comments
}

function highlightCode(code: string, lang: string): string {
  let result = code;
  result = colorStrings(result);
  result = colorKeywords(result, lang.toLowerCase());
  return result;
}

// ─── Inline Markdown Formatters ──────────────────────────────────────────────

function renderInline(text: string): string {
  return text
    // Bold+italic: ***text***
    .replace(/\*\*\*(.+?)\*\*\*/g, `${BOLD}${ITALIC}$1${RESET}`)
    // Bold: **text** or __text__
    .replace(/\*\*(.+?)\*\*/g, `${BOLD}$1${RESET}`)
    .replace(/__(.+?)__/g, `${BOLD}$1${RESET}`)
    // Italic: *text* or _text_
    .replace(/\*(.+?)\*/g, `${ITALIC}$1${RESET}`)
    .replace(/_(.+?)_/g, `${ITALIC}$1${RESET}`)
    // Inline code: `code`
    .replace(/`([^`]+)`/g, `${BG_DARK}${CYAN}$1${RESET}`)
    // Links: [text](url)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, `${UNDERLINE}${BLUE}$1${RESET}${DIM}($2)${RESET}`)
    // Strikethrough: ~~text~~
    .replace(/~~(.+?)~~/g, `${DIM}$1${RESET}`);
}

// ─── Line Renderer ────────────────────────────────────────────────────────────

export interface RenderedLine {
  /** ANSI-colored line ready to print */
  output: string;
  /** True if this line is inside a code fence */
  inCodeFence: boolean;
}

export interface MarkdownRendererState {
  inCodeFence: boolean;
  codeFenceLang: string;
  codeFenceChar: string;
  listDepth: number;
}

export function initialState(): MarkdownRendererState {
  return { inCodeFence: false, codeFenceLang: "", codeFenceChar: "", listDepth: 0 };
}

/**
 * Render a single line of markdown text into an ANSI string.
 * Mutates `state` to track multi-line constructs (code fences).
 * Safe to call token-by-token if called once per complete line.
 */
export function renderLine(line: string, state: MarkdownRendererState): string {
  // ── Code fence toggle ──
  const fenceMatch = line.match(/^(`{3,}|~{3,})(\w*)\s*$/);
  if (fenceMatch) {
    const [, fenceChar, lang] = fenceMatch;
    if (!state.inCodeFence) {
      state.inCodeFence = true;
      state.codeFenceLang = lang ?? "";
      state.codeFenceChar = fenceChar!;
      const label = lang ? `${DIM} ${lang}${RESET}` : "";
      return `${BG_DARK}${DIM}${"─".repeat(40)}${label}${RESET}`;
    } else if (fenceChar === state.codeFenceChar) {
      state.inCodeFence = false;
      state.codeFenceLang = "";
      return `${BG_DARK}${DIM}${"─".repeat(40)}${RESET}`;
    }
  }

  // ── Inside code fence ──
  if (state.inCodeFence) {
    const highlighted = highlightCode(line, state.codeFenceLang);
    return `${BG_DARK}  ${highlighted}${BG_RESET}`;
  }

  // ── Horizontal rule ──
  if (/^---+$|^\*\*\*+$|^___+$/.test(line.trim())) {
    return `${DIM}${"─".repeat(60)}${RESET}`;
  }

  // ── Headings ──
  const h3 = line.match(/^### (.+)/);
  if (h3) return `\n${BOLD}${BLUE}${h3[1]}${RESET}`;
  const h2 = line.match(/^## (.+)/);
  if (h2) return `\n${BOLD}${CYAN}${h2[1]}${RESET}\n${DIM}${"─".repeat(Math.min((h2[1] ?? "").length, 50))}${RESET}`;
  const h1 = line.match(/^# (.+)/);
  if (h1) return `\n${BOLD}${MAGENTA}${h1[1]}${RESET}\n${DIM}${"═".repeat(Math.min((h1[1] ?? "").length, 50))}${RESET}`;

  // ── Blockquote ──
  const bq = line.match(/^> (.+)/);
  if (bq) return `${DIM}│${RESET} ${ITALIC}${renderInline(bq[1] ?? "")}${RESET}`;

  // ── Bullet list ──
  const bullet = line.match(/^(\s*)([-*+]) (.+)/);
  if (bullet) {
    const indent = (bullet[1] ?? "").length;
    const dot = indent > 0 ? `${DIM}◦${RESET}` : `${CYAN}•${RESET}`;
    return `${"  ".repeat(indent / 2)}${dot} ${renderInline(bullet[3] ?? "")}`;
  }

  // ── Numbered list ──
  const numbered = line.match(/^(\s*)(\d+)\. (.+)/);
  if (numbered) {
    const indent = (numbered[1] ?? "").length;
    return `${"  ".repeat(indent / 2)}${CYAN}${numbered[2]}.${RESET} ${renderInline(numbered[3] ?? "")}`;
  }

  // ── Empty line ──
  if (line.trim() === "") return "";

  // ── Normal paragraph ──
  return renderInline(line);
}

// ─── Streaming Markdown Renderer ─────────────────────────────────────────────

/**
 * Line-buffered streaming markdown renderer.
 *
 * Feed token chunks as they arrive from the model stream.
 * Complete lines are rendered and returned immediately.
 * The partial last line is held in buffer until `flush()` is called.
 */
export class StreamingMarkdownRenderer {
  private _buffer = "";
  private _state: MarkdownRendererState = initialState();

  /**
   * Feed a token chunk. Returns any complete lines rendered as ANSI strings.
   * Multiple lines may be returned if the chunk contains newlines.
   */
  push(chunk: string): string[] {
    this._buffer += chunk;
    const lines = this._buffer.split("\n");
    // Last element is the partial current line — keep in buffer
    this._buffer = lines.pop() ?? "";

    return lines.map((line) => renderLine(line, this._state));
  }

  /**
   * Flush the remaining partial line (call at stream end).
   * Returns the rendered partial line if non-empty.
   */
  flush(): string[] {
    if (this._buffer.length === 0) return [];
    const rendered = renderLine(this._buffer, this._state);
    this._buffer = "";
    return [rendered];
  }

  /** Reset for a new message. */
  reset(): void {
    this._buffer = "";
    this._state = initialState();
  }

  /** Whether we are currently inside a code fence. */
  get inCodeFence(): boolean {
    return this._state.inCodeFence;
  }
}
