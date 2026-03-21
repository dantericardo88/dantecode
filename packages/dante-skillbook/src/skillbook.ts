/**
 * skillbook.ts
 *
 * Skillbook Core — load, save, apply updates, stats.
 * Storage is delegated to GitSkillbookStore.
 * Direct mutation outside the governed update path is forbidden.
 */

import { randomUUID } from "node:crypto";
import type {
  Skill,
  UpdateOperation,
  SkillbookStats,
  SkillbookGateDecision,
} from "./types.js";

export interface SkillbookData {
  version: string;
  skills: Skill[];
  createdAt: string;
  updatedAt: string;
}

const CURRENT_VERSION = "1.0.0";

export class DanteSkillbook {
  private data: SkillbookData;

  constructor(data?: Partial<SkillbookData>) {
    const now = new Date().toISOString();
    this.data = {
      version: data?.version ?? CURRENT_VERSION,
      skills: data?.skills ?? [],
      createdAt: data?.createdAt ?? now,
      updatedAt: data?.updatedAt ?? now,
    };
  }

  /** Get all skills (read-only copy). */
  getSkills(): Skill[] {
    return [...this.data.skills];
  }

  /** Get the raw data for serialization. */
  getData(): SkillbookData {
    return { ...this.data, skills: [...this.data.skills] };
  }

  /** Get stats about current skillbook state. */
  stats(): SkillbookStats {
    const sections: Record<string, number> = {};
    for (const skill of this.data.skills) {
      sections[skill.section] = (sections[skill.section] ?? 0) + 1;
    }
    return {
      totalSkills: this.data.skills.length,
      sections,
      lastUpdatedAt: this.data.updatedAt,
      version: this.data.version,
    };
  }

  /**
   * Apply a verified update operation.
   * Only call this after DanteForge gate returns "pass".
   */
  applyUpdate(op: UpdateOperation, decision: SkillbookGateDecision): boolean {
    if (decision !== "pass") return false;

    const now = new Date().toISOString();

    switch (op.action) {
      case "add": {
        if (!op.candidateSkill) return false;
        const skill: Skill = {
          ...op.candidateSkill,
          id: op.candidateSkill.id || randomUUID(),
          createdAt: op.candidateSkill.createdAt || now,
          updatedAt: now,
        };
        this.data.skills.push(skill);
        break;
      }
      case "refine": {
        if (!op.targetSkillId || !op.candidateSkill) return false;
        const idx = this.data.skills.findIndex(s => s.id === op.targetSkillId);
        if (idx < 0) return false;
        this.data.skills[idx] = {
          ...this.data.skills[idx],
          ...op.candidateSkill,
          id: op.targetSkillId,
          updatedAt: now,
        };
        break;
      }
      case "remove": {
        if (!op.targetSkillId) return false;
        this.data.skills = this.data.skills.filter(s => s.id !== op.targetSkillId);
        break;
      }
      case "merge": {
        // Merge: refine target with candidate content, mark updatedAt
        if (!op.targetSkillId || !op.candidateSkill) return false;
        const idx = this.data.skills.findIndex(s => s.id === op.targetSkillId);
        if (idx < 0) return false;
        const existing = this.data.skills[idx]!;
        this.data.skills[idx] = {
          ...existing,
          content: `${existing.content}\n\n---\n\n${op.candidateSkill.content}`,
          updatedAt: now,
        };
        break;
      }
      case "reject":
        // No mutation — already gated
        return false;
    }

    this.data.updatedAt = now;
    return true;
  }

  /**
   * Find a skill by ID.
   */
  findById(id: string): Skill | undefined {
    return this.data.skills.find(s => s.id === id);
  }

  /**
   * Replace entire skills list (for pruning).
   * Internal use only — called by pruning.ts.
   */
  _replaceSkills(skills: Skill[]): void {
    this.data.skills = skills;
    this.data.updatedAt = new Date().toISOString();
  }
}
