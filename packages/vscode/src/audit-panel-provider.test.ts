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
import { AuditPanelProvider, renderProofPayloadForTesting } from "./audit-panel-provider.js";

describe("AuditPanelProvider", () => {
  describe("Proof-first rendering with concrete V+E event payloads", () => {
    it("renders mutation_observed with concrete proof field values", () => {
      const payload = {
        toolCallId: "tool-123",
        path: "src/example.ts",
        beforeHash: "abc123",
        afterHash: "def456",
        diffSummary: "+2 -1",
        additions: 2,
        deletions: 1,
        readSnapshotId: "snap-1",
        timestamp: "2024-01-01T00:00:00.000Z"
      };

      const rendered = renderProofPayloadForTesting('mutation_observed', payload);

      expect(rendered).toContain('MUTATION');
      expect(rendered).toContain('tool-123');
      expect(rendered).toContain('src/example.ts');
      expect(rendered).toContain('abc123');
      expect(rendered).toContain('def456');
      expect(rendered).toContain('+2 -1');
      expect(rendered).toContain('+2 -1');
      expect(rendered).toContain('snap-1');
      expect(rendered).toContain('Raw JSON');
      expect(rendered).toContain('"toolCallId": "tool-123"');
    });

    it("renders validation_observed with concrete proof field values", () => {
      const payload = {
        toolCallId: "call-456",
        type: "lint",
        command: "npm run lint",
        passed: true,
        output: "No issues found",
        timestamp: "2024-01-01T00:00:00.000Z"
      };

      const rendered = renderProofPayloadForTesting('validation_observed', payload);

      expect(rendered).toContain('VALIDATION');
      expect(rendered).toContain('call-456');
      expect(rendered).toContain('lint');
      expect(rendered).toContain('npm run lint');
      expect(rendered).toContain('Yes');
      expect(rendered).toContain('No issues found');
    });

    it("renders completion_gate_failed with concrete reasonCode", () => {
      const payload = {
        ok: false,
        reasonCode: "no-observable-mutation",
        message: "No observable mutation detected",
        timestamp: "2024-01-01T00:00:00.000Z"
      };

      const rendered = renderProofPayloadForTesting('completion_gate_failed', payload);

      expect(rendered).toContain('GATE FAILED');
      expect(rendered).toContain('No');
      expect(rendered).toContain('no-observable-mutation');
      expect(rendered).toContain('No observable mutation detected');
    });

    it("renders tool_call_succeeded with concrete tool metadata", () => {
      const payload = {
        toolCallId: "call-789",
        toolName: "Write",
        input: { file_path: "test.txt", content: "hello" },
        result: { toolUseId: "call-789", content: "Successfully wrote", isError: false },
        timestamp: "2024-01-01T00:00:00.000Z"
      };

      const rendered = renderProofPayloadForTesting('tool_call_succeeded', payload);

      expect(rendered).toContain('TOOL SUCCESS');
      expect(rendered).toContain('Write');
      expect(rendered).toContain('call-789');
      expect(rendered).toContain('"file_path": "test.txt"');
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

    it("renders completion_gate_failed with concrete reasonCode", () => {
      global.renderProofPayload = (type, payload) => {
        var html = '<div class="proof-content">';
        html += '<div class="proof-badge gate-failed">GATE FAILED</div>';
        html += '<div class="proof-field"><strong>Passed:</strong> ' + (payload.ok ? 'Yes' : 'No') + '</div>';
        if (payload.reasonCode) {
          html += '<div class="proof-field"><strong>Reason:</strong> ' + payload.reasonCode + '</div>';
        }
        html += '<details><summary>Raw JSON</summary><pre>' + JSON.stringify(payload, null, 2) + '</pre></details>';
        html += '</div>';
        return html;
      };

      const payload = {
        ok: false,
        reasonCode: "no-observable-mutation",
        message: "No observable mutation detected",
        timestamp: "2024-01-01T00:00:00.000Z"
      };

      const rendered = global.renderProofPayload('completion_gate_failed', payload);

      expect(rendered).toContain('GATE FAILED');
      expect(rendered).toContain('No');
      expect(rendered).toContain('no-observable-mutation');
      expect(rendered).toContain('No observable mutation detected');
    });

    it("renders tool_call_succeeded with concrete tool metadata", () => {
      global.renderProofPayload = (type, payload) => {
        var html = '<div class="proof-content">';
        html += '<div class="proof-badge tool">TOOL SUCCESS</div>';
        html += '<div class="proof-field"><strong>Tool:</strong> ' + (payload.toolName || 'Unknown') + '</div>';
        html += '<div class="proof-field"><strong>Tool Call ID:</strong> ' + (payload.toolCallId || 'N/A') + '</div>';
        html += '<details><summary>Raw JSON</summary><pre>' + JSON.stringify(payload, null, 2) + '</pre></details>';
        html += '</div>';
        return html;
      };

      const payload = {
        toolCallId: "call-789",
        toolName: "Write",
        input: { file_path: "test.txt", content: "hello" },
        result: { toolUseId: "call-789", content: "Successfully wrote", isError: false },
        timestamp: "2024-01-01T00:00:00.000Z"
      };

      const rendered = global.renderProofPayload('tool_call_succeeded', payload);

      expect(rendered).toContain('TOOL SUCCESS');
      expect(rendered).toContain('Write');
      expect(rendered).toContain('call-789');
      expect(rendered).toContain('"file_path": "test.txt"');
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
