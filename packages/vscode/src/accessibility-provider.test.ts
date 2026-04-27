import * as vscode from 'vscode';
import * as assert from 'assert';
import { isHighContrastTheme, onThemeAccessibilityChange, enhanceWebviewAccessibility, announceToScreenReader, getKeyboardNavScript, AccessibilityProvider } from './accessibility-provider.js';

// Mock VSCode globals for headless testing
let mockThemeKind = vscode.ColorThemeKind.Dark;
vscode.window.activeColorTheme = { kind: mockThemeKind } as any;

vitest.describe('AccessibilityProvider', () => {
  vitest.beforeEach(() => {
    mockThemeKind = vscode.ColorThemeKind.Dark;
  });

  vitest.it('detects high-contrast theme', () => {
    mockThemeKind = vscode.ColorThemeKind.HighContrast;
    assert.strictEqual(isHighContrastTheme(), true);

    mockThemeKind = vscode.ColorThemeKind.HighContrastLight;
    assert.strictEqual(isHighContrastTheme(), true);

    mockThemeKind = vscode.ColorThemeKind.Dark;
    assert.strictEqual(isHighContrastTheme(), false);
  });

  vitest.it('enhances webview HTML with accessibility attributes', () => {
    const html = '<html><body><h1>Test</h1></body></html>';
    const enhanced = enhanceWebviewAccessibility(html, {
      panelLabel: 'DanteCode Panel',
      isHighContrast: true,
    });

    assert.ok(enhanced.includes('lang="en"'));
    assert.ok(enhanced.includes('aria-label="DanteCode Panel"'));
    assert.ok(enhanced.includes('--dante-focus-ring'));
    assert.ok(enhanced.includes('*:focus { outline: var(--dante-focus-ring)'));
  });

  vitest.it('generates keyboard navigation script', () => {
    const script = getKeyboardNavScript();
    assert.ok(script.includes('document.addEventListener('));
    assert.ok(script.includes('keydown'));
    assert.ok(script.includes('Tab'));
    assert.ok(script.includes('a[href],button'));
  });

  vitest.it('AccessibilityProvider initializes correctly', () => {
    const mockContext = { subscriptions: [] } as any;
    const provider = AccessibilityProvider.register(mockContext);
    assert.ok(provider);
    assert.strictEqual(AccessibilityProvider.highContrast, false);
  });
});

vitest.describe('ARIA announcements', () => {
  vitest.it('formats screen reader announcement postMessage', () => {
    const mockWebview = { postMessage: vitest.fn() } as any;
    announceToScreenReader(mockWebview, 'Test announcement');
    assert.strictEqual(mockWebview.postMessage.mock.calls[0][0].type, 'a11y-announce');
    assert.strictEqual(mockWebview.postMessage.mock.calls[0][0].message, 'Test announcement');
  });
});