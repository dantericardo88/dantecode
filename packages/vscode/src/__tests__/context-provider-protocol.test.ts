// ============================================================================
// packages/vscode/src/__tests__/context-provider-protocol.test.ts
//
// Tests for the Continue.dev context provider protocol:
//   - IContextProvider interface shape
//   - FileSubmenuProvider / CodeSubmenuProvider implementations
//   - SUBMENU_PROVIDERS export
//   - Context window overflow guard simulation (Machine 5)
// ============================================================================

import { describe, it, expect } from "vitest";
import {
  FileSubmenuProvider,
  CodeSubmenuProvider,
  SUBMENU_PROVIDERS,
} from "../context-submenu-provider.js";
import type { IContextProvider } from "../context-submenu-provider.js";

// ── FileSubmenuProvider ───────────────────────────────────────────────────────

describe("FileSubmenuProvider", () => {
  const provider = new FileSubmenuProvider();

  it("implements IContextProvider interface", () => {
    const p: IContextProvider = provider;
    expect(p.description).toBeDefined();
    expect(typeof p.getContextItems).toBe("function");
    expect(typeof p.loadSubmenuItems).toBe("function");
  });

  it("description.type equals 'submenu'", () => {
    expect(provider.description.type).toBe("submenu");
  });

  it("description.title equals 'file'", () => {
    expect(provider.description.title).toBe("file");
  });

  it("loadSubmenuItems returns an array (may be empty in test env)", async () => {
    const items = await provider.loadSubmenuItems("");
    expect(Array.isArray(items)).toBe(true);
  });

  it("getContextItems returns error message for missing file (no throw)", async () => {
    const result = await provider.getContextItems("nonexistent-file-xyz.ts", "");
    expect(result).toHaveLength(1);
    expect(result[0]!.content).toContain("nonexistent-file-xyz.ts");
  });
});

// ── CodeSubmenuProvider ───────────────────────────────────────────────────────

describe("CodeSubmenuProvider", () => {
  const provider = new CodeSubmenuProvider();

  it("description.type equals 'submenu'", () => {
    expect(provider.description.type).toBe("submenu");
  });

  it("description.title equals 'code'", () => {
    expect(provider.description.title).toBe("code");
  });

  it("loadSubmenuItems returns an array (may be empty in test env)", async () => {
    const items = await provider.loadSubmenuItems("");
    expect(Array.isArray(items)).toBe(true);
  });

  it("getContextItems returns a result array for any query (no throw)", async () => {
    const result = await provider.getContextItems("SomeSymbol", "");
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThanOrEqual(1);
  });
});

// ── SUBMENU_PROVIDERS ─────────────────────────────────────────────────────────

describe("SUBMENU_PROVIDERS", () => {
  it("has exactly 2 entries (file and code)", () => {
    expect(SUBMENU_PROVIDERS).toHaveLength(2);
  });

  it("first provider title is 'file'", () => {
    expect(SUBMENU_PROVIDERS[0]!.description.title).toBe("file");
  });

  it("second provider title is 'code'", () => {
    expect(SUBMENU_PROVIDERS[1]!.description.title).toBe("code");
  });
});

// ── Context overflow guard simulation ─────────────────────────────────────────

describe("Machine 5 — Context overflow guard", () => {
  it("warning triggers when contextPercent crosses 80 threshold", () => {
    let lastContextPercent = 0;
    const warnings: string[] = [];

    const checkContextOverflow = (contextPercent: number) => {
      if (contextPercent > 80 && lastContextPercent <= 80) {
        warnings.push(`Context window ${Math.round(contextPercent)}% full`);
      }
      lastContextPercent = contextPercent;
    };

    checkContextOverflow(50);
    expect(warnings).toHaveLength(0);

    checkContextOverflow(81);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("81%");

    // Does not fire again on subsequent calls above 80
    checkContextOverflow(85);
    expect(warnings).toHaveLength(1);
  });

  it("messages trimmed when contextPercent > 95 and length > 6", () => {
    const messages = [
      { role: "user", content: "msg0" },
      { role: "user", content: "msg1" },
      { role: "assistant", content: "msg2" },
      { role: "user", content: "msg3" },
      { role: "assistant", content: "msg4" },
      { role: "user", content: "msg5" },
      { role: "assistant", content: "msg6" },
    ];

    const contextPercent = 96;

    if (contextPercent > 95 && messages.length > 6) {
      messages.splice(1, 2);
    }

    expect(messages).toHaveLength(5);
    expect(messages[0]!.content).toBe("msg0");
    expect(messages[1]!.content).toBe("msg3");
  });

  it("messages NOT trimmed when contextPercent > 95 but length <= 6", () => {
    const messages = [
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
      { role: "user", content: "c" },
    ];
    const original = messages.length;
    const contextPercent = 97;

    if (contextPercent > 95 && messages.length > 6) {
      messages.splice(1, 2);
    }

    expect(messages).toHaveLength(original);
  });
});
