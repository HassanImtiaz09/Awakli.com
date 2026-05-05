/**
 * P26 Character Bible & Spatial Consistency — tRPC Router
 *
 * Exposes the character bible pipeline via tRPC procedures:
 *   - getRegistry / updateRegistry / getRegistryHistory
 *   - lockCharacter (switch identity mode)
 *   - getQaResults (per panel / per project)
 *   - getPipelineState
 *   - triggerReferenceRegeneration
 */

import { z } from "zod";
import { router, publicProcedure, protectedProcedure, adminProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "./db";
import { loraTrainingJobs, characterLibrary, characterLoras } from "../drizzle/schema";
import { eq, and, sql } from "drizzle-orm";
import { estimateTrainingJob } from "./lora-training-pipeline";
import {
  getCharacterRegistry,
  upsertCharacterRegistry,
  getRegistryHistory,
  getQaResultsForPanel,
  getQaResultsForProject,
  getPipelineState,
} from "./character-bible";
import type { CharacterRegistry, CharacterEntry } from "./character-bible/types";

export const characterBibleRouter = router({
  // ─── Get Registry ───────────────────────────────────────────────────
  getRegistry: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ input }) => {
      const result = await getCharacterRegistry(input.projectId);
      if (!result) return null;
      return {
        id: result.id,
        registry: result.registry,
        version: result.version,
      };
    }),

  // ─── Get Registry History ─────────────────────────────────────────
  getRegistryHistory: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ input }) => {
      const rows = await getRegistryHistory(input.projectId);
      return rows.map((r) => ({
        id: r.id,
        version: r.version,
        createdAt: r.createdAt,
        characterCount: (r.registryJson as CharacterRegistry)?.characters?.length ?? 0,
      }));
    }),

  // ─── Update Character Attributes ──────────────────────────────────
  updateCharacter: protectedProcedure
    .input(
      z.object({
        projectId: z.number(),
        characterId: z.string(),
        updates: z.object({
          heightCm: z.number().optional(),
          build: z.enum(["slim", "average", "athletic", "muscular", "heavyset"]).optional(),
          hairColor: z.string().optional(),
          hairStyle: z.string().optional(),
          eyeColor: z.string().optional(),
          skinTone: z.string().optional(),
          defaultOutfit: z.string().optional(),
          distinguishingFeatures: z.array(z.string()).optional(),
        }),
      }),
    )
    .mutation(async ({ input }) => {
      const existing = await getCharacterRegistry(input.projectId);
      if (!existing) throw new Error("No character registry found");

      const registry = existing.registry;
      const charIdx = registry.characters.findIndex(
        (c) => c.characterId === input.characterId,
      );
      if (charIdx < 0) throw new Error("Character not found in registry");

      // Apply updates
      const char = registry.characters[charIdx];
      const updatedAttributes = { ...char.attributes };
      for (const [key, value] of Object.entries(input.updates)) {
        if (value !== undefined) {
          (updatedAttributes as any)[key] = value;
        }
      }

      registry.characters[charIdx] = {
        ...char,
        attributes: updatedAttributes,
      };

      // Recalculate tallest height
      registry.tallestHeightCm = Math.max(
        ...registry.characters.map((c) => c.attributes.heightCm),
      );

      const result = await upsertCharacterRegistry(input.projectId, registry);
      return { success: true, version: result.version };
    }),

  // ─── Lock Character Identity Mode ─────────────────────────────────
  lockCharacter: protectedProcedure
    .input(
      z.object({
        projectId: z.number(),
        characterId: z.string(),
        identityMode: z.enum(["none", "ip_adapter", "lora"]),
      }),
    )
    .mutation(async ({ input }) => {
      const existing = await getCharacterRegistry(input.projectId);
      if (!existing) throw new Error("No character registry found");

      const registry = existing.registry;
      const charIdx = registry.characters.findIndex(
        (c) => c.characterId === input.characterId,
      );
      if (charIdx < 0) throw new Error("Character not found in registry");

      const char = registry.characters[charIdx];

      // Validate mode is possible
      if (input.identityMode === "lora" && !char.identity.loraUrl) {
        throw new Error("LoRA model not available for this character. Train a LoRA first.");
      }
      if (input.identityMode === "ip_adapter" && !char.identity.ipAdapterRefUrl) {
        throw new Error("No reference image available for IP-Adapter.");
      }

      registry.characters[charIdx] = {
        ...char,
        identity: {
          ...char.identity,
          identityMode: input.identityMode,
        },
      };

      const result = await upsertCharacterRegistry(input.projectId, registry);
      return { success: true, version: result.version, identityMode: input.identityMode };
    }),

  // ─── QA Results ───────────────────────────────────────────────────
  getQaResultsForPanel: protectedProcedure
    .input(z.object({ panelId: z.number() }))
    .query(async ({ input }) => {
      return getQaResultsForPanel(input.panelId);
    }),

  getQaResultsForProject: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ input }) => {
      return getQaResultsForProject(input.projectId);
    }),

  // ─── Pipeline State ───────────────────────────────────────────────
  getPipelineState: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(({ input }) => {
      const state = getPipelineState(input.projectId);
      return state ?? null;
    }),

  // ─── Train Character LoRA (Admin Gate Pattern) ────────────────────────
  /**
   * Inserts a training job with pending_admin_approval status + cost estimate.
   * Does NOT call any provider — admin must approve first.
   * Mirrors the sakufuu pattern in routers-lora.ts.
   */
  trainCharacterLora: protectedProcedure
    .input(z.object({
      characterId: z.number(),
      projectId: z.number(),
      gpuType: z.enum(["h100_sxm", "a100_80gb", "rtx_4090"]).default("h100_sxm"),
      trainingSteps: z.number().min(500).max(1500).default(1200),
      learningRate: z.number().min(5e-5).max(3e-4).default(1e-4),
      rank: z.number().min(16).max(64).default(32),
      alpha: z.number().min(8).max(32).default(16),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // Verify ownership
      const [char] = await db.select()
        .from(characterLibrary)
        .where(and(
          eq(characterLibrary.id, input.characterId),
          eq(characterLibrary.userId, ctx.user.id)
        ))
        .limit(1);
      if (!char) throw new TRPCError({ code: "NOT_FOUND", message: "Character not found or not owned by user" });

      // Block if already in-flight
      if (char.loraStatus === "training" || char.loraStatus === "validating" || char.loraStatus === "pending_admin_approval") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Training already in progress or pending approval. Current status: ${char.loraStatus}`,
        });
      }

      // Require reference sheet
      if (!char.referenceSheetUrl) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Character must have a reference sheet before training" });
      }

      // Determine next LoRA version
      const [maxVersion] = await db.select({ max: sql<number>`COALESCE(MAX(version), 0)` })
        .from(characterLoras)
        .where(eq(characterLoras.characterId, input.characterId));
      const nextVersion = (maxVersion?.max ?? 0) + 1;

      // Build trigger word
      const triggerWord = `awk_${input.characterId}`;

      // Compute cost estimate (NO provider call)
      const estimate = estimateTrainingJob(input.gpuType, input.trainingSteps);
      const estimatedCostCents = Math.round(estimate.withMargin.costUsd * 100);

      // Insert training job as pending_admin_approval
      const [jobResult] = await db.insert(loraTrainingJobs).values({
        characterId: input.characterId,
        loraId: 0, // Will be assigned after approval
        userId: ctx.user.id,
        status: "pending_admin_approval",
        priority: 1,
        gpuType: input.gpuType,
        costUsd: String(estimate.withMargin.costUsd),
        costCredits: String(estimate.withMargin.costCredits),
        estimatedCostCents,
      });
      const jobId = (jobResult as any).insertId as number;

      // Update character status
      await db.update(characterLibrary)
        .set({ loraStatus: "pending_admin_approval" })
        .where(eq(characterLibrary.id, input.characterId));

      return {
        jobId,
        characterId: input.characterId,
        version: nextVersion,
        triggerWord,
        status: "pending_admin_approval" as const,
        estimatedCostCents,
        estimate: {
          gpuType: input.gpuType,
          trainingSteps: input.trainingSteps,
          costUsd: estimate.withMargin.costUsd,
          costCredits: estimate.withMargin.costCredits,
        },
        message: "Training request submitted. Awaiting admin approval before provider submission.",
      };
    }),

  // ─── Admin: Approve Character LoRA Training ───────────────────────────
  /**
   * Admin approves a pending training job → triggers actual Replicate submission.
   * Mirrors adminApproveTraining in routers-lora.ts.
   */
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

      // Verify Replicate token is configured
      const apiToken = process.env.REPLICATE_API_TOKEN;
      if (!apiToken) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Training provider (Replicate) not configured" });
      }

      // Get character for training data
      const [char] = await db.select()
        .from(characterLibrary)
        .where(eq(characterLibrary.id, job.characterId))
        .limit(1);
      if (!char) throw new TRPCError({ code: "NOT_FOUND", message: "Character not found" });

      // Submit to Replicate
      const triggerWord = `awk_${job.characterId}`;
      const response = await fetch("https://api.replicate.com/v1/trainings", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "ostris/flux-dev-lora-trainer",
          input: {
            input_images: char.referenceSheetUrl,
            trigger_word: triggerWord,
            steps: 1200,
            learning_rate: 1e-4,
            resolution: "512,768",
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Provider submission failed: ${response.status} ${errorText}`,
        });
      }

      const replicateResult = await response.json() as { id: string };

      // Update job: approved + queued with external job ID
      await db.update(loraTrainingJobs)
        .set({
          status: "queued",
          runpodJobId: replicateResult.id,
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
        externalJobId: replicateResult.id,
        status: "queued" as const,
        message: "Training approved and submitted to Replicate.",
      };
    }),

  // ─── Admin: Reject Character LoRA Training ────────────────────────────
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

      await db.update(loraTrainingJobs)
        .set({
          status: "cancelled",
          rejectionReason: input.reason,
          adminApprovedBy: ctx.user.id,
          adminApprovedAt: new Date(),
        })
        .where(eq(loraTrainingJobs.id, input.jobId));

      // Reset character loraStatus to untrained
      await db.update(characterLibrary)
        .set({ loraStatus: "untrained" })
        .where(eq(characterLibrary.id, job.characterId));

      return {
        success: true,
        jobId: input.jobId,
        status: "cancelled" as const,
        reason: input.reason,
        message: "Training rejected. Character LoRA status reset.",
      };
    }),
});
