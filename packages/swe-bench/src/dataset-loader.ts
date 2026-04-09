import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface SWEBenchInstance {
  instanceId: string;
  repo: string;
  baseSha: string;
  problem: string;
  hints?: string;
  testPatch: string;
  patchGold?: string;
}

export interface DatasetLoaderOptions {
  cacheDir?: string;
  datasetName?: string;
  split?: string;
}

const DEFAULT_DATASET = "princeton-nlp/SWE-bench_Verified";
const DEFAULT_SPLIT = "test";

/**
 * Returns the path to the SWE-bench cache directory.
 */
export function getCacheDir(projectRoot?: string): string {
  const root = projectRoot ?? process.cwd();
  return join(root, ".dantecode", "swe-bench-cache");
}

/**
 * Loads the SWE-bench dataset from local cache or HuggingFace API.
 * Each instance is cached as a separate JSON file keyed by instanceId.
 */
export async function loadSWEBenchDataset(
  options?: DatasetLoaderOptions,
): Promise<SWEBenchInstance[]> {
  const cacheDir = options?.cacheDir ?? getCacheDir();
  const datasetName = options?.datasetName ?? DEFAULT_DATASET;
  const split = options?.split ?? DEFAULT_SPLIT;

  // Try loading from local cache first
  const cached = loadFromCache(cacheDir);
  if (cached.length > 0) {
    return cached;
  }

  // Fall back to HuggingFace API
  const instances = await fetchFromHuggingFace(datasetName, split);
  saveToCache(cacheDir, instances);
  return instances;
}

function loadFromCache(cacheDir: string): SWEBenchInstance[] {
  if (!existsSync(cacheDir)) {
    return [];
  }

  const indexPath = join(cacheDir, "_index.json");
  if (!existsSync(indexPath)) {
    return [];
  }

  try {
    const raw = readFileSync(indexPath, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed as SWEBenchInstance[];
  } catch {
    return [];
  }
}

function saveToCache(cacheDir: string, instances: SWEBenchInstance[]): void {
  mkdirSync(cacheDir, { recursive: true });

  // Write individual instance files for granular access
  for (const instance of instances) {
    const filePath = join(
      cacheDir,
      `${instance.instanceId.replace(/\//g, "__")}.json`,
    );
    writeFileSync(filePath, JSON.stringify(instance, null, 2), "utf-8");
  }

  // Write an index file for bulk loading
  const indexPath = join(cacheDir, "_index.json");
  writeFileSync(indexPath, JSON.stringify(instances, null, 2), "utf-8");
}

interface HuggingFaceRow {
  instance_id?: string;
  repo?: string;
  base_commit?: string;
  problem_statement?: string;
  hints_text?: string;
  test_patch?: string;
  patch?: string;
}

async function fetchFromHuggingFace(
  datasetName: string,
  split: string,
): Promise<SWEBenchInstance[]> {
  const encodedName = encodeURIComponent(datasetName);
  const url = `https://datasets-server.huggingface.co/rows?dataset=${encodedName}&config=default&split=${split}&offset=0&length=100`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch SWE-bench dataset: ${response.status} ${response.statusText}`,
    );
  }

  const data: { rows?: Array<{ row: HuggingFaceRow }> } =
    (await response.json()) as { rows?: Array<{ row: HuggingFaceRow }> };

  if (!data.rows || !Array.isArray(data.rows)) {
    throw new Error("Unexpected HuggingFace API response: missing rows array");
  }

  return data.rows.map((entry) => mapHuggingFaceRow(entry.row));
}

function mapHuggingFaceRow(row: HuggingFaceRow): SWEBenchInstance {
  return {
    instanceId: row.instance_id ?? "unknown",
    repo: row.repo ?? "",
    baseSha: row.base_commit ?? "",
    problem: row.problem_statement ?? "",
    hints: row.hints_text || undefined,
    testPatch: row.test_patch ?? "",
    patchGold: row.patch || undefined,
  };
}
