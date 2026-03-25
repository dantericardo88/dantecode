# EXECUTION PACKET: DanteSkills — Universal Skill Platform
## Skill Decomposition + Cross-Agent Import + Marketplace + Constitutional Verification (7.5 → 9.0+)

## Document Control

| Field | Value |
|---|---|
| **Version** | 1.0.0 |
| **Codename** | DanteSkills |
| **Author** | Council of Minds (Claude Opus + Ricky) |
| **Target Packages** | `@dantecode/skill-adapter` (existing, upgrade) + `@dantecode/cli` (new commands) |
| **Branch** | `feat/dantecode-9plus-complete-matrix` |
| **Estimated LOC** | ~1,800 source + ~900 tests |
| **Sprint Time** | 4-6 hours for Claude Code |

---

## 1. The Problem

DanteCode currently scores 7.5 on Skill Decomposition — the lowest of all 17 dimensions. The existing `@dantecode/skill-adapter` package has functional parsers for Claude, Continue.dev, and OpenCode skill formats, plus a registry, import bridge, and DanteForge adapter wrapping. That's a solid foundation.

**What's missing is everything above the adapter layer:**

1. **No marketplace or discovery.** Users can't browse, search, or install skills from a catalog. They have to manually copy SKILL.md files.
2. **No skill composition.** You can't chain skills into multi-step workflows (e.g., "research → plan → implement → verify").
3. **No team sharing.** Skills can't be checked into git and shared across a team with version control.
4. **No cross-agent universality.** Claude Code, Codex, Qwen Code, Gemini CLI, and Cursor ALL now use variations of the SKILL.md format. DanteCode should be the universal hub that imports from ANY agent's skill format and runs them with DanteForge verification.
5. **No constitutional verification on imported skills.** This is the moat. When you import a skill from the Antigravity awesome-skills library (1,234+ skills), nobody verifies that the skill's instructions are safe, complete, and won't produce anti-stub code. DanteForge should.
6. **No skill versioning.** Skills don't have versions, dependencies, or update mechanisms.
7. **No Codex or Cursor format parsers.** The existing parsers handle Claude, Continue, and OpenCode. Missing: Codex Skills, Cursor plugins/rules, Qwen Code skills, Gemini CLI commands.

---

## 2. Competitive Landscape: What Leaders Do

### Claude Code Skills (9.5 — the benchmark)
- **Agent Skills open standard**: SKILL.md with YAML frontmatter (name, description) + markdown instructions
- **Directory structure**: `my-skill/SKILL.md` + optional `template.md`, `examples/`, `scripts/`
- **Three scope levels**: Enterprise > Personal (`~/.claude/skills/`) > Project (`.claude/skills/`)
- **Auto-discovery**: Claude reads descriptions and auto-invokes skills when task matches
- **Script bundling**: Skills can include executable scripts (Python, Node, Bash) that Claude runs
- **Nested discovery**: In monorepos, discovers skills in subdirectory `.claude/skills/`
- **Merged with commands**: `/command` and skills are the same system as of 2026
- **Built-in skills**: `/simplify` (3 parallel review agents), `/review`, `/batch`, `/loop`, `/debug`
- **277,000+ installs** on the frontend-design skill alone

### Codex Skills
- **Configurable via `skills.config`** in TOML
- **Instructions + resources + scripts** bundled into packages
- **Per-agent skills**: Custom agents can have their own skill configs
- **Skills extend Codex beyond code generation** to research, writing, workflow automation

### OpenCode
- **7 extensibility directories**: `agents/`, `commands/`, `modes/`, `plugins/`, `skills/`, `tools/`, `themes/`
- **Remote org config**: Organizations push default skills via `.well-known/opencode` endpoint
- **Plugin system**: Plugins can bundle MCP servers, agents, and skills together

### Qwen Code
- **Gemini CLI fork**: Uses the same SKILL.md format as Gemini CLI
- **Skills as context scaffolds**: The LLM reads SKILL.md to understand available tools
- **Symlink support**: Users share skills across agents via symlinks (`~/.qwen/skills → ../skills`)

### Antigravity awesome-skills (community standard)
- **1,234+ skills** across all agents, 22K+ GitHub stars
- **Universal SKILL.md format** that works across Claude Code, Cursor, Gemini CLI, Codex, etc.
- **Curated bundles by role**: Web Wizard, Backend Pro, DevOps Kit, etc.
- **One-command install**: `npx antigravity-awesome-skills -claude`

### The Key Insight
**There is now a de facto open standard for AI agent skills: the SKILL.md format.** Claude Code formalized it, Qwen/Gemini adopted it, Antigravity built a 1,234-skill ecosystem on it. DanteCode should be the best consumer of this standard — importing from any source — AND the only one that verifies imported skills constitutionally.

---

## 3. Architecture

### What Already Exists (in `@dantecode/skill-adapter`)

```
packages/skill-adapter/src/
├── parsers/
│   ├── claude-parser.ts      ← Parses .claude/skills/ and .claude/commands/
│   ├── continue-parser.ts    ← Parses .continue/ agents
│   ├── opencode-parser.ts    ← Parses .opencode/ agents
│   └── index.ts              ← Re-exports all parsers
├── wrap.ts                   ← DanteForge adapter wrapping
├── importer.ts               ← Import orchestration
├── import-bridge.ts          ← SkillBridge types + import bridge
├── registry.ts               ← Skill registry (load, get, list, validate)
├── types/                    ← Shared types
└── index.ts                  ← Public API
```

### What Needs to Be Added

```
packages/skill-adapter/src/
├── parsers/
│   ├── codex-parser.ts       ← NEW: Parse ~/.codex/skills/ and Codex agent skills
│   ├── cursor-parser.ts      ← NEW: Parse .cursor/rules/*.mdc and Cursor plugins
│   ├── qwen-parser.ts        ← NEW: Parse .qwen/skills/ (Gemini CLI compatible)
│   ├── universal-parser.ts   ← NEW: Auto-detect format and delegate to correct parser
│   └── index.ts              ← MODIFIED: export new parsers
├── marketplace/
│   ├── catalog.ts            ← NEW: In-memory skill catalog with search
│   ├── installer.ts          ← NEW: Install skills from URL, git, or local path
│   ├── bundler.ts            ← NEW: Bundle skills into distributable packages
│   └── index.ts              ← NEW: Marketplace public API
├── composer/
│   ├── chain.ts              ← NEW: Skill composition chains (skill1 → skill2 → skill3)
│   ├── conditional.ts        ← NEW: Conditional branching based on DanteForge scores
│   └── index.ts              ← NEW: Composer public API
├── verifier/
│   └── skill-verifier.ts     ← NEW: DanteForge verification on imported skills
├── wrap.ts                   ← EXISTING (may need minor updates)
├── importer.ts               ← MODIFIED: support new sources
├── registry.ts               ← MODIFIED: add version tracking, search
└── index.ts                  ← MODIFIED: export new subsystems

packages/cli/src/
├── commands/
│   └── skills.ts             ← MODIFIED: add install, search, publish, compose, verify
├── slash-commands.ts          ← MODIFIED: register new /skill subcommands
```

---

## 4. Component Specifications

### 4.1 — Universal Parser (`parsers/universal-parser.ts`)

Auto-detects skill format based on directory structure and file contents, then delegates to the correct parser.

```typescript
/**
 * Universal skill parser — auto-detects format and delegates.
 * Supports: Claude Code, Codex, Cursor, Qwen/Gemini, OpenCode, Continue.dev,
 * Antigravity, and raw SKILL.md (universal format).
 */

export type SkillSourceFormat =
  | "claude"       // .claude/skills/*/SKILL.md or .claude/commands/*.md
  | "codex"        // .codex/skills/ or TOML agent files with skills.config
  | "cursor"       // .cursor/rules/*.mdc or Cursor plugin packages
  | "qwen"         // .qwen/skills/*/SKILL.md (Gemini CLI compatible)
  | "opencode"     // .opencode/skills/ or opencode.json with skill config
  | "continue"     // .continue/ agents
  | "universal"    // Raw SKILL.md in any directory (Antigravity format)
  | "danteforge"   // .danteforge/skills/ or DanteForge bundled skills
  | "unknown";

export interface DetectionResult {
  format: SkillSourceFormat;
  confidence: number;     // 0-1
  paths: string[];        // discovered skill file paths
  metadata?: Record<string, unknown>;
}

/**
 * Scan a directory and auto-detect which skill format(s) it contains.
 * A directory can contain multiple formats (e.g., .claude/ AND .codex/).
 */
export async function detectSkillSources(rootDir: string): Promise<DetectionResult[]> {
  const results: DetectionResult[] = [];

  // Check for each known directory structure
  if (await exists(join(rootDir, ".claude", "skills"))) {
    const skills = await scanClaudeSkills(join(rootDir, ".claude", "skills"));
    results.push({ format: "claude", confidence: 1.0, paths: skills.map(s => s.path) });
  }
  if (await exists(join(rootDir, ".claude", "commands"))) {
    const cmds = await scanClaudeSkills(join(rootDir, ".claude", "commands"));
    results.push({ format: "claude", confidence: 0.9, paths: cmds.map(s => s.path) });
  }
  if (await exists(join(rootDir, ".codex", "skills"))) {
    results.push({ format: "codex", confidence: 1.0, paths: await globSkillFiles(join(rootDir, ".codex", "skills")) });
  }
  if (await exists(join(rootDir, ".codex", "agents"))) {
    results.push({ format: "codex", confidence: 0.8, paths: await globTomlFiles(join(rootDir, ".codex", "agents")) });
  }
  if (await exists(join(rootDir, ".cursor", "rules"))) {
    results.push({ format: "cursor", confidence: 1.0, paths: await globMdcFiles(join(rootDir, ".cursor", "rules")) });
  }
  if (await exists(join(rootDir, ".qwen", "skills"))) {
    results.push({ format: "qwen", confidence: 1.0, paths: await globSkillFiles(join(rootDir, ".qwen", "skills")) });
  }
  if (await exists(join(rootDir, ".opencode", "skills"))) {
    results.push({ format: "opencode", confidence: 1.0, paths: await globSkillFiles(join(rootDir, ".opencode", "skills")) });
  }
  // Fallback: any SKILL.md in the root or a skills/ directory
  const universalPaths = await findSkillMdFiles(rootDir);
  if (universalPaths.length > 0) {
    results.push({ format: "universal", confidence: 0.7, paths: universalPaths });
  }

  return results;
}

/**
 * Parse a skill from any detected source format into DanteCode's universal format.
 */
export async function parseUniversalSkill(
  path: string,
  format: SkillSourceFormat,
): Promise<ParsedSkill> {
  switch (format) {
    case "claude": return parseClaudeSkill(path);
    case "codex": return parseCodexSkill(path);
    case "cursor": return parseCursorRule(path);
    case "qwen": return parseQwenSkill(path);   // Same as Claude format (Gemini CLI fork)
    case "opencode": return parseOpencodeAgent(path);
    case "continue": return parseContinueAgent(path);
    case "universal": return parseUniversalSkillMd(path);
    case "danteforge": return parseDanteForgeSkill(path);
    default: throw new Error(`Unknown skill format: ${format}`);
  }
}
```

### 4.2 — Codex Parser (`parsers/codex-parser.ts`)

```typescript
/**
 * Parse Codex CLI skills and agent definitions.
 * Codex uses TOML agent files in ~/.codex/agents/ with skills.config,
 * and a skills/ directory for bundled instruction packages.
 */

export interface ParsedCodexSkill {
  name: string;
  description: string;
  developerInstructions: string;
  model?: string;
  modelReasoningEffort?: "low" | "medium" | "high";
  sandboxMode?: "read-only" | "workspace-write" | "full-access";
  mcpServers?: string[];
  nicknamesCandidates?: string[];
}

/**
 * Parse a Codex agent TOML file into DanteCode's universal skill format.
 * Codex agent files contain: name, description, developer_instructions,
 * model, model_reasoning_effort, sandbox_mode, mcp_servers, nickname_candidates.
 */
export async function parseCodexSkill(filePath: string): Promise<ParsedSkill> {
  const content = await readFile(filePath, "utf8");

  // Codex uses TOML for agent definitions
  if (filePath.endsWith(".toml")) {
    const parsed = parseTOML(content);
    return {
      name: parsed.name as string,
      description: parsed.description as string ?? "",
      instructions: parsed.developer_instructions as string ?? "",
      source: "codex",
      sourcePath: filePath,
      metadata: {
        model: parsed.model,
        reasoningEffort: parsed.model_reasoning_effort,
        sandboxMode: parsed.sandbox_mode,
        mcpServers: parsed.mcp_servers,
      },
    };
  }

  // Codex also supports Markdown skills (SKILL.md format)
  return parseUniversalSkillMd(filePath);
}

/**
 * Minimal TOML parser for Codex agent files.
 * Only needs to handle flat key-value pairs and simple strings/arrays.
 * No external dependency needed — Codex TOML files are simple.
 */
function parseTOML(content: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = content.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("[")) continue;

    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;

    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();

    // Handle multi-line strings (triple-quoted)
    if (value.startsWith('"""')) {
      const multiLineKey = key;
      const multiLineLines: string[] = [value.slice(3)];
      let i = lines.indexOf(line) + 1;
      while (i < lines.length && !lines[i].includes('"""')) {
        multiLineLines.push(lines[i]);
        i++;
      }
      result[multiLineKey] = multiLineLines.join("\n").trim();
      continue;
    }

    // Handle quoted strings
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }

    // Handle arrays
    if (value.startsWith("[") && value.endsWith("]")) {
      const arrayContent = value.slice(1, -1);
      result[key] = arrayContent.split(",").map(v => v.trim().replace(/^"|"$/g, "")).filter(Boolean);
      continue;
    }

    // Handle booleans
    if (value === "true" || value === "false") {
      result[key] = value === "true";
      continue;
    }

    result[key] = value;
  }

  return result;
}
```

### 4.3 — Cursor Parser (`parsers/cursor-parser.ts`)

```typescript
/**
 * Parse Cursor IDE rules (.mdc files) and plugin packages.
 * Cursor rules are Markdown files with YAML-like frontmatter in .cursor/rules/.
 * Cursor plugins bundle MCP servers + skills + subagents + rules + hooks.
 */

export async function parseCursorRule(filePath: string): Promise<ParsedSkill> {
  const content = await readFile(filePath, "utf8");
  const { frontmatter, body } = parseFrontmatter(content);

  return {
    name: frontmatter.name ?? basename(filePath, ".mdc"),
    description: frontmatter.description ?? extractFirstParagraph(body),
    instructions: body,
    source: "cursor",
    sourcePath: filePath,
    metadata: {
      alwaysApply: frontmatter.alwaysApply ?? false,
      globs: frontmatter.globs,  // file patterns this rule applies to
    },
  };
}
```

### 4.4 — Qwen Parser (`parsers/qwen-parser.ts`)

```typescript
/**
 * Parse Qwen Code / Gemini CLI skills.
 * Qwen Code is a Gemini CLI fork — same SKILL.md format.
 * Skills live in ~/.qwen/skills/ or project .qwen/skills/.
 * Also supports symlinked skills (users share across agents).
 */

export async function parseQwenSkill(filePath: string): Promise<ParsedSkill> {
  // Qwen uses the exact same SKILL.md format as Claude Code / Gemini CLI
  // The parser is identical to the universal parser
  return parseUniversalSkillMd(filePath);
}
```

### 4.5 — Skill Verifier (`verifier/skill-verifier.ts`) — THE MOAT

```typescript
/**
 * DanteForge constitutional verification on imported skills.
 *
 * This is the moat. No other tool verifies imported skills.
 * When you install a skill from Antigravity (1,234+ skills),
 * nobody checks if the instructions are safe, complete, or
 * will produce quality output. DanteForge does.
 *
 * Verification checks:
 * 1. Safety: No shell injection patterns in scripts
 * 2. Completeness: Instructions have clear input/output expectations
 * 3. Anti-stub: No placeholder instructions ("TODO: add steps")
 * 4. Security: Scripts don't access credentials, network, or filesystem outside scope
 * 5. Constitutional: Instructions don't contradict project constitution
 * 6. Quality: PDSE score on the instruction text itself
 */

export interface SkillVerificationResult {
  skillName: string;
  source: string;
  overallScore: number;        // 0-100 (PDSE-style)
  tier: "guardian" | "sentinel" | "sovereign";  // Which tier it qualifies for
  passed: boolean;             // meets minimum tier threshold
  findings: SkillFinding[];
  scriptSafety: ScriptSafetyResult | null;  // null if no scripts
}

export interface SkillFinding {
  severity: "critical" | "warning" | "info";
  category: "safety" | "completeness" | "anti-stub" | "security" | "constitutional" | "quality";
  message: string;
  line?: number;
}

export interface ScriptSafetyResult {
  safe: boolean;
  shellInjectionRisk: boolean;
  networkAccess: boolean;
  credentialAccess: boolean;
  filesystemScope: "project-only" | "user-home" | "system-wide" | "unknown";
  findings: string[];
}

export async function verifySkill(
  skill: ParsedSkill,
  options?: {
    tier?: "guardian" | "sentinel" | "sovereign";
    projectConstitution?: string;  // content of CONSTITUTION.md
    checkScripts?: boolean;         // default: true
  },
): Promise<SkillVerificationResult> {
  const findings: SkillFinding[] = [];
  const tier = options?.tier ?? "guardian";

  // 1. Anti-stub check on instructions
  const stubPatterns = [/TODO/i, /FIXME/i, /TBD/i, /placeholder/i, /add steps here/i, /implement this/i];
  for (const pattern of stubPatterns) {
    if (pattern.test(skill.instructions)) {
      findings.push({
        severity: "warning",
        category: "anti-stub",
        message: `Instruction text contains stub marker: ${pattern.source}`,
      });
    }
  }

  // 2. Completeness check
  if (skill.instructions.length < 50) {
    findings.push({
      severity: "warning",
      category: "completeness",
      message: "Instructions are very short (<50 chars). May not provide sufficient guidance.",
    });
  }
  if (!skill.description || skill.description.length < 10) {
    findings.push({
      severity: "warning",
      category: "completeness",
      message: "Description is missing or too short for reliable auto-discovery.",
    });
  }

  // 3. Script safety (if scripts exist)
  let scriptSafety: ScriptSafetyResult | null = null;
  if (options?.checkScripts !== false && skill.scripts && skill.scripts.length > 0) {
    scriptSafety = await verifyScripts(skill.scripts);
    if (!scriptSafety.safe) {
      findings.push({
        severity: "critical",
        category: "security",
        message: `Script safety check failed: ${scriptSafety.findings.join("; ")}`,
      });
    }
  }

  // 4. Security patterns in instructions
  const dangerousPatterns = [
    { pattern: /curl.*\|\s*(?:sh|bash)/i, msg: "Remote code execution via pipe to shell" },
    { pattern: /eval\s*\(/i, msg: "Eval usage in instructions" },
    { pattern: /rm\s+-rf\s+\//i, msg: "Destructive filesystem command" },
    { pattern: /password|secret|token|api.?key/i, msg: "Potential credential handling without vault" },
  ];
  for (const { pattern, msg } of dangerousPatterns) {
    if (pattern.test(skill.instructions)) {
      findings.push({ severity: "warning", category: "security", message: msg });
    }
  }

  // 5. Constitutional compliance (if project constitution provided)
  if (options?.projectConstitution) {
    const constitutionFindings = checkConstitutionalCompliance(skill.instructions, options.projectConstitution);
    findings.push(...constitutionFindings);
  }

  // 6. Quality score (simplified PDSE on instruction text)
  const qualityScore = scoreInstructionQuality(skill.instructions, skill.description);

  // Compute overall score
  const criticalCount = findings.filter(f => f.severity === "critical").length;
  const warningCount = findings.filter(f => f.severity === "warning").length;
  const overallScore = Math.max(0, qualityScore - (criticalCount * 20) - (warningCount * 5));

  // Determine which tier this skill qualifies for
  const qualifiedTier = overallScore >= 85 ? "sovereign"
    : overallScore >= 70 ? "sentinel"
    : "guardian";

  return {
    skillName: skill.name,
    source: skill.source,
    overallScore,
    tier: qualifiedTier,
    passed: tierMeetsMinimum(qualifiedTier, tier),
    findings,
    scriptSafety,
  };
}

/**
 * Verify bundled scripts for safety.
 */
async function verifyScripts(scriptPaths: string[]): Promise<ScriptSafetyResult> {
  const findings: string[] = [];
  let shellInjection = false;
  let networkAccess = false;
  let credentialAccess = false;
  let fsScope: ScriptSafetyResult["filesystemScope"] = "project-only";

  for (const scriptPath of scriptPaths) {
    const content = await readFile(scriptPath, "utf8");

    // Check for shell injection patterns
    if (/eval|exec\(|child_process|subprocess|os\.system/i.test(content)) {
      shellInjection = true;
      findings.push(`${basename(scriptPath)}: contains eval/exec patterns`);
    }

    // Check for network access
    if (/fetch|http|https|curl|wget|axios|request\(/i.test(content)) {
      networkAccess = true;
      findings.push(`${basename(scriptPath)}: makes network requests`);
    }

    // Check for credential access
    if (/process\.env|\.env|keychain|credential|secret/i.test(content)) {
      credentialAccess = true;
      findings.push(`${basename(scriptPath)}: accesses environment/credentials`);
    }

    // Check filesystem scope
    if (/\/etc\/|\/usr\/|\/var\/|~\/\./i.test(content)) {
      fsScope = "system-wide";
    } else if (/~\/|process\.env\.HOME|\$HOME/i.test(content) && fsScope !== "system-wide") {
      fsScope = "user-home";
    }
  }

  return {
    safe: !shellInjection && findings.length <= 2,
    shellInjectionRisk: shellInjection,
    networkAccess,
    credentialAccess,
    filesystemScope: fsScope,
    findings,
  };
}
```

### 4.6 — Skill Catalog + Installer (`marketplace/catalog.ts` + `marketplace/installer.ts`)

```typescript
/**
 * In-memory skill catalog with search, filtering, and metadata.
 * Backed by a JSON index file at .dantecode/skill-catalog.json.
 */

export interface CatalogEntry {
  name: string;
  description: string;
  source: SkillSourceFormat;
  sourcePath: string;           // original location
  installedPath: string;        // .dantecode/skills/<name>/
  version: string;              // semver or "0.0.0" if unversioned
  author?: string;
  tags: string[];               // e.g. ["security", "testing", "frontend"]
  verificationScore?: number;   // DanteForge score at install time
  verificationTier?: string;    // guardian/sentinel/sovereign
  installedAt: string;          // ISO timestamp
  updatedAt: string;
}

export class SkillCatalog {
  private entries: Map<string, CatalogEntry> = new Map();
  private catalogPath: string;

  constructor(projectRoot: string);

  /** Load catalog from disk. */
  async load(): Promise<void>;

  /** Save catalog to disk. */
  async save(): Promise<void>;

  /** Search skills by keyword (name + description + tags). */
  search(query: string): CatalogEntry[];

  /** Filter by tag. */
  filterByTag(tag: string): CatalogEntry[];

  /** Filter by source format. */
  filterBySource(source: SkillSourceFormat): CatalogEntry[];

  /** Filter by verification tier. */
  filterByTier(tier: "guardian" | "sentinel" | "sovereign"): CatalogEntry[];

  /** Add or update an entry. */
  upsert(entry: CatalogEntry): void;

  /** Remove an entry. */
  remove(name: string): boolean;

  /** Get all entries. */
  getAll(): CatalogEntry[];

  /** Get entry by name. */
  get(name: string): CatalogEntry | null;
}
```

```typescript
/**
 * Skill installer — install from URL, git repo, local path, or npm.
 */

export interface InstallOptions {
  source: string;                // URL, git repo, local path, or npm package name
  verify?: boolean;              // Run DanteForge verification (default: true)
  tier?: "guardian" | "sentinel" | "sovereign";  // Required verification tier
  force?: boolean;               // Install even if verification fails
  symlink?: boolean;             // Symlink instead of copy (for shared skills)
}

export interface InstallResult {
  name: string;
  installedPath: string;
  source: string;
  format: SkillSourceFormat;
  verification?: SkillVerificationResult;
  success: boolean;
  error?: string;
}

export async function installSkill(options: InstallOptions, projectRoot: string): Promise<InstallResult> {
  // 1. Resolve source
  const resolvedPath = await resolveSource(options.source, projectRoot);

  // 2. Detect format
  const detections = await detectSkillSources(resolvedPath);
  if (detections.length === 0) {
    return { name: "unknown", installedPath: "", source: options.source, format: "unknown", success: false, error: "No skill files found at source" };
  }

  // 3. Parse skill
  const detection = detections[0];
  const parsed = await parseUniversalSkill(detection.paths[0], detection.format);

  // 4. Verify with DanteForge (THE MOAT)
  let verification: SkillVerificationResult | undefined;
  if (options.verify !== false) {
    const constitution = await loadConstitution(projectRoot);
    verification = await verifySkill(parsed, {
      tier: options.tier ?? "guardian",
      projectConstitution: constitution,
    });

    if (!verification.passed && !options.force) {
      return {
        name: parsed.name,
        installedPath: "",
        source: options.source,
        format: detection.format,
        verification,
        success: false,
        error: `Skill failed DanteForge verification (score: ${verification.overallScore}, required tier: ${options.tier ?? "guardian"}). Use --force to install anyway.`,
      };
    }
  }

  // 5. Install to .dantecode/skills/<name>/
  const installDir = join(projectRoot, ".dantecode", "skills", parsed.name);
  if (options.symlink) {
    await symlink(resolvedPath, installDir);
  } else {
    await copyDir(resolvedPath, installDir);
  }

  // 6. Wrap with DanteForge adapter
  await wrapSkillWithAdapter(parsed, installDir);

  // 7. Register in catalog
  const catalog = new SkillCatalog(projectRoot);
  await catalog.load();
  catalog.upsert({
    name: parsed.name,
    description: parsed.description,
    source: detection.format,
    sourcePath: options.source,
    installedPath: installDir,
    version: parsed.version ?? "0.0.0",
    tags: parsed.tags ?? [],
    verificationScore: verification?.overallScore,
    verificationTier: verification?.tier,
    installedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  await catalog.save();

  return {
    name: parsed.name,
    installedPath: installDir,
    source: options.source,
    format: detection.format,
    verification,
    success: true,
  };
}

/**
 * Resolve a source string to a local directory path.
 * Supports: local paths, git URLs, HTTP URLs, npm package names.
 */
async function resolveSource(source: string, projectRoot: string): Promise<string> {
  // Local path
  if (await exists(source)) return resolve(source);

  // Git URL
  if (source.startsWith("git://") || source.startsWith("https://github.com/") || source.endsWith(".git")) {
    const tmpDir = join(projectRoot, ".dantecode", "tmp", `skill-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
    execSync(`git clone --depth 1 ${source} ${tmpDir}`, { stdio: "pipe" });
    return tmpDir;
  }

  // HTTP URL (download)
  if (source.startsWith("http://") || source.startsWith("https://")) {
    const tmpDir = join(projectRoot, ".dantecode", "tmp", `skill-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
    // Download and extract
    execSync(`curl -sL ${source} -o ${join(tmpDir, "skill.tar.gz")} && tar xzf ${join(tmpDir, "skill.tar.gz")} -C ${tmpDir}`, { stdio: "pipe" });
    return tmpDir;
  }

  // npm package name (future)
  throw new Error(`Cannot resolve skill source: ${source}. Supported: local paths, git URLs, HTTP URLs.`);
}
```

### 4.7 — Skill Composition (`composer/chain.ts`)

```typescript
/**
 * Skill composition chains — connect skills into multi-step workflows.
 *
 * Example:
 *   chain = createChain("research-then-implement")
 *     .add("research", { topic: "$input" })
 *     .add("plan", { context: "$previous.output" })
 *     .add("implement", { plan: "$previous.output" })
 *     .addGate("verify", { minPdse: 85 })  // DanteForge gate between steps
 *     .add("review", { code: "$previous.output" });
 */

export interface ChainStep {
  skillName: string;
  params: Record<string, string>;  // $input, $previous.output, literal values
  gate?: {
    minPdse?: number;
    requireVerification?: boolean;
    onFail?: "stop" | "retry" | "skip";
  };
}

export interface ChainDefinition {
  name: string;
  description: string;
  steps: ChainStep[];
}

export interface ChainExecutionResult {
  chainName: string;
  steps: Array<{
    skillName: string;
    output: string;
    pdseScore?: number;
    passed: boolean;
    durationMs: number;
  }>;
  finalOutput: string;
  success: boolean;
  totalDurationMs: number;
}

export class SkillChain {
  private steps: ChainStep[] = [];

  constructor(public readonly name: string, public readonly description: string = "") {}

  /** Add a skill step to the chain. */
  add(skillName: string, params?: Record<string, string>): this {
    this.steps.push({ skillName, params: params ?? {} });
    return this;
  }

  /** Add a DanteForge verification gate between steps. */
  addGate(skillName: string, gate: ChainStep["gate"], params?: Record<string, string>): this {
    this.steps.push({ skillName, params: params ?? {}, gate });
    return this;
  }

  /** Export chain definition as YAML for persistence. */
  toYAML(): string;

  /** Load chain from YAML file. */
  static fromYAML(content: string): SkillChain;

  /** Get all steps. */
  getSteps(): ChainStep[];
}

/**
 * Execute a skill chain.
 * Each step receives the previous step's output as $previous.output.
 * Gates can stop, retry, or skip based on DanteForge scores.
 */
export async function executeChain(
  chain: SkillChain,
  initialInput: string,
  context: { projectRoot: string; modelRouter: unknown },
): Promise<ChainExecutionResult>;
```

### 4.8 — CLI Commands

**Modify:** `packages/cli/src/commands/skills.ts`

Add the following subcommands:

```typescript
// /skill install <source> [--tier guardian|sentinel|sovereign] [--force] [--symlink]
// /skill search <query> [--tag <tag>] [--source <format>] [--tier <tier>]
// /skill list [--tag <tag>] [--source <format>] [--verified-only]
// /skill verify <name>  — re-run DanteForge verification on an installed skill
// /skill remove <name>
// /skill info <name>    — show full details including verification score
// /skill scan [path]    — scan a directory for importable skills (universal parser)
// /skill compose <name> — interactive chain builder
// /skill export <name> <path>  — export skill as distributable package
// /skill import-all <path>     — bulk import all skills from a directory
```

Also register new slash commands:
```typescript
// /skills — list all installed skills with verification scores
// /skill-install <source> — quick install
// /skill-verify <name> — quick verify
```

---

## 5. Storage Layout

```
.dantecode/
├── skills/                          ← Installed skills (project-scoped)
│   ├── frontend-design/
│   │   ├── SKILL.md                 ← Original skill file
│   │   ├── .danteforge-adapter.json ← DanteForge wrapper metadata
│   │   ├── .verification.json       ← Verification result at install time
│   │   └── scripts/                 ← Bundled scripts (if any)
│   └── code-review/
│       ├── SKILL.md
│       └── .danteforge-adapter.json
├── skill-catalog.json               ← Catalog index (search, filter)
└── skill-chains/                    ← Saved composition chains
    └── research-then-implement.yaml
```

Global skills (personal, cross-project):
```
~/.dantecode/skills/                 ← Global skills
~/.dantecode/skill-catalog.json      ← Global catalog
```

---

## 6. Cross-Agent Compatibility Matrix

| Source Format | Parser | Discovery Path | Auto-Detect |
|---|---|---|---|
| Claude Code | `claude-parser.ts` (existing) | `.claude/skills/`, `.claude/commands/` | ✅ |
| Codex CLI | `codex-parser.ts` (NEW) | `.codex/skills/`, `.codex/agents/` | ✅ |
| Cursor | `cursor-parser.ts` (NEW) | `.cursor/rules/` | ✅ |
| Qwen / Gemini | `qwen-parser.ts` (NEW) | `.qwen/skills/`, `.gemini/skills/` | ✅ |
| OpenCode | `opencode-parser.ts` (existing) | `.opencode/skills/`, `.opencode/agents/` | ✅ |
| Continue.dev | `continue-parser.ts` (existing) | `.continue/` | ✅ |
| Antigravity | `universal-parser.ts` (NEW) | Any `SKILL.md` | ✅ |
| DanteForge | `danteforge-parser.ts` (built-in) | `.danteforge/skills/` | ✅ |

**DanteCode becomes the universal skill hub.** Import from any agent, verify with DanteForge, use everywhere.

---

## 7. Tests

### New Test Files

**`parsers/codex-parser.test.ts`** (~8 tests)
1. Parse TOML agent file with all fields
2. Parse TOML with multi-line developer_instructions
3. Parse TOML with missing optional fields → defaults
4. Handle malformed TOML gracefully
5. Parse Codex SKILL.md file (Markdown format)
6. Extract model and sandbox_mode from metadata
7. Parse array fields (mcp_servers, nickname_candidates)
8. Empty file → meaningful error

**`parsers/cursor-parser.test.ts`** (~5 tests)
1. Parse .mdc file with frontmatter
2. Extract alwaysApply and globs from frontmatter
3. Handle .mdc without frontmatter
4. File with only frontmatter, no body
5. Name defaults to filename when not in frontmatter

**`parsers/universal-parser.test.ts`** (~6 tests)
1. Auto-detect Claude format from .claude/skills/ directory
2. Auto-detect Codex format from .codex/agents/ directory
3. Auto-detect Cursor format from .cursor/rules/ directory
4. Detect multiple formats in same project
5. Fallback to "universal" for raw SKILL.md
6. Empty directory → empty results

**`verifier/skill-verifier.test.ts`** (~10 tests)
1. Clean skill with good instructions → passes all tiers
2. Skill with TODO in instructions → anti-stub warning
3. Skill with `curl | bash` pattern → security critical
4. Skill with very short instructions → completeness warning
5. Script with eval → shell injection risk flagged
6. Script with network access → network access flagged
7. Guardian tier: passes with warnings
8. Sovereign tier: fails with same warnings
9. Constitutional compliance: skill contradicts constitution → finding
10. Overall score computation with mixed findings

**`marketplace/catalog.test.ts`** (~6 tests)
1. Add entry → search by name finds it
2. Search by tag
3. Filter by source format
4. Filter by verification tier
5. Remove entry → search returns empty
6. Save → load roundtrip preserves all entries

**`marketplace/installer.test.ts`** (~6 tests)
1. Install from local path → copies files → registers in catalog
2. Install with verification → score stored in catalog
3. Install failing verification without --force → rejected
4. Install failing verification with --force → installed with warning
5. Install with --symlink → creates symlink instead of copy
6. Resolve git URL → clones to tmp → installs

**`composer/chain.test.ts`** (~5 tests)
1. Create chain → add 3 steps → getSteps returns all 3
2. Chain with DanteForge gate
3. Export to YAML → fromYAML roundtrip
4. Chain step parameter substitution ($input, $previous.output)
5. Gate onFail: "stop" halts execution

**Total: ~46 new tests**

---

## 8. Claude Code Execution Instructions

**Single sprint, 4-6 hours. 3 phases with GStack gates.**

```
Phase 1: Parsers + Universal Detection (1.5-2h)
  1. Create packages/skill-adapter/src/parsers/codex-parser.ts
  2. Create packages/skill-adapter/src/parsers/cursor-parser.ts
  3. Create packages/skill-adapter/src/parsers/qwen-parser.ts
  4. Create packages/skill-adapter/src/parsers/universal-parser.ts
  5. Modify packages/skill-adapter/src/parsers/index.ts — export new parsers
  6. Create all parser test files
  7. Run: cd packages/skill-adapter && npx vitest run
  GATE: All existing + new tests pass

Phase 2: Verifier + Marketplace (2-2.5h)
  8. Create packages/skill-adapter/src/verifier/skill-verifier.ts
  9. Create packages/skill-adapter/src/marketplace/catalog.ts
  10. Create packages/skill-adapter/src/marketplace/installer.ts
  11. Create packages/skill-adapter/src/marketplace/bundler.ts (lighter: export skill as zip)
  12. Create packages/skill-adapter/src/marketplace/index.ts
  13. Create all verifier + marketplace test files
  14. Modify packages/skill-adapter/src/index.ts — export new subsystems
  15. Run: cd packages/skill-adapter && npx vitest run
  GATE: All tests pass

Phase 3: Composer + CLI + Wiring (1-1.5h)
  16. Create packages/skill-adapter/src/composer/chain.ts
  17. Create packages/skill-adapter/src/composer/conditional.ts (gate logic)
  18. Create packages/skill-adapter/src/composer/index.ts
  19. Create composer test files
  20. Modify packages/cli/src/commands/skills.ts — add all new subcommands
  21. Modify packages/cli/src/slash-commands.ts — register /skills, /skill-install, /skill-verify
  22. Run: npx turbo test
  GATE: Full test suite passes
```

**Rules:**
- KiloCode: every file complete, under 500 LOC, no stubs
- Anti-Stub Absolute: zero TODOs, FIXMEs
- TypeScript strict, no `as any`, no `@ts-ignore`
- PDSE ≥ 85 on all new files
- **ZERO regressions on existing skill-adapter tests**
- The TOML parser in codex-parser.ts must be self-contained (no external toml library)
- All parsers must handle malformed input gracefully (return meaningful errors, never throw unhandled)

---

## 9. Success Criteria

| Criteria | Target |
|---|---|
| Import skills from all 8 source formats | ✅ working |
| DanteForge verification on every import | default behavior |
| `dantecode skill install <url>` from CLI | ✅ |
| `dantecode skill search <query>` finds by name/tag/source | ✅ |
| Skill composition chains execute multi-step workflows | ✅ |
| Verification scores persisted in catalog | ✅ |
| Existing skill-adapter tests | 0 regressions |
| New test count | ~46 tests |
| All new files | PDSE ≥ 85, anti-stub clean |

---

## 10. The Moat

Every other tool imports skills blindly. `npx antigravity-awesome-skills -claude` copies 1,234 SKILL.md files into your project with zero quality checks. A malicious or poorly-written skill executes with the same trust as a well-written one.

DanteCode is the only tool that constitutionally verifies imported skills. Every skill gets a DanteForge score. Every skill is classified into a tier. Scripts are scanned for injection patterns. Instructions are checked against the project's constitution. The verification result is persisted in the catalog so you can filter skills by trust level.

"Install 1,234 skills, but only show me the ones that passed Sovereign verification."

That sentence is impossible in any other tool. It's the default in DanteCode.

---

*The best skill platform isn't the one with the most skills. It's the one you can trust.*
