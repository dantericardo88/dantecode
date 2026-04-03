import { DurableRunStore } from "../durable-run-store.js";

let durableRunStoreSingleton: DurableRunStore | null = null;

export function getDurableRunStore(projectRoot: string): DurableRunStore {
  if (!durableRunStoreSingleton) {
    durableRunStoreSingleton = new DurableRunStore(projectRoot);
  }
  return durableRunStoreSingleton;
}

export { DurableRunStore };
