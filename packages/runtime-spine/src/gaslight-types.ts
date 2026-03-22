/**
 * gaslight-types.ts
 *
 * Shared contract types for the DanteGaslight engine.
 */

import { z } from "zod";

export const GaslightTriggerChannelSchema = z.enum([
  "explicit-user",
  "verification",
  "policy",
  "audit",
]);
export type GaslightTriggerChannel = z.infer<typeof GaslightTriggerChannelSchema>;

export const GaslightGateDecisionSchema = z.enum(["pass", "fail", "review-required"]);
export type GaslightGateDecision = z.infer<typeof GaslightGateDecisionSchema>;

export const GaslightStopReasonSchema = z.enum([
  "pass",
  "confidence",
  "budget-tokens",
  "budget-time",
  "budget-iterations",
  "user-stop",
  "policy-abort",
]);
export type GaslightStopReason = z.infer<typeof GaslightStopReasonSchema>;

export const GaslightSessionSummarySchema = z.object({
  sessionId: z.string(),
  triggerChannel: GaslightTriggerChannelSchema,
  iterationCount: z.number().int().min(0),
  stopReason: GaslightStopReasonSchema.optional(),
  finalGateDecision: GaslightGateDecisionSchema.optional(),
  lessonEligible: z.boolean(),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().optional(),
});
export type GaslightSessionSummary = z.infer<typeof GaslightSessionSummarySchema>;
