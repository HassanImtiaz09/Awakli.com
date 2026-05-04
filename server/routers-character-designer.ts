/**
 * Wave 2 Item 2: D0 Character Designer tRPC Router
 *
 * Protected procedures for multi-view reference sheet generation,
 * CLIP validation, and approval gate management.
 */
import { z } from "zod";
import { protectedProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import {
  generateCharacterViews,
  getCharacterViews,
  getGateByCharacter,
  getReferenceSheetStatus,
  approveReferenceSheet,
  rejectReferenceSheet,
  updateViewStatus,
  regenerateView,
} from "./benchmarks/d0/character-designer";

export const characterDesignerRouter = router({
  /**
   * Generate all 4 views for a character (two-pass approach).
   * Pass 1: Front view (text-to-image)
   * Pass 2: Three-quarter, side, back (image-to-image conditioned on front)
   */
  generateViews: protectedProcedure
    .input(z.object({
      characterId: z.number().int().positive(),
      projectId: z.number().int().positive(),
      styleBundleKey: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const result = await generateCharacterViews({
        characterId: input.characterId,
        projectId: input.projectId,
        userId: ctx.user.id,
        styleBundleKey: input.styleBundleKey,
      });

      return {
        success: result.success,
        gateId: result.gateId,
        totalCost: result.totalCost,
        views: result.views.map(v => ({
          viewAngle: v.viewAngle,
          imageUrl: v.imageUrl,
          clipScore: v.clipScore,
          status: v.status,
          attemptNumber: v.attemptNumber,
          costUsd: v.costUsd,
          error: v.error,
        })),
      };
    }),

  /**
   * Get the full reference sheet status for a character.
   * Returns gate, all views, and character info.
   */
  getStatus: protectedProcedure
    .input(z.object({
      characterId: z.number().int().positive(),
    }))
    .query(async ({ input }) => {
      const status = await getReferenceSheetStatus(input.characterId);
      return {
        gate: status.gate ? {
          id: status.gate.id,
          status: status.gate.status,
          overallClipScore: status.gate.overallClipScore ? parseFloat(status.gate.overallClipScore) : null,
          totalCostUsd: status.gate.totalCostUsd ? parseFloat(status.gate.totalCostUsd) : null,
          totalAttempts: status.gate.totalAttempts,
          approvedAt: status.gate.approvedAt,
          rejectedReason: status.gate.rejectedReason,
        } : null,
        views: status.views.map(v => ({
          id: v.id,
          viewAngle: v.viewAngle,
          imageUrl: v.imageUrl,
          clipScore: v.clipScore ? parseFloat(v.clipScore) : null,
          status: v.status,
          attemptNumber: v.attemptNumber,
          generationCostUsd: v.generationCostUsd ? parseFloat(v.generationCostUsd) : null,
          errorMessage: v.errorMessage,
          createdAt: v.createdAt,
        })),
        character: status.character ? {
          id: status.character.id,
          name: status.character.name,
          role: status.character.role,
          visualTraits: status.character.visualTraits,
        } : null,
      };
    }),

  /**
   * Approve the full reference sheet.
   * Marks all views as approved and unblocks downstream agents.
   */
  approveSheet: protectedProcedure
    .input(z.object({
      characterId: z.number().int().positive(),
    }))
    .mutation(async ({ input }) => {
      const success = await approveReferenceSheet(input.characterId);
      if (!success) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot approve: sheet is not in 'all_views_generated' state",
        });
      }
      return { success: true };
    }),

  /**
   * Reject the reference sheet with a reason.
   */
  rejectSheet: protectedProcedure
    .input(z.object({
      characterId: z.number().int().positive(),
      reason: z.string().min(1).max(500),
    }))
    .mutation(async ({ input }) => {
      const success = await rejectReferenceSheet(input.characterId, input.reason);
      if (!success) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot reject: no gate found for this character",
        });
      }
      return { success: true };
    }),

  /**
   * Approve or reject a single view.
   */
  updateViewStatus: protectedProcedure
    .input(z.object({
      viewId: z.number().int().positive(),
      status: z.enum(["approved", "rejected"]),
    }))
    .mutation(async ({ input }) => {
      const success = await updateViewStatus(input.viewId, input.status);
      if (!success) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update view status",
        });
      }
      return { success: true };
    }),

  /**
   * Regenerate a single rejected view.
   */
  regenerateView: protectedProcedure
    .input(z.object({
      viewId: z.number().int().positive(),
    }))
    .mutation(async ({ ctx, input }) => {
      const result = await regenerateView(input.viewId, ctx.user.id);
      return {
        viewAngle: result.viewAngle,
        imageUrl: result.imageUrl,
        clipScore: result.clipScore,
        status: result.status,
        attemptNumber: result.attemptNumber,
        costUsd: result.costUsd,
        error: result.error,
      };
    }),
});
