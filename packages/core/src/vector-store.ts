// ============================================================================
// @dantecode/core - Vector Store Abstraction
// In-memory brute-force and optional LanceDB ANN backends.
// ============================================================================

export interface VectorMetadata {
  filePath?: string;
  startLine?: number;
  endLine?: number;
  [key: string]: unknown;
}

export interface VectorEntry {
  id: string;
  vector: number[];
  metadata: VectorMetadata;
}

export interface VectorSearchResult {
  id: string;
  score: number;
  metadata: VectorMetadata;
}

export interface VectorStore {
  add(id: string, vector: number[], metadata?: VectorMetadata): Promise<void>;
  addBatch(entries: VectorEntry[]): Promise<void>;
  search(query: number[], limit?: number): Promise<VectorSearchResult[]>;
  delete(id: string): Promise<boolean>;
  count(): number;
  clear(): void;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i]!;
    const bi = b[i]!;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Zero-dependency brute-force vector store.
 * Suitable for small-to-medium indexes (< 50k entries).
 */
export class InMemoryVectorStore implements VectorStore {
  private readonly entries = new Map<string, { vector: number[]; metadata: VectorMetadata }>();

  async add(id: string, vector: number[], metadata: VectorMetadata = {}): Promise<void> {
    this.entries.set(id, { vector, metadata });
  }

  async addBatch(entries: VectorEntry[]): Promise<void> {
    for (const entry of entries) {
      this.entries.set(entry.id, { vector: entry.vector, metadata: entry.metadata });
    }
  }

  async search(query: number[], limit = 10): Promise<VectorSearchResult[]> {
    if (this.entries.size === 0 || query.length === 0) return [];

    const scored: VectorSearchResult[] = [];
    for (const [id, entry] of this.entries) {
      const score = cosineSimilarity(query, entry.vector);
      if (score > 0) {
        scored.push({ id, score, metadata: entry.metadata });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  async delete(id: string): Promise<boolean> {
    return this.entries.delete(id);
  }

  count(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }
}

// Typed shape for the optional LanceDB API surface
interface LanceTable {
  add(rows: unknown[]): Promise<void>;
  search(query: number[]): { limit(n: number): { execute(): Promise<unknown[]> } };
  delete(filter: string): Promise<void>;
}

interface LanceDB {
  openTable(name: string): Promise<LanceTable>;
  createTable(name: string, rows: unknown[]): Promise<LanceTable>;
}

/**
 * LanceDB-backed ANN vector store. Requires the optional `vectordb` package.
 * Falls back to InMemoryVectorStore if LanceDB is not available.
 */
export class LanceDBVectorStore implements VectorStore {
  private fallback: InMemoryVectorStore | null = null;
  private db: unknown = null;
  private table: unknown = null;
  private entryCount = 0;
  private readonly dbPath: string;
  private readonly tableName: string;

  constructor(dbPath: string, tableName = "code_vectors") {
    this.dbPath = dbPath;
    this.tableName = tableName;
  }

  private async ensureConnection(): Promise<boolean> {
    if (this.fallback) return false;
    if (this.db) return true;

    try {
      // Dynamic import for optional LanceDB dependency
      const module = "vectordb";
      const lancedb = (await import(/* webpackIgnore: true */ module)) as {
        connect: (path: string) => Promise<LanceDB>;
      };
      this.db = await lancedb.connect(this.dbPath);
      return true;
    } catch {
      this.fallback = new InMemoryVectorStore();
      return false;
    }
  }

  async add(id: string, vector: number[], metadata: VectorMetadata = {}): Promise<void> {
    await this.addBatch([{ id, vector, metadata }]);
  }

  async addBatch(entries: VectorEntry[]): Promise<void> {
    const connected = await this.ensureConnection();
    if (!connected && this.fallback) {
      return this.fallback.addBatch(entries);
    }

    const rows = entries.map((entry) => ({
      id: entry.id,
      vector: entry.vector,
      filePath: entry.metadata.filePath ?? "",
      startLine: entry.metadata.startLine ?? 0,
      endLine: entry.metadata.endLine ?? 0,
      metadataJson: JSON.stringify(entry.metadata),
    }));

    const db = this.db as LanceDB;
    try {
      if (this.table) {
        const tbl = this.table as LanceTable;
        await tbl.add(rows);
      } else {
        try {
          this.table = await db.openTable(this.tableName);
          const tbl = this.table as LanceTable;
          await tbl.add(rows);
        } catch {
          this.table = await db.createTable(this.tableName, rows);
        }
      }
      this.entryCount += entries.length;
    } catch {
      // Fall back to in-memory if LanceDB operations fail
      if (!this.fallback) {
        this.fallback = new InMemoryVectorStore();
      }
      return this.fallback.addBatch(entries);
    }
  }

  async search(query: number[], limit = 10): Promise<VectorSearchResult[]> {
    const connected = await this.ensureConnection();
    if (!connected && this.fallback) {
      return this.fallback.search(query, limit);
    }

    if (!this.table) return [];

    try {
      const tbl = this.table as LanceTable;
      const results = (await tbl.search(query).limit(limit).execute()) as Array<{
        id: string;
        _distance: number;
        metadataJson: string;
      }>;

      return results.map((row) => ({
        id: row.id,
        score: 1 / (1 + row._distance),
        metadata: JSON.parse(row.metadataJson) as VectorMetadata,
      }));
    } catch {
      if (this.fallback) {
        return this.fallback.search(query, limit);
      }
      return [];
    }
  }

  async delete(id: string): Promise<boolean> {
    if (this.fallback) return this.fallback.delete(id);

    if (!this.table) return false;
    try {
      const tbl = this.table as LanceTable;
      await tbl.delete(`id = '${id}'`);
      this.entryCount = Math.max(0, this.entryCount - 1);
      return true;
    } catch {
      return false;
    }
  }

  count(): number {
    if (this.fallback) return this.fallback.count();
    return this.entryCount;
  }

  clear(): void {
    if (this.fallback) {
      this.fallback.clear();
    }
    this.table = null;
    this.entryCount = 0;
  }
}

/**
 * Create the appropriate vector store based on available dependencies.
 * Prefers LanceDB if the `vectordb` package is installed.
 */
export function createVectorStore(dbPath?: string): VectorStore {
  if (dbPath) {
    return new LanceDBVectorStore(dbPath);
  }
  return new InMemoryVectorStore();
}
