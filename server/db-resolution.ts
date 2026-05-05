/**
 * Resolution Flow Database Helpers (D2.5 Sakuga Kantoku)
 *
 * CRUD operations for resolution_issues, resolution_rounds,
 * and genga_consistency_scores tables.
 */
import { eq, and, desc, asc, sql, inArray } from 'drizzle-orm';
import { getDb } from './db';
import {
  resolutionIssues,
  resolutionRounds,
  gengaConsistencyScores,
  type InsertResolutionIssue,
  type InsertResolutionRound,
  type InsertGengaConsistencyScore,
  type ResolutionIssue,
} from '../drizzle/schema';

// ─── Resolution Issues ────────────────────────────────────────────────────────

export async function createResolutionIssue(data: InsertResolutionIssue) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  const result = await db.insert(resolutionIssues).values(data as any);
  return (result as any)[0].insertId as number;
}

export async function createResolutionIssuesBatch(data: InsertResolutionIssue[]) {
  if (data.length === 0) return [];
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  const result = await db.insert(resolutionIssues).values(data as any);
  return (result as any)[0].insertId as number;
}

export async function getResolutionIssueById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(resolutionIssues).where(eq(resolutionIssues.id, id));
  return rows[0] ?? null;
}

export async function getIssuesByProjectEpisode(projectId: number, episodeId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(resolutionIssues)
    .where(and(eq(resolutionIssues.projectId, projectId), eq(resolutionIssues.episodeId, episodeId)))
    .orderBy(desc(resolutionIssues.severity), asc(resolutionIssues.panelId));
}

export async function getIssuesByStatus(projectId: number, episodeId: number, status: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(resolutionIssues)
    .where(and(eq(resolutionIssues.projectId, projectId), eq(resolutionIssues.episodeId, episodeId), eq(resolutionIssues.status, status as any)))
    .orderBy(desc(resolutionIssues.severity));
}

export async function getOpenIssuesForUser(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(resolutionIssues)
    .where(and(eq(resolutionIssues.assignedToUserId, userId), inArray(resolutionIssues.status, ['open', 'in_progress'])))
    .orderBy(desc(resolutionIssues.severity));
}

export async function updateIssueStatus(id: number, status: string, resolvedAt?: Date) {
  const db = await getDb();
  if (!db) return;
  await db.update(resolutionIssues).set({ status: status as any, resolvedAt: resolvedAt ?? null, updatedAt: new Date() }).where(eq(resolutionIssues.id, id));
}

export async function incrementIssueRoundCount(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(resolutionIssues).set({ roundCount: sql`${resolutionIssues.roundCount} + 1`, updatedAt: new Date() }).where(eq(resolutionIssues.id, id));
}

export async function assignIssue(id: number, userId: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(resolutionIssues).set({ assignedToUserId: userId, status: 'in_progress', updatedAt: new Date() }).where(eq(resolutionIssues.id, id));
}

// ─── Resolution Rounds ────────────────────────────────────────────────────────

export async function createResolutionRound(data: InsertResolutionRound) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  const result = await db.insert(resolutionRounds).values(data as any);
  return (result as any)[0].insertId as number;
}

export async function getRoundsByIssueId(issueId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(resolutionRounds).where(eq(resolutionRounds.issueId, issueId)).orderBy(asc(resolutionRounds.roundNumber));
}

export async function updateRoundVerdict(id: number, verdict: string, improvementScore: number, reviewedByUserId: number, reviewerNotes?: string) {
  const db = await getDb();
  if (!db) return;
  await db.update(resolutionRounds).set({ reviewerVerdict: verdict as any, improvementScore, reviewedByUserId, reviewerNotes: reviewerNotes ?? null, reviewedAt: new Date() }).where(eq(resolutionRounds.id, id));
}

export async function updateRoundResult(id: number, resultUrl: string) {
  const db = await getDb();
  if (!db) return;
  await db.update(resolutionRounds).set({ resultUrl }).where(eq(resolutionRounds.id, id));
}

// ─── Genga Consistency Scores ─────────────────────────────────────────────────

export async function upsertConsistencyScore(data: InsertGengaConsistencyScore) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');
  const existing = await db.select().from(gengaConsistencyScores)
    .where(and(eq(gengaConsistencyScores.projectId, data.projectId), eq(gengaConsistencyScores.episodeId, data.episodeId)));

  if (existing.length > 0) {
    await db.update(gengaConsistencyScores).set({
      consistencyScore: data.consistencyScore,
      driftPanelCount: data.driftPanelCount,
      totalPanelCount: data.totalPanelCount,
      issueBreakdown: data.issueBreakdown,
      computedAt: new Date(),
    }).where(eq(gengaConsistencyScores.id, existing[0].id));
    return existing[0].id;
  }

  const result = await db.insert(gengaConsistencyScores).values(data as any);
  return (result as any)[0].insertId as number;
}

export async function getConsistencyScore(projectId: number, episodeId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(gengaConsistencyScores)
    .where(and(eq(gengaConsistencyScores.projectId, projectId), eq(gengaConsistencyScores.episodeId, episodeId)));
  return rows[0] ?? null;
}

export async function getProjectConsistencyScores(projectId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(gengaConsistencyScores)
    .where(eq(gengaConsistencyScores.projectId, projectId))
    .orderBy(asc(gengaConsistencyScores.episodeId));
}

// ─── Aggregation Queries ──────────────────────────────────────────────────────

export async function getIssueSummaryByProject(projectId: number) {
  const db = await getDb();
  if (!db) return { total: 0, open: 0, inProgress: 0, resolved: 0, escalated: 0, wontFix: 0, bySeverity: { critical: 0, moderate: 0, low: 0 } };
  const issues = await db.select().from(resolutionIssues).where(eq(resolutionIssues.projectId, projectId));

  return {
    total: issues.length,
    open: issues.filter((i: ResolutionIssue) => i.status === 'open').length,
    inProgress: issues.filter((i: ResolutionIssue) => i.status === 'in_progress').length,
    resolved: issues.filter((i: ResolutionIssue) => i.status === 'resolved' || i.status === 'approved').length,
    escalated: issues.filter((i: ResolutionIssue) => i.status === 'escalated').length,
    wontFix: issues.filter((i: ResolutionIssue) => i.status === 'wont_fix').length,
    bySeverity: {
      critical: issues.filter((i: ResolutionIssue) => i.severity >= 4).length,
      moderate: issues.filter((i: ResolutionIssue) => i.severity === 3).length,
      low: issues.filter((i: ResolutionIssue) => i.severity <= 2).length,
    },
  };
}
