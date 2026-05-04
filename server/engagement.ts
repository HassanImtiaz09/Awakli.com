/**
 * Engagement Service — Comments, Related Episodes
 *
 * Provides engagement features for the anime watch page:
 *   - Comments with threaded replies (reuses existing comments table)
 *   - Related episodes (same-project + similar-genre discovery)
 *
 * All DB operations delegate to existing helpers in db.ts.
 */

import {
  createComment, getCommentsByEpisode, deleteComment,
  getEpisodeById, getEpisodesByProject, getProjectById,
} from "./db";

// ─── Types ────────────────────────────────────────────────────────────

export interface LikeResult {
  liked: boolean;
  likeCount: number;
}

export interface LikeStatus {
  liked: boolean;
  likeCount: number;
}

export interface CommentData {
  episodeId: number;
  userId: number;
  content: string;
  parentId?: number | null;
}

export interface CommentResult {
  id: number;
  episodeId: number;
  userId: number;
  parentId: number | null;
  content: string;
  upvotes: number | null;
  downvotes: number | null;
  createdAt: Date;
  userName: string | null;
}

export interface RelatedEpisode {
  id: number;
  projectId: number;
  episodeNumber: number;
  title: string | null;
  synopsis: string | null;
  thumbnailUrl: string | null;
  streamThumbnailUrl: string | null;
  durationSeconds: number | null;
  viewCount: number;
  source: "same-project" | "similar-genre";
}


// ─── Comments ─────────────────────────────────────────────────────────

/**
 * Add a comment to an episode.
 */
export async function addComment(data: CommentData): Promise<number> {
  const commentId = await createComment({
    episodeId: data.episodeId,
    userId: data.userId,
    content: data.content,
    parentId: data.parentId ?? null,
  });
  return commentId;
}

/**
 * Get paginated comments for an episode with user info.
 * Supports sorting by newest, oldest, or popular (top).
 */
export async function getComments(
  episodeId: number,
  sort: "newest" | "oldest" | "top" = "newest",
  page: number = 1,
  pageSize: number = 20,
): Promise<{ comments: CommentResult[]; total: number; hasMore: boolean }> {
  const allComments = await getCommentsByEpisode(episodeId, sort);

  const total = allComments.length;
  const start = (page - 1) * pageSize;
  const end = start + pageSize;
  const paged = allComments.slice(start, end);

  return {
    comments: paged.map((c) => ({
      id: c.id,
      episodeId: c.episodeId,
      userId: c.userId,
      parentId: c.parentId,
      content: c.content,
      upvotes: c.upvotes,
      downvotes: c.downvotes,
      createdAt: c.createdAt,
      userName: c.userName,
    })),
    total,
    hasMore: end < total,
  };
}

/**
 * Delete a comment (only the author can delete).
 */
export async function removeComment(commentId: number, userId: number): Promise<void> {
  await deleteComment(commentId, userId);
}

// ─── Related Episodes ─────────────────────────────────────────────────

/**
 * Get related episodes for a given episode.
 * Returns episodes from the same project (excluding current),
 * plus episodes from projects with similar genres.
 */
export async function getRelatedEpisodes(
  episodeId: number,
  projectId: number,
  limit: number = 12,
): Promise<RelatedEpisode[]> {
  const related: RelatedEpisode[] = [];

  // 1. Same-project episodes (excluding current)
  const projectEpisodes = await getEpisodesByProject(projectId);
  const sameProject = projectEpisodes
    .filter((ep) => ep.id !== episodeId && ep.status === "published")
    .map((ep) => ({
      id: ep.id,
      projectId: ep.projectId,
      episodeNumber: ep.episodeNumber,
      title: ep.title,
      synopsis: ep.synopsis ?? null,
      thumbnailUrl: (ep as any).streamThumbnailUrl || null,
      streamThumbnailUrl: (ep as any).streamThumbnailUrl || null,
      durationSeconds: (ep as any).duration ?? null,
      viewCount: (ep as any).viewCount ?? 0,
      source: "same-project" as const,
    }));

  related.push(...sameProject);

  // If we have enough from same project, return early
  if (related.length >= limit) {
    return related.slice(0, limit);
  }

  // 2. Try to find similar-genre episodes from other projects
  try {
    // Use direct DB query to get project without userId requirement
    const { getDb } = await import("./db");
    const db2 = await getDb();
    const { projects: projectsTable } = await import("../drizzle/schema");
    const { eq: eq2 } = await import("drizzle-orm");
    const projectResult = db2 ? await db2.select().from(projectsTable).where(eq2(projectsTable.id, projectId)).limit(1) : [];
    const currentProject = projectResult[0];
    if (currentProject && currentProject.genre) {
      // Import dynamically to avoid circular deps
      if (db2) {
        const { episodes, projects } = await import("../drizzle/schema");
        const { eq, ne, and, like, sql } = await import("drizzle-orm");

        const genrePattern = `%${currentProject.genre}%`;
        const similarEpisodes = await db2
          .select({
            id: episodes.id,
            projectId: episodes.projectId,
            episodeNumber: episodes.episodeNumber,
            title: episodes.title,
            synopsis: episodes.synopsis,
            streamThumbnailUrl: episodes.streamThumbnailUrl,
            durationSeconds: sql<number>`COALESCE(${episodes.duration}, 0)`,
            viewCount: sql<number>`COALESCE(${episodes.viewCount}, 0)`,
          })
          .from(episodes)
          .innerJoin(projects, eq(episodes.projectId, projects.id))
          .where(
            and(
              eq(episodes.status, "published"),
              ne(episodes.projectId, projectId),
              ne(episodes.id, episodeId),
              like(projects.genre, genrePattern),
            ),
          )
          .orderBy(sql`COALESCE(${episodes.viewCount}, 0) DESC`)
          .limit(limit - related.length);

        for (const ep of similarEpisodes) {
          related.push({
            id: ep.id,
            projectId: ep.projectId,
            episodeNumber: ep.episodeNumber,
            title: ep.title,
            synopsis: ep.synopsis ?? null,
            thumbnailUrl: ep.streamThumbnailUrl || null,
            streamThumbnailUrl: ep.streamThumbnailUrl || null,
            durationSeconds: ep.durationSeconds ?? null,
            viewCount: ep.viewCount ?? 0,
            source: "similar-genre",
          });
        }
      }
    }
  } catch (err) {
    // Silently fail for similar-genre — same-project results are sufficient
    console.warn("[Engagement] Failed to fetch similar-genre episodes:", err);
  }

  return related.slice(0, limit);
}
