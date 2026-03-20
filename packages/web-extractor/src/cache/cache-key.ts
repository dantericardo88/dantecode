import { createHash } from "node:crypto";
import { WebFetchOptions } from "../types.js";

export function generateCacheKey(url: string, options: WebFetchOptions): string {
  const normalizedUrl = normalizeUrl(url);
  const normalizedInstructions = options.instructions?.trim().toLowerCase() || "";
  const schemaHash = options.schema ? hashObject(options.schema) : "";
  
  const rawKey = `${normalizedUrl}|${normalizedInstructions}|${schemaHash}|${options.cleanLevel || "standard"}`;
  return createHash("sha256").update(rawKey).digest("hex").slice(0, 16);
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = ""; // Remove hash
    return u.toString();
  } catch {
    return url;
  }
}

function hashObject(obj: any): string {
  const str = JSON.stringify(obj);
  return createHash("sha256").update(str).digest("hex").slice(0, 8);
}
