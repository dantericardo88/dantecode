# Clean Stream Renderer - Usage Examples

## Basic Usage

```typescript
import { StreamRenderer } from './stream-renderer.js';

// Create renderer with options
const renderer = new StreamRenderer({
  verbose: false,      // Hide raw JSON, show user-friendly messages
  silent: false,       // Enable console output
  reasoningTier: 'EXTENDED',  // Show reasoning tier badge
  thinkingBudget: 5000        // Show thinking budget
});

// Print header with tier and budget
renderer.printHeader();
// Output: DanteCode [EXTENDED] (5000 tokens)
```

## Tool Call Rendering

```typescript
// Instead of dumping 500 lines of code...
renderer.renderToolCall({
  name: 'Write',
  args: { file_path: 'src/schema.ts', content: '...' }
});
// Output: ℹ️  Creating src/schema.ts

renderer.renderToolCall({
  name: 'Bash',
  args: { command: 'npm test' }
});
// Output: ⏳ Running: npm test

// Verbose mode shows full details
const verboseRenderer = new StreamRenderer({ verbose: true });
verboseRenderer.renderToolCall({
  name: 'Edit',
  args: { file_path: 'src/lib.ts', old_string: 'old', new_string: 'new' }
});
// Output: [Edit] {
//   "file_path": "src/lib.ts",
//   "old_string": "old",
//   "new_string": "new"
// }
```

## Phase Management

```typescript
// Show phase transitions
renderer.renderPhaseTransition('Setup', 'Build');
// Output: ✨ Setup complete → Starting Build

// Track current phase
console.log(renderer.getCurrentPhase());
// Output: Build

// Get all phase statuses
const progress = renderer.getPhaseProgress();
console.log(progress.get('Setup'));
// Output: { status: 'complete' }
console.log(progress.get('Build'));
// Output: { status: 'active' }
```

## Retry and Error Handling

```typescript
// Show retry warnings with color coding
renderer.renderRetryWarning(2, 5);
// Output: 🔄 Retrying... (2/5)  [yellow]

renderer.renderRetryWarning(4, 5);
// Output: 🔄 Retrying... (4/5)  [red - critical]

// Show escalation notices
renderer.renderEscalation('Failed to install dependencies');
// Output: ⚠️  Failed to install dependencies - asking for help
```

## Progress Tracking

```typescript
// Show progress bars
renderer.renderProgress(3, 8, 'Phases');
// Output: 📊 Phases: ████████████░░░░░░░░░░░░░░░░░░░░ 38% (3/8)

renderer.renderProgress(8, 8, 'Complete');
// Output: 📊 Complete: ████████████████████████████████████████ 100% (8/8)
```

## Utility Messages

```typescript
// Success
renderer.renderSuccess('Build complete');
// Output: ✅ Build complete  [green]

// Error
renderer.renderError('Build failed');
// Output: ❌ Build failed  [red]

// Warning
renderer.renderWarning('Deprecated API');
// Output: ⚠️  Deprecated API  [yellow]

// Info
renderer.renderInfo('Processing files');
// Output: ℹ️  Processing files  [cyan]
```

## Silent Mode (Testing)

```typescript
const silentRenderer = new StreamRenderer({ silent: true });

silentRenderer.renderSuccess('This will not print');
silentRenderer.write('Buffered text');

// No console output, but text is buffered
console.log(silentRenderer.getFullText());
// Output: Buffered text
```

## Backward Compatibility

```typescript
// Old code still works - boolean constructor
const legacyRenderer = new StreamRenderer(true);  // silent mode
legacyRenderer.write('test');
// No output (silent mode)

const normalRenderer = new StreamRenderer(false);
normalRenderer.printHeader();
// Output: DanteCode
```

## Complete Example

```typescript
const renderer = new StreamRenderer({ 
  verbose: false,
  reasoningTier: 'MEDIUM' 
});

renderer.printHeader();

renderer.renderPhaseTransition('', 'Setup');
renderer.renderToolCall({ name: 'Write', args: { file_path: 'schema.ts' } });
renderer.renderToolCall({ name: 'Bash', args: { command: 'npm install' } });

renderer.renderPhaseTransition('Setup', 'Build');
renderer.renderToolCall({ name: 'Bash', args: { command: 'npm run build' } });
renderer.renderRetryWarning(1, 3);
renderer.renderToolCall({ name: 'Bash', args: { command: 'npm run build' } });
renderer.renderSuccess('Build succeeded on retry');

renderer.renderPhaseTransition('Build', 'Test');
renderer.renderProgress(5, 10, 'Tests');

renderer.renderPhaseTransition('Test', 'Complete');
renderer.renderSuccess('All phases complete');
```

Output:
```
DanteCode [MEDIUM]

✨  complete → Starting Setup

  ℹ️  Creating schema.ts
  ⏳ Running: npm install

✨ Setup complete → Starting Build

  ⏳ Running: npm run build
  🔄 Retrying... (1/3)
  ⏳ Running: npm run build
  ✅ Build succeeded on retry

✨ Build complete → Starting Test

📊 Tests: ████████████████████░░░░░░░░░░░░░░░░░░░░ 50% (5/10)

✨ Test complete → Starting Complete

  ✅ All phases complete
```
