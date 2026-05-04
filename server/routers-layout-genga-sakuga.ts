/**
 * tRPC routers for D1.25 Layout Director, D1.5 Genga Director, D2.5 Sakuga Kantoku
 */
import { z } from "zod";
import { router, publicProcedure, protectedProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";

import {
  generateLayouts, getLayoutsByEpisode, getLayoutsByScene,
  getLayoutById, approveLayout, rejectLayout, updateLayoutComposition,
  generateCompositionSketch, approveAllLayoutsForEpisode,
  CAMERA_ANGLES,
} from "./benchmarks/d1-25/layout-director";

import {
  generateRoughGenga, generateCleanGenga, assembleFlipBookPreview,
  approveRoughGenga, approveCleanGenga, rejectGenga, approveFlipBook,
  getKeyframeById, getKeyframesByEpisode, getKeyframesByScene,
  getFlipBooksByEpisode, getFlipBookById, regenerateKeyframe,
} from "./benchmarks/d1-5/genga-director";

import {
  runSakugaReview, getReviewById, getReviewsByEpisode,
  getLatestReview, getReviewsByProject, acknowledgeReview,
} from "./benchmarks/d2-5/sakuga-kantoku";

export const layoutDirectorRouter = router({
  generate: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      episodeId: z.number(),
      scriptScenes: z.array(z.object({
        sceneNumber: z.number(),
        location: z.string(),
        timeOfDay: z.string(),
        mood: z.string(),
        description: z.string(),
        panels: z.array(z.object({
          panelNumber: z.number(),
          visualDescription: z.string(),
          cameraAngle: z.string().optional(),
          dialogue: z.array(z.object({ character: z.string(), text: z.string() })),
        })),
      })),
      characters: z.array(z.object({
        id: z.number(), name: z.string(), role: z.string(), visualTraits: z.any().optional(),
      })),
      colorScript: z.object({
        scenePalettes: z.array(z.any()), characterPalettes: z.array(z.any()),
      }).optional(),
    }))
    .mutation(async ({ ctx, input }) => generateLayouts({ ...input, userId: ctx.user.id } as any)),

  getByEpisode: protectedProcedure
    .input(z.object({ episodeId: z.number() }))
    .query(async ({ input }) => getLayoutsByEpisode(input.episodeId)),

  getByScene: protectedProcedure
    .input(z.object({ episodeId: z.number(), sceneNumber: z.number() }))
    .query(async ({ input }) => getLayoutsByScene(input.episodeId, input.sceneNumber)),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const layout = await getLayoutById(input.id);
      if (!layout) throw new TRPCError({ code: "NOT_FOUND", message: "Layout not found" });
      return layout;
    }),

  approve: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const ok = await approveLayout(input.id, ctx.user.id);
      if (!ok) throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot approve this layout" });
      return { success: true };
    }),

  reject: protectedProcedure
    .input(z.object({ id: z.number(), reason: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const ok = await rejectLayout(input.id, input.reason);
      if (!ok) throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot reject this layout" });
      return { success: true };
    }),

  updateComposition: protectedProcedure
    .input(z.object({
      id: z.number(),
      updates: z.object({
        cameraAngle: z.string().optional(),
        cameraMovement: z.string().optional(),
        depthLayers: z.any().optional(),
        characterPlacements: z.array(z.any()).optional(),
        compositionNotes: z.string().optional(),
      }),
    }))
    .mutation(async ({ input }) => {
      const ok = await updateLayoutComposition(input.id, input.updates as any);
      if (!ok) throw new TRPCError({ code: "NOT_FOUND", message: "Layout not found" });
      return { success: true };
    }),

  generateSketch: protectedProcedure
    .input(z.object({ layoutId: z.number(), sceneDescription: z.string(), projectId: z.number() }))
    .mutation(async ({ input }) => {
      const layout = await getLayoutById(input.layoutId);
      if (!layout) throw new TRPCError({ code: "NOT_FOUND", message: "Layout not found" });
      return generateCompositionSketch(input.layoutId, layout.layoutJson as any, input.sceneDescription, input.projectId);
    }),

  approveAll: protectedProcedure
    .input(z.object({ episodeId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const count = await approveAllLayoutsForEpisode(input.episodeId, ctx.user.id);
      return { approved: count };
    }),

  cameraAngles: publicProcedure.query(() => CAMERA_ANGLES),
});

export const gengaDirectorRouter = router({
  generateRough: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      episodeId: z.number(),
      layouts: z.array(z.object({
        layoutId: z.number(), sceneNumber: z.number(), panelNumber: z.number(),
        cameraAngle: z.string(), characterPlacements: z.array(z.any()),
        depthLayers: z.any(), compositionNotes: z.string().optional(),
      })),
      characterSheets: z.array(z.object({
        characterId: z.number(), name: z.string(),
        frontViewUrl: z.string().optional(), referenceSheetUrl: z.string().optional(),
      })),
      colorHints: z.object({
        scenePalettes: z.array(z.any()).optional(), characterPalettes: z.array(z.any()).optional(),
      }).optional(),
    }))
    .mutation(async ({ ctx, input }) => generateRoughGenga({ ...input, userId: ctx.user.id })),

  generateClean: protectedProcedure
    .input(z.object({ keyframeId: z.number(), projectId: z.number() }))
    .mutation(async ({ input }) => generateCleanGenga(input.keyframeId, input.projectId)),

  assembleFlipBook: protectedProcedure
    .input(z.object({ projectId: z.number(), episodeId: z.number(), sceneNumber: z.number() }))
    .mutation(async ({ input }) => assembleFlipBookPreview(input.projectId, input.episodeId, input.sceneNumber)),

  approveRough: protectedProcedure
    .input(z.object({ keyframeId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const ok = await approveRoughGenga(input.keyframeId, ctx.user.id);
      if (!ok) throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot approve this keyframe" });
      return { success: true };
    }),

  approveClean: protectedProcedure
    .input(z.object({ keyframeId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const ok = await approveCleanGenga(input.keyframeId, ctx.user.id);
      if (!ok) throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot approve this keyframe" });
      return { success: true };
    }),

  reject: protectedProcedure
    .input(z.object({ keyframeId: z.number(), reason: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const ok = await rejectGenga(input.keyframeId, input.reason);
      if (!ok) throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot reject this keyframe" });
      return { success: true };
    }),

  approveFlipBook: protectedProcedure
    .input(z.object({ previewId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const ok = await approveFlipBook(input.previewId, ctx.user.id);
      if (!ok) throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot approve this flip-book" });
      return { success: true };
    }),

  regenerate: protectedProcedure
    .input(z.object({ keyframeId: z.number(), projectId: z.number() }))
    .mutation(async ({ input }) => regenerateKeyframe(input.keyframeId, input.projectId)),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const kf = await getKeyframeById(input.id);
      if (!kf) throw new TRPCError({ code: "NOT_FOUND", message: "Keyframe not found" });
      return kf;
    }),

  getByEpisode: protectedProcedure
    .input(z.object({ episodeId: z.number() }))
    .query(async ({ input }) => getKeyframesByEpisode(input.episodeId)),

  getByScene: protectedProcedure
    .input(z.object({ episodeId: z.number(), sceneNumber: z.number() }))
    .query(async ({ input }) => getKeyframesByScene(input.episodeId, input.sceneNumber)),

  getFlipBooks: protectedProcedure
    .input(z.object({ episodeId: z.number() }))
    .query(async ({ input }) => getFlipBooksByEpisode(input.episodeId)),

  getFlipBookById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const fb = await getFlipBookById(input.id);
      if (!fb) throw new TRPCError({ code: "NOT_FOUND", message: "Flip-book not found" });
      return fb;
    }),
});

export const sakugaKantokuRouter = router({
  runReview: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      episodeId: z.number(),
      reviewType: z.enum(["full_episode", "scene", "panel_range"]).optional(),
      sceneNumber: z.number().optional(),
      panelRange: z.object({ start: z.number(), end: z.number() }).optional(),
      keyframes: z.array(z.object({
        sceneNumber: z.number(), panelNumber: z.number(),
        roughGengaUrl: z.string().optional(), cleanGengaUrl: z.string().optional(),
        cameraAngle: z.string().optional(), characterPlacements: z.array(z.any()).optional(),
      })),
      characters: z.array(z.object({ name: z.string(), visualTraits: z.any().optional() })),
      colorScript: z.object({
        characterPalettes: z.array(z.any()).optional(), scenePalettes: z.array(z.any()).optional(),
      }).optional(),
    }))
    .mutation(async ({ ctx, input }) => runSakugaReview({ ...input, userId: ctx.user.id })),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const review = await getReviewById(input.id);
      if (!review) throw new TRPCError({ code: "NOT_FOUND", message: "Review not found" });
      return review;
    }),

  getByEpisode: protectedProcedure
    .input(z.object({ episodeId: z.number() }))
    .query(async ({ input }) => getReviewsByEpisode(input.episodeId)),

  getLatest: protectedProcedure
    .input(z.object({ episodeId: z.number() }))
    .query(async ({ input }) => getLatestReview(input.episodeId)),

  getByProject: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ input }) => getReviewsByProject(input.projectId)),

  acknowledge: protectedProcedure
    .input(z.object({ reviewId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const ok = await acknowledgeReview(input.reviewId, ctx.user.id);
      if (!ok) throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot acknowledge this review" });
      return { success: true };
    }),
});
