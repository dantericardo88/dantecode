import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock vscode peer dep with the surface accessibility-provider touches.
let mockThemeKind = 2; // Dark = 2 in real vscode enum
vi.mock('vscode', () => ({
  ColorThemeKind: {
    Light: 1,
    Dark: 2,
    HighContrast: 3,
    HighContrastLight: 4,
  },
  StatusBarAlignment: { Left: 1, Right: 2 },
  ThemeColor: vi.fn((id: string) => ({ id })),
  window: {
    get activeColorTheme() {
      return { kind: mockThemeKind };
    },
    onDidChangeActiveColorTheme: vi.fn(() => ({ dispose: vi.fn() })),
    createStatusBarItem: vi.fn(() => ({
      text: '',
      tooltip: '',
      show: vi.fn(),
      hide: vi.fn(),
      dispose: vi.fn(),
    })),
  },
}));

import {
  isHighContrastTheme,
  enhanceWebviewAccessibility,
  announceToScreenReader,
  getKeyboardNavScript,
  AccessibilityProvider,
} from './accessibility-provider.js';

describe('AccessibilityProvider', () => {
  beforeEach(() => {
    mockThemeKind = 2; // Dark
  });

  it('detects high-contrast theme', () => {
    mockThemeKind = 3; // HighContrast
    expect(isHighContrastTheme()).toBe(true);

    mockThemeKind = 4; // HighContrastLight
    expect(isHighContrastTheme()).toBe(true);

    mockThemeKind = 2; // Dark
    expect(isHighContrastTheme()).toBe(false);
  });

  it('enhances webview HTML with accessibility attributes', () => {
    // High-contrast CSS is injected via `</head>` replacement, so the
    // fixture HTML must include a head tag. Without it the regex no-ops.
    const html = '<html><head></head><body><h1>Test</h1></body></html>';
    const enhanced = enhanceWebviewAccessibility(html, {
      panelLabel: 'DanteCode Panel',
      isHighContrast: true,
    });

    expect(enhanced).toContain('lang="en"');
    expect(enhanced).toContain('aria-label="DanteCode Panel"');
    expect(enhanced).toContain('role="main"');
    expect(enhanced).toContain('id="dante-a11y-base"');
    expect(enhanced).toContain('prefers-reduced-motion');
    expect(enhanced).toContain('forced-colors: active');
    expect(enhanced).toContain(':focus-visible');
    expect(enhanced).toContain('--dante-focus-ring');
    expect(enhanced).toContain('id="dante-sr-announcer"');
    expect(enhanced).toContain('aria-live="polite"');
  });

  it('generates keyboard navigation script', () => {
    const script = getKeyboardNavScript();
    expect(script).toContain('document.addEventListener(');
    expect(script).toContain('keydown');
    expect(script).toContain('Tab');
    expect(script).toContain('ArrowDown');
    expect(script).toContain('Home');
    expect(script).toContain('data-roving-tabindex');
    expect(script).toContain('a11y-announce');
    expect(script).toContain('a[href],button');
  });

  it('AccessibilityProvider initializes correctly', () => {
    const mockContext = { subscriptions: [] } as any;
    const provider = AccessibilityProvider.register(mockContext);
    expect(provider).toBeTruthy();
    expect(AccessibilityProvider.highContrast).toBe(false);
  });
});

describe('ARIA announcements', () => {
  it('formats screen reader announcement postMessage', () => {
    const mockWebview = { postMessage: vi.fn() } as any;
    announceToScreenReader(mockWebview, 'Test announcement');
    expect(mockWebview.postMessage.mock.calls[0][0].type).toBe('a11y-announce');
    expect(mockWebview.postMessage.mock.calls[0][0].message).toBe('Test announcement');
  });
});
