// ============================================================================
// @dantecode/skills-registry — Tests
// ============================================================================

import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { discoverSkills } from "./discover-skills.js";
import { SkillRegistry } from "./skill-registry.js";
import { resolveSkillPrecedence } from "./resolve-skill-precedence.js";
import type { SkillEntry } from "./discover-skills.js";

// ============================================================================
// Test helpers
// ============================================================================

let tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "skills-registry-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

/** Create a skill directory with a SKILL.md file. */
async function createSkillDir(
  scopeDir: string,
  slug: string,
  opts: {
    name?: string;
    disabled?: boolean;
    noSkillMd?: boolean;
  } = {},
): Promise<void> {
  const skillDir = join(scopeDir, slug);
  await mkdir(skillDir, { recursive: true });

  if (!opts.noSkillMd) {
    const frontmatter =
      opts.name !== undefined
        ? `---\nname: ${opts.name}\ndescription: test skill\n---\n\n# ${opts.name}\n`
        : `# ${slug}\n`;
    await writeFile(join(skillDir, "SKILL.md"), frontmatter, "utf-8");
  }

  if (opts.disabled) {
    await writeFile(join(skillDir, ".disabled"), "", "utf-8");
  }
}

/** Build a fake SkillEntry for unit tests. */
function makeEntry(
  name: string,
  scope: SkillEntry["scope"],
  opts: Partial<SkillEntry> = {},
): SkillEntry {
  return {
    name,
    slug: name.toLowerCase().replace(/\s+/g, "-"),
    scope,
    skillMdPath: `/fake/${name}/SKILL.md`,
    dirPath: `/fake/${name}`,
    disabled: false,
    ...opts,
  };
}

// ============================================================================
// discoverSkills tests
// ============================================================================

describe("discoverSkills", () => {
  it("test 1 — empty project returns []", async () => {
    const projectRoot = await makeTempDir();
    const entries = await discoverSkills({ projectRoot });
    expect(entries).toEqual([]);
  });

  it("test 2 — project scope with one valid skill dir + SKILL.md", async () => {
    const projectRoot = await makeTempDir();
    const scopeDir = join(projectRoot, ".dantecode", "skills");
    await mkdir(scopeDir, { recursive: true });
    await createSkillDir(scopeDir, "my-skill", { name: "My Skill" });

    const entries = await discoverSkills({
      projectRoot,
      includeUserScope: false,
      includeCompatScope: false,
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.name).toBe("My Skill");
    expect(entries[0]?.slug).toBe("my-skill");
    expect(entries[0]?.scope).toBe("project");
    expect(entries[0]?.disabled).toBe(false);
  });

  it("test 3 — project scope skill without SKILL.md is ignored", async () => {
    const projectRoot = await makeTempDir();
    const scopeDir = join(projectRoot, ".dantecode", "skills");
    await mkdir(scopeDir, { recursive: true });
    await createSkillDir(scopeDir, "ghost-skill", { noSkillMd: true });

    const entries = await discoverSkills({
      projectRoot,
      includeUserScope: false,
      includeCompatScope: false,
    });
    expect(entries).toHaveLength(0);
  });

  it("test 4 — disabled skill has disabled:true", async () => {
    const projectRoot = await makeTempDir();
    const scopeDir = join(projectRoot, ".dantecode", "skills");
    await mkdir(scopeDir, { recursive: true });
    await createSkillDir(scopeDir, "off-skill", { name: "Off Skill", disabled: true });

    const entries = await discoverSkills({
      projectRoot,
      includeUserScope: false,
      includeCompatScope: false,
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.disabled).toBe(true);
  });

  it("test 5 — user scope discovered when includeUserScope=true", async () => {
    const projectRoot = await makeTempDir();
    const userHome = await makeTempDir();
    const userScopeDir = join(userHome, ".dantecode", "skills");
    await mkdir(userScopeDir, { recursive: true });
    await createSkillDir(userScopeDir, "user-skill", { name: "User Skill" });

    const entries = await discoverSkills({
      projectRoot,
      includeUserScope: true,
      includeCompatScope: false,
      userHome,
    });
    expect(entries.some((e) => e.name === "User Skill" && e.scope === "user")).toBe(true);
  });

  it("test 6 — user scope skipped when includeUserScope=false", async () => {
    const projectRoot = await makeTempDir();
    const userHome = await makeTempDir();
    const userScopeDir = join(userHome, ".dantecode", "skills");
    await mkdir(userScopeDir, { recursive: true });
    await createSkillDir(userScopeDir, "user-skill", { name: "User Skill" });

    const entries = await discoverSkills({
      projectRoot,
      includeUserScope: false,
      includeCompatScope: false,
      userHome,
    });
    expect(entries.some((e) => e.scope === "user")).toBe(false);
  });

  it("test 7 — compat scope (.agents/skills/) discovered when includeCompatScope=true", async () => {
    const projectRoot = await makeTempDir();
    const compatScopeDir = join(projectRoot, ".agents", "skills");
    await mkdir(compatScopeDir, { recursive: true });
    await createSkillDir(compatScopeDir, "compat-skill", { name: "Compat Skill" });

    const entries = await discoverSkills({
      projectRoot,
      includeUserScope: false,
      includeCompatScope: true,
    });
    expect(entries.some((e) => e.name === "Compat Skill" && e.scope === "compat")).toBe(true);
  });

  it("test 8 — compat scope skipped when includeCompatScope=false", async () => {
    const projectRoot = await makeTempDir();
    const compatScopeDir = join(projectRoot, ".agents", "skills");
    await mkdir(compatScopeDir, { recursive: true });
    await createSkillDir(compatScopeDir, "compat-skill", { name: "Compat Skill" });

    const entries = await discoverSkills({
      projectRoot,
      includeUserScope: false,
      includeCompatScope: false,
    });
    expect(entries.some((e) => e.scope === "compat")).toBe(false);
  });

  it("test 9 — nonexistent scope dirs are silently skipped (no error)", async () => {
    const projectRoot = await makeTempDir();
    // No .dantecode/skills, no ~/.dantecode/skills, no .agents/skills
    const entries = await discoverSkills({
      projectRoot,
      includeUserScope: true,
      includeCompatScope: true,
      userHome: join(projectRoot, "no-such-home"),
    });
    expect(entries).toEqual([]);
  });

  it("test 10 — skill name read from SKILL.md frontmatter", async () => {
    const projectRoot = await makeTempDir();
    const scopeDir = join(projectRoot, ".dantecode", "skills");
    await mkdir(scopeDir, { recursive: true });
    // Write SKILL.md with frontmatter name
    const skillDir = join(scopeDir, "my-slug");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      '---\nname: "Fancy Skill Name"\ndescription: test\n---\n\n# Body\n',
      "utf-8",
    );

    const entries = await discoverSkills({
      projectRoot,
      includeUserScope: false,
      includeCompatScope: false,
    });
    expect(entries[0]?.name).toBe("Fancy Skill Name");
    expect(entries[0]?.slug).toBe("my-slug");
  });

  it("test 11 — skill name falls back to directory name if frontmatter missing", async () => {
    const projectRoot = await makeTempDir();
    const scopeDir = join(projectRoot, ".dantecode", "skills");
    await mkdir(scopeDir, { recursive: true });
    // SKILL.md with no frontmatter
    const skillDir = join(scopeDir, "fallback-slug");
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, "SKILL.md"), "# Just a body, no frontmatter\n", "utf-8");

    const entries = await discoverSkills({
      projectRoot,
      includeUserScope: false,
      includeCompatScope: false,
    });
    expect(entries[0]?.name).toBe("fallback-slug");
    expect(entries[0]?.slug).toBe("fallback-slug");
  });
});

// ============================================================================
// SkillRegistry tests
// ============================================================================

describe("SkillRegistry", () => {
  it("test 12 — register registers entries correctly", () => {
    const reg = new SkillRegistry();
    const entries = [makeEntry("alpha", "project"), makeEntry("beta", "user")];
    reg.register(entries);
    expect(reg.listAll()).toHaveLength(2);
  });

  it("test 13 — lookup finds entry by name", () => {
    const reg = new SkillRegistry();
    const entry = makeEntry("alpha", "project");
    reg.register([entry]);
    expect(reg.lookup("alpha")).toEqual(entry);
  });

  it("test 14 — lookup returns undefined for unknown name", () => {
    const reg = new SkillRegistry();
    reg.register([makeEntry("alpha", "project")]);
    expect(reg.lookup("unknown")).toBeUndefined();
  });

  it("test 15 — list excludes disabled entries", () => {
    const reg = new SkillRegistry();
    reg.register([makeEntry("alpha", "project", { disabled: true }), makeEntry("beta", "project")]);
    const listed = reg.list();
    expect(listed.some((e) => e.name === "alpha")).toBe(false);
    expect(listed.some((e) => e.name === "beta")).toBe(true);
  });

  it("test 16 — list includes enabled entries", () => {
    const reg = new SkillRegistry();
    reg.register([makeEntry("enabled-skill", "project")]);
    expect(reg.list()).toHaveLength(1);
    expect(reg.list()[0]?.name).toBe("enabled-skill");
  });

  it("test 17 — getCollisions returns empty when no collisions", () => {
    const reg = new SkillRegistry();
    reg.register([makeEntry("alpha", "project"), makeEntry("beta", "user")]);
    expect(reg.getCollisions()).toHaveLength(0);
  });

  it("test 18 — getCollisions detects collision when same name in two scopes", () => {
    const reg = new SkillRegistry();
    reg.register([makeEntry("shared", "project"), makeEntry("shared", "user")]);
    const collisions = reg.getCollisions();
    expect(collisions).toHaveLength(1);
    expect(collisions[0]?.name).toBe("shared");
    expect(collisions[0]?.entries).toHaveLength(2);
  });

  it("test 19 — hasCollision returns true for colliding name", () => {
    const reg = new SkillRegistry();
    reg.register([makeEntry("dupe", "project"), makeEntry("dupe", "compat")]);
    expect(reg.hasCollision("dupe")).toBe(true);
  });

  it("test 20 — hasCollision returns false for non-colliding name", () => {
    const reg = new SkillRegistry();
    reg.register([makeEntry("unique", "project")]);
    expect(reg.hasCollision("unique")).toBe(false);
  });

  it("test 21 — reset clears and repopulates", () => {
    const reg = new SkillRegistry();
    reg.register([makeEntry("old", "project")]);
    reg.reset([makeEntry("new", "user")]);
    expect(reg.listAll()).toHaveLength(1);
    expect(reg.listAll()[0]?.name).toBe("new");
    expect(reg.hasCollision("old")).toBe(false);
  });

  it("test 22 — listAll returns all entries including those in collisions", () => {
    const reg = new SkillRegistry();
    const e1 = makeEntry("shared", "project");
    const e2 = makeEntry("shared", "user");
    const e3 = makeEntry("unique", "compat");
    reg.register([e1, e2, e3]);
    expect(reg.listAll()).toHaveLength(3);
  });
});

// ============================================================================
// resolveSkillPrecedence tests
// ============================================================================

describe("resolveSkillPrecedence", () => {
  it("test 23 — project wins over user", () => {
    const project = makeEntry("skill", "project");
    const user = makeEntry("skill", "user");
    const resolved = resolveSkillPrecedence([user, project]);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.scope).toBe("project");
  });

  it("test 24 — user wins over compat", () => {
    const user = makeEntry("skill", "user");
    const compat = makeEntry("skill", "compat");
    const resolved = resolveSkillPrecedence([compat, user]);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.scope).toBe("user");
  });

  it("test 25 — project wins over compat", () => {
    const project = makeEntry("skill", "project");
    const compat = makeEntry("skill", "compat");
    const resolved = resolveSkillPrecedence([compat, project]);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.scope).toBe("project");
  });

  it("test 26 — only one entry per name in output", () => {
    const entries = [makeEntry("x", "project"), makeEntry("x", "user"), makeEntry("x", "compat")];
    const resolved = resolveSkillPrecedence(entries);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.scope).toBe("project");
  });

  it("test 27 — all entries returned when no overlaps", () => {
    const entries = [makeEntry("a", "project"), makeEntry("b", "user"), makeEntry("c", "compat")];
    const resolved = resolveSkillPrecedence(entries);
    expect(resolved).toHaveLength(3);
  });

  it("test 28 — disabled entries are preserved (not filtered here)", () => {
    const entry = makeEntry("disabled-skill", "project", { disabled: true });
    const resolved = resolveSkillPrecedence([entry]);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.disabled).toBe(true);
  });
});

// ============================================================================
// Full flow tests
// ============================================================================

describe("Full flow", () => {
  it("test 29 — discoverSkills → SkillRegistry.register → resolveSkillPrecedence → lookup", async () => {
    const projectRoot = await makeTempDir();
    const userHome = await makeTempDir();

    // Create project skill
    const projectScopeDir = join(projectRoot, ".dantecode", "skills");
    await mkdir(projectScopeDir, { recursive: true });
    await createSkillDir(projectScopeDir, "shared-skill", { name: "Shared Skill" });

    // Create user skill with same name (collision)
    const userScopeDir = join(userHome, ".dantecode", "skills");
    await mkdir(userScopeDir, { recursive: true });
    await createSkillDir(userScopeDir, "shared-skill", { name: "Shared Skill" });

    // Create compat skill unique name
    const compatScopeDir = join(projectRoot, ".agents", "skills");
    await mkdir(compatScopeDir, { recursive: true });
    await createSkillDir(compatScopeDir, "compat-only", { name: "Compat Only" });

    const entries = await discoverSkills({
      projectRoot,
      includeUserScope: true,
      includeCompatScope: true,
      userHome,
    });

    const reg = new SkillRegistry();
    reg.register(entries);

    // Shared Skill should have a collision (project + user)
    expect(reg.hasCollision("Shared Skill")).toBe(true);

    // Lookup resolves to project
    const resolved = reg.lookup("Shared Skill");
    expect(resolved?.scope).toBe("project");

    // Compat Only has no collision
    expect(reg.hasCollision("Compat Only")).toBe(false);
    expect(reg.lookup("Compat Only")?.scope).toBe("compat");
  });

  it("test 30 — collision in same scope detected and reported", () => {
    // Two entries with the same name but different slugs in the same scope
    const e1 = makeEntry("My Skill", "project", { slug: "my-skill-v1" });
    const e2 = makeEntry("My Skill", "project", { slug: "my-skill-v2" });

    const reg = new SkillRegistry();
    reg.register([e1, e2]);

    expect(reg.hasCollision("My Skill")).toBe(true);
    const collisions = reg.getCollisions();
    expect(collisions[0]?.entries).toHaveLength(2);
    expect(collisions[0]?.entries.map((e) => e.slug).sort()).toEqual([
      "my-skill-v1",
      "my-skill-v2",
    ]);
  });
});
