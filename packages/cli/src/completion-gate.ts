import type {
  CompletionGateResult,
  ExecutionLedger,
  RequestClass,
} from "@dantecode/config-types";

export type ExecutionLedgerLike = Pick<
  ExecutionLedger,
  "toolCallRecords" | "mutationRecords" | "validationRecords"
>;

export function classifyRequest(prompt: string): RequestClass {
  const mutatingPatterns = [
    /\b(?:write|edit|create|update|modify|delete|add|remove|change|fix|implement|build|refactor|rewrite|patch|wire|connect|configure|setup)\b/i,
    /\b(?:run|execute)\b.*\b(?:tests?|lint|build|compile|script)\b/i,
    /\b(?:commit|push|merge|pull)\b.*\b(?:changes?|files?|code)\b/i,
    /\b(?:generate|produce|output|create)\b.*\b(?:code|file|content|component|function|class)\b/i,
    /\b(?:make|add|remove|replace)\b.*\b(?:file|directory|folder|path)\b/i,
    /\b(?:save|store|persist)\b.*\b(?:changes?|data|state)\b/i,
  ];

  const validationPatterns = [
    /\b(?:verify|check|validate|test|lint|build|compile|run)\b.*\b(?:code|file|function|class|component)\b.*\b(?:only|without|changes?)\b/i,
    /\b(?:verify|check|validate|test|lint|build|compile|run)\b.*\b(?:without|no)\b.*\bchanges?\b/i,
    /\b(?:does|is|are)\b.*\b(?:work|correct|valid|proper|broken)\b.*\b(?:\?|without changes?)\b/i,
    /\b(?:analyze|review|examine|inspect)\b.*\b(?:code|file)\b.*\b(?:without|no changes?)\b/i,
  ];

  const orchestrationPatterns = [
    /\b(?:orchestrate|coordinate|manage|schedule|plan|organize)\b/i,
    /\b(?:multiple|several|many|various)\b.*\b(?:tasks?|steps?|operations?|phases?)\b/i,
    /\b(?:workflow|pipeline|sequence|series)\b.*\b(?:of|steps?|tasks?)\b/i,
  ];

  const nonMutatingPatterns = [
    /\b(?:explain|describe|tell|show|what|how|why|when|where)\b.*\b(?:is|are|does|works?|means?)\b/i,
    /\b(?:read|view|see|look|check|examine)\b.*\b(?:file|code|content)\b.*\b(?:without|no|don't) changes?\b/i,
    /\b(?:analyze|review|inspect|audit)\b.*\b(?:only|without modifying)\b/i,
  ];

  if (nonMutatingPatterns.some((pattern) => pattern.test(prompt))) {
    return "non_mutating";
  }
  if (orchestrationPatterns.some((pattern) => pattern.test(prompt))) {
    return "orchestration";
  }
  if (validationPatterns.some((pattern) => pattern.test(prompt))) {
    return "validation_only";
  }
  if (mutatingPatterns.some((pattern) => pattern.test(prompt))) {
    return "mutating";
  }

  return "mutating";
}

export function evaluateCompletionGate(
  ledger: ExecutionLedgerLike,
  requestClass: RequestClass,
): CompletionGateResult {
  const timestamp = new Date().toISOString();

  if (requestClass === "non_mutating") {
    return {
      ok: true,
      timestamp,
    };
  }

  if (requestClass === "mutating" && ledger.mutationRecords.length === 0) {
    return {
      ok: false,
      reasonCode: "mutation-requested-but-no-files-changed",
      message: "Mutating request but no mutation records found in execution ledger",
      timestamp,
    };
  }

  if (requestClass === "validation_only" && ledger.validationRecords.length === 0) {
    return {
      ok: false,
      reasonCode: "claimed-validation-not-run",
      message: "Validation request but no validation records found in execution ledger",
      timestamp,
    };
  }

  if (
    requestClass === "orchestration" &&
    ledger.mutationRecords.length === 0 &&
    ledger.validationRecords.length === 0
  ) {
    return {
      ok: false,
      reasonCode: "orchestration-without-evidence",
      message: "Orchestration request but no execution evidence found in ledger",
      timestamp,
    };
  }

  return {
    ok: true,
    timestamp,
  };
}
