import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseSlashCommand, buildSlashPrompt, listSlashCommands, SLASH_COMMANDS } from './slash-commands.js';

// Mock child_process for runStreaming tests
describe('slash-commands', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('parseSlashCommand', () => {
    it('returns null for non-slash input', () => {
      // parser does input.trim() before the leading-slash check, so a
      // string with no slash at all is the only true non-match. Leading
      // whitespace is tolerated by design (better paste-from-chat UX).
      expect(parseSlashCommand('hello')).toBeNull();
      expect(parseSlashCommand('')).toBeNull();
      expect(parseSlashCommand('   ')).toBeNull();
    });

    it('parses simple commands without args', () => {
      const result = parseSlashCommand('/fix');
      expect(result).not.toBeNull();
      expect(result!.command.name).toBe('fix');
      expect(result!.args).toBe('');
    });

    it('parses commands with args', () => {
      const result = parseSlashCommand('/score --full');
      expect(result!.command.name).toBe('score');
      expect(result!.args).toBe('--full');
    });

    it('handles case-insensitivity', () => {
      expect(parseSlashCommand('/FIX')).not.toBeNull();
      expect(parseSlashCommand('/ScOrE foo')).not.toBeNull();
    });

    it('returns null for unknown commands', () => {
      expect(parseSlashCommand('/fake')).toBeNull();
    });
  });

  describe('buildSlashPrompt', () => {
    const mockCommand = {
      name: 'test',
      buildPrompt: vi.fn((sel, path, arg) => `Prompt: ${sel} | ${path} | ${arg || ''}`),
    } as any;

    it('builds prompt with selection and file', () => {
      const prompt = buildSlashPrompt(mockCommand, 'selected code', '/path/file.ts', 'extra');
      expect(prompt).toBe('Prompt: selected code | /path/file.ts | extra');
    });

    it('handles empty selection', () => {
      buildSlashPrompt(mockCommand, '', '', '');
      expect(mockCommand.buildPrompt).toHaveBeenCalledWith('', '', '');
    });
  });

  describe('listSlashCommands', () => {
    it('returns all commands', () => {
      const cmds = listSlashCommands();
      expect(cmds).toHaveLength(SLASH_COMMANDS.length);
      expect(cmds[0]?.name).toBe('fix');
    });
  });

  // Note: runStreaming requires mocking child_process.spawn which is complex
  // Full integration test deferred to e2e suite
});
