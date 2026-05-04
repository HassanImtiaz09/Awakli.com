/**
 * Wave 2 Item 1: Style Bundles tRPC Router
 *
 * Public: listActive (genre selector)
 * Protected: getByGenreKey (project creation flow)
 * Admin: listAll, create, update, deactivate
 */

import { z } from "zod";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import {
  listActiveBundles,
  listAllBundles,
  getBundleByGenreKey,
  getBundleById,
  createBundle,
  updateBundle,
  deactivateBundle,
} from "./benchmarks/d0/style-bundles";

// ─── Zod Schemas ────────────────────────────────────────────────────────

const colorPaletteSchema = z.object({
  primary: z.string(),
  secondary: z.string(),
  accent: z.string(),
  background: z.string(),
  highlight: z.string(),
  shadow: z.string(),
});

const musicMoodVectorSchema = z.object({
  energy: z.number().min(0).max(1),
  valence: z.number().min(0).max(1),
  tempo_bpm: z.number().int().min(40).max(300),
  instrumentation_tags: z.array(z.string()),
});

const loraConfigSchema = z.object({
  model_id: z.string().nullable(),
  trigger_word: z.string(),
  weight_range: z.tuple([z.number(), z.number()]),
  compatible_bases: z.array(z.string()),
});

const createBundleInput = z.object({
  genreKey: z.string().min(1).max(64).regex(/^[a-z0-9_]+$/, "Must be lowercase alphanumeric with underscores"),
  name: z.string().min(1).max(128),
  description: z.string().optional(),
  aestheticNotes: z.string().optional(),
  promptTemplate: z.string().min(1),
  negativePrompt: z.string().min(1),
  colorPalette: colorPaletteSchema,
  frameRateDefault: z.number().int().min(8).max(60).optional(),
  referenceImageUrls: z.array(z.string().url()).optional(),
  musicMoodVector: musicMoodVectorSchema.optional(),
  loraConfig: loraConfigSchema.optional(),
  previewImageUrl: z.string().url().optional(),
  iconIdentifier: z.string().max(32).optional(),
  isActive: z.number().int().min(0).max(1).optional(),
  sortOrder: z.number().int().optional(),
});

const updateBundleInput = z.object({
  id: z.number().int(),
  name: z.string().min(1).max(128).optional(),
  description: z.string().optional(),
  aestheticNotes: z.string().optional(),
  promptTemplate: z.string().min(1).optional(),
  negativePrompt: z.string().min(1).optional(),
  colorPalette: colorPaletteSchema.optional(),
  frameRateDefault: z.number().int().min(8).max(60).optional(),
  referenceImageUrls: z.array(z.string().url()).optional(),
  musicMoodVector: musicMoodVectorSchema.optional(),
  loraConfig: loraConfigSchema.optional(),
  previewImageUrl: z.string().url().optional(),
  iconIdentifier: z.string().max(32).optional(),
  isActive: z.number().int().min(0).max(1).optional(),
  sortOrder: z.number().int().optional(),
});

// ─── Router ─────────────────────────────────────────────────────────────

export const styleBundlesRouter = router({
  /**
   * Public: List all active style bundles for the genre selector.
   * Returns bundles ordered by sortOrder.
   */
  listActive: publicProcedure.query(async () => {
    return listActiveBundles();
  }),

  /**
   * Protected: Get a specific bundle by genre key.
   * Used during project creation to fetch full bundle config.
   */
  getByGenreKey: protectedProcedure
    .input(z.object({ genreKey: z.string() }))
    .query(async ({ input }) => {
      const bundle = await getBundleByGenreKey(input.genreKey);
      if (!bundle) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Style bundle '${input.genreKey}' not found` });
      }
      return bundle;
    }),

  /**
   * Admin: List ALL bundles (including inactive).
   */
  listAll: protectedProcedure.query(async ({ ctx }) => {
    if (ctx.user.role !== "admin") {
      throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
    }
    return listAllBundles();
  }),

  /**
   * Admin: Get a bundle by ID.
   */
  getById: protectedProcedure
    .input(z.object({ id: z.number().int() }))
    .query(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
      }
      const bundle = await getBundleById(input.id);
      if (!bundle) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Style bundle not found" });
      }
      return bundle;
    }),

  /**
   * Admin: Create a new style bundle.
   */
  create: protectedProcedure
    .input(createBundleInput)
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
      }
      const result = await createBundle(input);
      return { success: true, id: result.id };
    }),

  /**
   * Admin: Update an existing style bundle.
   */
  update: protectedProcedure
    .input(updateBundleInput)
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
      }
      const { id, ...updates } = input;
      const updated = await updateBundle(id, updates);
      if (!updated) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Style bundle not found or no changes" });
      }
      return { success: true };
    }),

  /**
   * Admin: Deactivate a style bundle (soft delete).
   */
  deactivate: protectedProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
      }
      const deactivated = await deactivateBundle(input.id);
      if (!deactivated) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Style bundle not found" });
      }
      return { success: true };
    }),
});
