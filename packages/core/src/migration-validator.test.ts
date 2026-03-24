import { describe, it, expect } from "vitest";
import { MigrationValidator } from "./migration-validator.js";
import type { Migration, SchemaDefinition } from "./migration-validator.js";

const validator = new MigrationValidator();

const oldSchema: SchemaDefinition = {
  name: "UserConfig",
  version: "1.0.0",
  fields: [
    { name: "username", type: "string", required: true },
    { name: "email", type: "string", required: true },
    { name: "theme", type: "string", required: false },
  ],
};

describe("MigrationValidator", () => {
  it("dry-run detects issues when migration throws", () => {
    const broken: Migration = {
      name: "broken-migration",
      version: "2.0.0",
      up: () => {
        throw new Error("schema conflict");
      },
    };
    const result = validator.dryRun(broken);
    expect(result.wouldSucceed).toBe(false);
    expect(result.changes.some((c) => c.includes("threw an error"))).toBe(true);
  });

  it("dry-run captures changes from migration context", () => {
    const migration: Migration = {
      name: "add-avatar",
      version: "1.1.0",
      up: (ctx) => {
        ctx.changes.push("Added avatar field to user profiles");
        ctx.changes.push("Set default avatar for existing users");
      },
      down: (ctx) => {
        ctx.changes.push("Removed avatar field");
      },
    };
    const result = validator.dryRun(migration);
    expect(result.wouldSucceed).toBe(true);
    expect(result.changes.length).toBe(2);
    expect(result.changes[0]).toContain("avatar");
  });

  it("validates schema compatibility: detects removed fields as breaking", () => {
    const newSchema: SchemaDefinition = {
      name: "UserConfig",
      version: "2.0.0",
      fields: [
        { name: "username", type: "string", required: true },
        // email removed
        { name: "theme", type: "string", required: false },
      ],
    };
    const result = validator.validateSchema(oldSchema, newSchema);
    expect(result.compatible).toBe(false);
    expect(result.changes.some((c) => c.kind === "removed" && c.fieldName === "email")).toBe(true);
  });

  it("validates schema compatibility: additions are non-breaking", () => {
    const newSchema: SchemaDefinition = {
      name: "UserConfig",
      version: "1.1.0",
      fields: [
        ...oldSchema.fields,
        { name: "avatar", type: "string", required: false },
      ],
    };
    const result = validator.validateSchema(oldSchema, newSchema);
    expect(result.compatible).toBe(true);
    expect(result.changes.some((c) => c.kind === "added" && c.fieldName === "avatar")).toBe(true);
  });

  it("checkDataLoss detects high risk when required fields are dropped", () => {
    const newSchema: SchemaDefinition = {
      name: "UserConfig",
      version: "2.0.0",
      fields: [
        { name: "username", type: "string", required: true },
      ],
    };
    const migration: Migration = { name: "drop-fields", version: "2.0.0", up: () => {} };
    const risks = validator.checkDataLoss(migration, oldSchema, newSchema);
    expect(risks.some((r) => r.level === "high" && r.affectedEntity === "email")).toBe(true);
    expect(risks.some((r) => r.level === "medium" && r.affectedEntity === "theme")).toBe(true);
  });

  it("requireConfirmation returns true for destructive changes", () => {
    expect(validator.requireConfirmation([
      { level: "high", description: "drop", affectedEntity: "email", mitigation: "backup" },
    ])).toBe(true);
    expect(validator.requireConfirmation([
      { level: "low", description: "no rollback", affectedEntity: "migration", mitigation: "backup" },
    ])).toBe(false);
    expect(validator.requireConfirmation([])).toBe(false);
  });
});
