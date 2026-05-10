/**
 * Simple Path Orchestrator
 * 
 * Wires all 5 stages into a single pipeline run:
 * Stage 1: LLM Beat Segmentation
 * Stage 2: Character Reference Generation
 * Stage 3: PixVerse C1 Video Generation + CLIP Harness
 * Stage 4: Voice Generation + Lip-Sync
 * Stage 5: Audio Mastering + Assembly
 */

import type {
  SimplePathPipelineState,
  SimplePathStage,
  BeatSegmentationOutput,
  CharacterReference,
  VideoGenerationResult,
  ClipHarnessConfig,
  ProviderConfig,
  DEFAULT_PROVIDER_CONFIG,
  DEFAULT_CLIP_CONFIG,
} from "./types";
import { runBeatSegmentation, type BeatSegmentationInput } from "./stages/stage1-beat-segmentation";
import { buildCharacterRefs, type BuildRefsInput } from "./stages/stage2-character-refs";
import { runStage3Batch, type Stage3BatchInput } from "./stages/stage3-video-gen";
import { runStage4, type Stage4Input, type VoiceAssignment } from "./stages/stage4-voice-lipsync";
import { runStage5, type Stage5Input } from "./stages/stage5-assembly";

// ═══════════════════════════════════════════════════════════════════════════
// Pipeline Configuration
// ═══════════════════════════════════════════════════════════════════════════

export interface SimplePathConfig {
  /** Pipeline run ID (from database) */
  pipelineRunId: number;
  /** Episode ID */
  episodeId: number;
  /** Project ID */
  projectId: number;
  /** User ID */
  userId: number;
  /** Episode script (structured JSON or plain text) */
  script: string;
  /** Episode title */
  episodeTitle: string;
  /** Character references with uploaded image URLs */
  characters: Array<{
    name: string;
    referenceImageUrl: string;
    descriptor: string;
    visualTraits: {
      hair: string;
      eyes: string;
      clothing: string;
      distinguishingFeatures: string[];
    };
    isDarkCharacter: boolean;
  }>;
  /** Voice assignments per character */
  voiceAssignments: VoiceAssignment[];
  /** CLIP harness configuration */
  clipConfig?: ClipHarnessConfig;
  /** Video resolution */
  resolution?: string;
  /** Max concurrent video generations */
  concurrency?: number;
  /** Background music URL (optional) */
  musicUrl?: string;
  /** Target total duration in seconds */
  targetDurationSeconds?: number;
  /** Genre for style context */
  genre?: string;
  /** S3 output prefix */
  outputKeyPrefix?: string;
  /** Progress callback */
  onStageProgress?: (stage: SimplePathStage, progress: number, message: string) => void;
}

// ═══════════════════════════════════════════════════════════════════════════
// Orchestrator
// ═══════════════════════════════════════════════════════════════════════════

export async function runSimplePath(config: SimplePathConfig): Promise<SimplePathPipelineState> {
  const state: SimplePathPipelineState = {
    pipelineRunId: config.pipelineRunId,
    episodeId: config.episodeId,
    projectId: config.projectId,
    userId: config.userId,
    currentStage: 1,
    stageStatuses: { 1: "pending", 2: "pending", 3: "pending", 4: "pending", 5: "pending" },
    costs: { stage1: 0, stage2: 0, stage3: 0, stage4: 0, stage5: 0, total: 0 },
    startedAt: new Date().toISOString(),
    errors: [],
  };

  const clipConfig: ClipHarnessConfig = config.clipConfig || {
    wholeFrameThreshold: 0.70,
    characterRegionThreshold: 0.80,
    maxRegenerationAttempts: 3,
    useCharacterRegionCropping: false, // Start with whole-frame, calibrate later
  };

  const outputPrefix = config.outputKeyPrefix || `pipeline/${config.pipelineRunId}`;

  try {
    // ─── Stage 1: Beat Segmentation ──────────────────────────────────────
    state.currentStage = 1;
    state.stageStatuses[1] = "running";
    config.onStageProgress?.(1, 0, "Segmenting script into beats...");

    const beatOutput = await runBeatSegmentation({
      script: config.script,
      episodeTitle: config.episodeTitle,
      characterNames: config.characters.map((c) => c.name),
      targetDurationSeconds: config.targetDurationSeconds,
      genre: config.genre,
    });

    state.stage1Output = beatOutput;
    state.stageStatuses[1] = "completed";
    state.costs.stage1 = 0.01; // LLM cost ~$0.01
    config.onStageProgress?.(1, 100, `Generated ${beatOutput.totalBeats} beats (${beatOutput.estimatedDurationSeconds}s total)`);

    // ─── Stage 2: Character References ───────────────────────────────────
    state.currentStage = 2;
    state.stageStatuses[2] = "running";
    config.onStageProgress?.(2, 0, "Building character references...");

    const characterRefs = await buildCharacterRefs({
      characters: config.characters,
    });

    // Enrich beat output with dark-character lighting
    for (const beat of beatOutput.beats) {
      const darkChars = characterRefs.filter(
        (c) => c.isDarkCharacter && beat.characters.includes(c.name)
      );
      if (darkChars.length > 0 && !beat.darkCharLightingOverride) {
        const char = darkChars[0];
        const feature = char.visualTraits.distinguishingFeatures[0] || "distinctive features";
        beat.darkCharLightingOverride = `warm rim-light catching ${char.name}'s silhouette, ${feature} clearly visible,`;
      }
    }

    state.stage2Output = characterRefs;
    state.stageStatuses[2] = "completed";
    state.costs.stage2 = 0; // No cost for existing refs
    config.onStageProgress?.(2, 100, `${characterRefs.length} character references ready`);

    // ─── Stage 3: Video Generation + CLIP ────────────────────────────────
    state.currentStage = 3;
    state.stageStatuses[3] = "running";
    config.onStageProgress?.(3, 0, `Generating ${beatOutput.totalBeats} video clips via PixVerse C1...`);

    const videoResults = await runStage3Batch({
      beats: beatOutput.beats,
      characters: characterRefs,
      clipConfig,
      resolution: config.resolution,
      concurrency: config.concurrency || 4,
      onProgress: (completed, total, result) => {
        const pct = Math.round((completed / total) * 100);
        config.onStageProgress?.(3, pct, `Video ${completed}/${total} (CLIP: ${result.clipPassed ? "PASS" : "FAIL"})`);
      },
    });

    state.stage3Output = videoResults;
    state.costs.stage3 = videoResults.reduce((sum, r) => sum + r.costUsd, 0);
    state.stageStatuses[3] = "completed";

    const passedCount = videoResults.filter((r) => r.clipPassed).length;
    const successfulClips = videoResults.filter((r) => r.videoUrl && r.videoUrl.length > 0);
    if (successfulClips.length === 0) {
      throw new Error(`Stage 3 produced zero video assets (${videoResults.length} beats attempted, all failed). Pipeline cannot continue — no slideshow fallback allowed.`);
    }
    config.onStageProgress?.(3, 100, `${passedCount}/${videoResults.length} clips passed CLIP check (${successfulClips.length} usable). Cost: $${state.costs.stage3.toFixed(2)}`);

    // ─── Stage 4: Voice + Lip-Sync ──────────────────────────────────────
    state.currentStage = 4;
    state.stageStatuses[4] = "running";
    config.onStageProgress?.(4, 0, "Generating voice and applying lip-sync...");

    // Build video URL map (beatId → URL)
    const videoUrls: Record<string, string> = {};
    for (const result of videoResults) {
      if (result.videoUrl) videoUrls[result.beatId] = result.videoUrl;
    }

    const stage4Output = await runStage4({
      beats: beatOutput.beats,
      videoUrls,
      voiceAssignments: config.voiceAssignments,
      onProgress: (completed, total) => {
        config.onStageProgress?.(4, Math.round((completed / total) * 100), `Voice/lip-sync ${completed}/${total}`);
      },
    });

    state.stage4Output = stage4Output;
    state.costs.stage4 = stage4Output.totalCostUsd;
    state.stageStatuses[4] = "completed";
    config.onStageProgress?.(4, 100, `${stage4Output.voices.length} voice clips, ${stage4Output.lipSync.length} lip-synced. Cost: $${state.costs.stage4.toFixed(2)}`);

    // ─── Stage 5: Assembly ───────────────────────────────────────────────
    state.currentStage = 5;
    state.stageStatuses[5] = "running";
    config.onStageProgress?.(5, 0, "Assembling final video...");

    // Use lip-synced URLs where available, fall back to raw video
    const finalVideoUrls: Record<string, string> = { ...videoUrls };
    for (const ls of stage4Output.lipSync) {
      if (ls.lipSyncedVideoUrl) finalVideoUrls[ls.beatId] = ls.lipSyncedVideoUrl;
    }

    const assemblyResult = await runStage5({
      pipelineRunId: config.pipelineRunId,
      beats: beatOutput.beats,
      videoUrls: finalVideoUrls,
      voices: stage4Output.voices,
      lipSync: stage4Output.lipSync,
      musicUrl: config.musicUrl,
      outputKeyPrefix: outputPrefix,
    });

    state.stage5Output = assemblyResult;
    state.costs.stage5 = 0.01; // Assembly is compute-only
    state.stageStatuses[5] = "completed";

    // ─── Final ───────────────────────────────────────────────────────────
    state.costs.total = Object.values(state.costs).reduce((a, b) => a + b, 0) - state.costs.total;
    state.completedAt = new Date().toISOString();

    config.onStageProgress?.(5, 100, `Assembly complete! Duration: ${assemblyResult.totalDurationSeconds.toFixed(1)}s, Size: ${(assemblyResult.fileSizeBytes / 1024 / 1024).toFixed(1)}MB, Total cost: $${state.costs.total.toFixed(2)}`);

    return state;
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    state.errors.push({
      stage: state.currentStage,
      message: error.message,
      timestamp: new Date().toISOString(),
    });
    state.stageStatuses[state.currentStage] = "failed";
    throw error;
  }
}
