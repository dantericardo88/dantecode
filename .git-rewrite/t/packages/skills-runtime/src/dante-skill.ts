import type { SkillProvenance } from "./skill-provenance.js";

// Enum for skill source types
export type SkillSourceType =
  | "native"
  | "agent-skills"
  | "hf"
  | "agency-converted"
  | "private-pack"
  | "codex"
  | "cursor"
  | "qwen";

// Core DanteSkill interface — unified representation of any skill regardless of source
export interface DanteSkill {
  name: string;
  description: string;
  sourceType: SkillSourceType;
  sourceRef: string; // path, URL, or registry identifier
  license: string; // SPDX license or "proprietary"
  instructions: string; // The actual prompt/instructions body
  compatibility?: string[]; // e.g. ["claude", "codex", "cursor"]
  metadata?: Record<string, unknown>;
  allowedTools?: string[]; // Advisory only — not execution authority
  scripts?: string; // Path to scripts/ dir if present
  references?: string; // Path to references/ dir if present
  assets?: string; // Path to assets/ dir if present
  provenance: SkillProvenance; // Required for every skill
  disabled?: boolean; // Soft disable without deletion
}
