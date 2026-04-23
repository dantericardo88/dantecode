// ============================================================================
// packages/codebase-index/src/__tests__/symbol-extractor.test.ts
// ============================================================================

import { describe, it, expect } from "vitest";
import { detectLanguage, extractSymbols } from "../symbol-extractor.js";

// ── detectLanguage ────────────────────────────────────────────────────────────

describe("detectLanguage", () => {
  it("maps .ts to typescript", () => {
    expect(detectLanguage("src/auth.ts")).toBe("typescript");
  });

  it("maps .tsx to typescript", () => {
    expect(detectLanguage("src/App.tsx")).toBe("typescript");
  });

  it("maps .js to javascript", () => {
    expect(detectLanguage("src/utils.js")).toBe("javascript");
  });

  it("maps .py to python", () => {
    expect(detectLanguage("auth/views.py")).toBe("python");
  });

  it("maps .go to go", () => {
    expect(detectLanguage("main.go")).toBe("go");
  });

  it("maps .rs to rust", () => {
    expect(detectLanguage("src/lib.rs")).toBe("rust");
  });

  it("returns unknown for unrecognised extensions", () => {
    expect(detectLanguage("Makefile")).toBe("unknown");
    expect(detectLanguage("README.md")).toBe("unknown");
  });
});

// ── TypeScript ────────────────────────────────────────────────────────────────

describe("extractSymbols — TypeScript", () => {
  it("extracts exported function", () => {
    const src = `export function tokenCostOf(text: string): number {\n  return 0;\n}`;
    const syms = extractSymbols(src, "typescript");
    expect(syms.some((s) => s.name === "tokenCostOf" && s.kind === "function")).toBe(true);
  });

  it("extracts exported class", () => {
    const src = `export class RepoMapProvider {\n  constructor() {}\n}`;
    const syms = extractSymbols(src, "typescript");
    expect(syms.some((s) => s.name === "RepoMapProvider" && s.kind === "class")).toBe(true);
  });

  it("extracts arrow function", () => {
    const src = `export const assembleContext = (sources: ContextSource[], budget: number): string => "";`;
    const syms = extractSymbols(src, "typescript");
    expect(syms.some((s) => s.name === "assembleContext" && s.kind === "arrow")).toBe(true);
  });

  it("extracts interface", () => {
    const src = `export interface ContextSource {\n  id: string;\n}`;
    const syms = extractSymbols(src, "typescript");
    expect(syms.some((s) => s.name === "ContextSource" && s.kind === "interface")).toBe(true);
  });

  it("extracts type alias", () => {
    const src = `export type Language = "typescript" | "unknown";`;
    const syms = extractSymbols(src, "typescript");
    expect(syms.some((s) => s.name === "Language" && s.kind === "type")).toBe(true);
  });

  it("does not extract symbols inside string literals", () => {
    const src = `const x = "function notASymbol() {}";\nexport function realFn() {}`;
    const syms = extractSymbols(src, "typescript");
    expect(syms.some((s) => s.name === "notASymbol")).toBe(false);
    expect(syms.some((s) => s.name === "realFn")).toBe(true);
  });

  it("sorts by line number ascending", () => {
    const src = `export class B {}\nexport class A {}`;
    const syms = extractSymbols(src, "typescript");
    expect(syms[0]!.name).toBe("B");
    expect(syms[1]!.name).toBe("A");
  });
});

// ── Python ────────────────────────────────────────────────────────────────────

describe("extractSymbols — Python", () => {
  it("extracts def", () => {
    const src = `async def authenticate(token: str) -> bool:\n    pass`;
    const syms = extractSymbols(src, "python");
    expect(syms.some((s) => s.name === "authenticate" && s.kind === "function")).toBe(true);
  });

  it("extracts class", () => {
    const src = `class AuthManager(BaseManager):\n    pass`;
    const syms = extractSymbols(src, "python");
    expect(syms.some((s) => s.name === "AuthManager" && s.kind === "class")).toBe(true);
  });
});

// ── Go ────────────────────────────────────────────────────────────────────────

describe("extractSymbols — Go", () => {
  it("extracts func", () => {
    const src = `func NewServer(addr string) *Server {\n\treturn nil\n}`;
    const syms = extractSymbols(src, "go");
    expect(syms.some((s) => s.name === "NewServer" && s.kind === "function")).toBe(true);
  });

  it("extracts struct type", () => {
    const src = `type Server struct {\n\tAddr string\n}`;
    const syms = extractSymbols(src, "go");
    expect(syms.some((s) => s.name === "Server" && s.kind === "type")).toBe(true);
  });
});

// ── Rust ─────────────────────────────────────────────────────────────────────

describe("extractSymbols — Rust", () => {
  it("extracts pub fn", () => {
    const src = `pub async fn handle_request(req: Request) -> Response {\n    todo!()\n}`;
    const syms = extractSymbols(src, "rust");
    expect(syms.some((s) => s.name === "handle_request" && s.kind === "function")).toBe(true);
  });

  it("extracts struct", () => {
    const src = `pub struct AuthManager {\n    token: String,\n}`;
    const syms = extractSymbols(src, "rust");
    expect(syms.some((s) => s.name === "AuthManager" && s.kind === "struct")).toBe(true);
  });

  it("returns empty for unknown language", () => {
    expect(extractSymbols("anything", "unknown")).toEqual([]);
  });
});
