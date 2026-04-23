// ============================================================================
// @dantecode/core — Task Decomposer
// Harvested from OpenHands: sandbox grouping strategy + planning agent pattern
// ============================================================================

export type SandboxGroupingStrategy =
  | "no_grouping" // one agent per sub-task (max isolation)
  | "add_to_any" // share worker when available (low overhead)
  | "fewest_tasks"; // assign to worker with fewest current tasks (load balance)

export interface SubTask {
  id: string;
  description: string;
  /** Files this task will primarily read/write — used for conflict detection */
  affectedFiles?: string[];
  /** IDs of tasks that must complete first */
  dependsOn?: string[];
  /** Higher = run first (default: 0) */
  priority?: number;
}

export interface DecompositionResult {
  tasks: SubTask[];
  strategy: SandboxGroupingStrategy;
  /** Tasks that can run in parallel (no dependency between them) */
  parallelGroups: SubTask[][];
}

/**
 * Decompose a large task description into sub-tasks using the LLM.
 * Harvests OpenHands' planning agent pattern (PLAN.md generation).
 * Returns a single-task fallback if LLM fails or returns invalid JSON.
 */
export async function decomposeTask(
  taskDescription: string,
  llmCall: (prompt: string) => Promise<string>,
  options: {
    maxSubTasks?: number;
    strategy?: SandboxGroupingStrategy;
    projectRoot?: string;
  } = {},
): Promise<DecompositionResult> {
  const maxSubTasks = options.maxSubTasks ?? 6;
  const strategy = options.strategy ?? "no_grouping";

  const fallback: DecompositionResult = {
    tasks: [{ id: "task-1", description: taskDescription }],
    strategy,
    parallelGroups: [[{ id: "task-1", description: taskDescription }]],
  };

  const prompt =
    `You are a software engineering task planner.\n\n` +
    `Decompose this task into ${maxSubTasks} or fewer independent sub-tasks that can be worked on in parallel:\n\n` +
    `TASK: ${taskDescription}\n\n` +
    `Output a JSON array of sub-tasks in this exact format:\n` +
    `[\n  {\n    "id": "task-1",\n    "description": "...",\n    "affectedFiles": ["src/foo.ts"],\n    "dependsOn": [],\n    "priority": 2\n  }\n]\n\n` +
    `Rules:\n` +
    `- Mark dependsOn with IDs of tasks that MUST complete before this one\n` +
    `- Tasks with no dependencies can run in parallel\n` +
    `- affectedFiles must be specific paths, not globs\n` +
    `- Keep each task to a single coherent unit of work\n` +
    `- Return ONLY the JSON array, no other text`;

  let response: string;
  try {
    response = await llmCall(prompt);
  } catch {
    return fallback;
  }

  let tasks: SubTask[];
  try {
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return fallback;
    tasks = JSON.parse(jsonMatch[0]) as SubTask[];
    if (!Array.isArray(tasks) || tasks.length === 0) return fallback;
  } catch {
    return fallback;
  }

  const parallelGroups = buildParallelGroups(tasks);
  return { tasks, strategy, parallelGroups };
}

/**
 * Group tasks into parallel execution batches based on dependencies.
 * Tasks in the same group have no dependencies between them.
 * Handles circular dependencies gracefully (breaks the cycle).
 */
export function buildParallelGroups(tasks: SubTask[]): SubTask[][] {
  const remaining = new Map(tasks.map((t) => [t.id, t]));
  const completed = new Set<string>();
  const groups: SubTask[][] = [];

  while (remaining.size > 0) {
    const ready = [...remaining.values()].filter(
      (t) => (t.dependsOn ?? []).every((dep) => completed.has(dep)),
    );
    if (ready.length === 0) break; // circular dependency guard — exit rather than infinite loop

    // Sort by priority descending within group
    ready.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    groups.push(ready);

    for (const t of ready) {
      remaining.delete(t.id);
      completed.add(t.id);
    }
  }

  return groups.length > 0 ? groups : [[...tasks]];
}

/**
 * Detect file conflicts between two tasks.
 * Returns true if they write to the same files (should NOT run in parallel).
 */
export function hasFileConflict(taskA: SubTask, taskB: SubTask): boolean {
  const filesA = new Set(taskA.affectedFiles ?? []);
  return (taskB.affectedFiles ?? []).some((f) => filesA.has(f));
}
