// packages/core/src/__tests__/app-template-engine.test.ts
import { describe, it, expect } from "vitest";
import {
  resolveDependencies,
  generateApp,
  formatFileTree,
  findDependencyConflicts,
  formatAppSummaryForPrompt,
  type AppStackConfig,
} from "../app-template-engine.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<AppStackConfig> = {}): AppStackConfig {
  return {
    framework: "express",
    language: "typescript",
    projectName: "my-app",
    description: "A test app",
    features: {},
    ...overrides,
  };
}

// ─── resolveDependencies ──────────────────────────────────────────────────────

describe("resolveDependencies", () => {
  it("includes framework deps for next", () => {
    const { dependencies } = resolveDependencies(makeConfig({ framework: "next" }));
    expect(dependencies["next"]).toBeDefined();
    expect(dependencies["react"]).toBeDefined();
  });

  it("includes typescript devDeps when language is typescript", () => {
    const { devDependencies } = resolveDependencies(makeConfig({ language: "typescript" }));
    expect(devDependencies["typescript"]).toBeDefined();
    expect(devDependencies["@types/node"]).toBeDefined();
  });

  it("omits typescript devDeps for javascript", () => {
    const { devDependencies } = resolveDependencies(makeConfig({ language: "javascript" }));
    expect(devDependencies["typescript"]).toBeUndefined();
  });

  it("includes pg for postgresql database", () => {
    const { dependencies } = resolveDependencies(makeConfig({ features: { database: "postgresql" } }));
    expect(dependencies["pg"]).toBeDefined();
  });

  it("includes mongoose for mongodb database", () => {
    const { dependencies } = resolveDependencies(makeConfig({ features: { database: "mongodb" } }));
    expect(dependencies["mongoose"]).toBeDefined();
  });

  it("includes jsonwebtoken for jwt auth", () => {
    const { dependencies } = resolveDependencies(makeConfig({ features: { auth: "jwt" } }));
    expect(dependencies["jsonwebtoken"]).toBeDefined();
  });

  it("includes clerk package for clerk auth", () => {
    const { dependencies } = resolveDependencies(makeConfig({ features: { auth: "clerk" } }));
    expect(dependencies["@clerk/nextjs"]).toBeDefined();
  });

  it("puts vitest in devDependencies", () => {
    const { devDependencies } = resolveDependencies(makeConfig({ features: { testing: "vitest" } }));
    expect(devDependencies["vitest"]).toBeDefined();
  });

  it("includes pino when logging enabled", () => {
    const { dependencies } = resolveDependencies(makeConfig({ features: { logging: true } }));
    expect(dependencies["pino"]).toBeDefined();
  });

  it("includes eslint and prettier when lint enabled", () => {
    const { devDependencies } = resolveDependencies(makeConfig({ features: { lint: true } }));
    expect(devDependencies["eslint"]).toBeDefined();
    expect(devDependencies["prettier"]).toBeDefined();
  });

  it("includes bullmq when queue enabled", () => {
    const { dependencies } = resolveDependencies(makeConfig({ features: { queue: true } }));
    expect(dependencies["bullmq"]).toBeDefined();
  });

  it("includes ws for websockets", () => {
    const { dependencies } = resolveDependencies(makeConfig({ features: { websockets: true } }));
    expect(dependencies["ws"]).toBeDefined();
  });

  it("database:none adds no db deps", () => {
    const { dependencies } = resolveDependencies(makeConfig({ features: { database: "none" } }));
    expect(dependencies["pg"]).toBeUndefined();
    expect(dependencies["mongoose"]).toBeUndefined();
  });
});

// ─── generateApp ─────────────────────────────────────────────────────────────

describe("generateApp", () => {
  it("always generates package.json for non-python", () => {
    const app = generateApp(makeConfig());
    expect(app.files.some((f) => f.path === "package.json")).toBe(true);
  });

  it("does not generate package.json for python", () => {
    const app = generateApp(makeConfig({ language: "python", framework: "fastapi" }));
    expect(app.files.some((f) => f.path === "package.json")).toBe(false);
  });

  it("generates .env.example when env feature is on", () => {
    const app = generateApp(makeConfig({ features: { env: true } }));
    expect(app.files.some((f) => f.path === ".env.example")).toBe(true);
  });

  it("generates .gitignore when env feature is on", () => {
    const app = generateApp(makeConfig({ features: { env: true } }));
    expect(app.files.some((f) => f.path === ".gitignore")).toBe(true);
  });

  it("generates Dockerfile when docker feature is on", () => {
    const app = generateApp(makeConfig({ features: { docker: true } }));
    expect(app.files.some((f) => f.path === "Dockerfile")).toBe(true);
  });

  it("generates docker-compose.yml when docker feature is on", () => {
    const app = generateApp(makeConfig({ features: { docker: true } }));
    expect(app.files.some((f) => f.path === "docker-compose.yml")).toBe(true);
  });

  it("generates CI workflow when ci feature is on", () => {
    const app = generateApp(makeConfig({ features: { ci: true } }));
    expect(app.files.some((f) => f.path === ".github/workflows/ci.yml")).toBe(true);
  });

  it("always generates README.md", () => {
    const app = generateApp(makeConfig());
    expect(app.files.some((f) => f.path === "README.md")).toBe(true);
  });

  it("sets JWT_SECRET env var for jwt auth", () => {
    const app = generateApp(makeConfig({ features: { auth: "jwt" } }));
    expect(app.envVars["JWT_SECRET"]).toBeDefined();
  });

  it("sets DATABASE_URL for postgresql", () => {
    const app = generateApp(makeConfig({ features: { database: "postgresql" } }));
    expect(app.envVars["DATABASE_URL"]).toContain("postgresql://");
  });

  it("sets test script when testing is vitest", () => {
    const app = generateApp(makeConfig({ features: { testing: "vitest" } }));
    expect(app.scripts["test"]).toContain("vitest");
  });

  it("sets lint and format scripts when lint enabled", () => {
    const app = generateApp(makeConfig({ features: { lint: true } }));
    expect(app.scripts["lint"]).toBeDefined();
    expect(app.scripts["format"]).toBeDefined();
  });

  it("config is preserved in result", () => {
    const config = makeConfig({ projectName: "hello-world" });
    const app = generateApp(config);
    expect(app.config.projectName).toBe("hello-world");
  });

  it("always includes NODE_ENV and PORT env vars", () => {
    const app = generateApp(makeConfig());
    expect(app.envVars["NODE_ENV"]).toBe("development");
    expect(app.envVars["PORT"]).toBe("3000");
  });

  it("setup instructions reference python when language is python", () => {
    const app = generateApp(makeConfig({ language: "python", framework: "fastapi" }));
    expect(app.setupInstructions.some((s) => s.includes("pip"))).toBe(true);
  });

  it("setup instructions reference npm when language is typescript", () => {
    const app = generateApp(makeConfig());
    expect(app.setupInstructions.some((s) => s.includes("npm install"))).toBe(true);
  });
});

// ─── formatFileTree ───────────────────────────────────────────────────────────

describe("formatFileTree", () => {
  it("lists each file path indented", () => {
    const app = generateApp(makeConfig({ features: { env: true, ci: true } }));
    const tree = formatFileTree(app.files);
    expect(tree).toContain("package.json");
    expect(tree).toContain(".env.example");
  });

  it("returns empty string for no files", () => {
    expect(formatFileTree([])).toBe("");
  });
});

// ─── findDependencyConflicts ──────────────────────────────────────────────────

describe("findDependencyConflicts", () => {
  it("returns empty when no overlap", () => {
    const conflicts = findDependencyConflicts({ express: "^4" }, { typescript: "^5" });
    expect(conflicts).toHaveLength(0);
  });

  it("detects package in both deps and devDeps", () => {
    const conflicts = findDependencyConflicts({ vitest: "^2" }, { vitest: "^2" });
    expect(conflicts).toContain("vitest");
  });
});

// ─── formatAppSummaryForPrompt ────────────────────────────────────────────────

describe("formatAppSummaryForPrompt", () => {
  it("includes project name in summary", () => {
    const app = generateApp(makeConfig({ projectName: "dante-app" }));
    const summary = formatAppSummaryForPrompt(app);
    expect(summary).toContain("dante-app");
  });

  it("includes framework in summary", () => {
    const app = generateApp(makeConfig({ framework: "next" }));
    const summary = formatAppSummaryForPrompt(app);
    expect(summary).toContain("next");
  });

  it("includes file structure section", () => {
    const app = generateApp(makeConfig());
    expect(formatAppSummaryForPrompt(app)).toContain("File Structure");
  });

  it("includes setup section", () => {
    const app = generateApp(makeConfig());
    expect(formatAppSummaryForPrompt(app)).toContain("Setup");
  });
});
