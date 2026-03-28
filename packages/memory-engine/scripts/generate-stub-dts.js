// Generate stub .d.ts file for memory-engine package
// This avoids circular dependency issues while satisfying TypeScript's module resolution

import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const stubContent = `// Auto-generated stub declaration file for @dantecode/memory-engine

export class MemoryOrchestrator {
  constructor(options?: any);
  initialize(): Promise<void>;
  recall(query: string, limit?: number): Promise<any[]>;
  store(key: string, value: any, organ?: string): Promise<void>;
  summarize(sessionId: string): Promise<void>;
  prune(): Promise<void>;
}

export function createMemoryOrchestrator(options?: any): MemoryOrchestrator;
export function getGlobalLogger(options?: any): any;

export type MemoryEntry = any;
export type MemoryOrgan = any;
`;

const outputPath = join(__dirname, '..', 'dist', 'index.d.ts');
writeFileSync(outputPath, stubContent, 'utf-8');
console.log('Generated stub index.d.ts');
