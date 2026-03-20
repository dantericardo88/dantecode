/**
 * tool-runtime/durable-run-store.ts
 *
 * Compatibility layer for callers that expect DurableRunStore under the
 * tool-runtime tree. The live implementation remains in ../durable-run-store.ts
 * where the CLI and public core API already depend on it.
 */

export { DurableRunStore } from '../durable-run-store.js';

import { DurableRunStore } from '../durable-run-store.js';

let globalDurableStore: DurableRunStore | undefined;

export function getDurableRunStore(projectRoot: string): DurableRunStore {
  if (!globalDurableStore) {
    globalDurableStore = new DurableRunStore(projectRoot);
  }

  return globalDurableStore;
}
