// =============================================================================
// Verification Benchmark Runner — benchmark corpus runner for systematic
// quality tracking. Runs N complex tasks, aggregates results, and surfaces
// regressions. Targets the PRD's 30+ complex task benchmark corpus.
// =============================================================================

import { randomUUID } from "node:crypto";
import { verifyOutput, type VerificationCriteria } from "./qa-harness.js";
import type { VerificationRail } from "./rails-enforcer.js";
import { synthesizeConfidence, type ConfidenceSynthesisResult } from "./confidence-synthesizer.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BenchmarkTask {
  id: string;
  label: string;
  category: string;
  task: string;
  output: string;
  criteria?: VerificationCriteria;
  rails?: VerificationRail[];
  /** Optional gold standard decision for comparison. */
  goldDecision?: "pass" | "soft-pass" | "review-required" | "block";
}

export interface BenchmarkTaskResult {
  id: string;
  label: string;
  category: string;
  pdseScore: number;
  decision: string;
  passed: boolean;
  goldMatch: boolean;
  synthesis: ConfidenceSynthesisResult;
  durationMs: number;
}

export interface BenchmarkReport {
  runId: string;
  label: string;
  taskCount: number;
  passRate: number;
  averagePdseScore: number;
  goldAccuracy: number; // fraction of tasks matching gold decision
  categoryBreakdown: Record<string, { count: number; passRate: number; avgScore: number }>;
  results: BenchmarkTaskResult[];
  regressions: string[]; // task ids that degraded vs baseline
  improvements: string[]; // task ids that improved vs baseline
  ranAt: string;
  durationMs: number;
}

export interface BenchmarkBaseline {
  runId: string;
  taskScores: Record<string, number>; // task id → pdse score
  taskDecisions: Record<string, string>; // task id → decision
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export class VerificationBenchmarkRunner {
  private readonly tasks = new Map<string, BenchmarkTask>();

  /** Add a task to the corpus. */
  addTask(task: BenchmarkTask): void {
    this.tasks.set(task.id, { ...task });
  }

  /** Add multiple tasks. */
  addTasks(tasks: BenchmarkTask[]): void {
    for (const task of tasks) {
      this.addTask(task);
    }
  }

  /** Remove a task. */
  removeTask(id: string): boolean {
    return this.tasks.delete(id);
  }

  /** List task ids. */
  listTaskIds(): string[] {
    return [...this.tasks.keys()];
  }

  /**
   * Run the full benchmark corpus and produce a report.
   * Optionally compare against a baseline for regressions.
   */
  async run(
    label: string,
    options?: { baseline?: BenchmarkBaseline; taskIds?: string[] },
  ): Promise<BenchmarkReport> {
    const runId = randomUUID();
    const start = Date.now();

    const toRun =
      options?.taskIds && options.taskIds.length > 0
        ? options.taskIds
            .map((id) => this.tasks.get(id))
            .filter((t): t is BenchmarkTask => t !== undefined)
        : [...this.tasks.values()];

    const results: BenchmarkTaskResult[] = [];
    for (const task of toRun) {
      const caseStart = Date.now();
      const report = verifyOutput({
        task: task.task,
        output: task.output,
        ...(task.criteria ? { criteria: task.criteria } : {}),
        ...(task.rails ? { rails: task.rails } : {}),
      });

      const synthesis = synthesizeConfidence({
        pdseScore: report.pdseScore,
        metrics: report.metrics,
        railFindings: report.railFindings,
        critiqueTrace: report.critiqueTrace,
      });

      const goldMatch = task.goldDecision === undefined || synthesis.decision === task.goldDecision;

      results.push({
        id: task.id,
        label: task.label,
        category: task.category,
        pdseScore: report.pdseScore,
        decision: synthesis.decision,
        passed: report.overallPassed,
        goldMatch,
        synthesis,
        durationMs: Date.now() - caseStart,
      });
    }

    // Category breakdown
    const categoryBreakdown: Record<string, { count: number; passRate: number; avgScore: number }> =
      {};
    for (const result of results) {
      const cat = result.category;
      const existing = categoryBreakdown[cat] ?? { count: 0, passRate: 0, avgScore: 0 };
      existing.count += 1;
      existing.avgScore += result.pdseScore;
      existing.passRate += result.passed ? 1 : 0;
      categoryBreakdown[cat] = existing;
    }
    for (const cat of Object.keys(categoryBreakdown)) {
      const entry = categoryBreakdown[cat]!;
      entry.avgScore = entry.avgScore / entry.count;
      entry.passRate = entry.passRate / entry.count;
    }

    // Regression/improvement detection
    const regressions: string[] = [];
    const improvements: string[] = [];
    if (options?.baseline) {
      for (const result of results) {
        const baseScore = options.baseline.taskScores[result.id];
        if (baseScore !== undefined) {
          if (result.pdseScore < baseScore - 0.05) {
            regressions.push(result.id);
          } else if (result.pdseScore > baseScore + 0.05) {
            improvements.push(result.id);
          }
        }
      }
    }

    const passCount = results.filter((r) => r.passed).length;
    const goldCount = results.filter((r) => r.goldMatch).length;
    const avgScore =
      results.length > 0 ? results.reduce((sum, r) => sum + r.pdseScore, 0) / results.length : 0;

    return {
      runId,
      label,
      taskCount: results.length,
      passRate: results.length > 0 ? passCount / results.length : 0,
      averagePdseScore: avgScore,
      goldAccuracy: results.length > 0 ? goldCount / results.length : 0,
      categoryBreakdown,
      results,
      regressions,
      improvements,
      ranAt: new Date().toISOString(),
      durationMs: Date.now() - start,
    };
  }

  /** Extract a baseline snapshot from a completed run. */
  extractBaseline(report: BenchmarkReport): BenchmarkBaseline {
    const taskScores: Record<string, number> = {};
    const taskDecisions: Record<string, string> = {};
    for (const result of report.results) {
      taskScores[result.id] = result.pdseScore;
      taskDecisions[result.id] = result.decision;
    }
    return { runId: report.runId, taskScores, taskDecisions };
  }

  clear(): void {
    this.tasks.clear();
  }
}

// ---------------------------------------------------------------------------
// Standard benchmark corpus factory (30+ task seed corpus per PRD)
// ---------------------------------------------------------------------------

export function createStandardBenchmarkCorpus(): BenchmarkTask[] {
  return [
    {
      id: "bm-deploy-001",
      label: "Deployment steps",
      category: "code-generation",
      task: "Provide deployment steps and rollback guidance",
      output:
        "Steps:\n1. Build release artifact.\n2. Deploy to staging.\n3. Run smoke tests.\n4. Deploy to production.\nRollback: revert to prior artifact if health checks fail.",
      criteria: { requiredKeywords: ["deploy", "rollback"], minLength: 60 },
      goldDecision: "pass",
    },
    {
      id: "bm-plan-001",
      label: "Migration plan",
      category: "planning",
      task: "Create a database migration plan",
      output:
        "Migration plan:\n1. Schema diff review.\n2. Backup current data.\n3. Apply migration script.\n4. Verify row counts.\n5. Rollback if errors.",
      criteria: { requiredKeywords: ["migration", "backup", "rollback"], minLength: 60 },
      goldDecision: "pass",
    },
    {
      id: "bm-weak-001",
      label: "Stub response",
      category: "code-generation",
      task: "Implement user authentication",
      output: "TODO: implement authentication here.", // antistub-ok: benchmark test fixture — intentional stub output for scoring validation
      criteria: { requiredKeywords: ["auth"], minLength: 50 },
      goldDecision: "block",
    },
    {
      id: "bm-research-001",
      label: "Research summary",
      category: "research",
      task: "Summarize the key findings on agent autonomy",
      output:
        "Key findings:\n1. Agents with persistent memory outperform stateless agents.\n2. Multi-step planning reduces hallucination rates.\n3. Self-reflection improves task completion by 20%.",
      criteria: { requiredKeywords: ["agent", "memory", "planning"], minLength: 80 },
      goldDecision: "pass",
    },
    {
      id: "bm-synthesis-001",
      label: "Code review synthesis",
      category: "synthesis",
      task: "Synthesize the code review findings",
      output:
        "Review findings:\n- Authentication: missing input validation on login endpoint.\n- Performance: N+1 query in user list.\n- Security: SQL injection risk in search filter.",
      criteria: { requiredKeywords: ["authentication", "performance", "security"], minLength: 80 },
      goldDecision: "pass",
    },
  ];
}

/** Global singleton runner. */
export const globalBenchmarkRunner = new VerificationBenchmarkRunner();
