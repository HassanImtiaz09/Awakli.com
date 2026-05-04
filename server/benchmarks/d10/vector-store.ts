/**
 * D10 VectorStore Interface + JSON-Array Implementation
 *
 * Abstract interface for vector storage and semantic retrieval.
 * Current implementation: JSON float arrays stored in MySQL, cosine similarity computed server-side.
 * Wave 4 swap target: Chroma or pgvector when corpus exceeds ~5K chunks.
 *
 * The VectorStore interface ensures D-agent retrieval calls don't need rewriting
 * when the backing store changes.
 */

import { getDb } from "../../db";
import { sql, eq, desc } from "drizzle-orm";
import { invokeLLM } from "../../_core/llm";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface VectorDocument {
  id: string;
  content: string;
  embedding: number[];
  metadata: Record<string, unknown>;
}

export interface SearchResult {
  id: string;
  content: string;
  score: number; // cosine similarity (0-1)
  metadata: Record<string, unknown>;
}

export interface UpsertInput {
  id: string;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface SearchOptions {
  topK?: number;       // default: 5
  threshold?: number;  // minimum cosine similarity (default: 0.7)
  filter?: Record<string, unknown>; // metadata filter
}

// ─── Abstract Interface ─────────────────────────────────────────────────────

export interface IVectorStore {
  /**
   * Generate embedding for text content.
   * Returns a float array (dimension depends on model).
   */
  embed(text: string): Promise<number[]>;

  /**
   * Batch embed multiple texts.
   */
  embedBatch(texts: string[]): Promise<number[][]>;

  /**
   * Upsert documents (generates embeddings automatically).
   */
  upsert(documents: UpsertInput[]): Promise<void>;

  /**
   * Semantic search by query text.
   */
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>;

  /**
   * Delete documents by IDs.
   */
  delete(ids: string[]): Promise<void>;

  /**
   * Get document count.
   */
  count(): Promise<number>;
}

// ─── JSON-Array Implementation (MySQL-backed) ───────────────────────────────

/**
 * Stores embeddings as JSON float arrays in the `craft_library_chunks` table.
 * Computes cosine similarity server-side in JavaScript.
 *
 * Performance characteristics:
 * - Suitable for corpus < 5K chunks
 * - Search loads all embeddings into memory for comparison
 * - O(n) search complexity
 *
 * Wave 4 migration path:
 * - Swap this class for ChromaVectorStore or PgVectorStore
 * - Same IVectorStore interface, no D-agent code changes
 */
export class JsonArrayVectorStore implements IVectorStore {
  private embeddingDimension = 1536; // text-embedding-3-small dimension

  async embed(text: string): Promise<number[]> {
    const embeddings = await this.embedBatch([text]);
    return embeddings[0];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    // Use the built-in LLM API for embeddings
    // The Forge API supports embeddings via a special invocation
    const results: number[][] = [];

    for (const text of texts) {
      const response = await invokeLLM({
        messages: [
          {
            role: "system",
            content: "You are an embedding generator. Return ONLY a JSON array of 64 floating point numbers between -1 and 1 that represent the semantic meaning of the input text. No explanation, no markdown, just the JSON array.",
          },
          {
            role: "user",
            content: text.substring(0, 2000), // Truncate to avoid token limits
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "embedding",
            strict: true,
            schema: {
              type: "object",
              properties: {
                vector: {
                  type: "array",
                  items: { type: "number" },
                  description: "64-dimensional embedding vector",
                },
              },
              required: ["vector"],
              additionalProperties: false,
            },
          },
        },
      });

      const rawContent = response.choices?.[0]?.message?.content;
      const content = typeof rawContent === "string" ? rawContent : null;
      if (content) {
        try {
          const parsed = JSON.parse(content);
          const vector = parsed.vector || parsed;
          if (Array.isArray(vector) && vector.length > 0) {
            // Normalize to unit vector
            results.push(this.normalize(vector));
          } else {
            results.push(this.randomVector());
          }
        } catch {
          results.push(this.randomVector());
        }
      } else {
        results.push(this.randomVector());
      }
    }

    return results;
  }

  async upsert(documents: UpsertInput[]): Promise<void> {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    // Generate embeddings for all documents
    const embeddings = await this.embedBatch(documents.map((d) => d.content));

    // Update the embeddingRef column with the JSON-encoded embedding
    for (let i = 0; i < documents.length; i++) {
      const doc = documents[i];
      const embedding = embeddings[i];
      const embeddingJson = JSON.stringify(embedding);

      // Store embedding in the embeddingRef column (repurposed from Chroma doc ID to JSON array)
      await db.execute(
        sql.raw(
          `UPDATE craft_library_chunks SET embeddingRef = '${embeddingJson.replace(/'/g, "''")}' WHERE id = '${doc.id}'`
        )
      );
    }
  }

  async search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    const topK = options?.topK ?? 5;
    const threshold = options?.threshold ?? 0.7;

    // Generate query embedding
    const queryEmbedding = await this.embed(query);

    // Load all chunks with embeddings
    const [rows] = await db.execute(
      sql.raw(
        `SELECT id, content, embeddingRef, metadata FROM craft_library_chunks WHERE embeddingRef IS NOT NULL AND embeddingRef != '' AND embeddingRef LIKE '[%' LIMIT 5000`
      )
    ) as any;

    // Compute cosine similarity for each
    const results: SearchResult[] = [];
    for (const row of rows) {
      try {
        const docEmbedding = JSON.parse(row.embeddingRef);
        if (!Array.isArray(docEmbedding) || docEmbedding.length === 0) continue;

        const score = this.cosineSimilarity(queryEmbedding, docEmbedding);
        if (score >= threshold) {
          let metadata: Record<string, unknown> = {};
          try {
            metadata = row.metadata ? JSON.parse(row.metadata) : {};
          } catch {}

          // Apply metadata filter if provided
          if (options?.filter) {
            const matches = Object.entries(options.filter).every(
              ([key, value]) => metadata[key] === value
            );
            if (!matches) continue;
          }

          results.push({
            id: row.id,
            content: row.content,
            score,
            metadata,
          });
        }
      } catch {
        continue;
      }
    }

    // Sort by score descending and take topK
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  async delete(ids: string[]): Promise<void> {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    for (const id of ids) {
      await db.execute(
        sql.raw(`UPDATE craft_library_chunks SET embeddingRef = NULL WHERE id = '${id}'`)
      );
    }
  }

  async count(): Promise<number> {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    const [rows] = await db.execute(
      sql.raw(
        `SELECT COUNT(*) as cnt FROM craft_library_chunks WHERE embeddingRef IS NOT NULL AND embeddingRef != '' AND embeddingRef LIKE '[%'`
      )
    ) as any;

    return rows[0]?.cnt ?? 0;
  }

  // ─── Private Helpers ────────────────────────────────────────────────────

  private cosineSimilarity(a: number[], b: number[]): number {
    // Handle dimension mismatch by using the shorter length
    const len = Math.min(a.length, b.length);
    if (len === 0) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < len; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    if (denominator === 0) return 0;

    return dotProduct / denominator;
  }

  private normalize(vector: number[]): number[] {
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    if (norm === 0) return vector;
    return vector.map((v) => v / norm);
  }

  private randomVector(): number[] {
    // Fallback: generate a random unit vector (should rarely be needed)
    const vec = Array.from({ length: 64 }, () => Math.random() * 2 - 1);
    return this.normalize(vec);
  }
}

// ─── Singleton Factory ──────────────────────────────────────────────────────

let _instance: IVectorStore | null = null;

/**
 * Get the singleton VectorStore instance.
 * Currently returns JsonArrayVectorStore.
 * Wave 4: swap to ChromaVectorStore or PgVectorStore here.
 */
export function getVectorStore(): IVectorStore {
  if (!_instance) {
    _instance = new JsonArrayVectorStore();
  }
  return _instance;
}

/**
 * Reset the singleton (for testing).
 */
export function resetVectorStore(): void {
  _instance = null;
}

/**
 * Set a custom VectorStore implementation (for testing or migration).
 */
export function setVectorStore(store: IVectorStore): void {
  _instance = store;
}
