import { bench, describe } from "vitest";
import { CompletionGate } from "@dantecode/core";

describe("CompletionGate performance", () => {
  const gate = new CompletionGate();

  bench("evaluate short response", () => {
    gate.evaluate("Done.", 0);
  });

  bench("evaluate long response with signals", () => {
    gate.evaluate("I have successfully implemented the feature. All tests pass and the task is complete. The implementation is finished.", 3);
  });
});

describe("String operations baseline", () => {
  bench("JSON.parse small object", () => {
    JSON.parse('{"key": "value", "count": 42}');
  });
});
