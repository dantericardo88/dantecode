// ============================================================================
// @dantecode/automation-engine — Graph State Tests
// ============================================================================

import { describe, it, expect } from "vitest";
import {
  createChannel,
  initializeGraphState,
  updateChannel,
  applyStateUpdates,
  getStateSnapshot,
  getChannelValue,
  cloneGraphState,
  serializeGraphState,
  deserializeGraphState,
  validateStateUpdates,
  mergeStateUpdates,
  defineStateSchema,
  ChannelReducers,
} from "./workflow-graph-state.js";

describe("workflow-graph-state", () => {
  describe("createChannel", () => {
    it("should create channel with default value", () => {
      const channel = createChannel("test", { default: 42 });

      expect(channel.name).toBe("test");
      expect(channel.value).toBe(42);
      expect(channel.version).toBe(0);
    });

    it("should create channel with reducer", () => {
      const reducer = (a: number, b: number) => a + b;
      const channel = createChannel("sum", { default: 0, reducer });

      expect(channel.reducer).toBe(reducer);
    });
  });

  describe("initializeGraphState", () => {
    it("should initialize state from schema", () => {
      const schema = defineStateSchema({
        counter: { default: 0 },
        message: { default: "hello" },
        items: { default: [] as string[] },
      });

      const state = initializeGraphState(schema);

      expect(state.step).toBe(0);
      expect(state.channels.size).toBe(3);
      expect(getChannelValue(state, "counter")).toBe(0);
      expect(getChannelValue(state, "message")).toBe("hello");
      expect(getChannelValue(state, "items")).toEqual([]);
    });
  });

  describe("updateChannel", () => {
    it("should update channel value without reducer", () => {
      const channel = createChannel("test", { default: 10 });

      updateChannel(channel, 20);

      expect(channel.value).toBe(20);
      expect(channel.version).toBe(1);
    });

    it("should update channel value with reducer", () => {
      const channel = createChannel("sum", {
        default: 10,
        reducer: (a, b) => a + b,
      });

      updateChannel(channel, 5);

      expect(channel.value).toBe(15);
      expect(channel.version).toBe(1);
    });

    it("should increment version on each update", () => {
      const channel = createChannel("test", { default: 0 });

      updateChannel(channel, 1);
      updateChannel(channel, 2);
      updateChannel(channel, 3);

      expect(channel.version).toBe(3);
    });
  });

  describe("applyStateUpdates", () => {
    it("should apply partial updates to graph state", () => {
      const schema = defineStateSchema({
        x: { default: 0 },
        y: { default: 0 },
        z: { default: 0 },
      });

      const state = initializeGraphState(schema);

      applyStateUpdates(state, { x: 10, y: 20 });

      expect(getChannelValue(state, "x")).toBe(10);
      expect(getChannelValue(state, "y")).toBe(20);
      expect(getChannelValue(state, "z")).toBe(0);
      expect(state.step).toBe(1);
    });

    it("should throw on unknown channel", () => {
      const schema = defineStateSchema({
        valid: { default: 0 },
      });

      const state = initializeGraphState(schema);

      expect(() => {
        applyStateUpdates(state, { invalid: 42 } as any);
      }).toThrow("Channel 'invalid' not found");
    });
  });

  describe("getStateSnapshot", () => {
    it("should return typed state object", () => {
      interface TestState {
        counter: number;
        message: string;
        items: string[];
      }

      const schema = defineStateSchema<TestState>({
        counter: { default: 5 },
        message: { default: "test" },
        items: { default: ["a", "b"] },
      });

      const state = initializeGraphState(schema);
      const snapshot = getStateSnapshot<TestState>(state);

      expect(snapshot).toEqual({
        counter: 5,
        message: "test",
        items: ["a", "b"],
      });
    });
  });

  describe("cloneGraphState", () => {
    it("should deep clone graph state", () => {
      const schema = defineStateSchema({
        items: { default: ["a"] as string[] },
      });

      const state = initializeGraphState(schema);
      const clone = cloneGraphState(state);

      // Modify original
      const items = getChannelValue<string[]>(state, "items")!;
      items.push("b");

      // Clone should be unaffected
      const clonedItems = getChannelValue<string[]>(clone, "items");
      expect(clonedItems).toEqual(["a"]);
    });
  });

  describe("serializeGraphState / deserializeGraphState", () => {
    it("should round-trip state through JSON", () => {
      const schema = defineStateSchema({
        x: { default: 10 },
        y: { default: 20 },
      });

      const state = initializeGraphState(schema);
      applyStateUpdates(state, { x: 100 });

      const json = serializeGraphState(state);
      const restored = deserializeGraphState(json, schema);

      expect(getChannelValue(restored, "x")).toBe(100);
      expect(getChannelValue(restored, "y")).toBe(20);
      expect(restored.step).toBe(1);
    });

    it("should preserve channel versions", () => {
      const schema = defineStateSchema({
        counter: { default: 0 },
      });

      const state = initializeGraphState(schema);
      updateChannel(state.channels.get("counter")!, 1);
      updateChannel(state.channels.get("counter")!, 2);

      const json = serializeGraphState(state);
      const restored = deserializeGraphState(json, schema);

      const channel = restored.channels.get("counter");
      expect(channel?.version).toBe(2);
    });
  });

  describe("validateStateUpdates", () => {
    it("should validate updates against schema", () => {
      const schema = defineStateSchema({
        valid: { default: 0 },
      });

      const result = validateStateUpdates({ valid: 42 }, schema);

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("should detect unknown channels", () => {
      const schema = defineStateSchema({
        valid: { default: 0 },
      });

      const result = validateStateUpdates({ unknown: 42 } as any, schema);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("Unknown channel 'unknown'");
    });
  });

  describe("mergeStateUpdates", () => {
    it("should merge multiple partial updates", () => {
      interface TestState {
        x?: number;
        y?: number;
        z?: number;
      }

      const updates: Partial<TestState>[] = [
        { x: 10 },
        { y: 20 },
        { x: 30, z: 40 },
      ];

      const merged = mergeStateUpdates(updates);

      expect(merged).toEqual({ x: 30, y: 20, z: 40 });
    });
  });

  describe("ChannelReducers", () => {
    it("lastValue should keep last value", () => {
      const result = ChannelReducers.lastValue(10, 20);
      expect(result).toBe(20);
    });

    it("append should append to array", () => {
      const result = ChannelReducers.append([1, 2], 3);
      expect(result).toEqual([1, 2, 3]);
    });

    it("append should handle array input", () => {
      const result = ChannelReducers.append([1, 2], [3, 4]);
      expect(result).toEqual([1, 2, 3, 4]);
    });

    it("merge should shallow merge objects", () => {
      const result = ChannelReducers.merge(
        { a: 1, b: 2 },
        { b: 3 },
      );
      expect(result).toEqual({ a: 1, b: 3 });
    });

    it("sum should add numbers", () => {
      const result = ChannelReducers.sum(10, 5);
      expect(result).toBe(15);
    });

    it("union should create set union", () => {
      const result = ChannelReducers.union(
        new Set([1, 2]),
        new Set([2, 3]),
      );
      expect(result).toEqual(new Set([1, 2, 3]));
    });

    it("union should handle array input", () => {
      const result = ChannelReducers.union(
        new Set([1, 2]),
        [2, 3],
      );
      expect(result).toEqual(new Set([1, 2, 3]));
    });
  });
});
