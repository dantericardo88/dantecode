import * as vscode from 'vscode';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as statusBar from './status-bar.js';
import { DEFAULT_MODEL_ID } from '@dantecode/core';

// Mock vscode APIs. `vscode` is a peer dependency only present in the
// editor runtime — vi.importActual would fail under vitest, so we build
// the surface synthetically.
vi.mock('vscode', () => ({
  StatusBarAlignment: { Left: 1, Right: 2 },
  ThemeColor: vi.fn((id: string) => ({ id })),
  window: {
    createStatusBarItem: vi.fn(() => ({
      command: undefined,
      text: '',
      tooltip: '',
      backgroundColor: undefined,
      color: undefined,
      show: vi.fn(),
      hide: vi.fn(),
      dispose: vi.fn(),
    })),
  },
  workspace: {
    getConfiguration: vi.fn(),
    onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
  },
}));

const mockContext = { subscriptions: [] } as any;

const mockConfig = {
  get: vi.fn(),
  has: vi.fn(() => true),
  inspect: vi.fn(),
  update: vi.fn(),
};

vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(mockConfig as any);

// Mock DEFAULT_MODEL_ID if needed
describe('StatusBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig.get.mockImplementation((key: string) => {
      if (key === 'defaultModel') return DEFAULT_MODEL_ID;
      if (key === 'sandboxEnabled') return false;
      return undefined;
    });
  });

  describe('createStatusBar', () => {
    it('creates status bar item with correct defaults', () => {
      const state = statusBar.createStatusBar(mockContext);

      expect(vscode.window.createStatusBarItem).toHaveBeenCalledWith(
        vscode.StatusBarAlignment.Left,
        100,
      );
      expect(state.currentModel).toBe(DEFAULT_MODEL_ID);
      expect(state.gateStatus).toBe('none');
      expect(state.sandboxEnabled).toBe(false);
      expect(mockContext.subscriptions).toHaveLength(2);
    });

    it('uses config values for model and sandbox', () => {
      mockConfig.get
        .mockReturnValueOnce('grok/grok-4')
        .mockReturnValueOnce(true);

      const state = statusBar.createStatusBar(mockContext);

      expect(state.currentModel).toBe('grok/grok-4');
      expect(state.sandboxEnabled).toBe(true);
    });
  });

  describe('formatStatusBarText', () => {
    it('formats basic model name correctly', () => {
      const state: statusBar.StatusBarState = {
        item: {} as any,
        currentModel: 'grok/grok-4',
        gateStatus: 'none',
        sandboxEnabled: false,
        modelTier: 'fast',
        sessionCostUsd: 0,
        contextPercent: 0,
        activeTasks: 0,
        hasError: false,
        indexState: 'none',
        indexChunkCount: 0,
      };

      expect(statusBar.formatStatusBarText(state)).toBe('DanteCode | grok-4');
    });

    it('includes context and tasks when present', () => {
      const state: statusBar.StatusBarState = {
        item: {} as any,
        currentModel: 'grok/grok-4',
        gateStatus: 'none',
        sandboxEnabled: false,
        modelTier: 'fast',
        sessionCostUsd: 0,
        contextPercent: 23,
        activeTasks: 2,
        hasError: false,
        indexState: 'none',
        indexChunkCount: 0,
      };

      expect(statusBar.formatStatusBarText(state)).toBe('DanteCode | grok-4 | 23% ctx | 2 tasks');
    });
  });

  describe('getStatusBarColor', () => {
    const makeState = (overrides: Partial<statusBar.StatusBarState> = {}): statusBar.StatusBarState => ({
      item: {} as any,
      currentModel: 'grok/grok-4',
      gateStatus: 'none',
      sandboxEnabled: false,
      modelTier: 'fast',
      sessionCostUsd: 0,
      contextPercent: 0,
      activeTasks: 0,
      hasError: false,
      indexState: 'none',
      indexChunkCount: 0,
      ...overrides,
    });

    it('returns red for errors or failed gates', () => {
      expect(statusBar.getStatusBarColor(makeState({ hasError: true }))).toBe('red');
      expect(statusBar.getStatusBarColor(makeState({ gateStatus: 'failed' }))).toBe('red');
    });

    it('returns yellow for high context or pending gates', () => {
      expect(statusBar.getStatusBarColor(makeState({ contextPercent: 80 }))).toBe('yellow');
      expect(statusBar.getStatusBarColor(makeState({ gateStatus: 'pending' }))).toBe('yellow');
    });

    it('returns green for healthy state', () => {
      expect(statusBar.getStatusBarColor(makeState())).toBe('green');
    });
  });

  describe('updateStatusBar', () => {
    it('updates model and gate status and re-renders', () => {
      // renderStatusBar is internal — verify the side effect by checking
      // state.item.text gets written. createStatusBar's mock returns a
      // status-bar item whose `text` is the mutable target.
      const state = statusBar.createStatusBar(mockContext);
      statusBar.updateStatusBar(state, 'claude/3.5-sonnet', 'passed');
      expect(state.currentModel).toBe('claude/3.5-sonnet');
      expect(state.gateStatus).toBe('passed');
      expect(typeof state.item.text).toBe('string');
      expect(state.item.text).toContain('DanteCode');
    });
  });

  describe('updateStatusBarInfo convenience method', () => {
    it('updates multiple fields selectively', () => {
      const state = statusBar.createStatusBar(mockContext);
      statusBar.updateStatusBarInfo(state, {
        model: 'grok/grok-4',
        contextPercent: 45,
        activeTasks: 1,
        hasError: true,
      });
      expect(state.currentModel).toBe('grok/grok-4');
      expect(state.contextPercent).toBe(45);
      expect(state.activeTasks).toBe(1);
      expect(state.hasError).toBe(true);
      expect(state.item.text).toContain('grok-4');
    });
  });
});
