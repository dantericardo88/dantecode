// ============================================================================
// packages/core/src/onboarding-metrics.ts
//
// Dim 35 — Onboarding / Time-to-value: track the init funnel and surface
// repo readiness so the CLI can guide new users to their first task fast.
// ============================================================================

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export type OnboardingStep =
  | "init-started"
  | "model-configured"
  | "repo-readiness-checked"
  | "first-task-offered"
  | "first-task-completed"
  | "onboarding-complete";

export interface OnboardingEntry {
  sessionId: string;
  step: OnboardingStep;
  framework?: string;
  modelId?: string;
  durationMs?: number;
  recordedAt: string;
}

export interface OnboardingStats {
  totalSessions: number;
  completionRate: number;
  avgDurationMs: number;
  dropOffStep: OnboardingStep | null;
  computedAt: string;
}

export interface RepoReadinessResult {
  hasPackageJson: boolean;
  hasGit: boolean;
  hasDevScript: boolean;
  devCommand: string | null;
  hasDanteforge: boolean;
  detectedFramework: string | null;
}

const LOG_FILE = ".danteforge/onboarding-log.jsonl";
const COMPLETION_STEP: OnboardingStep = "onboarding-complete";

const FRAMEWORK_SIGNALS: Array<[string, string]> = [
  ["next.config", "Next.js"],
  ["nuxt.config", "Nuxt"],
  ["svelte.config", "SvelteKit"],
  ["vite.config", "Vite"],
  ["remix.config", "Remix"],
  ["angular.json", "Angular"],
  ["vue.config", "Vue"],
];

export function recordOnboardingStep(
  entry: Omit<OnboardingEntry, "recordedAt">,
  projectRoot: string,
): void {
  try {
    const dir = join(resolve(projectRoot), ".danteforge");
    mkdirSync(dir, { recursive: true });
    const full: OnboardingEntry = { ...entry, recordedAt: new Date().toISOString() };
    appendFileSync(join(dir, "onboarding-log.jsonl"), JSON.stringify(full) + "\n", "utf-8");
  } catch { /* non-fatal */ }
}

export function loadOnboardingLog(projectRoot: string): OnboardingEntry[] {
  const path = join(resolve(projectRoot), LOG_FILE);
  if (!existsSync(path)) return [];
  try {
    return readFileSync(path, "utf-8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as OnboardingEntry);
  } catch {
    return [];
  }
}

export function getOnboardingStats(entries: OnboardingEntry[]): OnboardingStats {
  if (entries.length === 0) {
    return { totalSessions: 0, completionRate: 0, avgDurationMs: 0, dropOffStep: null, computedAt: new Date().toISOString() };
  }

  const bySession = new Map<string, OnboardingEntry[]>();
  for (const e of entries) {
    const group = bySession.get(e.sessionId) ?? [];
    group.push(e);
    bySession.set(e.sessionId, group);
  }

  const totalSessions = bySession.size;
  let completedCount = 0;
  const durations: number[] = [];
  const dropOffCounts = new Map<OnboardingStep, number>();

  for (const [, steps] of bySession) {
    const completed = steps.some((s) => s.step === COMPLETION_STEP);
    if (completed) {
      completedCount++;
      const times = steps
        .map((s) => new Date(s.recordedAt).getTime())
        .filter((t) => !isNaN(t));
      if (times.length >= 2) {
        durations.push(Math.max(...times) - Math.min(...times));
      }
    } else {
      const lastStep = steps[steps.length - 1]?.step;
      if (lastStep) {
        dropOffCounts.set(lastStep, (dropOffCounts.get(lastStep) ?? 0) + 1);
      }
    }
  }

  const completionRate = completedCount / totalSessions;
  const avgDurationMs = durations.length === 0 ? 0 : durations.reduce((a, b) => a + b, 0) / durations.length;

  let dropOffStep: OnboardingStep | null = null;
  let maxDropOff = 0;
  for (const [step, count] of dropOffCounts) {
    if (count > maxDropOff) {
      maxDropOff = count;
      dropOffStep = step;
    }
  }

  return { totalSessions, completionRate, avgDurationMs, dropOffStep, computedAt: new Date().toISOString() };
}

export function checkRepoReadiness(projectRoot: string): RepoReadinessResult {
  const root = resolve(projectRoot);

  const hasPackageJson = existsSync(join(root, "package.json"));
  const hasGit = existsSync(join(root, ".git"));
  const hasDanteforge = existsSync(join(root, ".danteforge"));

  let hasDevScript = false;
  let devCommand: string | null = null;
  if (hasPackageJson) {
    try {
      const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8")) as {
        scripts?: Record<string, string>;
      };
      const scripts = pkg.scripts ?? {};
      for (const key of ["dev", "start", "serve", "preview", "develop"] as const) {
        if (key in scripts) {
          hasDevScript = true;
          devCommand = `npm run ${key}`;
          break;
        }
      }
    } catch { /* non-fatal */ }
  }

  let detectedFramework: string | null = null;
  for (const [signal, name] of FRAMEWORK_SIGNALS) {
    if (
      existsSync(join(root, `${signal}.js`)) ||
      existsSync(join(root, `${signal}.ts`)) ||
      existsSync(join(root, `${signal}.mjs`)) ||
      existsSync(join(root, signal))
    ) {
      detectedFramework = name;
      break;
    }
  }

  return { hasPackageJson, hasGit, hasDevScript, devCommand, hasDanteforge, detectedFramework };
}
