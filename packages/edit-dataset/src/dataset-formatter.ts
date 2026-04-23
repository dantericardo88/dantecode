// ============================================================================
// packages/edit-dataset/src/dataset-formatter.ts
//
// Converts EditSequenceExample arrays to Alpaca and ChatML training formats,
// and writes JSONL output files.
// ============================================================================

import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import type { EditSequenceExample, AlpacaRecord, ChatMLRecord } from "./types.js";

// ── System prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT =
  "You are a next-edit prediction engine for code editors. " +
  "Given a sequence of recent edits and surrounding file context, " +
  "predict the next edit location and content as a JSON object with fields: " +
  "filePath (string, basename), startLine (number, 1-indexed), " +
  "endLine (number, 1-indexed, inclusive), confidence (number 0.0-1.0), " +
  "diff (string, unified diff hunk).";

// ── Formatters ────────────────────────────────────────────────────────────────

/**
 * Convert one example to Alpaca instruction-following format.
 * Serializes editHistory as compact JSON (not pretty-printed).
 */
export function toAlpacaFormat(example: EditSequenceExample): AlpacaRecord {
  // Cap history at last 5 edits
  const history = example.editHistory.slice(-5);
  return {
    instruction: SYSTEM_PROMPT,
    input:
      "EDIT_HISTORY:\n" + JSON.stringify(history) +
      "\n\nFILE_CONTEXT:\n" + example.fileContext,
    output: JSON.stringify(example.nextEdit),
  };
}

/**
 * Convert one example to ChatML (OpenAI messages array) format.
 */
export function toChatMLFormat(example: EditSequenceExample): ChatMLRecord {
  const history = example.editHistory.slice(-5);
  return {
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content:
          "EDIT_HISTORY:\n" + JSON.stringify(history) +
          "\n\nFILE_CONTEXT:\n" + example.fileContext,
      },
      {
        role: "assistant",
        content: JSON.stringify(example.nextEdit),
      },
    ],
  };
}

// ── JSONL writer ──────────────────────────────────────────────────────────────

/**
 * Write records to a JSONL file (one JSON object per line).
 * Handles unicode correctly via Node.js streams.
 */
export async function writeJSONL(
  records: Array<AlpacaRecord | ChatMLRecord>,
  outputPath: string,
): Promise<void> {
  const lines = records.map((r) => JSON.stringify(r)).join("\n") + "\n";
  const readable = Readable.from([lines]);
  const writable = createWriteStream(outputPath, { encoding: "utf8" });
  await pipeline(readable, writable);
}

/**
 * Format a batch of examples and write to JSONL.
 */
export async function formatAndWrite(
  examples: EditSequenceExample[],
  outputPath: string,
  format: "alpaca" | "chatml" = "alpaca",
): Promise<void> {
  const records =
    format === "alpaca"
      ? examples.map(toAlpacaFormat)
      : examples.map(toChatMLFormat);
  await writeJSONL(records, outputPath);
}

// ── Stats ─────────────────────────────────────────────────────────────────────

export interface DatasetStats {
  count: number;
  avgHistoryLength: number;
  avgContextChars: number;
  languageDistribution: Record<string, number>;
}

export function computeStats(examples: EditSequenceExample[]): DatasetStats {
  if (examples.length === 0) {
    return { count: 0, avgHistoryLength: 0, avgContextChars: 0, languageDistribution: {} };
  }

  let totalHistory = 0;
  let totalContext = 0;
  const langCounts: Record<string, number> = {};

  for (const ex of examples) {
    totalHistory += ex.editHistory.length;
    totalContext += ex.fileContext.length;
    for (const edit of ex.editHistory) {
      langCounts[edit.language] = (langCounts[edit.language] ?? 0) + 1;
    }
  }

  return {
    count: examples.length,
    avgHistoryLength: totalHistory / examples.length,
    avgContextChars: totalContext / examples.length,
    languageDistribution: langCounts,
  };
}
