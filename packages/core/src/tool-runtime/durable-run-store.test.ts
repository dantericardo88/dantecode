import { describe, expect, it } from "vitest";
import { DurableRunStore as RootDurableRunStore } from "../durable-run-store.js";
import {
  DurableRunStore as ToolRuntimeDurableRunStore,
  getDurableRunStore,
} from "./durable-run-store.js";

describe("tool-runtime DurableRunStore compatibility", () => {
  it("re-exports the live durable run store implementation", () => {
    expect(ToolRuntimeDurableRunStore).toBe(RootDurableRunStore);
  });

  it("provides a stable singleton helper", () => {
    const first = getDurableRunStore("/tmp/project-a");
    const second = getDurableRunStore("/tmp/project-b");

    expect(first).toBe(second);
    expect(first).toBeInstanceOf(RootDurableRunStore);
  });
});
