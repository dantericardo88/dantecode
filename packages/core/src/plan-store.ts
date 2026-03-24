// ============================================================================
// @dantecode/core — Plan Store
// Persists execution plans to .dantecode/plans/ for audit, resume, and review.
// ============================================================================

import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { ExecutionPlan } from "./architect-planner.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export type PlanStatus = "draft" | "approved" | "rejected" | "executing" | "completed" | "failed";

export interface StoredPlan {
  plan: ExecutionPlan;
  id: string;
  status: PlanStatus;
  createdAt: string;
  approvedAt?: string;
  completedAt?: string;
  sessionId?: string;
}

// ─── Plan Store ─────────────────────────────────────────────────────────────

export class PlanStore {
  private readonly dir: string;

  constructor(projectRoot: string) {
    this.dir = join(projectRoot, ".dantecode", "plans");
  }

  /** Save a plan to disk. Returns the file path. */
  async save(stored: StoredPlan): Promise<string> {
    await mkdir(this.dir, { recursive: true });
    const filePath = join(this.dir, `${stored.id}.json`);
    await writeFile(filePath, JSON.stringify(stored, null, 2), "utf-8");
    return filePath;
  }

  /** Load a plan by ID. Returns null if not found. */
  async load(id: string): Promise<StoredPlan | null> {
    try {
      const filePath = join(this.dir, `${id}.json`);
      const raw = await readFile(filePath, "utf-8");
      return JSON.parse(raw) as StoredPlan;
    } catch {
      return null;
    }
  }

  /** List stored plans, optionally filtered by status. Newest first. */
  async list(options?: { status?: PlanStatus; limit?: number }): Promise<StoredPlan[]> {
    try {
      await mkdir(this.dir, { recursive: true });
      const entries = await readdir(this.dir);
      const jsonFiles = entries
        .filter((f) => f.endsWith(".json"))
        .sort()
        .reverse();

      const plans: StoredPlan[] = [];
      const limit = options?.limit ?? 50;

      for (const file of jsonFiles) {
        if (plans.length >= limit) break;
        try {
          const raw = await readFile(join(this.dir, file), "utf-8");
          const plan = JSON.parse(raw) as StoredPlan;
          if (!options?.status || plan.status === options.status) {
            plans.push(plan);
          }
        } catch {
          // Skip corrupted plan files
        }
      }

      return plans;
    } catch {
      return [];
    }
  }

  /** Update the status of a stored plan. */
  async updateStatus(id: string, status: PlanStatus): Promise<void> {
    const plan = await this.load(id);
    if (!plan) return;

    plan.status = status;
    if (status === "approved") plan.approvedAt = new Date().toISOString();
    if (status === "completed" || status === "failed") plan.completedAt = new Date().toISOString();

    await this.save(plan);
  }

  /** Generate a plan ID from a goal string. */
  static generateId(goal: string): string {
    const timestamp = Date.now();
    const slug = PlanStore.slugify(goal);
    return `${timestamp}-${slug}`;
  }

  /** Slugify a string for use in filenames. */
  static slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 40)
      .replace(/^-|-$/g, "");
  }
}
