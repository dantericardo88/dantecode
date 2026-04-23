import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock node:fs before importing the module under test
vi.mock("node:fs", () => ({
  readdirSync: vi.fn(),
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
}));

// Mock node:url so fileURLToPath is controllable
vi.mock("node:url", () => ({
  fileURLToPath: vi.fn((url: URL | string) => {
    const s = typeof url === "string" ? url : url.toString();
    // Convert file:///fake/path → /fake/path
    return s.replace(/^file:\/\//, "");
  }),
}));

import * as fs from "node:fs";
import {
  loadMicroagents,
  loadBundledMicroagents,
  findActiveMicroagents,
  formatMicroagentContext,
  type Microagent,
} from "../microagent-loader.js";

const mockReaddirSync = vi.mocked(fs.readdirSync);
const mockReadFileSync = vi.mocked(fs.readFileSync);
const mockExistsSync = vi.mocked(fs.existsSync);

// --- Helpers ---

function makeAgent(
  name: string,
  triggers: string[],
  content = `# ${name}`
): Microagent {
  return { name, triggers, content };
}

const SWE_BENCH_MD = `---
triggers:
  - swe-bench
  - swebench
  - "fix issue"
---

# SWE-bench Task Protocol

Follow this protocol.
`;

const PYTHON_MD = `---
triggers:
  - python
  - pytest
---

# Python Development Patterns

Run tests with pytest.
`;

const NO_FRONTMATTER_MD = `# Plain Agent

Some content without frontmatter.
`;

const EMPTY_TRIGGERS_MD = `---
triggers:
---

# Empty triggers agent
`;

// ---------------------------------------------------------------------------
// Group 1: parseFrontmatter / loadBundledMicroagents
// ---------------------------------------------------------------------------

describe("parseFrontmatter / loadBundledMicroagents", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("parses triggers from YAML frontmatter correctly", () => {
    // Simulate bundled dir existing with one file
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue(["swe-bench.md"] as unknown as ReturnType<
      typeof fs.readdirSync
    >);
    mockReadFileSync.mockReturnValue(SWE_BENCH_MD);

    const agents = loadBundledMicroagents();
    expect(agents).toHaveLength(1);
    expect(agents[0]!.name).toBe("swe-bench");
    expect(agents[0]!.triggers).toContain("swe-bench");
    expect(agents[0]!.triggers).toContain("swebench");
    expect(agents[0]!.triggers).toContain("fix issue");
  });

  it("uses filename as trigger when no frontmatter present", () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue(["myrule.md"] as unknown as ReturnType<
      typeof fs.readdirSync
    >);
    mockReadFileSync.mockReturnValue(NO_FRONTMATTER_MD);

    const agents = loadBundledMicroagents();
    expect(agents).toHaveLength(1);
    expect(agents[0]!.triggers).toEqual(["myrule"]);
    expect(agents[0]!.content).toContain("Plain Agent");
  });

  it("falls back to filename when triggers list is empty", () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue(["empty-agent.md"] as unknown as ReturnType<
      typeof fs.readdirSync
    >);
    mockReadFileSync.mockReturnValue(EMPTY_TRIGGERS_MD);

    const agents = loadBundledMicroagents();
    expect(agents).toHaveLength(1);
    expect(agents[0]!.triggers).toEqual(["empty-agent"]);
  });

  it("loadBundledMicroagents returns an array (handles real bundled dir gracefully)", () => {
    // When bundled dir does not exist, returns empty array — never throws
    mockExistsSync.mockReturnValue(false);
    const agents = loadBundledMicroagents();
    expect(Array.isArray(agents)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Group 2: loadMicroagents
// ---------------------------------------------------------------------------

describe("loadMicroagents", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns only bundled agents when project .openhands dir does not exist", () => {
    // Bundled dir exists with one file; local dir does not exist
    mockExistsSync.mockImplementation((p: fs.PathLike) => {
      const path = p.toString();
      if (path.includes(".openhands")) return false;
      return true; // bundled dir exists
    });
    mockReaddirSync.mockImplementation((p: fs.PathLike | fs.PathOrFileDescriptor) => {
      const path = p.toString();
      if (path.includes(".openhands")) return [] as unknown as ReturnType<typeof fs.readdirSync>;
      return ["python.md"] as unknown as ReturnType<typeof fs.readdirSync>;
    });
    mockReadFileSync.mockReturnValue(PYTHON_MD);

    const agents = loadMicroagents("/project");
    expect(agents.length).toBeGreaterThanOrEqual(1);
    expect(agents.some((a) => a.name === "python")).toBe(true);
  });

  it("loads project-local .md files plus bundled agents", () => {
    // Both dirs exist. Bundled: python.md. Local: custom.md
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockImplementation((p: fs.PathLike | fs.PathOrFileDescriptor) => {
      const path = p.toString();
      if (path.includes(".openhands")) {
        return ["custom.md"] as unknown as ReturnType<typeof fs.readdirSync>;
      }
      return ["python.md"] as unknown as ReturnType<typeof fs.readdirSync>;
    });
    mockReadFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
      const path = p.toString();
      if (path.includes("custom.md")) {
        return `# Custom Agent\nDoes custom things.`;
      }
      return PYTHON_MD;
    });

    const agents = loadMicroagents("/project");
    const names = agents.map((a) => a.name);
    expect(names).toContain("python");
    expect(names).toContain("custom");
  });

  it("project-local agent overrides bundled agent with same name", () => {
    mockExistsSync.mockReturnValue(true);
    // Both dirs have python.md but with different content
    const localPythonMd = `---
triggers:
  - python
  - django
---

# Local Python Override
`;
    mockReaddirSync.mockReturnValue(["python.md"] as unknown as ReturnType<
      typeof fs.readdirSync
    >);
    mockReadFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
      const path = p.toString();
      if (path.includes(".openhands")) return localPythonMd;
      return PYTHON_MD;
    });

    const agents = loadMicroagents("/project");
    const python = agents.find((a) => a.name === "python");
    expect(python).toBeDefined();
    // The local version has django trigger; original bundled does not
    expect(python!.triggers).toContain("django");
    expect(python!.content).toContain("Local Python Override");
  });

  it("ignores non-.md files in the microagents directory", () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockImplementation((p: fs.PathLike | fs.PathOrFileDescriptor) => {
      const path = p.toString();
      if (path.includes(".openhands")) {
        return ["agent.md", "README.txt", "config.json", ".gitkeep"] as unknown as ReturnType<typeof fs.readdirSync>;
      }
      return [] as unknown as ReturnType<typeof fs.readdirSync>;
    });
    mockReadFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
      const path = p.toString();
      if (path.endsWith("agent.md")) return `# Agent\nContent.`;
      throw new Error("should not read non-.md files");
    });

    const agents = loadMicroagents("/project");
    const names = agents.map((a) => a.name);
    expect(names).toContain("agent");
    expect(names).not.toContain("README");
    expect(names).not.toContain("config");
  });
});

// ---------------------------------------------------------------------------
// Group 3: findActiveMicroagents
// ---------------------------------------------------------------------------

describe("findActiveMicroagents", () => {
  const agents: Microagent[] = [
    makeAgent("swe-bench", ["swe-bench", "swebench", "fix issue"]),
    makeAgent("python", ["python", "pytest"]),
    makeAgent("typescript", ["typescript", "tsc", "type error"]),
  ];

  it("returns matching agent on exact keyword match (case insensitive)", () => {
    const result = findActiveMicroagents(agents, "I need to fix a SWE-BENCH task");
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("swe-bench");
  });

  it("returns empty array when no triggers match", () => {
    const result = findActiveMicroagents(agents, "Write a REST API in Go");
    expect(result).toHaveLength(0);
  });

  it("activates agent when any one of its multiple triggers matches", () => {
    const result = findActiveMicroagents(agents, "Run pytest on the new module");
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("python");
  });

  it("returns multiple agents when multiple triggers match", () => {
    const result = findActiveMicroagents(
      agents,
      "Run pytest for a python module and fix type error"
    );
    const names = result.map((a) => a.name);
    expect(names).toContain("python");
    expect(names).toContain("typescript");
  });

  it("returns empty array for empty prompt", () => {
    const result = findActiveMicroagents(agents, "");
    expect(result).toHaveLength(0);
  });

  it("returns empty array when microagents list is empty", () => {
    const result = findActiveMicroagents([], "swe-bench task");
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Group 4: formatMicroagentContext
// ---------------------------------------------------------------------------

describe("formatMicroagentContext", () => {
  it("returns empty string for empty array", () => {
    expect(formatMicroagentContext([])).toBe("");
  });

  it("single agent: output contains header and content", () => {
    const agent = makeAgent("swe-bench", ["swe-bench"], "# SWE Protocol\nDo the steps.");
    const output = formatMicroagentContext([agent]);
    expect(output).toContain("<!-- microagent: swe-bench -->");
    expect(output).toContain("<!-- /microagent -->");
    expect(output).toContain("# SWE Protocol");
  });

  it("multiple agents: all agents included in output", () => {
    const agentA = makeAgent("alpha", ["alpha"], "Alpha content.");
    const agentB = makeAgent("beta", ["beta"], "Beta content.");
    const output = formatMicroagentContext([agentA, agentB]);
    expect(output).toContain("<!-- microagent: alpha -->");
    expect(output).toContain("<!-- microagent: beta -->");
    expect(output).toContain("Alpha content.");
    expect(output).toContain("Beta content.");
  });

  it("output contains the '## Domain Knowledge' header", () => {
    const agent = makeAgent("test", ["test"], "Some knowledge.");
    const output = formatMicroagentContext([agent]);
    expect(output).toContain("## Domain Knowledge (Microagents)");
  });
});
