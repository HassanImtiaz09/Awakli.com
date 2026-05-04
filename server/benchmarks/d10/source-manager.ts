/**
 * D10 Craft Library — Source Manager
 *
 * CRUD operations for managing knowledge sources in the Craft Library.
 * Handles source registration, status updates, and statistics.
 *
 * Ingestion (chunking + embedding) is a separate pipeline step
 * that will be implemented in Wave 2 with Chroma integration.
 */

import { getDb } from "../../db";
import { craftLibrarySources, craftLibraryChunks } from "../../../drizzle/schema";
import { eq, and, sql, count, sum } from "drizzle-orm";
import type { SubSensei, SourceType, SourceStatus, LibraryStats } from "./types";

// ─── Source CRUD ────────────────────────────────────────────────────────

export interface AddSourceInput {
  subSensei: SubSensei;
  sourceType: SourceType;
  title: string;
  url?: string;
  author?: string;
  description?: string;
  crossTags?: string[];
  metadata?: Record<string, unknown>;
}

export interface UpdateSourceInput {
  id: number;
  status?: SourceStatus;
  errorMessage?: string;
  chunkCount?: number;
  totalTokens?: number;
  metadata?: Record<string, unknown>;
}

export interface ListSourcesFilter {
  subSensei?: SubSensei;
  sourceType?: SourceType;
  status?: SourceStatus;
  limit?: number;
  offset?: number;
}

/**
 * Register a new source in the Craft Library.
 * Starts in "pending" status — ingestion is triggered separately.
 */
export async function addSource(input: AddSourceInput): Promise<{ id: number }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(craftLibrarySources).values({
    subSensei: input.subSensei,
    sourceType: input.sourceType,
    title: input.title,
    url: input.url ?? null,
    author: input.author ?? null,
    description: input.description ?? null,
    crossTags: input.crossTags ?? null,
    metadata: input.metadata ?? null,
  });

  return { id: Number(result[0].insertId) };
}

/**
 * Update a source's status and metadata.
 * Used by the ingestion pipeline to mark progress.
 */
export async function updateSource(input: UpdateSourceInput): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const updates: Record<string, unknown> = {};
  if (input.status !== undefined) updates.status = input.status;
  if (input.errorMessage !== undefined) updates.errorMessage = input.errorMessage;
  if (input.chunkCount !== undefined) updates.chunkCount = input.chunkCount;
  if (input.totalTokens !== undefined) updates.totalTokens = input.totalTokens;
  if (input.metadata !== undefined) updates.metadata = input.metadata;

  if (Object.keys(updates).length === 0) return;

  await db
    .update(craftLibrarySources)
    .set(updates)
    .where(eq(craftLibrarySources.id, input.id));
}

/**
 * List sources with optional filtering.
 */
export async function listSources(filter: ListSourcesFilter = {}) {
  const db = await getDb();
  if (!db) return [];

  const conditions = [];
  if (filter.subSensei) conditions.push(eq(craftLibrarySources.subSensei, filter.subSensei));
  if (filter.sourceType) conditions.push(eq(craftLibrarySources.sourceType, filter.sourceType));
  if (filter.status) conditions.push(eq(craftLibrarySources.status, filter.status));

  const query = db
    .select()
    .from(craftLibrarySources)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(craftLibrarySources.createdAt)
    .limit(filter.limit ?? 50)
    .offset(filter.offset ?? 0);

  return query;
}

/**
 * Get a single source by ID.
 */
export async function getSourceById(id: number) {
  const db = await getDb();
  if (!db) return null;

  const results = await db
    .select()
    .from(craftLibrarySources)
    .where(eq(craftLibrarySources.id, id))
    .limit(1);

  return results[0] ?? null;
}

/**
 * Archive a source (soft delete — keeps chunks but marks source as archived).
 */
export async function archiveSource(id: number): Promise<void> {
  await updateSource({ id, status: "archived" });
}

// ─── Statistics ─────────────────────────────────────────────────────────

/**
 * Get comprehensive library statistics.
 */
export async function getLibraryStats(): Promise<LibraryStats> {
  const db = await getDb();
  if (!db) {
    return {
      totalSources: 0,
      totalChunks: 0,
      totalTokens: 0,
      bySubSensei: {
        anime: { sources: 0, chunks: 0, tokens: 0 },
        manga: { sources: 0, chunks: 0, tokens: 0 },
        genga: { sources: 0, chunks: 0, tokens: 0 },
      },
      byStatus: { pending: 0, ingesting: 0, ingested: 0, failed: 0, archived: 0 },
      bySourceType: {
        web_article: 0, book_chapter: 0, video_transcript: 0,
        tutorial: 0, interview: 0, podcast_transcript: 0, reference_image_set: 0,
      },
    };
  }

  // Aggregate source counts by sub-sensei
  const senseiStats = await db
    .select({
      subSensei: craftLibrarySources.subSensei,
      sourceCount: count(),
      chunkSum: sum(craftLibrarySources.chunkCount),
      tokenSum: sum(craftLibrarySources.totalTokens),
    })
    .from(craftLibrarySources)
    .groupBy(craftLibrarySources.subSensei);

  // Aggregate by status
  const statusStats = await db
    .select({
      status: craftLibrarySources.status,
      count: count(),
    })
    .from(craftLibrarySources)
    .groupBy(craftLibrarySources.status);

  // Aggregate by source type
  const typeStats = await db
    .select({
      sourceType: craftLibrarySources.sourceType,
      count: count(),
    })
    .from(craftLibrarySources)
    .groupBy(craftLibrarySources.sourceType);

  // Build the stats object
  const bySubSensei: LibraryStats["bySubSensei"] = {
    anime: { sources: 0, chunks: 0, tokens: 0 },
    manga: { sources: 0, chunks: 0, tokens: 0 },
    genga: { sources: 0, chunks: 0, tokens: 0 },
  };

  let totalSources = 0;
  let totalChunks = 0;
  let totalTokens = 0;

  for (const row of senseiStats) {
    const key = row.subSensei as SubSensei;
    if (bySubSensei[key]) {
      bySubSensei[key].sources = Number(row.sourceCount);
      bySubSensei[key].chunks = Number(row.chunkSum ?? 0);
      bySubSensei[key].tokens = Number(row.tokenSum ?? 0);
      totalSources += Number(row.sourceCount);
      totalChunks += Number(row.chunkSum ?? 0);
      totalTokens += Number(row.tokenSum ?? 0);
    }
  }

  const byStatus: LibraryStats["byStatus"] = {
    pending: 0, ingesting: 0, ingested: 0, failed: 0, archived: 0,
  };
  for (const row of statusStats) {
    const key = row.status as SourceStatus;
    if (key in byStatus) byStatus[key] = Number(row.count);
  }

  const bySourceType: LibraryStats["bySourceType"] = {
    web_article: 0, book_chapter: 0, video_transcript: 0,
    tutorial: 0, interview: 0, podcast_transcript: 0, reference_image_set: 0,
  };
  for (const row of typeStats) {
    const key = row.sourceType as SourceType;
    if (key in bySourceType) bySourceType[key] = Number(row.count);
  }

  return { totalSources, totalChunks, totalTokens, bySubSensei, byStatus, bySourceType };
}
