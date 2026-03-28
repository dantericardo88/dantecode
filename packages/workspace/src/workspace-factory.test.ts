// ============================================================================
// @dantecode/workspace — WorkspaceFactory Tests
// ============================================================================

import { describe, it, expect } from "vitest";
import { WorkspaceFactory, createLocalWorkspace, createContainerWorkspace, createRemoteWorkspace } from "./workspace-factory.js";
import { LocalWorkspace } from "./local-workspace.js";
import { ContainerWorkspace } from "./container-workspace.js";
import { RemoteWorkspace } from "./remote-workspace.js";
import type { WorkspaceConfig } from "./types.js";

describe("WorkspaceFactory", () => {
  describe("create", () => {
    it("should create LocalWorkspace", () => {
      const config: WorkspaceConfig = {
        id: "test-local",
        type: "local",
        basePath: "/tmp/test",
      };

      const workspace = WorkspaceFactory.create(config);

      expect(workspace).toBeInstanceOf(LocalWorkspace);
      expect(workspace.id).toBe("test-local");
      expect(workspace.type).toBe("local");
    });

    it("should create ContainerWorkspace", () => {
      const config: WorkspaceConfig = {
        id: "test-container",
        type: "container",
        basePath: "/workspace",
        image: "ubuntu:latest",
      };

      const workspace = WorkspaceFactory.create(config);

      expect(workspace).toBeInstanceOf(ContainerWorkspace);
      expect(workspace.id).toBe("test-container");
      expect(workspace.type).toBe("container");
    });

    it("should create RemoteWorkspace", () => {
      const config: WorkspaceConfig = {
        id: "test-remote",
        type: "remote",
        basePath: "/home/user/workspace",
        host: "example.com",
      };

      const workspace = WorkspaceFactory.create(config);

      expect(workspace).toBeInstanceOf(RemoteWorkspace);
      expect(workspace.id).toBe("test-remote");
      expect(workspace.type).toBe("remote");
    });

    it("should create ContainerWorkspace for hybrid type", () => {
      const config: WorkspaceConfig = {
        id: "test-hybrid",
        type: "hybrid",
        basePath: "/workspace",
        image: "node:18",
      };

      const workspace = WorkspaceFactory.create(config);

      expect(workspace).toBeInstanceOf(ContainerWorkspace);
    });

    it("should throw error for unknown type", () => {
      const config = {
        id: "test-unknown",
        type: "unknown",
        basePath: "/tmp/test",
      } as any;

      expect(() => WorkspaceFactory.create(config)).toThrow("Unknown workspace type");
    });

    it("should validate config has id", () => {
      const config = {
        type: "local",
        basePath: "/tmp/test",
      } as any;

      expect(() => WorkspaceFactory.create(config)).toThrow("must have an 'id'");
    });

    it("should validate config has type", () => {
      const config = {
        id: "test",
        basePath: "/tmp/test",
      } as any;

      expect(() => WorkspaceFactory.create(config)).toThrow("must have a 'type'");
    });

    it("should validate config has basePath", () => {
      const config = {
        id: "test",
        type: "local",
      } as any;

      expect(() => WorkspaceFactory.create(config)).toThrow("must have a 'basePath'");
    });

    it("should validate container config has image", () => {
      const config: WorkspaceConfig = {
        id: "test-container",
        type: "container",
        basePath: "/workspace",
      };

      expect(() => WorkspaceFactory.create(config)).toThrow("requires 'image'");
    });

    it("should validate remote config has host", () => {
      const config: WorkspaceConfig = {
        id: "test-remote",
        type: "remote",
        basePath: "/home/user",
      };

      expect(() => WorkspaceFactory.create(config)).toThrow("requires 'host'");
    });
  });

  describe("createAuto", () => {
    it("should detect container type from image", () => {
      const workspace = WorkspaceFactory.createAuto({
        id: "auto-container",
        basePath: "/workspace",
        image: "ubuntu:latest",
      });

      expect(workspace.type).toBe("container");
    });

    it("should detect remote type from host", () => {
      const workspace = WorkspaceFactory.createAuto({
        id: "auto-remote",
        basePath: "/home/user",
        host: "example.com",
      });

      expect(workspace.type).toBe("remote");
    });

    it("should detect container type from sandboxed flag", () => {
      const workspace = WorkspaceFactory.createAuto({
        id: "auto-sandboxed",
        basePath: "/workspace",
        sandboxed: true,
        image: "node:18",
      });

      expect(workspace.type).toBe("container");
    });

    it("should default to local type", () => {
      const workspace = WorkspaceFactory.createAuto({
        id: "auto-local",
        basePath: "/tmp/test",
      });

      expect(workspace.type).toBe("local");
    });
  });

  describe("createMultiple", () => {
    it("should create multiple workspaces", () => {
      const configs: WorkspaceConfig[] = [
        { id: "ws1", type: "local", basePath: "/tmp/ws1" },
        { id: "ws2", type: "local", basePath: "/tmp/ws2" },
        { id: "ws3", type: "local", basePath: "/tmp/ws3" },
      ];

      const workspaces = WorkspaceFactory.createMultiple(configs);

      expect(workspaces).toHaveLength(3);
      expect(workspaces[0].id).toBe("ws1");
      expect(workspaces[1].id).toBe("ws2");
      expect(workspaces[2].id).toBe("ws3");
    });

    it("should create empty array for no configs", () => {
      const workspaces = WorkspaceFactory.createMultiple([]);

      expect(workspaces).toHaveLength(0);
    });
  });

  describe("Convenience functions", () => {
    it("createLocalWorkspace should work", () => {
      const workspace = createLocalWorkspace("test", "/tmp/test");

      expect(workspace).toBeInstanceOf(LocalWorkspace);
      expect(workspace.id).toBe("test");
      expect(workspace.type).toBe("local");
    });

    it("createContainerWorkspace should work", () => {
      const workspace = createContainerWorkspace("test", "/workspace", "ubuntu:latest");

      expect(workspace).toBeInstanceOf(ContainerWorkspace);
      expect(workspace.id).toBe("test");
      expect(workspace.type).toBe("container");
    });

    it("createRemoteWorkspace should work", () => {
      const workspace = createRemoteWorkspace("test", "/home/user", "example.com");

      expect(workspace).toBeInstanceOf(RemoteWorkspace);
      expect(workspace.id).toBe("test");
      expect(workspace.type).toBe("remote");
    });

    it("should accept additional options", () => {
      const workspace = createLocalWorkspace("test", "/tmp/test", {
        env: { FOO: "bar" },
        metadata: { custom: "data" },
      });

      expect(workspace.config.env).toEqual({ FOO: "bar" });
      expect(workspace.config.metadata).toEqual({ custom: "data" });
    });
  });
});
