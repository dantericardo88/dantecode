import { describe, expect, it } from "vitest";
import {
  getReadOnlyToolDefinitionsPrompt,
  getToolDefinitionsPrompt,
} from "../agent-tools.js";

describe("agent tool prompt definitions", () => {
  it("read-only prompt advertises only read tools", () => {
    const prompt = getReadOnlyToolDefinitionsPrompt();

    expect(prompt).toContain("Read");
    expect(prompt).toContain("ListDir");
    expect(prompt).toContain("Glob");
    expect(prompt).toContain("Grep");
    expect(prompt).not.toContain("Write");
    expect(prompt).not.toContain("Edit");
    expect(prompt).not.toContain("Bash");
    expect(prompt).not.toContain("GitCommit");
    expect(prompt).not.toContain("GitPush");
  });

  it("full prompt still advertises edit and shell tools", () => {
    const prompt = getToolDefinitionsPrompt();

    expect(prompt).toContain("Write");
    expect(prompt).toContain("Edit");
    expect(prompt).toContain("Bash");
  });
});
