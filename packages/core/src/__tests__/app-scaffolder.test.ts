// packages/core/src/__tests__/app-scaffolder.test.ts
// Sprint 30 — Dim 10: Full-app generation tests
import { describe, it, expect } from "vitest";
import {
  detectProjectType,
  deriveProjectName,
  generateScaffold,
  formatScaffoldSummary,
  type ProjectType,
} from "../app-scaffolder.js";

// ─── detectProjectType ────────────────────────────────────────────────────────

describe("detectProjectType", () => {
  it("detects react-ts-app for TypeScript + React descriptions", () => {
    expect(detectProjectType("React TypeScript app with routing")).toBe("react-ts-app");
    expect(detectProjectType("Vite React TypeScript SPA")).toBe("react-ts-app");
  });

  it("detects react-app for React descriptions without TypeScript", () => {
    expect(detectProjectType("Build a React app with a shopping cart")).toBe("react-app");
  });

  it("detects node-api for API/backend descriptions", () => {
    expect(detectProjectType("REST API for managing user accounts")).toBe("node-api");
    expect(detectProjectType("Express server with authentication")).toBe("node-api");
  });

  it("detects python-cli for Python descriptions", () => {
    expect(detectProjectType("Python CLI tool for CSV processing")).toBe("python-cli");
    expect(detectProjectType("Flask web app for task tracking")).toBe("python-cli");
  });

  it("detects go-cli for Go descriptions", () => {
    expect(detectProjectType("Go CLI with cobra for file management")).toBe("go-cli");
    expect(detectProjectType("golang service for data processing")).toBe("go-cli");
  });

  it("detects library for library/sdk descriptions", () => {
    expect(detectProjectType("TypeScript utility library for date formatting")).toBe("library");
    expect(detectProjectType("reusable utility helpers for string manipulation")).toBe("library");
  });

  it("detects cli for CLI tool descriptions", () => {
    expect(detectProjectType("CLI tool for managing git workflows")).toBe("cli");
    expect(detectProjectType("command-line tool for file conversion")).toBe("cli");
  });

  it("falls back to unknown for vague descriptions", () => {
    expect(detectProjectType("my awesome project idea")).toBe("unknown");
  });
});

// ─── deriveProjectName ────────────────────────────────────────────────────────

describe("deriveProjectName", () => {
  it("converts description to slug", () => {
    expect(deriveProjectName("My Awesome REST API")).toBe("my-awesome-rest-api");
  });

  it("strips special characters", () => {
    expect(deriveProjectName("Hello, World! (v2)")).toMatch(/^[a-z0-9-]+$/);
  });

  it("limits length to 50 chars", () => {
    const long = "a".repeat(100) + " project";
    expect(deriveProjectName(long).length).toBeLessThanOrEqual(50);
  });

  it("uses only first line of multi-line description", () => {
    const name = deriveProjectName("Todo API\nWith authentication and JWT tokens");
    expect(name).toBe("todo-api");
  });

  it("returns my-project for empty/whitespace input", () => {
    expect(deriveProjectName("")).toBe("my-project");
    expect(deriveProjectName("   ")).toBe("my-project");
  });
});

// ─── generateScaffold ─────────────────────────────────────────────────────────

describe("generateScaffold", () => {
  it("returns a plan with files for node-api", () => {
    const plan = generateScaffold("REST API for todo items");
    expect(plan.projectType).toBe("node-api");
    expect(plan.files.length).toBeGreaterThan(3);
  });

  it("node-api includes src/index.ts and package.json", () => {
    const plan = generateScaffold("Express REST API");
    const paths = plan.files.map((f) => f.path);
    expect(paths).toContain("src/index.ts");
    expect(paths).toContain("package.json");
    expect(paths).toContain(".gitignore");
  });

  it("react-ts-app includes vite.config.ts and App.tsx", () => {
    const plan = generateScaffold("React TypeScript SPA with state management");
    const paths = plan.files.map((f) => f.path);
    expect(paths).toContain("vite.config.ts");
    expect(paths).toContain("src/App.tsx");
    expect(paths).toContain("index.html");
  });

  it("python-cli includes pyproject.toml and cli.py", () => {
    const plan = generateScaffold("Python CLI for file processing");
    const paths = plan.files.map((f) => f.path);
    expect(paths.some((p) => p.endsWith("pyproject.toml"))).toBe(true);
    expect(paths.some((p) => p.endsWith("cli.py"))).toBe(true);
  });

  it("go-cli includes go.mod and main.go", () => {
    const plan = generateScaffold("Go CLI with cobra");
    const paths = plan.files.map((f) => f.path);
    expect(paths).toContain("go.mod");
    expect(paths).toContain("main.go");
  });

  it("library includes src/index.ts and tsconfig.json", () => {
    const plan = generateScaffold("TypeScript utility library for math operations");
    expect(plan.projectType).toBe("library");
    const paths = plan.files.map((f) => f.path);
    expect(paths).toContain("src/index.ts");
    expect(paths).toContain("tsconfig.json");
  });

  it("respects projectName override", () => {
    const plan = generateScaffold("REST API", { projectName: "super-api" });
    expect(plan.projectName).toBe("super-api");
    const pkg = plan.files.find((f) => f.path === "package.json");
    expect(pkg?.content).toContain("super-api");
  });

  it("respects projectType override", () => {
    const plan = generateScaffold("my project", { projectType: "library" });
    expect(plan.projectType).toBe("library");
  });

  it("all file contents are non-empty strings", () => {
    const plan = generateScaffold("Node API for user management");
    for (const file of plan.files) {
      expect(typeof file.content).toBe("string");
      expect(file.content.length).toBeGreaterThan(0);
    }
  });

  it("includes post-install commands", () => {
    const plan = generateScaffold("React TypeScript app");
    expect(plan.postInstallCommands.length).toBeGreaterThan(0);
  });

  it("package.json content is valid JSON", () => {
    for (const type of ["node-api", "react-ts-app", "library", "cli"] as ProjectType[]) {
      const plan = generateScaffold("test", { projectType: type });
      const pkg = plan.files.find((f) => f.path === "package.json");
      if (pkg) {
        expect(() => JSON.parse(pkg.content)).not.toThrow();
      }
    }
  });

  it("unknown type returns README and gitignore", () => {
    const plan = generateScaffold("something vague and undefined");
    expect(plan.projectType).toBe("unknown");
    expect(plan.files.some((f) => f.path === "README.md")).toBe(true);
    expect(plan.files.some((f) => f.path === ".gitignore")).toBe(true);
  });
});

// ─── formatScaffoldSummary ────────────────────────────────────────────────────

describe("formatScaffoldSummary", () => {
  it("includes project name and type", () => {
    const plan = generateScaffold("REST API for todos");
    const summary = formatScaffoldSummary(plan);
    expect(summary).toContain(plan.projectName);
    expect(summary).toContain(plan.projectType);
  });

  it("lists all file paths", () => {
    const plan = generateScaffold("library for string utilities");
    const summary = formatScaffoldSummary(plan);
    for (const file of plan.files) {
      expect(summary).toContain(file.path);
    }
  });

  it("includes post-install commands", () => {
    const plan = generateScaffold("CLI tool");
    const summary = formatScaffoldSummary(plan);
    expect(summary).toContain("Post-install");
  });
});
