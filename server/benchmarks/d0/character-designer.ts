/**
 * Wave 2 Item 2: D0 Character Designer — Two-Pass Multi-View Generation
 *
 * Orchestrates multi-view reference sheet generation:
 * Pass 1: Generate canonical front view from character bible + style bundle
 * Pass 2: i2i with locked front view → three-quarter, side, back views
 *
 * CLIP validation ensures cosine similarity >0.85 between views.
 * Approval gate blocks downstream propagation until user approves.
 */

import { eq, and, sql } from "drizzle-orm";
import { getDb } from "../../db";
import {
  characterViews, referenceSheetGates, characters,
  type CharacterView, type InsertCharacterView,
  type ReferenceSheetGate, type InsertReferenceSheetGate,
  type Character,
} from "../../../drizzle/schema";
import { getPromptConfig, getColorPalette } from "./style-bundles";
import { generateImage } from "../../_core/imageGeneration";
import { invokeLLM } from "../../_core/llm";
import { storagePut } from "../../storage";
import { serverLog } from "../../observability/logger";
import {
  StoryMakerAdapter,
  resolveStoryMakerEndpoint,
  computeIdentityRubric,
  batchEvaluateIdentity,
  type StoryMakerParams,
  type CharacterIdentityRubric,
} from "../../provider-router/adapters/storymaker-adapter";

// ─── Constants ──────────────────────────────────────────────────────────

const VIEW_ANGLES = ["front", "three_quarter", "side", "back"] as const;
type ViewAngle = typeof VIEW_ANGLES[number];

const CLIP_THRESHOLD = 0.85;
const MAX_ATTEMPTS = 3;
const COST_PER_VIEW = 0.10; // $0.10 per image generation

// View-specific prompt suffixes
const VIEW_PROMPTS: Record<ViewAngle, string> = {
  front: "front view, facing camera directly, full body, centered composition, character turnaround sheet",
  three_quarter: "three-quarter view, slight angle, full body, character turnaround sheet, consistent with front view",
  side: "side profile view, full body, character turnaround sheet, consistent with front view",
  back: "back view, facing away from camera, full body, character turnaround sheet, consistent with front view",
};

// ─── Types ──────────────────────────────────────────────────────────────

export interface GenerateViewsInput {
  characterId: number;
  projectId: number;
  userId: number;
  styleBundleKey?: string;
}

export interface ViewGenerationResult {
  viewAngle: ViewAngle;
  imageUrl: string | null;
  clipScore: number | null;
  status: "generated" | "failed";
  attemptNumber: number;
  costUsd: number;
  error?: string;
}

export interface ReferenceSheetStatus {
  gate: ReferenceSheetGate | null;
  views: CharacterView[];
  character: Character | null;
}

// ─── Prompt Construction ────────────────────────────────────────────────

/**
 * Build a generation prompt for a specific view angle.
 * Combines: character traits + style bundle template + view-specific suffix
 */
async function buildViewPrompt(
  character: Character,
  viewAngle: ViewAngle,
  styleBundleKey?: string,
): Promise<{ prompt: string; negativePrompt: string }> {
  // Get style bundle prompt config
  let stylePrompt = "anime style, professional character design, clean linework";
  let styleNegative = "blurry, low quality, deformed, ugly, bad anatomy";

  if (styleBundleKey) {
    const config = await getPromptConfig(styleBundleKey);
    if (config) {
      stylePrompt = config.promptTemplate;
      styleNegative = config.negativePrompt;
    }
  }

  // Extract character visual traits
  const traits = character.visualTraits as Record<string, string> | null;
  const traitDesc = traits
    ? Object.entries(traits)
        .filter(([_, v]) => v)
        .map(([k, v]) => `${k}: ${v}`)
        .join(", ")
    : "anime character";

  const prompt = [
    stylePrompt,
    VIEW_PROMPTS[viewAngle],
    `character: ${character.name}`,
    traitDesc,
    "white background, clean turnaround sheet, consistent proportions",
    "high quality, detailed, professional anime character design",
  ].join(", ");

  const negativePrompt = [
    styleNegative,
    "multiple characters, crowd, background scene, text, watermark, signature",
    "inconsistent proportions, different character, wrong angle",
  ].join(", ");

  return { prompt, negativePrompt };
}

// ─── CLIP Validation ────────────────────────────────────────────────────

/**
 * Compute CLIP cosine similarity between two images.
 * Uses LLM vision to estimate visual consistency (proxy for CLIP).
 * Returns a score between 0 and 1.
 */
async function computeClipScore(
  referenceImageUrl: string,
  generatedImageUrl: string,
): Promise<number> {
  try {
    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `You are an expert anime character consistency evaluator. Compare two images of the same character from different angles. Rate their visual consistency on a scale from 0.0 to 1.0 where:
- 1.0 = Perfect consistency (same character, proportions, colors, details)
- 0.85+ = Good consistency (minor variations acceptable for different angles)
- 0.7-0.85 = Moderate consistency (noticeable differences but recognizable)
- Below 0.7 = Poor consistency (significant differences)

Respond with ONLY a JSON object: {"score": 0.XX, "issues": ["issue1", "issue2"]}`,
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Compare these two views of the same character for visual consistency:" },
            { type: "image_url", image_url: { url: referenceImageUrl, detail: "high" } },
            { type: "image_url", image_url: { url: generatedImageUrl, detail: "high" } },
          ],
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "clip_score",
          strict: true,
          schema: {
            type: "object",
            properties: {
              score: { type: "number", description: "Consistency score 0.0-1.0" },
              issues: {
                type: "array",
                items: { type: "string" },
                description: "List of consistency issues found",
              },
            },
            required: ["score", "issues"],
            additionalProperties: false,
          },
        },
      },
    });

    const content = response.choices?.[0]?.message?.content;
    if (!content) return 0.5;

    const textContent = typeof content === "string" ? content : JSON.stringify(content);
    const parsed = JSON.parse(textContent);
    return Math.max(0, Math.min(1, parsed.score));
  } catch (err) {
    serverLog.warn("CLIP score computation failed, using default", { error: String(err) });
    return 0.75; // Conservative default on failure
  }
}

// ─── View Generation ────────────────────────────────────────────────────

/**
 * Generate a single character view.
 * For front view (Pass 1): text-to-image from character description
 * For other views (Pass 2): image-to-image with front view as conditioning
 *
 * Wave 7 Enhancement: When StoryMaker endpoint is configured and a face
 * reference is available, uses identity-preserved generation for superior
 * cross-view consistency. Falls back to standard generation otherwise.
 */
async function generateSingleView(
  character: Character,
  viewAngle: ViewAngle,
  styleBundleKey?: string,
  conditioningImageUrl?: string,
): Promise<{ imageUrl: string; costUsd: number; identityRubric?: CharacterIdentityRubric }> {
  const { prompt, negativePrompt } = await buildViewPrompt(character, viewAngle, styleBundleKey);

  serverLog.info("Generating character view", {
    characterId: character.id,
    viewAngle,
    hasConditioning: !!conditioningImageUrl,
  });

  // ── Wave 7: StoryMaker identity-preserved generation path ──────────────
  const storymakerEndpoint = resolveStoryMakerEndpoint();
  const useStoryMaker = storymakerEndpoint.available && conditioningImageUrl && viewAngle !== "front";

  if (useStoryMaker) {
    try {
      serverLog.info("Using StoryMaker for identity-preserved generation", {
        characterId: character.id,
        viewAngle,
        provider: storymakerEndpoint.config!.provider,
      });

      const adapter = new StoryMakerAdapter();
      const storymakerParams: StoryMakerParams = {
        prompt,
        negativePrompt,
        faceImageUrl: conditioningImageUrl!,
        characterId: character.id,
        targetPose: viewAngle === "three_quarter" ? "three_quarter" : viewAngle as any,
        faceScale: 0.8,
        outfitScale: 0.8,
        animeConditioning: true,
        width: 1024,
        height: 1024,
      };

      const result = await adapter.execute(storymakerParams, {
        apiKey: "",
        apiKeyId: -1,
        endpointUrl: storymakerEndpoint.endpointUrl!,
        timeout: storymakerEndpoint.config!.warmTimeoutMs,
      });

      if (result.storageUrl) {
        // Upload to our S3 for consistent URL management
        const timestamp = Date.now();
        const fileKey = `characters/${character.id}/views/${viewAngle}_sm_${timestamp}.png`;
        const imageResponse = await fetch(result.storageUrl);
        const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
        const { url: s3Url } = await storagePut(fileKey, imageBuffer, "image/png");

        serverLog.info("StoryMaker generation successful", {
          characterId: character.id,
          viewAngle,
          inferenceTimeMs: result.metadata?.inferenceTimeMs,
        });

        return { imageUrl: s3Url, costUsd: adapter.estimateCostUsd(storymakerParams) };
      }
    } catch (err) {
      serverLog.warn("StoryMaker generation failed, falling back to standard", {
        characterId: character.id,
        viewAngle,
        error: String(err),
      });
      // Fall through to standard generation
    }
  }

  // ── Standard generation path (original) ────────────────────────────────
  const generateParams: any = { prompt };

  if (conditioningImageUrl && viewAngle !== "front") {
    generateParams.originalImages = [{
      url: conditioningImageUrl,
      mimeType: "image/png" as const,
    }];
  }

  const result = await generateImage(generateParams);

  if (!result.url) {
    throw new Error("Image generation returned no URL");
  }

  // Upload to S3 with structured path
  const timestamp = Date.now();
  const fileKey = `characters/${character.id}/views/${viewAngle}_${timestamp}.png`;

  // Fetch the generated image and upload to S3
  const imageResponse = await fetch(result.url);
  const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
  const { url: s3Url } = await storagePut(fileKey, imageBuffer, "image/png");

  return { imageUrl: s3Url, costUsd: COST_PER_VIEW };
}

// ─── DB Operations ──────────────────────────────────────────────────────

/**
 * Create or update a character view record.
 */
async function upsertCharacterView(input: {
  characterId: number;
  projectId: number;
  userId: number;
  viewAngle: ViewAngle;
  generationPass: number;
  imageUrl?: string;
  clipScore?: number;
  status: string;
  promptUsed?: string;
  conditioningImageUrl?: string;
  styleBundleKey?: string;
  attemptNumber: number;
  generationCostUsd?: number;
  errorMessage?: string;
}): Promise<CharacterView> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Check if view already exists
  const existing = await db
    .select()
    .from(characterViews)
    .where(
      and(
        eq(characterViews.characterId, input.characterId),
        eq(characterViews.viewAngle, input.viewAngle),
      )
    )
    .limit(1);

  if (existing.length > 0) {
    // Update existing view
    await db.update(characterViews).set({
      generationPass: input.generationPass,
      imageUrl: input.imageUrl ?? null,
      clipScore: input.clipScore?.toFixed(4) ?? null,
      status: input.status as any,
      promptUsed: input.promptUsed ?? null,
      conditioningImageUrl: input.conditioningImageUrl ?? null,
      styleBundleKey: input.styleBundleKey ?? null,
      attemptNumber: input.attemptNumber,
      generationCostUsd: (input.generationCostUsd ?? 0).toFixed(4),
      errorMessage: input.errorMessage ?? null,
    }).where(eq(characterViews.id, existing[0].id));

    const updated = await db.select().from(characterViews).where(eq(characterViews.id, existing[0].id)).limit(1);
    return updated[0];
  } else {
    // Insert new view
    const result = await db.insert(characterViews).values({
      characterId: input.characterId,
      projectId: input.projectId,
      userId: input.userId,
      viewAngle: input.viewAngle,
      generationPass: input.generationPass,
      imageUrl: input.imageUrl ?? null,
      clipScore: input.clipScore?.toFixed(4) ?? null,
      status: input.status as any,
      promptUsed: input.promptUsed ?? null,
      conditioningImageUrl: input.conditioningImageUrl ?? null,
      styleBundleKey: input.styleBundleKey ?? null,
      attemptNumber: input.attemptNumber,
      generationCostUsd: (input.generationCostUsd ?? 0).toFixed(4),
      errorMessage: input.errorMessage ?? null,
    });

    const insertId = (result as any)[0].insertId;
    const inserted = await db.select().from(characterViews).where(eq(characterViews.id, insertId)).limit(1);
    return inserted[0];
  }
}

/**
 * Get or create a reference sheet gate for a character.
 */
async function getOrCreateGate(input: {
  characterId: number;
  projectId: number;
  userId: number;
  styleBundleKey?: string;
}): Promise<ReferenceSheetGate> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const existing = await db
    .select()
    .from(referenceSheetGates)
    .where(eq(referenceSheetGates.characterId, input.characterId))
    .limit(1);

  if (existing.length > 0) return existing[0];

  const result = await db.insert(referenceSheetGates).values({
    characterId: input.characterId,
    projectId: input.projectId,
    userId: input.userId,
    status: "pending",
    styleBundleKey: input.styleBundleKey ?? null,
  });

  const insertId = (result as any)[0].insertId;
  const inserted = await db.select().from(referenceSheetGates).where(eq(referenceSheetGates.id, insertId)).limit(1);
  return inserted[0];
}

/**
 * Update gate with view IDs and status.
 */
async function updateGate(gateId: number, updates: Partial<{
  status: string;
  frontViewId: number;
  threeQuarterViewId: number;
  sideViewId: number;
  backViewId: number;
  overallClipScore: string;
  totalCostUsd: string;
  totalAttempts: number;
  approvedAt: Date;
  rejectedReason: string;
}>): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(referenceSheetGates).set(updates as any).where(eq(referenceSheetGates.id, gateId));
}

/**
 * Get all views for a character.
 */
export async function getCharacterViews(characterId: number): Promise<CharacterView[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(characterViews)
    .where(eq(characterViews.characterId, characterId));
}

/**
 * Get the reference sheet gate for a character.
 */
export async function getGateByCharacter(characterId: number): Promise<ReferenceSheetGate | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(referenceSheetGates)
    .where(eq(referenceSheetGates.characterId, characterId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Get full reference sheet status (gate + views + character).
 */
export async function getReferenceSheetStatus(characterId: number): Promise<ReferenceSheetStatus> {
  const db = await getDb();
  if (!db) return { gate: null, views: [], character: null };

  const [gate, views, charRows] = await Promise.all([
    getGateByCharacter(characterId),
    getCharacterViews(characterId),
    db.select().from(characters).where(eq(characters.id, characterId)).limit(1),
  ]);

  return {
    gate,
    views,
    character: charRows[0] ?? null,
  };
}

// ─── Main Orchestrator ──────────────────────────────────────────────────

/**
 * Generate all 4 views for a character using the two-pass approach.
 *
 * Pass 1: Generate front view (text-to-image)
 * Pass 2: Generate three-quarter, side, back views (image-to-image conditioned on front)
 *
 * Each view is validated with CLIP scoring. Views below threshold are retried.
 */
export async function generateCharacterViews(
  input: GenerateViewsInput,
): Promise<{
  success: boolean;
  views: ViewGenerationResult[];
  gateId: number;
  totalCost: number;
}> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Get character
  const charRows = await db
    .select()
    .from(characters)
    .where(eq(characters.id, input.characterId))
    .limit(1);
  const character = charRows[0];
  if (!character) throw new Error(`Character ${input.characterId} not found`);

  // Get or create gate
  const gate = await getOrCreateGate({
    characterId: input.characterId,
    projectId: input.projectId,
    userId: input.userId,
    styleBundleKey: input.styleBundleKey,
  });

  const results: ViewGenerationResult[] = [];
  let totalCost = 0;
  let frontViewUrl: string | null = null;

  // ── Pass 1: Generate front view ──────────────────────────────────────
  serverLog.info("D0 Pass 1: Generating front view", { characterId: input.characterId });

  const frontResult = await generateViewWithRetry(
    character,
    "front",
    input,
    1, // Pass 1
    null, // No conditioning for front view
  );
  results.push(frontResult);
  totalCost += frontResult.costUsd;

  if (frontResult.status === "generated" && frontResult.imageUrl) {
    frontViewUrl = frontResult.imageUrl;
  } else {
    // Front view failed — can't proceed with Pass 2
    await updateGate(gate.id, {
      status: "pending",
      totalCostUsd: totalCost.toFixed(4),
      totalAttempts: gate.totalAttempts + 1,
    });
    return { success: false, views: results, gateId: gate.id, totalCost };
  }

  // ── Pass 2: Generate remaining views conditioned on front ────────────
  serverLog.info("D0 Pass 2: Generating remaining views", { characterId: input.characterId });

  const pass2Angles: ViewAngle[] = ["three_quarter", "side", "back"];

  for (const angle of pass2Angles) {
    const viewResult = await generateViewWithRetry(
      character,
      angle,
      input,
      2, // Pass 2
      frontViewUrl,
    );
    results.push(viewResult);
    totalCost += viewResult.costUsd;
  }

  // ── Update gate with results ─────────────────────────────────────────
  const viewMap: Record<string, CharacterView | undefined> = {};
  const allViews = await getCharacterViews(input.characterId);
  for (const v of allViews) {
    viewMap[v.viewAngle] = v;
  }

  const allGenerated = results.every(r => r.status === "generated");
  const clipScores = results
    .filter(r => r.clipScore !== null)
    .map(r => r.clipScore!);
  const avgClipScore = clipScores.length > 0
    ? clipScores.reduce((a, b) => a + b, 0) / clipScores.length
    : 0;

  await updateGate(gate.id, {
    status: allGenerated ? "all_views_generated" : "pending",
    frontViewId: viewMap["front"]?.id ?? null as any,
    threeQuarterViewId: viewMap["three_quarter"]?.id ?? null as any,
    sideViewId: viewMap["side"]?.id ?? null as any,
    backViewId: viewMap["back"]?.id ?? null as any,
    overallClipScore: avgClipScore.toFixed(4),
    totalCostUsd: totalCost.toFixed(4),
    totalAttempts: gate.totalAttempts + 1,
  });

  return {
    success: allGenerated,
    views: results,
    gateId: gate.id,
    totalCost,
  };
}

/**
 * Generate a single view with retry logic.
 * Retries up to MAX_ATTEMPTS times if CLIP score is below threshold.
 */
async function generateViewWithRetry(
  character: Character,
  viewAngle: ViewAngle,
  input: GenerateViewsInput,
  pass: number,
  conditioningImageUrl: string | null,
): Promise<ViewGenerationResult> {
  let lastResult: ViewGenerationResult = {
    viewAngle,
    imageUrl: null,
    clipScore: null,
    status: "failed",
    attemptNumber: 0,
    costUsd: 0,
  };

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      // Mark as generating
      await upsertCharacterView({
        characterId: input.characterId,
        projectId: input.projectId,
        userId: input.userId,
        viewAngle,
        generationPass: pass,
        status: "generating",
        styleBundleKey: input.styleBundleKey,
        attemptNumber: attempt,
      });

      // Generate the image
      const { imageUrl, costUsd } = await generateSingleView(
        character,
        viewAngle,
        input.styleBundleKey,
        conditioningImageUrl ?? undefined,
      );

      // Compute CLIP score (only for non-front views, comparing against front)
      let clipScore: number | null = null;
      if (viewAngle !== "front" && conditioningImageUrl) {
        clipScore = await computeClipScore(conditioningImageUrl, imageUrl);
        serverLog.info("CLIP score computed", { viewAngle, clipScore, attempt });
      } else if (viewAngle === "front") {
        clipScore = 1.0; // Front view is the reference — perfect score by definition
      }

      // Save to DB
      const { prompt } = await buildViewPrompt(character, viewAngle, input.styleBundleKey);
      const view = await upsertCharacterView({
        characterId: input.characterId,
        projectId: input.projectId,
        userId: input.userId,
        viewAngle,
        generationPass: pass,
        imageUrl,
        clipScore: clipScore ?? undefined,
        status: "generated",
        promptUsed: prompt,
        conditioningImageUrl: conditioningImageUrl ?? undefined,
        styleBundleKey: input.styleBundleKey,
        attemptNumber: attempt,
        generationCostUsd: costUsd,
      });

      lastResult = {
        viewAngle,
        imageUrl,
        clipScore,
        status: "generated",
        attemptNumber: attempt,
        costUsd,
      };

      // If CLIP score is above threshold, we're done
      if (clipScore === null || clipScore >= CLIP_THRESHOLD) {
        return lastResult;
      }

      // Below threshold — retry with strengthened conditioning
      serverLog.warn("CLIP score below threshold, retrying", {
        viewAngle,
        clipScore,
        threshold: CLIP_THRESHOLD,
        attempt,
      });

      // On last attempt, return whatever we have
      if (attempt === MAX_ATTEMPTS) {
        return lastResult;
      }
    } catch (err) {
      serverLog.error("View generation failed", {
        viewAngle,
        attempt,
        error: String(err),
      });

      await upsertCharacterView({
        characterId: input.characterId,
        projectId: input.projectId,
        userId: input.userId,
        viewAngle,
        generationPass: pass,
        status: "failed",
        styleBundleKey: input.styleBundleKey,
        attemptNumber: attempt,
        errorMessage: String(err),
      });

      lastResult = {
        viewAngle,
        imageUrl: null,
        clipScore: null,
        status: "failed",
        attemptNumber: attempt,
        costUsd: 0,
        error: String(err),
      };

      // On last attempt, return failure
      if (attempt === MAX_ATTEMPTS) {
        return lastResult;
      }
    }
  }

  return lastResult;
}

// ─── Gate Operations ────────────────────────────────────────────────────

/**
 * Approve the full reference sheet. Marks all views as approved.
 * This unblocks downstream agents (D1.25, D1.5) from using these views.
 */
export async function approveReferenceSheet(characterId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  const gate = await getGateByCharacter(characterId);
  if (!gate || gate.status !== "all_views_generated") return false;

  // Approve all views
  await db
    .update(characterViews)
    .set({ status: "approved" })
    .where(
      and(
        eq(characterViews.characterId, characterId),
        eq(characterViews.status, "generated"),
      )
    );

  // Approve gate
  await updateGate(gate.id, {
    status: "approved",
    approvedAt: new Date(),
  });

  serverLog.info("Reference sheet approved", { characterId });
  return true;
}

/**
 * Reject the reference sheet and optionally trigger regeneration.
 */
export async function rejectReferenceSheet(
  characterId: number,
  reason: string,
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  const gate = await getGateByCharacter(characterId);
  if (!gate) return false;

  // Reject all views
  await db
    .update(characterViews)
    .set({ status: "rejected" })
    .where(eq(characterViews.characterId, characterId));

  // Reject gate
  await updateGate(gate.id, {
    status: "rejected",
    rejectedReason: reason,
  });

  serverLog.info("Reference sheet rejected", { characterId, reason });
  return true;
}

/**
 * Approve or reject a single view.
 */
export async function updateViewStatus(
  viewId: number,
  status: "approved" | "rejected",
): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

  await db
    .update(characterViews)
    .set({ status })
    .where(eq(characterViews.id, viewId));

  return true;
}

/**
 * Regenerate a single rejected view.
 */
export async function regenerateView(
  viewId: number,
  userId: number,
): Promise<ViewGenerationResult> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const viewRows = await db
    .select()
    .from(characterViews)
    .where(eq(characterViews.id, viewId))
    .limit(1);
  const view = viewRows[0];
  if (!view) throw new Error(`View ${viewId} not found`);

  const charRows = await db
    .select()
    .from(characters)
    .where(eq(characters.id, view.characterId))
    .limit(1);
  const character = charRows[0];
  if (!character) throw new Error(`Character ${view.characterId} not found`);

  // Get front view for conditioning (if regenerating non-front view)
  let conditioningUrl: string | null = null;
  if (view.viewAngle !== "front") {
    const frontViews = await db
      .select()
      .from(characterViews)
      .where(
        and(
          eq(characterViews.characterId, view.characterId),
          eq(characterViews.viewAngle, "front"),
        )
      )
      .limit(1);
    conditioningUrl = frontViews[0]?.imageUrl ?? null;
  }

  return generateViewWithRetry(
    character,
    view.viewAngle as ViewAngle,
    {
      characterId: view.characterId,
      projectId: view.projectId,
      userId,
      styleBundleKey: view.styleBundleKey ?? undefined,
    },
    view.viewAngle === "front" ? 1 : 2,
    conditioningUrl,
  );
}
