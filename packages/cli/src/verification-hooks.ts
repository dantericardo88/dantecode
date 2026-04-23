import type { ExecutionLedger, ToolCallRecord } from "@dantecode/config-types";

import type { ToolResult } from "./tools.js";

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
