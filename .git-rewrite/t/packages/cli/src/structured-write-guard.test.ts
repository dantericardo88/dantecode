import { describe, it, expect } from "vitest";
import { validateStructuredContent } from "./structured-write-guard.js";

describe("Structured write guard", () => {
  // JSON delegation
  it("delegates .json files to JSON validator", () => {
    const r = validateStructuredContent('{"key": "value"}', "config.json");
    expect(r.valid).toBe(true);
    expect(r.format).toBe("json");
  });

  it("rejects invalid JSON", () => {
    const r = validateStructuredContent("{bad json}", "package.json");
    expect(r.valid).toBe(false);
    expect(r.format).toBe("json");
  });

  // YAML validation
  it("accepts valid YAML content", () => {
    const yaml = "name: test\nversion: 1.0\nitems:\n  - one\n  - two\n";
    const r = validateStructuredContent(yaml, "config.yaml");
    expect(r.valid).toBe(true);
    expect(r.format).toBe("yaml");
  });

  it("accepts .yml extension", () => {
    const r = validateStructuredContent("key: value\n", "config.yml");
    expect(r.valid).toBe(true);
    expect(r.format).toBe("yaml");
  });

  it("rejects YAML with tab indentation", () => {
    const yaml = "name: test\n\tindented: value\n";
    const r = validateStructuredContent(yaml, "config.yaml");
    expect(r.valid).toBe(false);
    expect(r.error).toContain("Tab indentation");
  });

  it("rejects YAML with unmatched braces in flow mapping", () => {
    const yaml = "data: {key: value, other: test\n";
    const r = validateStructuredContent(yaml, "config.yaml");
    expect(r.valid).toBe(false);
    expect(r.error).toContain("Unmatched braces");
  });

  // TOML validation
  it("accepts valid TOML content", () => {
    const toml = '[package]\nname = "test"\nversion = "1.0"\n\n[dependencies]\nfoo = "1.2"\n';
    const r = validateStructuredContent(toml, "Cargo.toml");
    expect(r.valid).toBe(true);
    expect(r.format).toBe("toml");
  });

  it("rejects TOML with duplicate sections", () => {
    const toml = '[package]\nname = "test"\n\n[package]\nversion = "1.0"\n';
    const r = validateStructuredContent(toml, "config.toml");
    expect(r.valid).toBe(false);
    expect(r.error).toContain("Duplicate section");
  });

  it("rejects TOML with missing key before =", () => {
    const toml = '[package]\n= "value"\n';
    const r = validateStructuredContent(toml, "config.toml");
    expect(r.valid).toBe(false);
    expect(r.error).toContain("Missing key");
  });

  it("rejects TOML with missing = in key-value", () => {
    const toml = "[package]\nname test\n";
    const r = validateStructuredContent(toml, "config.toml");
    expect(r.valid).toBe(false);
    expect(r.error).toContain("Missing '='");
  });

  // Pass-through for non-structured files
  it("passes through non-structured files unchanged", () => {
    const r = validateStructuredContent("any content here", "main.ts");
    expect(r.valid).toBe(true);
    expect(r.repaired).toBe(false);
    expect(r.format).toBeUndefined();
  });
});
