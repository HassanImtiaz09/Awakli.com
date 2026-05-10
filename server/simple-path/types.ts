/**
 * Wave 9 Simple Path Architecture — Core Types
 * 
 * 5-stage pipeline: Beat Segmentation → Character Ref Gen → C1 Video Gen → Voice + Lip-Sync → Assembly
 */

// ═══════════════════════════════════════════════════════════════════════════
// Stage 1: Beat Segmentation Output
// ═══════════════════════════════════════════════════════════════════════════

export interface DialogueLine {
  characterName: string;
  text: string;
  emotion: string;
  /** Estimated duration in seconds for this line */
  estimatedDurationSeconds: number;
}

export interface Beat {
  id: string;
  sceneNumber: number;
  beatNumber: number;
  /** Full visual description for video generation prompt */
  description: string;
  /** Characters present in this beat (must match character ref names) */
  characters: string[];
  /** Camera angle/movement instruction */
  cameraAngle: string;
  /** Lighting direction — critical for dark-character visibility */
  lighting: string;
  /** Emotional mood of the beat */
  mood: string;
  /** Target duration in seconds (3-15s, per C1 limits) */
  durationTargetSeconds: number;
  /** Dialogue lines to be spoken during this beat */
  dialogue: DialogueLine[];
  /** Sound effects */
  sfx: Array<{ type: string; timestampOffsetMs: number; volume: number }>;
  /** Transition to next beat */
  transition: "cut" | "crossfade" | "fade_to_black" | "wipe";
  /** Style anchor for consistent visual language */
  styleAnchor: string;
  /** Dark-character lighting override (auto-applied when dark chars on dark bg) */
  darkCharLightingOverride?: string;
}

export interface BeatSegmentationOutput {
  episodeTitle: string;
  totalBeats: number;
  estimatedDurationSeconds: number;
  beats: Beat[];
  /** Metadata for the LLM generation */
  generationMetadata: {
    model: string;
    tokensUsed: number;
    generatedAt: string;
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Stage 2: Character Reference
// ═══════════════════════════════════════════════════════════════════════════

export interface CharacterReference {
  /** Character name (used as @ref_name in prompts) */
  name: string;
  /** Full reference image URL (for Subject Reference) */
  referenceImageUrl: string;
  /** Cropped face/character region for CLIP comparison */
  croppedRegionUrl: string;
  /** Text descriptor for prompt enrichment */
  descriptor: string;
  /** Visual traits for prompt building */
  visualTraits: {
    hair: string;
    eyes: string;
    clothing: string;
    distinguishingFeatures: string[];
  };
  /** Whether this character needs dark-character lighting mitigation */
  isDarkCharacter: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// Stage 3: Video Generation
// ═══════════════════════════════════════════════════════════════════════════

export interface VideoGenerationResult {
  beatId: string;
  videoUrl: string;
  durationSeconds: number;
  fileSizeBytes: number;
  /** CLIP scores per character in this beat */
  clipScores: Record<string, {
    wholeFrame: number;
    characterRegion: number;
  }>;
  /** Whether CLIP check passed */
  clipPassed: boolean;
  /** Number of generation attempts */
  attempts: number;
  /** Cost in USD */
  costUsd: number;
  /** Generation time in seconds */
  generationTimeSeconds: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// Stage 4: Voice + Lip-Sync
// ═══════════════════════════════════════════════════════════════════════════

export interface VoiceGenerationResult {
  beatId: string;
  dialogueIndex: number;
  characterName: string;
  audioUrl: string;
  durationSeconds: number;
  /** Provider used (elevenlabs, cartesia, inworld) */
  provider: string;
  voiceId: string;
}

export interface LipSyncResult {
  beatId: string;
  /** Original video URL (pre lip-sync) */
  originalVideoUrl: string;
  /** Lip-synced video URL */
  lipSyncedVideoUrl: string;
  /** Provider used (pixverse, kling) */
  provider: string;
  durationSeconds: number;
  costUsd: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// Stage 5: Assembly
// ═══════════════════════════════════════════════════════════════════════════

export interface AssemblyResult {
  finalVideoUrl: string;
  totalDurationSeconds: number;
  fileSizeBytes: number;
  audioLevels: {
    voiceLufs: number;
    musicLufs: number;
    sfxLufs: number;
    masterLufs: number;
  };
  /** Per-beat timing in the final video */
  beatTimeline: Array<{
    beatId: string;
    startSeconds: number;
    endSeconds: number;
  }>;
}

// ═══════════════════════════════════════════════════════════════════════════
// Pipeline Run (Simple Path)
// ═══════════════════════════════════════════════════════════════════════════

export type SimplePathStage = 1 | 2 | 3 | 4 | 5;
export type SimplePathStageStatus = "pending" | "running" | "completed" | "failed" | "awaiting_approval";

export interface SimplePathPipelineState {
  pipelineRunId: number;
  episodeId: number;
  projectId: number;
  userId: number;
  /** Current stage (1-5) */
  currentStage: SimplePathStage;
  /** Per-stage status */
  stageStatuses: Record<SimplePathStage, SimplePathStageStatus>;
  /** Stage outputs */
  stage1Output?: BeatSegmentationOutput;
  stage2Output?: CharacterReference[];
  stage3Output?: VideoGenerationResult[];
  stage4Output?: { voices: VoiceGenerationResult[]; lipSync: LipSyncResult[] };
  stage5Output?: AssemblyResult;
  /** Cost tracking */
  costs: {
    stage1: number;
    stage2: number;
    stage3: number;
    stage4: number;
    stage5: number;
    total: number;
  };
  /** Timing */
  startedAt: string;
  completedAt?: string;
  /** Errors */
  errors: Array<{ stage: SimplePathStage; message: string; timestamp: string }>;
}

// ═══════════════════════════════════════════════════════════════════════════
// Provider Configuration
// ═══════════════════════════════════════════════════════════════════════════

export type VideoProvider = "fal_pixverse_c1" | "direct_pixverse" | "fal_kling_v3";
export type LipSyncProvider = "fal_pixverse_lipsync" | "kling_lipsync";
export type VoiceProvider = "elevenlabs" | "cartesia" | "inworld";
export type MusicProvider = "minimax" | "suno";

export interface ProviderConfig {
  video: {
    primary: VideoProvider;
    fallback: VideoProvider;
  };
  lipSync: {
    primary: LipSyncProvider;
    fallback: LipSyncProvider;
  };
  voice: {
    primary: VoiceProvider;
    fallback: VoiceProvider;
  };
  music: {
    primary: MusicProvider;
    fallback: MusicProvider;
  };
}

/** Default provider configuration for Wave 9 */
export const DEFAULT_PROVIDER_CONFIG: ProviderConfig = {
  video: {
    primary: "fal_pixverse_c1",
    fallback: "fal_kling_v3",
  },
  lipSync: {
    primary: "fal_pixverse_lipsync",
    fallback: "kling_lipsync",
  },
  voice: {
    primary: "elevenlabs",
    fallback: "cartesia",
  },
  music: {
    primary: "minimax",
    fallback: "suno",
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// CLIP Harness Configuration
// ═══════════════════════════════════════════════════════════════════════════

export interface ClipHarnessConfig {
  /** Whole-frame threshold (used for initial validation) */
  wholeFrameThreshold: number;
  /** Character-region threshold (production target) */
  characterRegionThreshold: number;
  /** Max regeneration attempts on CLIP failure */
  maxRegenerationAttempts: number;
  /** Whether to use character-region cropping (requires face detection) */
  useCharacterRegionCropping: boolean;
}

export const DEFAULT_CLIP_CONFIG: ClipHarnessConfig = {
  wholeFrameThreshold: 0.70,
  characterRegionThreshold: 0.80,
  maxRegenerationAttempts: 3,
  useCharacterRegionCropping: true,
};

// ═══════════════════════════════════════════════════════════════════════════
// Dark-Character Lighting Patterns
// ═══════════════════════════════════════════════════════════════════════════

export interface DarkCharLightingPattern {
  /** Pattern name for reference */
  name: string;
  /** Prompt prefix to prepend when dark character on dark background */
  promptPrefix: string;
  /** Background types that trigger this pattern */
  triggerBackgrounds: string[];
}

export const DARK_CHARACTER_LIGHTING_PATTERNS: DarkCharLightingPattern[] = [
  {
    name: "rim_light",
    promptPrefix: "warm rim-light catching {character}'s silhouette, {signature_feature} clearly visible against the {background} background,",
    triggerBackgrounds: ["sunset", "night", "dark", "shadow", "cave", "underground"],
  },
  {
    name: "fire_light",
    promptPrefix: "flickering firelight illuminating {character}'s face from below, {signature_feature} highlighted by warm orange glow,",
    triggerBackgrounds: ["campfire", "torch", "explosion", "lava"],
  },
  {
    name: "moonlight",
    promptPrefix: "cool moonlight casting silver highlights on {character}, {signature_feature} visible in the pale blue illumination,",
    triggerBackgrounds: ["night", "rooftop", "forest_night", "ocean_night"],
  },
  {
    name: "energy_glow",
    promptPrefix: "supernatural energy emanating from {character}, {signature_feature} backlit by intense {glow_color} aura,",
    triggerBackgrounds: ["battle", "power_up", "transformation", "arena"],
  },
];
