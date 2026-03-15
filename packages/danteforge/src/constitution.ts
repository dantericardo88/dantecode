// ============================================================================
// @dantecode/danteforge — Constitution Checker
// Enforces security and safety constraints on generated code by detecting
// credential exposure, dangerous operations, and background process spawning.
// ============================================================================

// ----------------------------------------------------------------------------
// Constitution Violation Types
// ----------------------------------------------------------------------------

export type ConstitutionViolationType =
  | "credential_exposure"
  | "background_process"
  | "dangerous_operation"
  | "code_injection";

export type ConstitutionSeverity = "warning" | "critical";

export interface ConstitutionViolation {
  type: ConstitutionViolationType;
  severity: ConstitutionSeverity;
  line?: number;
  message: string;
  pattern: string;
}

export interface ConstitutionCheckResult {
  passed: boolean;
  violations: ConstitutionViolation[];
  scannedLines: number;
  filePath?: string;
}

// ----------------------------------------------------------------------------
// Pattern Definitions
// ----------------------------------------------------------------------------

interface ConstitutionPattern {
  regex: RegExp;
  type: ConstitutionViolationType;
  severity: ConstitutionSeverity;
  message: string;
}

/**
 * Credential exposure patterns detect hardcoded secrets, API keys, passwords,
 * and tokens in string literals or assignments.
 */
const CREDENTIAL_PATTERNS: ConstitutionPattern[] = [
  {
    regex: /(?:api[_-]?key|apikey)\s*[:=]\s*['"`][A-Za-z0-9_\-]{16,}['"`]/i,
    type: "credential_exposure",
    severity: "critical",
    message: "Hardcoded API key detected in string literal",
  },
  {
    regex: /(?:password|passwd|pwd)\s*[:=]\s*['"`][^'"`]{4,}['"`]/i,
    type: "credential_exposure",
    severity: "critical",
    message: "Hardcoded password detected in string literal",
  },
  {
    regex: /(?:secret|secret[_-]?key)\s*[:=]\s*['"`][A-Za-z0-9_\-]{8,}['"`]/i,
    type: "credential_exposure",
    severity: "critical",
    message: "Hardcoded secret/secret key detected in string literal",
  },
  {
    regex: /(?:access[_-]?token|auth[_-]?token|bearer[_-]?token)\s*[:=]\s*['"`][A-Za-z0-9_\-/.]{16,}['"`]/i,
    type: "credential_exposure",
    severity: "critical",
    message: "Hardcoded access/auth token detected in string literal",
  },
  {
    regex: /(?:private[_-]?key)\s*[:=]\s*['"`]-----BEGIN/i,
    type: "credential_exposure",
    severity: "critical",
    message: "Hardcoded private key detected",
  },
  {
    regex: /(?:aws[_-]?access[_-]?key[_-]?id)\s*[:=]\s*['"`]AKIA[A-Z0-9]{16}['"`]/i,
    type: "credential_exposure",
    severity: "critical",
    message: "AWS access key ID detected in string literal",
  },
  {
    regex: /(?:aws[_-]?secret[_-]?access[_-]?key)\s*[:=]\s*['"`][A-Za-z0-9/+=]{40}['"`]/i,
    type: "credential_exposure",
    severity: "critical",
    message: "AWS secret access key detected in string literal",
  },
  {
    regex: /(?:database[_-]?url|db[_-]?url|connection[_-]?string)\s*[:=]\s*['"`](?:postgres|mysql|mongodb|redis):\/\/[^'"`]+['"`]/i,
    type: "credential_exposure",
    severity: "critical",
    message: "Database connection string with potential credentials detected",
  },
  {
    regex: /(?:gh[ps]_[A-Za-z0-9_]{36,})/,
    type: "credential_exposure",
    severity: "critical",
    message: "GitHub token pattern (ghp_/ghs_) detected in code",
  },
  {
    regex: /(?:sk-[A-Za-z0-9]{32,})/,
    type: "credential_exposure",
    severity: "critical",
    message: "OpenAI API key pattern (sk-) detected in code",
  },
  {
    regex: /(?:xox[bpsa]-[A-Za-z0-9\-]{10,})/,
    type: "credential_exposure",
    severity: "critical",
    message: "Slack token pattern (xoxb-/xoxp-) detected in code",
  },
  {
    regex: /GOCSPX-[A-Za-z0-9_\-]{28,}/,
    type: "credential_exposure",
    severity: "critical",
    message: "Google OAuth client secret detected",
  },
];

/**
 * Background process patterns detect commands or code that spawns
 * detached/background processes, which could be used for persistence.
 */
const BACKGROUND_PROCESS_PATTERNS: ConstitutionPattern[] = [
  {
    regex: /\bnohup\b/,
    type: "background_process",
    severity: "warning",
    message: "nohup usage detected — may spawn persistent background process",
  },
  {
    regex: /\bdisown\b/,
    type: "background_process",
    severity: "warning",
    message: "disown usage detected — detaches process from terminal",
  },
  {
    regex: /\bdaemon\b(?:\s*\(|\s*:)/,
    type: "background_process",
    severity: "warning",
    message: "Daemon process pattern detected",
  },
  {
    regex: /&\s*$/,
    type: "background_process",
    severity: "warning",
    message: "Background execution operator (&) at end of command",
  },
  {
    regex: /\bchild_process\.fork\b/,
    type: "background_process",
    severity: "warning",
    message: "child_process.fork() — spawns a detached child process",
  },
  {
    regex: /\bdetached\s*:\s*true\b/,
    type: "background_process",
    severity: "warning",
    message: "Process spawned with detached: true — runs independently of parent",
  },
  {
    regex: /\bcluster\.fork\b/,
    type: "background_process",
    severity: "warning",
    message: "cluster.fork() — spawns a worker process",
  },
  {
    regex: /\bpm2\s+start\b/,
    type: "background_process",
    severity: "warning",
    message: "PM2 process manager start command detected",
  },
  {
    regex: /\bforever\s+start\b/,
    type: "background_process",
    severity: "warning",
    message: "forever process manager start command detected",
  },
];

/**
 * Dangerous operation patterns detect destructive commands and
 * potential code injection vectors.
 */
const DANGEROUS_OPERATION_PATTERNS: ConstitutionPattern[] = [
  {
    regex: /rm\s+-rf\s+\/(?!\w)/,
    type: "dangerous_operation",
    severity: "critical",
    message: "Destructive command: rm -rf / — would delete entire filesystem",
  },
  {
    regex: /rm\s+-rf\s+~\//,
    type: "dangerous_operation",
    severity: "critical",
    message: "Destructive command: rm -rf ~/ — would delete home directory",
  },
  {
    regex: /rm\s+-rf\s+\$\{?HOME\}?/,
    type: "dangerous_operation",
    severity: "critical",
    message: "Destructive command: rm -rf $HOME — would delete home directory",
  },
  {
    regex: /\bDROP\s+TABLE\b/i,
    type: "dangerous_operation",
    severity: "critical",
    message: "DROP TABLE statement detected — destructive database operation",
  },
  {
    regex: /\bDROP\s+DATABASE\b/i,
    type: "dangerous_operation",
    severity: "critical",
    message: "DROP DATABASE statement detected — destructive database operation",
  },
  {
    regex: /\bTRUNCATE\s+TABLE\b/i,
    type: "dangerous_operation",
    severity: "critical",
    message: "TRUNCATE TABLE statement detected — deletes all data",
  },
  {
    regex: /\bDELETE\s+FROM\s+\w+\s*(?:;|$)/i,
    type: "dangerous_operation",
    severity: "warning",
    message: "DELETE FROM without WHERE clause — would delete all rows",
  },
  {
    regex: /\beval\s*\(\s*(?:req\.|request\.|params\.|body\.|query\.|input|user)/,
    type: "code_injection",
    severity: "critical",
    message: "eval() with user input — critical code injection vulnerability",
  },
  {
    regex: /new\s+Function\s*\(\s*(?:req\.|request\.|params\.|body\.|query\.|input|user)/,
    type: "code_injection",
    severity: "critical",
    message: "new Function() with user input — critical code injection vulnerability",
  },
  {
    regex: /\bexec\s*\(\s*(?:req\.|request\.|params\.|body\.|query\.|input|user|`)/,
    type: "code_injection",
    severity: "critical",
    message: "exec() with user input — command injection vulnerability",
  },
  {
    regex: /child_process.*exec\s*\(\s*`/,
    type: "code_injection",
    severity: "critical",
    message: "child_process exec with template literal — potential command injection",
  },
  {
    regex: /\bexecSync\s*\(\s*`/,
    type: "code_injection",
    severity: "warning",
    message: "execSync with template literal — potential command injection",
  },
  {
    regex: /\b__proto__\s*\[/,
    type: "code_injection",
    severity: "critical",
    message: "Prototype pollution via __proto__ access",
  },
  {
    regex: /\bconstructor\s*\[\s*['"`]prototype['"`]\s*\]/,
    type: "code_injection",
    severity: "critical",
    message: "Prototype pollution via constructor.prototype access",
  },
  {
    regex: /innerHTML\s*=\s*(?:req\.|request\.|params\.|body\.|query\.|input|user)/,
    type: "code_injection",
    severity: "critical",
    message: "innerHTML assignment with user input — XSS vulnerability",
  },
  {
    regex: /document\.write\s*\(\s*(?:req\.|request\.|params\.|body\.|query\.|input|user)/,
    type: "code_injection",
    severity: "critical",
    message: "document.write() with user input — XSS vulnerability",
  },
  {
    regex: /\bchmod\s+777\b/,
    type: "dangerous_operation",
    severity: "warning",
    message: "chmod 777 — sets world-readable/writable/executable permissions",
  },
  {
    regex: /\bchmod\s+666\b/,
    type: "dangerous_operation",
    severity: "warning",
    message: "chmod 666 — sets world-readable/writable permissions",
  },
  {
    regex: /\bcurl\b.*\|\s*(?:sh|bash|zsh)\b/,
    type: "dangerous_operation",
    severity: "critical",
    message: "curl piped to shell — remote code execution risk",
  },
  {
    regex: /\bwget\b.*\|\s*(?:sh|bash|zsh)\b/,
    type: "dangerous_operation",
    severity: "critical",
    message: "wget piped to shell — remote code execution risk",
  },
  {
    regex: /\b::\(\)\s*{\s*:\s*\|\s*:\s*&\s*}\s*;\s*:/,
    type: "dangerous_operation",
    severity: "critical",
    message: "Fork bomb pattern detected",
  },
  {
    regex: />\s*\/dev\/sd[a-z]/,
    type: "dangerous_operation",
    severity: "critical",
    message: "Direct write to block device — could destroy disk data",
  },
  {
    regex: /\bmkfs\b/,
    type: "dangerous_operation",
    severity: "critical",
    message: "mkfs (make filesystem) command — formats a disk partition",
  },
  {
    regex: /\bdd\s+if=.*of=\/dev\//,
    type: "dangerous_operation",
    severity: "critical",
    message: "dd writing to device — could destroy disk data",
  },
];

// Combine all patterns
const ALL_PATTERNS: ConstitutionPattern[] = [
  ...CREDENTIAL_PATTERNS,
  ...BACKGROUND_PROCESS_PATTERNS,
  ...DANGEROUS_OPERATION_PATTERNS,
];

// ----------------------------------------------------------------------------
// Constitution Checker
// ----------------------------------------------------------------------------

/**
 * Runs the constitution check against code content. Scans every line for
 * security violations including:
 * - Credential exposure (hardcoded API keys, passwords, tokens)
 * - Background process patterns (nohup, disown, daemon, detached)
 * - Dangerous operations (rm -rf /, DROP TABLE, eval with user input)
 * - Code injection vectors (exec with template literals, innerHTML with user input)
 *
 * @param code - The source code to check
 * @param filePath - Optional file path for violation reporting
 * @returns ConstitutionCheckResult with pass/fail and violation details
 */
export function runConstitutionCheck(
  code: string,
  filePath?: string,
): ConstitutionCheckResult {
  const violations: ConstitutionViolation[] = [];
  const lines = code.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    const lineNumber = i + 1;
    const trimmedLine = line.trim();

    // Skip empty lines and pure comment lines (for performance and to avoid false positives)
    if (trimmedLine.length === 0) continue;

    // Skip lines that are clearly documentation comments (JSDoc, markdown headers, etc.)
    // but DO check inline comments that may contain secrets
    if (/^\s*\*\s/.test(line) && !/:/.test(line)) continue;

    // Check against all patterns
    for (const pattern of ALL_PATTERNS) {
      if (pattern.regex.test(line)) {
        // Apply context-aware filtering to reduce false positives

        // For credential patterns: skip if the line is inside a type/interface declaration
        if (pattern.type === "credential_exposure") {
          // Skip lines that are type annotations (e.g., apiKey: string)
          if (/:\s*string\s*[;,}]/.test(line) && !/'|"|`/.test(line)) continue;
          // Skip lines in comments that describe the pattern (e.g., "// Set API_KEY env var")
          if (/^\s*\/\//.test(line) && !/:=/.test(line.replace(/\/\/.*/, ""))) continue;
          // Skip environment variable references (process.env.*)
          if (/process\.env\.\w+/.test(line) && !/['"`][A-Za-z0-9_\-]{16,}['"`]/.test(line)) continue;
        }

        // For background process: skip if it's inside a string that's a comment or docs
        if (pattern.type === "background_process" && /&\s*$/.test(line)) {
          // Only flag & at end of line if it looks like a shell command
          if (!/(?:exec|spawn|system|sh |bash |cmd )/.test(line) && !/['"`].*&\s*['"`]/.test(line)) {
            // Skip TypeScript/JavaScript & operator usage (bitwise AND, logical AND)
            if (/&&/.test(line) || /&\s*\w/.test(line)) continue;
          }
        }

        violations.push({
          type: pattern.type,
          severity: pattern.severity,
          line: lineNumber,
          message: pattern.message,
          pattern: pattern.regex.source,
        });
      }
    }
  }

  return {
    passed: violations.length === 0,
    violations,
    scannedLines: lines.length,
    filePath,
  };
}

// ----------------------------------------------------------------------------
// Exported Pattern Arrays (for testing and extension)
// ----------------------------------------------------------------------------

export {
  CREDENTIAL_PATTERNS,
  BACKGROUND_PROCESS_PATTERNS,
  DANGEROUS_OPERATION_PATTERNS,
  ALL_PATTERNS as CONSTITUTION_PATTERNS,
};
