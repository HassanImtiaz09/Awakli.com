/**
 * D5.5 · Database Helpers
 *
 * Persists per-clip quality review results to the clip_quality_reviews table.
 * Provides query helpers for the frontend quality dashboard.
 */

import { eq, and, desc, sql } from "drizzle-orm";
import { getDb } from "../../db.js";
import { clipQualityReviews } from "../../../drizzle/schema.js";
import type { D5_5ReviewResult } from "./per-clip-reviewer.js";
import type { InsertClipQualityReview, ClipQualityReview } from "../../../drizzle/schema.js";
import crypto from "crypto";

// ─── Write Helpers ──────────────────────────────────────────────────────────

/**
 * Persist a D5.5 review result to the database.
 */
export async function saveClipReview(
  review: D5_5ReviewResult,
  context: {
    episodeId: number;
    projectId: number;
    pipelineRunId?: number;
    clipUrl?: string;
    keyframeUrls?: string[];
    characterBibleHash?: string;
    styleLockHash?: string;
    passThreshold?: number;
  }
): Promise<number> {
  const db = (await getDb())!;

  const record: InsertClipQualityReview = {
    episodeId: context.episodeId,
    projectId: context.projectId,
    sliceId: review.sliceId,
    pipelineRunId: context.pipelineRunId ?? null,
    attempt: review.attempt,
    characterConsistency: review.scores.character_consistency,
    styleScore: review.scores.style,
    promptAlignment: review.scores.prompt_alignment,
    motionQuality: review.scores.motion_quality,
    overallScore: review.overallScore,
    passed: review.passed ? 1 : 0,
    passThreshold: context.passThreshold ?? 3,
    issues: review.issues,
    keyframeUrls: context.keyframeUrls ?? null,
    clipUrl: context.clipUrl ?? null,
    characterBibleHash: context.characterBibleHash ?? null,
    styleLockHash: context.styleLockHash ?? null,
    routingDecision: review.routingDecision,
    costUsd: review.costUsd.toFixed(4),
    durationMs: review.durationMs,
  };

  const [result] = await db.insert(clipQualityReviews).values(record);
  return result.insertId;
}

/**
 * Save multiple reviews in a batch (for batch D5.5 results).
 */
export async function saveClipReviewBatch(
  reviews: D5_5ReviewResult[],
  context: {
    episodeId: number;
    projectId: number;
    pipelineRunId?: number;
    passThreshold?: number;
  }
): Promise<number[]> {
  const ids: number[] = [];
  for (const review of reviews) {
    const id = await saveClipReview(review, context);
    ids.push(id);
  }
  return ids;
}

// ─── Read Helpers ───────────────────────────────────────────────────────────

/**
 * Get all reviews for an episode (latest attempt per slice).
 */
export async function getEpisodeReviews(episodeId: number) {
  const db = (await getDb())!;
  const reviews = await db
    .select()
    .from(clipQualityReviews)
    .where(eq(clipQualityReviews.episodeId, episodeId))
    .orderBy(clipQualityReviews.sliceId, desc(clipQualityReviews.attempt));

  // Group by sliceId, keep only latest attempt
  const latestBySlice = new Map<number, typeof reviews[0]>();
  for (const review of reviews) {
    if (!latestBySlice.has(review.sliceId)) {
      latestBySlice.set(review.sliceId, review);
    }
  }

  return Array.from(latestBySlice.values()).sort((a, b) => a.sliceId - b.sliceId);
}

/**
 * Get full review history for a specific slice (all attempts).
 */
export async function getSliceReviewHistory(episodeId: number, sliceId: number) {
  const db = (await getDb())!;
  return db
    .select()
    .from(clipQualityReviews)
    .where(
      and(
        eq(clipQualityReviews.episodeId, episodeId),
        eq(clipQualityReviews.sliceId, sliceId)
      )
    )
    .orderBy(clipQualityReviews.attempt);
}

/**
 * Get episode-level quality summary (for dashboard).
 */
export async function getEpisodeQualitySummary(episodeId: number) {
  const reviews = await getEpisodeReviews(episodeId);

  if (reviews.length === 0) {
    return null;
  }

  const passed = reviews.filter((r) => r.passed === 1).length;
  const failed = reviews.filter((r) => r.passed === 0 && r.routingDecision !== "escalate").length;
  const escalated = reviews.filter((r) => r.routingDecision === "escalate").length;

  const avgScores = {
    characterConsistency: avg(reviews.map((r) => r.characterConsistency)),
    style: avg(reviews.map((r) => r.styleScore)),
    promptAlignment: avg(reviews.map((r) => r.promptAlignment)),
    motionQuality: avg(reviews.map((r) => r.motionQuality)),
    overall: avg(reviews.map((r) => r.overallScore)),
  };

  const totalCost = reviews.reduce((sum, r) => sum + parseFloat(r.costUsd as string), 0);

  return {
    episodeId,
    totalSlices: reviews.length,
    passed,
    failed,
    escalated,
    passRate: reviews.length > 0 ? (passed / reviews.length) * 100 : 0,
    avgScores,
    totalCostUsd: totalCost,
    canProceedToAssembly: escalated === 0 && failed === 0,
  };
}

/**
 * Get project-level quality stats (for creator analytics).
 */
export async function getProjectQualityStats(projectId: number) {
  const db = await getDb();
  const reviews: ClipQualityReview[] = await db!
    .select()
    .from(clipQualityReviews)
    .where(eq(clipQualityReviews.projectId, projectId))
    .orderBy(desc(clipQualityReviews.createdAt));

  const totalReviews = reviews.length;
  const passedFirstAttempt = reviews.filter((r: ClipQualityReview) => r.passed === 1 && r.attempt === 1).length;
  const totalCost = reviews.reduce((sum: number, r: ClipQualityReview) => sum + parseFloat(r.costUsd as string), 0);
  const avgAttempts = reviews.length > 0
    ? reviews.reduce((sum: number, r: ClipQualityReview) => sum + r.attempt, 0) / reviews.length
    : 0;

  return {
    projectId,
    totalReviews,
    passedFirstAttempt,
    firstAttemptPassRate: totalReviews > 0 ? (passedFirstAttempt / totalReviews) * 100 : 0,
    avgAttempts,
    totalCostUsd: totalCost,
    avgScores: {
      characterConsistency: avg(reviews.map((r: ClipQualityReview) => r.characterConsistency)),
      style: avg(reviews.map((r: ClipQualityReview) => r.styleScore)),
      promptAlignment: avg(reviews.map((r: ClipQualityReview) => r.promptAlignment)),
      motionQuality: avg(reviews.map((r: ClipQualityReview) => r.motionQuality)),
      overall: avg(reviews.map((r: ClipQualityReview) => r.overallScore)),
    },
  };
}

// ─── Utility ────────────────────────────────────────────────────────────────

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10;
}

/**
 * Compute SHA-256 hash of a character bible or style_lock for change detection.
 */
export function computeHash(data: any): string {
  return crypto.createHash("sha256").update(JSON.stringify(data)).digest("hex");
}
