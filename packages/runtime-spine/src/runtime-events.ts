/**
 * runtime-events.ts
 *
 * Fixed event vocabulary for the DanteCode Research and Orchestration machines.
 */

import { z } from "zod";

export const RuntimeEventKindSchema = z.enum([
  "research.search.started",
  "research.search.completed",
  "research.fetch.started",
  "research.fetch.completed",
  "research.extract.completed",
  "research.cache.hit",
  "subagent.spawned",
  "subagent.progress",
  "subagent.handoff",
  "subagent.timeout",
  "subagent.terminated",
  "runtime.synthesis.completed",
  "runtime.verification.passed",
  "runtime.verification.failed",
  "runtime.apply.started",
  "runtime.apply.completed",
  "runtime.apply.receipt.emit",
  "skillbook.update.proposed",
  "skillbook.update.accepted",
  "skillbook.update.rejected",
  "skillbook.update.review-required",
  "skillbook.reflection.started",
  "skillbook.reflection.completed",
  "skillbook.loaded",
  "skillbook.saved",
  "gaslight.session.started",
  "gaslight.session.completed",
  "gaslight.critique.completed",
  "gaslight.iteration.gated",
  "gaslight.lesson.written",
  "gaslight.stopped",
  "sandbox.execution.requested",
  "sandbox.execution.allowed",
  "sandbox.execution.blocked",
  "sandbox.execution.completed",
  "sandbox.danteforge.gate.passed",
  "sandbox.danteforge.gate.failed",
  "sandbox.violation",
  "fearset.triggered",
  "fearset.column.started",
  "fearset.column.completed",
  "fearset.danteforge.passed",
  "fearset.danteforge.failed",
  "fearset.sandbox.simulated",
  "fearset.lesson.distilled",
  "fearset.stopped",
  // Plan mode events
  "plan.generated",
  "plan.approved",
  "plan.rejected",
  "plan.step.started",
  "plan.step.completed",
  "plan.step.failed",
  "plan.execution.completed",
]);

export type RuntimeEventKind = z.infer<typeof RuntimeEventKindSchema>;

export const RuntimeEventSchema = z.object({
  at: z
    .string()
    .datetime()
    .default(() => new Date().toISOString()),
  kind: RuntimeEventKindSchema,
  taskId: z.string().uuid(),
  parentId: z.string().uuid().optional(),
  payload: z.record(z.unknown()).default({}),
});

export type RuntimeEvent = z.infer<typeof RuntimeEventSchema>;
export type RuntimeEventInput = z.input<typeof RuntimeEventSchema>;

export function buildRuntimeEvent(event: RuntimeEventInput): RuntimeEvent {
  return RuntimeEventSchema.parse(event);
}
