import type { IContextProvider } from "./context-provider-types.js";

export class ContextProviderRegistry {
  private readonly _providers = new Map<string, IContextProvider>();

  register(provider: IContextProvider): void {
    this._providers.set(provider.name, provider);
  }

  unregister(name: string): void {
    this._providers.delete(name);
  }

  getProvider(name: string): IContextProvider | undefined {
    return this._providers.get(name);
  }

  listProviders(): IContextProvider[] {
    return Array.from(this._providers.values());
  }

  hasProvider(name: string): boolean {
    return this._providers.has(name);
  }
}

/** Module-level singleton for cross-package use (CLI, codebase-index, etc.) */
export const globalCoreRegistry = new ContextProviderRegistry();
