/**
 * D4 Timing Director — Database Helpers
 *
 * CRUD operations for x_sheets, x_sheet_entries, and x_sheet_overrides tables.
 * Supports the read-time merge of user overrides on top of D4-generated base entries.
 */
import { eq, and, desc } from "drizzle-orm";
import { getDb } from "../../db.js";
import {
  xSheets,
  xSheetEntries,
  xSheetOverrides,
  type XSheet,
  type InsertXSheet,
  type XSheetEntry,
  type InsertXSheetEntry,
  type XSheetOverride,
  type InsertXSheetOverride,
} from "../../../drizzle/schema.js";

// ─── X-Sheet CRUD ───────────────────────────────────────────────────────────

export async function createXSheet(data: InsertXSheet): Promise<XSheet> {
  const db = (await getDb())!;
  const [result] = await db.insert(xSheets).values(data).$returningId();
  const [sheet] = await db.select().from(xSheets).where(eq(xSheets.id, result.id));
  return sheet;
}

export async function getXSheetById(id: number): Promise<XSheet | null> {
  const db = (await getDb())!;
  const [sheet] = await db.select().from(xSheets).where(eq(xSheets.id, id));
  return sheet || null;
}

export async function getLatestXSheet(episodeId: number): Promise<XSheet | null> {
  const db = (await getDb())!;
  const [sheet] = await db
    .select()
    .from(xSheets)
    .where(eq(xSheets.episodeId, episodeId))
    .orderBy(desc(xSheets.version))
    .limit(1);
  return sheet || null;
}

export async function getApprovedXSheet(episodeId: number): Promise<XSheet | null> {
  const db = (await getDb())!;
  const [sheet] = await db
    .select()
    .from(xSheets)
    .where(and(eq(xSheets.episodeId, episodeId), eq(xSheets.status, "approved")))
    .orderBy(desc(xSheets.version))
    .limit(1);
  return sheet || null;
}

export async function updateXSheetStatus(
  id: number,
  status: "draft" | "pending_review" | "approved" | "rejected" | "superseded",
  approvedBy?: number
): Promise<void> {
  const db = (await getDb())!;
  const updates: Partial<XSheet> = { status } as any;
  if (status === "approved" && approvedBy) {
    (updates as any).approvedAt = new Date();
    (updates as any).approvedBy = approvedBy;
  }
  await db.update(xSheets).set(updates).where(eq(xSheets.id, id));
}

// ─── X-Sheet Entries CRUD ───────────────────────────────────────────────────

export async function createXSheetEntries(entries: InsertXSheetEntry[]): Promise<void> {
  if (entries.length === 0) return;
  const db = (await getDb())!;
  await db.insert(xSheetEntries).values(entries);
}

export async function getXSheetEntries(xSheetId: number): Promise<XSheetEntry[]> {
  const db = (await getDb())!;
  return db
    .select()
    .from(xSheetEntries)
    .where(eq(xSheetEntries.xSheetId, xSheetId))
    .orderBy(xSheetEntries.sliceNumber);
}

export async function getXSheetEntryBySlice(
  xSheetId: number,
  sliceNumber: number
): Promise<XSheetEntry | null> {
  const db = (await getDb())!;
  const [entry] = await db
    .select()
    .from(xSheetEntries)
    .where(and(eq(xSheetEntries.xSheetId, xSheetId), eq(xSheetEntries.sliceNumber, sliceNumber)));
  return entry || null;
}

// ─── X-Sheet Overrides (Wave 4 ready) ───────────────────────────────────────

export async function createXSheetOverride(data: InsertXSheetOverride): Promise<void> {
  const db = (await getDb())!;
  await db.insert(xSheetOverrides).values(data);
}

export async function getOverridesForSheet(
  xSheetId: number,
  userId: number
): Promise<XSheetOverride[]> {
  const db = (await getDb())!;
  return db
    .select()
    .from(xSheetOverrides)
    .where(and(eq(xSheetOverrides.xSheetId, xSheetId), eq(xSheetOverrides.userId, userId)))
    .orderBy(xSheetOverrides.sliceNumber);
}

/**
 * Merge base entries with user overrides.
 * Returns entries with override_data fields merged on top of base entry fields.
 * This is the read-time merge pattern: D4 output is immutable, user edits layer on top.
 */
export function mergeEntriesWithOverrides(
  entries: XSheetEntry[],
  overrides: XSheetOverride[]
): XSheetEntry[] {
  const overrideMap = new Map<number, XSheetOverride>();
  for (const o of overrides) {
    overrideMap.set(o.sliceNumber, o);
  }
  return entries.map((entry) => {
    const override = overrideMap.get(entry.sliceNumber);
    if (!override) return entry;
    const overrideData = override.overrideData as Record<string, any>;
    return { ...entry, ...overrideData } as XSheetEntry;
  });
}

// ─── Resolved X-Sheet (entries + overrides merged) ──────────────────────────

export interface ResolvedXSheet {
  sheet: XSheet;
  entries: XSheetEntry[];
  hasOverrides: boolean;
}

/**
 * Get the fully resolved X-Sheet for an episode (latest approved, with user overrides merged).
 * Falls back to latest draft if no approved version exists.
 */
export async function getResolvedXSheet(
  episodeId: number,
  userId?: number
): Promise<ResolvedXSheet | null> {
  const sheet = (await getApprovedXSheet(episodeId)) || (await getLatestXSheet(episodeId));
  if (!sheet) return null;

  const entries = await getXSheetEntries(sheet.id);
  if (!userId) {
    return { sheet, entries, hasOverrides: false };
  }

  const overrides = await getOverridesForSheet(sheet.id, userId);
  if (overrides.length === 0) {
    return { sheet, entries, hasOverrides: false };
  }

  const merged = mergeEntriesWithOverrides(entries, overrides);
  return { sheet, entries: merged, hasOverrides: true };
}
