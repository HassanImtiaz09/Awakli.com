/**
 * LoRA Training Router
 *
 * Provides tRPC procedures for:
 * - Submitting LoRA training requests (pending_admin_approval — NO provider call)
 * - Admin: approve training submission (triggers provider), approve/reject models, manage costs
 * - Checking training status
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

  /** Submit a new training job request (enters pending_admin_approval — NO provider call) */
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
      // Extract style samples (validation only — no provider call)
      const samples = extractStyleSamples(
        input.panelUrls.map(p => ({ url: p.url, sourceType: p.sourceType })),
      );

      if (samples.length < 5) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Only ${samples.length} samples passed quality filter. Need at least 5.`,
        });
      }

      // Compute cost estimate WITHOUT submitting to provider
      const steps = input.configOverrides?.steps || 1000;
      const estimatedCostCents = Math.ceil((steps / 1000) * 80); // ~$0.80 per 1000 steps

      const config = {
        baseModel: "ostris/flux-dev-lora-trainer",
        triggerWord: input.triggerWord,
        steps,
        learningRate: input.configOverrides?.learningRate || 0.0001,
        loraRank: input.configOverrides?.loraRank || 16,
        resolution: input.configOverrides?.resolution || 512,
        batchSize: 1,
        useCaptions: true,
      };

      // Save to DB with pending_admin_approval status (NO externalJobId yet)
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });
      const [inserted] = await db.insert(sakufuuLoraJobs).values({
        creatorId: ctx.user.id,
        projectId: input.projectId || null,
        provider: "replicate",
        externalJobId: null, // Not submitted yet — awaiting admin approval
        status: "pending_admin_approval",
        config,
        sampleCount: samples.length,
        trainingSteps: steps,
        costCents: 0, // Actual cost tracked after submission
        estimatedCostCents,
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
        status: "pending_admin_approval" as const,
        sampleCount: samples.length,
        estimatedCostCents,
        message: "Training request submitted. Awaiting admin approval before provider submission.",
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

  /** Approve a training submission — triggers actual provider.submitTraining() */
  adminApproveTraining: adminProcedure
    .input(z.object({
      jobId: z.number(),
      reason: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [job] = await db
        .select()
        .from(sakufuuLoraJobs)
        .where(eq(sakufuuLoraJobs.id, input.jobId));

      if (!job) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      if (job.status !== "pending_admin_approval") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Can only approve jobs in pending_admin_approval status. Current: ${job.status}`,
        });
      }

      // Now actually submit to provider
      const apiToken = process.env.REPLICATE_API_TOKEN;
      if (!apiToken) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Training provider not configured" });
      }

      // Retrieve the style samples for this job
      const samples = await db
        .select()
        .from(sakufuuStyleSamples)
        .where(eq(sakufuuStyleSamples.trainingJobId, job.id));

      const config = job.config as TrainingConfig;
      const provider = new ReplicateTrainingProvider(apiToken);

      const result = await runTrainingPipeline({
        creatorId: job.creatorId,
        projectId: job.projectId || undefined,
        triggerWord: config.triggerWord,
        genre: (job.metadata as any)?.genre,
        samples: samples.map(s => ({
          url: s.sourceUrl,
          sourceType: (s.sourceType || "panel") as "panel" | "character_sheet" | "cover" | "custom",
          qualityScore: s.qualityScore || 0.6,
        })),
        configOverrides: config,
      }, provider);

      if (result.status === "no_samples") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No valid samples found for training" });
      }

      // Update job with provider submission details
      await db.update(sakufuuLoraJobs)
        .set({
          status: "preparing",
          externalJobId: result.jobId,
          costCents: result.estimatedCostCents,
          adminApprovedBy: ctx.user.id,
          adminApprovedAt: new Date(),
        })
        .where(eq(sakufuuLoraJobs.id, job.id));

      return {
        success: true,
        jobId: job.id,
        externalJobId: result.jobId,
        estimatedCostCents: result.estimatedCostCents,
        message: "Training approved and submitted to provider.",
      };
    }),

  /** Reject a training submission (admin) */
  adminRejectTraining: adminProcedure
    .input(z.object({
      jobId: z.number(),
      reason: z.string().min(1, "Rejection reason required"),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [job] = await db
        .select()
        .from(sakufuuLoraJobs)
        .where(eq(sakufuuLoraJobs.id, input.jobId));

      if (!job) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      if (job.status !== "pending_admin_approval") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Can only reject jobs in pending_admin_approval status. Current: ${job.status}`,
        });
      }

      await db.update(sakufuuLoraJobs)
        .set({
          status: "cancelled",
          errorMessage: `Admin rejected: ${input.reason}`,
          adminApprovedBy: ctx.user.id,
          adminApprovedAt: new Date(),
        })
        .where(eq(sakufuuLoraJobs.id, job.id));

      return { success: true, jobId: job.id, message: "Training request rejected." };
    }),

  /** Get all training jobs (admin) */
  adminListJobs: adminProcedure
    .input(z.object({
      status: z.enum(["pending_admin_approval", "pending", "preparing", "training", "completed", "failed", "cancelled"]).optional(),
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

  /** Approve or reject a trained model for use (admin) — distinct from training approval */
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

      if (!["pending_admin_approval", "pending", "preparing", "training"].includes(job.status)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Can only cancel active jobs" });
      }

      // Cancel on provider if already submitted
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
        pendingApproval: sql<number>`SUM(CASE WHEN status = 'pending_admin_approval' THEN 1 ELSE 0 END)`,
        completedJobs: sql<number>`SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END)`,
        failedJobs: sql<number>`SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END)`,
        totalCostCents: sql<number>`SUM(cost_cents)`,
        totalEstimatedCents: sql<number>`SUM(estimated_cost_cents)`,
        avgCostCents: sql<number>`AVG(cost_cents)`,
        totalDurationSeconds: sql<number>`SUM(duration_seconds)`,
      })
      .from(sakufuuLoraJobs);

    return {
      totalJobs: summary?.totalJobs || 0,
      pendingApproval: summary?.pendingApproval || 0,
      completedJobs: summary?.completedJobs || 0,
      failedJobs: summary?.failedJobs || 0,
      totalCostUsd: ((summary?.totalCostCents || 0) / 100).toFixed(2),
      totalEstimatedUsd: ((summary?.totalEstimatedCents || 0) / 100).toFixed(2),
      avgCostUsd: ((summary?.avgCostCents || 0) / 100).toFixed(2),
      totalTrainingHours: ((summary?.totalDurationSeconds || 0) / 3600).toFixed(1),
    };
  }),
});
