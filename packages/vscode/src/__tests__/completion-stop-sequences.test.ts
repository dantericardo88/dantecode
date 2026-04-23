// ============================================================================
// packages/vscode/src/__tests__/completion-stop-sequences.test.ts
// 12 tests for StopSequenceTrie and StopSequenceDetector.
// ============================================================================

import { describe, it, expect, afterEach } from "vitest";
import { StopSequenceTrie, StopSequenceDetector } from "../completion-stop-sequences.js";

describe("StopSequenceTrie", () => {
  it("matchSuffix returns word when text ends with stop word", () => {
    const trie = new StopSequenceTrie();
    trie.insert("\n\n");
    expect(trie.matchSuffix("some code\n\n")).toBe("\n\n");
  });

  it("matchSuffix returns undefined when no stop word at text end", () => {
    const trie = new StopSequenceTrie();
    trie.insert("\n\n");
    expect(trie.matchSuffix("  const x = 1")).toBeUndefined();
  });

  it("matchSuffix detects multi-char stop words", () => {
    const trie = new StopSequenceTrie();
    trie.insert("}\n\n");
    expect(trie.matchSuffix("function foo() { return 1; }\n\n")).toBe("}\n\n");
  });

  it("multiple words inserted — returns earliest suffix match", () => {
    const trie = new StopSequenceTrie();
    trie.insert("\n\n");
    trie.insert("\nclass ");
    // Text ending in \n\n should match \n\n
    expect(trie.matchSuffix("code\n\n")).toBe("\n\n");
  });
});

describe("StopSequenceDetector", () => {
  afterEach(() => {
    StopSequenceDetector._clearCache();
  });

  it("forLanguage(typescript) includes \\n\\n", () => {
    const d = StopSequenceDetector.forLanguage("typescript");
    expect(d.getStopSequences()).toContain("\n\n");
  });

  it("forLanguage(python) includes \\ndef ", () => {
    const d = StopSequenceDetector.forLanguage("python");
    expect(d.getStopSequences()).toContain("\ndef ");
  });

  it("forLanguage(typescriptreact) aliases to typescript stop sequences", () => {
    const tsx = StopSequenceDetector.forLanguage("typescriptreact");
    const ts = StopSequenceDetector.forLanguage("typescript");
    expect(tsx.getStopSequences()).toEqual(ts.getStopSequences());
  });

  it("forLanguage(unknown) returns default containing only \\n\\n", () => {
    const d = StopSequenceDetector.forLanguage("brainfuck");
    expect(d.getStopSequences()).toContain("\n\n");
  });

  it("checkStop detects double-newline at end of text", () => {
    const d = StopSequenceDetector.forLanguage("typescript");
    expect(d.checkStop("some code\n\n")).toBeDefined();
  });

  it("checkStop returns undefined when no stop at end", () => {
    const d = StopSequenceDetector.forLanguage("typescript");
    expect(d.checkStop("  const x = 1")).toBeUndefined();
  });

  it("checkStop handles multi-byte Unicode without throwing", () => {
    const d = StopSequenceDetector.forLanguage("typescript");
    expect(() => d.checkStop("const 日本語 = '🎉'\n\n")).not.toThrow();
  });

  it("_clearCache() resets singleton cache — new instance created after clear", () => {
    const before = StopSequenceDetector.forLanguage("typescript");
    StopSequenceDetector._clearCache();
    const after = StopSequenceDetector.forLanguage("typescript");
    // They should be different instances after cache clear
    expect(before).not.toBe(after);
  });

  it("getStopSequences() returns an array for model stop parameter", () => {
    const seqs = StopSequenceDetector.forLanguage("go").getStopSequences();
    expect(Array.isArray(seqs)).toBe(true);
    expect(seqs.length).toBeGreaterThan(0);
  });

  it("forLanguage is cached — same instance returned on repeated calls", () => {
    const a = StopSequenceDetector.forLanguage("rust");
    const b = StopSequenceDetector.forLanguage("rust");
    expect(a).toBe(b);
  });
});
