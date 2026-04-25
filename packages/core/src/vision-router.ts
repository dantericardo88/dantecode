// ============================================================================
// @dantecode/core — Vision Router
// Routes messages with image content to vision-capable models.
// ============================================================================

import type { ModelProvider } from "@dantecode/config-types";

/**
 * A content block within a multi-modal message.
 * Used by the vision router to detect and process image content.
 */
export interface ContentBlock {
  type: "text" | "image";
  text?: string;
  imageBase64?: string;
  mimeType?: string;
}

/**
 * Describes a model's vision capability and constraints.
 */
export interface VisionCapability {
  provider: ModelProvider;
  modelId: string;
  supportsVision: boolean;
  /** Maximum image size in bytes. */
  maxImageSize?: number;
}

// Known vision-capable models with their constraints.
const VISION_CAPABLE_MODELS: VisionCapability[] = [
  {
    provider: "grok",
    modelId: "grok-4.20-beta-0309-non-reasoning",
    supportsVision: true,
    maxImageSize: 20_000_000,
  },
  { provider: "grok", modelId: "grok-4-0709", supportsVision: true, maxImageSize: 20_000_000 },
  {
    provider: "anthropic",
    modelId: "claude-opus-4-7",
    supportsVision: true,
    maxImageSize: 20_000_000,
  },
  {
    provider: "anthropic",
    modelId: "claude-opus-4-6",
    supportsVision: true,
    maxImageSize: 20_000_000,
  },
  {
    provider: "anthropic",
    modelId: "claude-sonnet-4-6",
    supportsVision: true,
    maxImageSize: 20_000_000,
  },
  { provider: "openai", modelId: "gpt-5", supportsVision: true, maxImageSize: 20_000_000 },
  { provider: "openai", modelId: "gpt-4.1", supportsVision: true, maxImageSize: 20_000_000 },
  { provider: "google", modelId: "gemini-2.5-pro", supportsVision: true, maxImageSize: 20_000_000 },
  {
    provider: "google",
    modelId: "gemini-2.5-flash",
    supportsVision: true,
    maxImageSize: 20_000_000,
  },
];

/**
 * Returns true if any block in the array has type "image".
 */
export function containsImageContent(blocks: ContentBlock[]): boolean {
  return blocks.some((block) => block.type === "image");
}

/**
 * Checks whether a specific provider/model combination supports vision input.
 */
export function isModelVisionCapable(provider: ModelProvider, modelId: string): boolean {
  return VISION_CAPABLE_MODELS.some(
    (entry) => entry.provider === provider && entry.modelId === modelId && entry.supportsVision,
  );
}

/**
 * Selects a vision-capable model. If the preferred model supports vision, it is
 * returned directly. Otherwise the first available vision-capable model from the
 * catalog is returned as a fallback. Returns null when no vision model is found
 * (should not happen with a populated catalog, but handled for safety).
 */
export function selectVisionModel(
  preferredProvider?: ModelProvider,
  preferredModelId?: string,
): VisionCapability | null {
  // If a preferred model is specified and it supports vision, return it.
  if (preferredProvider && preferredModelId) {
    const preferred = VISION_CAPABLE_MODELS.find(
      (entry) => entry.provider === preferredProvider && entry.modelId === preferredModelId,
    );
    if (preferred) {
      return preferred;
    }
  }

  // Fall back to the first known vision-capable model.
  return VISION_CAPABLE_MODELS[0] ?? null;
}

/**
 * Generates a text description for image blocks, suitable for
 * injection into non-vision model prompts. Text blocks are ignored.
 *
 * Example output: "[Image: image/png, ~45KB attached]"
 */
export function describeImage(blocks: ContentBlock[]): string {
  const descriptions: string[] = [];

  for (const block of blocks) {
    if (block.type !== "image") continue;

    const mime = block.mimeType ?? "unknown";
    const sizeBytes = block.imageBase64 ? Math.ceil((block.imageBase64.length * 3) / 4) : 0;
    const sizeKB = Math.round(sizeBytes / 1024);
    descriptions.push(`[Image: ${mime}, ~${sizeKB}KB attached]`);
  }

  return descriptions.join(" ");
}

/**
 * Filters out image blocks, returning only text blocks.
 * Used to prepare content for non-vision models.
 */
export function filterImageBlocks(blocks: ContentBlock[]): ContentBlock[] {
  return blocks.filter((block) => block.type !== "image");
}
