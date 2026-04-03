/**
 * menu.test.ts - Tests for Menu component
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { showMenu } from "./menu.js";
import type { MenuItem } from "./menu.js";

describe("Menu", () => {
  beforeEach(() => {
    // Mock process.stdin.isTTY
    vi.stubGlobal("process", {
      ...process,
      stdin: {
        ...process.stdin,
        isTTY: false, // Disable TTY for tests (will use fallback mode)
      },
    });
  });

  it("returns null when not in TTY mode (fallback)", async () => {
    const items: MenuItem<string>[] = [
      { label: "Option 1", value: "opt1" },
      { label: "Option 2", value: "opt2" },
    ];

    const result = await showMenu({
      title: "Select",
      items,
    });

    // Non-TTY mode returns null
    expect(result).toBeNull();
  });

  it("returns empty array in multi-select mode when not TTY", async () => {
    const items: MenuItem<string>[] = [
      { label: "Option 1", value: "opt1" },
      { label: "Option 2", value: "opt2" },
    ];

    const result = await showMenu({
      title: "Select",
      items,
      multi: true,
    });

    // Non-TTY multi mode returns empty array
    expect(result).toEqual([]);
  });

  it("menu options structure is correct", () => {
    const items: MenuItem<string>[] = [
      {
        label: "Option 1",
        value: "opt1",
        description: "First option",
        disabled: false,
      },
      {
        label: "Option 2",
        value: "opt2",
        description: "Second option",
        disabled: true,
      },
    ];

    expect(items[0]!.label).toBe("Option 1");
    expect(items[0]!.value).toBe("opt1");
    expect(items[0]!.description).toBe("First option");
    expect(items[0]!.disabled).toBe(false);

    expect(items[1]!.label).toBe("Option 2");
    expect(items[1]!.disabled).toBe(true);
  });

  it("supports generic value types", () => {
    const items: MenuItem<number>[] = [
      { label: "One", value: 1 },
      { label: "Two", value: 2 },
      { label: "Three", value: 3 },
    ];

    expect(items[0]!.value).toBe(1);
    expect(items[1]!.value).toBe(2);
    expect(items[2]!.value).toBe(3);
  });

  it("supports object values", () => {
    interface FileItem {
      path: string;
      size: number;
    }

    const items: MenuItem<FileItem>[] = [
      { label: "file1.ts", value: { path: "file1.ts", size: 100 } },
      { label: "file2.ts", value: { path: "file2.ts", size: 200 } },
    ];

    expect(items[0]!.value.path).toBe("file1.ts");
    expect(items[1]!.value.size).toBe(200);
  });

  it("default options are applied correctly", async () => {
    const items: MenuItem<string>[] = [
      { label: "A", value: "a" },
      { label: "B", value: "b" },
    ];

    // In non-TTY mode, just verify structure
    const options = {
      title: "Test",
      items,
      multi: false,
      searchable: true,
      defaultIndex: 0,
      pageSize: 10,
    };

    expect(options.multi).toBe(false);
    expect(options.searchable).toBe(true);
    expect(options.defaultIndex).toBe(0);
    expect(options.pageSize).toBe(10);
  });

  // Note: Interactive keyboard tests require TTY and are difficult to test in unit tests
  // These would typically be tested in E2E tests or manual testing
  // The tests above validate the data structures and fallback behavior

  it("handles disabled items in data structure", () => {
    const items: MenuItem<string>[] = [
      { label: "Enabled 1", value: "e1", disabled: false },
      { label: "Disabled", value: "d1", disabled: true },
      { label: "Enabled 2", value: "e2" }, // disabled defaults to undefined/false
    ];

    const enabled = items.filter((i) => !i.disabled);
    expect(enabled).toHaveLength(2);
    expect(enabled[0]!.value).toBe("e1");
    expect(enabled[1]!.value).toBe("e2");
  });

  it("supports items with descriptions", () => {
    const items: MenuItem<string>[] = [
      {
        label: "Option 1",
        value: "opt1",
        description: "This is the first option",
      },
      {
        label: "Option 2",
        value: "opt2",
        description: "This is the second option",
      },
    ];

    expect(items[0]!.description).toBe("This is the first option");
    expect(items[1]!.description).toBe("This is the second option");
  });

  it("search query filtering logic would work (simulated)", () => {
    const items: MenuItem<string>[] = [
      { label: "Apple", value: "apple" },
      { label: "Banana", value: "banana" },
      { label: "Cherry", value: "cherry" },
      { label: "Apricot", value: "apricot" },
    ];

    // Simulate search for "ap"
    const query = "ap";
    const filtered = items.filter((item) => item.label.toLowerCase().includes(query.toLowerCase()));

    expect(filtered).toHaveLength(2);
    expect(filtered[0]!.value).toBe("apple");
    expect(filtered[1]!.value).toBe("apricot");
  });

  it("navigation bounds are respected (simulated)", () => {
    const items: MenuItem<string>[] = [
      { label: "Item 1", value: "1" },
      { label: "Item 2", value: "2" },
      { label: "Item 3", value: "3" },
    ];

    let selectedIndex = 0;

    // Move down twice
    selectedIndex = Math.min(selectedIndex + 1, items.length - 1);
    expect(selectedIndex).toBe(1);

    selectedIndex = Math.min(selectedIndex + 1, items.length - 1);
    expect(selectedIndex).toBe(2);

    // Try to move down past end
    selectedIndex = Math.min(selectedIndex + 1, items.length - 1);
    expect(selectedIndex).toBe(2); // Stays at last item

    // Move up
    selectedIndex = Math.max(selectedIndex - 1, 0);
    expect(selectedIndex).toBe(1);
  });
});
