import { describe, it, expect } from "vitest";
import { chunkFile } from "./code-index.js";
import { extractSymbolDefinitions, extractImports } from "./repo-map-ast.js";
import { FIMEngine } from "./fim-engine.js";
import { VerificationRailRegistry } from "./rails-enforcer.js";
import { SecretsScanner } from "./secrets-scanner.js";
import { SecurityEngine } from "./security-engine.js";

describe("Code Intelligence E2E — Index to Completion Pipeline", () => {
  const sampleCode = `
export interface UserConfig {
  name: string;
  email: string;
}

export function validateUser(config: UserConfig): boolean {
  return config.name.length > 0 && config.email.includes("@");
}

export class UserService {
  private users: UserConfig[] = [];

  addUser(config: UserConfig): void {
    if (validateUser(config)) {
      this.users.push(config);
    }
  }

  getUsers(): UserConfig[] {
    return [...this.users];
  }
}
`.trim();

  it("indexes code, extracts symbols, and generates FIM context", () => {
    // Step 1: Chunk the code
    const chunks = chunkFile(sampleCode, "src/user.ts", 50);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]!.symbols.length).toBeGreaterThan(0);

    // Step 2: Extract symbol definitions
    const symbols = extractSymbolDefinitions(sampleCode, "src/user.ts");
    expect(symbols.some((s) => s.name === "UserConfig")).toBe(true);
    expect(symbols.some((s) => s.name === "validateUser")).toBe(true);
    expect(symbols.some((s) => s.name === "UserService")).toBe(true);

    // Step 3: Build FIM context at a cursor position
    const engine = new FIMEngine();
    const cursorOffset = sampleCode.indexOf("config.name.length");
    const ctx = engine.buildContext("src/user.ts", sampleCode, cursorOffset);
    expect(ctx.prefix).toContain("validateUser");
    expect(ctx.suffix).toContain("config.email");

    // Step 4: Build a prompt
    const prompt = engine.buildPrompt(ctx, "generic");
    expect(prompt.prompt).toContain("[FILL]");
    expect(prompt.model).toBe("generic");
  });

  it("validates FIM completion quality", () => {
    const engine = new FIMEngine();
    const ctx = engine.buildContext("src/user.ts", sampleCode, sampleCode.indexOf("config.name"));

    // Simulate a model completion
    const goodCompletion = "config.name.trim()";
    expect(engine.validateCompletion(goodCompletion, ctx)).toBe(true);
    expect(engine.estimateConfidence(goodCompletion, ctx)).toBeGreaterThan(0);

    // Empty completion should fail
    expect(engine.validateCompletion("", ctx)).toBe(false);
    expect(engine.estimateConfidence("", ctx)).toBe(0);
  });
});

describe("Code Intelligence E2E — Security Pipeline", () => {
  it("scans code for secrets before indexing", () => {
    const codeWithSecret = `
const API_KEY = "sk-ABC123456789012345678901234567890123456789012345678";
export function getClient() { return new Client(API_KEY); }
`;
    const scanner = new SecretsScanner();
    const result = scanner.scan(codeWithSecret);
    expect(result.clean).toBe(false);
    expect(result.matches.length).toBeGreaterThan(0);

    // Redact before indexing
    const safe = scanner.redact(codeWithSecret);
    expect(safe).not.toContain("sk-ABC123456789012345678901234567890123456789012345678");
  });

  it("validates output through security engine", () => {
    const secEngine = new SecurityEngine();

    // Safe output
    const safe = secEngine.checkAction({
      layer: "output",
      content: "Build succeeded. 42 tests passed.",
    });
    expect(safe.decision).toBe("allow");

    // Output with leaked credentials
    const unsafe = secEngine.checkAction({
      layer: "output",
      content: "Loaded key: AKIAIOSFODNN7EXAMPLE for deployment.",
    });
    expect(unsafe.decision).not.toBe("allow");
  });

  it("verification rails gate completion quality", () => {
    const registry = new VerificationRailRegistry();
    registry.addRail({
      id: "no-placeholder",
      name: "No Placeholders in Output",
      forbiddenPatterns: ["TODO", "FIXME"],
    });
    registry.addRail({
      id: "min-content",
      name: "Minimum Content Length",
      minLength: 5,
    });

    // Good output passes rails
    const goodFindings = registry.evaluate("completion task", "return x + y;");
    expect(goodFindings.every((f) => f.passed)).toBe(true);

    // Bad output fails rails
    const badFindings = registry.evaluate("completion task", "TODO");
    expect(badFindings.some((f) => !f.passed)).toBe(true);
  });
});

describe("Code Intelligence E2E — Symbol Extraction Chain", () => {
  it("extracts symbols and import edges from multi-file project", () => {
    const fileA = `
import { helper } from "./utils.js";
export function main() { return helper(); }
`;
    const fileB = `
export function helper(): string { return "ok"; }
export const VERSION = "1.0.0";
`;

    const symbolsA = extractSymbolDefinitions(fileA, "src/main.ts");
    const symbolsB = extractSymbolDefinitions(fileB, "src/utils.ts");
    const importsA = extractImports(fileA, "src/main.ts");

    // main.ts defines 'main', imports from utils (normalized: .js stripped)
    expect(symbolsA.some((s) => s.name === "main")).toBe(true);
    expect(importsA.some((e) => e.to === "./utils")).toBe(true);

    // utils.ts defines 'helper' and 'VERSION'
    expect(symbolsB.some((s) => s.name === "helper")).toBe(true);
    expect(symbolsB.some((s) => s.name === "VERSION")).toBe(true);
  });

  it("chunks large files and preserves symbol information", () => {
    const lines: string[] = [];
    for (let i = 0; i < 20; i++) {
      lines.push(`export function fn${i}() { return ${i}; }`);
    }
    const content = lines.join("\n");
    const chunks = chunkFile(content, "src/many-fns.ts", 8);

    // Should produce multiple chunks
    expect(chunks.length).toBeGreaterThan(1);

    // All function symbols should be found across chunks
    const allSymbols = chunks.flatMap((c) => c.symbols);
    expect(allSymbols.length).toBeGreaterThan(0);
  });
});
