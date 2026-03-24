import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { CredentialVault } from "./credential-vault.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("CredentialVault — Encryption & Storage", () => {
  let vaultDir: string;
  let vault: CredentialVault;

  beforeEach(async () => {
    vaultDir = await mkdtemp(join(tmpdir(), "vault-test-"));
    vault = new CredentialVault({ vaultDir });
  });

  afterEach(async () => {
    await rm(vaultDir, { recursive: true, force: true }).catch(() => {});
  });

  it("stores and retrieves a credential", async () => {
    await vault.store("api-key", "sk-test-value-12345");
    const retrieved = await vault.retrieve("api-key");
    expect(retrieved).toBe("sk-test-value-12345");
  });

  it("returns null for non-existent keys", async () => {
    const retrieved = await vault.retrieve("non-existent");
    expect(retrieved).toBeNull();
  });

  it("lists all stored credential names", async () => {
    await vault.store("key-a", "value-a");
    await vault.store("key-b", "value-b");
    const names = await vault.list();
    expect(names).toContain("key-a");
    expect(names).toContain("key-b");
    expect(names).toHaveLength(2);
  });

  it("removes a credential", async () => {
    await vault.store("to-remove", "secret");
    await vault.remove("to-remove");
    const retrieved = await vault.retrieve("to-remove");
    expect(retrieved).toBeNull();
    const names = await vault.list();
    expect(names).not.toContain("to-remove");
  });

  it("overwrites existing credential with same name", async () => {
    await vault.store("overwrite-key", "original");
    await vault.store("overwrite-key", "updated");
    const retrieved = await vault.retrieve("overwrite-key");
    expect(retrieved).toBe("updated");
    const names = await vault.list();
    const count = names.filter((n) => n === "overwrite-key").length;
    expect(count).toBe(1);
  });

  it("handles empty vault gracefully", async () => {
    const names = await vault.list();
    expect(names).toEqual([]);
  });

  it("uses AES-256-GCM encryption (ciphertext differs from plaintext)", async () => {
    const plaintext = "super-secret-api-key-value";
    await vault.store("enc-test", plaintext);

    // Read raw vault file — should not contain plaintext
    const { readFile } = await import("node:fs/promises");
    const raw = await readFile(join(vaultDir, "vault.enc"), "utf8");
    expect(raw).not.toContain(plaintext);
    expect(raw).toContain("ciphertext");
    expect(raw).toContain("authTag");
    expect(raw).toContain("iv");
  });

  it("stores credentials with special characters", async () => {
    const specialValue = 'p@$$w0rd!#%^&*()_+{}|:"<>?';
    await vault.store("special", specialValue);
    const retrieved = await vault.retrieve("special");
    expect(retrieved).toBe(specialValue);
  });

  it("handles unicode credential values", async () => {
    const unicodeValue = "password-with-unicode-characters";
    await vault.store("unicode-key", unicodeValue);
    const retrieved = await vault.retrieve("unicode-key");
    expect(retrieved).toBe(unicodeValue);
  });

  it("multiple vault instances share the same data file", async () => {
    await vault.store("shared-key", "shared-value");
    const vault2 = new CredentialVault({ vaultDir });
    const retrieved = await vault2.retrieve("shared-key");
    expect(retrieved).toBe("shared-value");
  });
});
