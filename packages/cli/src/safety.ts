// ============================================================================
// @dantecode/cli — Safety Module
// Consolidated safety hooks for Bash, Write/Edit, and Sandbox operations.
// ============================================================================

import { resolve } from "node:path";
import type { ToolResult } from "./tools.js";

// ----------------------------------------------------------------------------
// Bash Safety
// ----------------------------------------------------------------------------

/** Dangerous Bash command patterns that should be blocked. */
export const DANGEROUS_BASH_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  // Filesystem destruction
  {
    pattern: /\brm\s+-[a-zA-Z]*r[a-zA-Z]*f?\s+\/\s*$/m,
    reason: "recursive delete of root filesystem",
  },
  {
    pattern: /\brm\s+-[a-zA-Z]*f[a-zA-Z]*r?\s+\/\s*$/m,
    reason: "forced delete of root filesystem",
  },
  { pattern: /\brm\s+-rf\s+\/(?:\s|$)/m, reason: "rm -rf / — catastrophic filesystem delete" },
  { pattern: /\brm\s+-rf\s+~\s*$/m, reason: "rm -rf ~ — delete entire home directory" },
  // Git destructive operations
  {
    pattern: /\bgit\s+push\s+--force\s+(origin\s+)?(main|master)\b/,
    reason: "force push to main/master",
  },
  {
    pattern: /\bgit\s+reset\s+--hard\s+origin\/(main|master)\b/,
    reason: "hard reset to remote main/master",
  },
  // System attacks
  { pattern: /:\s*\(\s*\)\s*\{.*:\s*\|.*:.*&.*\}/, reason: "fork bomb detected" },
  {
    pattern: /\bdd\s+if=\/dev\/(zero|random|urandom)\s+of=\/dev\/[sh]d/,
    reason: "disk overwrite with dd",
  },
  { pattern: /\bmkfs\b/, reason: "filesystem format command" },
  { pattern: /\bchmod\s+-R\s+777\s+\/\s*$/, reason: "chmod 777 on root filesystem" },
  // Pipe-to-shell (broad — catches curl, wget, cat, nc, python, and any other source)
  { pattern: /\|\s*(ba)?sh\b/i, reason: "pipe to shell — arbitrary code execution" },
  { pattern: /\bcurl\s+.*\|\s*(ba)?sh\b/, reason: "pipe remote script to shell" },
  { pattern: /\bwget\s+.*\|\s*(ba)?sh\b/, reason: "pipe remote script to shell" },
  // Command substitution with destructive commands: $(rm -rf /), $(curl ... | bash)
  { pattern: /\$\([^)]*\b(rm|dd|mkfs|shred|chmod|chown|wget|curl)\b/i, reason: "command substitution with destructive command" },
  // Backtick substitution with destructive commands: `rm -rf /`
  { pattern: /`[^`]*\b(rm|dd|mkfs|shred|chmod|chown|wget|curl)\b[^`]*`/i, reason: "backtick substitution with destructive command" },
  // Source/dot injection — loading external scripts into current shell
  { pattern: /^\s*source\s+\S/i, reason: "source command — loading external script" },
  { pattern: /(?:^|[;&|])\s*\.\s+\//, reason: "dot-space injection — sourcing external script at absolute path" },
  // find with destructive actions
  { pattern: /\bfind\s+\/\s+.*-delete\b/, reason: "find with -delete on root filesystem" },
  { pattern: /\bfind\s+\/\s+.*-exec\s+rm\b/, reason: "find with -exec rm on root filesystem" },
  { pattern: /\bfind\s+~\s+.*-delete\b/, reason: "find with -delete on home directory" },
  // Scripting language destructive commands
  {
    pattern: /\bpython[23]?\s+(-c\s+)?.*shutil\.rmtree\s*\(/,
    reason: "Python shutil.rmtree — recursive delete",
  },
  {
    pattern: /\bnode\s+(-e\s+)?.*fs\.(rmSync|rmdirSync)\s*\(/,
    reason: "Node.js destructive fs operation",
  },
  // Env exfiltration
  {
    pattern: /\benv\b.*\|\s*(curl|wget|nc|netcat)\b/,
    reason: "environment variable exfiltration via network",
  },
  {
    pattern: /\bprintenv\b.*\|\s*(curl|wget|nc|netcat)\b/,
    reason: "printenv piped to network tool",
  },
  {
    pattern: /\bcat\s+.*\.env\b.*\|\s*(curl|wget|nc|netcat)\b/,
    reason: ".env file exfiltration via network",
  },
  // Privilege escalation
  { pattern: /\bchown\s+-R\s+root\b/, reason: "recursive chown to root" },
  { pattern: /\bchmod\s+[ugo]*\+s\b/, reason: "setuid/setgid bit modification" },
  // Block device redirect
  { pattern: />\s*\/dev\/sd[a-z]\b/, reason: "redirect to block device" },
  { pattern: /\bshred\s+/, reason: "shred command — secure file destruction" },
];

/**
 * Pre-tool safety hook: checks Bash commands for dangerous patterns.
 * Returns null if safe, or a blocking reason string if dangerous.
 */
export function checkBashSafety(command: string): string | null {
  for (const { pattern, reason } of DANGEROUS_BASH_PATTERNS) {
    if (pattern.test(command)) {
      return reason;
    }
  }
  return null;
}

/**
 * Semantic safety layer: normalizes a command and checks for compound
 * patterns that individual regex checks might miss.
 *
 * Handles command chaining (;, &&, ||), backslash-escaped commands (\rm),
 * base64-encoded payloads, and eval with variable expansion.
 */
export function normalizeAndCheckBash(command: string): string | null {
  // Expand backslash-escaped command names (\rm -> rm)
  const normalized = command.replace(/\\([a-zA-Z])/g, "$1");

  // Split on command chain operators and check each segment
  const segments = normalized.split(/\s*(?:;|&&|\|\|)\s*/);
  for (const segment of segments) {
    const trimmed = segment.trim();
    if (!trimmed) continue;
    const blockReason = checkBashSafety(trimmed);
    if (blockReason) return blockReason;
  }

  // Check for base64-encoded payloads piped to shell
  if (/\b(base64\s+-d|echo\s+[A-Za-z0-9+/=]{20,})\s*\|\s*(ba)?sh\b/.test(normalized)) {
    return "base64-encoded payload piped to shell";
  }

  // Check for eval with variable expansion
  if (/\beval\s+.*\$\{?[A-Z_]/.test(normalized)) {
    return "eval with environment variable expansion";
  }

  // Base64 decode combined with exec/eval (encoding attacks without direct shell pipe)
  if (/base64.*\bexec\b|\beval\b.*base64|Buffer\.from\b.*base64/i.test(normalized)) {
    return "base64 decode with code execution";
  }

  // Multi-flag rm targeting root filesystem (whitespace evasion: rm -r -f /)
  if (/\brm\b(?:\s+-\w+)+\s+\/\s*$/.test(normalized)) {
    return "rm with flags targeting root filesystem";
  }

  // Inspect bash/sh -c argument strings for nested dangerous commands
  const shCMatch = normalized.match(/\b(?:ba)?sh\s+-c\s+['"]([^'"]+)['"]/);
  if (shCMatch) {
    const innerReason = normalizeAndCheckBash(shCMatch[1]!);
    if (innerReason) return innerReason;
  }

  // Strip surrounding quotes from command tokens and re-check (quote-bypass evasion)
  const unquoted = normalized.replace(/["']([^"'\s]+)["']/g, "$1");
  if (unquoted !== normalized) {
    const unquotedReason = checkBashSafety(unquoted);
    if (unquotedReason) return unquotedReason;
  }

  // Check the full normalized command against patterns
  return checkBashSafety(normalized);
}

// ----------------------------------------------------------------------------
// Sandbox Safety
// ----------------------------------------------------------------------------

/** Dangerous command patterns blocked when sandbox mode is active. */
export const SANDBOX_BLOCKED_PATTERNS = [
  /\brm\s+-rf\s+\//,
  /\bsudo\b/,
  /\bchmod\b.*\b777\b/,
  /\bcurl\b.*\|\s*(?:bash|sh)\b/,
  /\bwget\b.*\|\s*(?:bash|sh)\b/,
  /\bdd\s+if=/,
  /\bmkfs\b/,
  /\b:>\s*\//,
  /\bnpm\s+publish\b/,
  /\bgit\s+push\b/,
];

/**
 * Returns an error if the command is blocked by sandbox mode, or null if allowed.
 */
export function sandboxCheckCommand(command: string, sandboxEnabled: boolean): ToolResult | null {
  if (!sandboxEnabled) return null;
  for (const pattern of SANDBOX_BLOCKED_PATTERNS) {
    if (pattern.test(command)) {
      return {
        toolName: "Bash",
        content: `Sandbox: command blocked (matches restricted pattern). Disable sandbox to run: ${command}`,
        isError: true,
        ok: false,
      };
    }
  }
  return null;
}

/**
 * Returns an error if the file path escapes the project root while sandbox is active.
 */
export function sandboxCheckPath(
  filePath: string,
  projectRoot: string,
  sandboxEnabled: boolean,
): ToolResult | null {
  if (!sandboxEnabled) return null;
  const resolved = resolve(projectRoot, filePath);
  if (!resolved.startsWith(projectRoot)) {
    return {
      toolName: "Write",
      content: `Sandbox: write blocked — path escapes project root: ${resolved}`,
      isError: true,
      ok: false,
    };
  }
  return null;
}

// ----------------------------------------------------------------------------
// Write/Edit Safety
// ----------------------------------------------------------------------------

/** File paths that should never be written to by the agent. */
export const PROTECTED_FILE_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  // System directories
  { pattern: /^\/etc\//, reason: "system configuration directory /etc/" },
  { pattern: /^\/usr\//, reason: "system directory /usr/" },
  { pattern: /^\/boot\//, reason: "boot partition" },
  { pattern: /^\/sys\//, reason: "kernel virtual filesystem /sys/" },
  { pattern: /^\/proc\//, reason: "process filesystem /proc/" },
  { pattern: /^C:\\Windows\\/i, reason: "Windows system directory" },
  { pattern: /^C:\\Program Files/i, reason: "Windows Program Files" },
  // Secret/credential files
  { pattern: /\.env$/, reason: ".env file (may contain secrets)" },
  { pattern: /\.env\.local$/, reason: ".env.local file (may contain secrets)" },
  { pattern: /\.env\.production$/, reason: ".env.production file (may contain secrets)" },
  { pattern: /credentials\.json$/i, reason: "credentials file" },
  { pattern: /\.pem$/, reason: "PEM certificate/key file" },
  { pattern: /\.key$/, reason: "private key file" },
  { pattern: /id_rsa/, reason: "SSH private key" },
  { pattern: /id_ed25519/, reason: "SSH private key" },
  // SSH/config
  { pattern: /\.ssh\//, reason: "SSH directory" },
  { pattern: /\.gnupg\//, reason: "GPG directory" },
  { pattern: /\.aws\/credentials/, reason: "AWS credentials" },
  { pattern: /\.kube\/config/, reason: "Kubernetes config" },
  // Audit tampering protection
  { pattern: /\.dantecode\/audit\//, reason: "audit log (tamper protection)" },
];

/**
 * Pre-tool safety hook for Write/Edit operations.
 * Blocks writes to system files, secret files, and audit logs.
 */
export function checkWriteSafety(filePath: string): string | null {
  for (const { pattern, reason } of PROTECTED_FILE_PATTERNS) {
    if (pattern.test(filePath)) {
      return `Write blocked: ${reason}`;
    }
  }
  return null;
}

/**
 * Checks if file content being written appears to contain hardcoded secrets.
 */
export function checkContentForSecrets(content: string): string | null {
  const secretPatterns: Array<{ pattern: RegExp; reason: string }> = [
    {
      pattern: /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/,
      reason: "Private key detected in content",
    },
    { pattern: /AKIA[0-9A-Z]{16}/, reason: "AWS access key ID detected" },
    { pattern: /ghp_[A-Za-z0-9]{36}/, reason: "GitHub personal access token detected" },
    { pattern: /gho_[A-Za-z0-9]{36}/, reason: "GitHub OAuth token detected" },
    { pattern: /xai-[A-Za-z0-9]{20,}/, reason: "xAI/Grok API key detected" },
    { pattern: /sk-[A-Za-z0-9]{20,}/, reason: "OpenAI-style API key detected" },
    { pattern: /sk-ant-[A-Za-z0-9-]{20,}/, reason: "Anthropic API key detected" },
  ];

  for (const { pattern, reason } of secretPatterns) {
    if (pattern.test(content)) {
      return reason;
    }
  }
  return null;
}
