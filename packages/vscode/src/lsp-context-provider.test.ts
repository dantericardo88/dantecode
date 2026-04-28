import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { HOVER_PROVIDER, DEFINITION_PROVIDER, REFERENCES_PROVIDER, SYMBOL_PROVIDER, TYPES_PROVIDER } from './lsp-context-provider.js';

// Mock vscode
vi.mock('vscode', () => ({
  window: { activeTextEditor: null },
  workspace: {
    openTextDocument: vi.fn(),
    asRelativePath: vi.fn(),
  },
  commands: {
    executeCommand: vi.fn(),
  },
}));

const mockEditor = {
  document: { uri: vscode.Uri.file('/test.ts'), lineCount: 100 },
  selection: { active: new vscode.Position(10, 5) },
};

vi.mocked(vscode.window).activeTextEditor = mockEditor as any;

vi.mocked(vscode.workspace.openTextDocument).mockResolvedValue(mockEditor.document as any);
vi.mocked(vscode.workspace.asRelativePath).mockReturnValue('test.ts');


describe('lsp-context-provider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(vscode.window).activeTextEditor = mockEditor as any;
  });

  describe('HOVER_PROVIDER', () => {
    it('returns no editor message', async () => {
      vi.mocked(vscode.window).activeTextEditor = null;
      const result = await HOVER_PROVIDER.resolve('', '');
      expect(result[0].content).toBe('(no active editor)');
    });

    it('handles empty hovers', async () => {
      vi.mocked(vscode.commands.executeCommand).mockResolvedValue([]);
      const result = await HOVER_PROVIDER.resolve('', '');
      expect(result[0].content).toContain('no hover information');
    });

    it('flattens hover contents', async () => {
      const mockHovers = [{
        contents: ['type string', { value: 'markdown' }],
      }] as vscode.Hover[];
      vi.mocked(vscode.commands.executeCommand).mockResolvedValue(mockHovers);
      const result = await HOVER_PROVIDER.resolve('', '');
      expect(result[0].content).toBe('type string\n\nmarkdown');
    });
  });

  describe('DEFINITION_PROVIDER', () => {
    it('returns no editor message', async () => {
      vi.mocked(vscode.window).activeTextEditor = null;
      const result = await DEFINITION_PROVIDER.resolve('', '');
      expect(result[0].content).toBe('(no active editor)');
    });

    it('handles empty definitions', async () => {
      vi.mocked(vscode.commands.executeCommand).mockResolvedValue([]);
      const result = await DEFINITION_PROVIDER.resolve('', '');
      expect(result[0].content).toContain('no definition found');
    });
  });

  describe('flattenHoverContents', () => {
    const { flattenHoverContents } = await import('./lsp-context-provider.js');
    it('flattens mixed hover contents', () => {
      const hovers = [{
        contents: ['plain', { value: '**bold**' }, ''],
      }] as vscode.Hover[];
      expect(flattenHoverContents(hovers)).toBe('plain\n\n**bold**');
    });

    it('filters empty contents', () => {
      const hovers = [{ contents: ['', { value: '' }] }] as vscode.Hover[];
      expect(flattenHoverContents(hovers)).toBe('');
    });
  });

  describe('extractDocumentContext', () => {
    const { extractDocumentContext } = await import('./lsp-context-provider.js');
    it('extracts context around line', () => {
      const mockDoc = {
        lineCount: 100,
        lineAt: vi.fn((i: number) => ({ text: `line ${i}` })),
      } as any;
      const result = extractDocumentContext(mockDoc, 10, 2);
      expect(result).toMatch(/^line 8\nline 9\nline 10\nline 11\nline 12$/m);
    });

    it('handles edge cases', () => {
      const mockDoc = { lineCount: 5, lineAt: vi.fn() } as any;
      extractDocumentContext(mockDoc, 0, 10);
      expect(mockDoc.lineAt).toHaveBeenCalledWith(0);
      expect(mockDoc.lineAt).toHaveBeenNthCalledWith(4, 4);
    });
  });

  // Additional tests for other providers would go here
  // Truncated for first pass
});