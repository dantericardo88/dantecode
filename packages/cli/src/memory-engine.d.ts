declare module "@dantecode/memory-engine" {
  export interface MemoryOrchestratorOptions {
    projectRoot?: string;
    similarityThreshold?: number;
    [key: string]: unknown;
  }
  export interface MemoryOrchestrator {
    initialize(): Promise<void>;
    memoryRecall(query: string, limit?: number): Promise<unknown[]>;
    memoryStore(key: string, value: string, sessionId?: string): Promise<void>;
    memoryPrune(): Promise<void>;
  }
  export function createMemoryOrchestrator(opts: MemoryOrchestratorOptions): MemoryOrchestrator;
}
