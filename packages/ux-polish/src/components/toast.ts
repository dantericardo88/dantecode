/**
 * toast.ts - Toast Notification System
 *
 * Non-blocking notification queue with auto-dismiss and themed rendering.
 * Manages up to 3 visible toasts at a time with automatic cleanup.
 *
 * @example
 * ```typescript
 * import { toasts } from '@dantecode/ux-polish';
 *
 * toasts.success('File saved!');
 * toasts.error('Build failed', { duration: 5000 });
 * toasts.info('Tip: Use Ctrl+C to cancel', { duration: 0 }); // Persistent
 * ```
 */

import { ThemeEngine } from "../theme-engine.js";

export type ToastLevel = "info" | "success" | "warning" | "error";

export interface ToastOptions {
  /** Duration in ms before auto-dismiss (0 = persistent) */
  duration?: number;
  /** Optional action button */
  action?: {
    label: string;
    callback: () => void;
  };
  /** Whether toast can be dismissed manually */
  dismissible?: boolean;
}

export interface Toast {
  id: string;
  level: ToastLevel;
  message: string;
  createdAt: number;
  dismissedAt?: number;
  duration: number;
  action?: {
    label: string;
    callback: () => void;
  };
  dismissible: boolean;
}

/** ANSI color codes */
const COLORS = {
  info: "\x1b[36m", // Cyan
  success: "\x1b[32m", // Green
  warning: "\x1b[33m", // Yellow
  error: "\x1b[31m", // Red
  reset: "\x1b[0m",
};

/** Symbols per level */
const SYMBOLS = {
  info: "ℹ",
  success: "✓",
  warning: "⚠",
  error: "✗",
};

/**
 * Toast Manager - handles notification queue and auto-dismiss
 */
export class ToastManager {
  private toasts: Map<string, Toast> = new Map();
  private dismissTimers: Map<string, NodeJS.Timeout> = new Map();
  private readonly maxVisible = 3;
  private readonly defaultDuration = 3000; // 3 seconds
  private idCounter = 0;
  private theme: ThemeEngine;

  constructor(options?: { theme?: ThemeEngine }) {
    this.theme = options?.theme ?? new ThemeEngine();
  }

  /**
   * Show info toast (cyan)
   */
  info(message: string, options?: ToastOptions): Toast {
    return this.show("info", message, options);
  }

  /**
   * Show success toast (green)
   */
  success(message: string, options?: ToastOptions): Toast {
    return this.show("success", message, options);
  }

  /**
   * Show warning toast (yellow)
   */
  warning(message: string, options?: ToastOptions): Toast {
    return this.show("warning", message, options);
  }

  /**
   * Show error toast (red)
   */
  error(message: string, options?: ToastOptions): Toast {
    return this.show("error", message, options);
  }

  /**
   * Dismiss a specific toast by ID
   */
  dismiss(id: string): void {
    const toast = this.toasts.get(id);
    if (!toast) return;

    toast.dismissedAt = Date.now();
    this.toasts.delete(id);

    // Clear timer if exists
    const timer = this.dismissTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.dismissTimers.delete(id);
    }
  }

  /**
   * Dismiss all toasts
   */
  dismissAll(): void {
    const ids = Array.from(this.toasts.keys());
    for (const id of ids) {
      this.dismiss(id);
    }
  }

  /**
   * Clear all toasts (alias for dismissAll)
   */
  clear(): void {
    this.dismissAll();
  }

  /**
   * Get all visible (not dismissed) toasts
   */
  getVisible(): Toast[] {
    return Array.from(this.toasts.values())
      .filter((t) => !t.dismissedAt)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  /**
   * Get all toasts (including dismissed)
   */
  getAll(): Toast[] {
    return Array.from(this.toasts.values());
  }

  /**
   * Internal: show a toast
   */
  private show(level: ToastLevel, message: string, options?: ToastOptions): Toast {
    const id = `toast-${++this.idCounter}`;
    const duration = options?.duration ?? this.defaultDuration;
    const dismissible = options?.dismissible ?? true;

    const toast: Toast = {
      id,
      level,
      message,
      createdAt: Date.now(),
      duration,
      action: options?.action,
      dismissible,
    };

    // Enforce max visible limit - dismiss oldest if needed
    const visible = this.getVisible();
    if (visible.length >= this.maxVisible) {
      // Dismiss oldest toast
      const oldest = visible[0];
      this.dismiss(oldest.id);
    }

    // Add toast
    this.toasts.set(id, toast);

    // Render toast
    this.render(toast);

    // Set auto-dismiss timer if duration > 0
    if (duration > 0) {
      const timer = setTimeout(() => {
        this.dismiss(id);
      }, duration);
      this.dismissTimers.set(id, timer);
    }

    return toast;
  }

  /**
   * Render a toast to stderr
   */
  private render(toast: Toast): void {
    const color = COLORS[toast.level];
    const symbol = SYMBOLS[toast.level];
    const reset = COLORS.reset;

    // Format: [symbol] message
    const line = `${color}${symbol}${reset} ${toast.message}`;

    // Write to stderr (non-blocking)
    process.stderr.write(`${line}\n`);
  }
}

/**
 * Singleton toast manager instance
 */
export const toasts = new ToastManager();
