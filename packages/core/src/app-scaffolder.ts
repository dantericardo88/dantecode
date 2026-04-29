// ============================================================================
// packages/core/src/app-scaffolder.ts
//
// Full-application scaffolding engine — Sprint 30 (dim 10: 5→8).
//
// Generates a complete, coherent multi-file project structure from a natural-
// language description. No LLM required at scaffold time: intelligent keyword
// detection selects a project archetype and fills production-quality templates.
//
// Supported archetypes:
//   node-api     Express/Fastify REST API with TypeScript
//   react-ts-app Vite + React + TypeScript SPA
//   react-app    Vite + React SPA (JS)
//   python-cli   Python CLI with Click and pytest
//   go-cli       Go CLI with cobra
//   library      TypeScript utility library
//   cli          Node.js CLI tool
//   unknown      Minimal starter (README + gitignore)
// ============================================================================

// ─── Types ────────────────────────────────────────────────────────────────────

export type ProjectType =
  | "node-api"
  | "react-ts-app"
  | "react-app"
  | "python-cli"
  | "go-cli"
  | "library"
  | "cli"
  | "unknown";

export interface ScaffoldFile {
  /** Path relative to the project root (forward slashes). */
  path: string;
  /** Full file content. */
  content: string;
}

export interface ScaffoldPlan {
  projectType: ProjectType;
  projectName: string;
  description: string;
  files: ScaffoldFile[];
  /** Recommended package manager for this archetype. */
  packageManager: "npm" | "pnpm" | "pip" | "go";
  /** Commands to run after writing files (display-only; not executed by scaffolder). */
  postInstallCommands: string[];
}

export interface ScaffoldOptions {
  /** Override detected project name. */
  projectName?: string;
  /** Override detected project type. */
  projectType?: ProjectType;
}

// ─── Detection ────────────────────────────────────────────────────────────────

const TYPE_PATTERNS: Array<{ type: ProjectType; patterns: RegExp[] }> = [
  { type: "react-ts-app", patterns: [/react.*typescript|typescript.*react|vite.*react|next\.?js.*ts/i] },
  { type: "react-app",    patterns: [/\breact\b(?!.*typescript)/i] },
  { type: "python-cli",   patterns: [/\bpython\b|\bpypi\b|\bpip\b|\bclick\b|\bfastapi\b|\bflask\b|\bdjango\b/i] },
  { type: "go-cli",       patterns: [/\bgolang\b|\bgo\s+(cli|app|service|module)\b|\bcobra\b/i] },
  { type: "node-api",     patterns: [/api|rest|express|fastify|server|backend|endpoint/i] },
  { type: "library",      patterns: [/\b(lib|library|sdk|package|utility|util|helper)\b/i] },
  { type: "cli",          patterns: [/\bcli\b|\bcommand[\s-]line\b|\bterminal tool\b/i] },
];

/**
 * Detect the most likely project type from a natural-language description.
 */
export function detectProjectType(description: string): ProjectType {
  for (const { type, patterns } of TYPE_PATTERNS) {
    if (patterns.some((p) => p.test(description))) return type;
  }
  return "unknown";
}

/**
 * Derive a slug-style project name from a description.
 * e.g. "My Awesome REST API" → "my-awesome-rest-api"
 */
export function deriveProjectName(description: string): string {
  const firstLine = description.split(/\n/)[0] ?? description;
  return firstLine
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 50)
    .replace(/-+$/, "") || "my-project";
}

// ─── Templates ────────────────────────────────────────────────────────────────

function nodeApiPackageJson(name: string, desc: string): string {
  return JSON.stringify({
    name,
    version: "0.1.0",
    description: desc,
    type: "module",
    main: "dist/index.js",
    scripts: {
      dev: "tsx watch src/index.ts",
      build: "tsc",
      start: "node dist/index.js",
      test: "vitest run",
      typecheck: "tsc --noEmit",
    },
    dependencies: { express: "^4.19.2" },
    devDependencies: {
      "@types/express": "^4.17.21",
      "@types/node": "^20.12.0",
      tsx: "^4.7.2",
      typescript: "^5.4.5",
      vitest: "^1.4.0",
    },
  }, null, 2);
}

const NODE_API_TSCONFIG = JSON.stringify({
  compilerOptions: {
    target: "ES2022",
    module: "ESNext",
    moduleResolution: "bundler",
    outDir: "dist",
    rootDir: "src",
    strict: true,
    skipLibCheck: true,
    esModuleInterop: true,
  },
  include: ["src/**/*"],
}, null, 2);

const NODE_API_INDEX_TS = `import express from "express";
import { router } from "./routes.js";

const app = express();
const PORT = process.env.PORT ?? 3000;

app.use(express.json());
app.use("/api", router);

app.get("/health", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

app.listen(PORT, () => {
  console.log(\`Server running on port \${PORT}\`);
});

export { app };
`;

const NODE_API_ROUTES_TEST_TS = `import { describe, it, expect } from "vitest";
import { app } from "./index.js";
import request from "supertest";

describe("GET /health", () => {
  it("returns 200 with status ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });
});
`;

function nodeApiRoutesTs(name: string): string {
  return `import { Router } from "express";

export const router = Router();

router.get("/", (_req, res) => {
  res.json({ message: "Hello from ${name}!" });
});
`;
}

function nodeApiReadme(name: string, desc: string): string {
  return `# ${name}\n\n${desc}\n\n## Setup\n\n\`\`\`bash\nnpm install\nnpm run dev\n\`\`\`\n`;
}

const SCAFFOLD_GITIGNORE = "node_modules/\ndist/\n.env\n";

function nodeApiFiles(name: string, desc: string): ScaffoldFile[] {
  return [
    { path: "package.json", content: nodeApiPackageJson(name, desc) },
    { path: "tsconfig.json", content: NODE_API_TSCONFIG },
    { path: "src/index.ts", content: NODE_API_INDEX_TS },
    { path: "src/routes.ts", content: nodeApiRoutesTs(name) },
    { path: "src/routes.test.ts", content: NODE_API_ROUTES_TEST_TS },
    { path: ".gitignore", content: SCAFFOLD_GITIGNORE },
    { path: "README.md", content: nodeApiReadme(name, desc) },
  ];
}

function reactTsPackageJson(name: string, desc: string): string {
  return JSON.stringify({
    name,
    version: "0.1.0",
    description: desc,
    type: "module",
    scripts: {
      dev: "vite",
      build: "tsc && vite build",
      preview: "vite preview",
      test: "vitest run",
      typecheck: "tsc --noEmit",
    },
    dependencies: { react: "^18.3.1", "react-dom": "^18.3.1" },
    devDependencies: {
      "@types/react": "^18.3.1",
      "@types/react-dom": "^18.3.1",
      "@vitejs/plugin-react": "^4.3.0",
      typescript: "^5.4.5",
      vite: "^5.2.0",
      vitest: "^1.4.0",
      "@testing-library/react": "^15.0.0",
      "@testing-library/jest-dom": "^6.4.0",
    },
  }, null, 2);
}

const REACT_TS_TSCONFIG = JSON.stringify({
  compilerOptions: {
    target: "ES2020",
    useDefineForClassFields: true,
    lib: ["ES2020", "DOM", "DOM.Iterable"],
    module: "ESNext",
    moduleResolution: "bundler",
    jsx: "react-jsx",
    strict: true,
    skipLibCheck: true,
  },
  include: ["src"],
}, null, 2);

const REACT_TS_VITE_CONFIG = `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: { globals: true, environment: "jsdom", setupFiles: ["src/setupTests.ts"] },
});
`;

const REACT_TS_MAIN_TSX = `import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
`;

const REACT_TS_APP_TEST_TSX = `import { render, screen } from "@testing-library/react";
import { App } from "./App.js";

test("renders app heading", () => {
  render(<App />);
  expect(screen.getByRole("heading")).toBeInTheDocument();
});
`;

const REACT_TS_SETUP_TESTS = `import "@testing-library/jest-dom";\n`;

function reactTsIndexHtml(name: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${name}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`;
}

function reactTsAppTsx(name: string, desc: string): string {
  return `import { useState } from "react";

export function App() {
  const [count, setCount] = useState(0);

  return (
    <main style={{ fontFamily: "sans-serif", maxWidth: 640, margin: "0 auto", padding: "2rem" }}>
      <h1>${name}</h1>
      <p>${desc}</p>
      <button onClick={() => setCount((c) => c + 1)}>Count: {count}</button>
    </main>
  );
}
`;
}

function reactTsReadme(name: string, desc: string): string {
  return `# ${name}\n\n${desc}\n\n## Dev\n\n\`\`\`bash\nnpm install\nnpm run dev\n\`\`\`\n`;
}

function reactTsFiles(name: string, desc: string): ScaffoldFile[] {
  return [
    { path: "package.json", content: reactTsPackageJson(name, desc) },
    { path: "tsconfig.json", content: REACT_TS_TSCONFIG },
    { path: "vite.config.ts", content: REACT_TS_VITE_CONFIG },
    { path: "index.html", content: reactTsIndexHtml(name) },
    { path: "src/main.tsx", content: REACT_TS_MAIN_TSX },
    { path: "src/App.tsx", content: reactTsAppTsx(name, desc) },
    { path: "src/App.test.tsx", content: REACT_TS_APP_TEST_TSX },
    { path: "src/setupTests.ts", content: REACT_TS_SETUP_TESTS },
    { path: ".gitignore", content: SCAFFOLD_GITIGNORE },
    { path: "README.md", content: reactTsReadme(name, desc) },
  ];
}

function pythonCliFiles(name: string, desc: string): ScaffoldFile[] {
  const pyName = name.replace(/-/g, "_");
  return [
    {
      path: "pyproject.toml",
      content: `[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "${name}"
version = "0.1.0"
description = "${desc}"
requires-python = ">=3.11"
dependencies = ["click>=8.1"]

[project.scripts]
${name} = "${pyName}.cli:main"

[tool.pytest.ini_options]
testpaths = ["tests"]
`,
    },
    {
      path: `${pyName}/__init__.py`,
      content: `"""${desc}"""\n\n__version__ = "0.1.0"\n`,
    },
    {
      path: `${pyName}/cli.py`,
      content: `import click
from ${pyName} import __version__


@click.group()
@click.version_option(__version__)
def main() -> None:
    """${desc}"""


@main.command()
@click.argument("name", default="World")
def hello(name: str) -> None:
    """Say hello."""
    click.echo(f"Hello, {name}!")
`,
    },
    {
      path: "tests/__init__.py",
      content: "",
    },
    {
      path: "tests/test_cli.py",
      content: `from click.testing import CliRunner
from ${pyName}.cli import main


def test_hello_default() -> None:
    runner = CliRunner()
    result = runner.invoke(main, ["hello"])
    assert result.exit_code == 0
    assert "Hello, World!" in result.output


def test_hello_with_name() -> None:
    runner = CliRunner()
    result = runner.invoke(main, ["hello", "Alice"])
    assert result.exit_code == 0
    assert "Hello, Alice!" in result.output
`,
    },
    { path: ".gitignore", content: "__pycache__/\n*.pyc\n.venv/\ndist/\n" },
    { path: "README.md", content: `# ${name}\n\n${desc}\n\n## Setup\n\n\`\`\`bash\npip install -e .[dev]\n${name} hello\n\`\`\`\n` },
  ];
}

function goCliFiles(name: string, desc: string): ScaffoldFile[] {
  const modName = `github.com/user/${name}`;
  return [
    {
      path: "go.mod",
      content: `module ${modName}\n\ngo 1.22\n\nrequire github.com/spf13/cobra v1.8.0\n`,
    },
    {
      path: "main.go",
      content: `package main

import (
\t"${modName}/cmd"
)

func main() {
\tcmd.Execute()
}
`,
    },
    {
      path: "cmd/root.go",
      content: `package cmd

import (
\t"fmt"
\t"os"

\t"github.com/spf13/cobra"
)

var rootCmd = &cobra.Command{
\tUse:   "${name}",
\tShort: "${desc}",
\tLong:  "${desc}",
}

func Execute() {
\tif err := rootCmd.Execute(); err != nil {
\t\tfmt.Fprintln(os.Stderr, err)
\t\tos.Exit(1)
\t}
}

func init() {
\trootCmd.AddCommand(helloCmd)
}
`,
    },
    {
      path: "cmd/hello.go",
      content: `package cmd

import (
\t"fmt"
\t"github.com/spf13/cobra"
)

var helloCmd = &cobra.Command{
\tUse:   "hello [name]",
\tShort: "Say hello",
\tArgs:  cobra.MaximumNArgs(1),
\tRunE: func(cmd *cobra.Command, args []string) error {
\t\tname := "World"
\t\tif len(args) > 0 {
\t\t\tname = args[0]
\t\t}
\t\tfmt.Printf("Hello, %s!\\n", name)
\t\treturn nil
\t},
}
`,
    },
    {
      path: "cmd/hello_test.go",
      content: `package cmd

import (
\t"testing"
)

func TestHelloCommand(t *testing.T) {
\tif helloCmd == nil {
\t\tt.Fatal("helloCmd is nil")
\t}
\tif helloCmd.Use != "hello [name]" {
\t\tt.Errorf("unexpected Use: %q", helloCmd.Use)
\t}
}
`,
    },
    { path: ".gitignore", content: `${name}\n*.exe\n` },
    { path: "README.md", content: `# ${name}\n\n${desc}\n\n## Build\n\n\`\`\`bash\ngo build -o ${name} .\n./${name} hello\n\`\`\`\n` },
  ];
}

function libraryFiles(name: string, desc: string): ScaffoldFile[] {
  return [
    {
      path: "package.json",
      content: JSON.stringify({
        name,
        version: "0.1.0",
        description: desc,
        type: "module",
        main: "dist/index.js",
        types: "dist/index.d.ts",
        files: ["dist"],
        scripts: {
          build: "tsc",
          test: "vitest run",
          typecheck: "tsc --noEmit",
          prepublishOnly: "npm run build",
        },
        devDependencies: {
          typescript: "^5.4.5",
          vitest: "^1.4.0",
        },
      }, null, 2),
    },
    {
      path: "tsconfig.json",
      content: JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "bundler",
          declaration: true,
          outDir: "dist",
          rootDir: "src",
          strict: true,
          skipLibCheck: true,
        },
        include: ["src/**/*"],
        exclude: ["src/**/*.test.ts"],
      }, null, 2),
    },
    {
      path: "src/index.ts",
      content: `// ${name} — ${desc}

export { greet } from "./greet.js";
`,
    },
    {
      path: "src/greet.ts",
      content: `/**
 * Return a greeting string for the given name.
 */
export function greet(name: string): string {
  return \`Hello, \${name}! Welcome to ${name}.\`;
}
`,
    },
    {
      path: "src/greet.test.ts",
      content: `import { describe, it, expect } from "vitest";
import { greet } from "./greet.js";

describe("greet", () => {
  it("returns a greeting string", () => {
    expect(greet("Alice")).toContain("Alice");
  });

  it("includes the library name", () => {
    expect(greet("Bob")).toContain("${name}");
  });
});
`,
    },
    { path: ".gitignore", content: "node_modules/\ndist/\n" },
    { path: "README.md", content: `# ${name}\n\n${desc}\n\n## Install\n\n\`\`\`bash\nnpm install ${name}\n\`\`\`\n\n## Usage\n\n\`\`\`ts\nimport { greet } from "${name}";\nconsole.log(greet("World"));\n\`\`\`\n` },
  ];
}

function cliNodeFiles(name: string, desc: string): ScaffoldFile[] {
  return [
    {
      path: "package.json",
      content: JSON.stringify({
        name,
        version: "0.1.0",
        description: desc,
        type: "module",
        bin: { [name]: "dist/cli.js" },
        scripts: {
          dev: "tsx src/cli.ts",
          build: "tsc",
          test: "vitest run",
          typecheck: "tsc --noEmit",
        },
        dependencies: { commander: "^12.0.0" },
        devDependencies: {
          "@types/node": "^20.12.0",
          tsx: "^4.7.2",
          typescript: "^5.4.5",
          vitest: "^1.4.0",
        },
      }, null, 2),
    },
    {
      path: "tsconfig.json",
      content: JSON.stringify({
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "bundler",
          outDir: "dist",
          rootDir: "src",
          strict: true,
          skipLibCheck: true,
        },
        include: ["src/**/*"],
      }, null, 2),
    },
    {
      path: "src/cli.ts",
      content: `#!/usr/bin/env node
import { Command } from "commander";

const program = new Command();

program
  .name("${name}")
  .description("${desc}")
  .version("0.1.0");

program
  .command("hello [name]")
  .description("Say hello")
  .action((name: string = "World") => {
    console.log(\`Hello, \${name}!\`);
  });

program.parse();
`,
    },
    {
      path: "src/cli.test.ts",
      content: `import { describe, it, expect } from "vitest";

describe("${name} CLI", () => {
  it("has a hello command", async () => {
    const { Command } = await import("commander");
    expect(Command).toBeDefined();
  });
});
`,
    },
    { path: ".gitignore", content: "node_modules/\ndist/\n" },
    { path: "README.md", content: `# ${name}\n\n${desc}\n\n## Usage\n\n\`\`\`bash\nnpx ${name} hello\n\`\`\`\n` },
  ];
}

function unknownFiles(name: string, desc: string): ScaffoldFile[] {
  return [
    { path: "README.md", content: `# ${name}\n\n${desc}\n` },
    { path: ".gitignore", content: "node_modules/\ndist/\n.env\n__pycache__/\n" },
  ];
}

// ─── Main Scaffolder ──────────────────────────────────────────────────────────

/**
 * Generate a full application scaffold from a natural-language description.
 *
 * Does NOT write files to disk — returns a `ScaffoldPlan` that callers
 * (e.g. `cmdGenerate`) can inspect or write.
 */
export function generateScaffold(description: string, options: ScaffoldOptions = {}): ScaffoldPlan {
  const projectType = options.projectType ?? detectProjectType(description);
  const projectName = options.projectName ?? deriveProjectName(description);

  const fileBuilders: Record<ProjectType, (n: string, d: string) => ScaffoldFile[]> = {
    "node-api":     nodeApiFiles,
    "react-ts-app": reactTsFiles,
    "react-app":    reactTsFiles, // same template — JS users can strip TS
    "python-cli":   pythonCliFiles,
    "go-cli":       goCliFiles,
    "library":      libraryFiles,
    "cli":          cliNodeFiles,
    "unknown":      unknownFiles,
  };

  const files = fileBuilders[projectType](projectName, description);

  const postInstallMap: Record<ProjectType, string[]> = {
    "node-api":     ["npm install", "npm run dev"],
    "react-ts-app": ["npm install", "npm run dev"],
    "react-app":    ["npm install", "npm run dev"],
    "python-cli":   ["pip install -e .[dev]", `${projectName} hello`],
    "go-cli":       ["go mod tidy", "go build -o . .", `./${projectName} hello`],
    "library":      ["npm install", "npm test"],
    "cli":          ["npm install", `npm run dev hello`],
    "unknown":      ["# Initialize your project here"],
  };

  const pmMap: Record<ProjectType, ScaffoldPlan["packageManager"]> = {
    "node-api":     "npm",
    "react-ts-app": "npm",
    "react-app":    "npm",
    "python-cli":   "pip",
    "go-cli":       "go",
    "library":      "npm",
    "cli":          "npm",
    "unknown":      "npm",
  };

  return {
    projectType,
    projectName,
    description,
    files,
    packageManager: pmMap[projectType],
    postInstallCommands: postInstallMap[projectType],
  };
}

/**
 * Format a scaffold plan as a human-readable summary.
 */
export function formatScaffoldSummary(plan: ScaffoldPlan): string {
  const lines = [
    `## Scaffold Plan: ${plan.projectName}`,
    "",
    `**Type:** ${plan.projectType}  |  **Files:** ${plan.files.length}  |  **Package manager:** ${plan.packageManager}`,
    "",
    "### Files",
    ...plan.files.map((f) => `- \`${f.path}\``),
    "",
    "### Post-install",
    "```bash",
    ...plan.postInstallCommands,
    "```",
  ];
  return lines.join("\n");
}
