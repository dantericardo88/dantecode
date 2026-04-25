import { createHash } from "node:crypto";

import type { ExecutionLedger, ToolCallRecord } from "@dantecode/config-types";

import type { ToolResult } from "./tools.js";

/**
 * Produces a tamper-evident SHA-256 seal over the four fields that uniquely
 * identify a real execution: tool name, serialized input, output content, and
 * timestamp. A ghost tool call — XML written in LLM prose — cannot produce a
 * valid seal because it never passes through this code path.
 */
export function computeExecutionSeal(
  toolName: string,
  input: Record<string, unknown>,
  output: string,
  timestamp: string,
): string {
  return createHash("sha256")
    .update(toolName)
    .update(JSON.stringify(input))
    .update(output)
    .update(timestamp)
    .digest("hex");
}

/**
 * Returns true only if the record's seal matches the expected digest computed
 * from its own fields. A missing seal or any field mutation returns false.
 */
export function verifySeal(record: ToolCallRecord): boolean {
  if (!record.seal) return false;
  const expected = computeExecutionSeal(
    record.toolName,
    record.input,
    record.result.content,
    record.timestamp,
  );
  return record.seal === expected;
}

export interface ExecutionEvidenceToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ExecutionEvidenceContext {
  executionLedger: ExecutionLedger;
  firstMutationTime: number | null;
  projectRoot: string;
  sessionId: string;
  modelLabel: string;
  now?: () => number;
  timestamp?: () => string;
}

export interface ExecutionEvidencePersister {
  recordToolCall: (
    projectRoot: string,
    sessionId: string,
    modelLabel: string,
    toolCallRecord: ToolCallRecord,
  ) => Promise<void>;
  recordMutation: (
    projectRoot: string,
    sessionId: string,
    modelLabel: string,
    mutation: NonNullable<ToolResult["mutationRecords"]>[number],
  ) => Promise<void>;
  recordValidation: (
    projectRoot: string,
    sessionId: string,
    modelLabel: string,
    validation: NonNullable<ToolResult["validationRecords"]>[number],
  ) => Promise<void>;
}

export async function recordExecutionEvidence(
  toolCall: ExecutionEvidenceToolCall,
  result: ToolResult,
  context: ExecutionEvidenceContext,
  persister: ExecutionEvidencePersister,
): Promise<number | null> {
  const timestamp = context.timestamp?.() ?? new Date().toISOString();
  const toolCallRecord: ToolCallRecord = {
    id: toolCall.id,
    toolName: toolCall.name,
    input: toolCall.input,
    result: {
      toolUseId: toolCall.id,
      content: result.content,
      isError: result.isError,
    },
    timestamp,
    seal: computeExecutionSeal(toolCall.name, toolCall.input, result.content, timestamp),
  };
  context.executionLedger.toolCallRecords.push(toolCallRecord);

  for (const mutation of result.mutationRecords || []) {
    mutation.toolCallId = toolCallRecord.id;
  }
  for (const validation of result.validationRecords || []) {
    validation.toolCallId = toolCallRecord.id;
  }

  let firstMutationTime = context.firstMutationTime;
  if (!firstMutationTime && (result.mutationRecords ?? []).length > 0) {
    firstMutationTime = context.now?.() ?? Date.now();
  }
  context.executionLedger.mutationRecords.push(...(result.mutationRecords || []));
  context.executionLedger.validationRecords.push(...(result.validationRecords || []));

  await persister.recordToolCall(
    context.projectRoot,
    context.sessionId,
    context.modelLabel,
    toolCallRecord,
  );
  for (const mutation of result.mutationRecords || []) {
    await persister.recordMutation(context.projectRoot, context.sessionId, context.modelLabel, mutation);
  }
  for (const validation of result.validationRecords || []) {
    await persister.recordValidation(
      context.projectRoot,
      context.sessionId,
      context.modelLabel,
      validation,
    );
  }

  return firstMutationTime;
}
