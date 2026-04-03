import { describe, it, expect } from "vitest";
import {
  containsImageContent,
  isModelVisionCapable,
  selectVisionModel,
  describeImage,
  filterImageBlocks,
  type ContentBlock,
} from "./vision-router.js";

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const textBlock: ContentBlock = { type: "text", text: "Hello world" };
const imageBlockPng: ContentBlock = {
  type: "image",
  imageBase64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk",
  mimeType: "image/png",
};
const imageBlockJpeg: ContentBlock = {
  type: "image",
  imageBase64: "/9j/4AAQSkZJRgABAQAAAQABAAD",
  mimeType: "image/jpeg",
};
const textBlock2: ContentBlock = { type: "text", text: "Describe the screenshot" };

// ---------------------------------------------------------------------------
// containsImageContent
// ---------------------------------------------------------------------------

describe("containsImageContent", () => {
  it("returns true when image blocks are present", () => {
    expect(containsImageContent([textBlock, imageBlockPng])).toBe(true);
  });

  it("returns false for text-only blocks", () => {
    expect(containsImageContent([textBlock, textBlock2])).toBe(false);
  });

  it("returns false for an empty array", () => {
    expect(containsImageContent([])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isModelVisionCapable
// ---------------------------------------------------------------------------

describe("isModelVisionCapable", () => {
  it("returns true for known vision models", () => {
    expect(isModelVisionCapable("anthropic", "claude-opus-4-6")).toBe(true);
    expect(isModelVisionCapable("anthropic", "claude-sonnet-4-6")).toBe(true);
    expect(isModelVisionCapable("openai", "gpt-5")).toBe(true);
    expect(isModelVisionCapable("openai", "gpt-4.1")).toBe(true);
    expect(isModelVisionCapable("google", "gemini-2.5-pro")).toBe(true);
    expect(isModelVisionCapable("google", "gemini-2.5-flash")).toBe(true);
    expect(isModelVisionCapable("grok", "grok-4.20-beta-0309-non-reasoning")).toBe(true);
    expect(isModelVisionCapable("grok", "grok-4-0709")).toBe(true);
  });

  it("returns false for unknown models", () => {
    expect(isModelVisionCapable("ollama", "llama3.1:8b")).toBe(false);
    expect(isModelVisionCapable("grok", "grok-3")).toBe(false);
    expect(isModelVisionCapable("anthropic", "claude-haiku-4-5")).toBe(false);
    expect(isModelVisionCapable("custom", "my-model")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// selectVisionModel
// ---------------------------------------------------------------------------

describe("selectVisionModel", () => {
  it("returns the preferred model when it is vision-capable", () => {
    const result = selectVisionModel("anthropic", "claude-opus-4-6");
    expect(result).not.toBeNull();
    expect(result!.provider).toBe("anthropic");
    expect(result!.modelId).toBe("claude-opus-4-6");
    expect(result!.supportsVision).toBe(true);
  });

  it("falls back to the first vision model when preferred is not vision-capable", () => {
    const result = selectVisionModel("ollama", "llama3.1:8b");
    expect(result).not.toBeNull();
    // Should fall back to the first entry in the vision catalog
    expect(result!.provider).toBe("grok");
    expect(result!.modelId).toBe("grok-4.20-beta-0309-non-reasoning");
    expect(result!.supportsVision).toBe(true);
  });

  it("falls back when no preferred model is specified", () => {
    const result = selectVisionModel();
    expect(result).not.toBeNull();
    expect(result!.supportsVision).toBe(true);
  });

  it("returns the correct maxImageSize for the selected model", () => {
    const result = selectVisionModel("openai", "gpt-5");
    expect(result).not.toBeNull();
    expect(result!.maxImageSize).toBe(20_000_000);
  });
});

// ---------------------------------------------------------------------------
// describeImage
// ---------------------------------------------------------------------------

describe("describeImage", () => {
  it("generates a text placeholder for image blocks", () => {
    const description = describeImage([imageBlockPng]);
    expect(description).toContain("[Image:");
    expect(description).toContain("image/png");
    expect(description).toContain("KB attached]");
  });

  it("generates placeholders for multiple images", () => {
    const description = describeImage([imageBlockPng, imageBlockJpeg]);
    expect(description).toContain("image/png");
    expect(description).toContain("image/jpeg");
  });

  it("ignores text blocks and returns empty string when no images", () => {
    const description = describeImage([textBlock, textBlock2]);
    expect(description).toBe("");
  });

  it("uses 'unknown' mime type when mimeType is not provided", () => {
    const noMimeBlock: ContentBlock = { type: "image", imageBase64: "AAAA" };
    const description = describeImage([noMimeBlock]);
    expect(description).toContain("unknown");
  });

  it("handles image blocks without base64 data gracefully", () => {
    const noDataBlock: ContentBlock = { type: "image", mimeType: "image/png" };
    const description = describeImage([noDataBlock]);
    expect(description).toContain("[Image: image/png, ~0KB attached]");
  });
});

// ---------------------------------------------------------------------------
// filterImageBlocks
// ---------------------------------------------------------------------------

describe("filterImageBlocks", () => {
  it("removes image blocks from the array", () => {
    const result = filterImageBlocks([textBlock, imageBlockPng, textBlock2]);
    expect(result).toHaveLength(2);
    expect(result.every((b) => b.type === "text")).toBe(true);
  });

  it("keeps all text blocks intact", () => {
    const result = filterImageBlocks([textBlock, textBlock2]);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(textBlock);
    expect(result[1]).toBe(textBlock2);
  });

  it("returns an empty array when all blocks are images", () => {
    const result = filterImageBlocks([imageBlockPng, imageBlockJpeg]);
    expect(result).toHaveLength(0);
  });

  it("returns an empty array for empty input", () => {
    const result = filterImageBlocks([]);
    expect(result).toHaveLength(0);
  });
});
