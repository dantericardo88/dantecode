// Generate stub .d.ts file for sandbox package
// This avoids circular dependency issues while satisfying TypeScript's module resolution

import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const stubContent = `// Auto-generated stub declaration file
// TypeScript consumers use this with skipLibCheck: true
// Real type-checking happens at source level within the package

export * from '../src/index.js';
`;

const outputPath = join(__dirname, '..', 'dist', 'index.d.ts');
writeFileSync(outputPath, stubContent, 'utf-8');
console.log('Generated stub index.d.ts');
