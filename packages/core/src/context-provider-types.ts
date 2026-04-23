// Canonical shared context-provider types — no runtime dependencies, no vscode import.
// Consumed by @dantecode/codebase-index and CLI packages without touching the vscode extension.

export interface ContextItemUri {
  type: "file" | "url";
  value: string;
}

export interface ContextItem {
  /** Short identifier, e.g. "diff" or "src/app.ts" */
  name: string;
  /** One-line description for UI display */
  description: string;
  /** Text injected into the LLM prompt */
  content: string;
  /** Optional source location */
  uri?: ContextItemUri;
}

export interface ContextProviderExtras {
  /** Text typed after the @trigger colon, e.g. "@url:https://example.com" → query = "https://example.com" */
  query: string;
  /** Absolute path to the workspace root */
  workspaceRoot: string;
}

export interface IContextProvider {
  readonly name: string;
  readonly description: string;
  getContextItems(extras: ContextProviderExtras): Promise<ContextItem[]>;
}
