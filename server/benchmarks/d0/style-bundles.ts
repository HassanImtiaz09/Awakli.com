/**
 * Wave 2 Item 1: Anime Type Style Bundles — Server Module
 *
 * CRUD operations and query helpers for style bundles.
 * Consumed by:
 * - tRPC router (admin CRUD + public listing)
 * - D2 Prompt Engineer (prompt template + negative prompt lookup)
 * - D6 Color Director (color palette lookup)
 * - D1.5 Genga Director (frame rate + reference images)
 */

import { eq, asc, sql } from "drizzle-orm";
import { getDb } from "../../db";
import { styleBundles, type InsertStyleBundle, type StyleBundle } from "../../../drizzle/schema";

// ─── Types ──────────────────────────────────────────────────────────────

export interface ColorPalette {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  highlight: string;
  shadow: string;
}

export interface MusicMoodVector {
  energy: number;
  valence: number;
  tempo_bpm: number;
  instrumentation_tags: string[];
}

export interface LoraConfig {
  model_id: string | null;
  trigger_word: string;
  weight_range: [number, number];
  compatible_bases: string[];
}

export interface CreateBundleInput {
  genreKey: string;
  name: string;
  description?: string;
  aestheticNotes?: string;
  promptTemplate: string;
  negativePrompt: string;
  colorPalette: ColorPalette;
  frameRateDefault?: number;
  referenceImageUrls?: string[];
  musicMoodVector?: MusicMoodVector;
  loraConfig?: LoraConfig;
  previewImageUrl?: string;
  iconIdentifier?: string;
  isActive?: number;
  sortOrder?: number;
}

export interface UpdateBundleInput {
  name?: string;
  description?: string;
  aestheticNotes?: string;
  promptTemplate?: string;
  negativePrompt?: string;
  colorPalette?: ColorPalette;
  frameRateDefault?: number;
  referenceImageUrls?: string[];
  musicMoodVector?: MusicMoodVector;
  loraConfig?: LoraConfig;
  previewImageUrl?: string;
  iconIdentifier?: string;
  isActive?: number;
  sortOrder?: number;
}

// ─── CRUD Operations ────────────────────────────────────────────────────

/**
 * List all active style bundles, ordered by sortOrder.
 * Used by the genre selector in the project creation wizard.
 */
export async function listActiveBundles(): Promise<StyleBundle[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(styleBundles)
    .where(eq(styleBundles.isActive, 1))
    .orderBy(asc(styleBundles.sortOrder));
}

/**
 * List ALL bundles (including inactive) for admin management.
 */
export async function listAllBundles(): Promise<StyleBundle[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(styleBundles)
    .orderBy(asc(styleBundles.sortOrder));
}

/**
 * Get a single bundle by its genre key.
 * Primary lookup method for downstream agents (D2, D6, D1.5).
 */
export async function getBundleByGenreKey(genreKey: string): Promise<StyleBundle | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(styleBundles)
    .where(eq(styleBundles.genreKey, genreKey))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Get a single bundle by ID.
 */
export async function getBundleById(id: number): Promise<StyleBundle | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(styleBundles)
    .where(eq(styleBundles.id, id))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Create a new style bundle. Admin only.
 */
export async function createBundle(input: CreateBundleInput): Promise<{ id: number }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(styleBundles).values({
    genreKey: input.genreKey,
    name: input.name,
    description: input.description ?? null,
    aestheticNotes: input.aestheticNotes ?? null,
    promptTemplate: input.promptTemplate,
    negativePrompt: input.negativePrompt,
    colorPalette: input.colorPalette,
    frameRateDefault: input.frameRateDefault ?? 12,
    referenceImageUrls: input.referenceImageUrls ?? null,
    musicMoodVector: input.musicMoodVector ?? null,
    loraConfig: input.loraConfig ?? null,
    previewImageUrl: input.previewImageUrl ?? null,
    iconIdentifier: input.iconIdentifier ?? null,
    isActive: input.isActive ?? 1,
    sortOrder: input.sortOrder ?? 0,
  });

  return { id: (result as any)[0].insertId };
}

/**
 * Update an existing style bundle. Admin only.
 */
export async function updateBundle(id: number, input: UpdateBundleInput): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  // Build partial update object
  const updates: Record<string, any> = {};
  if (input.name !== undefined) updates.name = input.name;
  if (input.description !== undefined) updates.description = input.description;
  if (input.aestheticNotes !== undefined) updates.aestheticNotes = input.aestheticNotes;
  if (input.promptTemplate !== undefined) updates.promptTemplate = input.promptTemplate;
  if (input.negativePrompt !== undefined) updates.negativePrompt = input.negativePrompt;
  if (input.colorPalette !== undefined) updates.colorPalette = input.colorPalette;
  if (input.frameRateDefault !== undefined) updates.frameRateDefault = input.frameRateDefault;
  if (input.referenceImageUrls !== undefined) updates.referenceImageUrls = input.referenceImageUrls;
  if (input.musicMoodVector !== undefined) updates.musicMoodVector = input.musicMoodVector;
  if (input.loraConfig !== undefined) updates.loraConfig = input.loraConfig;
  if (input.previewImageUrl !== undefined) updates.previewImageUrl = input.previewImageUrl;
  if (input.iconIdentifier !== undefined) updates.iconIdentifier = input.iconIdentifier;
  if (input.isActive !== undefined) updates.isActive = input.isActive;
  if (input.sortOrder !== undefined) updates.sortOrder = input.sortOrder;

  if (Object.keys(updates).length === 0) return false;

  await db.update(styleBundles).set(updates).where(eq(styleBundles.id, id));
  return true;
}

/**
 * Soft-delete: deactivate a bundle (set isActive = 0).
 */
export async function deactivateBundle(id: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  await db.update(styleBundles).set({ isActive: 0 }).where(eq(styleBundles.id, id));
  return true;
}

// ─── Agent Integration Helpers ──────────────────────────────────────────

/**
 * Get prompt engineering data for a genre key.
 * Used by D2 Prompt Engineer to inject style-specific prompt template and negative prompt.
 */
export async function getPromptConfig(genreKey: string): Promise<{
  promptTemplate: string;
  negativePrompt: string;
  loraConfig: LoraConfig | null;
} | null> {
  const bundle = await getBundleByGenreKey(genreKey);
  if (!bundle) return null;
  return {
    promptTemplate: bundle.promptTemplate,
    negativePrompt: bundle.negativePrompt,
    loraConfig: bundle.loraConfig as LoraConfig | null,
  };
}

/**
 * Get color palette for a genre key.
 * Used by D6 Color Director.
 */
export async function getColorPalette(genreKey: string): Promise<ColorPalette | null> {
  const bundle = await getBundleByGenreKey(genreKey);
  if (!bundle) return null;
  return bundle.colorPalette as unknown as ColorPalette;
}

/**
 * Get visual configuration for a genre key.
 * Used by D1.5 Genga Director and D1.25 Layout Director.
 */
export async function getVisualConfig(genreKey: string): Promise<{
  frameRateDefault: number;
  referenceImageUrls: string[];
  colorPalette: ColorPalette;
} | null> {
  const bundle = await getBundleByGenreKey(genreKey);
  if (!bundle) return null;
  return {
    frameRateDefault: bundle.frameRateDefault,
    referenceImageUrls: (bundle.referenceImageUrls as string[] | null) ?? [],
    colorPalette: bundle.colorPalette as unknown as ColorPalette,
  };
}

/**
 * Get music mood vector for a genre key.
 * Used by the music pipeline for BGM generation.
 */
export async function getMusicMoodVector(genreKey: string): Promise<MusicMoodVector | null> {
  const bundle = await getBundleByGenreKey(genreKey);
  if (!bundle || !bundle.musicMoodVector) return null;
  return bundle.musicMoodVector as unknown as MusicMoodVector;
}
