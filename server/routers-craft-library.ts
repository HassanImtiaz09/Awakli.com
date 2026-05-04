/**
 * D10 Craft Library — tRPC Router
 *
 * Exposes the Craft Library to the frontend:
 * - Source management (admin-only: add, update, archive)
 * - Library stats (protected)
 * - Semantic query (protected)
 * - Source listing (protected)
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "./_core/trpc";
import {
  addSource,
  updateSource,
  listSources,
  getSourceById,
  archiveSource,
  getLibraryStats,
} from "./benchmarks/d10/source-manager";
import { queryCraftLibrary } from "./benchmarks/d10/sensei";

// ─── Input Schemas ──────────────────────────────────────────────────────

const subSenseiEnum = z.enum(["anime", "manga", "genga"]);
const sourceTypeEnum = z.enum([
  "web_article", "book_chapter", "video_transcript",
  "tutorial", "interview", "podcast_transcript", "reference_image_set",
]);
const sourceStatusEnum = z.enum(["pending", "ingesting", "ingested", "failed", "archived"]);
const engagementModeEnum = z.enum(["direct", "consult", "validate"]);

// ─── Router ─────────────────────────────────────────────────────────────

export const craftLibraryRouter = router({
  /**
   * List sources with optional filtering.
   * Available to all authenticated users.
   */
  listSources: protectedProcedure
    .input(z.object({
      subSensei: subSenseiEnum.optional(),
      sourceType: sourceTypeEnum.optional(),
      status: sourceStatusEnum.optional(),
      limit: z.number().min(1).max(100).optional(),
      offset: z.number().min(0).optional(),
    }).optional())
    .query(async ({ input }) => {
      return listSources(input ?? {});
    }),

  /**
   * Get a single source by ID.
   */
  getSource: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return getSourceById(input.id);
    }),

  /**
   * Add a new source to the library.
   * Admin-only: only the owner/admin can register new sources.
   */
  addSource: protectedProcedure
    .input(z.object({
      subSensei: subSenseiEnum,
      sourceType: sourceTypeEnum,
      title: z.string().min(1).max(500),
      url: z.string().url().optional(),
      author: z.string().max(200).optional(),
      description: z.string().max(2000).optional(),
      crossTags: z.array(z.string()).optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only admins can add sources" });
      }
      return addSource(input);
    }),

  /**
   * Update a source's status or metadata.
   * Admin-only.
   */
  updateSource: protectedProcedure
    .input(z.object({
      id: z.number(),
      status: sourceStatusEnum.optional(),
      errorMessage: z.string().optional(),
      chunkCount: z.number().optional(),
      totalTokens: z.number().optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only admins can update sources" });
      }
      await updateSource(input);
      return { success: true };
    }),

  /**
   * Archive a source (soft delete).
   * Admin-only.
   */
  archiveSource: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only admins can archive sources" });
      }
      await archiveSource(input.id);
      return { success: true };
    }),

  /**
   * Get library-wide statistics.
   * Available to all authenticated users.
   */
  getStats: protectedProcedure
    .query(async () => {
      return getLibraryStats();
    }),

  /**
   * Query the Craft Library with semantic search + LLM synthesis.
   * Available to all authenticated users.
   */
  query: protectedProcedure
    .input(z.object({
      query: z.string().min(5).max(2000),
      subSensei: subSenseiEnum,
      mode: engagementModeEnum,
      includeCrossTags: z.boolean().optional(),
      pipelineStage: z.string().optional(),
      topK: z.number().min(1).max(20).optional(),
      artifactContext: z.string().max(10000).optional(),
    }))
    .mutation(async ({ input }) => {
      return queryCraftLibrary(input);
    }),
});
