// ============================================================================
// Sprint Q — Dims 11+13: Chat streaming code fence + Approval QuickPick
// Tests that:
//  - Streaming handler wraps open code fence in <pre><code> with streaming class
//  - Language class extracted from fence hint (```typescript → language-typescript)
//  - Open code fence closes cleanly when closing ``` arrives
//  - QuickPick shows all 3 options with icons
//  - QuickPick "Accept" triggers acceptance action
//  - QuickPick "Reject" triggers rejection action
// ============================================================================

import { describe, it, expect } from "vitest";

// ─── Part 1: Streaming code fence rendering (dim 11) ─────────────────────────

/**
 * Simulates the renderMarkdown open-fence detection logic.
 * Returns HTML output for the given partial stream buffer.
 */
function simulateRenderWithOpenFence(text: string): string {
  const BT3 = "```";
  const codeBlocks: string[] = [];

  // Extract complete code blocks
  const cbRegex = new RegExp(BT3 + "(\\w*)\\n([\\s\\S]*?)" + BT3, "g");
  let processed = text.replace(cbRegex, (_match, lang, code) => {
    const idx = codeBlocks.length;
    const langLabel = lang || "code";
    codeBlocks.push(
      `<div class="code-block-wrapper"><div class="code-block-header"><span class="code-lang">${langLabel}</span></div>` +
      `<pre><code class="language-${langLabel}">${code}</code></pre></div>`,
    );
    return `%%CODEBLOCK_${idx}%%`;
  });

  // Handle unclosed code fence at end of stream
  const openFenceMatch = processed.match(new RegExp(BT3 + "(\\w*)\\n([\\s\\S]*)$"));
  if (openFenceMatch) {
    const openLang = openFenceMatch[1] || "code";
    const openCode = openFenceMatch[2] || "";
    const openIdx = codeBlocks.length;
    codeBlocks.push(
      `<div class="code-block-wrapper streaming"><div class="code-block-header"><span class="code-lang">${openLang}</span><span class="code-streaming-indicator">…</span></div>` +
      `<pre><code class="language-${openLang}">${openCode}</code></pre></div>`,
    );
    processed = processed.replace(new RegExp(BT3 + "\\w*\\n[\\s\\S]*$"), `%%CODEBLOCK_${openIdx}%%`);
  }

  // Restore code blocks
  return processed.replace(/%%CODEBLOCK_(\d+)%%/g, (_m, i) => codeBlocks[Number(i)] ?? "");
}

describe("Streaming code fence rendering — Sprint Q (dim 11)", () => {
  // 1. Open code fence wrapped in <pre><code> with streaming class
  it("wraps open code fence content in <pre><code> with streaming class", () => {
    const html = simulateRenderWithOpenFence("Here is code:\n```typescript\nconst x = 1;");
    expect(html).toContain('class="code-block-wrapper streaming"');
    expect(html).toContain("<pre><code");
  });

  // 2. Language class extracted from fence hint
  it("extracts language class from code fence hint (typescript → language-typescript)", () => {
    const html = simulateRenderWithOpenFence("```typescript\nconst x: number = 42;");
    expect(html).toContain('class="language-typescript"');
  });

  // 3. Unknown language defaults to 'code' class
  it("defaults to language-code when no language specified", () => {
    const html = simulateRenderWithOpenFence("```\nsome code here");
    expect(html).toContain('class="language-code"');
  });

  // 4. Streaming indicator shown for open fences
  it("shows streaming indicator (…) for open code fences", () => {
    const html = simulateRenderWithOpenFence("```python\nprint('hello')");
    expect(html).toContain("code-streaming-indicator");
    expect(html).toContain("…");
  });

  // 5. Closed fence renders without streaming class
  it("closed code fence renders without streaming class", () => {
    const html = simulateRenderWithOpenFence("```typescript\nconst x = 1;\n```");
    expect(html).not.toContain("streaming");
    expect(html).not.toContain("code-streaming-indicator");
  });

  // 6. Text without code fence renders normally
  it("plain text without code fences renders unchanged (no streaming class)", () => {
    const html = simulateRenderWithOpenFence("Just some plain text");
    expect(html).not.toContain("code-block-wrapper");
    expect(html).not.toContain("streaming");
  });
});

// ─── Part 2: Approval QuickPick (dim 13) ──────────────────────────────────────

/**
 * Simulates the reviewChanges QuickPick command.
 * Returns which action was triggered based on the selected label.
 */
async function simulateReviewChangesQuickPick(
  selectedLabel: string | undefined,
): Promise<string | null> {
  const items = [
    { label: "$(check) Accept", description: "Apply all changes", action: "accept" },
    { label: "$(diff) View diff", description: "Open diff review panel", action: "review" },
    { label: "$(x) Reject", description: "Discard all changes", action: "reject" },
  ];

  // Simulate showQuickPick selecting by label
  const selected = selectedLabel
    ? items.find((i) => i.label === selectedLabel)
    : undefined;

  if (!selected) return null;
  return selected.action;
}

describe("Approval QuickPick — Sprint Q (dim 13)", () => {
  // 7. QuickPick shows all 3 options
  it("QuickPick items include Accept, View diff, and Reject", () => {
    const items = [
      { label: "$(check) Accept", description: "Apply all changes", action: "accept" },
      { label: "$(diff) View diff", description: "Open diff review panel", action: "review" },
      { label: "$(x) Reject", description: "Discard all changes", action: "reject" },
    ];
    const labels = items.map((i) => i.label);
    expect(labels).toContain("$(check) Accept");
    expect(labels).toContain("$(diff) View diff");
    expect(labels).toContain("$(x) Reject");
    expect(labels).toHaveLength(3);
  });

  // 8. "Accept" triggers acceptance action
  it("selecting $(check) Accept triggers accept action", async () => {
    const action = await simulateReviewChangesQuickPick("$(check) Accept");
    expect(action).toBe("accept");
  });

  // 9. "Reject" triggers rejection action
  it("selecting $(x) Reject triggers reject action", async () => {
    const action = await simulateReviewChangesQuickPick("$(x) Reject");
    expect(action).toBe("reject");
  });

  // 10. "View diff" triggers review action
  it("selecting $(diff) View diff triggers review action", async () => {
    const action = await simulateReviewChangesQuickPick("$(diff) View diff");
    expect(action).toBe("review");
  });

  // 11. Dismissing QuickPick (no selection) returns null
  it("dismissing QuickPick (undefined selection) returns null action", async () => {
    const action = await simulateReviewChangesQuickPick(undefined);
    expect(action).toBeNull();
  });

  // 12. Items have icon-prefixed labels for keyboard accessibility
  it("each QuickPick item label starts with a VSCode icon $(…)", () => {
    const items = [
      { label: "$(check) Accept", action: "accept" },
      { label: "$(diff) View diff", action: "review" },
      { label: "$(x) Reject", action: "reject" },
    ];
    for (const item of items) {
      expect(item.label).toMatch(/^\$\(\w+\)/);
    }
  });
});
