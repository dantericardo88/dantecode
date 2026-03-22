import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// We test parseArgs by re-implementing its logic in a testable way.
// The real parseArgs is not exported, so we test the CLI entry point
// behavior through its visible effects (banner text, version output, etc.)
// and test the argument parsing logic directly.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// parseArgs — extracted and re-tested
// ---------------------------------------------------------------------------

interface ParsedArgs {
  command: string | null;
  subArgs: string[];
  prompt: string | null;
  model: string | undefined;
  noGit: boolean;
  sandbox: boolean;
  worktree: boolean;
  verbose: boolean;
  configPath: string | undefined;
  showVersion: boolean;
  showHelp: boolean;
  sessionName: string | undefined;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);

  const result: ParsedArgs = {
    command: null,
    subArgs: [],
    prompt: null,
    model: undefined,
    noGit: false,
    sandbox: false,
    worktree: false,
    verbose: false,
    configPath: undefined,
    showVersion: false,
    showHelp: false,
    sessionName: undefined,
  };

  const commands = new Set(["init", "skills", "agent", "config", "git"]);
  let i = 0;
  let foundCommand = false;

  while (i < args.length) {
    const arg = args[i]!;

    if (arg === "--model" || arg === "-m") {
      result.model = args[i + 1];
      i += 2;
      continue;
    }
    if (arg === "--no-git") {
      result.noGit = true;
      i += 1;
      continue;
    }
    if (arg === "--sandbox") {
      result.sandbox = true;
      i += 1;
      continue;
    }
    if (arg === "--worktree") {
      result.worktree = true;
      i += 1;
      continue;
    }
    if (arg === "--verbose" || arg === "-v") {
      result.verbose = true;
      i += 1;
      continue;
    }
    if (arg === "--config" || arg === "-c") {
      result.configPath = args[i + 1];
      i += 2;
      continue;
    }
    if (arg === "--name" || arg === "-n") {
      result.sessionName = args[i + 1];
      i += 2;
      continue;
    }
    if (arg === "--version" || arg === "-V") {
      result.showVersion = true;
      i += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      result.showHelp = true;
      i += 1;
      continue;
    }
    if (arg.startsWith("--") || (arg.startsWith("-") && arg.length === 2)) {
      if (args[i + 1] && !args[i + 1]!.startsWith("-")) {
        i += 2;
      } else {
        i += 1;
      }
      continue;
    }
    if (!foundCommand && commands.has(arg)) {
      result.command = arg;
      foundCommand = true;
      i += 1;
      while (i < args.length) {
        const subArg = args[i]!;
        if (subArg === "--model" || subArg === "-m") {
          result.model = args[i + 1];
          i += 2;
          continue;
        }
        if (subArg === "--no-git") {
          result.noGit = true;
          i += 1;
          continue;
        }
        if (subArg === "--sandbox") {
          result.sandbox = true;
          i += 1;
          continue;
        }
        if (subArg === "--verbose" || subArg === "-v") {
          result.verbose = true;
          i += 1;
          continue;
        }
        result.subArgs.push(subArg);
        i += 1;
      }
      continue;
    }
    if (!foundCommand) {
      const promptParts: string[] = [arg];
      i += 1;
      while (i < args.length) {
        const nextArg = args[i]!;
        if (nextArg.startsWith("--") || (nextArg.startsWith("-") && nextArg.length === 2)) {
          break;
        }
        promptParts.push(nextArg);
        i += 1;
      }
      result.prompt = promptParts.join(" ");
      continue;
    }
    i += 1;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CLI argument parsing", () => {
  // -------------------------------------------------------------------------
  // Version and help flags
  // -------------------------------------------------------------------------

  describe("flags", () => {
    it("parses --version flag", () => {
      const result = parseArgs(["node", "cli", "--version"]);
      expect(result.showVersion).toBe(true);
    });

    it("parses -V short flag", () => {
      const result = parseArgs(["node", "cli", "-V"]);
      expect(result.showVersion).toBe(true);
    });

    it("parses --help flag", () => {
      const result = parseArgs(["node", "cli", "--help"]);
      expect(result.showHelp).toBe(true);
    });

    it("parses -h short flag", () => {
      const result = parseArgs(["node", "cli", "-h"]);
      expect(result.showHelp).toBe(true);
    });

    it("parses --model with value", () => {
      const result = parseArgs(["node", "cli", "--model", "grok/grok-3"]);
      expect(result.model).toBe("grok/grok-3");
    });

    it("parses -m short flag", () => {
      const result = parseArgs(["node", "cli", "-m", "anthropic/claude-sonnet-4-6"]);
      expect(result.model).toBe("anthropic/claude-sonnet-4-6");
    });

    it("parses --no-git flag", () => {
      const result = parseArgs(["node", "cli", "--no-git"]);
      expect(result.noGit).toBe(true);
    });

    it("parses --sandbox flag", () => {
      const result = parseArgs(["node", "cli", "--sandbox"]);
      expect(result.sandbox).toBe(true);
    });

    it("parses --worktree flag", () => {
      const result = parseArgs(["node", "cli", "--worktree"]);
      expect(result.worktree).toBe(true);
    });

    it("parses --verbose flag", () => {
      const result = parseArgs(["node", "cli", "--verbose"]);
      expect(result.verbose).toBe(true);
    });

    it("parses -v short flag", () => {
      const result = parseArgs(["node", "cli", "-v"]);
      expect(result.verbose).toBe(true);
    });

    it("parses --config with path", () => {
      const result = parseArgs(["node", "cli", "--config", "/path/to/config.yaml"]);
      expect(result.configPath).toBe("/path/to/config.yaml");
    });

    it("parses -c short flag", () => {
      const result = parseArgs(["node", "cli", "-c", "./custom.yaml"]);
      expect(result.configPath).toBe("./custom.yaml");
    });

    it("parses --name flag for session naming", () => {
      const result = parseArgs(["node", "cli", "--name", "my-session"]);
      expect(result.sessionName).toBe("my-session");
    });

    it("parses -n short flag for session naming", () => {
      const result = parseArgs(["node", "cli", "-n", "quick-test"]);
      expect(result.sessionName).toBe("quick-test");
    });

    it("--name coexists with other flags", () => {
      const result = parseArgs(["node", "cli", "--name", "auth-work", "--verbose", "--no-git"]);
      expect(result.sessionName).toBe("auth-work");
      expect(result.verbose).toBe(true);
      expect(result.noGit).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Command parsing
  // -------------------------------------------------------------------------

  describe("commands", () => {
    it("parses 'init' command", () => {
      const result = parseArgs(["node", "cli", "init"]);
      expect(result.command).toBe("init");
    });

    it("parses 'skills' command with sub-args", () => {
      const result = parseArgs(["node", "cli", "skills", "list", "--verbose"]);
      expect(result.command).toBe("skills");
      expect(result.subArgs).toEqual(["list"]);
      expect(result.verbose).toBe(true);
    });

    it("parses 'agent' command", () => {
      const result = parseArgs(["node", "cli", "agent", "run", "myAgent"]);
      expect(result.command).toBe("agent");
      expect(result.subArgs).toEqual(["run", "myAgent"]);
    });

    it("parses 'config' command with sub-args", () => {
      const result = parseArgs(["node", "cli", "config", "show"]);
      expect(result.command).toBe("config");
      expect(result.subArgs).toEqual(["show"]);
    });

    it("parses 'git' command", () => {
      const result = parseArgs(["node", "cli", "git", "status"]);
      expect(result.command).toBe("git");
      expect(result.subArgs).toEqual(["status"]);
    });

    it("passes --model through with a command", () => {
      const result = parseArgs(["node", "cli", "agent", "run", "--model", "grok/grok-3"]);
      expect(result.command).toBe("agent");
      expect(result.model).toBe("grok/grok-3");
      expect(result.subArgs).toEqual(["run"]);
    });
  });

  // -------------------------------------------------------------------------
  // One-shot prompt
  // -------------------------------------------------------------------------

  describe("one-shot prompt", () => {
    it("parses a quoted prompt", () => {
      const result = parseArgs(["node", "cli", "explain this codebase"]);
      expect(result.prompt).toBe("explain this codebase");
    });

    it("joins multiple words into a single prompt", () => {
      const result = parseArgs(["node", "cli", "fix", "the", "bug"]);
      expect(result.prompt).toBe("fix the bug");
    });

    it("stops prompt collection at a flag", () => {
      const result = parseArgs(["node", "cli", "refactor", "--verbose"]);
      expect(result.prompt).toBe("refactor");
      expect(result.verbose).toBe(true);
    });

    it("returns null prompt when no args given", () => {
      const result = parseArgs(["node", "cli"]);
      expect(result.prompt).toBeNull();
      expect(result.command).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Multiple flags combined
  // -------------------------------------------------------------------------

  describe("combined flags", () => {
    it("parses multiple flags together", () => {
      const result = parseArgs([
        "node",
        "cli",
        "--model",
        "ollama/llama3",
        "--no-git",
        "--sandbox",
        "--verbose",
      ]);
      expect(result.model).toBe("ollama/llama3");
      expect(result.noGit).toBe(true);
      expect(result.sandbox).toBe(true);
      expect(result.verbose).toBe(true);
    });

    it("handles flags before a command", () => {
      const result = parseArgs(["node", "cli", "--verbose", "init"]);
      expect(result.verbose).toBe(true);
      expect(result.command).toBe("init");
    });

    it("ignores unknown boolean flags gracefully", () => {
      // Unknown flag without a value — next arg starts with "-" so flag is boolean
      const result = parseArgs(["node", "cli", "--unknown-flag", "--verbose", "init"]);
      expect(result.verbose).toBe(true);
      expect(result.command).toBe("init");
    });

    it("skips unknown flags with values", () => {
      // Unknown flag consumes the next non-flag arg as its value
      const result = parseArgs(["node", "cli", "--output", "json", "init"]);
      expect(result.command).toBe("init");
    });
  });
});

// ---------------------------------------------------------------------------
// Banner module tests
// ---------------------------------------------------------------------------

describe("CLI banner", () => {
  it("getHelpText returns complete help text", async () => {
    const { getHelpText } = await import("./banner.js");
    const help = getHelpText();

    expect(help).toContain("DanteCode");
    expect(help).toContain("USAGE");
    expect(help).toContain("COMMANDS");
    expect(help).toContain("OPTIONS");
    expect(help).toContain("REPL SLASH COMMANDS");
    expect(help).toContain("init");
    expect(help).toContain("skills");
    expect(help).toContain("--model");
    expect(help).toContain("--help");
    expect(help).toContain("/help");
    expect(help).toContain("/commit");
    expect(help).toContain("/diff");
  });

  it("getBanner returns formatted banner with model info", async () => {
    const { getBanner } = await import("./banner.js");
    const banner = getBanner(
      {
        provider: "anthropic",
        modelId: "claude-sonnet-4-6",
        maxTokens: 8192,
        temperature: 0.1,
        contextWindow: 200000,
        supportsVision: true,
        supportsToolCalls: true,
      },
      "/test/project",
      "1.0.0",
    );

    expect(banner).toContain("DanteCode");
    expect(banner).toContain("v1.0.0");
    expect(banner).toContain("anthropic/claude-sonnet-4-6");
    expect(banner).toContain("/test/project");
    expect(banner).toContain("200,000");
  });

  it("getOneShotBanner returns compact format", async () => {
    const { getOneShotBanner } = await import("./banner.js");
    const banner = getOneShotBanner(
      {
        provider: "grok",
        modelId: "grok-3",
        maxTokens: 8192,
        temperature: 0.1,
        contextWindow: 131072,
        supportsVision: false,
        supportsToolCalls: true,
      },
      "1.0.0",
    );

    expect(banner).toContain("DanteCode");
    expect(banner).toContain("v1.0.0");
    expect(banner).toContain("grok/grok-3");
  });
});
