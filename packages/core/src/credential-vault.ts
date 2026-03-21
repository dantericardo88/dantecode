// ============================================================================
// @dantecode/core — Credential Vault
// AES-256-GCM encrypted key store. API keys stored at rest, never in plaintext.
// ============================================================================

import { randomBytes, createCipheriv, createDecipheriv, pbkdf2Sync } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

interface VaultEntry {
  name: string;
  iv: string; // hex
  authTag: string; // hex
  ciphertext: string; // hex
}

interface VaultFile {
  version: 1;
  entries: VaultEntry[];
}

const ALGORITHM = "aes-256-gcm" as const;
const KEY_LEN = 32;
const IV_LEN = 16;
const ITERATIONS = 100_000;

export interface CredentialVaultOptions {
  /** Override the vault directory (used in tests). Default: ~/.dantecode */
  vaultDir?: string;
}

export class CredentialVault {
  private readonly vaultPath: string;
  private readonly saltPath: string;

  constructor(opts: CredentialVaultOptions = {}) {
    const dir = opts.vaultDir ?? join(homedir(), ".dantecode");
    this.vaultPath = join(dir, "vault.enc");
    this.saltPath = join(dir, "vault.salt");
  }

  async store(name: string, value: string): Promise<void> {
    const entries = await this._loadEntries();
    const key = await this._getKey();
    const iv = randomBytes(IV_LEN);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();

    // Remove existing entry with same name
    const filtered = entries.filter((e) => e.name !== name);
    filtered.push({
      name,
      iv: iv.toString("hex"),
      authTag: authTag.toString("hex"),
      ciphertext: encrypted.toString("hex"),
    });

    await this._saveEntries(filtered);
  }

  async retrieve(name: string): Promise<string | null> {
    const entries = await this._loadEntries();
    const entry = entries.find((e) => e.name === name);
    if (!entry) return null;

    try {
      const key = await this._getKey();
      const iv = Buffer.from(entry.iv, "hex");
      const authTag = Buffer.from(entry.authTag, "hex");
      const ciphertext = Buffer.from(entry.ciphertext, "hex");
      const decipher = createDecipheriv(ALGORITHM, key, iv);
      decipher.setAuthTag(authTag);
      const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      return decrypted.toString("utf8");
    } catch {
      return null;
    }
  }

  async list(): Promise<string[]> {
    const entries = await this._loadEntries();
    return entries.map((e) => e.name);
  }

  async remove(name: string): Promise<void> {
    const entries = await this._loadEntries();
    const filtered = entries.filter((e) => e.name !== name);
    await this._saveEntries(filtered);
  }

  // -- Private helpers -------------------------------------------------------

  private async _getKey(): Promise<Buffer> {
    const passphrase = process.env["DANTECODE_VAULT_PASSPHRASE"] ?? "dantecode-default-vault-key";
    const salt = await this._getOrCreateSalt();
    return pbkdf2Sync(passphrase, salt, ITERATIONS, KEY_LEN, "sha256");
  }

  private async _getOrCreateSalt(): Promise<Buffer> {
    try {
      const hex = await readFile(this.saltPath, "utf8");
      return Buffer.from(hex.trim(), "hex");
    } catch {
      const salt = randomBytes(32);
      await mkdir(join(this.saltPath, ".."), { recursive: true });
      await writeFile(this.saltPath, salt.toString("hex"), "utf8");
      return salt;
    }
  }

  private async _loadEntries(): Promise<VaultEntry[]> {
    try {
      const raw = await readFile(this.vaultPath, "utf8");
      const file = JSON.parse(raw) as VaultFile;
      return file.entries ?? [];
    } catch {
      return [];
    }
  }

  private async _saveEntries(entries: VaultEntry[]): Promise<void> {
    await mkdir(join(this.vaultPath, ".."), { recursive: true });
    const file: VaultFile = { version: 1, entries };
    await writeFile(this.vaultPath, JSON.stringify(file, null, 2), "utf8");
  }
}
