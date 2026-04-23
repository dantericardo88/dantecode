// packages/core/src/__tests__/scaffold-engine.test.ts
import { describe, it, expect } from "vitest";
import {
  scaffold,
  inferTemplate,
  formatScaffoldSummary,
  type ScaffoldSpec,
} from "../scaffold-engine.js";

describe("scaffold — react-app template", () => {
  const spec: ScaffoldSpec = {
    name: "my-app",
    description: "A test React app",
    template: "react-app",
  };

  it("produces files array with at least 5 files", () => {
    const result = scaffold(spec);
    expect(result.files.length).toBeGreaterThanOrEqual(5);
  });

  it("includes package.json", () => {
    const result = scaffold(spec);
    expect(result.files.some((f) => f.path === "package.json")).toBe(true);
  });

  it("includes src/App.tsx", () => {
    const result = scaffold(spec);
    expect(result.files.some((f) => f.path === "src/App.tsx")).toBe(true);
  });

  it("always includes .gitignore", () => {
    const result = scaffold(spec);
    expect(result.files.some((f) => f.path === ".gitignore")).toBe(true);
  });

  it("package.json contains project name", () => {
    const result = scaffold(spec);
    const pkg = result.files.find((f) => f.path === "package.json")!;
    expect(pkg.content).toContain('"my-app"');
  });

  it("postInstallCommands includes npm install", () => {
    const result = scaffold(spec);
    expect(result.postInstallCommands).toContain("npm install");
  });

  it("entryPoints only includes openInEditor files", () => {
    const result = scaffold(spec);
    expect(result.entryPoints.length).toBeGreaterThan(0);
    for (const ep of result.entryPoints) {
      const file = result.files.find((f) => f.path === ep);
      expect(file?.openInEditor).toBe(true);
    }
  });

  it("summary mentions template name and file count", () => {
    const result = scaffold(spec);
    expect(result.summary).toContain("react-app");
    expect(result.summary).toContain("my-app");
  });
});

describe("scaffold — express-api template", () => {
  const spec: ScaffoldSpec = {
    name: "my-api",
    description: "REST API",
    template: "express-api",
  };

  it("includes src/index.ts", () => {
    const result = scaffold(spec);
    expect(result.files.some((f) => f.path === "src/index.ts")).toBe(true);
  });

  it("src/index.ts uses project name", () => {
    const result = scaffold(spec);
    const file = result.files.find((f) => f.path === "src/index.ts")!;
    expect(file.content).toContain("my-api");
  });
});

describe("scaffold — cli-ts template", () => {
  const spec: ScaffoldSpec = {
    name: "my-cli",
    description: "A CLI tool",
    template: "cli-ts",
  };

  it("includes src/cli.ts", () => {
    const result = scaffold(spec);
    expect(result.files.some((f) => f.path === "src/cli.ts")).toBe(true);
  });

  it("package.json has bin entry", () => {
    const result = scaffold(spec);
    const pkg = result.files.find((f) => f.path === "package.json")!;
    const parsed = JSON.parse(pkg.content);
    expect(parsed.bin).toBeDefined();
  });
});

describe("scaffold — blank template", () => {
  const spec: ScaffoldSpec = {
    name: "my-blank",
    description: "Blank project",
    template: "blank",
  };

  it("does not add a second README.md (blank already has one)", () => {
    const result = scaffold(spec);
    const readmeFiles = result.files.filter((f) => f.path === "README.md");
    expect(readmeFiles.length).toBe(1);
  });
});

describe("scaffold — targetDir prefix", () => {
  it("prefixes all file paths with targetDir", () => {
    const result = scaffold({
      name: "proj",
      description: "d",
      template: "blank",
      targetDir: "output/proj",
    });
    for (const f of result.files) {
      expect(f.path.startsWith("output/proj/")).toBe(true);
    }
  });

  it("entryPoints also prefixed with targetDir", () => {
    const result = scaffold({
      name: "proj",
      description: "d",
      template: "library-ts",
      targetDir: "libs/proj",
    });
    for (const ep of result.entryPoints) {
      expect(ep.startsWith("libs/proj/")).toBe(true);
    }
  });
});

describe("scaffold — features overlay", () => {
  it("docker feature adds Dockerfile", () => {
    const result = scaffold({
      name: "app",
      description: "d",
      template: "express-api",
      features: ["docker"],
    });
    expect(result.files.some((f) => f.path === "Dockerfile")).toBe(true);
    expect(result.files.some((f) => f.path === "docker-compose.yml")).toBe(true);
  });

  it("ci feature adds GitHub Actions workflow", () => {
    const result = scaffold({
      name: "app",
      description: "d",
      template: "express-api",
      features: ["ci"],
    });
    expect(result.files.some((f) => f.path === ".github/workflows/ci.yml")).toBe(true);
  });

  it("env feature adds .env.example", () => {
    const result = scaffold({
      name: "app",
      description: "d",
      template: "express-api",
      features: ["env"],
    });
    expect(result.files.some((f) => f.path === ".env.example")).toBe(true);
  });

  it("lint feature adds .eslintrc.json and .prettierrc.json", () => {
    const result = scaffold({
      name: "app",
      description: "d",
      template: "express-api",
      features: ["lint"],
    });
    expect(result.files.some((f) => f.path === ".eslintrc.json")).toBe(true);
    expect(result.files.some((f) => f.path === ".prettierrc.json")).toBe(true);
  });

  it("summary mentions features when present", () => {
    const result = scaffold({
      name: "app",
      description: "d",
      template: "express-api",
      features: ["docker", "ci"],
    });
    expect(result.summary).toContain("docker");
    expect(result.summary).toContain("ci");
  });
});

describe("inferTemplate", () => {
  it("infers react-app for 'react frontend ui'", () => {
    expect(inferTemplate("build a react frontend ui")).toBe("react-app");
  });

  it("infers express-api for 'express node api'", () => {
    expect(inferTemplate("create an express node api server")).toBe("express-api");
  });

  it("infers next-app for 'nextjs app'", () => {
    expect(inferTemplate("nextjs web application")).toBe("next-app");
  });

  it("infers fullstack-next for 'full-stack app'", () => {
    expect(inferTemplate("full-stack web application")).toBe("fullstack-next");
  });

  it("infers fastapi for 'fastapi python api'", () => {
    expect(inferTemplate("fastapi python rest api")).toBe("fastapi");
  });

  it("infers cli-ts for 'command-line tool'", () => {
    expect(inferTemplate("build a command-line tool")).toBe("cli-ts");
  });

  it("infers library-py for 'python library'", () => {
    expect(inferTemplate("create a python library package")).toBe("library-py");
  });

  it("infers library-ts for 'npm package'", () => {
    expect(inferTemplate("create an npm package library")).toBe("library-ts");
  });

  it("returns blank for unrecognized description", () => {
    expect(inferTemplate("something completely unrelated xyz")).toBe("blank");
  });

  it("prefers react-app over library-ts when 'web app' mentioned without api", () => {
    expect(inferTemplate("build a react web app dashboard")).toBe("react-app");
  });
});

describe("formatScaffoldSummary", () => {
  it("contains file count and summary text", () => {
    const result = scaffold({ name: "app", description: "d", template: "blank" });
    const summary = formatScaffoldSummary(result);
    expect(summary).toContain("Files created:");
    expect(summary).toContain("README.md");
  });

  it("lists next steps with bash block for templates with commands", () => {
    const result = scaffold({ name: "app", description: "d", template: "react-app" });
    const summary = formatScaffoldSummary(result);
    expect(summary).toContain("Next steps:");
    expect(summary).toContain("npm install");
  });

  it("does not include next steps section for blank with empty commands", () => {
    const result = scaffold({ name: "app", description: "d", template: "blank" });
    const summary = formatScaffoldSummary(result);
    // blank has no post-install commands
    expect(summary).not.toContain("Next steps:");
  });
});
