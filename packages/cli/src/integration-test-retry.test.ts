import { describe, it, expect, beforeEach } from 'vitest';
import { RetryDetector } from '@dantecode/core';

describe('Retry Detection Integration', () => {
  let detector: RetryDetector;

  beforeEach(() => {
    detector = new RetryDetector();
  });

  it('should detect STUCK after 5 similar drizzle-kit failures', () => {
    // Simulate the exact user bug: drizzle-kit fails 5+ times
    const toolCall = {
      name: 'Bash',
      args: { command: 'drizzle-kit generate' }
    };

    // Attempt 1-2: Should be OK
    expect(detector.detectLoop(toolCall, 'ENOENT')).toBe('OK');
    expect(detector.detectLoop(toolCall, 'ENOENT')).toBe('OK');

    // Attempt 3-4: Should be WARNING
    expect(detector.detectLoop(toolCall, 'ENOENT')).toBe('WARNING');
    expect(detector.detectLoop(toolCall, 'ENOENT')).toBe('WARNING');

    // Attempt 5+: Should be STUCK
    expect(detector.detectLoop(toolCall, 'ENOENT')).toBe('STUCK');

    // Verify we break the loop (would happen in tool-executor.ts)
    const similarCount = detector.getSimilarCount(toolCall);
    expect(similarCount).toBeGreaterThanOrEqual(5);
  });

  it('should detect semantic similarity for paraphrased retries', () => {
    // Different phrasing, same intent - should still detect
    detector.detectLoop({ name: 'Bash', args: { command: 'npm install drizzle-kit' } });
    detector.detectLoop({ name: 'Bash', args: { command: 'npm install drizzle-kit --force' } });
    detector.detectLoop({ name: 'Bash', args: { command: 'npm install drizzle-kit --legacy-peer-deps' } });
    detector.detectLoop({ name: 'Bash', args: { command: 'npm i drizzle-kit' } });

    const status = detector.detectLoop({ name: 'Bash', args: { command: 'npm install drizzle-kit' } });

    // Should detect WARNING (3+) due to semantic similarity
    expect(status).not.toBe('OK');
  });

  it('should not false-positive on legitimately different attempts', () => {
    // Different tools and approaches - should be OK
    detector.detectLoop({ name: 'Bash', args: { command: 'npm install' } });
    detector.detectLoop({ name: 'Write', args: { file_path: 'schema.ts', content: '...' } });
    detector.detectLoop({ name: 'Read', args: { file_path: 'package.json' } });
    detector.detectLoop({ name: 'Bash', args: { command: 'npm run build' } });

    const status = detector.detectLoop({ name: 'Edit', args: { file_path: 'config.ts' } });

    expect(status).toBe('OK');
  });
});
