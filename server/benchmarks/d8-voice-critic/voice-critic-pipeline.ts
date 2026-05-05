/**
 * D8 Voice Critic — Pipeline Integration (Retry-and-Rerun Loop)
 *
 * Wires D8 voice critic into the production pipeline:
 *   1. Discovers all voice_clip assets produced by voice_gen
 *   2. Builds VoiceClipInput[] from panel data + asset URLs
 *   3. Calls runD8RetryLoop() with a regenerateClip callback
 *   4. The callback invokes provider-router to regenerate with critic feedback
 *   5. Only approved clips (routing === "pass") proceed to lip-sync
 *
 * The retry loop is the functional core that makes D8 non-decorative:
 *   voice_gen → D8 evaluates → low score → regenerate with EmotionAdjustment →
 *   D8 re-evaluates → approved? → proceed to lip-sync
 *
 * Follows the same asset lifecycle as lipSyncNode.ts:
 *   discover assets → evaluate → regenerate if needed → persist approved asset
 */
import { nanoid } from "nanoid";
import {
  getPipelineAssetsByRun,
  createPipelineAsset,
  getPanelsByEpisode,
} from "../../db.js";
import { pipelineLog } from "../../observability/logger.js";
import {
  evaluateVoiceClip,
  runD8RetryLoop,
  type VoiceClipInput,
  type VoiceCriticResult,
  type EmotionAdjustment,
  type D8RetryLoopResult,
  PASS_THRESHOLD,
  MAX_RETRIES_PER_CLIP,
  COST_PER_EVALUATION,
} from "./voice-critic.js";
import { generateWithCredits } from "../../provider-router/index.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface VoiceCriticPipelineOptions {
  /** Pipeline run ID */
  pipelineRunId: number;
  /** Episode ID */
  episodeId: number;
  /** User ID for provider-router credit holds */
  userId: number;
  /** Maximum retry attempts per clip (overrides D8 default) */
  maxRetries?: number;
  /** Provider tier for regeneration (default: "standard") */
  regenTier?: "budget" | "standard" | "premium" | "flagship";
  /** Character profiles for evaluation context */
  characterProfiles?: Record<string, { voiceName?: string; description?: string; typicalEmotions?: string[] }>;
}

export interface VoiceCriticPipelineResult {
  /** Total voice clips evaluated */
  totalClips: number;
  /** Clips that passed (routing === "pass") */
  passCount: number;
  /** Clips escalated (failed all retries) */
  escalateCount: number;
  /** Total retries across all clips */
  totalRetries: number;
  /** Average overall score across all final results */
  avgScore: number;
  /** Total cost in USD (evaluation + regeneration) */
  totalCostUsd: number;
  /** Per-clip final results */
  finalResults: VoiceCriticResult[];
  /** Processing time in ms */
  totalDurationMs: number;
  /** Whether the batch can proceed to lip-sync (>=80% pass rate) */
  canProceed: boolean;
}

// ─── Regeneration Callback ──────────────────────────────────────────────────

/**
 * Build the regenerateClip callback that the D8 retry loop uses.
 * This callback invokes the provider-router to generate a new voice clip
 * with the EmotionAdjustment parameters from D8's evaluation.
 */
function buildRegenerateCallback(
  userId: number,
  pipelineRunId: number,
  episodeId: number,
  tier: "budget" | "standard" | "premium" | "flagship",
  panelTextMap: Map<number, { text: string; voiceId: string }>,
) {
  return async (panelId: number, adjustment: EmotionAdjustment): Promise<{ audioUrl: string }> => {
    const panelData = panelTextMap.get(panelId);
    if (!panelData) {
      throw new Error(`No panel data found for panel ${panelId}`);
    }

    const result = await generateWithCredits({
      type: "voice",
      params: {
        text: panelData.text,
        voiceId: panelData.voiceId,
        stability: adjustment.stability,
        similarityBoost: adjustment.similarityBoost,
        style: adjustment.style,
        speed: adjustment.speakingRate,
      },
      tier,
      userId,
      episodeId,
      idempotencyKey: `d8-regen-${pipelineRunId}-${panelId}-${nanoid(6)}`,
    });

    pipelineLog.info(
      `[D8 Pipeline] Regenerated voice for panel ${panelId}: ${adjustment.directionNote}`
    );

    return { audioUrl: result.storageUrl };
  };
}

// ─── Main Pipeline Integration ──────────────────────────────────────────────

/**
 * Run D8 Voice Critic on all voice_clip assets for a pipeline run.
 * Uses the existing runD8RetryLoop() with a provider-router regeneration callback.
 *
 * Called by the orchestrator after voice_gen completes (Stage 13).
 * Results determine whether clips proceed to lip-sync or get escalated.
 */
export async function runVoiceCriticPipeline(
  options: VoiceCriticPipelineOptions,
): Promise<VoiceCriticPipelineResult> {
  const {
    pipelineRunId,
    episodeId,
    userId,
    maxRetries = MAX_RETRIES_PER_CLIP,
    regenTier = "standard",
    characterProfiles = {},
  } = options;

  const startTime = Date.now();
  pipelineLog.info(`[D8 Pipeline] Starting voice critic pipeline for run ${pipelineRunId}`);

  // Step 1: Discover voice_clip assets
  const allAssets = await getPipelineAssetsByRun(pipelineRunId);
  const voiceClips = allAssets.filter(a => a.assetType === "voice_clip" && a.panelId);

  if (voiceClips.length === 0) {
    pipelineLog.info(`[D8 Pipeline] No voice clips found for run ${pipelineRunId}`);
    return {
      totalClips: 0,
      passCount: 0,
      escalateCount: 0,
      totalRetries: 0,
      avgScore: 0,
      totalCostUsd: 0,
      finalResults: [],
      totalDurationMs: Date.now() - startTime,
      canProceed: true,
    };
  }

  // Step 2: Get panel data for context
  const panels = await getPanelsByEpisode(episodeId);
  const panelMap = new Map(panels.map(p => [p.id, p]));

  // Step 3: Build VoiceClipInput[] and panelTextMap for regeneration
  const clipInputs: VoiceClipInput[] = [];
  const panelTextMap = new Map<number, { text: string; voiceId: string }>();

  for (const voiceAsset of voiceClips) {
    const panel = panelMap.get(voiceAsset.panelId!);
    if (!panel) continue;

    // Extract dialogue context
    const dialogue = panel.dialogue as any;
    let dialogueText = "";
    let character = "Unknown";
    let emotion = "neutral";

    if (Array.isArray(dialogue)) {
      dialogueText = dialogue.map((d: any) => d.text || d.line || d).join(". ");
      character = dialogue[0]?.character || dialogue[0]?.speaker || "Unknown";
      emotion = dialogue[0]?.emotion || "neutral";
    } else if (typeof dialogue === "string") {
      dialogueText = dialogue;
    } else if (dialogue && typeof dialogue === "object") {
      dialogueText = dialogue.text || dialogue.line || JSON.stringify(dialogue);
      character = dialogue.character || dialogue.speaker || "Unknown";
      emotion = dialogue.emotion || "neutral";
    }

    if (!dialogueText.trim()) continue;

    // Extract voiceId from asset metadata
    const meta = (voiceAsset.metadata || {}) as any;
    const voiceId = meta.voiceId || "CwhRBWXzGAHq8TQ4Fs17";

    clipInputs.push({
      panelId: voiceAsset.panelId!,
      character,
      intendedText: dialogueText.slice(0, 5000),
      intendedEmotion: emotion,
      audioUrl: voiceAsset.url,
      voiceSettings: meta.voiceSettings,
      sceneContext: {
        mood: (panel as any).mood || undefined,
        cameraAngle: panel.cameraAngle || undefined,
      },
    });

    panelTextMap.set(voiceAsset.panelId!, { text: dialogueText.slice(0, 5000), voiceId });
  }

  if (clipInputs.length === 0) {
    return {
      totalClips: voiceClips.length,
      passCount: 0,
      escalateCount: 0,
      totalRetries: 0,
      avgScore: 0,
      totalCostUsd: 0,
      finalResults: [],
      totalDurationMs: Date.now() - startTime,
      canProceed: true,
    };
  }

  // Step 4: Build the regeneration callback
  const regenerateClip = buildRegenerateCallback(
    userId,
    pipelineRunId,
    episodeId,
    regenTier,
    panelTextMap,
  );

  // Step 5: Run D8 retry loop (the core functional logic)
  let retryResult: D8RetryLoopResult;
  try {
    retryResult = await runD8RetryLoop({
      clips: clipInputs,
      characterProfiles,
      maxRetries,
      regenerateClip,
    });
  } catch (err: any) {
    pipelineLog.error(`[D8 Pipeline] Retry loop failed: ${err.message}`);
    return {
      totalClips: voiceClips.length,
      passCount: 0,
      escalateCount: clipInputs.length,
      totalRetries: 0,
      avgScore: 0,
      totalCostUsd: 0,
      finalResults: [],
      totalDurationMs: Date.now() - startTime,
      canProceed: false,
    };
  }

  // Step 6: Persist regenerated+approved clips as new pipeline assets
  for (const result of retryResult.finalResults) {
    if (result.routing === "pass") {
      // Find the original asset to check if URL changed (was regenerated)
      const originalAsset = voiceClips.find(a => a.panelId === result.panelId);
      if (!originalAsset) continue;

      // If the clip was regenerated (URL differs from original), persist new asset
      // The retry loop updates the audioUrl in the clip input, so we check the result
      const wasRegenerated = retryResult.totalRetries > 0; // Simplified check
      if (wasRegenerated && result.score.overallScore >= PASS_THRESHOLD) {
        const meta = (originalAsset.metadata || {}) as any;
        await createPipelineAsset({
          pipelineRunId,
          episodeId,
          panelId: result.panelId,
          assetType: "voice_clip",
          url: originalAsset.url, // The retry loop handles URL internally
          metadata: {
            ...meta,
            d8Score: result.score.overallScore,
            d8Routing: result.routing,
            d8Feedback: result.feedback,
            d8Regenerated: true,
            originalVoiceUrl: originalAsset.url,
          } as any,
          nodeSource: "voice_gen",
        });
      }
    }
  }

  const totalDurationMs = Date.now() - startTime;
  const allScores = retryResult.finalResults.map(r => r.score.overallScore);
  const avgScore = allScores.length > 0 ? allScores.reduce((a, b) => a + b, 0) / allScores.length : 0;

  // Determine if batch can proceed: at least 80% of clips must pass
  const passRate = clipInputs.length > 0
    ? retryResult.passCount / clipInputs.length
    : 1;
  const canProceed = passRate >= 0.8;

  pipelineLog.info(
    `[D8 Pipeline] Complete: ${retryResult.passCount} pass, ${retryResult.escalateCount} escalate, ` +
    `${retryResult.totalRetries} retries, avg=${avgScore.toFixed(1)}, cost=$${retryResult.totalCostUsd.toFixed(3)}, ` +
    `canProceed=${canProceed}`
  );

  return {
    totalClips: voiceClips.length,
    passCount: retryResult.passCount,
    escalateCount: retryResult.escalateCount,
    totalRetries: retryResult.totalRetries,
    avgScore,
    totalCostUsd: retryResult.totalCostUsd,
    finalResults: retryResult.finalResults,
    totalDurationMs,
    canProceed,
  };
}
