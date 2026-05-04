/**
 * Wave 2 Item 3: D6 Color Director tRPC Router
 *
 * Protected procedures for color script generation, approval,
 * palette editing, and lock management.
 */
import { z } from "zod";
import { protectedProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import {
  generateColorScript,
  getColorScriptByEpisode,
  getColorScriptById,
  getColorScriptsByProject,
  approveColorScript,
  rejectColorScript,
  lockPalettes,
  unlockPalettes,
  updateCharacterPalette,
  updateScenePalette,
  getCharacterColorPalette,
  getSceneColorPalette,
  getSceneMoodPoint,
  arePalettesLocked,
} from "./benchmarks/d6/color-director";

export const colorDirectorRouter = router({
  /**
   * Generate a color script for an episode.
   */
  generate: protectedProcedure
    .input(z.object({
      projectId: z.number().int().positive(),
      episodeId: z.number().int().positive(),
      styleBundleKey: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const result = await generateColorScript({
        projectId: input.projectId,
        episodeId: input.episodeId,
        userId: ctx.user.id,
        styleBundleKey: input.styleBundleKey,
      });
      return result;
    }),

  /**
   * Get the latest color script for an episode.
   */
  getByEpisode: protectedProcedure
    .input(z.object({
      episodeId: z.number().int().positive(),
    }))
    .query(async ({ input }) => {
      const script = await getColorScriptByEpisode(input.episodeId);
      if (!script) return null;
      return formatColorScript(script);
    }),

  /**
   * Get a color script by ID.
   */
  getById: protectedProcedure
    .input(z.object({
      id: z.number().int().positive(),
    }))
    .query(async ({ input }) => {
      const script = await getColorScriptById(input.id);
      if (!script) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Color script not found" });
      }
      return formatColorScript(script);
    }),

  /**
   * List all color scripts for a project.
   */
  listByProject: protectedProcedure
    .input(z.object({
      projectId: z.number().int().positive(),
    }))
    .query(async ({ input }) => {
      const scripts = await getColorScriptsByProject(input.projectId);
      return scripts.map(formatColorScript);
    }),

  /**
   * Approve a color script.
   */
  approve: protectedProcedure
    .input(z.object({
      id: z.number().int().positive(),
    }))
    .mutation(async ({ ctx, input }) => {
      const success = await approveColorScript(input.id, ctx.user.id);
      if (!success) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot approve: color script is not in 'generated' state",
        });
      }
      return { success: true };
    }),

  /**
   * Reject a color script with a reason.
   */
  reject: protectedProcedure
    .input(z.object({
      id: z.number().int().positive(),
      reason: z.string().min(1).max(500),
    }))
    .mutation(async ({ input }) => {
      const success = await rejectColorScript(input.id, input.reason);
      if (!success) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot reject: color script not found",
        });
      }
      return { success: true };
    }),

  /**
   * Lock palettes to prevent downstream edits.
   */
  lockPalettes: protectedProcedure
    .input(z.object({
      id: z.number().int().positive(),
      palettes: z.array(z.enum(["characters", "scenes", "mood"])).min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const success = await lockPalettes(input.id, ctx.user.id, input.palettes);
      if (!success) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot lock: color script must be approved or already locked",
        });
      }
      return { success: true };
    }),

  /**
   * Unlock palettes.
   */
  unlockPalettes: protectedProcedure
    .input(z.object({
      id: z.number().int().positive(),
    }))
    .mutation(async ({ input }) => {
      const success = await unlockPalettes(input.id);
      if (!success) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot unlock: color script is not locked",
        });
      }
      return { success: true };
    }),

  /**
   * Update a character's palette.
   */
  updateCharacterPalette: protectedProcedure
    .input(z.object({
      colorScriptId: z.number().int().positive(),
      characterId: z.number().int().positive(),
      updates: z.object({
        primary: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
        secondary: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
        accent: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
        skin: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
        hair: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
        eyes: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
        outline: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
      }),
    }))
    .mutation(async ({ input }) => {
      const success = await updateCharacterPalette(
        input.colorScriptId,
        input.characterId,
        input.updates,
      );
      if (!success) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Failed to update character palette",
        });
      }
      return { success: true };
    }),

  /**
   * Update a scene's palette.
   */
  updateScenePalette: protectedProcedure
    .input(z.object({
      colorScriptId: z.number().int().positive(),
      sceneNumber: z.number().int().positive(),
      updates: z.object({
        background: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
        midground: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
        foreground: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
        ambient: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
        lighting: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
        accent: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
        timeOfDay: z.string().optional(),
        weather: z.string().optional(),
      }),
    }))
    .mutation(async ({ input }) => {
      const success = await updateScenePalette(
        input.colorScriptId,
        input.sceneNumber,
        input.updates,
      );
      if (!success) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Failed to update scene palette",
        });
      }
      return { success: true };
    }),

  /**
   * Integration: Get character palette for downstream agents.
   */
  getCharacterPalette: protectedProcedure
    .input(z.object({
      episodeId: z.number().int().positive(),
      characterId: z.number().int().positive(),
    }))
    .query(async ({ input }) => {
      return getCharacterColorPalette(input.episodeId, input.characterId);
    }),

  /**
   * Integration: Get scene palette for downstream agents.
   */
  getScenePalette: protectedProcedure
    .input(z.object({
      episodeId: z.number().int().positive(),
      sceneNumber: z.number().int().positive(),
    }))
    .query(async ({ input }) => {
      return getSceneColorPalette(input.episodeId, input.sceneNumber);
    }),

  /**
   * Integration: Check if palettes are locked.
   */
  isLocked: protectedProcedure
    .input(z.object({
      episodeId: z.number().int().positive(),
    }))
    .query(async ({ input }) => {
      return { locked: await arePalettesLocked(input.episodeId) };
    }),
});

// ─── Helpers ──────────────────────────────────────────────────────────

function formatColorScript(script: any) {
  return {
    id: script.id,
    projectId: script.projectId,
    episodeId: script.episodeId,
    characterPalettes: script.characterPalettes ?? [],
    scenePalettes: script.scenePalettes ?? [],
    moodProgression: script.moodProgression ?? [],
    paletteLock: script.paletteLock ?? { locked: false, lockedBy: null, lockedAt: null, lockedPalettes: [] },
    styleBundleKey: script.styleBundleKey,
    generationCostUsd: script.generationCostUsd ? parseFloat(script.generationCostUsd) : 0,
    status: script.status,
    approvedAt: script.approvedAt,
    rejectedReason: script.rejectedReason,
    createdAt: script.createdAt,
    updatedAt: script.updatedAt,
  };
}
