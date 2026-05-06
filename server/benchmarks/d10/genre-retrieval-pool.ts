/**
 * D10 Genre Retrieval Pool — Seeding & Confidence Module
 *
 * Provides genre-specific RAG retrieval for the AdapterComposer (Wave 6A Item 1).
 * The retrieval pool stores genre-tagged reference frames that the IP-Adapter
 * uses as visual conditioning during three-adapter composition.
 *
 * Architecture:
 * - Genre taxonomy: 10 genres matching styleBundles.genreKey + projects.animeStyle
 * - Auto-tagger: LLM-based genre classification for approved panel content
 * - Embedding: genre-filtered vector search for reference retrieval
 * - Confidence threshold: cold-start detection (< 500 frames = low confidence)
 *
 * Integration point: AdapterComposer.compose() calls getGenreReferences()
 * to retrieve IP-Adapter conditioning images from the pool.
 */
import { getVectorStore, type IVectorStore, type SearchResult, type SearchOptions } from "./vector-store";
import { invokeLLM } from "../../_core/llm";

// ─── Genre Taxonomy ─────────────────────────────────────────────────────────

/**
 * Canonical genre taxonomy aligned with:
 * - styleBundles.genreKey (D0 style system)
 * - projects.animeStyle enum
 * - AdapterComposer genre adapter selection
 */
export const GENRE_TAXONOMY = [
  "shonen",
  "seinen",
  "shoujo",
  "chibi",
  "cyberpunk",
  "watercolor",
  "noir",
  "realistic",
  "mecha",
  "default",
] as const;

export type GenreTag = (typeof GENRE_TAXONOMY)[number];

/**
 * Genre descriptions for LLM classification context.
 */
export const GENRE_DESCRIPTIONS: Record<GenreTag, string> = {
  shonen: "High-energy action, bold lines, dynamic poses, speed lines, bright colors, exaggerated expressions",
  seinen: "Mature themes, detailed anatomy, realistic proportions, darker palette, complex compositions",
  shoujo: "Soft lines, sparkles, flower motifs, expressive eyes, pastel colors, romantic atmosphere",
  chibi: "Super-deformed proportions, oversized heads, simplified features, cute expressions, flat colors",
  cyberpunk: "Neon lighting, chrome surfaces, urban decay, holographic elements, high contrast",
  watercolor: "Soft edges, color bleeding, paper texture, transparent layers, organic flow",
  noir: "High contrast, deep shadows, limited palette, dramatic lighting, angular compositions",
  realistic: "Photorealistic proportions, subtle shading, natural lighting, detailed textures",
  mecha: "Mechanical detail, hard surfaces, geometric forms, metallic shading, scale contrast",
  default: "Standard anime style, balanced proportions, clean lines, moderate detail",
};

// ─── Genre Pool Entry ───────────────────────────────────────────────────────

export interface GenrePoolEntry {
  id: string;
  genreTag: GenreTag;
  imageUrl: string;
  sourceProjectId: number;
  sourcePanelId: number;
  qualityScore: number; // 0-100
  embeddingContent: string; // text description used for embedding
  metadata: {
    episodeId?: number;
    sceneDescription?: string;
    cameraAngle?: string;
    artStyle?: string;
  };
}

export interface GenrePoolConfidence {
  genre: GenreTag;
  frameCount: number;
  avgQualityScore: number;
  confidence: "high" | "medium" | "low" | "cold_start";
  /** Whether IP-Adapter conditioning should be used for this genre */
  ipAdapterEnabled: boolean;
}

// ─── Confidence Thresholds ──────────────────────────────────────────────────

const CONFIDENCE_THRESHOLDS = {
  /** Below this: cold start, skip IP-Adapter conditioning entirely */
  COLD_START: 50,
  /** Below this: low confidence, reduce IP-Adapter weight to 0.2 */
  LOW: 200,
  /** Below this: medium confidence, use standard IP-Adapter weight 0.4 */
  MEDIUM: 500,
  /** At or above this: high confidence, full IP-Adapter weight 0.5 */
  HIGH: 500,
} as const;

// ─── Auto-Tagger ────────────────────────────────────────────────────────────

/**
 * Classify a panel's visual content into a genre using LLM analysis.
 * Used by the admin auto-tagging procedure to populate the retrieval pool.
 *
 * @param visualDescription - The panel's visual description text
 * @param imageUrl - Optional image URL for multimodal classification
 * @returns The classified genre tag
 */
export async function classifyPanelGenre(
  visualDescription: string,
  imageUrl?: string
): Promise<{ genre: GenreTag; confidence: number }> {
  const genreList = GENRE_TAXONOMY.map(
    (g) => `- ${g}: ${GENRE_DESCRIPTIONS[g]}`
  ).join("\n");

  const messages: any[] = [
    {
      role: "system",
      content: `You are an anime art style classifier. Given a panel description (and optionally an image), classify it into exactly one genre from the taxonomy below. Return JSON with "genre" (string) and "confidence" (number 0-1).

Genre Taxonomy:
${genreList}

Rules:
- Choose the SINGLE best-matching genre
- confidence should reflect how clearly the content fits that genre
- If ambiguous, prefer "default" with lower confidence
- Return ONLY valid JSON: {"genre": "...", "confidence": 0.XX}`,
    },
    {
      role: "user",
      content: imageUrl
        ? [
            { type: "text", text: `Classify this panel:\n\nVisual Description: ${visualDescription}` },
            { type: "image_url", image_url: { url: imageUrl } },
          ]
        : `Classify this panel:\n\nVisual Description: ${visualDescription}`,
    },
  ];

  try {
    const response = await invokeLLM({
      messages: messages as any,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "genre_classification",
          strict: true,
          schema: {
            type: "object",
            properties: {
              genre: { type: "string", enum: [...GENRE_TAXONOMY] },
              confidence: { type: "number" },
            },
            required: ["genre", "confidence"],
            additionalProperties: false,
          },
        },
      },
    });

    const content = response.choices?.[0]?.message?.content;
    if (!content) return { genre: "default", confidence: 0.3 };

    const parsed = JSON.parse(content as string);
    const genre = GENRE_TAXONOMY.includes(parsed.genre) ? parsed.genre : "default";
    const confidence = Math.max(0, Math.min(1, parsed.confidence || 0.5));

    return { genre: genre as GenreTag, confidence };
  } catch (error) {
    console.error("[D10 Genre Tagger] Classification failed:", error);
    return { genre: "default", confidence: 0.3 };
  }
}

/**
 * Batch classify multiple panels for genre tagging.
 * Processes sequentially to respect LLM rate limits.
 */
export async function batchClassifyGenre(
  panels: Array<{ id: number; visualDescription: string; imageUrl?: string }>
): Promise<Array<{ panelId: number; genre: GenreTag; confidence: number }>> {
  const results: Array<{ panelId: number; genre: GenreTag; confidence: number }> = [];

  for (const panel of panels) {
    const classification = await classifyPanelGenre(
      panel.visualDescription,
      panel.imageUrl
    );
    results.push({
      panelId: panel.id,
      genre: classification.genre,
      confidence: classification.confidence,
    });
  }

  return results;
}

// ─── Pool Seeding ───────────────────────────────────────────────────────────

/**
 * Seed the genre retrieval pool with approved, high-quality panels.
 * Called by the admin procedure after panels are approved and quality-scored.
 *
 * @param entries - Array of genre pool entries to upsert
 * @returns Count of successfully seeded entries
 */
export async function seedGenrePool(
  entries: GenrePoolEntry[]
): Promise<{ seeded: number; failed: number }> {
  const store = getVectorStore();
  let seeded = 0;
  let failed = 0;

  // Process in batches of 10
  const batchSize = 10;
  for (let i = 0; i < entries.length; i += batchSize) {
    const batch = entries.slice(i, i + batchSize);
    try {
      await store.upsert(
        batch.map((entry) => ({
          id: entry.id,
          content: entry.embeddingContent,
          metadata: {
            genreTag: entry.genreTag,
            imageUrl: entry.imageUrl,
            sourceProjectId: entry.sourceProjectId,
            sourcePanelId: entry.sourcePanelId,
            qualityScore: entry.qualityScore,
            ...entry.metadata,
          },
        }))
      );
      seeded += batch.length;
    } catch (error) {
      console.error(`[D10 Genre Pool] Seeding batch ${i / batchSize} failed:`, error);
      failed += batch.length;
    }
  }

  return { seeded, failed };
}

// ─── Genre-Filtered Retrieval ───────────────────────────────────────────────

/**
 * Retrieve genre-specific reference images for IP-Adapter conditioning.
 * This is the primary interface called by AdapterComposer.compose().
 *
 * @param genre - Target genre for retrieval
 * @param sceneDescription - Scene context for semantic matching
 * @param topK - Number of references to retrieve (default: 3)
 * @returns Array of image URLs with relevance scores
 */
export async function getGenreReferences(
  genre: GenreTag,
  sceneDescription: string,
  topK: number = 3
): Promise<Array<{ imageUrl: string; score: number; qualityScore: number }>> {
  const store = getVectorStore();

  const searchOpts: SearchOptions = {
    topK,
    threshold: 0.6, // Lower threshold for visual reference (broader matches OK)
    filter: { genreTag: genre },
  };

  const results = await store.search(sceneDescription, searchOpts);

  return results
    .filter((r) => r.metadata?.imageUrl)
    .map((r) => ({
      imageUrl: r.metadata!.imageUrl as string,
      score: r.score,
      qualityScore: (r.metadata?.qualityScore as number) || 50,
    }));
}

// ─── Confidence Assessment ──────────────────────────────────────────────────

/**
 * Get the confidence level for a genre's retrieval pool.
 * Used by AdapterComposer to decide whether to enable IP-Adapter conditioning.
 *
 * @param genre - Genre to assess
 * @returns Confidence assessment with frame count and recommendation
 */
export async function getGenrePoolConfidence(
  genre: GenreTag
): Promise<GenrePoolConfidence> {
  const store = getVectorStore();

  // Count frames with this genre tag
  // We use a broad search with low threshold to count all entries
  const results = await store.search(
    GENRE_DESCRIPTIONS[genre],
    {
      topK: 5000, // Get all we can
      threshold: 0.0, // No threshold — just count matching genre
      filter: { genreTag: genre },
    }
  );

  const frameCount = results.length;
  const avgQualityScore =
    frameCount > 0
      ? results.reduce((sum, r) => sum + ((r.metadata?.qualityScore as number) || 50), 0) / frameCount
      : 0;

  let confidence: GenrePoolConfidence["confidence"];
  let ipAdapterEnabled: boolean;

  if (frameCount < CONFIDENCE_THRESHOLDS.COLD_START) {
    confidence = "cold_start";
    ipAdapterEnabled = false;
  } else if (frameCount < CONFIDENCE_THRESHOLDS.LOW) {
    confidence = "low";
    ipAdapterEnabled = true; // Enabled but with reduced weight
  } else if (frameCount < CONFIDENCE_THRESHOLDS.MEDIUM) {
    confidence = "medium";
    ipAdapterEnabled = true;
  } else {
    confidence = "high";
    ipAdapterEnabled = true;
  }

  return {
    genre,
    frameCount,
    avgQualityScore,
    confidence,
    ipAdapterEnabled,
  };
}

/**
 * Get confidence for all genres (admin dashboard overview).
 */
export async function getAllGenrePoolConfidence(): Promise<GenrePoolConfidence[]> {
  const results: GenrePoolConfidence[] = [];
  for (const genre of GENRE_TAXONOMY) {
    results.push(await getGenrePoolConfidence(genre));
  }
  return results;
}

/**
 * Get the recommended IP-Adapter weight based on pool confidence.
 * Used by AdapterComposer to scale conditioning strength.
 */
export function getRecommendedIpAdapterWeight(confidence: GenrePoolConfidence): number {
  switch (confidence.confidence) {
    case "cold_start":
      return 0; // No conditioning
    case "low":
      return 0.2; // Light conditioning
    case "medium":
      return 0.4; // Standard conditioning
    case "high":
      return 0.5; // Full conditioning
    default:
      return 0;
  }
}

// ─── Export Constants ────────────────────────────────────────────────────────

export { CONFIDENCE_THRESHOLDS };
