// packages/core/src/__tests__/xml-tool-call-parser.test.ts
// Sprint 4 — XmlToolCallParser: 12 test cases covering the 5-state streaming FSM

import { describe, it, expect } from "vitest";
import { XmlToolCallParser, XmlParserState } from "../xml-tool-call-parser.js";
import type { XmlParserEvent, XmlToolBlock } from "../xml-tool-call-parser.js";

function collectEvents(chunks: string[]): XmlParserEvent[] {
  const events: XmlParserEvent[] = [];
  const parser = new XmlToolCallParser((e) => events.push(e));
  for (const chunk of chunks) parser.feed(chunk);
  return events;
}

function toolBlocks(events: XmlParserEvent[]): XmlToolBlock[] {
  return events
    .filter((e): e is Extract<XmlParserEvent, { type: "tool_block_complete" }> =>
      e.type === "tool_block_complete",
    )
    .map((e) => e.block);
}

// ─── 1. Text-only response ────────────────────────────────────────────────────

describe("XmlToolCallParser — text-only response", () => {
  it("fires no tool_block_complete events for plain text", () => {
    const events = collectEvents(["Just plain text, no tools here."]);
    expect(toolBlocks(events)).toHaveLength(0);
  });

  it("emits all characters as text_chunk events", () => {
    const events = collectEvents(["Hi!"]);
    const text = events
      .filter((e) => e.type === "text_chunk")
      .map((e) => (e as { type: "text_chunk"; text: string }).text)
      .join("");
    expect(text).toBe("Hi!");
  });
});

// ─── 2. Single complete block in one chunk ────────────────────────────────────

describe("XmlToolCallParser — single complete block", () => {
  it("fires one tool_block_complete event with correct payload", () => {
    const payload = '{"name":"Read","input":{"file_path":"a.ts"}}';
    const events = collectEvents([`<tool_use>${payload}</tool_use>`]);
    const blocks = toolBlocks(events);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.payload).toBe(payload);
  });
});

// ─── 3. Block split across 5-char chunks ─────────────────────────────────────

describe("XmlToolCallParser — chunked delivery", () => {
  it("fires one event after the final chunk regardless of split point", () => {
    const full = '<tool_use>{"name":"Read","input":{"file_path":"x.ts"}}</tool_use>';
    const chunks: string[] = [];
    for (let i = 0; i < full.length; i += 5) chunks.push(full.slice(i, i + 5));
    const blocks = toolBlocks(collectEvents(chunks));
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.payload).toBe('{"name":"Read","input":{"file_path":"x.ts"}}');
  });
});

// ─── 4. </tool_use> inside a JSON string value ───────────────────────────────

describe("XmlToolCallParser — </tool_use> inside JSON string", () => {
  it("emits exactly one event when close tag appears inside a string value", () => {
    const raw =
      '<tool_use>{"name":"Edit","input":{"old_string":"see </tool_use> tag","new_string":"x"}}</tool_use>';
    const blocks = toolBlocks(collectEvents([raw]));
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.payload).toBe(
      '{"name":"Edit","input":{"old_string":"see </tool_use> tag","new_string":"x"}}',
    );
  });
});

// ─── 5. Chained tool calls ────────────────────────────────────────────────────

describe("XmlToolCallParser — chained tool calls", () => {
  it("fires two events in order for two consecutive blocks", () => {
    const a = '<tool_use>{"name":"Read","input":{"file_path":"a.ts"}}</tool_use>';
    const b = '<tool_use>{"name":"Write","input":{"file_path":"b.ts","content":"x"}}</tool_use>';
    const blocks = toolBlocks(collectEvents([a + b]));
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.payload).toContain('"Read"');
    expect(blocks[1]!.payload).toContain('"Write"');
  });
});

// ─── 6. Epilogue detection ────────────────────────────────────────────────────

describe("XmlToolCallParser — epilogue detection", () => {
  it("fires tool_block_complete then text_chunk events for epilogue text", () => {
    const events = collectEvents([
      '<tool_use>{"name":"GitPush","input":{}}</tool_use> ✅ Push succeeded!',
    ]);
    const blocks = toolBlocks(events);
    const textChunks = events
      .filter((e) => e.type === "text_chunk")
      .map((e) => (e as { type: "text_chunk"; text: string }).text)
      .join("");

    expect(blocks).toHaveLength(1);
    expect(textChunks).toContain("✅");
    // tool_block_complete must appear before any text_chunk that contains "✅"
    const blockIdx = events.findIndex((e) => e.type === "tool_block_complete");
    const epilogueIdx = events.findIndex(
      (e) => e.type === "text_chunk" && (e as { text: string }).text.includes("✅"),
    );
    expect(blockIdx).toBeGreaterThanOrEqual(0);
    expect(epilogueIdx).toBeGreaterThan(blockIdx);
  });
});

// ─── 7. Escaped quote inside JSON string ─────────────────────────────────────

describe("XmlToolCallParser — escaped quote in JSON string", () => {
  it("does not exit string state on backslash-escaped quote", () => {
    // The \" inside should not close the string or trigger a false close-tag scan
    const raw = '<tool_use>{"name":"Bash","input":{"command":"echo \\"hello\\""}}</tool_use>';
    const blocks = toolBlocks(collectEvents([raw]));
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.payload).toContain('\\"hello\\"');
  });
});

// ─── 8. Partial block + flush ─────────────────────────────────────────────────

describe("XmlToolCallParser — partial block and flush", () => {
  it("fires no event for an unclosed block, and resets state after flush", () => {
    const events: XmlParserEvent[] = [];
    const parser = new XmlToolCallParser((e) => events.push(e));
    parser.feed('<tool_use>{"name":"Re');
    expect(toolBlocks(events)).toHaveLength(0);
    parser.flush();
    expect(parser.state).toBe(XmlParserState.SCANNING);
  });
});

// ─── 9. reset() between rounds ───────────────────────────────────────────────

describe("XmlToolCallParser — reset between rounds", () => {
  it("returns to SCANNING state after reset", () => {
    const parser = new XmlToolCallParser(() => {});
    parser.feed('<tool_use>{"name":"Read","input":{"file_path":"a.ts"}}</tool_use>');
    parser.reset();
    expect(parser.state).toBe(XmlParserState.SCANNING);
  });

  it("correctly parses a new block after reset", () => {
    const blocks: XmlToolBlock[] = [];
    const parser = new XmlToolCallParser((e) => {
      if (e.type === "tool_block_complete") blocks.push(e.block);
    });
    parser.feed('<tool_use>{"name":"Read","input":{}}</tool_use>');
    parser.reset();
    parser.feed('<tool_use>{"name":"Write","input":{"file_path":"b.ts","content":"hi"}}</tool_use>');
    expect(blocks).toHaveLength(2);
    expect(blocks[1]!.payload).toContain('"Write"');
  });
});

// ─── 10. False close tag ─────────────────────────────────────────────────────

describe("XmlToolCallParser — false close tag", () => {
  it("treats </tool_use_extra> as payload content, not a block end", () => {
    const raw =
      '<tool_use>{"name":"Bash","input":{"command":"grep </tool_use_extra> file.ts"}}</tool_use>';
    const blocks = toolBlocks(collectEvents([raw]));
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.payload).toContain("</tool_use_extra>");
  });
});

// ─── 11. Empty payload ────────────────────────────────────────────────────────

describe("XmlToolCallParser — empty payload", () => {
  it("fires tool_block_complete with empty payload for <tool_use></tool_use>", () => {
    const blocks = toolBlocks(collectEvents(["<tool_use></tool_use>"]));
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.payload).toBe("");
  });
});

// ─── 12. Unicode chars in payload ────────────────────────────────────────────

describe("XmlToolCallParser — unicode chars in payload", () => {
  it("handles multi-byte unicode without corruption", () => {
    const payload = '{"name":"Write","input":{"file_path":"x.ts","content":"héllo wörld 🎉"}}';
    const blocks = toolBlocks(collectEvents([`<tool_use>${payload}</tool_use>`]));
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.payload).toBe(payload);
  });
});

// ─── 13. tool_block_start event ──────────────────────────────────────────────

describe("XmlToolCallParser — tool_block_start event", () => {
  it("fires tool_block_start before tool_block_complete for a complete block", () => {
    const events = collectEvents(['<tool_use>{"name":"Bash"}</tool_use>']);
    const types = events.filter((e) => e.type === "tool_block_start" || e.type === "tool_block_complete").map((e) => e.type);
    expect(types).toEqual(["tool_block_start", "tool_block_complete"]);
  });

  it("fires tool_block_start even when the stream is truncated after the open tag", () => {
    const events = collectEvents(['<tool_use>{"name":"Bash","input":']);
    expect(events.some((e) => e.type === "tool_block_start")).toBe(true);
    expect(events.some((e) => e.type === "tool_block_complete")).toBe(false);
  });

  it("does NOT fire tool_block_start for plain text with no tool call", () => {
    const events = collectEvents(["Score: 92/100. No tool here."]);
    expect(events.some((e) => e.type === "tool_block_start")).toBe(false);
  });

  it("fires tool_block_start once per block when multiple tool blocks are present", () => {
    const events = collectEvents([
      '<tool_use>{"name":"Read"}</tool_use>',
      ' some text ',
      '<tool_use>{"name":"Bash"}</tool_use>',
    ]);
    const starts = events.filter((e) => e.type === "tool_block_start");
    expect(starts).toHaveLength(2);
  });
});
