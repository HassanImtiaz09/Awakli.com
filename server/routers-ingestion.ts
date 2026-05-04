/**
 * D10 Craft Library — Ingestion Router
 *
 * Admin-only endpoints for managing web corpus ingestion:
 * - Start/pause ingestion jobs per source
 * - Monitor job progress
 * - View source summary with estimated costs
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "./_core/trpc";
import {
  startIngestion,
  pauseJob,
  getJobState,
  listJobs,
  getSourceSummary,
  type IngestionSourceKey,
} from "./benchmarks/d10/ingestion/orchestrator";

const sourceKeyEnum = z.enum([
  "sakugablog",
  "sakugabooru",
  "animation_obsessive",
  "pixiv_tutorials",
]);

export const ingestionRouter = router({
  /**
   * Get summary of all available ingestion sources.
   * Shows estimated articles, cost, and last job status.
   */
  getSourceSummary: protectedProcedure
    .query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin only" });
      }
      return getSourceSummary();
    }),

  /**
   * Start an ingestion job for a specific source.
   * Returns the job ID for status polling.
   */
  startIngestion: protectedProcedure
    .input(z.object({
      sourceKey: sourceKeyEnum,
      maxItems: z.number().min(1).max(1000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin only" });
      }

      try {
        const jobId = await startIngestion(
          input.sourceKey as IngestionSourceKey,
          input.maxItems,
        );
        return { jobId };
      } catch (err: any) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: err.message,
        });
      }
    }),

  /**
   * Pause a running ingestion job.
   */
  pauseJob: protectedProcedure
    .input(z.object({ jobId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin only" });
      }

      const success = pauseJob(input.jobId);
      if (!success) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Job not found",
        });
      }
      return { success: true };
    }),

  /**
   * Get the current state of a specific job.
   */
  getJobStatus: protectedProcedure
    .input(z.object({ jobId: z.string() }))
    .query(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin only" });
      }

      const state = getJobState(input.jobId);
      if (!state) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Job not found",
        });
      }
      return state;
    }),

  /**
   * List all ingestion jobs (active and recent).
   */
  listJobs: protectedProcedure
    .query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin only" });
      }
      return listJobs();
    }),
});
