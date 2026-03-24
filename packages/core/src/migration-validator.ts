// ============================================================================
// @dantecode/core — Migration Validator
// Dry-run simulation of migrations, schema compatibility checks, and
// data loss risk assessment before executing destructive operations.
// ============================================================================

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

/** Execution context provided to migration functions. */
export interface MigrationContext {
  /** Changes accumulated during the migration (for dry-run tracking). */
  changes: string[];
  /** Whether this is a dry-run (no actual mutations). */
  dryRun: boolean;
}

/** A migration definition with up/down operations. */
export interface Migration {
  /** Human-readable name for the migration. */
  name: string;
  /** Target version after migration. */
  version: string;
  /** Forward migration function. */
  up: (ctx: MigrationContext) => void;
  /** Optional rollback migration function. */
  down?: (ctx: MigrationContext) => void;
}

/** A field in a schema definition. */
export interface SchemaField {
  /** Field name. */
  name: string;
  /** Field type string (e.g., "string", "number", "boolean"). */
  type: string;
  /** Whether the field is required. */
  required: boolean;
}

/** A schema definition for compatibility checking. */
export interface SchemaDefinition {
  /** Schema name. */
  name: string;
  /** Schema version. */
  version: string;
  /** Fields in the schema. */
  fields: SchemaField[];
}

/** A detected schema change. */
export interface SchemaChange {
  /** Type of change. */
  kind: "added" | "removed" | "type-changed" | "required-changed";
  /** Field name affected. */
  fieldName: string;
  /** Description of the change. */
  description: string;
}

/** Schema compatibility result. */
export interface SchemaCompatibility {
  /** Whether the schemas are compatible (no breaking changes). */
  compatible: boolean;
  /** List of detected changes. */
  changes: SchemaChange[];
  /** Whether the migration is backward-compatible. */
  backwardCompatible: boolean;
}

/** Risk level for data loss. */
export type DataLossRiskLevel = "none" | "low" | "medium" | "high";

/** A data loss risk assessment. */
export interface DataLossRisk {
  /** Risk level. */
  level: DataLossRiskLevel;
  /** Description of the risk. */
  description: string;
  /** Affected field or entity. */
  affectedEntity: string;
  /** Mitigation suggestion. */
  mitigation: string;
}

/** Result of a dry-run migration. */
export interface DryRunResult {
  /** Whether the migration would succeed. */
  wouldSucceed: boolean;
  /** Changes that would be applied. */
  changes: string[];
  /** Data loss risks identified. */
  risks: DataLossRisk[];
  /** Schema changes identified. */
  schemaChanges: SchemaChange[];
}

// ────────────────────────────────────────────────────────────────────────────
// Validator
// ────────────────────────────────────────────────────────────────────────────

/**
 * Validates migrations before execution by:
 * 1. Dry-running migration functions to capture expected changes.
 * 2. Comparing schemas for compatibility.
 * 3. Assessing data loss risks.
 * 4. Determining if user confirmation is required.
 */
export class MigrationValidator {
  /**
   * Simulate a migration without side effects.
   * Runs the migration's `up` function with a dry-run context to capture
   * what changes it would make.
   */
  dryRun(
    migration: Migration,
    oldSchema?: SchemaDefinition,
    newSchema?: SchemaDefinition,
  ): DryRunResult {
    const ctx: MigrationContext = { changes: [], dryRun: true };
    let wouldSucceed = true;
    const risks: DataLossRisk[] = [];
    let schemaChanges: SchemaChange[] = [];

    try {
      migration.up(ctx);
    } catch {
      wouldSucceed = false;
      ctx.changes.push(`Migration "${migration.name}" threw an error during dry-run`);
    }

    // Schema compatibility check
    if (oldSchema && newSchema) {
      const compat = this.validateSchema(oldSchema, newSchema);
      schemaChanges = compat.changes;
      if (!compat.compatible) {
        wouldSucceed = false;
      }
    }

    // Data loss risk assessment
    if (oldSchema && newSchema) {
      const dataRisks = this.checkDataLoss(migration, oldSchema, newSchema);
      risks.push(...dataRisks);
    }

    // Check if migration has no rollback
    if (!migration.down) {
      risks.push({
        level: "low",
        description: "Migration has no rollback (down) function",
        affectedEntity: migration.name,
        mitigation: "Create a backup before running this migration",
      });
    }

    return { wouldSucceed, changes: ctx.changes, risks, schemaChanges };
  }

  /**
   * Compare two schema definitions for compatibility.
   * Breaking changes: field removal, type change on required field.
   * Non-breaking: field addition, optional -> required.
   */
  validateSchema(oldSchema: SchemaDefinition, newSchema: SchemaDefinition): SchemaCompatibility {
    const changes: SchemaChange[] = [];
    const oldFieldMap = new Map(oldSchema.fields.map((f) => [f.name, f]));
    const newFieldMap = new Map(newSchema.fields.map((f) => [f.name, f]));

    // Check for removed fields
    for (const [name, oldField] of oldFieldMap) {
      const newField = newFieldMap.get(name);
      if (!newField) {
        changes.push({
          kind: "removed",
          fieldName: name,
          description: `Field "${name}" (${oldField.type}) was removed`,
        });
        continue;
      }

      // Check for type changes
      if (oldField.type !== newField.type) {
        changes.push({
          kind: "type-changed",
          fieldName: name,
          description: `Field "${name}" type changed from ${oldField.type} to ${newField.type}`,
        });
      }

      // Check for required status changes
      if (oldField.required !== newField.required) {
        changes.push({
          kind: "required-changed",
          fieldName: name,
          description: `Field "${name}" required status changed from ${oldField.required} to ${newField.required}`,
        });
      }
    }

    // Check for added fields
    for (const [name, newField] of newFieldMap) {
      if (!oldFieldMap.has(name)) {
        changes.push({
          kind: "added",
          fieldName: name,
          description: `Field "${name}" (${newField.type}) was added${newField.required ? " as required" : ""}`,
        });
      }
    }

    const hasBreaking = changes.some((c) => c.kind === "removed" || c.kind === "type-changed");
    const backwardCompatible =
      !hasBreaking &&
      !changes.some(
        (c) => c.kind === "required-changed" && !oldFieldMap.get(c.fieldName)?.required,
      );

    return {
      compatible: !hasBreaking,
      changes,
      backwardCompatible,
    };
  }

  /**
   * Assess potential data loss risks for a migration.
   */
  checkDataLoss(
    _migration: Migration,
    oldSchema: SchemaDefinition,
    newSchema: SchemaDefinition,
  ): DataLossRisk[] {
    const risks: DataLossRisk[] = [];
    const newFieldNames = new Set(newSchema.fields.map((f) => f.name));

    for (const field of oldSchema.fields) {
      if (!newFieldNames.has(field.name)) {
        const level: DataLossRiskLevel = field.required ? "high" : "medium";
        risks.push({
          level,
          description: `${field.required ? "Required" : "Optional"} field "${field.name}" will be dropped`,
          affectedEntity: field.name,
          mitigation: `Back up "${field.name}" data before migration, or add a transformation step`,
        });
      }
    }

    // Check for type narrowing (e.g., string -> number might lose data)
    for (const oldField of oldSchema.fields) {
      const newField = newSchema.fields.find((f) => f.name === oldField.name);
      if (newField && oldField.type !== newField.type) {
        risks.push({
          level: "medium",
          description: `Field "${oldField.name}" type changes from ${oldField.type} to ${newField.type}`,
          affectedEntity: oldField.name,
          mitigation: `Ensure all "${oldField.name}" values are convertible to ${newField.type}`,
        });
      }
    }

    return risks;
  }

  /**
   * Determine if user confirmation is required based on risks.
   * Returns true if any destructive changes are detected.
   */
  requireConfirmation(risks: DataLossRisk[]): boolean {
    return risks.some((r) => r.level === "high" || r.level === "medium");
  }
}
