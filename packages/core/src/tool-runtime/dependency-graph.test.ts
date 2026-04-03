import { describe, expect, it } from "vitest";
import { DependencyGraph } from "./dependency-graph.js";

describe("DependencyGraph", () => {
  it("tracks ready dependencies by call id", () => {
    const graph = new DependencyGraph();
    graph.register("call-read");
    graph.register("call-write", ["call-read"]);

    expect(graph.inspect("call-write")).toMatchObject({
      ready: false,
      pending: ["call-read"],
      failed: [],
      missing: [],
      cycle: null,
    });

    graph.setState("call-read", "satisfied");

    expect(graph.inspect("call-write")).toMatchObject({
      ready: true,
      pending: [],
      failed: [],
      missing: [],
      cycle: null,
    });
  });

  it("surfaces failed and missing dependencies separately", () => {
    const graph = new DependencyGraph();
    graph.register("call-write", ["call-read", "call-fetch"]);
    graph.register("call-read");
    graph.setState("call-read", "failed");

    expect(graph.inspect("call-write")).toMatchObject({
      ready: false,
      pending: [],
      failed: ["call-read"],
      missing: ["call-fetch"],
      cycle: null,
    });
  });

  it("detects dependency cycles", () => {
    const graph = new DependencyGraph();
    graph.register("call-a", ["call-b"]);
    graph.register("call-b", ["call-c"]);
    graph.register("call-c", ["call-a"]);

    expect(graph.detectCycle("call-a")).toEqual(["call-a", "call-b", "call-c", "call-a"]);
    expect(graph.inspect("call-a").cycle).toEqual(["call-a", "call-b", "call-c", "call-a"]);
  });
});
