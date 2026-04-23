// packages/vscode/src/completion-stop-sequences.ts
// Tabby-harvested: reversed-trie O(m) stop sequence detection.
// Source pattern: TabbyML/tabby crates/tabby-inference/src/completion.rs
// Uses Unicode-safe character spreading for multi-byte safety.

interface TrieNode {
  children: Map<string, TrieNode>;
  isEnd: boolean;
  word?: string;
}

function makeNode(): TrieNode {
  return { children: new Map(), isEnd: false };
}

export class StopSequenceTrie {
  private readonly _root: TrieNode = makeNode();

  /**
   * Insert a stop word. Words are stored reversed so suffix matching
   * can walk the trie from the end of the text.
   */
  insert(word: string): void {
    let node = this._root;
    // Unicode-safe reverse: spread to codepoints first
    for (const char of [...word].reverse()) {
      if (!node.children.has(char)) {
        node.children.set(char, makeNode());
      }
      node = node.children.get(char)!;
    }
    node.isEnd = true;
    node.word = word;
  }

  /**
   * Returns the matched stop word if `text` ends with one, else undefined.
   * O(m) where m = length of stop word.
   */
  matchSuffix(text: string): string | undefined {
    let node = this._root;
    for (const char of [...text].reverse()) {
      if (!node.children.has(char)) return undefined;
      node = node.children.get(char)!;
      if (node.isEnd) return node.word;
    }
    return node.isEnd ? node.word : undefined;
  }
}

// Per-language stop sequence lists (Tabby-harvested)
const STOP_SEQUENCES: Record<string, string[]> = {
  typescript: ["\n\n", "}\n\n", "//", "/*", "\nclass ", "\nfunction ", "\nexport ", "\nimport ", "\nconst ", "\nlet "],
  javascript: ["\n\n", "}\n\n", "//", "/*", "\nclass ", "\nfunction ", "\nexport ", "\nimport ", "\nconst ", "\nlet "],
  python: ["\n\n", "\ndef ", "\nclass ", "\n@", "\nif __name__", "# "],
  rust: ["\n\n", "\nfn ", "\npub fn ", "\nimpl ", "\nstruct ", "\nenum ", "\nmod ", "//"],
  go: ["\n\n", "\nfunc ", "\ntype ", "\nvar ", "\nconst ", "\npackage ", "//"],
  java: ["\n\n", "\npublic ", "\nprivate ", "\nprotected ", "\nclass ", "\ninterface "],
  ruby: ["\n\n", "\ndef ", "\nclass ", "\nmodule "],
  cpp: ["\n\n", "\nvoid ", "\nint ", "\nbool ", "\nclass ", "\nstruct ", "//"],
  c: ["\n\n", "\nvoid ", "\nint ", "\nbool ", "\nstruct ", "//"],
  php: ["\n\n", "\nfunction ", "\nclass ", "\npublic ", "//"],
  csharp: ["\n\n", "\nclass ", "\nnamespace ", "\npublic ", "\nprivate ", "\nprotected ", "//"],
  kotlin: ["\n\n", "\nfun ", "\nclass ", "\nobject ", "\nval ", "\nvar ", "//"],
  swift: ["\n\n", "\nfunc ", "\nstruct ", "\nclass ", "\nenum ", "\nvar ", "\nlet "],
  scala: ["\n\n", "\ndef ", "\nobject ", "\nclass ", "\ntrait ", "\nval ", "\nvar "],
  default: ["\n\n"],
};

const LANGUAGE_ALIASES: Record<string, string> = {
  typescriptreact: "typescript",
  javascriptreact: "javascript",
};

export class StopSequenceDetector {
  private static readonly _cache = new Map<string, StopSequenceDetector>();

  private readonly _trie: StopSequenceTrie;
  private readonly _sequences: string[];

  private constructor(languageId: string) {
    const key = LANGUAGE_ALIASES[languageId] ?? languageId;
    this._sequences = STOP_SEQUENCES[key] ?? STOP_SEQUENCES["default"]!;
    this._trie = new StopSequenceTrie();
    for (const seq of this._sequences) {
      this._trie.insert(seq);
    }
  }

  static forLanguage(languageId: string): StopSequenceDetector {
    const key = LANGUAGE_ALIASES[languageId] ?? languageId;
    if (!StopSequenceDetector._cache.has(key)) {
      StopSequenceDetector._cache.set(key, new StopSequenceDetector(key));
    }
    return StopSequenceDetector._cache.get(key)!;
  }

  /** Returns matched stop word if text ends with one */
  checkStop(text: string): string | undefined {
    return this._trie.matchSuffix(text);
  }

  /** Returns the stop sequence list for passing to the model */
  getStopSequences(): string[] {
    return this._sequences;
  }

  /** For testing only — clears the singleton cache */
  static _clearCache(): void {
    StopSequenceDetector._cache.clear();
  }
}

/**
 * Tracks bracket balance across streaming completion chunks.
 * Returns `{ balanced: true }` when all opened brackets are closed,
 * signalling that the completion block is structurally complete.
 */
export class BracketBalanceDetector {
  private _depth = 0;
  private _seenOpen = false;

  private static readonly OPEN = new Set(["{", "(", "["]);
  private static readonly CLOSE = new Map<string, string>([
    ["}", "{"],
    [")", "("],
    ["]", "["],
  ]);

  /** Accumulate text and check balance. */
  check(text: string): { balanced: boolean; depth: number } {
    for (const ch of text) {
      if (BracketBalanceDetector.OPEN.has(ch)) {
        this._depth++;
        this._seenOpen = true;
      } else if (BracketBalanceDetector.CLOSE.has(ch)) {
        this._depth = Math.max(0, this._depth - 1);
      }
    }
    return { balanced: this._seenOpen && this._depth === 0, depth: this._depth };
  }

  /** Reset balance state. */
  reset(): void {
    this._depth = 0;
    this._seenOpen = false;
  }
}
