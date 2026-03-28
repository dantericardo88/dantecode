// Generate stub .d.ts file for dante-sandbox package
// This avoids circular dependency issues while satisfying TypeScript's module resolution

import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const stubContent = `// Auto-generated stub declaration file for @dantecode/dante-sandbox

export class DanteSandbox {
  static setup(options?: any): Promise<void>;
  static execute(request: any): Promise<any>;
  static teardown(): Promise<void>;
  static getEngine(): any;
}

export class SandboxEngine {
  constructor(config?: any);
  execute(request: any): Promise<any>;
  teardown(): Promise<void>;
}

export class ExecutionProxy {
  constructor(engine: any);
  execute(request: any): Promise<any>;
}

export type ExecutionRequest = any;
export type ExecutionResult = any;
export type SandboxConfig = any;
`;

const outputPath = join(__dirname, '..', 'dist', 'index.d.ts');
writeFileSync(outputPath, stubContent, 'utf-8');
console.log('Generated stub index.d.ts');
