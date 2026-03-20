import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

export type BumpType = "patch" | "minor" | "major";

export interface ChangesetOptions {
  cwd?: string;
  id?: string;
}

export interface ChangesetResult {
  success: boolean;
  filePath?: string;
  id?: string;
  error?: string;
}

export async function addChangeset(
  bumpType: BumpType,
  packages: string[],
  message: string,
  options: ChangesetOptions = {},
): Promise<ChangesetResult> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const cleanedPackages = packages
    .map((pkg) => pkg.trim())
    .filter((pkg) => pkg.length > 0);

  if (cleanedPackages.length === 0) {
    return {
      success: false,
      error: "Changeset generation requires at least one package name.",
    };
  }

  if (message.trim().length === 0) {
    return {
      success: false,
      error: "Changeset generation requires a non-empty summary message.",
    };
  }

  const changesetId = options.id ?? `automated-${crypto.randomBytes(4).toString("hex")}`;
  const changesetDir = path.join(cwd, ".changeset");
  const filePath = path.join(changesetDir, `${changesetId}.md`);

  try {
    await fs.mkdir(changesetDir, { recursive: true });
    const frontmatter = cleanedPackages
      .map((pkg) => `"${pkg}": ${bumpType}`)
      .join("\n");
    const content = `---\n${frontmatter}\n---\n\n${message.trim()}\n`;
    await fs.writeFile(filePath, content, "utf-8");
    return {
      success: true,
      filePath,
      id: changesetId,
    };
  } catch (error: unknown) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
