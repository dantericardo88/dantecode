import type { ModelConfig } from "@dantecode/config-types";

export type SemanticFailureReason =
  | "empty_response"
  | "empty_tool_call_finish"
  | "invalid_council_output";

export class SemanticModelOutputError extends Error {
  readonly reasonCode: SemanticFailureReason;
  readonly provider: string;
  readonly modelId: string;

  constructor(config: Pick<ModelConfig, "provider" | "modelId">, reasonCode: SemanticFailureReason) {
    super(`${config.provider}/${config.modelId} produced semantic failure: ${reasonCode.replace(/_/g, " ")}`);
    this.name = "SemanticModelOutputError";
    this.reasonCode = reasonCode;
    this.provider = config.provider;
    this.modelId = config.modelId;
  }
}

export function isEmptyModelText(text: string | undefined | null): boolean {
  return (text ?? "").trim().length === 0;
}

export function isEmptyToolCallFinish(finishReason: string | undefined, toolCallCount: number): boolean {
  return toolCallCount === 0 && (finishReason === "tool-calls" || finishReason === "tool_calls");
}

export function isGrokProvider(provider: string | undefined): boolean {
  return provider === "grok" || provider === "xai";
}

export function isInvalidCouncilOutput(content: string | undefined | null): boolean {
  return isEmptyModelText(content);
}
