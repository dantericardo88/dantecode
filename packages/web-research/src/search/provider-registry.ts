import type { SearchProvider } from "../types.js";
import { DuckDuckGoProvider } from "./duckduckgo.js";

export class SearchProviderRegistry {
  private providers = new Map<string, SearchProvider>();

  constructor() {
    this.register(new DuckDuckGoProvider());
  }

  register(provider: SearchProvider) {
    this.providers.set(provider.name, provider);
  }

  getProvider(name: string): SearchProvider | undefined {
    return this.providers.get(name);
  }

  listProviders(): string[] {
    return Array.from(this.providers.keys());
  }
}

export const globalProviderRegistry = new SearchProviderRegistry();
