/**
 * D10 Craft Library — Retrieval Module
 *
 * Handles semantic search over the craft library chunks.
 * In the foundation phase, this uses keyword-based retrieval (SQL LIKE + scoring).
 * Wave 2 will add Chroma vector embeddings for true semantic search.
 *
 * The retrieval pipeline:
 * 1. Parse query into keywords
 * 2. Search chunks by sub-sensei + keyword match
 * 3. Optionally broaden to cross-tagged sources
 * 4. Score and rank results
 * 5. Return top-K chunks with source attribution
 */

import { getDb } from "../../db";
import { craftLibraryChunks, craftLibrarySources } from "../../../drizzle/schema";
import { eq, and, like, or, sql, desc } from "drizzle-orm";
import type { SubSensei, RetrievedChunk, CraftQuery } from "./types";
import { STAGE_SUB_SENSEI_MAP } from "./types";

/**
 * Extract meaningful keywords from a query string.
 * Strips common stop words and returns unique terms.
 */
function extractKeywords(query: string): string[] {
  const STOP_WORDS = new Set([
    "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "can", "shall", "to", "of", "in", "for",
    "on", "with", "at", "by", "from", "as", "into", "through", "during",
    "before", "after", "above", "below", "between", "out", "off", "over",
    "under", "again", "further", "then", "once", "here", "there", "when",
    "where", "why", "how", "all", "both", "each", "few", "more", "most",
    "other", "some", "such", "no", "nor", "not", "only", "own", "same",
    "so", "than", "too", "very", "just", "and", "but", "or", "if", "while",
    "what", "which", "who", "whom", "this", "that", "these", "those", "it",
  ]);

  return query
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

/**
 * Retrieve relevant chunks from the craft library.
 *
 * Foundation phase: keyword-based SQL search with relevance scoring.
 * Future: Chroma vector similarity search.
 */
export async function retrieveChunks(craftQuery: CraftQuery): Promise<RetrievedChunk[]> {
  const db = await getDb();
  if (!db) return [];

  const keywords = extractKeywords(craftQuery.query);
  if (keywords.length === 0) return [];

  const topK = craftQuery.topK ?? 5;

  // Build sub-sensei filter: primary + optional cross-tags
  const senseiFilters: SubSensei[] = [craftQuery.subSensei];
  if (craftQuery.includeCrossTags) {
    // Include all sub-senseis for cross-tag broadening
    const allSenseis: SubSensei[] = ["anime", "manga", "genga"];
    for (const s of allSenseis) {
      if (!senseiFilters.includes(s)) senseiFilters.push(s);
    }
  }

  // Build keyword LIKE conditions
  const keywordConditions = keywords.map(kw =>
    like(craftLibraryChunks.chunkText, `%${kw}%`)
  );

  // Query chunks with keyword matching
  const results = await db
    .select({
      chunkId: craftLibraryChunks.id,
      sourceId: craftLibraryChunks.sourceId,
      subSensei: craftLibraryChunks.subSensei,
      chunkText: craftLibraryChunks.chunkText,
      chunkIndex: craftLibraryChunks.chunkIndex,
      metadata: craftLibraryChunks.metadata,
      sourceTitle: craftLibrarySources.title,
      sourceAuthor: craftLibrarySources.author,
      sourceType: craftLibrarySources.sourceType,
    })
    .from(craftLibraryChunks)
    .innerJoin(craftLibrarySources, eq(craftLibraryChunks.sourceId, craftLibrarySources.id))
    .where(
      and(
        // Sub-sensei filter
        senseiFilters.length === 1
          ? eq(craftLibraryChunks.subSensei, senseiFilters[0])
          : or(...senseiFilters.map(s => eq(craftLibraryChunks.subSensei, s))),
        // Source must be ingested
        eq(craftLibrarySources.status, "ingested"),
        // At least one keyword match
        or(...keywordConditions),
      )
    )
    .limit(topK * 3); // Over-fetch for scoring

  // Score results by keyword density
  const scored: (typeof results[0] & { relevanceScore: number })[] = results.map(r => {
    const textLower = r.chunkText.toLowerCase();
    let matchCount = 0;
    for (const kw of keywords) {
      if (textLower.includes(kw)) matchCount++;
    }
    // Primary sub-sensei gets a boost
    const senseiBoost = r.subSensei === craftQuery.subSensei ? 0.2 : 0;
    const relevanceScore = Math.min(1, (matchCount / keywords.length) + senseiBoost);
    return { ...r, relevanceScore };
  });

  // Sort by relevance and take top-K
  scored.sort((a, b) => b.relevanceScore - a.relevanceScore);
  const topResults = scored.slice(0, topK);

  return topResults.map(r => ({
    chunkId: r.chunkId,
    sourceId: r.sourceId,
    sourceTitle: r.sourceTitle,
    sourceAuthor: r.sourceAuthor,
    sourceType: r.sourceType as RetrievedChunk["sourceType"],
    subSensei: r.subSensei as SubSensei,
    text: r.chunkText,
    chunkIndex: r.chunkIndex,
    relevanceScore: r.relevanceScore,
    metadata: r.metadata as Record<string, unknown> | null,
  }));
}

/**
 * Get the primary sub-sensei for a given pipeline stage.
 * Falls back to "anime" if the stage is not mapped.
 */
export function getSubSenseiForStage(stage: string): SubSensei {
  return STAGE_SUB_SENSEI_MAP[stage] ?? "anime";
}
