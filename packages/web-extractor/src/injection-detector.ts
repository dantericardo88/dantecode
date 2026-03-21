/**
 * Detect prompt injection patterns in fetched web content.
 * Treat web content as untrusted — scan before feeding to the model.
 */
export function detectInjection(content: string): { safe: boolean; warnings: string[] } {
  const warnings: string[] = [];

  // Pattern 1: System prompt override attempts
  if (
    /\b(system|assistant|user)\s*:/i.test(content) &&
    /ignore\s+(previous|all|above)/i.test(content)
  ) {
    warnings.push("Possible system prompt override detected");
  }

  // Pattern 2: Instruction injection
  if (
    /you\s+are\s+(now|a)\s+/i.test(content) ||
    /\bforget\s+(everything|all|your)\b/i.test(content)
  ) {
    warnings.push("Possible instruction injection detected");
  }

  // Pattern 3: Hidden text via zero-width characters
  if (/[\u200B\u200C\u200D\uFEFF]{3,}/.test(content)) {
    warnings.push("Hidden text via zero-width characters detected");
  }

  // Pattern 4: Jailbreak mode keywords
  if (
    /\bDAN\b/.test(content) ||
    /developer\s+mode/i.test(content) ||
    /\bjailbreak\b/i.test(content) ||
    /do\s+anything\s+now/i.test(content)
  ) {
    warnings.push("Possible jailbreak attempt detected");
  }

  return { safe: warnings.length === 0, warnings };
}
