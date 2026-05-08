/**
 * Prompt 21: Character Library & LoRA Training Router
 * 
 * Endpoints:
 * - list, getById, create, update, delete
 * - trainLora, batchTrain, getTrainingStatus, getBatchStatus
 * - reviewLora, getVersionHistory, rollbackVersion
 * - getAssets, getUsageStats
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, adminProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import { eq, and, desc, asc, sql, inArray } from "drizzle-orm";
import {
  characterLibrary, characterLoras, loraTrainingJobs, characterAssets,
  pipelineRunLoraPins, generationRequests, fixDriftJobs,
  type InsertCharacterLibraryEntry, type InsertCharacterLora,
  type InsertLoraTrainingJob, type InsertCharacterAsset,
  type InsertFixDriftJob,
} from "../drizzle/schema";
import {
  preprocessCharacterSheet,
  buildKohyaConfig,
  buildKohyaArgs,
  buildTriggerWord,
  estimateTrainingJob,
  estimateBatchTraining,
  assignPriority,
  generateBatchId,
  getLoraArtifactPath,
  estimateLoraFileSize,
  clipToQualityScore,
  getValidationDecision,
  runValidation,
  generateValidationPrompts,
  getConsistencyMechanism,
  buildLoraInjectionPayload,
  shouldRetrain,
  previewExtraction,
  compareLoraVersions,
  type TrainingJobEstimate,
  type ValidationResult,
} from "./lora-training-pipeline";
import {
  aggregateCharacterReport,
  getFrameDriftDetail,
  DEFAULT_DRIFT_THRESHOLD,
  type FrameGeneration,
  type FrameDriftResult,
} from "./consistency-analysis";
import {
  computeBoostParams,
  buildFixDriftJob,
  estimateFixDriftBatch,
  simulateFixDriftStatus,
  formatDuration,
} from "./fix-drift";
import {
  episodes, scenes, generationResults,
} from "../drizzle/schema";
import { gte } from "drizzle-orm";

// ─── Character Library Router ───────────────────────────────────────────

export const characterLibraryRouter = router({

  // ── List characters ───────────────────────────────────────────────────
  list: protectedProcedure
    .input(z.object({
      seriesId: z.number().optional(),
      sortBy: z.enum(["name", "lastUsed", "createdAt"]).default("createdAt"),
      sortOrder: z.enum(["asc", "desc"]).default("desc"),
    }).optional())
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return [];

      const filters = [eq(characterLibrary.userId, ctx.user.id)];
      if (input?.seriesId) {
        filters.push(eq(characterLibrary.seriesId, input.seriesId));
      }

      const orderCol = input?.sortBy === "name"
        ? characterLibrary.name
        : input?.sortBy === "lastUsed"
          ? characterLibrary.updatedAt
          : characterLibrary.createdAt;

      const orderFn = input?.sortOrder === "asc" ? asc : desc;

      const results = await db.select()
        .from(characterLibrary)
        .where(and(...filters))
        .orderBy(orderFn(orderCol));

      return results;
    }),

  // ── Get by ID ─────────────────────────────────────────────────────────
  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [char] = await db.select()
        .from(characterLibrary)
        .where(and(eq(characterLibrary.id, input.id), eq(characterLibrary.userId, ctx.user.id)))
        .limit(1);

      if (!char) throw new TRPCError({ code: "NOT_FOUND", message: "Character not found" });

      // Fetch active LoRA details
      let activeLora = null;
      if (char.activeLoraId) {
        const [lora] = await db.select()
          .from(characterLoras)
          .where(eq(characterLoras.id, char.activeLoraId))
          .limit(1);
        activeLora = lora || null;
      }

      // Fetch version count
      const [versionCount] = await db.select({ count: sql<number>`COUNT(*)` })
        .from(characterLoras)
        .where(eq(characterLoras.characterId, input.id));

      // Fetch assets count
      const [assetCount] = await db.select({ count: sql<number>`COUNT(*)` })
        .from(characterAssets)
        .where(and(eq(characterAssets.characterId, input.id), eq(characterAssets.isActive, 1)));

      return {
        ...char,
        activeLora,
        versionCount: versionCount?.count ?? 0,
        assetCount: assetCount?.count ?? 0,
      };
    }),

  // ── Create character ──────────────────────────────────────────────────
  create: protectedProcedure
    .input(z.object({
      name: z.string().min(1).max(255),
      seriesId: z.number().optional(),
      description: z.string().optional(),
      appearanceTags: z.record(z.string(), z.string()).optional(),
      referenceSheetUrl: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const values: InsertCharacterLibraryEntry = {
        userId: ctx.user.id,
        name: input.name,
        seriesId: input.seriesId ?? null,
        description: input.description ?? null,
        appearanceTags: input.appearanceTags ?? null,
        referenceSheetUrl: input.referenceSheetUrl ?? null,
        loraStatus: "untrained",
      };

      const [result] = await db.insert(characterLibrary).values(values);
      const insertId = (result as any).insertId as number;

      // If reference sheet provided, create the asset record
      if (input.referenceSheetUrl) {
        await db.insert(characterAssets).values({
          characterId: insertId,
          assetType: "reference_sheet",
          storageUrl: input.referenceSheetUrl,
          version: 1,
          metadata: { source: "upload" },
          isActive: 1,
        });
      }

      return { id: insertId, name: input.name };
    }),

  // ── Update character ──────────────────────────────────────────────────
  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().min(1).max(255).optional(),
      description: z.string().optional(),
      appearanceTags: z.record(z.string(), z.string()).optional(),
      referenceSheetUrl: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // Verify ownership
      const [existing] = await db.select()
        .from(characterLibrary)
        .where(and(eq(characterLibrary.id, input.id), eq(characterLibrary.userId, ctx.user.id)))
        .limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Character not found" });

      const updateData: Record<string, any> = {};
      if (input.name !== undefined) updateData.name = input.name;
      if (input.description !== undefined) updateData.description = input.description;
      if (input.appearanceTags !== undefined) updateData.appearanceTags = input.appearanceTags;

      // Check if reference sheet changed (triggers retraining check)
      let sheetChanged = false;
      if (input.referenceSheetUrl !== undefined && input.referenceSheetUrl !== existing.referenceSheetUrl) {
        updateData.referenceSheetUrl = input.referenceSheetUrl;
        sheetChanged = true;

        // If LoRA was active, mark as needs_retraining
        if (existing.loraStatus === "active") {
          updateData.loraStatus = "needs_retraining";
        }

        // Create new asset record
        await db.insert(characterAssets).values({
          characterId: input.id,
          assetType: "reference_sheet",
          storageUrl: input.referenceSheetUrl,
          version: 1,
          metadata: { source: "update", previousUrl: existing.referenceSheetUrl },
          isActive: 1,
        });
      }

      if (Object.keys(updateData).length > 0) {
        await db.update(characterLibrary)
          .set(updateData)
          .where(eq(characterLibrary.id, input.id));
      }

      return { id: input.id, updated: true, sheetChanged };
    }),

  // ── Delete character ──────────────────────────────────────────────────
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [existing] = await db.select()
        .from(characterLibrary)
        .where(and(eq(characterLibrary.id, input.id), eq(characterLibrary.userId, ctx.user.id)))
        .limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Character not found" });

      // Cascade delete handles loras, jobs, assets, pins
      await db.delete(characterLibrary).where(eq(characterLibrary.id, input.id));

      return { deleted: true };
    }),

  // ── Train LoRA ────────────────────────────────────────────────────────
  trainLora: protectedProcedure
    .input(z.object({
      characterId: z.number(),
      gpuType: z.enum(["h100_sxm", "a100_80gb", "rtx_4090"]).default("h100_sxm"),
      rank: z.number().min(16).max(64).default(32),
      alpha: z.number().min(8).max(32).default(16),
      learningRate: z.number().min(5e-5).max(3e-4).default(1e-4),
      trainingSteps: z.number().min(500).max(1500).default(800),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // Verify ownership and get character
      const [char] = await db.select()
        .from(characterLibrary)
        .where(and(eq(characterLibrary.id, input.characterId), eq(characterLibrary.userId, ctx.user.id)))
        .limit(1);
      if (!char) throw new TRPCError({ code: "NOT_FOUND", message: "Character not found" });

      if (!char.referenceSheetUrl) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Character must have a reference sheet before training" });
      }

      if (char.loraStatus === "training" || char.loraStatus === "validating" || char.loraStatus === "pending_admin_approval") {
        throw new TRPCError({ code: "CONFLICT", message: "Training already in progress or pending approval for this character" });
      }

      // Determine next version
      const [maxVersion] = await db.select({ max: sql<number>`COALESCE(MAX(version), 0)` })
        .from(characterLoras)
        .where(eq(characterLoras.characterId, input.characterId));
      const nextVersion = (maxVersion?.max ?? 0) + 1;

      const triggerWord = buildTriggerWord(char.name);
      const artifactPath = getLoraArtifactPath(input.characterId, nextVersion);
      const fileSizeEstimate = estimateLoraFileSize(input.rank);

      // Create LoRA record
      const trainingParams = {
        rank: input.rank,
        alpha: input.alpha,
        learningRate: input.learningRate,
        trainingSteps: input.trainingSteps,
        gpuType: input.gpuType,
        baseModel: "Anything V5",
        optimizer: "AdamW8bit",
        scheduler: "cosine_with_restarts",
      };

      const [loraResult] = await db.insert(characterLoras).values({
        characterId: input.characterId,
        version: nextVersion,
        artifactPath,
        artifactSizeBytes: fileSizeEstimate.avgBytes,
        trainingParams,
        triggerWord,
        status: "training",
        validationStatus: "pending",
      });
      const loraId = (loraResult as any).insertId as number;

      // Compute cost estimate WITHOUT submitting to provider
      const estimate = estimateTrainingJob(input.gpuType, input.trainingSteps);
      const estimatedCostCents = Math.round(estimate.withMargin.costUsd * 100);

      // Create training job with pending_admin_approval (NO provider call)
      const [jobResult] = await db.insert(loraTrainingJobs).values({
        characterId: input.characterId,
        loraId,
        userId: ctx.user.id,
        status: "pending_admin_approval",
        priority: 1,
        gpuType: input.gpuType,
        costUsd: String(estimate.withMargin.costUsd),
        costCredits: String(estimate.withMargin.costCredits),
        estimatedCostCents,
      });
      const jobId = (jobResult as any).insertId as number;

      // Update character status to pending_admin_approval
      await db.update(characterLibrary)
        .set({ loraStatus: "pending_admin_approval" })
        .where(eq(characterLibrary.id, input.characterId));

      // Preprocess the dataset
      const dataset = preprocessCharacterSheet(
        char.referenceSheetUrl,
        char.name,
        (char.appearanceTags as Record<string, string>) ?? {}
      );

      return {
        jobId,
        loraId,
        version: nextVersion,
        triggerWord,
        status: "pending_admin_approval" as const,
        estimatedCostCents,
        estimate,
        dataset: {
          totalImages: dataset.totalImages,
          triggerWord: dataset.triggerWord,
        },
        message: "Training request submitted. Awaiting admin approval before provider submission.",
      };
    }),

  // ── Batch Train ───────────────────────────────────────────────────────
  batchTrain: protectedProcedure
    .input(z.object({
      characterIds: z.array(z.number()).min(1).max(20),
      gpuType: z.enum(["h100_sxm", "a100_80gb", "rtx_4090"]).default("h100_sxm"),
      priorityOverrides: z.record(z.string(), z.number()).optional(), // characterId -> priority
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // Verify ownership of all characters
      const chars = await db.select()
        .from(characterLibrary)
        .where(and(
          inArray(characterLibrary.id, input.characterIds),
          eq(characterLibrary.userId, ctx.user.id)
        ));

      if (chars.length !== input.characterIds.length) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Some characters not found or not owned by you" });
      }

      // Check all have reference sheets
      const missingSheets = chars.filter(c => !c.referenceSheetUrl);
      if (missingSheets.length > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Characters missing reference sheets: ${missingSheets.map(c => c.name).join(", ")}`,
        });
      }

      // Skip characters already training or pending approval
      const alreadyTraining = chars.filter(c => c.loraStatus === "training" || c.loraStatus === "validating" || c.loraStatus === "pending_admin_approval");
      const toTrain = chars.filter(c => c.loraStatus !== "training" && c.loraStatus !== "validating" && c.loraStatus !== "pending_admin_approval");

      if (toTrain.length === 0) {
        return { batchId: null, jobs: [], skipped: alreadyTraining.map(c => c.name), estimate: null };
      }

      const batchId = generateBatchId();
      const jobs: Array<{ characterId: number; name: string; jobId: number; loraId: number; priority: number }> = [];

      for (const char of toTrain) {
        const priority = input.priorityOverrides?.[String(char.id)]
          ?? assignPriority("supporting"); // default priority

        // Determine next version
        const [maxVersion] = await db.select({ max: sql<number>`COALESCE(MAX(version), 0)` })
          .from(characterLoras)
          .where(eq(characterLoras.characterId, char.id));
        const nextVersion = (maxVersion?.max ?? 0) + 1;

        const triggerWord = buildTriggerWord(char.name);
        const artifactPath = getLoraArtifactPath(char.id, nextVersion);
        const fileSizeEstimate = estimateLoraFileSize(32);

        // Create LoRA record
        const [loraResult] = await db.insert(characterLoras).values({
          characterId: char.id,
          version: nextVersion,
          artifactPath,
          artifactSizeBytes: fileSizeEstimate.avgBytes,
          trainingParams: { rank: 32, alpha: 16, learningRate: 1e-4, trainingSteps: 800, baseModel: "Anything V5" },
          triggerWord,
          status: "training",
          validationStatus: "pending",
        });
        const loraId = (loraResult as any).insertId as number;

        // Create training job with pending_admin_approval (NO provider call)
        const estimate = estimateTrainingJob(input.gpuType, 800);
        const estimatedCostCents = Math.round(estimate.withMargin.costUsd * 100);
        const [jobResult] = await db.insert(loraTrainingJobs).values({
          characterId: char.id,
          loraId,
          userId: ctx.user.id,
          status: "pending_admin_approval",
          priority,
          batchId,
          gpuType: input.gpuType,
          costUsd: String(estimate.withMargin.costUsd),
          costCredits: String(estimate.withMargin.costCredits),
          estimatedCostCents,
        });
        const jobId = (jobResult as any).insertId as number;

        // Update character status to pending_admin_approval
        await db.update(characterLibrary)
          .set({ loraStatus: "pending_admin_approval" })
          .where(eq(characterLibrary.id, char.id));

        jobs.push({ characterId: char.id, name: char.name, jobId, loraId, priority });
      }

      // Compute batch estimate
      const batchEstimate = estimateBatchTraining(
        toTrain.map(c => ({ name: c.name, role: "supporting" })),
        input.gpuType
      );

      return {
        batchId,
        jobs: jobs.sort((a, b) => a.priority - b.priority),
        skipped: alreadyTraining.map(c => c.name),
        estimate: {
          totalMinutes: batchEstimate.totalEstimatedMinutes,
          wallClockMinutes: batchEstimate.wallClockMinutes,
          totalCostUsd: batchEstimate.totalEstimatedCostUsd,
          totalCredits: batchEstimate.totalEstimatedCredits,
          characterCount: toTrain.length,
        },
      };
    }),

  // ── Get Training Status ───────────────────────────────────────────────
  getTrainingStatus: protectedProcedure
    .input(z.object({ jobId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [job] = await db.select()
        .from(loraTrainingJobs)
        .where(and(eq(loraTrainingJobs.id, input.jobId), eq(loraTrainingJobs.userId, ctx.user.id)))
        .limit(1);

      if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "Training job not found" });

      // Get associated LoRA details
      let lora = null;
      if (job.loraId) {
        const [l] = await db.select()
          .from(characterLoras)
          .where(eq(characterLoras.id, job.loraId))
          .limit(1);
        lora = l || null;
      }

      return { job, lora };
    }),

  // ── Get Batch Status ──────────────────────────────────────────────────
  getBatchStatus: protectedProcedure
    .input(z.object({ batchId: z.string() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const jobs = await db.select()
        .from(loraTrainingJobs)
        .where(and(eq(loraTrainingJobs.batchId, input.batchId), eq(loraTrainingJobs.userId, ctx.user.id)))
        .orderBy(asc(loraTrainingJobs.priority));

      // Enrich with character names
      const charIds = Array.from(new Set(jobs.map(j => j.characterId)));
      const chars = charIds.length > 0
        ? await db.select({ id: characterLibrary.id, name: characterLibrary.name, loraStatus: characterLibrary.loraStatus })
            .from(characterLibrary)
            .where(inArray(characterLibrary.id, charIds))
        : [];
      const charMap = new Map(chars.map(c => [c.id, c]));

      const enriched = jobs.map(j => ({
        ...j,
        characterName: charMap.get(j.characterId)?.name ?? "Unknown",
        characterLoraStatus: charMap.get(j.characterId)?.loraStatus ?? "unknown",
      }));

      const completed = jobs.filter(j => j.status === "completed").length;
      const failed = jobs.filter(j => j.status === "failed").length;
      const inProgress = jobs.filter(j => j.status === "training" || j.status === "preprocessing" || j.status === "validating").length;
      const queued = jobs.filter(j => j.status === "queued").length;

      return {
        batchId: input.batchId,
        jobs: enriched,
        summary: {
          total: jobs.length,
          completed,
          failed,
          inProgress,
          queued,
          progressPercent: jobs.length > 0 ? Math.round((completed / jobs.length) * 100) : 0,
        },
      };
    }),

  // ── Review LoRA (manual approve/reject) ───────────────────────────────
  reviewLora: protectedProcedure
    .input(z.object({
      loraId: z.number(),
      decision: z.enum(["approved", "rejected"]),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // Verify the LoRA belongs to user's character
      const [lora] = await db.select()
        .from(characterLoras)
        .where(eq(characterLoras.id, input.loraId))
        .limit(1);
      if (!lora) throw new TRPCError({ code: "NOT_FOUND", message: "LoRA not found" });

      const [char] = await db.select()
        .from(characterLibrary)
        .where(and(eq(characterLibrary.id, lora.characterId), eq(characterLibrary.userId, ctx.user.id)))
        .limit(1);
      if (!char) throw new TRPCError({ code: "FORBIDDEN", message: "Not your character" });

      if (lora.validationStatus !== "validating" && lora.validationStatus !== "pending") {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Cannot review LoRA in ${lora.validationStatus} state` });
      }

      if (input.decision === "approved") {
        // Deprecate old active LoRA
        if (char.activeLoraId && char.activeLoraId !== input.loraId) {
          await db.update(characterLoras)
            .set({ status: "deprecated", validationStatus: "deprecated", deprecatedAt: new Date() })
            .where(eq(characterLoras.id, char.activeLoraId));
        }

        // Activate new LoRA
        await db.update(characterLoras)
          .set({ status: "active", validationStatus: "approved" })
          .where(eq(characterLoras.id, input.loraId));

        await db.update(characterLibrary)
          .set({ loraStatus: "active", activeLoraId: input.loraId })
          .where(eq(characterLibrary.id, lora.characterId));
      } else {
        // Reject
        await db.update(characterLoras)
          .set({ status: "failed", validationStatus: "rejected" })
          .where(eq(characterLoras.id, input.loraId));

        await db.update(characterLibrary)
          .set({ loraStatus: "failed" })
          .where(eq(characterLibrary.id, lora.characterId));
      }

      return { loraId: input.loraId, decision: input.decision };
    }),

  // ── Version History ───────────────────────────────────────────────────
  getVersionHistory: protectedProcedure
    .input(z.object({ characterId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return [];

      // Verify ownership
      const [char] = await db.select()
        .from(characterLibrary)
        .where(and(eq(characterLibrary.id, input.characterId), eq(characterLibrary.userId, ctx.user.id)))
        .limit(1);
      if (!char) throw new TRPCError({ code: "NOT_FOUND", message: "Character not found" });

      const versions = await db.select()
        .from(characterLoras)
        .where(eq(characterLoras.characterId, input.characterId))
        .orderBy(desc(characterLoras.version));

      return versions.map(v => ({
        ...v,
        isActive: char.activeLoraId === v.id,
      }));
    }),

  // ── Rollback Version ──────────────────────────────────────────────────
  rollbackVersion: protectedProcedure
    .input(z.object({
      characterId: z.number(),
      loraId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // Verify ownership
      const [char] = await db.select()
        .from(characterLibrary)
        .where(and(eq(characterLibrary.id, input.characterId), eq(characterLibrary.userId, ctx.user.id)))
        .limit(1);
      if (!char) throw new TRPCError({ code: "NOT_FOUND", message: "Character not found" });

      // Verify the target LoRA exists and was previously approved
      const [targetLora] = await db.select()
        .from(characterLoras)
        .where(and(
          eq(characterLoras.id, input.loraId),
          eq(characterLoras.characterId, input.characterId)
        ))
        .limit(1);
      if (!targetLora) throw new TRPCError({ code: "NOT_FOUND", message: "LoRA version not found" });
      if (targetLora.validationStatus !== "approved" && targetLora.validationStatus !== "deprecated") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Can only rollback to approved or deprecated versions" });
      }

      // Deprecate current active
      if (char.activeLoraId && char.activeLoraId !== input.loraId) {
        await db.update(characterLoras)
          .set({ status: "deprecated", deprecatedAt: new Date() })
          .where(eq(characterLoras.id, char.activeLoraId));
      }

      // Reactivate target
      await db.update(characterLoras)
        .set({ status: "active", validationStatus: "approved", deprecatedAt: null })
        .where(eq(characterLoras.id, input.loraId));

      await db.update(characterLibrary)
        .set({ loraStatus: "active", activeLoraId: input.loraId })
        .where(eq(characterLibrary.id, input.characterId));

      return { rolledBackTo: input.loraId, version: targetLora.version };
    }),

  // ── Get Assets ────────────────────────────────────────────────────────
  getAssets: protectedProcedure
    .input(z.object({
      characterId: z.number(),
      assetType: z.enum(["reference_sheet", "reference_image", "lora", "ip_adapter_embedding", "clip_embedding"]).optional(),
      activeOnly: z.boolean().default(true),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return [];

      // Verify ownership
      const [char] = await db.select()
        .from(characterLibrary)
        .where(and(eq(characterLibrary.id, input.characterId), eq(characterLibrary.userId, ctx.user.id)))
        .limit(1);
      if (!char) throw new TRPCError({ code: "NOT_FOUND", message: "Character not found" });

      const filters = [eq(characterAssets.characterId, input.characterId)];
      if (input.assetType) filters.push(eq(characterAssets.assetType, input.assetType));
      if (input.activeOnly) filters.push(eq(characterAssets.isActive, 1));

      return db.select()
        .from(characterAssets)
        .where(and(...filters))
        .orderBy(desc(characterAssets.createdAt));
    }),

  // ── Usage Stats ───────────────────────────────────────────────────────
  getUsageStats: protectedProcedure
    .input(z.object({ characterId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { generationCount: 0, episodeCount: 0, avgQualityScore: 0 };

      // Verify ownership
      const [char] = await db.select()
        .from(characterLibrary)
        .where(and(eq(characterLibrary.id, input.characterId), eq(characterLibrary.userId, ctx.user.id)))
        .limit(1);
      if (!char) throw new TRPCError({ code: "NOT_FOUND", message: "Character not found" });

      // Count generations using this character
      const [genCount] = await db.select({ count: sql<number>`COUNT(*)` })
        .from(generationRequests)
        .where(eq((generationRequests as any).characterId, input.characterId));

      // Average quality score across all LoRA versions
      const [avgScore] = await db.select({ avg: sql<number>`COALESCE(AVG(qualityScore), 0)` })
        .from(characterLoras)
        .where(and(
          eq(characterLoras.characterId, input.characterId),
          sql`qualityScore IS NOT NULL`
        ));

      // Count pipeline runs that pinned this character
      const [pinCount] = await db.select({ count: sql<number>`COUNT(DISTINCT pipelineRunId)` })
        .from(pipelineRunLoraPins)
        .where(eq(pipelineRunLoraPins.characterId, input.characterId));

      return {
        generationCount: genCount?.count ?? 0,
        episodeCount: pinCount?.count ?? 0,
        avgQualityScore: Math.round(avgScore?.avg ?? 0),
        usageCount: char.usageCount,
      };
    }),

  // ── Get Training Estimate ─────────────────────────────────────────────
  getTrainingEstimate: protectedProcedure
    .input(z.object({
      gpuType: z.enum(["h100_sxm", "a100_80gb", "rtx_4090"]).default("h100_sxm"),
      rank: z.number().min(16).max(64).default(32),
      trainingSteps: z.number().min(500).max(1500).default(800),
    }))
    .query(({ input }) => {
      const estimate = estimateTrainingJob(input.gpuType, input.trainingSteps);
      const fileSize = estimateLoraFileSize(input.rank);
      return { ...estimate, fileSize };
    }),

  // ── Get Batch Training Estimate ───────────────────────────────────────
  getBatchEstimate: protectedProcedure
    .input(z.object({
      characterIds: z.array(z.number()).min(1).max(20),
      gpuType: z.enum(["h100_sxm", "a100_80gb", "rtx_4090"]).default("h100_sxm"),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const chars = await db.select({ id: characterLibrary.id, name: characterLibrary.name })
        .from(characterLibrary)
        .where(and(
          inArray(characterLibrary.id, input.characterIds),
          eq(characterLibrary.userId, ctx.user.id)
        ));

      return estimateBatchTraining(
        chars.map(c => ({ name: c.name, role: "supporting" })),
        input.gpuType
      );
    }),

  // ── Preview Extraction ────────────────────────────────────────────────
  previewExtraction: protectedProcedure
    .input(z.object({
      referenceSheetUrl: z.string().url(),
      characterName: z.string().min(1).max(100),
    }))
    .query(({ input }) => {
      return previewExtraction(input.referenceSheetUrl, input.characterName);
    }),

  // ── Compare LoRA Versions (A/B) ──────────────────────────────────────
  compareVersions: protectedProcedure
    .input(z.object({
      characterId: z.number(),
      versionAId: z.number(),
      versionBId: z.number(),
      customPrompt: z.string().max(500).optional(),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // Verify ownership
      const [char] = await db.select()
        .from(characterLibrary)
        .where(and(eq(characterLibrary.id, input.characterId), eq(characterLibrary.userId, ctx.user.id)))
        .limit(1);
      if (!char) throw new TRPCError({ code: "NOT_FOUND", message: "Character not found" });

      // Fetch both LoRA versions
      const [loraA] = await db.select()
        .from(characterLoras)
        .where(and(eq(characterLoras.id, input.versionAId), eq(characterLoras.characterId, input.characterId)))
        .limit(1);
      if (!loraA) throw new TRPCError({ code: "NOT_FOUND", message: "Version A not found" });

      const [loraB] = await db.select()
        .from(characterLoras)
        .where(and(eq(characterLoras.id, input.versionBId), eq(characterLoras.characterId, input.characterId)))
        .limit(1);
      if (!loraB) throw new TRPCError({ code: "NOT_FOUND", message: "Version B not found" });

      const triggerWord = buildTriggerWord(char.name);

      const comparison = compareLoraVersions(
        {
          id: loraA.id,
          version: loraA.version,
          qualityScore: loraA.qualityScore ?? 70,
          artifactPath: loraA.artifactPath ?? "",
        },
        {
          id: loraB.id,
          version: loraB.version,
          qualityScore: loraB.qualityScore ?? 70,
          artifactPath: loraB.artifactPath ?? "",
        },
        triggerWord,
        input.customPrompt
      );

      return {
        characterName: char.name,
        activeLoraId: char.activeLoraId,
        ...comparison,
      };
    }),

  // ── Consistency Report ────────────────────────────────────────────────

  getConsistencyReport: protectedProcedure
    .input(z.object({
      characterId: z.number(),
      driftThreshold: z.number().min(0.01).max(0.5).optional(),
      episodeFilter: z.array(z.number()).optional(),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [char] = await db.select().from(characterLibrary)
        .where(and(eq(characterLibrary.id, input.characterId), eq(characterLibrary.userId, ctx.user.id)))
        .limit(1);
      if (!char) throw new TRPCError({ code: "NOT_FOUND", message: "Character not found" });

      // Get active LoRA quality info
      let qualityScore: number | null = null;
      let clipSimilarity: number | null = null;
      if (char.activeLoraId) {
        const [lora] = await db.select().from(characterLoras)
          .where(eq(characterLoras.id, char.activeLoraId))
          .limit(1);
        if (lora) {
          qualityScore = lora.qualityScore;
          clipSimilarity = lora.clipSimilarity ? Number(lora.clipSimilarity) : null;
        }
      }

      // Fetch all generation requests for this character that have results
      let query = db.select({
        generationId: generationRequests.id,
        episodeId: generationRequests.episodeId,
        sceneId: generationRequests.sceneId,
        loraId: generationRequests.loraId,
        loraStrength: generationRequests.loraStrength,
        createdAt: generationRequests.createdAt,
        resultUrl: generationResults.storageUrl,
      })
        .from(generationRequests)
        .innerJoin(generationResults, eq(generationResults.requestId, generationRequests.id))
        .where(
          and(
            eq(generationRequests.characterId, input.characterId),
            eq(generationRequests.userId, ctx.user.id),
          )
        )
        .orderBy(asc(generationRequests.createdAt));

      const rows = await query;

      // Enrich with episode info
      const episodeIds = Array.from(new Set(rows.map(r => r.episodeId).filter((id): id is number => id !== null)));
      const episodeMap = new Map<number, { number: number; title: string }>();
      if (episodeIds.length > 0) {
        const eps = await db.select({ id: episodes.id, episodeNumber: episodes.episodeNumber, title: episodes.title })
          .from(episodes)
          .where(inArray(episodes.id, episodeIds));
        for (const ep of eps) {
          episodeMap.set(ep.id, { number: ep.episodeNumber, title: ep.title });
        }
      }

      // Enrich with scene info
      const sceneIds = Array.from(new Set(rows.map(r => r.sceneId).filter((id): id is number => id !== null)));
      const sceneMap = new Map<number, number>();
      if (sceneIds.length > 0) {
        const scns = await db.select({ id: scenes.id, sceneNumber: scenes.sceneNumber })
          .from(scenes)
          .where(inArray(scenes.id, sceneIds));
        for (const s of scns) {
          sceneMap.set(s.id, s.sceneNumber);
        }
      }

      // Get LoRA version info
      const loraIds = Array.from(new Set(rows.map(r => r.loraId).filter((id): id is number => id !== null)));
      const loraMap = new Map<number, number>();
      if (loraIds.length > 0) {
        const loras = await db.select({ id: characterLoras.id, version: characterLoras.version })
          .from(characterLoras)
          .where(inArray(characterLoras.id, loraIds));
        for (const l of loras) {
          loraMap.set(l.id, l.version);
        }
      }

      // Build FrameGeneration array
      let frameIndex = 0;
      const generations: FrameGeneration[] = rows
        .filter(r => {
          if (!input.episodeFilter || input.episodeFilter.length === 0) return true;
          return r.episodeId !== null && input.episodeFilter.includes(r.episodeId);
        })
        .map(r => {
          const epInfo = r.episodeId ? episodeMap.get(r.episodeId) : null;
          return {
            generationId: r.generationId,
            episodeId: r.episodeId ?? 0,
            episodeNumber: epInfo?.number ?? 0,
            episodeTitle: epInfo?.title ?? "Unknown Episode",
            sceneId: r.sceneId,
            sceneNumber: r.sceneId ? (sceneMap.get(r.sceneId) ?? null) : null,
            frameIndex: frameIndex++,
            resultUrl: r.resultUrl,
            loraId: r.loraId,
            loraVersion: r.loraId ? (loraMap.get(r.loraId) ?? null) : null,
            loraStrength: r.loraStrength ? Number(r.loraStrength) : null,
            createdAt: r.createdAt,
          };
        });

      const threshold = input.driftThreshold ?? DEFAULT_DRIFT_THRESHOLD;
      return aggregateCharacterReport(
        char.id,
        char.name,
        char.referenceSheetUrl,
        generations,
        qualityScore,
        clipSimilarity,
        threshold,
      );
    }),

  getFrameDriftDetail: protectedProcedure
    .input(z.object({
      characterId: z.number(),
      generationId: z.number(),
      driftThreshold: z.number().min(0.01).max(0.5).optional(),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
      const [char] = await db.select().from(characterLibrary)
        .where(and(eq(characterLibrary.id, input.characterId), eq(characterLibrary.userId, ctx.user.id)))
        .limit(1);
      if (!char) throw new TRPCError({ code: "NOT_FOUND", message: "Character not found" });

      // Get the specific generation
      const [gen] = await db.select({
        generationId: generationRequests.id,
        episodeId: generationRequests.episodeId,
        sceneId: generationRequests.sceneId,
        loraId: generationRequests.loraId,
        loraStrength: generationRequests.loraStrength,
        createdAt: generationRequests.createdAt,
        resultUrl: generationResults.storageUrl,
      })
        .from(generationRequests)
        .innerJoin(generationResults, eq(generationResults.requestId, generationRequests.id))
        .where(
          and(
            eq(generationRequests.id, input.generationId),
            eq(generationRequests.characterId, input.characterId),
          )
        )
        .limit(1);

      if (!gen) throw new TRPCError({ code: "NOT_FOUND", message: "Generation not found" });

      // We need the full report to get context for the detail view
      // For efficiency, we just compute drift for this frame and a few neighbors
      let qualityScore: number | null = null;
      let clipSimilarity: number | null = null;
      if (char.activeLoraId) {
        const [lora] = await db.select().from(characterLoras)
          .where(eq(characterLoras.id, char.activeLoraId))
          .limit(1);
        if (lora) {
          qualityScore = lora.qualityScore;
          clipSimilarity = lora.clipSimilarity ? Number(lora.clipSimilarity) : null;
        }
      }

      // Get episode info
      let episodeNumber = 0;
      let episodeTitle = "Unknown";
      if (gen.episodeId) {
        const [ep] = await db.select({ episodeNumber: episodes.episodeNumber, title: episodes.title })
          .from(episodes)
          .where(eq(episodes.id, gen.episodeId))
          .limit(1);
        if (ep) {
          episodeNumber = ep.episodeNumber;
          episodeTitle = ep.title;
        }
      }

      // Get LoRA version
      let loraVersion: number | null = null;
      if (gen.loraId) {
        const [lora] = await db.select({ version: characterLoras.version })
          .from(characterLoras)
          .where(eq(characterLoras.id, gen.loraId))
          .limit(1);
        if (lora) loraVersion = lora.version;
      }

      const sceneNumber = gen.sceneId ? 1 : null; // simplified

      const frameGen: FrameGeneration = {
        generationId: gen.generationId,
        episodeId: gen.episodeId ?? 0,
        episodeNumber,
        episodeTitle,
        sceneId: gen.sceneId,
        sceneNumber,
        frameIndex: 0,
        resultUrl: gen.resultUrl,
        loraId: gen.loraId,
        loraVersion,
        loraStrength: gen.loraStrength ? Number(gen.loraStrength) : null,
        createdAt: gen.createdAt,
      };

      // Import computeFrameDrift and detectDriftSpikes
      const { computeFrameDrift, detectDriftSpikes } = await import("./consistency-analysis");
      const rawFrame = computeFrameDrift(frameGen, qualityScore, clipSimilarity);
      const [frame] = detectDriftSpikes([rawFrame], input.driftThreshold ?? DEFAULT_DRIFT_THRESHOLD);

      return getFrameDriftDetail(frame, [frame], char.referenceSheetUrl);
    }),

  // ── Fix Drift (persisted) ─────────────────────────────────────────────
  fixDrift: protectedProcedure
    .input(z.object({
      characterId: z.number(),
      generationId: z.number(),
      driftScore: z.number(),
      loraStrength: z.number().nullable(),
      loraVersion: z.number().nullable(),
      severity: z.enum(["warning", "critical"]),
      featureDrifts: z.object({
        face: z.number(),
        hair: z.number(),
        outfit: z.number(),
        colorPalette: z.number(),
        bodyProportion: z.number(),
      }),
      sceneId: z.number().nullable(),
      episodeId: z.number(),
      frameIndex: z.number(),
      resultUrl: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // Verify ownership
      const [char] = await db.select()
        .from(characterLibrary)
        .where(and(eq(characterLibrary.id, input.characterId), eq(characterLibrary.userId, ctx.user.id)))
        .limit(1);
      if (!char) throw new TRPCError({ code: "NOT_FOUND", message: "Character not found" });

      // Build a FrameDriftResult from the input
      const frameDrift: FrameDriftResult = {
        generationId: input.generationId,
        episodeId: input.episodeId,
        episodeNumber: 0,
        episodeTitle: "",
        sceneId: input.sceneId,
        sceneNumber: null,
        frameIndex: input.frameIndex,
        resultUrl: input.resultUrl,
        driftScore: input.driftScore,
        clipDrift: input.driftScore * 0.8,
        featureDrifts: input.featureDrifts,
        isFlagged: true,
        severity: input.severity,
        loraVersion: input.loraVersion,
        loraStrength: input.loraStrength,
        timestamp: Date.now(),
      };

      const jobSpec = buildFixDriftJob(frameDrift);

      // Persist the job to the database
      const insertData: InsertFixDriftJob = {
        characterId: input.characterId,
        userId: ctx.user.id,
        generationId: input.generationId,
        episodeId: input.episodeId,
        sceneId: input.sceneId ?? undefined,
        frameIndex: input.frameIndex,
        originalResultUrl: input.resultUrl,
        originalDriftScore: input.driftScore,
        originalLoraStrength: input.loraStrength ?? undefined,
        boostedLoraStrength: jobSpec.boostParams.boostedStrength,
        boostDelta: jobSpec.boostParams.boostDelta,
        severity: input.severity,
        targetFeatures: jobSpec.boostParams.targetFeatures,
        fixConfidence: jobSpec.boostParams.fixConfidence,
        estimatedCredits: jobSpec.estimatedCredits,
        estimatedSeconds: jobSpec.estimatedSeconds,
        status: "queued",
        progress: 0,
      };

      const [inserted] = await db.insert(fixDriftJobs).values(insertData).$returningId();

      // Schedule simulated completion (processing → completed)
      // In production this would be a real job queue callback
      scheduleSimulatedCompletion(db, inserted.id, input.driftScore);

      return {
        ...jobSpec,
        jobId: inserted.id,
        formattedTime: formatDuration(jobSpec.estimatedSeconds),
        characterName: char.name,
      };
    }),

  // ── Fix Drift Batch (persisted) ───────────────────────────────────────
  fixDriftBatch: protectedProcedure
    .input(z.object({
      characterId: z.number(),
      frames: z.array(z.object({
        generationId: z.number(),
        driftScore: z.number(),
        loraStrength: z.number().nullable(),
        loraVersion: z.number().nullable(),
        severity: z.enum(["warning", "critical"]),
        featureDrifts: z.object({
          face: z.number(),
          hair: z.number(),
          outfit: z.number(),
          colorPalette: z.number(),
          bodyProportion: z.number(),
        }),
        sceneId: z.number().nullable(),
        episodeId: z.number(),
        frameIndex: z.number(),
        resultUrl: z.string(),
      })),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // Verify ownership
      const [char] = await db.select()
        .from(characterLibrary)
        .where(and(eq(characterLibrary.id, input.characterId), eq(characterLibrary.userId, ctx.user.id)))
        .limit(1);
      if (!char) throw new TRPCError({ code: "NOT_FOUND", message: "Character not found" });

      // Convert input frames to FrameDriftResult[]
      const driftResults: FrameDriftResult[] = input.frames.map(f => ({
        generationId: f.generationId,
        episodeId: f.episodeId,
        episodeNumber: 0,
        episodeTitle: "",
        sceneId: f.sceneId,
        sceneNumber: null,
        frameIndex: f.frameIndex,
        resultUrl: f.resultUrl,
        driftScore: f.driftScore,
        clipDrift: f.driftScore * 0.8,
        featureDrifts: f.featureDrifts,
        isFlagged: true,
        severity: f.severity,
        loraVersion: f.loraVersion,
        loraStrength: f.loraStrength,
        timestamp: Date.now(),
      }));

      const estimate = estimateFixDriftBatch(driftResults);

      // Persist all jobs to the database
      const jobIds: number[] = [];
      for (let i = 0; i < estimate.jobs.length; i++) {
        const job = estimate.jobs[i];
        const frame = input.frames.find(f => f.generationId === job.generationId);
        const insertData: InsertFixDriftJob = {
          characterId: input.characterId,
          userId: ctx.user.id,
          generationId: job.generationId,
          episodeId: job.episodeId,
          sceneId: job.sceneId ?? undefined,
          frameIndex: job.frameIndex,
          originalResultUrl: job.originalResultUrl,
          originalDriftScore: job.driftScore,
          originalLoraStrength: frame?.loraStrength ?? undefined,
          boostedLoraStrength: job.boostParams.boostedStrength,
          boostDelta: job.boostParams.boostDelta,
          severity: job.severity,
          targetFeatures: job.boostParams.targetFeatures,
          fixConfidence: job.boostParams.fixConfidence,
          estimatedCredits: job.estimatedCredits,
          estimatedSeconds: job.estimatedSeconds,
          status: "queued",
          progress: 0,
        };

        const [inserted] = await db.insert(fixDriftJobs).values(insertData).$returningId();
        jobIds.push(inserted.id);

        // Schedule simulated completion with staggered delay
        scheduleSimulatedCompletion(db, inserted.id, job.driftScore, 2000 + i * 1500);
      }

      return {
        ...estimate,
        jobIds,
        formattedTotalTime: formatDuration(estimate.totalEstimatedSeconds),
        characterName: char.name,
      };
    }),

  // ── Get Fix Drift Status (reads from DB) ──────────────────────────────
  getFixDriftStatus: protectedProcedure
    .input(z.object({
      characterId: z.number(),
      generationId: z.number(),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // Verify ownership
      const [char] = await db.select()
        .from(characterLibrary)
        .where(and(eq(characterLibrary.id, input.characterId), eq(characterLibrary.userId, ctx.user.id)))
        .limit(1);
      if (!char) throw new TRPCError({ code: "NOT_FOUND", message: "Character not found" });

      // Get the latest job for this generation
      const [job] = await db.select()
        .from(fixDriftJobs)
        .where(and(
          eq(fixDriftJobs.characterId, input.characterId),
          eq(fixDriftJobs.generationId, input.generationId),
        ))
        .orderBy(desc(fixDriftJobs.queuedAt))
        .limit(1);

      if (!job) return null;

      return {
        jobId: job.id,
        generationId: job.generationId,
        status: job.status,
        progress: job.progress,
        newResultUrl: job.newResultUrl,
        newDriftScore: job.newDriftScore,
        driftImprovement: job.driftImprovement,
        errorMessage: job.errorMessage,
        queuedAt: job.queuedAt?.getTime() ?? null,
        startedAt: job.startedAt?.getTime() ?? null,
        completedAt: job.completedAt?.getTime() ?? null,
      };
    }),

  // ── Get Fix Drift History (all jobs for a character) ──────────────────
  getFixDriftHistory: protectedProcedure
    .input(z.object({
      characterId: z.number(),
      limit: z.number().min(1).max(200).default(100),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // Verify ownership
      const [char] = await db.select()
        .from(characterLibrary)
        .where(and(eq(characterLibrary.id, input.characterId), eq(characterLibrary.userId, ctx.user.id)))
        .limit(1);
      if (!char) throw new TRPCError({ code: "NOT_FOUND", message: "Character not found" });

      const jobs = await db.select()
        .from(fixDriftJobs)
        .where(eq(fixDriftJobs.characterId, input.characterId))
        .orderBy(desc(fixDriftJobs.queuedAt))
        .limit(input.limit);

      return jobs.map(job => ({
        jobId: job.id,
        generationId: job.generationId,
        episodeId: job.episodeId,
        sceneId: job.sceneId,
        frameIndex: job.frameIndex,
        originalDriftScore: job.originalDriftScore,
        originalLoraStrength: job.originalLoraStrength,
        boostedLoraStrength: job.boostedLoraStrength,
        boostDelta: job.boostDelta,
        severity: job.severity,
        targetFeatures: job.targetFeatures as string[] | null,
        fixConfidence: job.fixConfidence,
        estimatedCredits: job.estimatedCredits,
        status: job.status,
        progress: job.progress,
        newResultUrl: job.newResultUrl,
        newDriftScore: job.newDriftScore,
        driftImprovement: job.driftImprovement,
        errorMessage: job.errorMessage,
        queuedAt: job.queuedAt?.getTime() ?? null,
        startedAt: job.startedAt?.getTime() ?? null,
        completedAt: job.completedAt?.getTime() ?? null,
      }));
    }),

  // ── Fix Drift Analytics ──────────────────────────────────────────────
  getFixDriftAnalytics: protectedProcedure
    .input(z.object({
      characterId: z.number(),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // Verify ownership
      const [char] = await db.select()
        .from(characterLibrary)
        .where(and(eq(characterLibrary.id, input.characterId), eq(characterLibrary.userId, ctx.user.id)))
        .limit(1);
      if (!char) throw new TRPCError({ code: "NOT_FOUND", message: "Character not found" });

      // Get all fix jobs for this character
      const allJobs = await db.select()
        .from(fixDriftJobs)
        .where(eq(fixDriftJobs.characterId, input.characterId))
        .orderBy(asc(fixDriftJobs.queuedAt));

      const totalFixes = allJobs.length;
      const completedJobs = allJobs.filter(j => j.status === "completed");
      const failedJobs = allJobs.filter(j => j.status === "failed");
      const queuedJobs = allJobs.filter(j => j.status === "queued");
      const processingJobs = allJobs.filter(j => j.status === "processing");

      const successRate = totalFixes > 0
        ? Math.round((completedJobs.length / (completedJobs.length + failedJobs.length || 1)) * 100)
        : 0;

      const avgDriftImprovement = completedJobs.length > 0
        ? Math.round(
            completedJobs.reduce((sum, j) => sum + (j.driftImprovement ?? 0), 0) / completedJobs.length * 10000
          ) / 10000
        : 0;

      const totalCreditsSpent = allJobs.reduce((sum, j) => sum + (j.estimatedCredits ?? 0), 0);

      const avgFixTimeSeconds = completedJobs.length > 0
        ? Math.round(
            completedJobs.reduce((sum, j) => {
              if (j.startedAt && j.completedAt) {
                return sum + (j.completedAt.getTime() - j.startedAt.getTime()) / 1000;
              }
              return sum + (j.estimatedSeconds ?? 0);
            }, 0) / completedJobs.length
          )
        : 0;

      // Severity breakdown
      const criticalFixes = allJobs.filter(j => j.severity === "critical");
      const warningFixes = allJobs.filter(j => j.severity === "warning");
      const criticalSuccessRate = criticalFixes.length > 0
        ? Math.round(
            (criticalFixes.filter(j => j.status === "completed").length /
              (criticalFixes.filter(j => j.status === "completed" || j.status === "failed").length || 1)) * 100
          )
        : 0;
      const warningSuccessRate = warningFixes.length > 0
        ? Math.round(
            (warningFixes.filter(j => j.status === "completed").length /
              (warningFixes.filter(j => j.status === "completed" || j.status === "failed").length || 1)) * 100
          )
        : 0;

      // Fixes over time (grouped by day)
      const fixesByDay: Record<string, { total: number; completed: number; failed: number; credits: number }> = {};
      for (const job of allJobs) {
        const day = job.queuedAt ? job.queuedAt.toISOString().slice(0, 10) : "unknown";
        if (!fixesByDay[day]) fixesByDay[day] = { total: 0, completed: 0, failed: 0, credits: 0 };
        fixesByDay[day].total++;
        if (job.status === "completed") fixesByDay[day].completed++;
        if (job.status === "failed") fixesByDay[day].failed++;
        fixesByDay[day].credits += job.estimatedCredits ?? 0;
      }

      const fixesOverTime = Object.entries(fixesByDay)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, data]) => ({ date, ...data }));

      // Average boost delta
      const avgBoostDelta = totalFixes > 0
        ? Math.round(allJobs.reduce((sum, j) => sum + (j.boostDelta ?? 0), 0) / totalFixes * 100) / 100
        : 0;

      // Re-fix count (frames with multiple fix attempts)
      const generationCounts: Record<number, number> = {};
      for (const job of allJobs) {
        generationCounts[job.generationId] = (generationCounts[job.generationId] ?? 0) + 1;
      }
      const reFixCount = Object.values(generationCounts).filter(c => c > 1).length;

      return {
        totalFixes,
        completed: completedJobs.length,
        failed: failedJobs.length,
        queued: queuedJobs.length,
        processing: processingJobs.length,
        successRate,
        avgDriftImprovement,
        totalCreditsSpent,
        avgFixTimeSeconds,
        criticalFixes: criticalFixes.length,
        warningFixes: warningFixes.length,
        criticalSuccessRate,
        warningSuccessRate,
        avgBoostDelta,
        reFixCount,
        fixesOverTime,
      };
    }),

  // ── Re-Fix (higher LoRA strength) ────────────────────────────────────
  reFix: protectedProcedure
    .input(z.object({
      jobId: z.number(),
      characterId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // Verify ownership
      const [char] = await db.select()
        .from(characterLibrary)
        .where(and(eq(characterLibrary.id, input.characterId), eq(characterLibrary.userId, ctx.user.id)))
        .limit(1);
      if (!char) throw new TRPCError({ code: "NOT_FOUND", message: "Character not found" });

      // Get the original completed job
      const [originalJob] = await db.select()
        .from(fixDriftJobs)
        .where(and(
          eq(fixDriftJobs.id, input.jobId),
          eq(fixDriftJobs.characterId, input.characterId),
        ))
        .limit(1);

      if (!originalJob) throw new TRPCError({ code: "NOT_FOUND", message: "Fix job not found" });
      if (originalJob.status !== "completed" && originalJob.status !== "failed") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Can only re-fix completed or failed jobs" });
      }

      // Calculate re-fix boost: use previous boosted strength as new baseline
      const previousBoosted = originalJob.boostedLoraStrength;
      const MAX_STRENGTH = 0.95;

      if (previousBoosted >= MAX_STRENGTH) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "LoRA strength already at maximum (95%). Cannot boost further." });
      }

      // Diminishing returns: each re-fix adds less boost
      const currentDrift = originalJob.newDriftScore ?? originalJob.originalDriftScore;
      const reFixBoostRaw = Math.min(0.10, currentDrift * 0.35);
      const reFixBoostDelta = Math.round(reFixBoostRaw * 100) / 100;
      const newBoostedStrength = Math.min(MAX_STRENGTH, previousBoosted + reFixBoostDelta);
      const actualDelta = Math.round((newBoostedStrength - previousBoosted) * 100) / 100;

      // Re-determine target features from the post-fix drift
      // Use original features as proxy since we don't store per-feature post-fix drifts
      const prevTargetFeatures = (originalJob.targetFeatures as string[] | null) ?? [];

      // Confidence decreases with each re-fix attempt
      const attemptCount = await db.select({ count: sql<number>`count(*)` })
        .from(fixDriftJobs)
        .where(and(
          eq(fixDriftJobs.characterId, input.characterId),
          eq(fixDriftJobs.generationId, originalJob.generationId),
        ));
      const totalAttempts = attemptCount[0]?.count ?? 1;
      const reFixConfidence: "high" | "medium" | "low" =
        totalAttempts >= 3 ? "low" : totalAttempts >= 2 ? "medium" : "high";

      // Cost scales with attempt count (diminishing returns warning)
      const baseCost = 8;
      const boostAddon = Math.ceil(actualDelta / 0.1) * 2;
      const attemptMultiplier = 1 + (totalAttempts - 1) * 0.25; // 25% more per attempt
      const estimatedCredits = Math.round((baseCost + boostAddon) * attemptMultiplier);
      const estimatedSeconds = Math.round(45 * (1 + actualDelta * 0.5));

      // Insert new fix job
      const insertData: InsertFixDriftJob = {
        characterId: input.characterId,
        userId: ctx.user.id,
        generationId: originalJob.generationId,
        episodeId: originalJob.episodeId,
        sceneId: originalJob.sceneId ?? undefined,
        frameIndex: originalJob.frameIndex,
        originalResultUrl: originalJob.newResultUrl ?? originalJob.originalResultUrl ?? undefined,
        originalDriftScore: currentDrift,
        originalLoraStrength: previousBoosted,
        boostedLoraStrength: newBoostedStrength,
        boostDelta: actualDelta,
        severity: originalJob.severity as "warning" | "critical",
        targetFeatures: prevTargetFeatures,
        fixConfidence: reFixConfidence,
        estimatedCredits,
        estimatedSeconds,
        status: "queued",
        progress: 0,
      };

      const [inserted] = await db.insert(fixDriftJobs).values(insertData).$returningId();

      // Schedule simulated completion
      scheduleSimulatedCompletion(db, inserted.id, currentDrift);

      return {
        jobId: inserted.id,
        previousBoostedStrength: previousBoosted,
        newBoostedStrength,
        reFixBoostDelta: actualDelta,
        estimatedCredits,
        estimatedSeconds,
        formattedTime: formatDuration(estimatedSeconds),
        attemptNumber: totalAttempts + 1,
        confidence: reFixConfidence,
        atMaxStrength: newBoostedStrength >= MAX_STRENGTH,
      };
    }),

  // ─── LoRA Retraining Recommendation ─────────────────────────────────────

  getRetrainingRecommendation: protectedProcedure
    .input(z.object({
      characterId: z.number(),
    }))
    .query(async ({ ctx, input }) => {
      const { generateRetrainingRecommendation } = await import("./lora-retraining-recommendation");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // Fetch all fix-drift jobs for this character
      const jobs = await db.select()
        .from(fixDriftJobs)
        .where(and(
          eq(fixDriftJobs.characterId, input.characterId),
          eq(fixDriftJobs.userId, ctx.user.id),
        ))
        .orderBy(asc(fixDriftJobs.queuedAt));

      if (jobs.length === 0) return null;

      // Map DB rows to FixAttemptRecord
      const attempts = jobs.map(j => ({
        jobId: j.id,
        generationId: j.generationId,
        frameIndex: j.frameIndex,
        episodeId: j.episodeId,
        originalDriftScore: j.originalDriftScore,
        newDriftScore: j.newDriftScore ?? null,
        driftImprovement: j.driftImprovement ?? null,
        boostedLoraStrength: j.boostedLoraStrength,
        boostDelta: j.boostDelta,
        targetFeatures: (j.targetFeatures as string[] | null) ?? null,
        severity: j.severity as "warning" | "critical",
        status: j.status as "queued" | "processing" | "completed" | "failed",
        queuedAt: j.queuedAt ? new Date(j.queuedAt).getTime() : Date.now(),
      }));

      return generateRetrainingRecommendation(attempts);
    }),

  // ── Add Reference Images (for character foundation) ──────────────────
  addRefImages: protectedProcedure
    .input(z.object({
      characterId: z.number(),
      images: z.array(z.object({
        storageUrl: z.string(),
        mimeType: z.string(),
        width: z.number().optional(),
        height: z.number().optional(),
      })).min(1).max(6),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // Verify ownership
      const [char] = await db.select()
        .from(characterLibrary)
        .where(and(eq(characterLibrary.id, input.characterId), eq(characterLibrary.userId, ctx.user.id)))
        .limit(1);
      if (!char) throw new TRPCError({ code: "NOT_FOUND", message: "Character not found" });

      // Insert asset records
      const insertedIds: number[] = [];
      for (const img of input.images) {
        const [result] = await db.insert(characterAssets).values({
          characterId: input.characterId,
          assetType: "reference_image",
          storageUrl: img.storageUrl,
          version: 1,
          metadata: { width: img.width, height: img.height, mimeType: img.mimeType },
          isActive: 1,
        });
        insertedIds.push((result as any).insertId as number);
      }

      return { addedCount: insertedIds.length, assetIds: insertedIds };
    }),

  // ── Compute Embeddings (trigger CLIP/DINO for character) ────────────
  computeEmbeddings: protectedProcedure
    .input(z.object({
      characterId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // Verify ownership
      const [char] = await db.select()
        .from(characterLibrary)
        .where(and(eq(characterLibrary.id, input.characterId), eq(characterLibrary.userId, ctx.user.id)))
        .limit(1);
      if (!char) throw new TRPCError({ code: "NOT_FOUND", message: "Character not found" });

      // Get reference images
      const refImages = await db.select()
        .from(characterAssets)
        .where(and(
          eq(characterAssets.characterId, input.characterId),
          eq(characterAssets.assetType, "reference_image"),
          eq(characterAssets.isActive, 1)
        ));

      if (refImages.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No reference images found. Add at least one reference image first." });
      }

      // Import and run embedding computation
      const { computeCharacterEmbedding } = await import("./character-embedding");
      const result = await computeCharacterEmbedding(
        input.characterId,
        ctx.user.id,
        refImages.map(r => ({ url: r.storageUrl, fileKey: r.storageUrl, mimeType: "image/png" }))
      );

      // Store embedding URL on the character record
      await db.update(characterLibrary)
        .set({ activeClipEmbeddingUrl: result.embeddingUrl })
        .where(eq(characterLibrary.id, input.characterId));

      // Also store as an asset
      await db.insert(characterAssets).values({
        characterId: input.characterId,
        assetType: "clip_embedding",
        storageUrl: result.embeddingUrl,
        version: 1,
        metadata: { dimensions: result.dimensions, computeTimeMs: result.computeTimeMs },
        isActive: 1,
      });

      return {
        embeddingUrl: result.embeddingUrl,
        dimensions: result.dimensions,
        computeTimeMs: result.computeTimeMs,
        status: "ready" as const,
      };
    }),

  // ── Admin: Approve Character LoRA Training ─────────────────────────────
  adminApproveCharacterLora: adminProcedure
    .input(z.object({
      jobId: z.number(),
      reason: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [job] = await db.select()
        .from(loraTrainingJobs)
        .where(eq(loraTrainingJobs.id, input.jobId))
        .limit(1);

      if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "Training job not found" });

      if (job.status !== "pending_admin_approval") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Can only approve jobs in pending_admin_approval status. Current: ${job.status}`,
        });
      }

      // Update job status to queued (approved by admin, ready for provider)
      await db.update(loraTrainingJobs)
        .set({
          status: "queued",
          adminApprovedBy: ctx.user.id,
          adminApprovedAt: new Date(),
        })
        .where(eq(loraTrainingJobs.id, input.jobId));

      // Update character status to training
      await db.update(characterLibrary)
        .set({ loraStatus: "training" })
        .where(eq(characterLibrary.id, job.characterId));

      return {
        success: true,
        jobId: input.jobId,
        status: "queued" as const,
        message: "Training approved. Job queued for provider submission.",
      };
    }),

  // ── Admin: Reject Character LoRA Training ──────────────────────────────
  adminRejectCharacterLora: adminProcedure
    .input(z.object({
      jobId: z.number(),
      reason: z.string().min(1, "Rejection reason required"),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [job] = await db.select()
        .from(loraTrainingJobs)
        .where(eq(loraTrainingJobs.id, input.jobId))
        .limit(1);

      if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "Training job not found" });

      if (job.status !== "pending_admin_approval") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Can only reject jobs in pending_admin_approval status. Current: ${job.status}`,
        });
      }

      // Set job to cancelled with rejection reason
      await db.update(loraTrainingJobs)
        .set({
          status: "cancelled",
          rejectionReason: input.reason,
          adminApprovedBy: ctx.user.id,
          adminApprovedAt: new Date(),
        })
        .where(eq(loraTrainingJobs.id, input.jobId));

      // Reset character loraStatus back to previous state
      const [char] = await db.select()
        .from(characterLibrary)
        .where(eq(characterLibrary.id, job.characterId))
        .limit(1);

      const newStatus = char?.activeLoraId ? "active" : "untrained";
      await db.update(characterLibrary)
        .set({ loraStatus: newStatus })
        .where(eq(characterLibrary.id, job.characterId));

      return {
        success: true,
        jobId: input.jobId,
        status: "cancelled" as const,
        message: `Training request rejected: ${input.reason}`,
      };
    }),

  // ── Admin: List Pending Character LoRA Jobs ────────────────────────────
  adminListPendingCharacterLora: adminProcedure
    .input(z.object({
      status: z.enum(["pending_admin_approval", "queued", "preprocessing", "training", "validating", "completed", "failed", "cancelled"]).optional(),
      limit: z.number().min(1).max(100).default(50),
      offset: z.number().min(0).default(0),
    }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const statusFilter = input?.status || "pending_admin_approval";
      const limit = input?.limit || 50;
      const offset = input?.offset || 0;

      const jobs = await db.select()
        .from(loraTrainingJobs)
        .where(eq(loraTrainingJobs.status, statusFilter))
        .orderBy(desc(loraTrainingJobs.createdAt))
        .limit(limit)
        .offset(offset);

      // Enrich with character names
      const charIds = Array.from(new Set(jobs.map(j => j.characterId)));
      const chars = charIds.length > 0
        ? await db.select({ id: characterLibrary.id, name: characterLibrary.name })
            .from(characterLibrary)
            .where(inArray(characterLibrary.id, charIds))
        : [];
      const charMap = new Map(chars.map(c => [c.id, c.name]));

      return {
        jobs: jobs.map(j => ({
          ...j,
          characterName: charMap.get(j.characterId) ?? "Unknown",
        })),
        total: jobs.length,
      };
    }),

  // ── Wave 7 Item 3: PuLID Photo-to-Anime — PERMANENTLY DROPPED ────────────────
  // Removed in Wave 7 close-out. Empirical finding: fal-ai/flux-pulid identity
  // preservation 0.40 vs 0.75 threshold (1/7 scenarios pass). Model produces
  // excellent anime art but is "style transfer with loose reference" not true
  // identity-preserving generation. Strategic decision: drop feature entirely.
  // See: server/deprecated/pulid-adapter.ts for archived code + rationale.
});

// ─── Simulated Completion Helper ──────────────────────────────────────────
// In production, this would be replaced by a real job queue callback.
// For now, it simulates the lifecycle: queued → processing → completed.

async function scheduleSimulatedCompletion(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  jobId: number,
  originalDriftScore: number,
  baseDelayMs: number = 2000,
) {
  // Stage 1: queued → processing
  setTimeout(async () => {
    try {
      await db.update(fixDriftJobs)
        .set({
          status: "processing",
          progress: 30,
          startedAt: new Date(),
        })
        .where(eq(fixDriftJobs.id, jobId));
    } catch { /* ignore */ }
  }, baseDelayMs);

  // Stage 2: processing → 60%
  setTimeout(async () => {
    try {
      await db.update(fixDriftJobs)
        .set({ progress: 60 })
        .where(eq(fixDriftJobs.id, jobId));
    } catch { /* ignore */ }
  }, baseDelayMs + 2000);

  // Stage 3: completed with improvement
  setTimeout(async () => {
    try {
      const improvement = originalDriftScore * (0.3 + Math.random() * 0.4); // 30-70% improvement
      const newDriftScore = Math.round((originalDriftScore - improvement) * 10000) / 10000;

      await db.update(fixDriftJobs)
        .set({
          status: "completed",
          progress: 100,
          newDriftScore,
          driftImprovement: Math.round(improvement * 10000) / 10000,
          completedAt: new Date(),
        })
        .where(eq(fixDriftJobs.id, jobId));
    } catch { /* ignore */ }
  }, baseDelayMs + 5000);
}
