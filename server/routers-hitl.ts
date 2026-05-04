/**
 * HITL Gate Architecture — tRPC Router (Prompt 17)
 *
 * Exposes gate review, pipeline stage, batch review, and quality analytics
 * endpoints for the frontend gate review UI and admin dashboard.
 */

import { z } from "zod";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { resumePipeline } from "./pipelineOrchestrator";
import { STAGE_TO_NODE, type OrchestratorNode } from "./hitl/orchestrator-bridge";

/**
 * v1.9 OrchestratorNode → legacy NodeName adapter for resumePipeline.
 * This adapter will be removed when the orchestrator is fully rewritten in Wave 3.
 */
const V19_NODE_TO_LEGACY: Partial<Record<OrchestratorNode, "video_gen" | "voice_gen" | "lip_sync" | "music_gen" | "foley_gen" | "ambient_gen" | "assembly">> = {
  video_gen: "video_gen",
  audio_timing: "voice_gen",
  fx_composite: "foley_gen",
  mastering: "assembly",
};
import {
  // Gate manager
  resolveGateConfig,
  resolveAllGateConfigs,
  getGateById,
  getPendingGatesForUser,
  getPendingGateSummary,
  getGatesForPipelineRun,
  recordGateDecision,
  getAuditLogForGate,
  // Pipeline state machine
  initializePipelineStages,
  startStageExecution,
  completeStageGeneration,
  approveStage,
  rejectStage,
  startRegeneration,
  failStage,
  skipStage,
  abortPipeline,
  cascadeRewind,
  getStageByNumber,
  getAllStages,
  getNextPendingStage,
  isPipelineComplete,
  // Notifications
  notifyGateReady,
  // Quality feedback
  writeQualityScore,
  getApprovalRateByStage,
  getAvgConfidenceByStage,
  getCreditsSavedByHitl,
  getMostRegeneratedStages,
  // Timeout / batch
  getBatchReviewableGates,
  processBatchReviewDecision,
  // Types
  type GateDecision,
  type DecisionSource,
  STAGE_NAMES,
  STAGE_DISPLAY_NAMES,
  TOTAL_STAGES,
} from "./hitl";

// ─── Gate Review Router ─────────────────────────────────────────────────

export const gateReviewRouter = router({
  /**
   * Get all pending gates for the current user.
   */
  getPendingGates: protectedProcedure.query(async ({ ctx }) => {
    return getPendingGatesForUser(ctx.user.id);
  }),

  /**
   * Get pending gate summary with project context for the Studio dashboard.
   * Returns gates sorted by priority: blocking first, then by timeout urgency.
   */
  getPendingGateSummary: protectedProcedure.query(async ({ ctx }) => {
    const gates = await getPendingGateSummary(ctx.user.id);
    const blockingCount = gates.filter(g => g.gateType === "blocking").length;
    const advisoryCount = gates.filter(g => g.gateType === "advisory").length;
    const ambientCount = gates.filter(g => g.gateType === "ambient").length;
    return {
      gates,
      totalCount: gates.length,
      blockingCount,
      advisoryCount,
      ambientCount,
    };
  }),

  /**
   * Get a single gate by ID with full details.
   */
  getGate: protectedProcedure
    .input(z.object({ gateId: z.number() }))
    .query(async ({ ctx, input }) => {
      const gate = await getGateById(input.gateId);
      if (!gate) throw new TRPCError({ code: "NOT_FOUND", message: "Gate not found" });
      if (gate.userId !== ctx.user.id && ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      return gate;
    }),

  /**
   * Get all gates for a pipeline run (for the pipeline stepper UI).
   */
  getGatesForRun: protectedProcedure
    .input(z.object({ pipelineRunId: z.number() }))
    .query(async ({ ctx, input }) => {
      return getGatesForPipelineRun(input.pipelineRunId);
    }),

  /**
   * Submit a decision on a gate (approve, reject, regenerate).
   */
  submitDecision: protectedProcedure
    .input(z.object({
      gateId: z.number(),
      decision: z.enum(["approved", "rejected", "regenerate", "regenerate_with_edits"]),
      reason: z.string().optional(),
      qualityScore: z.number().min(1).max(5).optional(),
      regenParamsDiff: z.record(z.string(), z.unknown()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const gate = await getGateById(input.gateId);
      if (!gate) throw new TRPCError({ code: "NOT_FOUND", message: "Gate not found" });
      if (gate.userId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      if (gate.decision !== "pending") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Gate already has decision: ${gate.decision}`,
        });
      }

      await recordGateDecision({
        gateId: input.gateId,
        decision: input.decision as GateDecision,
        decisionSource: "creator" as DecisionSource,
        decisionReason: input.reason,
        qualityScore: input.qualityScore,
        regenParamsDiff: input.regenParamsDiff,
      });

      // Handle post-decision actions
      if (input.decision === "approved") {
        await approveStage(gate.pipelineRunId, gate.stageNumber);
      } else if (input.decision === "rejected") {
        await rejectStage(gate.pipelineRunId, gate.stageNumber);
      } else if (input.decision === "regenerate" || input.decision === "regenerate_with_edits") {
        await startRegeneration(gate.pipelineRunId, gate.stageNumber);
      }

      // Write quality feedback
      await writeQualityScore({
        gateId: input.gateId,
        pipelineRunId: gate.pipelineRunId,
        stageNumber: gate.stageNumber,
        providerId: "unknown", // Will be resolved from stage metadata
        sceneType: "unknown",
        decision: input.decision as GateDecision,
        decisionSource: "creator",
        confidenceScore: gate.confidenceScore || 0,
        isFirstAttempt: true, // Will be resolved from stage attempts
      });

      // Resume pipeline after approve or regenerate (fire-and-forget)
      if (input.decision === "approved" || input.decision === "regenerate" || input.decision === "regenerate_with_edits") {
        const v19Node = STAGE_TO_NODE[gate.stageNumber];
        const legacyNode = v19Node ? V19_NODE_TO_LEGACY[v19Node] : undefined;
        if (legacyNode) {
          const action = input.decision === "approved" ? "continue" : "regenerate";
          // Fire-and-forget: don't await so the response returns immediately
          resumePipeline(gate.pipelineRunId, legacyNode, action).catch((err) => {
            console.error(`[HITL] Failed to resume pipeline ${gate.pipelineRunId} after ${input.decision}:`, err);
          });
        }
      }

      return { success: true, decision: input.decision };
    }),

  /**
   * Get the audit log for a gate.
   */
  getAuditLog: protectedProcedure
    .input(z.object({ gateId: z.number() }))
    .query(async ({ ctx, input }) => {
      return getAuditLogForGate(input.gateId);
    }),
});

// ─── Pipeline Stage Router ──────────────────────────────────────────────

export const pipelineStageRouter = router({
  /**
   * Get all stages for a pipeline run (for the pipeline stepper UI).
   */
  getStages: protectedProcedure
    .input(z.object({ pipelineRunId: z.number() }))
    .query(async ({ ctx, input }) => {
      return getAllStages(input.pipelineRunId);
    }),

  /**
   * Get a single stage by number.
   */
  getStage: protectedProcedure
    .input(z.object({
      pipelineRunId: z.number(),
      stageNumber: z.number().min(1).max(17),
    }))
    .query(async ({ ctx, input }) => {
      return getStageByNumber(input.pipelineRunId, input.stageNumber);
    }),

  /**
   * Check if a pipeline is complete.
   */
  isComplete: protectedProcedure
    .input(z.object({ pipelineRunId: z.number() }))
    .query(async ({ ctx, input }) => {
      return { complete: await isPipelineComplete(input.pipelineRunId) };
    }),

  /**
   * Abort a pipeline run.
   */
  abort: protectedProcedure
    .input(z.object({
      pipelineRunId: z.number(),
      reason: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await abortPipeline(input.pipelineRunId, input.reason || "User aborted");
      return { success: true };
    }),

  /**
   * Get stage names and display names.
   */
  getStageNames: publicProcedure.query(() => {
    return {
      stageNames: STAGE_NAMES,
      displayNames: STAGE_DISPLAY_NAMES,
      totalStages: TOTAL_STAGES,
    };
  }),
});

// ─── Batch Review Router ────────────────────────────────────────────────

export const batchReviewRouter = router({
  /**
   * Get all auto-advanced gates available for batch review.
   */
  getReviewableGates: protectedProcedure.query(async ({ ctx }) => {
    return getBatchReviewableGates(ctx.user.id);
  }),

  /**
   * Submit a batch review decision (confirm, reject, regenerate).
   */
  submitDecision: protectedProcedure
    .input(z.object({
      gateId: z.number(),
      decision: z.enum(["confirm", "reject", "regenerate"]),
      qualityScore: z.number().min(1).max(5).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const result = await processBatchReviewDecision(
        input.gateId,
        input.decision,
        input.qualityScore
      );
      return result;
    }),

  /**
   * Batch confirm multiple auto-advanced gates at once.
   */
  batchConfirm: protectedProcedure
    .input(z.object({
      gateIds: z.array(z.number()),
    }))
    .mutation(async ({ ctx, input }) => {
      const results = [];
      for (const gateId of input.gateIds) {
        try {
          const result = await processBatchReviewDecision(gateId, "confirm");
          results.push({ gateId, success: true, ...result });
        } catch (err) {
          results.push({ gateId, success: false, error: (err as Error).message });
        }
      }
      return results;
    }),
});

// ─── Gate Config Router ─────────────────────────────────────────────────

export const gateConfigRouter = router({
  /**
   * Get gate configs for all 17 stages for the current user's tier.
   */
  getAll: protectedProcedure
    .input(z.object({
      tierName: z.string().default("free"),
    }))
    .query(async ({ ctx, input }) => {
      return resolveAllGateConfigs(input.tierName, ctx.user.id);
    }),

  /**
   * Get gate config for a specific stage.
   */
  getForStage: protectedProcedure
    .input(z.object({
      stageNumber: z.number().min(1).max(17),
      tierName: z.string().default("free"),
    }))
    .query(async ({ ctx, input }) => {
      return resolveGateConfig(input.stageNumber, input.tierName, ctx.user.id);
    }),
});

// ─── Quality Analytics Router ───────────────────────────────────────────

export const qualityAnalyticsRouter = router({
  /**
   * Get approval rate per stage.
   */
  approvalRateByStage: protectedProcedure
    .input(z.object({ days: z.number().default(30) }))
    .query(async ({ ctx, input }) => {
      return getApprovalRateByStage(ctx.user.id, input.days);
    }),

  /**
   * Get average confidence score per stage.
   */
  avgConfidenceByStage: protectedProcedure
    .input(z.object({ days: z.number().default(30) }))
    .query(async ({ ctx, input }) => {
      return getAvgConfidenceByStage(ctx.user.id, input.days);
    }),

  /**
   * Get total credits saved by HITL.
   */
  creditsSaved: protectedProcedure
    .input(z.object({ days: z.number().default(30) }))
    .query(async ({ ctx, input }) => {
      return { creditsSaved: await getCreditsSavedByHitl(ctx.user.id, input.days) };
    }),

  /**
   * Get most-regenerated stages.
   */
  mostRegeneratedStages: protectedProcedure
    .input(z.object({ days: z.number().default(30) }))
    .query(async ({ ctx, input }) => {
      return getMostRegeneratedStages(ctx.user.id, input.days);
    }),

  /**
   * Get combined quality dashboard data.
   */
  dashboard: protectedProcedure
    .input(z.object({ days: z.number().default(30) }))
    .query(async ({ ctx, input }) => {
      const [approvalRates, avgConfidence, creditsSaved, mostRegenerated] = await Promise.all([
        getApprovalRateByStage(ctx.user.id, input.days),
        getAvgConfidenceByStage(ctx.user.id, input.days),
        getCreditsSavedByHitl(ctx.user.id, input.days),
        getMostRegeneratedStages(ctx.user.id, input.days),
      ]);

      return {
        approvalRates,
        avgConfidence,
        creditsSaved,
        mostRegenerated,
      };
    }),
});

// ─── Cascade Rewind Router ──────────────────────────────────────────────

export const cascadeRewindRouter = router({
  /**
   * Trigger a cascade rewind to a specific stage.
   */
  rewind: protectedProcedure
    .input(z.object({
      pipelineRunId: z.number(),
      rewindToStage: z.number().min(1).max(17),
    }))
    .mutation(async ({ ctx, input }) => {
      const result = await cascadeRewind(input.pipelineRunId, input.rewindToStage);
      return result;
    }),
});
