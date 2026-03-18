import { isAbsolute, resolve, sep } from "node:path";
import type { SelfImprovementContext } from "@dantecode/config-types";

const DEFAULT_PROTECTED_ROOTS = [
  "packages/vscode",
  "packages/cli",
  "packages/danteforge",
  "packages/core",
  ".dantecode",
  "CONSTITUTION.md",
];

const CHAT_SELF_IMPROVEMENT_PATTERNS = [/\bself-upgrade\b/i, /\bimprove codebase\b/i];

export function getProtectedRoots(projectRoot: string): string[] {
  return DEFAULT_PROTECTED_ROOTS.map((root) => resolve(projectRoot, root));
}

export function isProtectedWriteTarget(filePath: string, projectRoot: string): boolean {
  const resolvedPath = resolveProjectPath(filePath, projectRoot);

  return getProtectedRoots(projectRoot).some(
    (protectedRoot) =>
      resolvedPath === protectedRoot || resolvedPath.startsWith(`${protectedRoot}${sep}`),
  );
}

export function createSelfImprovementContext(
  projectRoot: string,
  options: {
    workflowId: string;
    triggerCommand: string;
    allowedRoots?: string[];
    targetFiles?: string[];
    auditMetadata?: Record<string, unknown>;
  },
): SelfImprovementContext {
  return {
    enabled: true,
    workflowId: options.workflowId,
    triggerCommand: options.triggerCommand,
    allowedRoots: (options.allowedRoots ?? DEFAULT_PROTECTED_ROOTS).map((root) =>
      resolve(projectRoot, root),
    ),
    targetFiles: options.targetFiles,
    auditMetadata: options.auditMetadata,
  };
}

export function detectSelfImprovementContext(
  prompt: string,
  projectRoot: string,
): SelfImprovementContext | null {
  const trimmed = prompt.trim();

  if (/^\/autoforge\b/i.test(trimmed) && /\s--self-improve\b/i.test(trimmed)) {
    return createSelfImprovementContext(projectRoot, {
      workflowId: "autoforge-self-improve",
      triggerCommand: "/autoforge --self-improve",
    });
  }

  if (/^\/party\b/i.test(trimmed) && /\s--autoforge\b/i.test(trimmed)) {
    return createSelfImprovementContext(projectRoot, {
      workflowId: "party-autoforge",
      triggerCommand: "/party --autoforge",
    });
  }

  // DanteForge pipeline commands — explicitly authorized to modify DanteCode's
  // own source as part of the forge workflow. This catches /magic, /inferno,
  // /forge, /party (without --autoforge), /autoforge (without --self-improve), etc.
  if (
    /^\/(?:magic|inferno|blaze|ember|spark|forge|verify|ship|oss|harvest|party|autoforge)\b/i.test(
      trimmed,
    )
  ) {
    return createSelfImprovementContext(projectRoot, {
      workflowId: "danteforge-pipeline",
      triggerCommand: trimmed.split(/\s/)[0]!,
    });
  }

  if (CHAT_SELF_IMPROVEMENT_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return createSelfImprovementContext(projectRoot, {
      workflowId: "chat-self-improvement",
      triggerCommand: "chat-self-improvement",
    });
  }

  return null;
}

export function isSelfImprovementWriteAllowed(
  filePath: string,
  projectRoot: string,
  context?: SelfImprovementContext,
): boolean {
  if (!context?.enabled) {
    return false;
  }

  const resolvedPath = resolveProjectPath(filePath, projectRoot);
  return context.allowedRoots.some(
    (allowedRoot) =>
      resolvedPath === allowedRoot ||
      resolvedPath.startsWith(`${resolve(projectRoot, allowedRoot)}${sep}`),
  );
}

export function isRepoInternalCdChain(command: string, projectRoot: string): boolean {
  const trimmed = command.trim();
  const match = trimmed.match(/^cd\s+(.+?)\s*&&/i);
  if (!match?.[1]) {
    return false;
  }

  const destination = match[1].trim().replace(/^["']|["']$/g, "");
  if (destination === "." || destination === "./" || destination === projectRoot) {
    return false;
  }

  const resolvedDestination = resolveProjectPath(destination, projectRoot);
  return (
    resolvedDestination !== resolve(projectRoot) &&
    (resolvedDestination === resolve(projectRoot) ||
      resolvedDestination.startsWith(`${resolve(projectRoot)}${sep}`))
  );
}

function resolveProjectPath(filePath: string, projectRoot: string): string {
  return isAbsolute(filePath) ? filePath : resolve(projectRoot, filePath);
}
