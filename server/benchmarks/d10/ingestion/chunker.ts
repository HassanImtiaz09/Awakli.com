/**
 * D10 Craft Library — Chunking Pipeline
 *
 * Splits scraped articles into semantic chunks suitable for RAG retrieval.
 * Each chunk is tagged with sub-sensei + cross-tags and validated against
 * the verbatim guard before storage.
 *
 * Chunking strategy:
 * - Split on paragraph boundaries (double newline)
 * - Target chunk size: 300-800 tokens (~1200-3200 chars)
 * - Overlap: 50 tokens between chunks for context continuity
 * - Preserve heading context in each chunk
 */

import { getDb } from "../../../db";
import { craftLibrarySources, craftLibraryChunks } from "../../../../drizzle/schema";
import { eq } from "drizzle-orm";
import { checkVerbatimOverlap } from "../verbatim-guard";
import type { ScrapedPage } from "./scraper";
import type { SubSensei } from "../types";

const TARGET_CHUNK_CHARS = 2000; // ~500 tokens
const MAX_CHUNK_CHARS = 3200;    // ~800 tokens
const MIN_CHUNK_CHARS = 400;     // ~100 tokens
const OVERLAP_CHARS = 200;       // ~50 tokens

export interface ChunkResult {
  sourceId: number;
  chunksCreated: number;
  totalTokens: number;
  verbatimFlags: number;
  errors: string[];
}

export interface ChunkingStats {
  totalProcessed: number;
  totalChunks: number;
  totalTokens: number;
  totalVerbatimFlags: number;
  errors: string[];
}

/**
 * Estimate token count from character count.
 * Rough heuristic: 1 token ≈ 4 characters for English text.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Split text into paragraphs, preserving heading context.
 */
function splitIntoParagraphs(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map(p => p.trim())
    .filter(p => p.length > 0);
}

/**
 * Merge short paragraphs into chunks of target size.
 * Maintains heading context by prepending the last seen heading.
 */
function mergeIntoChunks(paragraphs: string[]): string[] {
  const chunks: string[] = [];
  let currentChunk = "";
  let lastHeading = "";

  for (const para of paragraphs) {
    // Detect headings (short lines, often capitalized or with special chars)
    const isHeading = para.length < 100 && (
      para.match(/^[A-Z#]/) ||
      para.match(/^[\u2014\u2013\u2012]/) ||
      para.endsWith(":")
    );

    if (isHeading) {
      lastHeading = para;
    }

    const wouldBeSize = currentChunk.length + para.length + 2;

    if (wouldBeSize > MAX_CHUNK_CHARS && currentChunk.length >= MIN_CHUNK_CHARS) {
      // Current chunk is full — save it
      chunks.push(currentChunk.trim());

      // Start new chunk with overlap (last paragraph) + heading context
      const overlapText = currentChunk.slice(-OVERLAP_CHARS);
      currentChunk = lastHeading
        ? `[Context: ${lastHeading}]\n\n${overlapText}\n\n${para}`
        : `${overlapText}\n\n${para}`;
    } else {
      currentChunk = currentChunk ? `${currentChunk}\n\n${para}` : para;
    }
  }

  // Don't forget the last chunk
  if (currentChunk.trim().length >= MIN_CHUNK_CHARS) {
    chunks.push(currentChunk.trim());
  } else if (chunks.length > 0 && currentChunk.trim().length > 0) {
    // Merge tiny remainder into last chunk
    chunks[chunks.length - 1] += "\n\n" + currentChunk.trim();
  }

  return chunks;
}

/**
 * Process a single scraped page into chunks and store them.
 */
export async function chunkAndStore(
  page: ScrapedPage,
  sourceId: number,
  subSensei: SubSensei,
  existingSourceTexts?: string[],
): Promise<ChunkResult> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const errors: string[] = [];
  let verbatimFlags = 0;

  // Split into paragraphs and merge into chunks
  const paragraphs = splitIntoParagraphs(page.content);
  const chunks = mergeIntoChunks(paragraphs);

  let totalTokens = 0;
  let chunksCreated = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunkText = chunks[i];
    const tokenCount = estimateTokens(chunkText);
    totalTokens += tokenCount;

    // Run verbatim guard if we have source texts to compare against
    if (existingSourceTexts && existingSourceTexts.length > 0) {
      const verbatimCheck = checkVerbatimOverlap(chunkText, existingSourceTexts);
      if (!verbatimCheck.passed) {
        verbatimFlags++;
        errors.push(`Chunk ${i}: verbatim overlap ${(verbatimCheck.overlapRatio * 100).toFixed(1)}% (threshold 25%)`);
        continue; // Skip this chunk — too much verbatim content
      }
    }

    // Store the chunk
    try {
      await db.insert(craftLibraryChunks).values({
        sourceId,
        subSensei,
        chunkText,
        chunkIndex: i,
        tokenCount,
        metadata: {
          pageTitle: page.title,
          pageUrl: page.url,
          author: page.author,
          tags: page.tags,
          chunkOf: chunks.length,
        },
      });
      chunksCreated++;
    } catch (err: any) {
      errors.push(`Chunk ${i}: storage error — ${err.message}`);
    }
  }

  // Update source record with chunk/token counts
  try {
    await db
      .update(craftLibrarySources)
      .set({
        chunkCount: chunksCreated,
        totalTokens,
        status: "ingested",
        lastFetchedAt: new Date(),
      })
      .where(eq(craftLibrarySources.id, sourceId));
  } catch (err: any) {
    errors.push(`Source update error: ${err.message}`);
  }

  return {
    sourceId,
    chunksCreated,
    totalTokens,
    verbatimFlags,
    errors,
  };
}

/**
 * Process multiple scraped pages in batch.
 * Registers each as a source, then chunks and stores.
 */
export async function batchChunkAndStore(
  pages: ScrapedPage[],
  subSensei: SubSensei,
  sourceType: "web_article" | "tutorial" | "reference_image_set",
  onProgress?: (stats: ChunkingStats) => void,
): Promise<ChunkingStats> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const stats: ChunkingStats = {
    totalProcessed: 0,
    totalChunks: 0,
    totalTokens: 0,
    totalVerbatimFlags: 0,
    errors: [],
  };

  for (const page of pages) {
    try {
      // Register the source
      const result = await db.insert(craftLibrarySources).values({
        subSensei,
        sourceType,
        title: page.title,
        url: page.url,
        author: page.author ?? null,
        description: page.content.slice(0, 500),
        crossTags: (page.metadata?.crossTags as string[]) ?? null,
        status: "ingesting",
        metadata: page.metadata ?? null,
      });

      const sourceId = Number(result[0].insertId);

      // Chunk and store
      const chunkResult = await chunkAndStore(page, sourceId, subSensei);

      stats.totalChunks += chunkResult.chunksCreated;
      stats.totalTokens += chunkResult.totalTokens;
      stats.totalVerbatimFlags += chunkResult.verbatimFlags;
      stats.errors.push(...chunkResult.errors);
    } catch (err: any) {
      stats.errors.push(`Page "${page.title}": ${err.message}`);
    }

    stats.totalProcessed++;
    onProgress?.(stats);
  }

  return stats;
}
