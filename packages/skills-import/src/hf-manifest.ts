import { readFile } from "node:fs/promises";

// Hugging Face Skills are Apache-2.0 and cross-agent compatible
// This implements selective install — NEVER bulk import of entire HF repo

export interface HFSkillEntry {
  name: string;
  description: string;
  sourceRepo: string; // e.g. "huggingface/hf-skills"
  sourcePath: string; // Path within the repo
  license: string; // Always "Apache-2.0" for HF Skills
  tags?: string[];
  compatibility?: string[];
  version?: string;
}

export interface HFManifest {
  version: string;
  source: string; // Source description
  skills: HFSkillEntry[];
}

export type HFManifestResult = { ok: true; manifest: HFManifest } | { ok: false; error: string };

/**
 * Loads a curated HF manifest from a JSON file.
 * Returns error if file doesn't exist or is malformed.
 */
export async function loadHFManifest(manifestPath: string): Promise<HFManifestResult> {
  try {
    const content = await readFile(manifestPath, "utf-8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      return { ok: false, error: "Manifest file is not valid JSON" };
    }

    if (typeof parsed !== "object" || parsed === null) {
      return { ok: false, error: "Manifest must be a JSON object" };
    }

    const obj = parsed as Record<string, unknown>;

    if (typeof obj["version"] !== "string") {
      return { ok: false, error: "Manifest missing required field: version" };
    }
    if (typeof obj["source"] !== "string") {
      return { ok: false, error: "Manifest missing required field: source" };
    }
    if (!Array.isArray(obj["skills"])) {
      return { ok: false, error: "Manifest missing required field: skills" };
    }

    const manifest: HFManifest = {
      version: obj["version"],
      source: obj["source"],
      skills: obj["skills"] as HFSkillEntry[],
    };

    return { ok: true, manifest };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Failed to read manifest: ${message}` };
  }
}

/**
 * Returns a builtin minimal manifest for testing/demo purposes.
 * Contains 3 representative skill entries without network access.
 */
export function getBuiltinHFManifest(): HFManifest {
  return {
    version: "1.0.0",
    source: "huggingface/hf-agent-skills (curated, Apache-2.0)",
    skills: [
      {
        name: "code-review",
        description:
          "Performs a thorough code review, identifying bugs, style issues, and improvement opportunities",
        sourceRepo: "huggingface/hf-agent-skills",
        sourcePath: "skills/code-review/SKILL.md",
        license: "Apache-2.0",
        tags: ["code", "review", "quality"],
        compatibility: ["claude", "codex", "qwen"],
        version: "1.0.0",
      },
      {
        name: "documentation-writer",
        description: "Generates clear, well-structured documentation for code, APIs, and projects",
        sourceRepo: "huggingface/hf-agent-skills",
        sourcePath: "skills/documentation-writer/SKILL.md",
        license: "Apache-2.0",
        tags: ["docs", "writing", "api"],
        compatibility: ["claude", "codex", "cursor"],
        version: "1.0.0",
      },
      {
        name: "test-generator",
        description: "Generates comprehensive unit and integration tests for existing code",
        sourceRepo: "huggingface/hf-agent-skills",
        sourcePath: "skills/test-generator/SKILL.md",
        license: "Apache-2.0",
        tags: ["testing", "tdd", "unit-tests"],
        compatibility: ["claude", "codex", "cursor", "qwen"],
        version: "1.0.0",
      },
    ],
  };
}
