/**
 * Quality Dashboard Router
 *
 * Exposes D5.5 per-clip quality review data to the frontend.
 * Protected procedures — only the project owner can view quality data.
 */

import { z } from "zod";
import { router, protectedProcedure } from "./_core/trpc.js";
import { getDb } from "./db.js";
import { clipQualityReviews } from "../drizzle/schema.js";
import { eq, and, desc } from "drizzle-orm";

export const clipQualityRouter = router({
  /**
   * Get episode quality summary (latest attempt per slice).
   */
  getEpisodeSummary: protectedProcedure
    .input(z.object({ episodeId: z.number() }))
    .query(async ({ input }) => {
      const db = (await getDb())!;
      const reviews = await db
        .select()
        .from(clipQualityReviews)
        .where(eq(clipQualityReviews.episodeId, input.episodeId))
        .orderBy(clipQualityReviews.sliceId, desc(clipQualityReviews.attempt));

      // Group by sliceId, keep only latest attempt
      const latestBySlice = new Map<number, typeof reviews[0]>();
      for (const review of reviews) {
        if (!latestBySlice.has(review.sliceId)) {
          latestBySlice.set(review.sliceId, review);
        }
      }

      const latest = Array.from(latestBySlice.values()).sort((a, b) => a.sliceId - b.sliceId);

      const passed = latest.filter((r) => r.passed === 1).length;
      const failed = latest.filter((r) => r.passed === 0 && r.routingDecision !== "escalate").length;
      const escalated = latest.filter((r) => r.routingDecision === "escalate").length;

      const avgScore = latest.length > 0
        ? Math.round((latest.reduce((sum, r) => sum + r.overallScore, 0) / latest.length) * 10) / 10
        : 0;

      return {
        episodeId: input.episodeId,
        totalSlices: latest.length,
        passed,
        failed,
        escalated,
        passRate: latest.length > 0 ? Math.round((passed / latest.length) * 100) : 0,
        avgOverallScore: avgScore,
        canProceedToAssembly: escalated === 0 && failed === 0,
        slices: latest.map((r) => ({
          sliceId: r.sliceId,
          attempt: r.attempt,
          passed: r.passed === 1,
          scores: {
            characterConsistency: r.characterConsistency,
            style: r.styleScore,
            promptAlignment: r.promptAlignment,
            motionQuality: r.motionQuality,
            overall: r.overallScore,
          },
          routingDecision: r.routingDecision,
          issues: r.issues as any[] || [],
          costUsd: parseFloat(r.costUsd as string),
          createdAt: r.createdAt,
        })),
      };
    }),

  /**
   * Get full review history for a specific slice (all attempts).
   */
  getSliceHistory: protectedProcedure
    .input(z.object({ episodeId: z.number(), sliceId: z.number() }))
    .query(async ({ input }) => {
      const db = (await getDb())!;
      const reviews = await db
        .select()
        .from(clipQualityReviews)
        .where(
          and(
            eq(clipQualityReviews.episodeId, input.episodeId),
            eq(clipQualityReviews.sliceId, input.sliceId)
          )
        )
        .orderBy(clipQualityReviews.attempt);

      return reviews.map((r) => ({
        id: r.id,
        sliceId: r.sliceId,
        attempt: r.attempt,
        passed: r.passed === 1,
        scores: {
          characterConsistency: r.characterConsistency,
          style: r.styleScore,
          promptAlignment: r.promptAlignment,
          motionQuality: r.motionQuality,
          overall: r.overallScore,
        },
        issues: r.issues as any[] || [],
        routingDecision: r.routingDecision,
        keyframeUrls: r.keyframeUrls as string[] || [],
        clipUrl: r.clipUrl,
        costUsd: parseFloat(r.costUsd as string),
        durationMs: r.durationMs,
        createdAt: r.createdAt,
      }));
    }),

  /**
   * Get project-level quality stats (for creator analytics).
   */
  getProjectStats: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ input }) => {
      const db = (await getDb())!;
      const reviews = await db
        .select()
        .from(clipQualityReviews)
        .where(eq(clipQualityReviews.projectId, input.projectId))
        .orderBy(desc(clipQualityReviews.createdAt));

      const totalReviews = reviews.length;
      const passedFirstAttempt = reviews.filter((r) => r.passed === 1 && r.attempt === 1).length;
      const totalCost = reviews.reduce((sum, r) => sum + parseFloat(r.costUsd as string), 0);

      // Score distribution
      const scoreDistribution = [0, 0, 0, 0, 0]; // scores 1-5
      for (const r of reviews) {
        if (r.overallScore >= 1 && r.overallScore <= 5) {
          scoreDistribution[r.overallScore - 1]++;
        }
      }

      return {
        projectId: input.projectId,
        totalReviews,
        passedFirstAttempt,
        firstAttemptPassRate: totalReviews > 0 ? Math.round((passedFirstAttempt / totalReviews) * 100) : 0,
        totalCostUsd: Math.round(totalCost * 100) / 100,
        scoreDistribution,
        avgScores: totalReviews > 0 ? {
          characterConsistency: avg(reviews.map((r) => r.characterConsistency)),
          style: avg(reviews.map((r) => r.styleScore)),
          promptAlignment: avg(reviews.map((r) => r.promptAlignment)),
          motionQuality: avg(reviews.map((r) => r.motionQuality)),
          overall: avg(reviews.map((r) => r.overallScore)),
        } : null,
      };
    }),
});

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10;
}
