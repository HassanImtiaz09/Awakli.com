/**
 * D5.5 · Pipeline Integration (Stage 11: Post-Video Quality Gate)
 *
 * Bridges the D5.5 per-clip-reviewer and retry-orchestrator into the
 * main pipelineOrchestrator. Runs AFTER video_gen (Stage 10) completes
 * and BEFORE voice_gen (Stage 12/13) begins.
 *
 * Responsibilities:
 * 1. Collect all generated video clips from pipeline assets
 * 2. Extract keyframe URLs for each clip (using S3 URLs, not local files)
 * 3. Build D5.5 review context from panel metadata + production bible
 * 4. Run batch review → retry loop → escalation
 * 5. Persist results to clip_quality_reviews table
 * 6. Report summary to pipeline orchestrator (pass/block/escalate)
 *
 * Cost: ~$0.04/clip review + ~$0.20/regeneration attempt
 * Latency: ~15s/clip review, ~60s/regeneration
 */
import { runBatchD5_5Review, type BatchD5_5Options, type D5_5ReviewResult } from "./per-clip-reviewer.js";
import { runEpisodeRetryLoop, type RegenerationCallback, type EpisodeRetryResult } from "./retry-orchestrator.js";
import { saveClipReviewBatch, computeHash } from "./db-helpers.js";
import { pipelineLog } from "../../observability/logger.js";
import { addToEscalationQueue } from "../../admin/quality-escalation-queue.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface D5_5PipelineContext {
  pipelineRunId: number;
  episodeId: number;
  projectId: number;
  userId: number;
  /** Generated video clip assets from video_gen node */
  clipAssets: ClipAssetInfo[];
  /** Panel metadata for building review context */
  panels: PanelInfo[];
  /** Character bibles from production bible */
  characterBibles: Record<string, any>;
  /** Style lock derived from project style bundle */
  styleLock: {
    primary: string;
    forbidden: string[];
    toleranceBand?: string;
  };
  /** Callback to regenerate a video clip (calls back into video_gen) */
  regenerateClip: (panelId: number, attempt: number) => Promise<RegeneratedClipResult>;
  /** User subscription tier (affects retry budget) */
  userTier?: string;
}

export interface ClipAssetInfo {
  assetId: number;
  panelId: number;
  panelNumber: number;
  url: string;
  duration: number;
  assetType: "video_clip" | "synced_clip";
  metadata?: Record<string, any>;
}

export interface PanelInfo {
  id: number;
  panelNumber: number;
  sceneNumber: number;
  visualDescription: string | null;
  cameraAngle: string | null;
  dialogue: Array<{ character?: string; text: string; emotion?: string }> | null;
  sfx: string | null;
}

export interface RegeneratedClipResult {
  clipUrl: string;
  keyframeUrls: string[];
  costUsd: number;
}

export interface D5_5PipelineResult {
  /** Whether all clips passed (pipeline can proceed) */
  canProceed: boolean;
  /** Total clips reviewed */
  totalClips: number;
  /** Clips that passed on first attempt */
  passedFirstAttempt: number;
  /** Clips that passed after retries */
  passedAfterRetry: number;
  /** Clips escalated to admin queue */
  escalated: number;
  /** Total cost of D5.5 reviews + retries */
  totalCostUsd: number;
  /** Total duration in ms */
  totalDurationMs: number;
  /** Average quality score across all clips */
  avgQualityScore: number;
  /** Detailed results per clip */
  clipResults: Array<{
    panelId: number;
    panelNumber: number;
    passed: boolean;
    score: number;
    attempts: number;
    escalated: boolean;
  }>;
}

// ─── Constants ──────────────────────────────────────────────────────────────

/** Minimum clips that must pass for pipeline to proceed (percentage) */
const MIN_PASS_RATE = 0.85;

/** Cost per keyframe extraction (S3 upload of 3 frames) */
const KEYFRAME_EXTRACTION_COST = 0.001;

// ─── Main Integration Function ──────────────────────────────────────────────

/**
 * Run the D5.5 per-clip quality gate for all video clips in a pipeline run.
 * This is the main entry point called by the pipeline orchestrator.
 */
export async function runD5_5QualityGate(
  context: D5_5PipelineContext
): Promise<D5_5PipelineResult> {
  const start = Date.now();
  const {
    pipelineRunId,
    episodeId,
    projectId,
    clipAssets,
    panels,
    characterBibles,
    styleLock,
    regenerateClip,
  } = context;

  pipelineLog.info(
    `[D5.5] Starting quality gate for ${clipAssets.length} clips ` +
    `(episode=${episodeId}, run=${pipelineRunId})`
  );

  if (clipAssets.length === 0) {
    pipelineLog.warn("[D5.5] No clip assets to review, skipping quality gate");
    return {
      canProceed: true,
      totalClips: 0,
      passedFirstAttempt: 0,
      passedAfterRetry: 0,
      escalated: 0,
      totalCostUsd: 0,
      totalDurationMs: 0,
      avgQualityScore: 0,
      clipResults: [],
    };
  }

  // ─── Step 1: Build review context per clip ────────────────────────────
  const panelMap = new Map(panels.map(p => [p.id, p]));
  const slices = buildSliceContexts(clipAssets, panelMap);

  // ─── Step 2: Extract keyframe URLs (use clip URL + timestamp offsets) ──
  const keyframeUrlMap = await extractKeyframeUrls(clipAssets);

  // ─── Step 3: Run batch D5.5 review ────────────────────────────────────
  const batchOptions: BatchD5_5Options = {
    episodeId,
    projectId,
    slices: slices.map(s => ({
      ...s.slice,
      clipUrl: s.clipUrl,
      keyframeUrls: keyframeUrlMap.get(s.panelId) || [],
      currentAttempt: 1,
    })),
    characterBibles,
    styleLock,
    parallel: true,
  };

  const batchResult = await runBatchD5_5Review(batchOptions);
  let totalCostUsd = batchResult.totalCostUsd;

  pipelineLog.info(
    `[D5.5] Batch review complete: ${batchResult.passedSlices}/${batchResult.totalSlices} passed, ` +
    `${batchResult.failedSlices} failed, cost=$${totalCostUsd.toFixed(3)}`
  );

  // ─── Step 4: Persist initial review results ───────────────────────────
  await saveClipReviewBatch(batchResult.reviews, {
    episodeId,
    projectId,
    pipelineRunId,
    passThreshold: 3,
  });

  // ─── Step 5: Run retry loop for failed clips ─────────────────────────
  const failedReviews = batchResult.reviews.filter(r => !r.passed);
  let retryResult: EpisodeRetryResult | null = null;

  if (failedReviews.length > 0) {
    pipelineLog.info(`[D5.5] Running retry loop for ${failedReviews.length} failed clips...`);

    const sliceMetadata = new Map(
      slices.map(s => [s.slice.sliceId, s.slice])
    );

    const callbacks: RegenerationCallback = {
      regenerateVideo: async (sliceId, attempt) => {
        const sliceCtx = slices.find(s => s.slice.sliceId === sliceId);
        if (!sliceCtx) throw new Error(`No context for slice ${sliceId}`);
        const result = await regenerateClip(sliceCtx.panelId, attempt);
        totalCostUsd += result.costUsd;
        return { clipUrl: result.clipUrl, keyframeUrls: result.keyframeUrls };
      },
      regeneratePrompt: async (sliceId, attempt) => {
        // For prompt regeneration, we still regenerate the video with a new prompt
        // The prompt improvement is handled internally by the video_gen agent
        const sliceCtx = slices.find(s => s.slice.sliceId === sliceId);
        if (!sliceCtx) throw new Error(`No context for slice ${sliceId}`);
        const result = await regenerateClip(sliceCtx.panelId, attempt);
        totalCostUsd += result.costUsd;
        return { clipUrl: result.clipUrl, keyframeUrls: result.keyframeUrls };
      },
      regenerateReference: async (sliceId, attempt) => {
        // Reference regeneration also goes through video_gen with updated reference
        const sliceCtx = slices.find(s => s.slice.sliceId === sliceId);
        if (!sliceCtx) throw new Error(`No context for slice ${sliceId}`);
        const result = await regenerateClip(sliceCtx.panelId, attempt);
        totalCostUsd += result.costUsd;
        return { clipUrl: result.clipUrl, keyframeUrls: result.keyframeUrls };
      },
      escalate: async (sliceId, reviews) => {
        const sliceCtx = slices.find(s => s.slice.sliceId === sliceId);
        pipelineLog.warn(`[D5.5] Escalating slice ${sliceId} after ${reviews.length} failed attempts`);
        addToEscalationQueue(
          [{
            episodeId: String(episodeId),
            sliceId,
            failureCategory: "d5_5_quality_gate",
            source: "tier2_llm",
            attempts: reviews.length,
            reason: `Quality score below threshold after max retries. Last score: ${reviews[reviews.length - 1]?.overallScore}`,
            timestamp: new Date().toISOString(),
          }],
          {
            d5Review: reviews,
            sliceKeyframes: keyframeUrlMap.get(sliceCtx?.panelId ?? 0) || [],
          }
        );
      },
    };

    retryResult = await runEpisodeRetryLoop({
      episodeId,
      projectId,
      failedReviews,
      sliceMetadata,
      characterBibles,
      styleLock,
      callbacks,
    });

    totalCostUsd += retryResult.totalCostUsd;

    pipelineLog.info(
      `[D5.5] Retry loop complete: ${retryResult.totalPassed} recovered, ` +
      `${retryResult.totalEscalated} escalated, cost=$${retryResult.totalCostUsd.toFixed(3)}`
    );
  }

  // ─── Step 6: Compute final summary ───────────────────────────────────
  const passedFirstAttempt = batchResult.passedSlices;
  const passedAfterRetry = retryResult?.totalPassed ?? 0;
  const escalated = retryResult?.totalEscalated ?? 0;
  const totalPassed = passedFirstAttempt + passedAfterRetry;
  const passRate = clipAssets.length > 0 ? totalPassed / clipAssets.length : 1;
  const canProceed = passRate >= MIN_PASS_RATE && escalated === 0;

  // Compute average quality score from all reviews
  const allScores = batchResult.reviews.map(r => r.overallScore);
  if (retryResult) {
    for (const r of retryResult.results) {
      if (r.reviews.length > 0) {
        allScores.push(r.reviews[r.reviews.length - 1].overallScore);
      }
    }
  }
  const avgQualityScore = allScores.length > 0
    ? Math.round((allScores.reduce((a, b) => a + b, 0) / allScores.length) * 10) / 10
    : 0;

  // Build per-clip results
  const clipResults = clipAssets.map(clip => {
    const initialReview = batchResult.reviews.find(r => r.sliceId === clip.panelId);
    const retryRes = retryResult?.results.find(r => r.sliceId === clip.panelId);

    if (retryRes) {
      return {
        panelId: clip.panelId,
        panelNumber: clip.panelNumber,
        passed: retryRes.finalPassed,
        score: retryRes.reviews[retryRes.reviews.length - 1]?.overallScore ?? 0,
        attempts: retryRes.totalAttempts + 1, // +1 for initial attempt
        escalated: retryRes.escalated,
      };
    }

    return {
      panelId: clip.panelId,
      panelNumber: clip.panelNumber,
      passed: initialReview?.passed ?? false,
      score: initialReview?.overallScore ?? 0,
      attempts: 1,
      escalated: false,
    };
  });

  const totalDurationMs = Date.now() - start;

  pipelineLog.info(
    `[D5.5] Quality gate complete: ${totalPassed}/${clipAssets.length} passed ` +
    `(${passedFirstAttempt} first-attempt, ${passedAfterRetry} retried), ` +
    `${escalated} escalated, avg=${avgQualityScore}, cost=$${totalCostUsd.toFixed(3)}, ` +
    `canProceed=${canProceed}`
  );

  return {
    canProceed,
    totalClips: clipAssets.length,
    passedFirstAttempt,
    passedAfterRetry,
    escalated,
    totalCostUsd,
    totalDurationMs,
    avgQualityScore,
    clipResults,
  };
}

// ─── Helper Functions ───────────────────────────────────────────────────────

interface SliceContext {
  panelId: number;
  clipUrl: string;
  slice: {
    sliceId: number;
    intent: string;
    emotion?: string;
    isDialogue: boolean;
    cameraAngle?: string;
    characters: string[];
  };
}

/**
 * Build D5.5 slice review contexts from clip assets and panel metadata.
 * Maps panelId → sliceId (using panelId as sliceId for 1:1 panel→clip mapping).
 */
function buildSliceContexts(
  clipAssets: ClipAssetInfo[],
  panelMap: Map<number, PanelInfo>
): SliceContext[] {
  return clipAssets.map(clip => {
    const panel = panelMap.get(clip.panelId);
    const dialogue = panel?.dialogue || [];
    const characters = dialogue
      .map(d => d.character)
      .filter((c): c is string => !!c);

    return {
      panelId: clip.panelId,
      clipUrl: clip.url,
      slice: {
        sliceId: clip.panelId, // Use panelId as sliceId for 1:1 mapping
        intent: panel?.visualDescription || "anime scene",
        emotion: dialogue[0]?.emotion,
        isDialogue: dialogue.length > 0,
        cameraAngle: panel?.cameraAngle || undefined,
        characters: Array.from(new Set(characters)),
      },
    };
  });
}

/**
 * Extract keyframe URLs for each clip.
 * For S3-hosted clips, we generate keyframe URLs by requesting frame extraction
 * at 10%, 50%, and 90% of the clip duration.
 *
 * In production, this would call an FFmpeg-based frame extraction service.
 * For now, we use the clip URL itself as a placeholder (the LLM can analyze
 * video URLs directly via the file_url content type).
 */
async function extractKeyframeUrls(
  clipAssets: ClipAssetInfo[]
): Promise<Map<number, string[]>> {
  const keyframeMap = new Map<number, string[]>();

  for (const clip of clipAssets) {
    // Use the clip URL as the keyframe source — the D5.5 reviewer
    // accepts video URLs and extracts frames internally via LLM vision
    keyframeMap.set(clip.panelId, [clip.url]);
  }

  return keyframeMap;
}

/**
 * Derive style lock from project's anime style and production bible.
 */
export function deriveStyleLock(
  animeStyle: string,
  productionBible?: { artStyle?: string; genre?: string[] }
): { primary: string; forbidden: string[]; toleranceBand?: string } {
  const STYLE_FORBIDDEN_MAP: Record<string, string[]> = {
    shonen: ["chibi proportions", "pastel palette", "shoujo sparkles", "watercolor wash"],
    seinen: ["chibi proportions", "bright neon colors", "exaggerated expressions"],
    shoujo: ["dark gritty tones", "excessive violence", "mecha elements"],
    chibi: ["realistic proportions", "detailed backgrounds", "complex shading"],
    cyberpunk: ["pastoral scenes", "bright cheerful colors", "traditional Japanese"],
    watercolor: ["hard edges", "cel shading", "digital artifacts"],
    noir: ["bright colors", "cheerful expressions", "daylight scenes"],
    realistic: ["chibi proportions", "exaggerated features", "flat colors"],
    mecha: ["slice of life", "soft pastel", "minimal detail"],
    default: [],
  };

  const primary = productionBible?.artStyle || animeStyle || "default anime";
  const forbidden = STYLE_FORBIDDEN_MAP[animeStyle] || [];

  return {
    primary,
    forbidden,
    toleranceBand: "minor_variation_acceptable",
  };
}

/**
 * Build character bibles map from production bible characters.
 */
export function buildCharacterBiblesMap(
  characters: Array<{
    name: string;
    visualTraits?: Record<string, any>;
    referenceImages?: string[];
    personalityTraits?: string[];
  }>
): Record<string, any> {
  const map: Record<string, any> = {};
  for (const char of characters) {
    map[char.name] = {
      visualTraits: char.visualTraits || {},
      referenceImages: char.referenceImages || [],
      personalityTraits: char.personalityTraits || [],
    };
  }
  return map;
}
