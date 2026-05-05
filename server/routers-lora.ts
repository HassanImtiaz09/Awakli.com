/**
 * LoRA Training Router
 *
 * Provides tRPC procedures for:
 * - Submitting LoRA training jobs
 * - Checking training status
 * - Admin: approve/reject models, view queue, manage costs
 * - Creator: view their trained models
 */

import { z } from "zod";
import { router, protectedProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "./db";
import { sakufuuLoraJobs, sakufuuStyleSamples } from "../drizzle/schema";
import { eq, desc, and, sql } from "drizzle-orm";
import {
  extractStyleSamples,
  runTrainingPipeline,
  ReplicateTrainingProvider,
  getCreatorLoraStatus,
  type TrainingConfig,
} from "./benchmarks/sakufuu/lora-training";

// Admin guard
const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
  return next({ ctx });
});

export const loraRouter = router({
  // ─── Creator Procedures ──────────────────────────────────────────────────

  /** Get creator's LoRA training jobs */
  getMyJobs: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
    const jobs = await db
      .select()
      .from(sakufuuLoraJobs)
      .where(eq(sakufuuLoraJobs.creatorId, ctx.user.id))
      .orderBy(desc(sakufuuLoraJobs.createdAt));
    return jobs;
  }),

  /** Get creator's active LoRA model status */
  getMyLoraStatus: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
    const jobs = await db
      .select()
      .from(sakufuuLoraJobs)
      .where(eq(sakufuuLoraJobs.creatorId, ctx.user.id));
    return getCreatorLoraStatus(jobs as any);
  }),

  /** Submit a new training job */
  submitTraining: protectedProcedure
    .input(z.object({
      projectId: z.number().optional(),
      triggerWord: z.string().min(3).max(50),
      genre: z.string().optional(),
      panelUrls: z.array(z.object({
        url: z.string().url(),
        sourceType: z.enum(["panel", "character_sheet", "cover", "custom"]).default("panel"),
      })).min(5, "Minimum 5 images required for training"),
      configOverrides: z.object({
        steps: z.number().min(500).max(4000).optional(),
        learningRate: z.number().min(0.00001).max(0.001).optional(),
        loraRank: z.number().min(4).max(64).optional(),
        resolution: z.number().min(256).max(1024).optional(),
      }).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const apiToken = process.env.REPLICATE_API_TOKEN;
      if (!apiToken) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Training provider not configured" });
      }

      // Extract style samples
      const samples = extractStyleSamples(
        input.panelUrls.map(p => ({ url: p.url, sourceType: p.sourceType })),
      );

      if (samples.length < 5) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Only ${samples.length} samples passed quality filter. Need at least 5.`,
        });
      }

      // Submit training
      const provider = new ReplicateTrainingProvider(apiToken);
      const result = await runTrainingPipeline({
        creatorId: ctx.user.id,
        projectId: input.projectId,
        triggerWord: input.triggerWord,
        genre: input.genre,
        samples,
        configOverrides: input.configOverrides as Partial<TrainingConfig> | undefined,
      }, provider);

      if (result.status === "no_samples") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No valid samples for training" });
      }

      // Save to DB
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [inserted] = await db.insert(sakufuuLoraJobs).values({
        creatorId: ctx.user.id,
        projectId: input.projectId || null,
        provider: "replicate",
        externalJobId: result.jobId,
        status: "preparing",
        config: result.config,
        sampleCount: result.sampleCount,
        trainingSteps: result.config.steps,
        costCents: result.estimatedCostCents,
        metadata: { triggerWord: input.triggerWord, genre: input.genre },
      });

      // Save style samples
      const sampleRecords = samples.map(s => ({
        trainingJobId: inserted.insertId,
        creatorId: ctx.user.id,
        sourceUrl: s.url,
        sourceType: s.sourceType,
        qualityScore: s.qualityScore,
        autoSelected: 1,
        caption: s.caption || null,
      }));

      if (sampleRecords.length > 0) {
        await db.insert(sakufuuStyleSamples).values(sampleRecords);
      }

      return {
        jobId: inserted.insertId,
        externalJobId: result.jobId,
        sampleCount: result.sampleCount,
        estimatedCostCents: result.estimatedCostCents,
      };
    }),

  /** Check status of a training job */
  checkJobStatus: protectedProcedure
    .input(z.object({ jobId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [job] = await db
        .select()
        .from(sakufuuLoraJobs)
        .where(and(
          eq(sakufuuLoraJobs.id, input.jobId),
          eq(sakufuuLoraJobs.creatorId, ctx.user.id),
        ));

      if (!job) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      // If job is in progress, poll provider
      if (job.externalJobId && ["preparing", "training"].includes(job.status)) {
        const apiToken = process.env.REPLICATE_API_TOKEN;
        if (apiToken) {
          const provider = new ReplicateTrainingProvider(apiToken);
          try {
            const status = await provider.getJobStatus(job.externalJobId);

            // Update DB if status changed
            if (status.status === "succeeded" && job.status !== "completed") {
              await db.update(sakufuuLoraJobs)
                .set({
                  status: "completed",
                  modelUrl: status.outputUrl || null,
                  durationSeconds: status.metrics?.elapsedSeconds || null,
                  completedAt: new Date(),
                })
                .where(eq(sakufuuLoraJobs.id, job.id));
              return { ...job, status: "completed" as const, modelUrl: status.outputUrl };
            } else if (status.status === "failed") {
              await db.update(sakufuuLoraJobs)
                .set({ status: "failed", errorMessage: status.error || "Unknown error" })
                .where(eq(sakufuuLoraJobs.id, job.id));
              return { ...job, status: "failed" as const, errorMessage: status.error };
            } else if (status.status === "processing" && job.status === "preparing") {
              await db.update(sakufuuLoraJobs)
                .set({ status: "training", startedAt: new Date() })
                .where(eq(sakufuuLoraJobs.id, job.id));
              return { ...job, status: "training" as const };
            }
          } catch {
            // Provider check failed, return DB state
          }
        }
      }

      return job;
    }),

  // ─── Admin Procedures ────────────────────────────────────────────────────

  /** Get all training jobs (admin) */
  adminListJobs: adminProcedure
    .input(z.object({
      status: z.enum(["pending", "preparing", "training", "completed", "failed", "cancelled"]).optional(),
      limit: z.number().min(1).max(100).default(50),
      offset: z.number().min(0).default(0),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      let query = db.select().from(sakufuuLoraJobs).orderBy(desc(sakufuuLoraJobs.createdAt));

      if (input.status) {
        query = query.where(eq(sakufuuLoraJobs.status, input.status)) as typeof query;
      }

      const jobs = await query.limit(input.limit).offset(input.offset);

      // Get total count
      const [countResult] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(sakufuuLoraJobs);

      return { jobs, total: countResult?.count || 0 };
    }),

  /** Approve or reject a trained model (admin) */
  adminApproveModel: adminProcedure
    .input(z.object({
      jobId: z.number(),
      decision: z.enum(["approved", "rejected"]),
      reason: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [job] = await db
        .select()
        .from(sakufuuLoraJobs)
        .where(eq(sakufuuLoraJobs.id, input.jobId));

      if (!job) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      if (job.status !== "completed") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Can only approve/reject completed jobs" });
      }

      await db.update(sakufuuLoraJobs)
        .set({ approved: input.decision })
        .where(eq(sakufuuLoraJobs.id, input.jobId));

      return { success: true, jobId: input.jobId, decision: input.decision };
    }),

  /** Cancel a training job (admin) */
  adminCancelJob: adminProcedure
    .input(z.object({ jobId: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [job] = await db
        .select()
        .from(sakufuuLoraJobs)
        .where(eq(sakufuuLoraJobs.id, input.jobId));

      if (!job) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      if (!["pending", "preparing", "training"].includes(job.status)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Can only cancel active jobs" });
      }

      // Cancel on provider
      if (job.externalJobId) {
        const apiToken = process.env.REPLICATE_API_TOKEN;
        if (apiToken) {
          const provider = new ReplicateTrainingProvider(apiToken);
          try {
            await provider.cancelJob(job.externalJobId);
          } catch {
            // Best effort
          }
        }
      }

      await db.update(sakufuuLoraJobs)
        .set({ status: "cancelled" })
        .where(eq(sakufuuLoraJobs.id, input.jobId));

      return { success: true };
    }),

  /** Get training cost summary (admin) */
  adminCostSummary: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
    const [summary] = await db
      .select({
        totalJobs: sql<number>`COUNT(*)`,
        completedJobs: sql<number>`SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END)`,
        failedJobs: sql<number>`SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END)`,
        totalCostCents: sql<number>`SUM(cost_cents)`,
        avgCostCents: sql<number>`AVG(cost_cents)`,
        totalDurationSeconds: sql<number>`SUM(duration_seconds)`,
      })
      .from(sakufuuLoraJobs);

    return {
      totalJobs: summary?.totalJobs || 0,
      completedJobs: summary?.completedJobs || 0,
      failedJobs: summary?.failedJobs || 0,
      totalCostUsd: ((summary?.totalCostCents || 0) / 100).toFixed(2),
      avgCostUsd: ((summary?.avgCostCents || 0) / 100).toFixed(2),
      totalTrainingHours: ((summary?.totalDurationSeconds || 0) / 3600).toFixed(1),
    };
  }),
});
