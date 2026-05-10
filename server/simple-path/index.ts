/**
 * Simple Path Pipeline — Wave 9 Architecture
 * 
 * 5-stage pipeline for manga-to-anime video generation:
 * Stage 1: LLM Beat Segmentation
 * Stage 2: Character Reference Generation
 * Stage 3: PixVerse C1 Video Generation + CLIP Harness
 * Stage 4: Voice Generation (ElevenLabs) + Lip-Sync (PixVerse/Kling)
 * Stage 5: Audio Mastering + Assembly
 */

// Core types
export type {
  Beat,
  CharacterReference,
  BeatSegmentationOutput,
  VideoGenerationResult,
  VoiceGenerationResult,
  LipSyncResult,
  AssemblyResult,
  SimplePathPipelineState,
  ClipHarnessConfig,
} from "./types";

// Orchestrator
export { runSimplePath, type SimplePathConfig } from "./orchestrator";

// Individual stages (for testing/debugging)
export { runBeatSegmentation } from "./stages/stage1-beat-segmentation";
export { buildCharacterRefs, FIRST_LIGHT_CHARACTERS } from "./stages/stage2-character-refs";
export { generateC1Video, runStage3ForBeat, runStage3Batch, scoreWithClip } from "./stages/stage3-video-gen";
export { generateVoice, applyLipSync, runStage4, FIRST_LIGHT_VOICE_ASSIGNMENTS } from "./stages/stage4-voice-lipsync";
export { runStage5 } from "./stages/stage5-assembly";

// Provider router
export { getActiveConfig, DEFAULT_PROVIDER_CONFIG, DIRECT_PIXVERSE_CONFIG } from "./provider-router";

// Templates
export { applyDarkCharLighting, getStyleAnchor, getMoodLighting, getNegativePrompt } from "./templates/prompt-templates";

// Fixtures
export { buildFirstLightConfig, FIRST_LIGHT_SCRIPT } from "./fixtures/first-light";
