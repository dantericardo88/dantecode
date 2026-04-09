/**
 * skillbook.ts
 *
 * Skillbook Core — load, save, apply updates, stats.
 * Storage is delegated to GitSkillbookStore.
 * Direct mutation outside the governed update path is forbidden.
 */

import { randomUUID } from "node:crypto";
import type { Skill, UpdateOperation, SkillbookStats, SkillbookGateDecision } from "./types.js";

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
   *
   * For "add" and "refine" actions the skill's successCount and useCount are
   * incremented and winRate recomputed, recording a "pass" outcome.
   */
  applyUpdate(op: UpdateOperation, decision: SkillbookGateDecision): boolean {
    if (decision !== "pass") return false;

    const now = new Date().toISOString();

    switch (op.action) {
      case "add": {
        if (!op.candidateSkill) return false;
        const successCount = (op.candidateSkill.successCount ?? 0) + 1;
        const useCount = (op.candidateSkill.useCount ?? 0) + 1;
        const skill: Skill = {
          ...op.candidateSkill,
          id: op.candidateSkill.id || randomUUID(),
          createdAt: op.candidateSkill.createdAt || now,
          updatedAt: now,
          successCount,
          useCount,
          winRate: successCount / useCount,
        };
        this.data.skills.push(skill);
        break;
      }
      case "refine": {
        if (!op.targetSkillId || !op.candidateSkill) return false;
        const idx = this.data.skills.findIndex((s) => s.id === op.targetSkillId);
        if (idx < 0) return false;
        const existing = this.data.skills[idx]!;
        const successCount = (existing.successCount ?? 0) + 1;
        const useCount = (existing.useCount ?? 0) + 1;
        this.data.skills[idx] = {
          ...existing,
          ...op.candidateSkill,
          id: op.targetSkillId,
          updatedAt: now,
          successCount,
          useCount,
          winRate: successCount / useCount,
        };
        break;
      }
      case "remove": {
        if (!op.targetSkillId) return false;
        this.data.skills = this.data.skills.filter((s) => s.id !== op.targetSkillId);
        break;
      }
      case "merge": {
        // Merge: refine target with candidate content, mark updatedAt
        if (!op.targetSkillId || !op.candidateSkill) return false;
        const idx = this.data.skills.findIndex((s) => s.id === op.targetSkillId);
        if (idx < 0) return false;
        const existing = this.data.skills[idx]!;
        const successCount = (existing.successCount ?? 0) + 1;
        const useCount = (existing.useCount ?? 0) + 1;
        this.data.skills[idx] = {
          ...existing,
          content: `${existing.content}\n\n---\n\n${op.candidateSkill.content}`,
          updatedAt: now,
          successCount,
          useCount,
          winRate: successCount / useCount,
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
   * Record a use of a skill without a pass outcome.
   * Call this when a skill is retrieved/applied but before the outcome is known.
   * Increments useCount only; winRate is recomputed downward.
   */
  recordSkillUse(skillId: string): boolean {
    const idx = this.data.skills.findIndex((s) => s.id === skillId);
    if (idx < 0) return false;
    const existing = this.data.skills[idx]!;
    const useCount = (existing.useCount ?? 0) + 1;
    const successCount = existing.successCount ?? 0;
    this.data.skills[idx] = {
      ...existing,
      useCount,
      winRate: successCount / useCount,
    };
    this.data.updatedAt = new Date().toISOString();
    return true;
  }

  /**
   * Get the top N skills ranked by win-rate weighted by usage frequency.
   * Score = winRate * log1p(useCount). Skills with no usage data rank last.
   */
  getTopSkills(n: number): Skill[] {
    return [...this.data.skills]
      .sort((a, b) => {
        const scoreA = (a.winRate ?? 0) * Math.log1p(a.useCount ?? 0);
        const scoreB = (b.winRate ?? 0) * Math.log1p(b.useCount ?? 0);
        return scoreB - scoreA;
      })
      .slice(0, n);
  }

  /**
   * Find a skill by ID.
   */
  findById(id: string): Skill | undefined {
    return this.data.skills.find((s) => s.id === id);
  }

  /**
   * Record session outcome for a set of skills.
   * Increments `appliedInSessions` for each skill; also increments
   * `sessionsSucceeded` when the session succeeded.
   */
  recordSessionOutcome(skillIds: string[], succeeded: boolean): void {
    const now = new Date().toISOString();
    for (const skillId of skillIds) {
      const idx = this.data.skills.findIndex((s) => s.id === skillId);
      if (idx < 0) continue;
      const existing = this.data.skills[idx]!;
      const appliedInSessions = (existing.appliedInSessions ?? 0) + 1;
      const sessionsSucceeded = (existing.sessionsSucceeded ?? 0) + (succeeded ? 1 : 0);
      this.data.skills[idx] = {
        ...existing,
        appliedInSessions,
        sessionsSucceeded,
        updatedAt: now,
      };
    }
    this.data.updatedAt = now;
  }

  /**
   * Get an effectiveness report for all skills that have been applied in sessions.
   * effectivenessScore = sessionsSucceeded / appliedInSessions (0 if no sessions).
   */
  getEffectivenessReport(): Array<{
    skillId: string;
    winRate: number;
    appliedInSessions: number;
    effectivenessScore: number;
  }> {
    return this.data.skills
      .filter((s) => (s.appliedInSessions ?? 0) > 0)
      .map((s) => {
        const appliedInSessions = s.appliedInSessions ?? 0;
        const sessionsSucceeded = s.sessionsSucceeded ?? 0;
        return {
          skillId: s.id,
          winRate: s.winRate ?? 0,
          appliedInSessions,
          effectivenessScore: appliedInSessions > 0 ? sessionsSucceeded / appliedInSessions : 0,
        };
      });
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
