// ============================================================================
// @dantecode/workspace — Workspace Factory
// ============================================================================

import type { Workspace } from "./workspace.js";
import { LocalWorkspace } from "./local-workspace.js";
import { ContainerWorkspace } from "./container-workspace.js";
import { RemoteWorkspace } from "./remote-workspace.js";
import type { WorkspaceConfig, WorkspaceType } from "./types.js";

/**
 * Factory for creating workspace instances based on type.
 * Provides type-safe workspace creation and validation.
 */
export class WorkspaceFactory {
  /**
   * Create a workspace instance from configuration.
   */
  static create(config: WorkspaceConfig): Workspace {
    this._validateConfig(config);

    switch (config.type) {
      case "local":
        return new LocalWorkspace(config);

      case "container":
        return new ContainerWorkspace(config);

      case "remote":
        return new RemoteWorkspace(config);

      case "hybrid":
        // Hybrid workspaces use container with local file sync
        // For now, default to container behavior
        return new ContainerWorkspace(config);

      default:
        throw new Error(`Unknown workspace type: ${(config as any).type}`);
    }
  }

  /**
   * Create a workspace with auto-detection based on environment.
   * Falls back to local if no special requirements detected.
   */
  static createAuto(config: Omit<WorkspaceConfig, "type">): Workspace {
    const type = this._detectType(config);
    return this.create({ ...config, type });
  }

  /**
   * Create multiple workspaces from configurations.
   */
  static createMultiple(configs: WorkspaceConfig[]): Workspace[] {
    return configs.map((config) => this.create(config));
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────────

  private static _validateConfig(config: WorkspaceConfig): void {
    if (!config.id) {
      throw new Error("Workspace config must have an 'id'");
    }

    if (!config.type) {
      throw new Error("Workspace config must have a 'type'");
    }

    if (!config.basePath) {
      throw new Error("Workspace config must have a 'basePath'");
    }

    // Type-specific validation
    switch (config.type) {
      case "container":
        if (!config.image) {
          throw new Error("Container workspace requires 'image' in config");
        }
        break;

      case "remote":
        if (!config.host) {
          throw new Error("Remote workspace requires 'host' in config");
        }
        break;
    }
  }

  private static _detectType(config: Omit<WorkspaceConfig, "type">): WorkspaceType {
    // If container image specified, use container
    if (config.image) {
      return "container";
    }

    // If remote host specified, use remote
    if (config.host) {
      return "remote";
    }

    // If sandboxed flag set, use container
    if (config.sandboxed) {
      return "container";
    }

    // Default to local
    return "local";
  }
}

/**
 * Create a local workspace with sensible defaults.
 */
export function createLocalWorkspace(
  id: string,
  basePath: string,
  options?: Partial<WorkspaceConfig>
): Workspace {
  return WorkspaceFactory.create({
    id,
    type: "local",
    basePath,
    ...options,
  });
}

/**
 * Create a container workspace with sensible defaults.
 */
export function createContainerWorkspace(
  id: string,
  basePath: string,
  image: string,
  options?: Partial<WorkspaceConfig>
): Workspace {
  return WorkspaceFactory.create({
    id,
    type: "container",
    basePath,
    image,
    ...options,
  });
}

/**
 * Create a remote workspace with sensible defaults.
 */
export function createRemoteWorkspace(
  id: string,
  basePath: string,
  host: string,
  options?: Partial<WorkspaceConfig>
): Workspace {
  return WorkspaceFactory.create({
    id,
    type: "remote",
    basePath,
    host,
    ...options,
  });
}
