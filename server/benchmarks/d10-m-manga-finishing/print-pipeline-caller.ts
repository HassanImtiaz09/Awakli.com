/**
 * Print Pipeline Caller — Wires D10 Craft Library into D10.M Manga Finishing
 *
 * This module is the production entry point for manga print generation.
 * It queries D10 Sensei (Direct mode, manga sub-sensei) for genre-specific
 * craft guidance, maps the result into CraftGuidance, and passes it to
 * runMangaFinishing() so D10.M operates with actual corpus context.
 *
 * Without this caller, D10.M falls back to programmatic defaults (still functional
 * but without Sensei-informed adjustments).
 */

import { queryCraftLibrary } from "../d10/sensei";
import type { CraftResult } from "../d10/types";
import {
  runMangaFinishing,
  type MangaFinishingInput,
  type MangaFinishingResult,
  type CraftGuidance,
  type AnimeGenre,
} from "./manga-finishing-agent";
import type { LayoutTemplate } from "./page-compositor";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PrintPipelineInput extends Omit<MangaFinishingInput, 'craftGuidance'> {
  /** Whether to query D10 for craft guidance (default: true) */
  useCraftLibrary?: boolean;
  /** Override craft guidance directly (skips D10 query) */
  craftGuidanceOverride?: CraftGuidance;
}

export interface PrintPipelineResult extends MangaFinishingResult {
  /** D10 craft guidance that was applied (null if skipped) */
  craftGuidanceApplied: CraftGuidance | null;
  /** Cost of D10 query in USD (0 if skipped) */
  d10CostUsd: number;
  /** Duration of D10 query in ms (0 if skipped) */
  d10DurationMs: number;
}

// ─── Genre-Specific Craft Queries ───────────────────────────────────────────

const GENRE_CRAFT_QUERIES: Record<AnimeGenre, string> = {
  shonen: "What are the best screentone density and panel layout practices for shonen manga print? Consider action pacing, impact frames, and reader eye flow for B5 format.",
  shojo: "What screentone patterns and page layouts work best for shojo manga in print? Consider emotional pacing, decorative elements, and soft gradation usage.",
  seinen: "What are optimal screentone and composition techniques for seinen manga print? Consider detail density, atmospheric tone, and mature visual storytelling.",
  josei: "What panel layout and screentone approaches suit josei manga for print? Consider dialogue-heavy scenes, emotional subtlety, and clean composition.",
  kodomomuke: "What are appropriate screentone density and layout choices for kodomomuke manga? Consider readability, simple compositions, and age-appropriate visual clarity.",
};

// ─── CraftResult → CraftGuidance Mapping ────────────────────────────────────

/**
 * Parse D10 Sensei's natural-language guidance into structured CraftGuidance.
 *
 * The mapping uses keyword analysis on the guidance text to extract:
 * - screentoneAdjustment: density recommendations (-1 to +1)
 * - layoutPreference: suggested panel layout
 * - typographyNotes: font/text-related guidance
 * - compositionNotes: general composition advice
 */
export function mapCraftResultToGuidance(result: CraftResult, genre: AnimeGenre): CraftGuidance {
  const text = result.guidance.toLowerCase();
  const guidance: CraftGuidance = {};

  // ─── Screentone Adjustment ─────────────────────────────────────────────
  // Analyze density recommendations
  if (text.includes("reduce density") || text.includes("lighter screentone") || text.includes("minimal tone") || text.includes("less dense")) {
    guidance.screentoneAdjustment = -0.5;
  } else if (text.includes("heavy density") || text.includes("dense screentone") || text.includes("more tone") || text.includes("darker tone")) {
    guidance.screentoneAdjustment = 0.5;
  } else if (text.includes("moderate") || text.includes("balanced")) {
    guidance.screentoneAdjustment = 0;
  }

  // Genre-specific defaults when no explicit density guidance
  if (guidance.screentoneAdjustment === undefined) {
    const genreDefaults: Record<AnimeGenre, number> = {
      shonen: 0.2,     // Slightly heavier for impact
      shojo: -0.3,     // Lighter, more decorative
      seinen: 0.3,     // Denser for atmosphere
      josei: -0.1,     // Clean and moderate
      kodomomuke: -0.5, // Light for readability
    };
    guidance.screentoneAdjustment = genreDefaults[genre];
  }

  // ─── Layout Preference ─────────────────────────────────────────────────
  if (text.includes("splash") || text.includes("full-page") || text.includes("full page")) {
    guidance.layoutPreference = "splash" as LayoutTemplate;
  } else if (text.includes("grid") || text.includes("regular panel")) {
    guidance.layoutPreference = "grid_4" as LayoutTemplate;
  } else if (text.includes("dynamic") || text.includes("irregular") || text.includes("varied")) {
    guidance.layoutPreference = "dynamic" as LayoutTemplate;
  } else if (text.includes("vertical") || text.includes("strip")) {
    guidance.layoutPreference = "vertical_strip" as LayoutTemplate;
  }

  // ─── Typography Notes ──────────────────────────────────────────────────
  const typographyPatterns = [
    /(?:font|typeface|typography|lettering)[^.]*\./gi,
    /(?:dialogue|speech|text)[^.]*(?:size|weight|style)[^.]*\./gi,
    /(?:sfx|sound effect)[^.]*(?:bold|heavy|large)[^.]*\./gi,
  ];
  const typographyExtracts: string[] = [];
  for (const pattern of typographyPatterns) {
    const matches = result.guidance.match(pattern);
    if (matches) typographyExtracts.push(...matches);
  }
  if (typographyExtracts.length > 0) {
    guidance.typographyNotes = typographyExtracts.slice(0, 3).join(" ");
  }

  // ─── Composition Notes ─────────────────────────────────────────────────
  const compositionPatterns = [
    /(?:composition|layout|panel flow|eye flow|reading direction)[^.]*\./gi,
    /(?:bleed|gutter|margin|safe area)[^.]*\./gi,
    /(?:pacing|rhythm|tempo)[^.]*\./gi,
  ];
  const compositionExtracts: string[] = [];
  for (const pattern of compositionPatterns) {
    const matches = result.guidance.match(pattern);
    if (matches) compositionExtracts.push(...matches);
  }
  if (compositionExtracts.length > 0) {
    guidance.compositionNotes = compositionExtracts.slice(0, 3).join(" ");
  }

  return guidance;
}

// ─── Main Pipeline Caller ───────────────────────────────────────────────────

/**
 * Run the full print pipeline with D10 Craft Library integration.
 *
 * Flow:
 * 1. Query D10 Sensei (manga sub-sensei, Direct mode) for genre-specific guidance
 * 2. Map CraftResult → CraftGuidance
 * 3. Pass guidance into runMangaFinishing()
 * 4. Return results with D10 metadata
 *
 * If D10 query fails (network, empty corpus, etc.), falls back gracefully
 * to running D10.M without craft guidance (uses programmatic defaults).
 */
export async function runPrintPipeline(input: PrintPipelineInput): Promise<PrintPipelineResult> {
  const { useCraftLibrary = true, craftGuidanceOverride, ...mangaInput } = input;

  let craftGuidance: CraftGuidance | null = null;
  let d10CostUsd = 0;
  let d10DurationMs = 0;

  // ─── Step 1: Resolve Craft Guidance ──────────────────────────────────────
  if (craftGuidanceOverride) {
    // Direct override — skip D10 query
    craftGuidance = craftGuidanceOverride;
  } else if (useCraftLibrary) {
    // Query D10 Sensei for genre-specific manga craft guidance
    try {
      const startMs = Date.now();
      const craftQuery = GENRE_CRAFT_QUERIES[input.genre] ||
        "What are best practices for manga screentone and panel layout in print format?";

      const craftResult = await queryCraftLibrary({
        query: craftQuery,
        subSensei: "manga",
        mode: "direct",
        pipelineStage: "manga_render",
        topK: 5,
      });

      d10DurationMs = Date.now() - startMs;
      d10CostUsd = craftResult.costUsd;

      // Map the natural-language guidance to structured CraftGuidance
      craftGuidance = mapCraftResultToGuidance(craftResult, input.genre);
    } catch (err) {
      // Graceful degradation: log and continue without guidance
      console.warn(
        "[PrintPipeline] D10 query failed, falling back to defaults:",
        err instanceof Error ? err.message : String(err)
      );
      craftGuidance = null;
    }
  }

  // ─── Step 2: Run D10.M with Craft Guidance ──────────────────────────────
  const finishingInput: MangaFinishingInput = {
    ...mangaInput,
    craftGuidance: craftGuidance ?? undefined,
  };

  const result = await runMangaFinishing(finishingInput);

  return {
    ...result,
    craftGuidanceApplied: craftGuidance,
    d10CostUsd,
    d10DurationMs,
  };
}

// ─── Utility: Check if D10 Corpus Has Content ───────────────────────────────

/**
 * Quick health check: verify D10 corpus has indexed content for manga queries.
 * Returns false if corpus is empty (D10.M will still work but without Sensei context).
 */
export async function checkD10CorpusHealth(): Promise<{
  healthy: boolean;
  chunkCount: number;
  message: string;
}> {
  try {
    const { getEmbeddingCount } = await import("../d10/semantic-retrieval");
    const count = await getEmbeddingCount();
    return {
      healthy: count > 0,
      chunkCount: count,
      message: count > 0
        ? `D10 corpus operational: ${count} chunks indexed`
        : "D10 corpus empty — D10.M will use programmatic defaults only",
    };
  } catch (err) {
    return {
      healthy: false,
      chunkCount: 0,
      message: `D10 corpus check failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
