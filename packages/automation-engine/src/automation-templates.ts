import { randomBytes } from "node:crypto";

// AutomationDefinition is defined here (also used by bridge/orchestrator)
export interface AutomationDefinition {
  id: string;
  name: string;
  type: "webhook" | "schedule" | "watch";
  config: Record<string, unknown>;
  agentMode?: {
    prompt: string;
    model?: string;
    sandboxMode?: string;
    verifyOutput?: boolean;
  };
  workflowPath?: string;
  createdAt: string;
  status: "active" | "stopped" | "error";
  lastRunAt?: string;
  runCount: number;
}

export interface AutomationTemplate {
  name: string;
  description: string;
  type: "webhook" | "schedule" | "watch";
  create(options?: Record<string, unknown>): AutomationDefinition;
}

function generateId(): string {
  return randomBytes(6).toString("hex");
}

export const BUILT_IN_TEMPLATES: AutomationTemplate[] = [
  {
    name: "pr-review",
    description:
      "Automatically review pull requests using the DanteCode agent when a webhook fires",
    type: "webhook",
    create(options?: Record<string, unknown>): AutomationDefinition {
      return {
        id: generateId(),
        name: "pr-review",
        type: "webhook",
        config: {
          port: typeof options?.port === "number" ? options.port : 3000,
          path: typeof options?.path === "string" ? options.path : "/webhook/pr-review",
          provider: typeof options?.provider === "string" ? options.provider : "github",
          secret: typeof options?.secret === "string" ? options.secret : "",
          event: "pull_request",
        },
        agentMode: {
          prompt:
            "Review the pull request #${pr_number} (${pr_title}) and provide constructive feedback on code quality, correctness, and style. Branch: ${branch}. Author: ${author}.",
          model: typeof options?.model === "string" ? options.model : undefined,
          sandboxMode: typeof options?.sandboxMode === "string" ? options.sandboxMode : "docker",
          verifyOutput: true,
        },
        workflowPath:
          typeof options?.workflowPath === "string"
            ? options.workflowPath
            : ".github/workflows/pr-review.yml",
        createdAt: new Date().toISOString(),
        status: "active",
        runCount: 0,
      };
    },
  },
  {
    name: "daily-verify",
    description: "Run full codebase verification every day at midnight",
    type: "schedule",
    create(options?: Record<string, unknown>): AutomationDefinition {
      return {
        id: generateId(),
        name: "daily-verify",
        type: "schedule",
        config: {
          cron: typeof options?.cron === "string" ? options.cron : "0 0 * * *",
          timezone: typeof options?.timezone === "string" ? options.timezone : "UTC",
          retryOnFailure: options?.retryOnFailure !== false,
          maxRetries: typeof options?.maxRetries === "number" ? options.maxRetries : 2,
        },
        agentMode: {
          prompt:
            "Run a full verification pass on the codebase: typecheck, lint, test, and build. Report any failures with actionable fixes.",
          model: typeof options?.model === "string" ? options.model : undefined,
          sandboxMode: typeof options?.sandboxMode === "string" ? options.sandboxMode : "docker",
          verifyOutput: true,
        },
        workflowPath:
          typeof options?.workflowPath === "string"
            ? options.workflowPath
            : ".github/workflows/daily-verify.yml",
        createdAt: new Date().toISOString(),
        status: "active",
        runCount: 0,
      };
    },
  },
  {
    name: "test-on-change",
    description: "Run tests automatically when TypeScript source files change",
    type: "watch",
    create(options?: Record<string, unknown>): AutomationDefinition {
      return {
        id: generateId(),
        name: "test-on-change",
        type: "watch",
        config: {
          pattern: typeof options?.pattern === "string" ? options.pattern : "src/**/*.ts",
          debounceMs: typeof options?.debounceMs === "number" ? options.debounceMs : 500,
          ignorePatterns: Array.isArray(options?.ignorePatterns)
            ? options.ignorePatterns
            : ["**/*.test.ts", "**/*.spec.ts"],
          runOnStartup: options?.runOnStartup === true,
        },
        agentMode: {
          prompt:
            "A source file changed: ${changedFile}. Run the relevant tests for the changed file and report any failures with suggested fixes.",
          model: typeof options?.model === "string" ? options.model : undefined,
          sandboxMode: typeof options?.sandboxMode === "string" ? options.sandboxMode : "host",
          verifyOutput: false,
        },
        workflowPath:
          typeof options?.workflowPath === "string"
            ? options.workflowPath
            : ".github/workflows/test-on-change.yml",
        createdAt: new Date().toISOString(),
        status: "active",
        runCount: 0,
      };
    },
  },
  {
    name: "security-scan",
    description: "Run a security audit scan on a nightly schedule",
    type: "schedule",
    create(options?: Record<string, unknown>): AutomationDefinition {
      return {
        id: generateId(),
        name: "security-scan",
        type: "schedule",
        config: {
          cron: typeof options?.cron === "string" ? options.cron : "0 2 * * *",
          timezone: typeof options?.timezone === "string" ? options.timezone : "UTC",
          severity: typeof options?.severity === "string" ? options.severity : "high",
          failOnVulnerability: options?.failOnVulnerability !== false,
          createIssueOnFinding: options?.createIssueOnFinding !== false,
        },
        agentMode: {
          prompt:
            "Run a full security audit on the codebase. Check for dependency vulnerabilities (npm audit), hard-coded secrets, and known insecure patterns. Report all findings with severity levels and suggested remediations.",
          model: typeof options?.model === "string" ? options.model : undefined,
          sandboxMode: typeof options?.sandboxMode === "string" ? options.sandboxMode : "docker",
          verifyOutput: true,
        },
        workflowPath:
          typeof options?.workflowPath === "string"
            ? options.workflowPath
            : ".github/workflows/security-scan.yml",
        createdAt: new Date().toISOString(),
        status: "active",
        runCount: 0,
      };
    },
  },
  {
    name: "weekly-retro",
    description: "Generate a weekly retrospective summarizing commits and quality trends",
    type: "schedule",
    create(options?: Record<string, unknown>): AutomationDefinition {
      return {
        id: generateId(),
        name: "weekly-retro",
        type: "schedule",
        config: {
          cron: typeof options?.cron === "string" ? options.cron : "0 9 * * 1",
          timezone: typeof options?.timezone === "string" ? options.timezone : "UTC",
          lookbackDays: typeof options?.lookbackDays === "number" ? options.lookbackDays : 7,
          outputFormat:
            typeof options?.outputFormat === "string" ? options.outputFormat : "markdown",
          postToSlack: options?.postToSlack === true,
        },
        agentMode: {
          prompt:
            "Generate a weekly retrospective for the past ${lookbackDays} days. Summarize: (1) commits and pull requests merged, (2) test coverage trends, (3) PDSE score trends, (4) top contributors, (5) open issues and blockers. Format as markdown.",
          model: typeof options?.model === "string" ? options.model : undefined,
          sandboxMode: typeof options?.sandboxMode === "string" ? options.sandboxMode : "host",
          verifyOutput: false,
        },
        workflowPath:
          typeof options?.workflowPath === "string"
            ? options.workflowPath
            : ".github/workflows/weekly-retro.yml",
        createdAt: new Date().toISOString(),
        status: "active",
        runCount: 0,
      };
    },
  },
];

export function getTemplate(name: string): AutomationTemplate | null {
  return BUILT_IN_TEMPLATES.find((t) => t.name === name) ?? null;
}

export function listTemplates(): AutomationTemplate[] {
  return [...BUILT_IN_TEMPLATES];
}
