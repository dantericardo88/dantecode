// ============================================================================
// LSP (Language Server Protocol) configuration for code intelligence.
// Based on QwenCode's experimental LSP integration pattern.
// Zero external dependencies — uses only node built-ins.
// ============================================================================

import { readFile, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { constants as fsConstants } from "node:fs";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LspServerConfig {
  /** Human-readable language name, e.g. "typescript", "python", "go", "rust". */
  language: string;
  /** Full command string, e.g. "typescript-language-server --stdio". */
  command: string;
  /** Optional argv split (overrides command parsing when present). */
  args?: string[];
  transport: "stdio" | "tcp" | "socket";
  /** For tcp transport: port to connect/listen on. */
  port?: number;
  /** File extensions handled by this server, e.g. [".ts", ".tsx"]. */
  fileExtensions: string[];
  /** Optional workspace root override (defaults to projectRoot). */
  workspaceRoot?: string;
}

export interface LspConfig {
  enabled: boolean;
  servers: LspServerConfig[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const LSP_CONFIG_FILENAME = ".lsp.json";

const DEFAULT_CONFIG: LspConfig = {
  enabled: false,
  servers: [],
};

// ─── readLspConfig ────────────────────────────────────────────────────────────

/**
 * Reads `.lsp.json` from `projectRoot`.
 * Returns `{ enabled: false, servers: [] }` when the file is absent or unparseable.
 */
export async function readLspConfig(projectRoot: string): Promise<LspConfig> {
  const configPath = join(projectRoot, LSP_CONFIG_FILENAME);
  try {
    const raw = await readFile(configPath, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (!isLspConfig(parsed)) return { ...DEFAULT_CONFIG };
    return parsed;
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

// ─── writeLspConfig ───────────────────────────────────────────────────────────

/**
 * Writes the provided config to `.lsp.json` in `projectRoot`.
 */
export async function writeLspConfig(
  projectRoot: string,
  config: LspConfig,
): Promise<void> {
  const configPath = join(projectRoot, LSP_CONFIG_FILENAME);
  await writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
}

// ─── detectLspServers ─────────────────────────────────────────────────────────

/**
 * Auto-detects installed / relevant LSP servers based on project files.
 *
 * Detection rules:
 * - `package.json` with `typescript-language-server` in devDependencies → TypeScript
 * - `pyproject.toml` or `setup.py` present → python-lsp-server (pylsp)
 * - `go.mod` present → gopls
 * - `Cargo.toml` present → rust-analyzer
 */
export async function detectLspServers(projectRoot: string): Promise<LspServerConfig[]> {
  const detected: LspServerConfig[] = [];

  await Promise.all([
    detectTypeScript(projectRoot, detected),
    detectPython(projectRoot, detected),
    detectGo(projectRoot, detected),
    detectRust(projectRoot, detected),
  ]);

  return detected;
}

// ─── Detection helpers ────────────────────────────────────────────────────────

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function detectTypeScript(
  projectRoot: string,
  out: LspServerConfig[],
): Promise<void> {
  const pkgPath = join(projectRoot, "package.json");
  if (!(await fileExists(pkgPath))) return;

  try {
    const raw = await readFile(pkgPath, "utf-8");
    const pkg: unknown = JSON.parse(raw);
    if (!isRecord(pkg)) return;

    const devDeps = pkg["devDependencies"];
    const deps = pkg["dependencies"];
    const hasTslsp =
      (isRecord(devDeps) && "typescript-language-server" in devDeps) ||
      (isRecord(deps) && "typescript-language-server" in deps);

    if (hasTslsp) {
      out.push({
        language: "typescript",
        command: "typescript-language-server --stdio",
        args: ["--stdio"],
        transport: "stdio",
        fileExtensions: [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts"],
      });
    }
  } catch {
    // Unparseable package.json — skip
  }
}

async function detectPython(
  projectRoot: string,
  out: LspServerConfig[],
): Promise<void> {
  const candidates = ["pyproject.toml", "setup.py", "setup.cfg"];
  for (const name of candidates) {
    if (await fileExists(join(projectRoot, name))) {
      out.push({
        language: "python",
        command: "pylsp",
        args: [],
        transport: "stdio",
        fileExtensions: [".py", ".pyi"],
      });
      return;
    }
  }
}

async function detectGo(
  projectRoot: string,
  out: LspServerConfig[],
): Promise<void> {
  if (await fileExists(join(projectRoot, "go.mod"))) {
    out.push({
      language: "go",
      command: "gopls",
      args: [],
      transport: "stdio",
      fileExtensions: [".go"],
    });
  }
}

async function detectRust(
  projectRoot: string,
  out: LspServerConfig[],
): Promise<void> {
  if (await fileExists(join(projectRoot, "Cargo.toml"))) {
    out.push({
      language: "rust",
      command: "rust-analyzer",
      args: [],
      transport: "stdio",
      fileExtensions: [".rs"],
    });
  }
}

// ─── Type guards ──────────────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isLspConfig(v: unknown): v is LspConfig {
  if (!isRecord(v)) return false;
  if (typeof v["enabled"] !== "boolean") return false;
  if (!Array.isArray(v["servers"])) return false;
  return true;
}
