export interface InitialRoundBudgetOptions {
  requiredRounds?: number;
  skillActive?: boolean;
}

export interface AutoContinuationOptions {
  remainingRounds: number;
  isPipelineWorkflow: boolean;
  autoContinuations: number;
  maxAutoContinuations: number;
  filesModified: number;
}

export interface EmptyResponseRoundOptions {
  responseText: string;
  toolCallCount: number;
  consecutiveEmptyRounds: number;
  maxConsecutiveEmptyRounds: number;
}

export interface EmptyResponseRoundEvaluation {
  nextConsecutiveEmptyRounds: number;
  shouldAbort: boolean;
  shouldWarn: boolean;
}

export function getInitialRoundBudget({
  requiredRounds,
  skillActive,
}: InitialRoundBudgetOptions): number {
  if (requiredRounds !== undefined) {
    return Math.max(requiredRounds, 15);
  }
  return skillActive ? 50 : 15;
}

export function shouldAutoContinueBudget({
  remainingRounds,
  isPipelineWorkflow,
  autoContinuations,
  maxAutoContinuations,
  filesModified,
}: AutoContinuationOptions): boolean {
  return (
    remainingRounds <= 1 &&
    isPipelineWorkflow &&
    autoContinuations < maxAutoContinuations &&
    filesModified > 0
  );
}

export function getAutoContinuationRefill({
  skillActive,
}: Pick<InitialRoundBudgetOptions, "skillActive">): number {
  return skillActive ? 50 : 15;
}

export function evaluateEmptyResponseRound({
  responseText,
  toolCallCount,
  consecutiveEmptyRounds,
  maxConsecutiveEmptyRounds,
}: EmptyResponseRoundOptions): EmptyResponseRoundEvaluation {
  if (toolCallCount > 0) {
    return {
      nextConsecutiveEmptyRounds: 0,
      shouldAbort: false,
      shouldWarn: false,
    };
  }

  if (responseText.trim().length > 0) {
    return {
      nextConsecutiveEmptyRounds: consecutiveEmptyRounds,
      shouldAbort: false,
      shouldWarn: false,
    };
  }

  const nextConsecutiveEmptyRounds = consecutiveEmptyRounds + 1;
  return {
    nextConsecutiveEmptyRounds,
    shouldAbort: nextConsecutiveEmptyRounds >= maxConsecutiveEmptyRounds,
    shouldWarn: true,
  };
}
