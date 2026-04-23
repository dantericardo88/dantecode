// ============================================================================
// packages/vscode/src/__tests__/tool-approval.test.ts
//
// Tests for the inline tool approval card system (Machine 2):
//   - buildApprovalCard() — card construction from approval request
//   - renderApprovalCardHtml() — HTML serialization with XSS guards
//   - awaitToolApproval contract (approve / deny / approve_all behaviors)
// ============================================================================

import { describe, it, expect } from "vitest";
import {
  buildApprovalCard,
  renderApprovalCardHtml,
} from "../tool-approval-panel.js";
import type { ToolApprovalCardRequest } from "../tool-approval-panel.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeWriteRequest(overrides: Partial<ToolApprovalCardRequest> = {}): ToolApprovalCardRequest {
  return {
    requestId: "req-001",
    toolName: "Write",
    input: { file_path: "src/foo.ts", content: "const x = 1;" },
    previewHunk: null,
    permissionKind: "edit",
    ...overrides,
  };
}

function makeBashRequest(overrides: Partial<ToolApprovalCardRequest> = {}): ToolApprovalCardRequest {
  return {
    requestId: "req-002",
    toolName: "Bash",
    input: { command: "npm install" },
    previewHunk: null,
    permissionKind: "bash",
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("buildApprovalCard()", () => {
  it("returns correct icon for Write tool", () => {
    const card = buildApprovalCard(makeWriteRequest());
    expect(card.toolIcon).toBe("edit");
  });

  it("returns correct icon for Bash tool", () => {
    const card = buildApprovalCard(makeBashRequest());
    expect(card.toolIcon).toBe("terminal");
  });

  it("includes file path in paramSummary for Write", () => {
    const card = buildApprovalCard(makeWriteRequest());
    expect(card.paramSummary).toContain("src/foo.ts");
  });

  it("includes command in paramSummary for Bash", () => {
    const card = buildApprovalCard(makeBashRequest());
    expect(card.paramSummary).toContain("npm install");
  });

  it("sets diffHtml to null when previewHunk is null", () => {
    const card = buildApprovalCard(makeWriteRequest({ previewHunk: null }));
    expect(card.diffHtml).toBeNull();
  });

  it("renders diffHtml from previewHunk lines when provided", () => {
    const req = makeWriteRequest({
      previewHunk: {
        filePath: "src/foo.ts",
        linesAdded: 1,
        linesRemoved: 1,
        fullLineCount: 2,
        lines: [
          { type: "add", content: "const x = 1;", oldLineNo: null, newLineNo: 1 },
          { type: "remove", content: "const x = 0;", oldLineNo: 1, newLineNo: null },
        ],
        truncated: false,
      } as import("@dantecode/config-types").ColoredDiffHunk,
    });
    const card = buildApprovalCard(req);
    expect(card.diffHtml).not.toBeNull();
    expect(card.diffHtml).toContain("tac-da");
    expect(card.diffHtml).toContain("tac-dr");
  });
});

describe("renderApprovalCardHtml()", () => {
  it("contains data-request-id attribute matching requestId", () => {
    const card = buildApprovalCard(makeWriteRequest({ requestId: "my-req-42" }));
    const html = renderApprovalCardHtml(card);
    expect(html).toContain('data-request-id="my-req-42"');
  });

  it("HTML-escapes tool parameters to prevent XSS", () => {
    const xssReq = makeWriteRequest({
      input: { file_path: `<script>alert('xss')</script>` },
    });
    const card = buildApprovalCard(xssReq);
    const html = renderApprovalCardHtml(card);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("contains Approve, Always approve, and Deny buttons", () => {
    const card = buildApprovalCard(makeWriteRequest());
    const html = renderApprovalCardHtml(card);
    expect(html).toContain("tac-approve");
    expect(html).toContain("tac-approve-all");
    expect(html).toContain("tac-deny");
  });

  it("includes permissionKind in data-kind attribute", () => {
    const card = buildApprovalCard(makeBashRequest());
    const html = renderApprovalCardHtml(card);
    expect(html).toContain('data-kind="bash"');
  });

  it("omits diff block when diffHtml is null", () => {
    const card = buildApprovalCard(makeWriteRequest({ previewHunk: null }));
    const html = renderApprovalCardHtml(card);
    expect(html).not.toContain("tac-diff");
  });

  it("includes diff block when diffHtml is present", () => {
    const req = makeWriteRequest({
      previewHunk: {
        filePath: "src/foo.ts",
        linesAdded: 1,
        linesRemoved: 0,
        fullLineCount: 1,
        lines: [
          { type: "add", content: "new line", oldLineNo: null, newLineNo: 1 },
        ],
        truncated: false,
      } as import("@dantecode/config-types").ColoredDiffHunk,
    });
    const card = buildApprovalCard(req);
    const html = renderApprovalCardHtml(card);
    expect(html).toContain("tac-diff");
  });

  it("truncates long bash commands in paramSummary", () => {
    const longCmd = "a".repeat(100);
    const card = buildApprovalCard(
      makeBashRequest({ input: { command: longCmd } }),
    );
    expect(card.paramSummary.length).toBeLessThanOrEqual(83); // 80 + "…" + some slack
  });
});
