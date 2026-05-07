/**
 * D1.5 Genga Director
 *
 * Takes D1.25 layouts + D0 character sheets + D6 color hints
 * → generates keyframe drawings (genga) that condition the video model.
 *
 * Two-pass flow:
 *   Pass 1: rough genga generation from layout compositions
 *   Pass 2: flip-book preview assembly → user approval → clean genga
 *
 * Cost: ~$0.15/slice
 */
import { getDb } from "../../db";
import { gengaKeyframes, flipBookPreviews, characters } from "../../../drizzle/schema";
import { eq, and, asc, inArray } from "drizzle-orm";
import { generateImage } from "../../_core/imageGeneration";
import { storagePut } from "../../storage";
import { serverLog } from "../../observability/logger";
import {
  StoryMakerAdapter,
  resolveStoryMakerEndpoint,
  type StoryMakerParams,
} from "../../provider-router/adapters/storymaker-adapter";

// ─── Types ──────────────────────────────────────────────────────────────
export interface GenerateGengaInput {
  projectId: number;
  episodeId: number;
  userId: number;
  layouts: Array<{
    layoutId: number;
    sceneNumber: number;
    panelNumber: number;
    cameraAngle: string;
    characterPlacements: any[];
    depthLayers: any;
    compositionNotes?: string;
  }>;
  characterSheets: Array<{
    characterId: number;
    name: string;
    frontViewUrl?: string;
    referenceSheetUrl?: string;
  }>;
  colorHints?: {
    scenePalettes?: any[];
    characterPalettes?: any[];
  };
}

export interface GengaResult {
  keyframeId: number;
  sceneNumber: number;
  panelNumber: number;
  roughGengaUrl: string;
  status: string;
}

// ─── Pass 1: Generate Rough Genga ───────────────────────────────────────
export async function generateRoughGenga(input: GenerateGengaInput): Promise<{
  keyframes: GengaResult[];
  totalCost: number;
}> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  serverLog.info("[D1.5] Starting rough genga generation", {
    projectId: input.projectId,
    episodeId: input.episodeId,
    panelCount: input.layouts.length,
  });

  const results: GengaResult[] = [];
  let totalCost = 0;
  const costPerFrame = 0.05; // $0.05 per rough genga frame

  for (const layout of input.layouts) {
    try {
      // Build conditioning inputs
      const conditioning = {
        layoutId: layout.layoutId,
        characterSheetUrls: input.characterSheets
          .filter(cs => layout.characterPlacements.some((cp: any) =>
            cp.characterName?.toLowerCase() === cs.name.toLowerCase()))
          .map(cs => cs.frontViewUrl || cs.referenceSheetUrl)
          .filter(Boolean),
        colorPalette: input.colorHints?.scenePalettes?.[layout.sceneNumber - 1] || null,
      };

      // Generate rough genga prompt
      const prompt = buildRoughGengaPrompt(layout, input.characterSheets, input.colorHints);

      // ── Wave 7: StoryMaker identity-preserved genga path ────────────────
      // Conditional activation: fires for characters WITHOUT existing DoRA/LoRA,
      // skips (falls back to standard generation) when DoRA exists.
      const storymakerEndpoint = resolveStoryMakerEndpoint();
      const placedCharacterIds = layout.characterPlacements
        .map((cp: any) => cp.characterId)
        .filter(Boolean) as number[];

      // Check if ANY placed character has a trained LoRA (DoRA exists → skip StoryMaker)
      let hasDoRA = false;
      if (placedCharacterIds.length > 0) {
        const db2 = await getDb();
        if (db2) {
          const charRows = await db2.select({ loraStatus: characters.loraStatus })
            .from(characters)
            .where(inArray(characters.id, placedCharacterIds));
          hasDoRA = charRows.some(c => c.loraStatus === "ready");
        }
      }

      const useStoryMaker = storymakerEndpoint.available
        && conditioning.characterSheetUrls.length > 0
        && !hasDoRA;

      let generatedUrl: string | undefined;

      if (useStoryMaker) {
        try {
          serverLog.info("[D1.5] Using StoryMaker for identity-preserved genga", {
            layoutId: layout.layoutId,
            provider: storymakerEndpoint.config!.provider,
            characterCount: placedCharacterIds.length,
          });

          const adapter = new StoryMakerAdapter();
          const smParams: StoryMakerParams = {
            prompt,
            faceImageUrl: conditioning.characterSheetUrls[0]!,
            characterId: placedCharacterIds[0] || 0,
            targetPose: "front",
            faceScale: 0.7,
            outfitScale: 0.7,
            animeConditioning: true,
            width: 1024,
            height: 1024,
          };

          const smResult = await adapter.execute(smParams, {
            apiKey: "",
            apiKeyId: -1,
            endpointUrl: storymakerEndpoint.endpointUrl!,
            timeout: storymakerEndpoint.config!.warmTimeoutMs,
          });

          if (smResult.storageUrl) {
            generatedUrl = smResult.storageUrl;
            serverLog.info("[D1.5] StoryMaker genga generation successful", {
              layoutId: layout.layoutId,
              inferenceTimeMs: smResult.metadata?.inferenceTimeMs,
            });
          }
        } catch (err: any) {
          serverLog.warn("[D1.5] StoryMaker genga failed, falling back to standard", {
            layoutId: layout.layoutId,
            error: err.message,
          });
          // Fall through to standard generation
        }
      } else if (hasDoRA) {
        serverLog.info("[D1.5] Skipping StoryMaker — character has trained DoRA/LoRA", {
          layoutId: layout.layoutId,
          characterIds: placedCharacterIds,
        });
      }

      // ── Standard generation path (fallback or DoRA-exists path) ─────────
      if (!generatedUrl) {
        const originalImages = conditioning.characterSheetUrls.length > 0
          ? [{ url: conditioning.characterSheetUrls[0]!, mimeType: "image/png" as const }]
          : undefined;

        const result = await generateImage({
          prompt,
          ...(originalImages ? { originalImages } : {}),
        });

        if (!result.url) throw new Error("No image URL returned");
        generatedUrl = result.url;
      }

      if (!generatedUrl) throw new Error("No image URL returned");

      // Upload to S3
      const response = await fetch(generatedUrl);
      const buffer = Buffer.from(await response.arrayBuffer());
      const key = `projects/${input.projectId}/genga/${input.episodeId}/s${layout.sceneNumber}-p${layout.panelNumber}-rough-${Date.now()}.png`;
      const { url: s3Url } = await storagePut(key, buffer, "image/png");

      // Insert record
      const [insertResult] = await db.insert(gengaKeyframes).values({
        projectId: input.projectId,
        episodeId: input.episodeId,
        sceneNumber: layout.sceneNumber,
        panelNumber: layout.panelNumber,
        layoutId: layout.layoutId,
        sequenceIndex: 0,
        roughGengaUrl: s3Url,
        roughGengaKey: key,
        generationPrompt: prompt,
        conditioningInputs: conditioning,
        generationCostUsd: String(costPerFrame),
        status: "rough_ready",
      });

      const keyframeId = (insertResult as any).insertId;
      totalCost += costPerFrame;

      results.push({
        keyframeId,
        sceneNumber: layout.sceneNumber,
        panelNumber: layout.panelNumber,
        roughGengaUrl: s3Url,
        status: "rough_ready",
      });
    } catch (err: any) {
      serverLog.error("[D1.5] Rough genga failed for panel", {
        sceneNumber: layout.sceneNumber,
        panelNumber: layout.panelNumber,
        error: err.message,
      });

      // Insert failed record
      const [insertResult] = await db.insert(gengaKeyframes).values({
        projectId: input.projectId,
        episodeId: input.episodeId,
        sceneNumber: layout.sceneNumber,
        panelNumber: layout.panelNumber,
        layoutId: layout.layoutId,
        sequenceIndex: 0,
        generationPrompt: buildRoughGengaPrompt(layout, input.characterSheets, input.colorHints),
        conditioningInputs: {},
        generationCostUsd: "0",
        status: "pending",
        metadata: { error: err.message },
      });

      results.push({
        keyframeId: (insertResult as any).insertId,
        sceneNumber: layout.sceneNumber,
        panelNumber: layout.panelNumber,
        roughGengaUrl: "",
        status: "pending",
      });
    }
  }

  serverLog.info("[D1.5] Rough genga generation complete", {
    episodeId: input.episodeId,
    successCount: results.filter(r => r.status === "rough_ready").length,
    failCount: results.filter(r => r.status === "pending").length,
    totalCost,
  });

  return { keyframes: results, totalCost };
}

// ─── Pass 2: Generate Clean Genga ───────────────────────────────────────
export async function generateCleanGenga(keyframeId: number, projectId: number): Promise<{
  cleanGengaUrl: string;
  cost: number;
}> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const keyframe = await getKeyframeById(keyframeId);
  if (!keyframe) throw new Error("Keyframe not found");
  if (keyframe.status !== "approved_rough") throw new Error("Rough genga must be approved first");

  const costPerClean = 0.10; // $0.10 per clean genga

  // Update status
  await db.update(gengaKeyframes).set({ status: "generating_clean" }).where(eq(gengaKeyframes.id, keyframeId));

  try {
    const prompt = `Clean anime keyframe drawing, refined line art, professional genga quality. Based on rough keyframe. Clean lines, consistent proportions, production-ready keyframe for animation. ${keyframe.generationPrompt || ""}`;

    const result = await generateImage({
      prompt,
      originalImages: keyframe.roughGengaUrl ? [{ url: keyframe.roughGengaUrl, mimeType: "image/png" }] : undefined,
    });

    if (!result.url) throw new Error("No image URL returned");

    const response = await fetch(result.url);
    const buffer = Buffer.from(await response.arrayBuffer());
    const key = `projects/${projectId}/genga/${keyframe.episodeId}/s${keyframe.sceneNumber}-p${keyframe.panelNumber}-clean-${Date.now()}.png`;
    const { url: s3Url } = await storagePut(key, buffer, "image/png");

    await db.update(gengaKeyframes).set({
      cleanGengaUrl: s3Url,
      cleanGengaKey: key,
      generationCostUsd: String(parseFloat(keyframe.generationCostUsd || "0") + costPerClean),
      status: "clean_ready",
    }).where(eq(gengaKeyframes.id, keyframeId));

    return { cleanGengaUrl: s3Url, cost: costPerClean };
  } catch (err: any) {
    await db.update(gengaKeyframes).set({
      status: "approved_rough", // Revert to allow retry
      metadata: { ...(keyframe.metadata as any || {}), cleanError: err.message },
    }).where(eq(gengaKeyframes.id, keyframeId));
    throw err;
  }
}

// ─── Flip-Book Preview Assembly ─────────────────────────────────────────
export async function assembleFlipBookPreview(
  projectId: number,
  episodeId: number,
  sceneNumber: number,
): Promise<{ previewId: number; frameCount: number }> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  // Get all approved rough genga for this scene
  const keyframes = await db.select().from(gengaKeyframes)
    .where(and(
      eq(gengaKeyframes.episodeId, episodeId),
      eq(gengaKeyframes.sceneNumber, sceneNumber),
    ))
    .orderBy(asc(gengaKeyframes.panelNumber), asc(gengaKeyframes.sequenceIndex));

  const frameUrls = keyframes
    .filter(kf => kf.roughGengaUrl)
    .map(kf => kf.roughGengaUrl);

  if (frameUrls.length === 0) throw new Error("No genga frames available for flip-book");

  // Insert flip-book preview record
  const [insertResult] = await db.insert(flipBookPreviews).values({
    projectId,
    episodeId,
    sceneNumber,
    frameUrls,
    frameCount: frameUrls.length,
    fps: 8,
    status: "ready",
    generationCostUsd: "0", // Assembly is free, just ordering existing frames
  });

  return {
    previewId: (insertResult as any).insertId,
    frameCount: frameUrls.length,
  };
}

// ─── Approval Gates ─────────────────────────────────────────────────────
export async function approveRoughGenga(keyframeId: number, userId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const kf = await getKeyframeById(keyframeId);
  if (!kf || kf.status !== "rough_ready") return false;
  await db.update(gengaKeyframes).set({
    status: "approved_rough",
    approvedBy: userId,
  }).where(eq(gengaKeyframes.id, keyframeId));
  return true;
}

export async function approveCleanGenga(keyframeId: number, userId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const kf = await getKeyframeById(keyframeId);
  if (!kf || kf.status !== "clean_ready") return false;
  await db.update(gengaKeyframes).set({
    status: "approved",
    approvedAt: new Date(),
    approvedBy: userId,
  }).where(eq(gengaKeyframes.id, keyframeId));
  return true;
}

export async function rejectGenga(keyframeId: number, reason: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const kf = await getKeyframeById(keyframeId);
  if (!kf) return false;
  await db.update(gengaKeyframes).set({
    status: "rejected",
    rejectedReason: reason,
  }).where(eq(gengaKeyframes.id, keyframeId));
  return true;
}

export async function approveFlipBook(previewId: number, userId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const [rows] = await db.select().from(flipBookPreviews).where(eq(flipBookPreviews.id, previewId)).limit(1);
  if (!rows || (rows as any).status !== "ready") return false;
  await db.update(flipBookPreviews).set({
    status: "approved",
    approvedAt: new Date(),
    approvedBy: userId,
  }).where(eq(flipBookPreviews.id, previewId));
  return true;
}

// ─── Query Helpers ──────────────────────────────────────────────────────
export async function getKeyframeById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(gengaKeyframes).where(eq(gengaKeyframes.id, id)).limit(1);
  return rows[0] || null;
}

export async function getKeyframesByEpisode(episodeId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(gengaKeyframes)
    .where(eq(gengaKeyframes.episodeId, episodeId))
    .orderBy(asc(gengaKeyframes.sceneNumber), asc(gengaKeyframes.panelNumber), asc(gengaKeyframes.sequenceIndex));
}

export async function getKeyframesByScene(episodeId: number, sceneNumber: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(gengaKeyframes)
    .where(and(
      eq(gengaKeyframes.episodeId, episodeId),
      eq(gengaKeyframes.sceneNumber, sceneNumber),
    ))
    .orderBy(asc(gengaKeyframes.panelNumber), asc(gengaKeyframes.sequenceIndex));
}

export async function getFlipBooksByEpisode(episodeId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(flipBookPreviews)
    .where(eq(flipBookPreviews.episodeId, episodeId))
    .orderBy(asc(flipBookPreviews.sceneNumber));
}

export async function getFlipBookById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(flipBookPreviews).where(eq(flipBookPreviews.id, id)).limit(1);
  return rows[0] || null;
}

export async function regenerateKeyframe(keyframeId: number, projectId: number): Promise<GengaResult> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const kf = await getKeyframeById(keyframeId);
  if (!kf) throw new Error("Keyframe not found");

  // Increment attempt
  await db.update(gengaKeyframes).set({
    status: "generating_rough",
    attemptNumber: (kf.attemptNumber || 1) + 1,
  }).where(eq(gengaKeyframes.id, keyframeId));

  try {
    const result = await generateImage({ prompt: kf.generationPrompt || "" });
    if (!result.url) throw new Error("No image URL returned");

    const response = await fetch(result.url);
    const buffer = Buffer.from(await response.arrayBuffer());
    const key = `projects/${projectId}/genga/${kf.episodeId}/s${kf.sceneNumber}-p${kf.panelNumber}-rough-regen-${Date.now()}.png`;
    const { url: s3Url } = await storagePut(key, buffer, "image/png");

    await db.update(gengaKeyframes).set({
      roughGengaUrl: s3Url,
      roughGengaKey: key,
      status: "rough_ready",
      generationCostUsd: String(parseFloat(kf.generationCostUsd || "0") + 0.05),
    }).where(eq(gengaKeyframes.id, keyframeId));

    return {
      keyframeId,
      sceneNumber: kf.sceneNumber,
      panelNumber: kf.panelNumber,
      roughGengaUrl: s3Url,
      status: "rough_ready",
    };
  } catch (err: any) {
    await db.update(gengaKeyframes).set({
      status: "pending",
      metadata: { ...(kf.metadata as any || {}), regenError: err.message },
    }).where(eq(gengaKeyframes.id, keyframeId));
    throw err;
  }
}

// ─── Prompt Builders ────────────────────────────────────────────────────
function buildRoughGengaPrompt(
  layout: GenerateGengaInput["layouts"][0],
  characters: GenerateGengaInput["characterSheets"],
  colorHints?: GenerateGengaInput["colorHints"],
): string {
  const charNames = layout.characterPlacements
    .map((cp: any) => cp.characterName || cp.name)
    .filter(Boolean)
    .join(", ");

  return `Anime keyframe drawing (genga), rough sketch style with dynamic lines. ${layout.cameraAngle} shot. Characters: ${charNames || "scene elements"}. ${layout.compositionNotes || ""}. Pencil-on-paper aesthetic, expressive line weight, animation production keyframe. Depth layers visible. Professional anime genga reference.`;
}
