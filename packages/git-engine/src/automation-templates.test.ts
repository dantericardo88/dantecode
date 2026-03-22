import { describe, it, expect } from "vitest";
import {
  getTemplate,
  listTemplates,
  BUILT_IN_TEMPLATES,
  type AutomationDefinition,
} from "./automation-templates.js";

// Validates the shape of an AutomationDefinition
function isValidDefinition(def: AutomationDefinition): boolean {
  return (
    typeof def.id === "string" &&
    def.id.length > 0 &&
    typeof def.name === "string" &&
    def.name.length > 0 &&
    (def.type === "webhook" ||
      def.type === "schedule" ||
      def.type === "watch" ||
      def.type === "loop") &&
    typeof def.config === "object" &&
    def.config !== null &&
    typeof def.createdAt === "string" &&
    def.createdAt.length > 0 &&
    (def.status === "active" || def.status === "stopped" || def.status === "error") &&
    typeof def.runCount === "number"
  );
}

// Validates cron expression (basic 5-field check)
function isValidCron(cron: string): boolean {
  const fields = cron.trim().split(/\s+/);
  return fields.length === 5;
}

describe("automation-templates", () => {
  it("getTemplate('pr-review') returns a valid template", () => {
    const template = getTemplate("pr-review");
    expect(template).not.toBeNull();
    expect(template?.name).toBe("pr-review");
    expect(template?.type).toBe("webhook");
    expect(typeof template?.description).toBe("string");
    expect(template?.description.length).toBeGreaterThan(0);
    expect(typeof template?.create).toBe("function");
  });

  it("getTemplate('nonexistent') returns null", () => {
    const template = getTemplate("nonexistent");
    expect(template).toBeNull();
  });

  it("each template's create() produces a valid AutomationDefinition with required fields", () => {
    const templates = listTemplates();
    expect(templates.length).toBeGreaterThanOrEqual(5);

    for (const template of templates) {
      const def = template.create();
      expect(isValidDefinition(def)).toBe(true);
      // id should be a hex string (12 chars = 6 bytes)
      expect(def.id).toMatch(/^[0-9a-f]{12}$/);
      // createdAt should be a valid ISO date
      expect(() => new Date(def.createdAt)).not.toThrow();
      expect(new Date(def.createdAt).toISOString()).toBe(def.createdAt);
      // runCount starts at 0
      expect(def.runCount).toBe(0);
      // status is active by default
      expect(def.status).toBe("active");
    }
  });

  it("template defaults are sensible — port numbers are numbers, schedule strings are valid cron", () => {
    const prReview = getTemplate("pr-review");
    expect(prReview).not.toBeNull();
    const prDef = prReview!.create();
    expect(typeof prDef.config.port).toBe("number");
    expect(prDef.config.port).toBeGreaterThan(0);
    expect(prDef.config.port).toBeLessThanOrEqual(65535);

    const dailyVerify = getTemplate("daily-verify");
    expect(dailyVerify).not.toBeNull();
    const dailyDef = dailyVerify!.create();
    expect(typeof dailyDef.config.cron).toBe("string");
    expect(isValidCron(dailyDef.config.cron as string)).toBe(true);

    const securityScan = getTemplate("security-scan");
    expect(securityScan).not.toBeNull();
    const secDef = securityScan!.create();
    expect(typeof secDef.config.cron).toBe("string");
    expect(isValidCron(secDef.config.cron as string)).toBe(true);

    const weeklyRetro = getTemplate("weekly-retro");
    expect(weeklyRetro).not.toBeNull();
    const retroDef = weeklyRetro!.create();
    expect(typeof retroDef.config.cron).toBe("string");
    expect(isValidCron(retroDef.config.cron as string)).toBe(true);
    expect(typeof retroDef.config.lookbackDays).toBe("number");
    expect(retroDef.config.lookbackDays).toBeGreaterThan(0);

    const testOnChange = getTemplate("test-on-change");
    expect(testOnChange).not.toBeNull();
    const watchDef = testOnChange!.create();
    expect(typeof watchDef.config.debounceMs).toBe("number");
    expect(watchDef.config.debounceMs).toBeGreaterThan(0);
  });

  it("template options override defaults", () => {
    const prReview = getTemplate("pr-review");
    expect(prReview).not.toBeNull();
    const customDef = prReview!.create({ port: 9999 });
    expect(customDef.config.port).toBe(9999);

    const dailyVerify = getTemplate("daily-verify");
    expect(dailyVerify).not.toBeNull();
    const customCron = dailyVerify!.create({ cron: "30 6 * * 1-5" });
    expect(customCron.config.cron).toBe("30 6 * * 1-5");

    const testOnChange = getTemplate("test-on-change");
    expect(testOnChange).not.toBeNull();
    const customDebounce = testOnChange!.create({ debounceMs: 1000, pattern: "**/*.tsx" });
    expect(customDebounce.config.debounceMs).toBe(1000);
    expect(customDebounce.config.pattern).toBe("**/*.tsx");

    // All 5 built-in templates are accessible
    expect(BUILT_IN_TEMPLATES.map((t) => t.name)).toContain("pr-review");
    expect(BUILT_IN_TEMPLATES.map((t) => t.name)).toContain("daily-verify");
    expect(BUILT_IN_TEMPLATES.map((t) => t.name)).toContain("test-on-change");
    expect(BUILT_IN_TEMPLATES.map((t) => t.name)).toContain("security-scan");
    expect(BUILT_IN_TEMPLATES.map((t) => t.name)).toContain("weekly-retro");
  });
});
