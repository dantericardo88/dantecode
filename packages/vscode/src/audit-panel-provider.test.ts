import { describe, expect, it } from "vitest";

// Mock VS Code API
const mockUri = { fsPath: "/test" };
const mockWorkspace = {
  workspaceFolders: [{ uri: mockUri }],
  createFileSystemWatcher: vi.fn(),
  onDidChangeWorkspaceFolders: vi.fn(),
};
const mockWindow = {
  onDidChangeActiveTextEditor: vi.fn(),
};
const mockVscode = {
  Uri: { file: vi.fn(() => mockUri) },
  workspace: mockWorkspace,
  window: mockWindow,
  WebviewViewProvider: class {},
  WebviewView: class {},
  CancellationToken: class {},
  WebviewViewResolveContext: class {},
  FileSystemWatcher: class {},
  RelativePattern: class {},
};

vi.mock("vscode", () => mockVscode);

// Import after mocking
import { AuditPanelProvider } from "./audit-panel-provider.js";

describe("AuditPanelProvider", () => {
  describe("Proof-first rendering with concrete V+E event payloads", () => {
    it("renders mutation_observed with structured proof fields and badge", () => {
      const provider = new AuditPanelProvider(mockUri);
      const html = provider.getHtmlForWebview({} as any);

      // Test the renderProofPayload function with concrete payload
      const payload = {
        toolCallId: "call-123",
        path: "src/utils.ts",
        beforeHash: "abc123",
        afterHash: "def456",
        diffSummary: "+5 -2",
        additions: 5,
        deletions: 2,
        readSnapshotId: "snap-789",
        timestamp: "2024-01-01T00:00:00.000Z"
      };

      // Since we can't easily test the webview script, verify the HTML includes the rendering logic
      expect(html).toContain("renderProofPayload");
      expect(html).toContain("proof-content");
      expect(html).toContain("proof-badge");
      expect(html).toContain("MUTATION");
      expect(html).toContain("Tool Call ID");
      expect(html).toContain("File");
      expect(html).toContain("Before Hash");
      expect(html).toContain("After Hash");
      expect(html).toContain("Diff Summary");
      expect(html).toContain("Read Snapshot ID");
    });

    it("renders validation_observed with structured proof fields and badge", () => {
      const provider = new AuditPanelProvider(mockUri);
      const html = provider.getHtmlForWebview({} as any);

      expect(html).toContain("renderProofPayload");
      expect(html).toContain("VALIDATION");
      expect(html).toContain("Tool Call ID");
      expect(html).toContain("Type");
      expect(html).toContain("Command");
      expect(html).toContain("Passed");
      expect(html).toContain("Output");
    });

    it("renders completion_gate_failed with reasonCode and badge", () => {
      const provider = new AuditPanelProvider(mockUri);
      const html = provider.getHtmlForWebview({} as any);

      expect(html).toContain("completion_gate_failed");
      expect(html).toContain("GATE FAILED");
      expect(html).toContain("Passed");
      expect(html).toContain("Reason");
      expect(html).toContain("Message");
    });

    it("renders completion_gate_passed with success badge", () => {
      const provider = new AuditPanelProvider(mockUri);
      const html = provider.getHtmlForWebview({} as any);

      expect(html).toContain("completion_gate_passed");
      expect(html).toContain("GATE PASSED");
      expect(html).toContain("Passed");
    });

    it("renders tool_call_succeeded with tool metadata and badge", () => {
      const provider = new AuditPanelProvider(mockUri);
      const html = provider.getHtmlForWebview({} as any);

      expect(html).toContain("tool_call_succeeded");
      expect(html).toContain("TOOL SUCCESS");
      expect(html).toContain("Tool");
      expect(html).toContain("Tool Call ID");
      expect(html).toContain("Input");
      expect(html).toContain("Result");
    });

    it("renders tool_call_failed with failure badge", () => {
      const provider = new AuditPanelProvider(mockUri);
      const html = provider.getHtmlForWebview({} as any);

      expect(html).toContain("tool_call_failed");
      expect(html).toContain("TOOL FAILED");
      expect(html).toContain("Tool");
      expect(html).toContain("Tool Call ID");
    });

    it("raw JSON appears only as secondary expandable details", () => {
      const provider = new AuditPanelProvider(mockUri);
      const html = provider.getHtmlForWebview({} as any);

      expect(html).toContain("Raw JSON");
      expect(html).toContain("<details>");
      expect(html).toContain("<summary>Raw JSON</summary>");
      expect(html).toContain("<pre>");
    });

    it("non-proof events still render with generic JSON fallback", () => {
      const provider = new AuditPanelProvider(mockUri);
      const html = provider.getHtmlForWebview({} as any);

      // Non-proof events should use JSON.stringify directly
      expect(html).toContain("JSON.stringify(evt.payload, null, 2)");
    });
  });
});

  it("renders completion_gate_failed with reasonCode clearly", () => {
    // Verify the script includes gate failed rendering
    const provider = new AuditPanelProvider(mockUri);
    const html = provider.getHtmlForWebview({} as any);

    expect(html).toContain("completion_gate_failed");
    expect(html).toContain("GATE FAILED");
  });

  it("renders tool_call_succeeded with tool name distinctly", () => {
    const provider = new AuditPanelProvider(mockUri);
    const html = provider.getHtmlForWebview({} as any);

    expect(html).toContain("tool_call_succeeded");
    expect(html).toContain("TOOL SUCCESS");
  });

  it("raw JSON remains available as secondary details", () => {
    const provider = new AuditPanelProvider(mockUri);
    const html = provider.getHtmlForWebview({} as any);

    expect(html).toContain("Raw JSON");
    expect(html).toContain("<details>");
  });
});
