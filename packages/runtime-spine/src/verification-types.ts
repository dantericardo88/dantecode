/**
 * verification-types.ts
 *
 * Shared verification gates and scoring structures.
 */

import { z } from "zod";

export const EvidenceSourceSchema = z.object({
  title: z.string().optional(),
  url: z.string().url(),
  snippet: z.string().optional(),
  timestamp: z.string().datetime().optional(),
});

export type EvidenceSource = z.infer<typeof EvidenceSourceSchema>;

export const VerificationGateSchema = z.object({
  name: z.string(),
  status: z.enum(["pass", "warn", "fail", "not-run"]),
  score: z.number().min(0).max(1).optional(),
  message: z.string().optional(),
  findings: z.array(z.string()).default([]),
});

export type VerificationGate = z.infer<typeof VerificationGateSchema>;

export const RuntimeVerificationReportSchema = z.object({
  taskId: z.string().uuid(),
  passed: z.boolean(),
  overallScore: z.number().min(0).max(1),
  gates: z.array(VerificationGateSchema),
  evidenceCount: z.number().int().min(0),
  sources: z.array(EvidenceSourceSchema).default([]),
  pdse: z.object({
    overall: z.number().min(0).max(1),
    passedGate: z.boolean(),
    metrics: z.record(z.number()).optional(),
  }).optional(),
});

export type RuntimeVerificationReport = z.infer<typeof RuntimeVerificationReportSchema>;
