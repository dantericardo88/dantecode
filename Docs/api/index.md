# DanteCode API Documentation

## Core Classes
- `DanteCode`: Main agent class.
- `PDSEVerifier`: Quality gate.

## Methods
- `run(task: string)`: Execute task.
- `verify(output: any)`: Check quality.

## Examples
```typescript
import { DanteCode } from '@dantecode/core';
const dc = new DanteCode();
await dc.run('build app');
```