/**
 * Engagement Router — Comments, Related Episodes
 *
 * tRPC endpoints for watch page engagement features.
 */

import { z } from "zod";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import {
  addComment,
  getComments,
  removeComment,
  getRelatedEpisodes,
} from "./engagement";

export const engagementRouter = router({
  /**
   * Add a comment to an episode.
   * Supports threaded replies via parentId.
   */
  addComment: protectedProcedure
    .input(
      z.object({
        episodeId: z.number(),
        content: z.string().min(1).max(2000),
        parentId: z.number().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const commentId = await addComment({
        episodeId: input.episodeId,
        userId: ctx.user.id,
        content: input.content,
        parentId: input.parentId ?? null,
      });
      return { id: commentId };
    }),

  /**
   * Get paginated comments for an episode (public).
   */
  getComments: publicProcedure
    .input(
      z.object({
        episodeId: z.number(),
        sort: z.enum(["newest", "oldest", "top"]).default("newest"),
        page: z.number().min(1).default(1),
        pageSize: z.number().min(1).max(50).default(20),
      }),
    )
    .query(async ({ input }) => {
      return getComments(input.episodeId, input.sort, input.page, input.pageSize);
    }),

  /**
   * Delete a comment (only the author can delete).
   */
  deleteComment: protectedProcedure
    .input(z.object({ commentId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await removeComment(input.commentId, ctx.user.id);
      return { success: true };
    }),

  /**
   * Get related episodes for the carousel.
   * Returns same-project episodes + similar-genre episodes.
   */
  getRelatedEpisodes: publicProcedure
    .input(
      z.object({
        episodeId: z.number(),
        projectId: z.number(),
        limit: z.number().min(1).max(24).default(12),
      }),
    )
    .query(async ({ input }) => {
      return getRelatedEpisodes(input.episodeId, input.projectId, input.limit);
    }),
});
