// ============================================================================
// @dantecode/core — Credential Vault Tests
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CredentialVault } from './credential-vault.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'vault-test-'));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('CredentialVault', () => {
  it('store() then retrieve() roundtrip returns original value', async () => {
    const vault = new CredentialVault({ vaultDir: tmpDir });
    await vault.store('ANTHROPIC_API_KEY', 'sk-ant-test-secret-value');
    const result = await vault.retrieve('ANTHROPIC_API_KEY');
    expect(result).toBe('sk-ant-test-secret-value');
  });

  it('retrieve() for non-existent key returns null', async () => {
    const vault = new CredentialVault({ vaultDir: tmpDir });
    const result = await vault.retrieve('NONEXISTENT_KEY');
    expect(result).toBeNull();
  });

  it('list() returns array of stored names (not values)', async () => {
    const vault = new CredentialVault({ vaultDir: tmpDir });
    await vault.store('API_KEY_A', 'value-a');
    await vault.store('API_KEY_B', 'value-b');
    const names = await vault.list();
    expect(names).toContain('API_KEY_A');
    expect(names).toContain('API_KEY_B');
    expect(names).not.toContain('value-a');
    expect(names).not.toContain('value-b');
  });

  it('remove() deletes an entry', async () => {
    const vault = new CredentialVault({ vaultDir: tmpDir });
    await vault.store('TO_REMOVE', 'sensitive-value');
    expect(await vault.retrieve('TO_REMOVE')).toBe('sensitive-value');
    await vault.remove('TO_REMOVE');
    expect(await vault.retrieve('TO_REMOVE')).toBeNull();
  });

  it('remove() on non-existent key does not throw', async () => {
    const vault = new CredentialVault({ vaultDir: tmpDir });
    await expect(vault.remove('DOES_NOT_EXIST')).resolves.toBeUndefined();
  });

  it('store() twice with same name yields only one entry and retrieve() returns latest value', async () => {
    const vault = new CredentialVault({ vaultDir: tmpDir });
    await vault.store('MY_KEY', 'first-value');
    await vault.store('MY_KEY', 'second-value');
    const names = await vault.list();
    const keyCount = names.filter((n) => n === 'MY_KEY').length;
    expect(keyCount).toBe(1);
    const result = await vault.retrieve('MY_KEY');
    expect(result).toBe('second-value');
  });

  it('encrypted vault file does not contain plaintext value', async () => {
    const vault = new CredentialVault({ vaultDir: tmpDir });
    const secret = 'super-secret-api-key-12345';
    await vault.store('SECRET_KEY', secret);
    const vaultFilePath = join(tmpDir, 'vault.enc');
    const rawContent = await readFile(vaultFilePath, 'utf8');
    expect(rawContent).not.toContain(secret);
    const secretHex = Buffer.from(secret, 'utf8').toString('hex');
    expect(rawContent).not.toContain(secretHex);
  });

  it('list() on empty vault returns empty array', async () => {
    const vault = new CredentialVault({ vaultDir: tmpDir });
    const names = await vault.list();
    expect(names).toEqual([]);
  });

  it('multiple keys: list() returns all names', async () => {
    const vault = new CredentialVault({ vaultDir: tmpDir });
    const keys = ['KEY_ONE', 'KEY_TWO', 'KEY_THREE', 'KEY_FOUR'];
    for (const key of keys) {
      await vault.store(key, `value-for-${key}`);
    }
    const names = await vault.list();
    expect(names).toHaveLength(keys.length);
    for (const key of keys) {
      expect(names).toContain(key);
    }
  });

  it('store() creates vault directory if it does not exist', async () => {
    const nestedDir = join(tmpDir, 'nested', 'vault-dir');
    const vault = new CredentialVault({ vaultDir: nestedDir });
    await expect(vault.store('NEW_KEY', 'new-value')).resolves.toBeUndefined();
    const result = await vault.retrieve('NEW_KEY');
    expect(result).toBe('new-value');
  });

  it('vault file is valid JSON with version field', async () => {
    const vault = new CredentialVault({ vaultDir: tmpDir });
    await vault.store('JSON_TEST', 'json-value');
    const vaultFilePath = join(tmpDir, 'vault.enc');
    const rawContent = await readFile(vaultFilePath, 'utf8');
    const parsed = JSON.parse(rawContent) as { version: number; entries: unknown[] };
    expect(parsed.version).toBe(1);
    expect(Array.isArray(parsed.entries)).toBe(true);
    expect(parsed.entries).toHaveLength(1);
  });

  it('each stored entry has iv, authTag, and ciphertext hex fields', async () => {
    const vault = new CredentialVault({ vaultDir: tmpDir });
    await vault.store('HEX_CHECK', 'hex-value');
    const vaultFilePath = join(tmpDir, 'vault.enc');
    const rawContent = await readFile(vaultFilePath, 'utf8');
    const parsed = JSON.parse(rawContent) as {
      entries: Array<{ name: string; iv: string; authTag: string; ciphertext: string }>;
    };
    const entry = parsed.entries[0]!;
    expect(entry.name).toBe('HEX_CHECK');
    const hexRe = /^[0-9a-f]+$/i;
    expect(hexRe.test(entry.iv)).toBe(true);
    expect(hexRe.test(entry.authTag)).toBe(true);
    expect(hexRe.test(entry.ciphertext)).toBe(true);
  });

  it('two vault instances with same dir share the same stored values', async () => {
    const vault1 = new CredentialVault({ vaultDir: tmpDir });
    const vault2 = new CredentialVault({ vaultDir: tmpDir });
    await vault1.store('SHARED_KEY', 'shared-value');
    const result = await vault2.retrieve('SHARED_KEY');
    expect(result).toBe('shared-value');
  });
});
