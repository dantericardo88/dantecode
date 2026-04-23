// ============================================================================
// packages/vscode/src/context-provider-sdk.ts
//
// External @mention provider SDK — lets MCP server authors and 3rd-party
// VSCode extension authors register custom @mention providers into DanteCode
// without forking the extension.
//
// Usage:
//   import { registerExternalProvider } from "@dantecode/vscode/context-provider-sdk";
//
//   registerExternalProvider({
//     name: "jira",
//     trigger: "@jira",
//     description: "Fetch JIRA ticket details",
//     async resolve(query, workspace) {
//       const ticket = await jiraClient.get(query);
//       return [{ label: `@jira:${query}`, content: ticket.description }];
//     },
//   });
// ============================================================================

import { globalContextRegistry } from "./context-provider.js";
import type { ContextProvider } from "./context-provider.js";

// ── SDK types ────────────────────────────────────────────────────────────────

export interface ExternalContextProvider {
  /** Short unique name, e.g. "jira" */
  name: string;
  /** @-trigger, e.g. "@jira". Must start with "@". Must be unique. */
  trigger: string;
  /** One-line description shown in the @-mention dropdown. */
  description: string;
  /**
   * Resolve a query against this provider.
   * @param query   The part after the colon in "@trigger:query"
   * @param workspace  Absolute path to the workspace root
   */
  resolve(
    query: string,
    workspace: string,
  ): Promise<Array<{ label: string; content: string }>> | Array<{ label: string; content: string }>;
}

// ── Internal registry ────────────────────────────────────────────────────────

const _externalProviders = new Map<string, ExternalContextProvider>();

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Register an external @mention provider.
 * Replaces any previously registered provider with the same trigger.
 */
export function registerExternalProvider(provider: ExternalContextProvider): void {
  if (!provider.trigger.startsWith("@")) {
    throw new Error(`External provider trigger must start with "@": ${provider.trigger}`);
  }
  _externalProviders.set(provider.trigger, provider);

  // Wrap as ContextProvider and register with the global registry
  const wrapped: ContextProvider = {
    name: provider.name,
    trigger: provider.trigger,
    description: provider.description,
    async resolve(query: string, workspace: string) {
      const items = await provider.resolve(query, workspace);
      return items.map((item) => ({
        type: "file" as const,
        label: item.label,
        content: item.content,
      }));
    },
  };

  globalContextRegistry.register(wrapped);
}

/**
 * Unregister an external provider by trigger.
 * Note: this removes it from the internal SDK registry.
 * The globalContextRegistry does not currently support removal — the provider
 * will stop returning results from the SDK map, but the trigger key remains
 * in the registry until the extension restarts.
 */
export function unregisterExternalProvider(trigger: string): void {
  _externalProviders.delete(trigger);

  // Re-register a no-op provider so the trigger returns empty results
  globalContextRegistry.register({
    name: `${trigger}-removed`,
    trigger,
    description: "(removed)",
    async resolve() {
      return [];
    },
  });
}

/**
 * List all currently registered external providers.
 */
export function listExternalProviders(): ExternalContextProvider[] {
  return Array.from(_externalProviders.values());
}
