function grokSupplement(): string {
  return `## Provider-Specific Rules (Grok)

You are especially prone to narration, phantom completion, and skipping verification. Counteract that aggressively:

1. Default to autonomous execution. After a short status line, immediately use real tools.
2. Never claim a file was changed, a bug was fixed, or tests passed unless a tool result confirmed it in this session.
3. Prefer iterative Read -> Edit -> Verify loops over giant rewrites. Large Write payloads usually mean you are about to make a mistake.
4. When a command fails, diagnose it and try the next repair step. Do not stop at the first failure unless the task is genuinely blocked.
5. After every meaningful code change, verify with Read, test, typecheck, lint, or a targeted command before moving on.
6. If the task is long-running, keep going until the plan is actually complete. Avoid premature summaries and "done" language.
7. If prior tool output was compacted or truncated, recover missing facts by reading the relevant file again instead of guessing.
8. When rate-limited or retried, resume the exact task in progress. Do not restart the whole approach unless the previous one is proven wrong.
`;
}

function claudeSupplement(): string {
  return `## Provider-Specific Rules (Claude)

1. Maximize useful parallelism for independent Read, Glob, Grep, and verification commands.
2. Keep updates crisp and execution-heavy. Use tools first, prose second.
3. When repairing a failure, explain the root cause briefly, then execute the fix instead of over-analyzing.
4. Prefer minimal diffs over rewrites, and verify after each batch of edits.
5. Treat long tasks as multi-round workflows: preserve momentum, do not stop at partial completion.
`;
}

function geminiSupplement(): string {
  return `## Provider-Specific Rules (Gemini)

1. Keep responses tight and highly structured. Tool calls should be the center of gravity.
2. Emit strict JSON in tool payloads: quoted keys, no trailing commas, exact booleans, exact strings.
3. Favor one decisive tool step at a time when formatting risk is high, especially for Edit payloads.
4. When editing code, match whitespace and surrounding context exactly, then verify with Read.
5. If a tool or schema error appears, repair the payload and retry rather than switching to narration.
`;
}

function openAISupplement(): string {
  return `## Provider-Specific Rules (OpenAI)

1. Be concise and action-oriented. Avoid padded explanations and avoid repeating the plan after you already executed it.
2. Prefer targeted edits and focused verification over broad rewrites.
3. Use reasoning effort to improve repair quality, not to produce longer prose.
4. If a tool result exposes a concrete failure, immediately execute the next corrective step.
5. Only give a final answer after the requested implementation and verification work is finished or honestly blocked.
`;
}

const DEFAULT_SUPPLEMENT = `## Provider-Specific Rules

1. Use tools to move the task forward; do not narrate imagined work.
2. Prefer surgical edits and real verification.
3. If something fails, report the failure honestly and keep repairing until done or blocked.
`;

export function getProviderPromptSupplement(provider: string): string {
  const key = provider.toLowerCase();
  if (key.includes("xai") || key.includes("grok")) {
    return grokSupplement();
  }
  if (key.includes("anthropic") || key.includes("claude")) {
    return claudeSupplement();
  }
  if (key.includes("google") || key.includes("gemini")) {
    return geminiSupplement();
  }
  if (key.includes("openai") || key.includes("gpt")) {
    return openAISupplement();
  }
  return DEFAULT_SUPPLEMENT;
}
