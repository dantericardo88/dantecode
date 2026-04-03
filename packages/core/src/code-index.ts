// ============================================================================
// @dantecode/core - Semantic Code Index
// TF-IDF code indexing with optional embedding-based hybrid search.
// ============================================================================

import { exec as execCallback } from "node:child_process";
import { readFile, writeFile, readdir, mkdir, stat } from "node:fs/promises";
import { join, relative, extname } from "node:path";
import { promisify } from "node:util";
import type { CodeChunk, CodeIndexConfig } from "@dantecode/config-types";
import type { EmbeddingProvider, EmbeddingProviderInfo } from "./embedding-provider.js";
import type { VectorStore } from "./vector-store.js";

const execAsync = promisify(execCallback);

const CHUNK_BOUNDARY_PATTERNS = [
  /^(?:export\s+)?(?:async\s+)?function\s+\w+/,
  /^(?:export\s+)?class\s+\w+/,
  /^(?:export\s+)?interface\s+\w+/,
  /^(?:export\s+)?type\s+\w+\s*=/,
  /^(?:export\s+)?const\s+\w+\s*=\s*(?:async\s+)?\(/,
  /^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+/,
  /^describe\s*\(/,
  /^it\s*\(/,
  /^test\s*\(/,
];

function extractSymbols(code: string): string[] {
  const symbols: string[] = [];
  const patterns = [
    /(?:function|class|interface|type|const|let|var|enum)\s+(\w+)/g,
    /(?:export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let))\s+(\w+)/g,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(code)) !== null) {
      if (match[1] && !symbols.includes(match[1])) {
        symbols.push(match[1]);
      }
    }
  }

  return symbols;
}

export function chunkFile(content: string, filePath: string, maxChunkLines: number): CodeChunk[] {
  if (content.trim().length === 0) return [];
  const lines = content.split("\n");
  if (lines.length === 0) return [];

  if (lines.length <= maxChunkLines) {
    return [
      {
        filePath,
        startLine: 1,
        endLine: lines.length,
        content,
        symbols: extractSymbols(content),
      },
    ];
  }

  const chunks: CodeChunk[] = [];
  let chunkStart = 0;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    const isChunkBoundary = CHUNK_BOUNDARY_PATTERNS.some((pattern) => pattern.test(line.trim()));
    const chunkLen = i - chunkStart;

    if (isChunkBoundary && chunkLen >= 10) {
      const chunkContent = lines.slice(chunkStart, i).join("\n");
      chunks.push({
        filePath,
        startLine: chunkStart + 1,
        endLine: i,
        content: chunkContent,
        symbols: extractSymbols(chunkContent),
      });
      chunkStart = i;
    }

    if (chunkLen >= maxChunkLines) {
      const chunkContent = lines.slice(chunkStart, i).join("\n");
      chunks.push({
        filePath,
        startLine: chunkStart + 1,
        endLine: i,
        content: chunkContent,
        symbols: extractSymbols(chunkContent),
      });
      chunkStart = i;
    }
  }

  if (chunkStart < lines.length) {
    const chunkContent = lines.slice(chunkStart).join("\n");
    if (chunkContent.trim().length > 0) {
      chunks.push({
        filePath,
        startLine: chunkStart + 1,
        endLine: lines.length,
        content: chunkContent,
        symbols: extractSymbols(chunkContent),
      });
    }
  }

  return chunks;
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1);
}

function computeTF(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const token of tokens) {
    tf.set(token, (tf.get(token) ?? 0) + 1);
  }

  const len = tokens.length || 1;
  for (const [term, count] of tf) {
    tf.set(term, count / len);
  }

  return tf;
}

function cosineSimilaritySparse(a: Map<string, number>, b: Map<string, number>): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (const [term, scoreA] of a) {
    dotProduct += scoreA * (b.get(term) ?? 0);
    normA += scoreA * scoreA;
  }
  for (const scoreB of b.values()) {
    normB += scoreB * scoreB;
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dotProduct / denom;
}

function cosineSimilarityDense(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) {
    return 0;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const scoreA = a[i]!;
    const scoreB = b[i]!;
    dotProduct += scoreA * scoreB;
    normA += scoreA * scoreA;
    normB += scoreB * scoreB;
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dotProduct / denom;
}

interface IndexEntry {
  chunk: CodeChunk;
  tfidf: Map<string, number>;
}

interface SerializedIndexV1 {
  version: 1;
  builtAt: string;
  entries: Array<{
    chunk: Omit<CodeChunk, "embedding">;
    tfidf: Record<string, number>;
  }>;
  idf: Record<string, number>;
}

interface SerializedIndexV2 {
  version: 2;
  builtAt: string;
  embeddingProvider?: EmbeddingProviderInfo;
  entries: Array<{
    chunk: CodeChunk;
    tfidf: Record<string, number>;
  }>;
  idf: Record<string, number>;
}

type SerializedIndex = SerializedIndexV1 | SerializedIndexV2;

const INDEXABLE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".py",
  ".rb",
  ".rs",
  ".go",
  ".java",
  ".c",
  ".cpp",
  ".h",
  ".hpp",
  ".cs",
  ".swift",
  ".kt",
  ".vue",
  ".svelte",
  ".astro",
  ".md",
]);

const DEFAULT_EXCLUDE = [
  "node_modules",
  "dist",
  "build",
  ".git",
  "coverage",
  ".turbo",
  ".next",
  ".nuxt",
  "__pycache__",
  "target",
  "vendor",
];

const EMBEDDING_BATCH_SIZE = 20;

export class CodeIndex {
  private entries: IndexEntry[] = [];
  private idf: Map<string, number> = new Map();
  private embeddingProviderInfo: EmbeddingProviderInfo | null = null;
  private vectorStore: VectorStore | null = null;
  private indexedFiles = new Set<string>();

  get size(): number {
    return this.entries.length;
  }

  get hasEmbeddings(): boolean {
    return this.entries.some((entry) => Array.isArray(entry.chunk.embedding));
  }

  getEmbeddingProviderInfo(): EmbeddingProviderInfo | null {
    return this.embeddingProviderInfo;
  }

  async buildIndex(
    projectRoot: string,
    config?: Partial<CodeIndexConfig>,
    embeddingProvider?: EmbeddingProvider | null,
  ): Promise<number> {
    const maxChunkLines = config?.maxChunkLines ?? 200;
    const excludePatterns = [...DEFAULT_EXCLUDE, ...(config?.excludePatterns ?? [])];

    this.entries = [];
    this.idf = new Map();
    this.indexedFiles.clear();
    this.embeddingProviderInfo = embeddingProvider?.info ?? null;

    const allChunks: CodeChunk[] = [];
    const files = await this.collectFiles(projectRoot, excludePatterns);

    for (const filePath of files) {
      try {
        const content = await readFile(filePath, "utf-8");
        const relPath = relative(projectRoot, filePath);
        const chunks = chunkFile(content, relPath, maxChunkLines);
        allChunks.push(...chunks);
        this.indexedFiles.add(relPath);
      } catch {
        // Skip unreadable files.
      }
    }

    const docCount = allChunks.length || 1;
    const docFreq = new Map<string, number>();

    for (const chunk of allChunks) {
      const tokens = new Set(tokenize(`${chunk.content} ${chunk.symbols.join(" ")}`));
      for (const token of tokens) {
        docFreq.set(token, (docFreq.get(token) ?? 0) + 1);
      }
    }

    for (const [term, freq] of docFreq) {
      this.idf.set(term, Math.log(docCount / freq));
    }

    if (embeddingProvider) {
      await this.attachEmbeddings(allChunks, embeddingProvider);
    }

    if (this.vectorStore) {
      this.vectorStore.clear();
    }

    for (const chunk of allChunks) {
      const tokens = tokenize(`${chunk.content} ${chunk.symbols.join(" ")}`);
      const tf = computeTF(tokens);
      const tfidf = new Map<string, number>();

      for (const [term, tfScore] of tf) {
        const idfScore = this.idf.get(term) ?? 0;
        tfidf.set(term, tfScore * idfScore);
      }

      this.entries.push({ chunk, tfidf });

      if (this.vectorStore && chunk.embedding) {
        await this.vectorStore.add(`${chunk.filePath}:${chunk.startLine}`, chunk.embedding, {
          filePath: chunk.filePath,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
        });
      }
    }

    return this.entries.length;
  }

  search(query: string, limit = 10, queryEmbedding?: number[]): CodeChunk[] {
    if (this.entries.length === 0) return [];

    const queryTokens = tokenize(query);
    const queryTF = computeTF(queryTokens);
    const queryTFIDF = new Map<string, number>();

    for (const [term, tfScore] of queryTF) {
      const idfScore = this.idf.get(term) ?? 0;
      queryTFIDF.set(term, tfScore * idfScore);
    }

    const canUseHybrid =
      Array.isArray(queryEmbedding) &&
      queryEmbedding.length > 0 &&
      this.entries.some((entry) => Array.isArray(entry.chunk.embedding));

    const scored = this.entries.map((entry) => {
      const tfidfScore = cosineSimilaritySparse(queryTFIDF, entry.tfidf);
      const vectorScore =
        canUseHybrid && entry.chunk.embedding
          ? cosineSimilarityDense(queryEmbedding, entry.chunk.embedding)
          : 0;

      return {
        chunk: entry.chunk,
        score: canUseHybrid ? tfidfScore * 0.3 + vectorScore * 0.7 : tfidfScore,
      };
    });

    return scored
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((entry) => entry.chunk);
  }

  vectorSearch(queryEmbedding: number[], limit = 10): CodeChunk[] {
    if (!Array.isArray(queryEmbedding) || queryEmbedding.length === 0 || !this.hasEmbeddings) {
      return [];
    }

    return this.entries
      .map((entry) => ({
        chunk: entry.chunk,
        score: entry.chunk.embedding
          ? cosineSimilarityDense(queryEmbedding, entry.chunk.embedding)
          : 0,
      }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((entry) => entry.chunk);
  }

  async save(projectRoot: string): Promise<void> {
    const dir = join(projectRoot, ".dantecode");
    await mkdir(dir, { recursive: true });

    const serialized: SerializedIndexV2 = {
      version: 2,
      builtAt: new Date().toISOString(),
      ...(this.embeddingProviderInfo ? { embeddingProvider: this.embeddingProviderInfo } : {}),
      entries: this.entries.map((entry) => ({
        chunk: entry.chunk,
        tfidf: Object.fromEntries(entry.tfidf),
      })),
      idf: Object.fromEntries(this.idf),
    };

    await writeFile(join(dir, "index.json"), JSON.stringify(serialized), "utf-8");
  }

  async load(projectRoot: string): Promise<boolean> {
    try {
      const raw = await readFile(join(projectRoot, ".dantecode", "index.json"), "utf-8");
      const data = JSON.parse(raw) as SerializedIndex;

      if (data.version !== 1 && data.version !== 2) {
        return false;
      }

      this.idf = new Map(Object.entries(data.idf));
      this.embeddingProviderInfo = data.version === 2 ? (data.embeddingProvider ?? null) : null;
      this.entries = data.entries.map((entry) => ({
        chunk: data.version === 1 ? { ...entry.chunk } : entry.chunk,
        tfidf: new Map(Object.entries(entry.tfidf).map(([term, score]) => [term, Number(score)])),
      }));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Attach a VectorStore backend for ANN search.
   * Entries are synced to the store during buildIndex/incrementalUpdate.
   */
  setVectorStore(store: VectorStore): void {
    this.vectorStore = store;
  }

  /**
   * ANN search delegating to the attached VectorStore.
   * Falls back to brute-force vectorSearch if no store is attached.
   */
  async vectorSearchANN(queryEmbedding: number[], limit = 10): Promise<CodeChunk[]> {
    if (!Array.isArray(queryEmbedding) || queryEmbedding.length === 0) {
      return [];
    }

    if (this.vectorStore && this.vectorStore.count() > 0) {
      const results = await this.vectorStore.search(queryEmbedding, limit);
      return results
        .map((result) => {
          const entry = this.entries.find(
            (e) =>
              e.chunk.filePath === result.metadata.filePath &&
              e.chunk.startLine === result.metadata.startLine,
          );
          return entry?.chunk;
        })
        .filter((chunk): chunk is CodeChunk => chunk !== undefined);
    }

    return this.vectorSearch(queryEmbedding, limit);
  }

  /**
   * Incrementally re-index only files that changed since the last full build.
   * Uses `git diff --name-only` to detect changed files.
   */
  async incrementalUpdate(
    projectRoot: string,
    config?: Partial<CodeIndexConfig>,
    embeddingProvider?: EmbeddingProvider | null,
  ): Promise<number> {
    const maxChunkLines = config?.maxChunkLines ?? 200;

    let changedFiles: string[];
    try {
      const { stdout } = await execAsync("git diff --name-only HEAD", { cwd: projectRoot });
      const { stdout: untrackedOut } = await execAsync("git ls-files --others --exclude-standard", {
        cwd: projectRoot,
      });
      const allChanged = [...stdout.trim().split("\n"), ...untrackedOut.trim().split("\n")]
        .map((f) => f.trim())
        .filter((f) => f.length > 0 && INDEXABLE_EXTENSIONS.has(extname(f)));
      changedFiles = [...new Set(allChanged)];
    } catch {
      return 0;
    }

    if (changedFiles.length === 0) return 0;

    let updated = 0;
    for (const relPath of changedFiles) {
      const fullPath = join(projectRoot, relPath);
      try {
        const content = await readFile(fullPath, "utf-8");
        const newChunks = chunkFile(content, relPath, maxChunkLines);

        // Remove old entries for this file
        this.entries = this.entries.filter((entry) => entry.chunk.filePath !== relPath);
        if (this.vectorStore) {
          await this.vectorStore.delete(relPath);
        }

        // Attach embeddings if provider is available
        if (embeddingProvider) {
          await this.attachEmbeddings(newChunks, embeddingProvider);
        }

        // Add new entries
        for (const chunk of newChunks) {
          const tokens = tokenize(`${chunk.content} ${chunk.symbols.join(" ")}`);
          const tf = computeTF(tokens);
          const tfidf = new Map<string, number>();

          for (const [term, tfScore] of tf) {
            const idfScore = this.idf.get(term) ?? 0;
            tfidf.set(term, tfScore * idfScore);
          }

          this.entries.push({ chunk, tfidf });

          if (this.vectorStore && chunk.embedding) {
            await this.vectorStore.add(`${relPath}:${chunk.startLine}`, chunk.embedding, {
              filePath: chunk.filePath,
              startLine: chunk.startLine,
              endLine: chunk.endLine,
            });
          }
        }

        this.indexedFiles.add(relPath);
        updated += newChunks.length;
      } catch {
        // Skip unreadable files
      }
    }

    return updated;
  }

  getIndexedFiles(): string[] {
    return [...this.indexedFiles];
  }

  private async attachEmbeddings(
    chunks: CodeChunk[],
    embeddingProvider: EmbeddingProvider,
  ): Promise<void> {
    for (let i = 0; i < chunks.length; i += EMBEDDING_BATCH_SIZE) {
      const batch = chunks.slice(i, i + EMBEDDING_BATCH_SIZE);
      const embeddings = await embeddingProvider.embed(
        batch.map((chunk) => buildEmbeddingText(chunk)),
      );
      for (let j = 0; j < batch.length; j++) {
        const chunk = batch[j]!;
        chunk.embedding = embeddings[j];
      }
    }
  }

  private async collectFiles(dir: string, excludePatterns: string[]): Promise<string[]> {
    const files: string[] = [];

    try {
      const entries = await readdir(dir);
      for (const entry of entries) {
        if (excludePatterns.some((pattern) => entry === pattern)) {
          continue;
        }

        const fullPath = join(dir, entry);
        try {
          const fileStat = await stat(fullPath);
          if (fileStat.isDirectory()) {
            files.push(...(await this.collectFiles(fullPath, excludePatterns)));
          } else if (fileStat.isFile() && INDEXABLE_EXTENSIONS.has(extname(entry))) {
            files.push(fullPath);
          }
        } catch {
          // Skip inaccessible entries.
        }
      }
    } catch {
      // Skip inaccessible directories.
    }

    return files;
  }
}

function buildEmbeddingText(chunk: CodeChunk): string {
  const symbolText = chunk.symbols.length > 0 ? `\nSymbols: ${chunk.symbols.join(", ")}` : "";
  return `File: ${chunk.filePath}\nLines: ${chunk.startLine}-${chunk.endLine}${symbolText}\n\n${chunk.content}`;
}
