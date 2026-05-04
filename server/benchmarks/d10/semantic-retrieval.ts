/**
 * D10 Semantic Retrieval — VectorStore-backed search for D-agent consumption
 *
 * This module provides the high-level retrieval API that D-agents call.
 * It wraps the VectorStore interface with domain-specific query construction,
 * sub-sensei routing, and result formatting.
 *
 * Usage by D-agents:
 *   import { semanticSearch, searchBySubSensei } from "./semantic-retrieval";
 *   const results = await semanticSearch("sakuga timing techniques for mecha");
 *   const gengaResults = await searchBySubSensei("D10.G", "key animation spacing");
 */

import { getVectorStore, SearchResult, SearchOptions } from "./vector-store";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface RetrievalResult {
  chunkId: string;
  content: string;
  relevanceScore: number;
  source: string;
  subSensei: string;
  tags: string[];
}

export interface RetrievalOptions {
  topK?: number;
  threshold?: number;
  subSensei?: string;
  tags?: string[];
  sourceType?: string;
}

// ─── Sub-Sensei Routing ─────────────────────────────────────────────────────

const SUB_SENSEI_QUERY_PREFIXES: Record<string, string> = {
  "D10.A": "animation technique, sakuga, anime production workflow",
  "D10.G": "genga, key animation, keyframe drawing, spacing, timing",
  "D10.M": "manga composition, panel layout, inking, toning, screentone",
};

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * General semantic search across the entire craft library.
 * Used when a D-agent needs broad knowledge retrieval.
 */
export async function semanticSearch(
  query: string,
  options?: RetrievalOptions
): Promise<RetrievalResult[]> {
  const store = getVectorStore();

  const searchOpts: SearchOptions = {
    topK: options?.topK ?? 5,
    threshold: options?.threshold ?? 0.7,
  };

  // Build metadata filter
  if (options?.subSensei || options?.sourceType) {
    const filter: Record<string, unknown> = {};
    if (options.subSensei) filter.subSensei = options.subSensei;
    if (options.sourceType) filter.sourceType = options.sourceType;
    searchOpts.filter = filter;
  }

  const results = await store.search(query, searchOpts);
  return results.map(formatResult);
}

/**
 * Search within a specific sub-sensei's domain.
 * Automatically prepends domain-relevant context to the query.
 */
export async function searchBySubSensei(
  subSensei: string,
  query: string,
  options?: Omit<RetrievalOptions, "subSensei">
): Promise<RetrievalResult[]> {
  const prefix = SUB_SENSEI_QUERY_PREFIXES[subSensei] || "";
  const enhancedQuery = prefix ? `${prefix}: ${query}` : query;

  return semanticSearch(enhancedQuery, {
    ...options,
    subSensei,
  });
}

/**
 * Search by tags (combines semantic search with tag filtering).
 */
export async function searchByTags(
  query: string,
  tags: string[],
  options?: Omit<RetrievalOptions, "tags">
): Promise<RetrievalResult[]> {
  // For tag-based search, we use the VectorStore's metadata filter
  const store = getVectorStore();

  const searchOpts: SearchOptions = {
    topK: options?.topK ?? 10,
    threshold: options?.threshold ?? 0.65,
    filter: { tags }, // The implementation will need to handle array-contains
  };

  const results = await store.search(query, searchOpts);
  return results.map(formatResult);
}

/**
 * Embed new chunks into the vector store.
 * Called by the ingestion orchestrator after chunking.
 */
export async function embedChunks(
  chunks: Array<{
    id: string;
    content: string;
    metadata?: Record<string, unknown>;
  }>
): Promise<{ embedded: number; failed: number }> {
  const store = getVectorStore();
  let embedded = 0;
  let failed = 0;

  // Process in batches of 10 to avoid overwhelming the LLM API
  const batchSize = 10;
  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    try {
      await store.upsert(
        batch.map((c) => ({
          id: c.id,
          content: c.content,
          metadata: c.metadata,
        }))
      );
      embedded += batch.length;
    } catch (error) {
      console.error(`[D10] Embedding batch ${i / batchSize} failed:`, error);
      failed += batch.length;
    }
  }

  return { embedded, failed };
}

/**
 * Get the current embedding count (for monitoring).
 */
export async function getEmbeddingCount(): Promise<number> {
  const store = getVectorStore();
  return store.count();
}

// ─── Private Helpers ────────────────────────────────────────────────────────

function formatResult(result: SearchResult): RetrievalResult {
  const metadata = result.metadata || {};
  return {
    chunkId: result.id,
    content: result.content,
    relevanceScore: result.score,
    source: (metadata.sourceUrl as string) || (metadata.source as string) || "unknown",
    subSensei: (metadata.subSensei as string) || "D10.A",
    tags: (metadata.tags as string[]) || [],
  };
}
