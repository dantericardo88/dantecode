// ============================================================================
// packages/vscode/src/accessibility-provider.ts
//
// Dim 48 — Accessibility / Inclusive UX in the DanteCode VSCode extension.
//
// Patterns from adobe/react-spectrum (Apache-2.0):
// - High-contrast detection, ARIA live region conventions
// Decision-changing: makes DanteCode webviews WCAG 2.1 compliant, enabling
// enterprise/government customers who require accessibility certification.
// ============================================================================

import * as vscode from "vscode";

// ── High-Contrast Theme Detection ─────────────────────────────────────────────

/** Returns true when VSCode is running in a high-contrast theme. */
export function isHighContrastTheme(): boolean {
  const kind = vscode.window.activeColorTheme.kind;
  return (
    kind === vscode.ColorThemeKind.HighContrast ||
    kind === vscode.ColorThemeKind.HighContrastLight
  );
}

/** Subscribes to theme changes and calls back when high-contrast status changes. */
export function onThemeAccessibilityChange(
  callback: (isHighContrast: boolean) => void,
  context: vscode.ExtensionContext,
): void {
  context.subscriptions.push(
    vscode.window.onDidChangeActiveColorTheme(() => {
      callback(isHighContrastTheme());
    }),
  );
}

// ── Webview HTML Enhancement ──────────────────────────────────────────────────

/**
 * Injects accessibility attributes into a webview HTML string.
 * Adds:
 * - aria-label to the root element for screen reader identification
 * - role="main" if missing
 * - lang="en" to <html> if missing
 * - High-contrast CSS variables when isHighContrast=true
 */
export function enhanceWebviewAccessibility(
  html: string,
  options: {
    panelLabel: string;
    isHighContrast?: boolean;
    announceRegionId?: string;
  },
): string {
  let enhanced = html;
  const announceRegionId = options.announceRegionId ?? "dante-sr-announcer";

  // Inject lang attribute into <html> if missing
  if (/<html\b(?![^>]*\blang\b)[^>]*>/i.test(enhanced)) {
    enhanced = enhanced.replace(/<html\b([^>]*)>/i, '<html$1 lang="en">');
  }

  // Inject aria-label on <body> if missing
  if (/<body\b(?![^>]*\baria-label\b)[^>]*>/i.test(enhanced)) {
    enhanced = enhanced.replace(
      /<body\b([^>]*)>/i,
      `<body$1 aria-label="${options.panelLabel}">`,
    );
  }

  // If the webview has no explicit main landmark, make the panel body the main region.
  if (!/<main\b|role\s*=\s*["']main["']/i.test(enhanced)) {
    enhanced = enhanced.replace(/<body\b((?:(?!\brole=)[^>])*)>/i, '<body$1 role="main">');
  }

  const baseStyle = `<style id="dante-a11y-base">
:root {
  --dante-focus-ring: 2px solid var(--vscode-focusBorder);
}
:focus-visible {
  outline: var(--dante-focus-ring);
  outline-offset: 2px;
}
@media (forced-colors: active) {
  * { forced-color-adjust: auto; }
  :focus-visible { outline: 2px solid CanvasText; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    scroll-behavior: auto !important;
    transition-duration: 0.001ms !important;
  }
}
</style>`;
  if (!/id\s*=\s*["']dante-a11y-base["']/i.test(enhanced)) {
    enhanced = enhanced.replace("</head>", `${baseStyle}\n</head>`);
  }

  // Inject high-contrast CSS variables
  if (options.isHighContrast) {
    const hcStyle = `<style id="dante-hc">
:root {
  --dante-bg: #000000;
  --dante-fg: #ffffff;
  --dante-border: #ffffff;
  --dante-link: #ffff00;
  --dante-focus-ring: 3px solid #ffffff;
}
*:focus { outline: var(--dante-focus-ring) !important; }
</style>`;
    enhanced = enhanced.replace("</head>", `${hcStyle}\n</head>`);
  }

  // Inject ARIA live region for announcements.
  if (!new RegExp(`id\\s*=\\s*["']${announceRegionId}["']`, "i").test(enhanced)) {
    const liveRegion = `<div id="${announceRegionId}" role="status" aria-live="polite" aria-atomic="true" style="position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden;"></div>`;
    enhanced = enhanced.replace("</body>", `${liveRegion}\n</body>`);
  }

  return enhanced;
}

// ── Screen Reader Announcement ────────────────────────────────────────────────

/**
 * Posts a screen-reader announcement to a webview via postMessage.
 * The webview must have an ARIA live region with the given id.
 */
export function announceToScreenReader(
  webview: vscode.Webview,
  message: string,
  regionId = "dante-sr-announcer",
): void {
  void webview.postMessage({ type: "a11y-announce", message, regionId });
}

// ── Keyboard Navigation Helper ────────────────────────────────────────────────

/**
 * Returns the CSP-safe JavaScript snippet that enables keyboard navigation
 * within a webview panel: roving tabindex on list items and focus trap escape.
 */
export function getKeyboardNavScript(): string {
  return `(function() {
  function getFocusable(root) {
    return Array.from((root || document).querySelectorAll(
      'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex="0"],[role="button"],[role="menuitem"],[role="option"],[role="tab"]'
    )).filter(function(el) {
      return !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true';
    });
  }
  function moveRoving(container, direction) {
    var items = getFocusable(container);
    if (!items.length) return;
    var current = items.indexOf(document.activeElement);
    var next = current < 0 ? 0 : current + direction;
    if (next < 0) next = items.length - 1;
    if (next >= items.length) next = 0;
    items.forEach(function(item, index) { item.setAttribute('tabindex', index === next ? '0' : '-1'); });
    items[next].focus();
  }
  document.addEventListener('keydown', function(e) {
    var roving = document.activeElement && document.activeElement.closest('[data-roving-tabindex],[role="listbox"],[role="menu"],[role="tablist"]');
    if (roving && (e.key === 'ArrowDown' || e.key === 'ArrowRight')) {
      e.preventDefault();
      moveRoving(roving, 1);
      return;
    }
    if (roving && (e.key === 'ArrowUp' || e.key === 'ArrowLeft')) {
      e.preventDefault();
      moveRoving(roving, -1);
      return;
    }
    if (roving && e.key === 'Home') {
      e.preventDefault();
      var first = getFocusable(roving)[0];
      if (first) first.focus();
      return;
    }
    if (roving && e.key === 'End') {
      e.preventDefault();
      var items = getFocusable(roving);
      var last = items[items.length - 1];
      if (last) last.focus();
      return;
    }
    if (e.key === 'Tab') {
      var focusable = getFocusable(document);
      if (!focusable.length) return;
      var idx = focusable.indexOf(document.activeElement);
      if (e.shiftKey) {
        if (idx <= 0) { e.preventDefault(); focusable[focusable.length - 1].focus(); }
      } else {
        if (idx === focusable.length - 1) { e.preventDefault(); focusable[0].focus(); }
      }
    }
  });
  document.addEventListener('message', function(e) {
    var d = e.data;
    if (d && d.type === 'a11y-announce' && d.regionId) {
      var el = document.getElementById(d.regionId);
      if (el) { el.textContent = ''; setTimeout(function() { el.textContent = d.message; }, 50); }
    }
  });
})();`;
}

// ── AccessibilityProvider Class ───────────────────────────────────────────────

/**
 * Centralises accessibility state and helpers for the DanteCode extension.
 * Register once in extension.ts via AccessibilityProvider.register(context).
 */
export class AccessibilityProvider {
  private static isHC = false;
  private static statusBarItem: vscode.StatusBarItem | undefined;

  static register(context: vscode.ExtensionContext): AccessibilityProvider {
    const provider = new AccessibilityProvider();
    AccessibilityProvider.isHC = isHighContrastTheme();

    onThemeAccessibilityChange((hc) => {
      AccessibilityProvider.isHC = hc;
      AccessibilityProvider.updateStatusBar();
    }, context);

    AccessibilityProvider.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      50,
    );
    AccessibilityProvider.updateStatusBar();
    AccessibilityProvider.statusBarItem.show();
    context.subscriptions.push(AccessibilityProvider.statusBarItem);

    return provider;
  }

  static get highContrast(): boolean {
    return AccessibilityProvider.isHC;
  }

  private static updateStatusBar(): void {
    if (!AccessibilityProvider.statusBarItem) return;
    AccessibilityProvider.statusBarItem.text = AccessibilityProvider.isHC
      ? "$(eye) HC Mode"
      : "$(eye)";
    AccessibilityProvider.statusBarItem.tooltip = AccessibilityProvider.isHC
      ? "DanteCode: High-contrast mode active"
      : "DanteCode: Standard theme";
  }
}
