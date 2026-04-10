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
  it("renders mutation_observed as proof-first structured display", () => {
    // This is a unit test for the rendering logic
    // In practice, the webview script would render it
    // We verify the HTML generation includes proof fields
    const provider = new AuditPanelProvider(mockUri);
    const html = provider.getHtmlForWebview({} as any);

    expect(html).toContain("renderProofPayload");
    expect(html).toContain("proof-content");
    expect(html).toContain("proof-badge");
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
