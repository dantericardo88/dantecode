export type SkillRunMode = "dry-run" | "apply" | "verify";

export interface SkillPolicy {
  allowedTools: string[]; // Tools permitted for this execution
  maxFileWrites: number; // Max files the skill may write (default: 50)
  allowNetwork: boolean; // Whether network access is permitted
  sandboxMode: "docker" | "worktree" | "host" | "off";
}

export const DEFAULT_SKILL_POLICY: SkillPolicy = {
  allowedTools: [],
  maxFileWrites: 50,
  allowNetwork: false,
  sandboxMode: "host",
};

export interface SkillRunContext {
  skillName: string;
  mode: SkillRunMode;
  projectRoot: string;
  policy: SkillPolicy;
  sessionId?: string;
  dryRun?: boolean; // True = propose only, never apply
}

export function makeRunContext(
  opts: Partial<SkillRunContext> & { skillName: string; projectRoot: string },
): SkillRunContext {
  return {
    mode: "apply",
    policy: DEFAULT_SKILL_POLICY,
    ...opts,
  };
}
