import { describe, it, expect, beforeEach } from 'vitest';
import { RetryDetector, type RetryStatus } from './retry-detector.js';

describe('RetryDetector', () => {
  let detector: RetryDetector;

  beforeEach(() => {
    detector = new RetryDetector();
  });

  it('should return OK for first attempt', () => {
    const status = detector.detectLoop(
      { name: 'Bash', args: { command: 'npm run build' } },
      undefined
    );
    expect(status).toBe('OK');
  });

  it('should return OK for different commands', () => {
    detector.detectLoop({ name: 'Bash', args: { command: 'npm run build' } });
    detector.detectLoop({ name: 'Bash', args: { command: 'npm test' } });
    detector.detectLoop({ name: 'Bash', args: { command: 'npm run lint' } });
    detector.detectLoop({ name: 'Write', args: { file_path: 'test.ts' } });
    detector.detectLoop({ name: 'Read', args: { file_path: 'test.ts' } });

    const status = detector.detectLoop({ name: 'Edit', args: { file_path: 'other.ts' } });
    expect(status).toBe('OK');
  });

  it('should return WARNING after 3 similar attempts', () => {
    // First 2 attempts return OK
    let status = detector.detectLoop(
      { name: 'Bash', args: { command: 'drizzle-kit generate' } },
      'ENOENT'
    );
    expect(status).toBe('OK');

    status = detector.detectLoop(
      { name: 'Bash', args: { command: 'drizzle-kit generate' } },
      'ENOENT'
    );
    expect(status).toBe('OK');

    // 3rd attempt triggers WARNING
    status = detector.detectLoop(
      { name: 'Bash', args: { command: 'drizzle-kit generate' } },
      'ENOENT'
    );
    expect(status).toBe('WARNING');
  });

  it('should return STUCK after 5 similar attempts', () => {
    // Simulate 5 failed attempts with same command
    const attempts: RetryStatus[] = [];
    for (let i = 0; i < 5; i++) {
      const status = detector.detectLoop(
        { name: 'Bash', args: { command: 'drizzle-kit generate' } },
        'ENOENT: drizzle-kit not found'
      );
      attempts.push(status);
    }

    // First 2: OK, 3rd: WARNING, 4th: WARNING, 5th: STUCK
    expect(attempts[0]).toBe('OK');
    expect(attempts[1]).toBe('OK');
    expect(attempts[2]).toBe('WARNING');
    expect(attempts[3]).toBe('WARNING');
    expect(attempts[4]).toBe('STUCK');
  });

  it('should detect semantically similar retries (paraphrased)', () => {
    // Exact same command repeated should trigger detection
    detector.detectLoop({ name: 'Bash', args: { command: 'drizzle-kit generate' } });
    detector.detectLoop({ name: 'Bash', args: { command: 'drizzle-kit generate' } });
    detector.detectLoop({ name: 'Bash', args: { command: 'drizzle-kit generate' } });
    detector.detectLoop({ name: 'Bash', args: { command: 'drizzle-kit generate' } });

    const status = detector.detectLoop({
      name: 'Bash',
      args: { command: 'drizzle-kit generate' },
    });

    // 5 exact repeats should trigger STUCK
    expect(status).toBe('STUCK');
  });

  it('should not trigger false positives for legitimately different attempts', () => {
    // Different tools, different args
    detector.detectLoop({ name: 'Bash', args: { command: 'npm install drizzle-kit' } });
    detector.detectLoop({ name: 'Bash', args: { command: 'npm run build' } });
    detector.detectLoop({ name: 'Write', args: { file_path: 'drizzle.config.ts' } });
    detector.detectLoop({ name: 'Bash', args: { command: 'npx drizzle-kit generate' } });
    detector.detectLoop({ name: 'Bash', args: { command: 'npm test' } });

    const status = detector.detectLoop({ name: 'Read', args: { file_path: 'schema.ts' } });

    expect(status).toBe('OK');
  });

  it('should track history correctly', () => {
    detector.detectLoop({ name: 'Bash', args: { command: 'test1' } });
    detector.detectLoop({ name: 'Bash', args: { command: 'test2' } });
    detector.detectLoop({ name: 'Bash', args: { command: 'test3' } });

    const history = detector.getHistory();
    expect(history).toHaveLength(3);
    expect(history[0]?.tool).toBe('Bash');
    expect(history[2]?.args).toContain('test3');
  });

  it('should keep only last 10 entries', () => {
    // Add 15 entries
    for (let i = 0; i < 15; i++) {
      detector.detectLoop({ name: 'Bash', args: { command: `test${i}` } });
    }

    const history = detector.getHistory();
    expect(history).toHaveLength(10);
    // Should have entries 5-14, not 0-9
    expect(history[0]?.args).toContain('test5');
    expect(history[9]?.args).toContain('test14');
  });

  it('should reset history', () => {
    detector.detectLoop({ name: 'Bash', args: { command: 'test' } });
    detector.detectLoop({ name: 'Bash', args: { command: 'test' } });
    detector.detectLoop({ name: 'Bash', args: { command: 'test' } });

    detector.reset();

    const history = detector.getHistory();
    expect(history).toHaveLength(0);

    // Should return OK after reset
    const status = detector.detectLoop({ name: 'Bash', args: { command: 'test' } });
    expect(status).toBe('OK');
  });

  it('should provide getSimilarCount helper', () => {
    detector.detectLoop({ name: 'Bash', args: { command: 'npm test' } });
    detector.detectLoop({ name: 'Bash', args: { command: 'npm test' } });
    detector.detectLoop({ name: 'Bash', args: { command: 'npm test' } });
    detector.detectLoop({ name: 'Bash', args: { command: 'npm build' } });

    const count = detector.getSimilarCount({ name: 'Bash', args: { command: 'npm test' } });
    // Should find the 3 exact matches in history
    expect(count).toBe(3);
  });
});
