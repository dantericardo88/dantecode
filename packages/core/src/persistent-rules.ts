import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface PersistentRuleFile {
  scope: "project" | "global";
  path: string;
  pathLabel: string;
  content: string;
}

export interface PersistentRulesBundle {
  projectRules: PersistentRuleFile[];
  globalRules: PersistentRuleFile[];
  allRules: PersistentRuleFile[];
}

interface LoadPersistentRulesOptions {
  globalRoot?: string;
}

async function loadRuleFile(
  filePath: string,
  scope: "project" | "global",
  pathLabel: string,
): Promise<PersistentRuleFile | null> {
  try {
    const content = (await readFile(filePath, "utf8")).trim();
    if (!content) {
      return null;
    }
    return {
      scope,
      path: filePath,
      pathLabel,
      content,
    };
  } catch {
    return null;
  }
}

async function loadRuleDirectory(
  dirPath: string,
  scope: "project" | "global",
  labelPrefix: string,
): Promise<PersistentRuleFile[]> {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    const markdownEntries = entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"))
      .sort((a, b) => a.name.localeCompare(b.name));

    const loaded = await Promise.all(
      markdownEntries.map((entry) =>
        loadRuleFile(
          join(dirPath, entry.name),
          scope,
          `${labelPrefix}/${entry.name}`,
        ),
      ),
    );

    return loaded.filter((rule): rule is PersistentRuleFile => rule !== null);
  } catch {
    return [];
  }
}

export async function loadPersistentRules(
  projectRoot: string,
  options: LoadPersistentRulesOptions = {},
): Promise<PersistentRulesBundle> {
  const projectBase = join(projectRoot, ".dantecode");
  const globalBase = options.globalRoot ?? join(homedir(), ".dantecode");

  const [projectPrimary, projectDirectoryRules, globalPrimary, globalDirectoryRules] =
    await Promise.all([
      loadRuleFile(join(projectBase, "rules.md"), "project", ".dantecode/rules.md"),
      loadRuleDirectory(join(projectBase, "rules"), "project", ".dantecode/rules"),
      loadRuleFile(join(globalBase, "rules.md"), "global", "~/.dantecode/rules.md"),
      loadRuleDirectory(join(globalBase, "rules"), "global", "~/.dantecode/rules"),
    ]);

  const projectRules = [
    ...(projectPrimary ? [projectPrimary] : []),
    ...projectDirectoryRules,
  ];
  const globalRules = [
    ...(globalPrimary ? [globalPrimary] : []),
    ...globalDirectoryRules,
  ];

  return {
    projectRules,
    globalRules,
    allRules: [...projectRules, ...globalRules],
  };
}

export function formatPersistentRulesForPrompt(bundle: PersistentRulesBundle): string | null {
  if (bundle.allRules.length === 0) {
    return null;
  }

  const sections: string[] = [
    "## Persistent Rules",
    "",
    "The following rules are loaded from disk and apply to this session. Treat them as operator and project constraints.",
    "",
  ];

  for (const rule of bundle.allRules) {
    sections.push(
      `### ${rule.scope === "project" ? "Project" : "Global"} Rule (${rule.pathLabel})`,
      "",
      rule.content,
      "",
    );
  }

  return sections.join("\n").trim();
}

export async function loadPersistentRulesPrompt(
  projectRoot: string,
  options: LoadPersistentRulesOptions = {},
): Promise<string | null> {
  return formatPersistentRulesForPrompt(await loadPersistentRules(projectRoot, options));
}
