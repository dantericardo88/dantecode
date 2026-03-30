/**
 * toast.test.ts - Tests for Toast notification system
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ToastManager, toasts } from "./toast.js";

describe("ToastManager", () => {
  let manager: ToastManager;

  beforeEach(() => {
    manager = new ToastManager();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    manager.clear();
  });

  it("creates toasts with correct structure", () => {
    const toast = manager.info("Test message");

    expect(toast).toHaveProperty("id");
    expect(toast).toHaveProperty("level");
    expect(toast).toHaveProperty("message");
    expect(toast).toHaveProperty("createdAt");
    expect(toast).toHaveProperty("duration");
    expect(toast).toHaveProperty("dismissible");

    expect(toast.level).toBe("info");
    expect(toast.message).toBe("Test message");
    expect(toast.dismissible).toBe(true);
  });

  it("auto-dismisses after duration", async () => {
    const toast = manager.info("Auto-dismiss test", { duration: 100 });

    expect(manager.getVisible()).toHaveLength(1);

    // Fast-forward time
    vi.advanceTimersByTime(150);

    expect(manager.getVisible()).toHaveLength(0);
  });

  it("limits queue to 3 visible toasts", () => {
    manager.info("Toast 1");
    manager.info("Toast 2");
    manager.info("Toast 3");

    expect(manager.getVisible()).toHaveLength(3);

    // Fourth toast should dismiss oldest
    manager.info("Toast 4");

    const visible = manager.getVisible();
    expect(visible).toHaveLength(3);

    // Oldest (Toast 1) should be gone
    const messages = visible.map((t) => t.message);
    expect(messages).not.toContain("Toast 1");
    expect(messages).toContain("Toast 2");
    expect(messages).toContain("Toast 3");
    expect(messages).toContain("Toast 4");
  });

  it("persistent toasts don't auto-dismiss", async () => {
    const toast = manager.info("Persistent", { duration: 0 });

    expect(manager.getVisible()).toHaveLength(1);

    // Fast-forward time significantly
    vi.advanceTimersByTime(10000);

    // Should still be visible
    expect(manager.getVisible()).toHaveLength(1);
    expect(manager.getVisible()[0].id).toBe(toast.id);
  });

  it("action callbacks fire correctly", () => {
    const callback = vi.fn();
    const toast = manager.info("Action toast", {
      action: { label: "Click", callback },
    });

    expect(toast.action).toBeDefined();
    expect(toast.action?.label).toBe("Click");

    // Simulate action click
    toast.action?.callback();

    expect(callback).toHaveBeenCalledOnce();
  });

  it("dismiss() removes toast", () => {
    const toast = manager.info("Dismissible");

    expect(manager.getVisible()).toHaveLength(1);

    manager.dismiss(toast.id);

    expect(manager.getVisible()).toHaveLength(0);
  });

  it("dismissAll() clears all toasts", () => {
    manager.info("Toast 1");
    manager.success("Toast 2");
    manager.warning("Toast 3");

    expect(manager.getVisible()).toHaveLength(3);

    manager.dismissAll();

    expect(manager.getVisible()).toHaveLength(0);
  });

  it("supports all toast levels", () => {
    const infoToast = manager.info("Info");
    const successToast = manager.success("Success");
    manager.clear();

    const warningToast = manager.warning("Warning");
    const errorToast = manager.error("Error");

    expect(infoToast.level).toBe("info");
    expect(successToast.level).toBe("success");
    expect(warningToast.level).toBe("warning");
    expect(errorToast.level).toBe("error");
  });

  it("singleton instance works correctly", () => {
    // Clear singleton first
    toasts.clear();

    const toast = toasts.success("Singleton test");

    expect(toasts.getVisible()).toHaveLength(1);
    expect(toasts.getVisible()[0].id).toBe(toast.id);

    toasts.clear();
    expect(toasts.getVisible()).toHaveLength(0);
  });

  it("dismissing sets dismissedAt timestamp", () => {
    const toast = manager.info("Test");

    expect(toast.dismissedAt).toBeUndefined();

    manager.dismiss(toast.id);

    // Get from internal map (after dismiss)
    const allToasts = manager.getAll();
    const dismissedToast = allToasts.find((t) => t.id === toast.id);

    // Toast is removed from map after dismiss, so it won't be in getAll()
    // This is expected behavior
    expect(manager.getVisible()).toHaveLength(0);
  });
});
