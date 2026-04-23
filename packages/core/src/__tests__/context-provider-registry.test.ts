// packages/core/src/__tests__/context-provider-registry.test.ts
// 8 tests for ContextProviderRegistry and IContextProvider interface

import { describe, it, expect } from "vitest";
import { ContextProviderRegistry } from "@dantecode/core";
import type { IContextProvider, ContextProviderExtras, ContextItem } from "@dantecode/core";

function makeProvider(name: string): IContextProvider {
  return {
    name,
    description: `${name} provider`,
    async getContextItems(_extras: ContextProviderExtras): Promise<ContextItem[]> {
      return [{ name, description: name, content: `content of ${name}` }];
    },
  };
}

describe("ContextProviderRegistry", () => {
  it("register and getProvider roundtrip", () => {
    const reg = new ContextProviderRegistry();
    const p = makeProvider("test");
    reg.register(p);
    expect(reg.getProvider("test")).toBe(p);
  });

  it("registering same name replaces prior registration", () => {
    const reg = new ContextProviderRegistry();
    const p1 = makeProvider("foo");
    const p2 = makeProvider("foo");
    reg.register(p1);
    reg.register(p2);
    expect(reg.getProvider("foo")).toBe(p2);
  });

  it("unregister removes the provider", () => {
    const reg = new ContextProviderRegistry();
    reg.register(makeProvider("bar"));
    reg.unregister("bar");
    expect(reg.getProvider("bar")).toBeUndefined();
  });

  it("listProviders returns all registered providers", () => {
    const reg = new ContextProviderRegistry();
    reg.register(makeProvider("a"));
    reg.register(makeProvider("b"));
    expect(reg.listProviders()).toHaveLength(2);
  });

  it("hasProvider returns true when registered", () => {
    const reg = new ContextProviderRegistry();
    reg.register(makeProvider("x"));
    expect(reg.hasProvider("x")).toBe(true);
  });

  it("hasProvider returns false when not registered", () => {
    const reg = new ContextProviderRegistry();
    expect(reg.hasProvider("unknown")).toBe(false);
  });

  it("getProvider returns undefined for unknown name", () => {
    const reg = new ContextProviderRegistry();
    expect(reg.getProvider("does-not-exist")).toBeUndefined();
  });

  it("IContextProvider.getContextItems returns ContextItem[]", async () => {
    const p = makeProvider("my-provider");
    const items = await p.getContextItems({ query: "", workspaceRoot: "/tmp" });
    expect(items).toHaveLength(1);
    expect(items[0]!.content).toContain("my-provider");
  });
});
