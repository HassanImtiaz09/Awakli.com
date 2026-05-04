import { eq, desc, and, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  users, projects, mangaUploads, processingJobs,
  episodes, panels, characters,
  comments, follows, watchlist, notifications,
  characterElements,
  InsertUser, InsertProject, InsertMangaUpload, InsertProcessingJob,
  InsertEpisode, InsertPanel, InsertCharacter,
  InsertComment, InsertFollow, InsertWatchlist, InsertNotification,
  InsertCharacterElement,
  uploadedAssets, InsertUploadedAsset,
} from "../drizzle/schema";
import { like, or, asc, count, isNull, ne } from "drizzle-orm";
import { ENV } from "./_core/env";
import { serverLog } from "./observability/logger";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      serverLog.warn("Failed to connect", { error: String(error) });
      _db = null;
    }
  }
  return _db;
}

/** Reset the cached DB connection so the next getDb() creates a fresh one */
export function resetDbConnection() {
  _db = null;
}

/** Retry a DB operation once after resetting the connection on failure */
async function withRetry<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error: any) {
    const msg = error?.message ?? "";
    // If it looks like a connection/query error, reset and retry once
    if (
      msg.includes("Failed query") ||
      msg.includes("ECONNRESET") ||
      msg.includes("PROTOCOL_CONNECTION_LOST") ||
      msg.includes("ETIMEDOUT") ||
      msg.includes("Connection lost") ||
      msg.includes("Cannot enqueue")
    ) {
      serverLog.warn("Connection error detected, retrying with fresh connection");
      resetDbConnection();
      return await operation();
    }
    throw error;
  }
}

// ─── Users ────────────────────────────────────────────────────────────────

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) { serverLog.warn("Cannot upsert user: database not available"); return; }

  try {
    const values: InsertUser = { openId: user.openId };
    const updateSet: Record<string, unknown> = {};
    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];
    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };
    textFields.forEach(assignNullable);
    if (user.lastSignedIn !== undefined) { values.lastSignedIn = user.lastSignedIn; updateSet.lastSignedIn = user.lastSignedIn; }
    if (user.role !== undefined) { values.role = user.role; updateSet.role = user.role; }
    if (!values.lastSignedIn) values.lastSignedIn = new Date();
    if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();
    await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
  } catch (error) {
    serverLog.error("Failed to upsert user", { error: String(error) });
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ─── Guest User ──────────────────────────────────────────────────────────

const GUEST_OPEN_ID = "__guest__";

export async function getOrCreateGuestUser(): Promise<number> {
  return withRetry(async () => {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    const existing = await db.select({ id: users.id }).from(users).where(eq(users.openId, GUEST_OPEN_ID)).limit(1);
    if (existing.length > 0) return existing[0].id;

    await db.insert(users).values({
      openId: GUEST_OPEN_ID,
      name: "Guest",
      email: null,
      loginMethod: "guest",
      role: "user",
      lastSignedIn: new Date(),
    });

    const created = await db.select({ id: users.id }).from(users).where(eq(users.openId, GUEST_OPEN_ID)).limit(1);
    return created[0].id;
  });
}

// ─── Projects ─────────────────────────────────────────────────────────────

export async function getProjectsByUserId(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(projects)
    .where(eq(projects.userId, userId))
    .orderBy(desc(projects.createdAt));
}

export async function getProjectById(id: number, userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(projects)
    .where(and(eq(projects.id, id), eq(projects.userId, userId)))
    .limit(1);
  return result[0];
}

export async function createProject(data: InsertProject) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(projects).values(data);
  return (result as any).insertId as number;
}

export async function updateProject(id: number, userId: number, data: Partial<InsertProject>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(projects).set(data).where(and(eq(projects.id, id), eq(projects.userId, userId)));
}

export async function deleteProject(id: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(projects).where(and(eq(projects.id, id), eq(projects.userId, userId)));
}

// ─── Manga Uploads ────────────────────────────────────────────────────────

export async function createMangaUpload(data: InsertMangaUpload) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(mangaUploads).values(data);
  return (result as any).insertId as number;
}

export async function getMangaUploadsByProject(projectId: number, userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(mangaUploads)
    .where(and(eq(mangaUploads.projectId, projectId), eq(mangaUploads.userId, userId)))
    .orderBy(desc(mangaUploads.createdAt));
}

export async function getMangaUploadById(id: number, userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(mangaUploads)
    .where(and(eq(mangaUploads.id, id), eq(mangaUploads.userId, userId)))
    .limit(1);
  return result[0];
}

export async function updateMangaUploadStatus(id: number, status: InsertMangaUpload["status"]) {
  const db = await getDb();
  if (!db) return;
  await db.update(mangaUploads).set({ status }).where(eq(mangaUploads.id, id));
}

// ─── Processing Jobs ──────────────────────────────────────────────────────

export async function createProcessingJob(data: InsertProcessingJob) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(processingJobs).values(data);
  return (result as any).insertId as number;
}

export async function getJobsByUserId(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(processingJobs)
    .where(eq(processingJobs.userId, userId))
    .orderBy(desc(processingJobs.createdAt));
}

export async function getJobsByProject(projectId: number, userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(processingJobs)
    .where(and(eq(processingJobs.projectId, projectId), eq(processingJobs.userId, userId)))
    .orderBy(desc(processingJobs.createdAt));
}

export async function getJobById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(processingJobs).where(eq(processingJobs.id, id)).limit(1);
  return result[0];
}

export async function updateJob(id: number, data: Partial<InsertProcessingJob>) {
  const db = await getDb();
  if (!db) return;
  await db.update(processingJobs).set(data).where(eq(processingJobs.id, id));
}

// ─── Episodes ────────────────────────────────────────────────────────────

export async function createEpisode(data: InsertEpisode) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(episodes).values(data);
  return (result as any).insertId as number;
}

export async function getEpisodesByProject(projectId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(episodes)
    .where(eq(episodes.projectId, projectId))
    .orderBy(episodes.episodeNumber);
}

export async function getEpisodeById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(episodes).where(eq(episodes.id, id)).limit(1);
  return result[0];
}

export async function updateEpisode(id: number, data: Partial<InsertEpisode>) {
  const db = await getDb();
  if (!db) return;
  await db.update(episodes).set(data).where(eq(episodes.id, id));
}

export async function deleteEpisode(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(episodes).where(eq(episodes.id, id));
}

// ─── Panels ──────────────────────────────────────────────────────────────

export async function createPanel(data: InsertPanel) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(panels).values(data);
  return (result as any).insertId as number;
}

export async function createPanelsBulk(data: InsertPanel[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (data.length === 0) return;
  await db.insert(panels).values(data);
}

export async function getPanelsByEpisode(episodeId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(panels)
    .where(eq(panels.episodeId, episodeId))
    .orderBy(panels.sceneNumber, panels.panelNumber);
}

export async function updatePanel(id: number, data: Partial<InsertPanel>) {
  const db = await getDb();
  if (!db) return;
  await db.update(panels).set(data).where(eq(panels.id, id));
}

export async function deletePanelsByEpisode(episodeId: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(panels).where(eq(panels.episodeId, episodeId));
}

export async function getPanelById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(panels).where(eq(panels.id, id)).limit(1);
  return result[0];
}

export async function getPanelsByProject(projectId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(panels)
    .where(eq(panels.projectId, projectId))
    .orderBy(panels.sceneNumber, panels.panelNumber);
}

export async function batchUpdatePanelStatus(panelIds: number[], status: string, reviewStatus: string) {
  const db = await getDb();
  if (!db) return;
  if (panelIds.length === 0) return;
  await db.update(panels)
    .set({ status: status as any, reviewStatus: reviewStatus as any })
    .where(inArray(panels.id, panelIds));
}

export async function getPanelsGeneratingCount(episodeId: number) {
  const db = await getDb();
  if (!db) return { total: 0, completed: 0, generating: 0 };
  const allPanels = await db.select({ status: panels.status }).from(panels)
    .where(eq(panels.episodeId, episodeId));
  return {
    total: allPanels.length,
    completed: allPanels.filter(p => p.status === 'generated' || p.status === 'approved').length,
    generating: allPanels.filter(p => p.status === 'generating').length,
  };
}

// ─── Characters ──────────────────────────────────────────────────────────

export async function createCharacter(data: InsertCharacter) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(characters).values(data);
  return (result as any).insertId as number;
}

export async function getCharactersByProject(projectId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(characters)
    .where(eq(characters.projectId, projectId))
    .orderBy(desc(characters.createdAt));
}

export async function getCharacterById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(characters).where(eq(characters.id, id)).limit(1);
  return result[0];
}

export async function updateCharacter(id: number, data: Partial<InsertCharacter>) {
  const db = await getDb();
  if (!db) return;
  await db.update(characters).set(data).where(eq(characters.id, id));
}

export async function deleteCharacter(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(characters).where(eq(characters.id, id));
}


// ─── Comments ───────────────────────────────────────────────────────────

export async function createComment(data: InsertComment) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(comments).values(data);
  return (result as any).insertId as number;
}

export async function getCommentsByEpisode(episodeId: number, sort: "newest" | "top" | "oldest" = "newest") {
  const db = await getDb();
  if (!db) return [];
  const orderFn = sort === "oldest" ? asc(comments.createdAt)
    : sort === "top" ? desc(comments.upvotes)
    : desc(comments.createdAt);
  const allComments = await db.select({
    id: comments.id,
    episodeId: comments.episodeId,
    userId: comments.userId,
    parentId: comments.parentId,
    content: comments.content,
    upvotes: comments.upvotes,
    downvotes: comments.downvotes,
    createdAt: comments.createdAt,
    userName: users.name,
  }).from(comments)
    .leftJoin(users, eq(comments.userId, users.id))
    .where(eq(comments.episodeId, episodeId))
    .orderBy(orderFn);
  return allComments;
}

export async function deleteComment(id: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(comments).where(and(eq(comments.id, id), eq(comments.userId, userId)));
}

// ─── Follows ────────────────────────────────────────────────────────────

export async function toggleFollow(followerId: number, followingId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const existing = await db.select().from(follows)
    .where(and(eq(follows.followerId, followerId), eq(follows.followingId, followingId)))
    .limit(1);
  if (existing.length > 0) {
    await db.delete(follows).where(eq(follows.id, existing[0].id));
    return { following: false };
  }
  await db.insert(follows).values({ followerId, followingId });
  return { following: true };
}

export async function getFollowStatus(followerId: number, followingId: number) {
  const db = await getDb();
  if (!db) return false;
  const result = await db.select().from(follows)
    .where(and(eq(follows.followerId, followerId), eq(follows.followingId, followingId)))
    .limit(1);
  return result.length > 0;
}

export async function getFollowerCount(userId: number) {
  const db = await getDb();
  if (!db) return 0;
  const result = await db.select({ cnt: count() }).from(follows)
    .where(eq(follows.followingId, userId));
  return result[0]?.cnt ?? 0;
}

export async function getFollowingCount(userId: number) {
  const db = await getDb();
  if (!db) return 0;
  const result = await db.select({ cnt: count() }).from(follows)
    .where(eq(follows.followerId, userId));
  return result[0]?.cnt ?? 0;
}

// ─── Watchlist ──────────────────────────────────────────────────────────

export async function addToWatchlist(userId: number, projectId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const existing = await db.select().from(watchlist)
    .where(and(eq(watchlist.userId, userId), eq(watchlist.projectId, projectId)))
    .limit(1);
  if (existing.length > 0) return existing[0].id;
  const [result] = await db.insert(watchlist).values({ userId, projectId });
  return (result as any).insertId as number;
}

export async function removeFromWatchlist(userId: number, projectId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(watchlist).where(and(eq(watchlist.userId, userId), eq(watchlist.projectId, projectId)));
}

export async function getUserWatchlist(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    id: watchlist.id,
    projectId: watchlist.projectId,
    lastEpisodeId: watchlist.lastEpisodeId,
    progress: watchlist.progress,
    projectTitle: projects.title,
    projectSlug: projects.slug,
    projectCover: projects.coverImageUrl,
    projectGenre: projects.genre,
  }).from(watchlist)
    .leftJoin(projects, eq(watchlist.projectId, projects.id))
    .where(eq(watchlist.userId, userId))
    .orderBy(desc(watchlist.updatedAt));
}

export async function updateWatchlistProgress(userId: number, projectId: number, lastEpisodeId: number, progress: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(watchlist)
    .set({ lastEpisodeId, progress })
    .where(and(eq(watchlist.userId, userId), eq(watchlist.projectId, projectId)));
}

export async function isInWatchlist(userId: number, projectId: number) {
  const db = await getDb();
  if (!db) return false;
  const result = await db.select().from(watchlist)
    .where(and(eq(watchlist.userId, userId), eq(watchlist.projectId, projectId)))
    .limit(1);
  return result.length > 0;
}

// ─── Notifications ──────────────────────────────────────────────────────

export async function createNotification(data: InsertNotification) {
  const db = await getDb();
  if (!db) return;
  await db.insert(notifications).values(data);
}

export async function getUserNotifications(userId: number, limit = 50) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
}

export async function markAllNotificationsRead(userId: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(notifications).set({ isRead: 1 }).where(eq(notifications.userId, userId));
}

export async function getUnreadNotificationCount(userId: number) {
  const db = await getDb();
  if (!db) return 0;
  const result = await db.select({ cnt: count() }).from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.isRead, 0)));
  return result[0]?.cnt ?? 0;
}

// ─── Discover & Search ──────────────────────────────────────────────────

export async function getPublicProjects(opts: { limit?: number; offset?: number; genre?: string; sort?: string }) {
  const db = await getDb();
  if (!db) return [];
  const { limit: lim = 20, offset = 0, genre, sort = "trending" } = opts;
  let query = db.select({
    id: projects.id,
    title: projects.title,
    description: projects.description,
    genre: projects.genre,
    coverImageUrl: projects.coverImageUrl,
    slug: projects.slug,
    viewCount: projects.viewCount,
    animeStyle: projects.animeStyle,
    createdAt: projects.createdAt,
    userId: projects.userId,
    userName: users.name,
  }).from(projects)
    .leftJoin(users, eq(projects.userId, users.id))
    .where(
      genre
        ? and(eq(projects.visibility, "public"), like(projects.genre, `%${genre}%`))
        : eq(projects.visibility, "public")
    )
    .limit(lim)
    .offset(offset);

  if (sort === "newest") query = query.orderBy(desc(projects.createdAt)) as any;
  else if (sort === "top_rated") query = query.orderBy(desc(projects.viewCount)) as any;
  else query = query.orderBy(desc(projects.viewCount), desc(projects.createdAt)) as any;

  return query;
}

export async function getFeaturedProjects() {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    id: projects.id,
    title: projects.title,
    description: projects.description,
    genre: projects.genre,
    coverImageUrl: projects.coverImageUrl,
    slug: projects.slug,
    viewCount: projects.viewCount,
    animeStyle: projects.animeStyle,
    trailerVideoUrl: projects.trailerVideoUrl,
    userId: projects.userId,
    userName: users.name,
  }).from(projects)
    .leftJoin(users, eq(projects.userId, users.id))
    .where(and(eq(projects.visibility, "public"), ne(projects.featured, 0)))
    .orderBy(desc(projects.featured))
    .limit(5);
}

export async function searchProjects(query: string, limit = 20) {
  const db = await getDb();
  if (!db) return [];
  const term = `%${query}%`;
  return db.select({
    id: projects.id,
    title: projects.title,
    description: projects.description,
    genre: projects.genre,
    coverImageUrl: projects.coverImageUrl,
    slug: projects.slug,
    viewCount: projects.viewCount,
    userName: users.name,
  }).from(projects)
    .leftJoin(users, eq(projects.userId, users.id))
    .where(
      and(
        eq(projects.visibility, "public"),
        or(like(projects.title, term), like(projects.description, term))
      )
    )
    .orderBy(desc(projects.viewCount))
    .limit(limit);
}

export async function getProjectBySlug(slug: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select({
    id: projects.id,
    title: projects.title,
    description: projects.description,
    genre: projects.genre,
    coverImageUrl: projects.coverImageUrl,
    slug: projects.slug,
    viewCount: projects.viewCount,
    animeStyle: projects.animeStyle,
    visibility: projects.visibility,
    trailerVideoUrl: projects.trailerVideoUrl,
    animeStatus: projects.animeStatus,
    animePromotedAt: projects.animePromotedAt,
    userId: projects.userId,
    userName: users.name,
    createdAt: projects.createdAt,
  }).from(projects)
    .leftJoin(users, eq(projects.userId, users.id))
    .where(eq(projects.slug, slug))
    .limit(1);
  return result[0];
}

export async function getEpisodeCountForProject(projectId: number) {
  const db = await getDb();
  if (!db) return 0;
  const result = await db.select({ cnt: count() }).from(episodes)
    .where(eq(episodes.projectId, projectId));
  return result[0]?.cnt ?? 0;
}


// ─── User Profile ───────────────────────────────────────────────────────

export async function getUserById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return result[0];
}

export async function getProjectsByUserIdPublic(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    id: projects.id,
    title: projects.title,
    coverImageUrl: projects.coverImageUrl,
    slug: projects.slug,
    genre: projects.genre,
    viewCount: projects.viewCount,
    createdAt: projects.createdAt,
  }).from(projects)
    .where(and(eq(projects.userId, userId), eq(projects.visibility, "public")))
    .orderBy(desc(projects.createdAt));
}

// ─── Pipeline Runs ─────────────────────────────────────────────────────

import { pipelineRuns, pipelineAssets, InsertPipelineRun, InsertPipelineAsset } from "../drizzle/schema";

export async function createPipelineRun(data: InsertPipelineRun) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(pipelineRuns).values(data);
  return (result as any).insertId as number;
}

export async function getPipelineRunById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(pipelineRuns).where(eq(pipelineRuns.id, id)).limit(1);
  return result[0];
}

export async function getPipelineRunsByEpisode(episodeId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(pipelineRuns)
    .where(eq(pipelineRuns.episodeId, episodeId))
    .orderBy(desc(pipelineRuns.createdAt));
}

export async function getPipelineRunsByProject(projectId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(pipelineRuns)
    .where(eq(pipelineRuns.projectId, projectId))
    .orderBy(desc(pipelineRuns.createdAt));
}

export async function updatePipelineRun(id: number, data: Partial<InsertPipelineRun>) {
  const db = await getDb();
  if (!db) return;
  await db.update(pipelineRuns).set(data).where(eq(pipelineRuns.id, id));
}

// ─── Pipeline Assets ───────────────────────────────────────────────────

export async function createPipelineAsset(data: InsertPipelineAsset) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(pipelineAssets).values(data);
  return (result as any).insertId as number;
}

export async function getPipelineAssetsByRun(pipelineRunId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(pipelineAssets)
    .where(eq(pipelineAssets.pipelineRunId, pipelineRunId))
    .orderBy(pipelineAssets.createdAt);
}

export async function getPipelineAssetsByEpisode(episodeId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(pipelineAssets)
    .where(eq(pipelineAssets.episodeId, episodeId))
    .orderBy(pipelineAssets.createdAt);
}

export async function deletePipelineAsset(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(pipelineAssets).where(eq(pipelineAssets.id, id));
}

export async function deletePipelineAssetsByPanelAndType(
  pipelineRunId: number,
  panelId: number,
  assetType: string,
) {
  const db = await getDb();
  if (!db) return;
  await db.delete(pipelineAssets).where(
    and(
      eq(pipelineAssets.pipelineRunId, pipelineRunId),
      eq(pipelineAssets.panelId, panelId),
      eq(pipelineAssets.assetType, assetType as any),
    )
  );
}

// ─── Voice Cloning ─────────────────────────────────────────────────────

export async function updateCharacterVoice(id: number, data: {
  voiceId?: string | null;
  voiceCloneUrl?: string | null;
  voiceSettings?: any;
}) {
  const db = await getDb();
  if (!db) return;
  await db.update(characters).set(data).where(eq(characters.id, id));
}

export async function getCharactersWithVoice(projectId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(characters)
    .where(and(eq(characters.projectId, projectId), sql`${characters.voiceId} IS NOT NULL`))
    .orderBy(characters.name);
}

// ─── Platform Config ────────────────────────────────────────────────────

import { platformConfig } from "../drizzle/schema";

export async function getPlatformConfig(key: string): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(platformConfig).where(eq(platformConfig.key, key)).limit(1);
  return result.length > 0 ? result[0].value : null;
}

export async function setPlatformConfig(key: string, value: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(platformConfig).values({ key, value })
    .onDuplicateKeyUpdate({ set: { value, updatedAt: new Date() } });
}

export async function getPlatformConfigMulti(keys: string[]): Promise<Record<string, string>> {
  const db = await getDb();
  if (!db) return {};
  const result = await db.select().from(platformConfig).where(inArray(platformConfig.key, keys));
  return Object.fromEntries(result.map(r => [r.key, r.value]));
}


// ─── Character Elements (Kling Subject Library) ─────────────────────────

export async function createCharacterElement(data: InsertCharacterElement) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(characterElements).values(data);
  return (result as any).insertId as number;
}

export async function getCharacterElementById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(characterElements).where(eq(characterElements.id, id)).limit(1);
  return result[0];
}

export async function getCharacterElementByCharacterId(characterId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(characterElements)
    .where(and(eq(characterElements.characterId, characterId), eq(characterElements.status, "ready")))
    .limit(1);
  return result[0];
}

export async function getCharacterElementsByProject(projectId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(characterElements)
    .where(eq(characterElements.projectId, projectId))
    .orderBy(desc(characterElements.createdAt));
}

export async function getReadyElementsByProject(projectId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(characterElements)
    .where(and(eq(characterElements.projectId, projectId), eq(characterElements.status, "ready")))
    .orderBy(characterElements.id);
}

export async function updateCharacterElement(id: number, data: Partial<InsertCharacterElement>) {
  const db = await getDb();
  if (!db) return;
  await db.update(characterElements).set(data).where(eq(characterElements.id, id));
}

export async function deleteCharacterElement(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(characterElements).where(eq(characterElements.id, id));
}

/**
 * Get all ready character elements for a project, joined with character names.
 * Returns a map of characterName → klingElementId for use in the pipeline.
 */
export async function getReadyElementMapForProject(projectId: number): Promise<Map<string, number>> {
  const db = await getDb();
  if (!db) return new Map();
  const results = await db.select({
    characterName: characters.name,
    klingElementId: characterElements.klingElementId,
  }).from(characterElements)
    .innerJoin(characters, eq(characterElements.characterId, characters.id))
    .where(and(
      eq(characterElements.projectId, projectId),
      eq(characterElements.status, "ready"),
      sql`${characterElements.klingElementId} IS NOT NULL`
    ));
  return new Map(results.map(r => [r.characterName, r.klingElementId!]));
}

// ─── Model Routing Stats ──────────────────────────────────────────────────

import { modelRoutingStats, InsertModelRoutingStat } from "../drizzle/schema";

export async function createModelRoutingStat(data: InsertModelRoutingStat) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(modelRoutingStats).values(data);
  return (result as any).insertId as number;
}

export async function getModelRoutingStatsByEpisode(episodeId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(modelRoutingStats)
    .where(eq(modelRoutingStats.episodeId, episodeId))
    .orderBy(desc(modelRoutingStats.createdAt));
}

export async function getModelRoutingStatsByRun(pipelineRunId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(modelRoutingStats)
    .where(eq(modelRoutingStats.pipelineRunId, pipelineRunId))
    .limit(1);
  return result[0];
}

export async function updatePipelineAssetRouting(assetId: number, data: {
  klingModelUsed?: string;
  complexityTier?: number;
  lipSyncMethod?: string;
  classificationReasoning?: string;
  costActual?: number;
  costIfV3Omni?: number;
  userOverride?: number;
}) {
  const db = await getDb();
  if (!db) return;
  await db.update(pipelineAssets).set(data).where(eq(pipelineAssets.id, assetId));
}

export async function getRoutingDataByRun(pipelineRunId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(pipelineAssets)
    .where(and(
      eq(pipelineAssets.pipelineRunId, pipelineRunId),
      sql`${pipelineAssets.complexityTier} IS NOT NULL`
    ))
    .orderBy(pipelineAssets.createdAt);
}

// ─── Content Views & Free-Viewing Model ─────────────────────────────────────
import { contentViews, InsertContentView, subscriptions } from "../drizzle/schema";
import { gte } from "drizzle-orm";

export async function recordView(data: InsertContentView) {
  const db = await getDb();
  if (!db) return null;
  // Deduplicate: same viewer_hash + content_id within 24h
  const existing = await db.select({ id: contentViews.id }).from(contentViews)
    .where(and(
      eq(contentViews.viewerHash, data.viewerHash),
      eq(contentViews.contentId, data.contentId),
      eq(contentViews.contentType, data.contentType),
      gte(contentViews.viewedAt, new Date(Date.now() - 24 * 60 * 60 * 1000))
    ))
    .limit(1);
  if (existing.length > 0) return null; // Already counted
  
  const [result] = await db.insert(contentViews).values(data);
  // Increment denormalized viewCount on projects table
  if (data.projectId) {
    await db.update(projects)
      .set({ viewCount: sql`${projects.viewCount} + 1` })
      .where(eq(projects.id, data.projectId));
  }
  return result.insertId;
}

export async function getViewCount(contentType: string, contentId: number) {
  const db = await getDb();
  if (!db) return 0;
  const result = await db.select({ cnt: count() }).from(contentViews)
    .where(and(
      eq(contentViews.contentType, contentType as any),
      eq(contentViews.contentId, contentId)
    ));
  return result[0]?.cnt ?? 0;
}

export async function getViewsByProject(projectId: number, days?: number) {
  const db = await getDb();
  if (!db) return 0;
  const conditions = [eq(contentViews.projectId, projectId)];
  if (days) {
    conditions.push(gte(contentViews.viewedAt, new Date(Date.now() - days * 24 * 60 * 60 * 1000)));
  }
  const result = await db.select({ cnt: count() }).from(contentViews)
    .where(and(...conditions));
  return result[0]?.cnt ?? 0;
}

// ─── Publish / Unpublish ────────────────────────────────────────────────────

export async function publishProject(projectId: number, userId: number) {
  const db = await getDb();
  if (!db) return false;
  const result = await db.update(projects)
    .set({
      publicationStatus: "published",
      publishedAt: new Date(),
      visibility: "public",
    })
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));
  return true;
}

export async function unpublishProject(projectId: number, userId: number) {
  const db = await getDb();
  if (!db) return false;
  await db.update(projects)
    .set({
      publicationStatus: "private",
      visibility: "private",
    })
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)));
  return true;
}

export async function getUserSubscriptionTier(userId: number): Promise<string> {
  const db = await getDb();
  if (!db) return "free_trial";
  const result = await db.select({ tier: subscriptions.tier })
    .from(subscriptions)
    .where(and(eq(subscriptions.userId, userId), eq(subscriptions.status, "active")))
    .limit(1);
  return result[0]?.tier ?? "free_trial";
}

// ─── Trending & Discovery ───────────────────────────────────────────────────

export async function getPublishedProjects(opts: {
  limit?: number;
  offset?: number;
  genre?: string;
  sort?: "trending" | "newest" | "most_viewed" | "most_liked" | "rising";
  contentType?: "all" | "manga" | "anime";
  timePeriod?: "today" | "week" | "month" | "all";
}) {
  const db = await getDb();
  if (!db) return [];
  const { limit: lim = 20, offset = 0, genre, sort = "trending", contentType = "all" } = opts;
  
  const conditions: any[] = [
    or(
      eq(projects.publicationStatus, "published"),
      eq(projects.visibility, "public")
    )
  ];
  if (genre) conditions.push(like(projects.genre, `%${genre}%`));
  if (contentType === "anime") conditions.push(eq(projects.animeStatus, "completed"));
  
  let query = db.select({
    id: projects.id,
    title: projects.title,
    description: projects.description,
    genre: projects.genre,
    coverImageUrl: projects.coverImageUrl,
    slug: projects.slug,
    viewCount: projects.viewCount,
    animeStyle: projects.animeStyle,
    animeStatus: projects.animeStatus,
    createdAt: projects.createdAt,
    publishedAt: projects.publishedAt,
    userId: projects.userId,
    userName: users.name,
  }).from(projects)
    .leftJoin(users, eq(projects.userId, users.id))
    .where(and(...conditions))
    .limit(lim)
    .offset(offset);

  if (sort === "newest") query = query.orderBy(desc(projects.publishedAt), desc(projects.createdAt)) as any;
  else if (sort === "most_viewed") query = query.orderBy(desc(projects.viewCount)) as any;
  else if (sort === "most_liked") query = query.orderBy(desc(projects.viewCount)) as any;
  else if (sort === "rising") query = query.orderBy(desc(projects.viewCount), desc(projects.createdAt)) as any;
  else query = query.orderBy(desc(projects.viewCount), desc(projects.createdAt)) as any; // trending

  return query;
}

export async function getTrendingProjects(limit = 20) {
  const db = await getDb();
  if (!db) return [];
  // Weighted trending: viewCount + recency bonus
  return db.select({
    id: projects.id,
    title: projects.title,
    description: projects.description,
    genre: projects.genre,
    coverImageUrl: projects.coverImageUrl,
    slug: projects.slug,
    viewCount: projects.viewCount,
    animeStyle: projects.animeStyle,
    animeStatus: projects.animeStatus,
    createdAt: projects.createdAt,
    publishedAt: projects.publishedAt,
    userId: projects.userId,
    userName: users.name,
    trendingScore: sql<number>`(${projects.viewCount} + DATEDIFF(NOW(), ${projects.createdAt}) * -0.5)`.as("trendingScore"),
  }).from(projects)
    .leftJoin(users, eq(projects.userId, users.id))
    .where(or(
      eq(projects.publicationStatus, "published"),
      eq(projects.visibility, "public")
    ))
    .orderBy(sql`trendingScore DESC`)
    .limit(limit);
}

export async function getNewReleases(limit = 20, offset = 0) {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    id: projects.id,
    title: projects.title,
    description: projects.description,
    genre: projects.genre,
    coverImageUrl: projects.coverImageUrl,
    slug: projects.slug,
    viewCount: projects.viewCount,
    animeStyle: projects.animeStyle,
    animeStatus: projects.animeStatus,
    createdAt: projects.createdAt,
    publishedAt: projects.publishedAt,
    userId: projects.userId,
    userName: users.name,
  }).from(projects)
    .leftJoin(users, eq(projects.userId, users.id))
    .where(or(
      eq(projects.publicationStatus, "published"),
      eq(projects.visibility, "public")
    ))
    .orderBy(desc(projects.publishedAt), desc(projects.createdAt))
    .limit(limit)
    .offset(offset);
}

export async function getCategories() {
  const db = await getDb();
  if (!db) return [];
  const result = await db.select({
    genre: projects.genre,
    cnt: count(),
  }).from(projects)
    .where(or(
      eq(projects.publicationStatus, "published"),
      eq(projects.visibility, "public")
    ))
    .groupBy(projects.genre)
    .orderBy(sql`cnt DESC`);
  return result.filter(r => r.genre);
}

export async function getCreatorAnalytics(userId: number) {
  const db = await getDb();
  if (!db) return { totalViews: 0, totalProjects: 0, publishedProjects: 0 };
  
  const projectStats = await db.select({
    totalViews: sql<number>`COALESCE(SUM(${projects.viewCount}), 0)`,
    totalProjects: count(),
    publishedProjects: sql<number>`SUM(CASE WHEN ${projects.publicationStatus} = 'published' OR ${projects.visibility} = 'public' THEN 1 ELSE 0 END)`,
  }).from(projects)
    .where(eq(projects.userId, userId));
  
  return {
    totalViews: Number(projectStats[0]?.totalViews ?? 0),
    totalProjects: Number(projectStats[0]?.totalProjects ?? 0),
    publishedProjects: Number(projectStats[0]?.publishedProjects ?? 0),
  };
}

export async function getCreatorContentBreakdown(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    id: projects.id,
    title: projects.title,
    slug: projects.slug,
    coverImageUrl: projects.coverImageUrl,
    viewCount: projects.viewCount,
    publicationStatus: projects.publicationStatus,
    publishedAt: projects.publishedAt,
    createdAt: projects.createdAt,
  }).from(projects)
    .where(eq(projects.userId, userId))
    .orderBy(desc(projects.viewCount));
}

export function formatViewCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return count.toString();
}

// ─── Uploaded Assets (BYO Manga) ──────────────────────────────────────────

export async function createUploadedAsset(data: InsertUploadedAsset) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(uploadedAssets).values(data);
  return (result as any).insertId as number;
}

export async function createUploadedAssetsBulk(data: InsertUploadedAsset[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (data.length === 0) return;
  await db.insert(uploadedAssets).values(data);
}

export async function getUploadedAssetsByProject(projectId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(uploadedAssets)
    .where(eq(uploadedAssets.projectId, projectId))
    .orderBy(asc(uploadedAssets.panelNumber));
}

export async function getUploadedAssetById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(uploadedAssets)
    .where(eq(uploadedAssets.id, id))
    .limit(1);
  return result[0];
}

export async function updateUploadedAsset(id: number, data: Partial<InsertUploadedAsset>) {
  const db = await getDb();
  if (!db) return;
  await db.update(uploadedAssets).set(data).where(eq(uploadedAssets.id, id));
}

export async function deleteUploadedAssetsByProject(projectId: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(uploadedAssets).where(eq(uploadedAssets.projectId, projectId));
}

// ─── Platform Stats (public, for Create page) ──────────────────────────────

export async function getPlatformStats() {
  const db = await getDb();
  if (!db) return { totalProjects: 0, totalPanels: 0, activeCreators: 0 };

  const [[projectRow], [panelRow], [creatorRow]] = await Promise.all([
    db.select({ cnt: count() }).from(projects),
    db.select({ cnt: count() }).from(panels),
    db.select({ cnt: sql<number>`COUNT(DISTINCT ${projects.userId})` }).from(projects),
  ]);

  return {
    totalProjects: Number(projectRow?.cnt ?? 0),
    totalPanels: Number(panelRow?.cnt ?? 0),
    activeCreators: Number(creatorRow?.cnt ?? 0),
  };
}

// ─── Video Slices (10-second clip decomposition) ──────────────────────────

import { videoSlices, InsertVideoSlice } from "../drizzle/schema";

export async function createSlice(data: InsertVideoSlice) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [result] = await db.insert(videoSlices).values(data);
  return (result as any).insertId as number;
}

export async function createSlicesBulk(data: InsertVideoSlice[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (data.length === 0) return [];
  await db.insert(videoSlices).values(data);
  // Return the IDs of the inserted slices
  const inserted = await db.select({ id: videoSlices.id })
    .from(videoSlices)
    .where(and(
      eq(videoSlices.episodeId, data[0].episodeId),
      eq(videoSlices.projectId, data[0].projectId),
    ))
    .orderBy(videoSlices.sliceNumber);
  return inserted.map(r => r.id);
}

export async function getSlicesByEpisode(episodeId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(videoSlices)
    .where(eq(videoSlices.episodeId, episodeId))
    .orderBy(videoSlices.sliceNumber);
}

export async function getSliceById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(videoSlices)
    .where(eq(videoSlices.id, id))
    .limit(1);
  return result[0];
}

export async function updateSlice(id: number, data: Partial<InsertVideoSlice>) {
  const db = await getDb();
  if (!db) return;
  await db.update(videoSlices).set(data).where(eq(videoSlices.id, id));
}

export async function deleteSlicesByEpisode(episodeId: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(videoSlices).where(eq(videoSlices.episodeId, episodeId));
}

export async function getSliceCountByEpisode(episodeId: number) {
  const db = await getDb();
  if (!db) return 0;
  const result = await db.select({ cnt: count() }).from(videoSlices)
    .where(eq(videoSlices.episodeId, episodeId));
  return result[0]?.cnt ?? 0;
}

export async function getSlicesByStatus(episodeId: number, status: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(videoSlices)
    .where(and(
      eq(videoSlices.episodeId, episodeId),
      eq(videoSlices.coreSceneStatus, status as any),
    ))
    .orderBy(videoSlices.sliceNumber);
}

export async function getSliceCostSummary(episodeId: number) {
  const db = await getDb();
  if (!db) return { totalEstimated: 0, totalActual: 0, sliceCount: 0 };
  const result = await db.select({
    totalEstimated: sql<number>`COALESCE(SUM(${videoSlices.estimatedCredits}), 0)`,
    totalActual: sql<number>`COALESCE(SUM(${videoSlices.actualCredits}), 0)`,
    sliceCount: count(),
  }).from(videoSlices)
    .where(eq(videoSlices.episodeId, episodeId));
  return {
    totalEstimated: Number(result[0]?.totalEstimated ?? 0),
    totalActual: Number(result[0]?.totalActual ?? 0),
    sliceCount: Number(result[0]?.sliceCount ?? 0),
  };
}
