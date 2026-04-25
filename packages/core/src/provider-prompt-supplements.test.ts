import { describe, expect, it } from "vitest";
import { getProviderPromptSupplement } from "./provider-prompt-supplements.js";

describe("provider prompt supplements", () => {
  it("gives Grok concrete read-before-edit recovery instructions", () => {
    const supplement = getProviderPromptSupplement("grok");

    expect(supplement).toContain("Read");
    expect(supplement).toContain("Edit");
    expect(supplement).toMatch(/no offset\/limit/i);
    expect(supplement).toMatch(/small Edit/i);
  });
});
