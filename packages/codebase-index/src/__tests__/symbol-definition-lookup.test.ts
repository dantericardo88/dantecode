// ============================================================================
// packages/codebase-index/src/__tests__/symbol-definition-lookup.test.ts
// ============================================================================

import { describe, it, expect } from "vitest";
import { SymbolDefinitionLookup } from "../symbol-definition-lookup.js";
import type { IndexChunk } from "../types.js";

function chunk(filePath: string, content: string): IndexChunk {
  return { filePath, content };
}

const AUTH_CHUNK = chunk("src/auth.ts", [
  "export class AuthManager {",
  "  private token: string;",
  "  constructor(token: string) { this.token = token; }",
  "  getToken(): string { return this.token; }",
  "}",
].join("\n"));

const HOOK_CHUNK = chunk("src/hooks/useAuth.ts", [
  "export function useAuth() {",
  "  const manager = new AuthManager(getEnvToken());",
  "  return { token: manager.getToken() };",
  "}",
].join("\n"));

const UTIL_CHUNK = chunk("src/utils.ts", [
  "export const formatDate = (d: Date) => d.toISOString();",
  "export const escapeHtml = (s: string) => s.replace(/</g, '&lt;');",
].join("\n"));

const chunks = [AUTH_CHUNK, HOOK_CHUNK, UTIL_CHUNK];

describe("SymbolDefinitionLookup.lookup", () => {
  const lookup = new SymbolDefinitionLookup(() => chunks);

  it("finds class definition", () => {
    const result = lookup.lookup("AuthManager");
    expect(result).not.toBeNull();
    expect(result!.filePath).toBe("src/auth.ts");
  });

  it("finds function definition", () => {
    const result = lookup.lookup("useAuth");
    expect(result).not.toBeNull();
    expect(result!.filePath).toBe("src/hooks/useAuth.ts");
  });

  it("finds arrow function definition", () => {
    const result = lookup.lookup("formatDate");
    expect(result).not.toBeNull();
    expect(result!.filePath).toBe("src/utils.ts");
  });

  it("returns null for unknown symbol", () => {
    expect(lookup.lookup("nonExistentSymbol")).toBeNull();
  });

  it("returns null for empty symbol name", () => {
    expect(lookup.lookup("")).toBeNull();
  });

  it("returns null when chunk list is empty", () => {
    const emptyLookup = new SymbolDefinitionLookup(() => []);
    expect(emptyLookup.lookup("AuthManager")).toBeNull();
  });
});

describe("SymbolDefinitionLookup.extractCallSiteSymbol", () => {
  it("extracts symbol from function call", () => {
    expect(SymbolDefinitionLookup.extractCallSiteSymbol("const x = useAuth(")).toBe("useAuth");
  });

  it("extracts symbol from new expression", () => {
    expect(SymbolDefinitionLookup.extractCallSiteSymbol("const m = new AuthManager(")).toBe("AuthManager");
  });

  it("extracts symbol from method access", () => {
    expect(SymbolDefinitionLookup.extractCallSiteSymbol("manager.")).toBe("manager");
  });

  it("returns null for keyword prefix", () => {
    expect(SymbolDefinitionLookup.extractCallSiteSymbol("if (")).toBeNull();
    expect(SymbolDefinitionLookup.extractCallSiteSymbol("return (")).toBeNull();
  });

  it("returns null for empty prefix", () => {
    expect(SymbolDefinitionLookup.extractCallSiteSymbol("")).toBeNull();
  });

  it("returns null for plain text with no call site", () => {
    expect(SymbolDefinitionLookup.extractCallSiteSymbol("const x = 5;\n")).toBeNull();
  });
});
