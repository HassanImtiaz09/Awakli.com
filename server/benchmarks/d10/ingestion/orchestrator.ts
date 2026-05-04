/**
 * D10 Craft Library — Ingestion Orchestrator
 *
 * Coordinates the full ingestion pipeline:
 * 1. Source discovery (URL collection)
 * 2. Web scraping (rate-limited, respectful)
 * 3. Chunking (semantic splitting + verbatim guard)
 * 4. Storage (DB records + chunk text)
 *
 * Supports pause/resume and per-source progress tracking.
 */

import { scrapeSakugablog } from "./sakugablog";
import { scrapeSakugabooru } from "./sakugabooru";
import { scrapeAnimationObsessive } from "./animation-obsessive";
import { scrapePixivTutorials } from "./pixiv-tutorials";
import { batchChunkAndStore, type ChunkingStats } from "./chunker";
import type { IngestionProgress, ScrapeResult } from "./scraper";
import type { SubSensei } from "../types";

// ─── Source Registry ───────────────────────────────────────────────────

export type IngestionSourceKey = "sakugablog" | "sakugabooru" | "animation_obsessive" | "pixiv_tutorials";

export interface IngestionSourceConfig {
  key: IngestionSourceKey;
  label: string;
  subSensei: SubSensei;
  sourceType: "web_article" | "tutorial" | "reference_image_set";
  estimatedArticles: number;
  estimatedCostUsd: number;
  scraper: (
    onProgress?: (progress: IngestionProgress) => void,
    shouldAbort?: () => boolean,
    maxItems?: number,
  ) => Promise<ScrapeResult>;
}

export const INGESTION_SOURCES: Record<IngestionSourceKey, IngestionSourceConfig> = {
  sakugablog: {
    key: "sakugablog",
    label: "Sakugablog",
    subSensei: "anime",
    sourceType: "web_article",
    estimatedArticles: 200,
    estimatedCostUsd: 15,
    scraper: scrapeSakugablog,
  },
  sakugabooru: {
    key: "sakugabooru",
    label: "Sakugabooru",
    subSensei: "genga",
    sourceType: "reference_image_set",
    estimatedArticles: 500,
    estimatedCostUsd: 10,
    scraper: scrapeSakugabooru,
  },
  animation_obsessive: {
    key: "animation_obsessive",
    label: "Animation Obsessive",
    subSensei: "anime",
    sourceType: "web_article",
    estimatedArticles: 150,
    estimatedCostUsd: 12,
    scraper: scrapeAnimationObsessive,
  },
  pixiv_tutorials: {
    key: "pixiv_tutorials",
    label: "Pixiv Tutorials",
    subSensei: "manga",
    sourceType: "tutorial",
    estimatedArticles: 200,
    estimatedCostUsd: 8,
    scraper: scrapePixivTutorials,
  },
};

// ─── Ingestion State ───────────────────────────────────────────────────

export interface IngestionJobState {
  id: string;
  sourceKey: IngestionSourceKey;
  status: "queued" | "scraping" | "chunking" | "completed" | "failed" | "paused";
  scrapeProgress: IngestionProgress | null;
  chunkingStats: ChunkingStats | null;
  startedAt: number | null;
  completedAt: number | null;
  error: string | null;
  maxItems?: number;
}

// In-memory job state (per-process, not persisted across restarts)
const activeJobs = new Map<string, IngestionJobState>();
const abortFlags = new Map<string, boolean>();

/**
 * Get the current state of an ingestion job.
 */
export function getJobState(jobId: string): IngestionJobState | null {
  return activeJobs.get(jobId) ?? null;
}

/**
 * List all active/recent ingestion jobs.
 */
export function listJobs(): IngestionJobState[] {
  return Array.from(activeJobs.values()).sort((a, b) =>
    (b.startedAt ?? 0) - (a.startedAt ?? 0)
  );
}

/**
 * Request an ingestion job to pause.
 */
export function pauseJob(jobId: string): boolean {
  if (!activeJobs.has(jobId)) return false;
  abortFlags.set(jobId, true);
  return true;
}

/**
 * Start an ingestion job for a specific source.
 * Returns the job ID for status polling.
 */
export async function startIngestion(
  sourceKey: IngestionSourceKey,
  maxItems?: number,
): Promise<string> {
  const config = INGESTION_SOURCES[sourceKey];
  if (!config) throw new Error(`Unknown source: ${sourceKey}`);

  // Check if already running
  for (const [, job] of Array.from(activeJobs.entries())) {
    if (job.sourceKey === sourceKey && (job.status === "scraping" || job.status === "chunking")) {
      throw new Error(`Ingestion for ${sourceKey} is already running (job ${job.id})`);
    }
  }

  const jobId = `ingest-${sourceKey}-${Date.now()}`;
  const jobState: IngestionJobState = {
    id: jobId,
    sourceKey,
    status: "queued",
    scrapeProgress: null,
    chunkingStats: null,
    startedAt: Date.now(),
    completedAt: null,
    error: null,
    maxItems,
  };

  activeJobs.set(jobId, jobState);
  abortFlags.set(jobId, false);

  // Run asynchronously (fire and forget)
  runIngestionPipeline(jobId, config, maxItems).catch(err => {
    const job = activeJobs.get(jobId);
    if (job) {
      job.status = "failed";
      job.error = err.message;
      job.completedAt = Date.now();
    }
  });

  return jobId;
}

/**
 * Internal: Run the full ingestion pipeline for a job.
 */
async function runIngestionPipeline(
  jobId: string,
  config: IngestionSourceConfig,
  maxItems?: number,
): Promise<void> {
  const job = activeJobs.get(jobId);
  if (!job) return;

  try {
    // Phase 1: Scraping
    job.status = "scraping";

    const scrapeResult = await config.scraper(
      (progress) => {
        job.scrapeProgress = progress;
      },
      () => abortFlags.get(jobId) === true,
      maxItems,
    );

    // Check if paused
    if (abortFlags.get(jobId)) {
      job.status = "paused";
      return;
    }

    // Phase 2: Chunking
    job.status = "chunking";

    const chunkingStats = await batchChunkAndStore(
      scrapeResult.pages,
      config.subSensei,
      config.sourceType,
      (stats) => {
        job.chunkingStats = stats;
      },
    );

    job.chunkingStats = chunkingStats;
    job.status = "completed";
    job.completedAt = Date.now();

    console.log(`[Ingestion] Job ${jobId} completed: ${chunkingStats.totalChunks} chunks, ${chunkingStats.totalTokens} tokens`);
  } catch (err: any) {
    job.status = "failed";
    job.error = err.message;
    job.completedAt = Date.now();
    console.error(`[Ingestion] Job ${jobId} failed:`, err.message);
  }
}

/**
 * Get a summary of all available sources and their estimated costs.
 */
export function getSourceSummary(): Array<{
  key: IngestionSourceKey;
  label: string;
  subSensei: SubSensei;
  estimatedArticles: number;
  estimatedCostUsd: number;
  lastJob: IngestionJobState | null;
}> {
  return Object.values(INGESTION_SOURCES).map(config => {
    // Find the most recent job for this source
    const jobs = Array.from(activeJobs.values())
      .filter(j => j.sourceKey === config.key)
      .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));

    return {
      key: config.key,
      label: config.label,
      subSensei: config.subSensei,
      estimatedArticles: config.estimatedArticles,
      estimatedCostUsd: config.estimatedCostUsd,
      lastJob: jobs[0] ?? null,
    };
  });
}
