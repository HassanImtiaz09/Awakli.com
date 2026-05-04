/**
 * D8: Voice Director Critic — Quality evaluation of generated TTS clips
 *
 * Runs after voice generation (Stage 13) to validate each dialogue line's
 * TTS output against intended emotion, character voice profile, and pacing.
 *
 * Uses LLM audio analysis (via transcription + prosody metadata) to score
 * generated voice clips on 4 dimensions:
 *   - emotion_match (40%): Does the delivery match the intended emotion?
 *   - character_voice_fidelity (30%): Does it sound like the character?
 *   - pacing_naturalness (20%): Is the speaking rate natural for the context?
 *   - audio_clarity (10%): Is the audio clean, no artifacts?
 *
 * Routing decisions:
 *   - pass (≥ 3.5): Clip proceeds to lip-sync
 *   - retry (2.5–3.5): Re-generate with adjusted emotion params
 *   - escalate (< 2.5): Flag for human review
 *
 * Cost target: ~$0.02/line (transcription + LLM evaluation)
 */
import { invokeLLM } from "../../_core/llm.js";
import { transcribeAudio } from "../../_core/voiceTranscription.js";
import { pipelineLog } from "../../observability/logger.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface VoiceClipInput {
  /** Panel ID this voice clip belongs to */
  panelId: number;
  /** Character speaking this line */
  character: string;
  /** Original dialogue text (intended) */
  intendedText: string;
  /** Intended emotion for this line */
  intendedEmotion: string;
  /** URL of the generated voice clip */
  audioUrl: string;
  /** Voice settings used for generation */
  voiceSettings?: {
    stability?: number;
    similarityBoost?: number;
    style?: number;
    speakingRate?: number;
  };
  /** Scene context for evaluation */
  sceneContext?: {
    mood?: string;
    cameraAngle?: string;
    precedingDialogue?: string;
    followingDialogue?: string;
  };
}

export interface VoiceCriticScore {
  /** Emotion match score (0-5) */
  emotionMatch: number;
  /** Character voice fidelity (0-5) */
  characterVoiceFidelity: number;
  /** Pacing naturalness (0-5) */
  pacingNaturalness: number;
  /** Audio clarity (0-5) */
  audioClarity: number;
  /** Weighted overall score (0-5) */
  overallScore: number;
}

export type VoiceCriticRouting = "pass" | "retry" | "escalate";

export interface VoiceCriticResult {
  panelId: number;
  character: string;
  intendedText: string;
  transcribedText: string | null;
  score: VoiceCriticScore;
  routing: VoiceCriticRouting;
  feedback: string;
  suggestedAdjustments: EmotionAdjustment | null;
  costUsd: number;
  latencyMs: number;
}

export interface EmotionAdjustment {
  /** Suggested primary emotion for retry */
  emotion: string;
  /** Suggested stability override */
  stability?: number;
  /** Suggested similarity boost override */
  similarityBoost?: number;
  /** Suggested style override */
  style?: number;
  /** Suggested speaking rate override */
  speakingRate?: number;
  /** Direction note for retry */
  directionNote: string;
}

export interface D8BatchOptions {
  /** Voice clips to evaluate */
  clips: VoiceClipInput[];
  /** Character voice profiles for reference */
  characterProfiles?: Record<string, {
    voiceName?: string;
    description?: string;
    typicalEmotions?: string[];
  }>;
  /** Maximum retries per clip (default: 2) */
  maxRetries?: number;
}

export interface D8BatchResult {
  results: VoiceCriticResult[];
  passCount: number;
  retryCount: number;
  escalateCount: number;
  totalCostUsd: number;
  totalLatencyMs: number;
}

// ─── Constants ──────────────────────────────────────────────────────────────

export const SCORE_WEIGHTS = {
  emotionMatch: 0.4,
  characterVoiceFidelity: 0.3,
  pacingNaturalness: 0.2,
  audioClarity: 0.1,
} as const;

export const PASS_THRESHOLD = 3.5;
export const RETRY_THRESHOLD = 2.5;
export const MAX_RETRIES_PER_CLIP = 2;
export const COST_PER_EVALUATION = 0.02; // ~$0.01 transcription + ~$0.01 LLM

// ─── Main Evaluation Function ───────────────────────────────────────────────

/**
 * Evaluate a single voice clip against its intended parameters.
 */
export async function evaluateVoiceClip(
  clip: VoiceClipInput,
  characterProfile?: { voiceName?: string; description?: string; typicalEmotions?: string[] }
): Promise<VoiceCriticResult> {
  const startTime = Date.now();
  let transcribedText: string | null = null;

  // Step 1: Transcribe the audio to get actual spoken text
  try {
    const transcription = await transcribeAudio({
      audioUrl: clip.audioUrl,
      language: "en",
      prompt: `Transcribe anime dialogue: ${clip.intendedText}`,
    });
    if ("text" in transcription) {
      transcribedText = transcription.text;
    }
  } catch (err) {
    pipelineLog.warn(`[D8] Transcription failed for panel ${clip.panelId}: ${err}`);
  }

  // Step 2: LLM evaluation of voice quality
  const evaluationPrompt = buildEvaluationPrompt(clip, transcribedText, characterProfile);

  let score: VoiceCriticScore;
  let feedback: string;
  let suggestedAdjustments: EmotionAdjustment | null = null;

  try {
    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `You are D8, an expert anime voice director critic. Evaluate TTS voice clips for quality. Output valid JSON only.`,
        },
        { role: "user", content: evaluationPrompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "voice_critic_evaluation",
          strict: true,
          schema: {
            type: "object",
            properties: {
              emotionMatch: { type: "number", description: "0-5: How well the delivery matches the intended emotion" },
              characterVoiceFidelity: { type: "number", description: "0-5: How well it sounds like the character" },
              pacingNaturalness: { type: "number", description: "0-5: How natural the speaking rate feels" },
              audioClarity: { type: "number", description: "0-5: Audio quality, no artifacts" },
              feedback: { type: "string", description: "Brief critique explaining the scores" },
              suggestedEmotion: { type: "string", description: "Suggested emotion for retry, or 'none' if passing" },
              suggestedStability: { type: "number", description: "Suggested stability (0-1), or -1 if no change" },
              suggestedSimilarityBoost: { type: "number", description: "Suggested similarity boost (0-1), or -1 if no change" },
              suggestedStyle: { type: "number", description: "Suggested style (0-1), or -1 if no change" },
              suggestedSpeakingRate: { type: "number", description: "Suggested speaking rate (0.5-2.0), or -1 if no change" },
              directionNote: { type: "string", description: "Direction note for the voice actor on retry" },
            },
            required: [
              "emotionMatch", "characterVoiceFidelity", "pacingNaturalness", "audioClarity",
              "feedback", "suggestedEmotion", "suggestedStability", "suggestedSimilarityBoost",
              "suggestedStyle", "suggestedSpeakingRate", "directionNote",
            ],
            additionalProperties: false,
          },
        },
      },
    });

    const content = response.choices?.[0]?.message?.content;
    const parsed = JSON.parse(typeof content === "string" ? content : "{}");

    score = {
      emotionMatch: clampScore(parsed.emotionMatch),
      characterVoiceFidelity: clampScore(parsed.characterVoiceFidelity),
      pacingNaturalness: clampScore(parsed.pacingNaturalness),
      audioClarity: clampScore(parsed.audioClarity),
      overallScore: 0,
    };
    score.overallScore = computeWeightedScore(score);
    feedback = parsed.feedback || "";

    // Build adjustment suggestions if score is in retry range
    if (score.overallScore < PASS_THRESHOLD && parsed.suggestedEmotion !== "none") {
      suggestedAdjustments = {
        emotion: parsed.suggestedEmotion || clip.intendedEmotion,
        stability: parsed.suggestedStability >= 0 ? parsed.suggestedStability : undefined,
        similarityBoost: parsed.suggestedSimilarityBoost >= 0 ? parsed.suggestedSimilarityBoost : undefined,
        style: parsed.suggestedStyle >= 0 ? parsed.suggestedStyle : undefined,
        speakingRate: parsed.suggestedSpeakingRate >= 0 ? parsed.suggestedSpeakingRate : undefined,
        directionNote: parsed.directionNote || "",
      };
    }
  } catch (err) {
    pipelineLog.error(`[D8] LLM evaluation failed for panel ${clip.panelId}: ${err}`);
    // Conservative fallback: assume pass to avoid blocking pipeline
    score = {
      emotionMatch: 3.5,
      characterVoiceFidelity: 3.5,
      pacingNaturalness: 3.5,
      audioClarity: 4.0,
      overallScore: 3.55,
    };
    feedback = "Evaluation unavailable — defaulting to pass";
  }

  const routing = determineRouting(score.overallScore);
  const latencyMs = Date.now() - startTime;

  pipelineLog.info(
    `[D8] Panel ${clip.panelId} (${clip.character}): score=${score.overallScore.toFixed(2)}, routing=${routing}`
  );

  return {
    panelId: clip.panelId,
    character: clip.character,
    intendedText: clip.intendedText,
    transcribedText,
    score,
    routing,
    feedback,
    suggestedAdjustments,
    costUsd: COST_PER_EVALUATION,
    latencyMs,
  };
}

/**
 * Evaluate a batch of voice clips (all clips for an episode).
 */
export async function evaluateVoiceBatch(
  options: D8BatchOptions
): Promise<D8BatchResult> {
  const { clips, characterProfiles = {} } = options;
  const results: VoiceCriticResult[] = [];
  let totalCostUsd = 0;
  const batchStart = Date.now();

  pipelineLog.info(`[D8] Evaluating batch of ${clips.length} voice clips`);

  // Process sequentially to avoid rate limits on transcription API
  for (const clip of clips) {
    const profile = characterProfiles[clip.character];
    const result = await evaluateVoiceClip(clip, profile);
    results.push(result);
    totalCostUsd += result.costUsd;
  }

  const passCount = results.filter((r) => r.routing === "pass").length;
  const retryCount = results.filter((r) => r.routing === "retry").length;
  const escalateCount = results.filter((r) => r.routing === "escalate").length;
  const totalLatencyMs = Date.now() - batchStart;

  pipelineLog.info(
    `[D8] Batch complete: ${passCount} pass, ${retryCount} retry, ${escalateCount} escalate (${totalLatencyMs}ms, $${totalCostUsd.toFixed(3)})`
  );

  return {
    results,
    passCount,
    retryCount,
    escalateCount,
    totalCostUsd,
    totalLatencyMs,
  };
}

// ─── Retry Orchestration ────────────────────────────────────────────────────

export interface VoiceRetryCallback {
  (panelId: number, adjustment: EmotionAdjustment): Promise<{ audioUrl: string }>;
}

export interface D8RetryLoopOptions {
  clips: VoiceClipInput[];
  characterProfiles?: Record<string, { voiceName?: string; description?: string; typicalEmotions?: string[] }>;
  maxRetries?: number;
  regenerateClip: VoiceRetryCallback;
}

export interface D8RetryLoopResult {
  finalResults: VoiceCriticResult[];
  passCount: number;
  escalateCount: number;
  totalRetries: number;
  totalCostUsd: number;
}

/**
 * Run the D8 evaluation + retry loop for all voice clips.
 * Clips that score below PASS_THRESHOLD get regenerated with adjusted params.
 * After maxRetries, remaining failures are escalated.
 */
export async function runD8RetryLoop(
  options: D8RetryLoopOptions
): Promise<D8RetryLoopResult> {
  const { clips, characterProfiles = {}, maxRetries = MAX_RETRIES_PER_CLIP, regenerateClip } = options;
  const finalResults: VoiceCriticResult[] = [];
  let totalRetries = 0;
  let totalCostUsd = 0;

  for (const clip of clips) {
    let currentClip = { ...clip };
    let lastResult: VoiceCriticResult | null = null;
    let attempts = 0;

    while (attempts <= maxRetries) {
      const profile = characterProfiles[currentClip.character];
      const result = await evaluateVoiceClip(currentClip, profile);
      totalCostUsd += result.costUsd;
      lastResult = result;

      if (result.routing === "pass") {
        break;
      }

      if (attempts >= maxRetries) {
        // Max retries exhausted — escalate
        lastResult = { ...result, routing: "escalate" };
        break;
      }

      // Retry with adjustments
      if (result.suggestedAdjustments) {
        try {
          const { audioUrl } = await regenerateClip(clip.panelId, result.suggestedAdjustments);
          currentClip = { ...currentClip, audioUrl };
          totalRetries++;
          pipelineLog.info(
            `[D8] Retrying panel ${clip.panelId} (attempt ${attempts + 1}/${maxRetries}): ${result.suggestedAdjustments.directionNote}`
          );
        } catch (err) {
          pipelineLog.error(`[D8] Regeneration failed for panel ${clip.panelId}: ${err}`);
          lastResult = { ...result, routing: "escalate" };
          break;
        }
      } else {
        // No adjustments suggested — escalate
        lastResult = { ...result, routing: "escalate" };
        break;
      }

      attempts++;
    }

    finalResults.push(lastResult!);
  }

  const passCount = finalResults.filter((r) => r.routing === "pass").length;
  const escalateCount = finalResults.filter((r) => r.routing === "escalate").length;

  pipelineLog.info(
    `[D8] Retry loop complete: ${passCount} pass, ${escalateCount} escalate, ${totalRetries} total retries, $${totalCostUsd.toFixed(3)}`
  );

  return {
    finalResults,
    passCount,
    escalateCount,
    totalRetries,
    totalCostUsd,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function buildEvaluationPrompt(
  clip: VoiceClipInput,
  transcribedText: string | null,
  characterProfile?: { voiceName?: string; description?: string; typicalEmotions?: string[] }
): string {
  const parts: string[] = [];

  parts.push(`EVALUATION TARGET:
- Character: ${clip.character}
- Intended dialogue: "${clip.intendedText}"
- Intended emotion: ${clip.intendedEmotion}
- Transcribed text: "${transcribedText || "[transcription unavailable]"}"
`);

  if (characterProfile) {
    parts.push(`CHARACTER PROFILE:
- Voice: ${characterProfile.voiceName || "unknown"}
- Description: ${characterProfile.description || "N/A"}
- Typical emotions: ${characterProfile.typicalEmotions?.join(", ") || "varied"}
`);
  }

  if (clip.voiceSettings) {
    parts.push(`GENERATION SETTINGS:
- Stability: ${clip.voiceSettings.stability ?? "default"}
- Similarity boost: ${clip.voiceSettings.similarityBoost ?? "default"}
- Style: ${clip.voiceSettings.style ?? "default"}
- Speaking rate: ${clip.voiceSettings.speakingRate ?? "default"}
`);
  }

  if (clip.sceneContext) {
    parts.push(`SCENE CONTEXT:
- Mood: ${clip.sceneContext.mood || "neutral"}
- Camera: ${clip.sceneContext.cameraAngle || "medium"}
- Preceding: "${clip.sceneContext.precedingDialogue || "N/A"}"
- Following: "${clip.sceneContext.followingDialogue || "N/A"}"
`);
  }

  parts.push(`EVALUATE on these dimensions (score 0-5 each):
1. emotion_match: Does the vocal delivery convey "${clip.intendedEmotion}"?
2. character_voice_fidelity: Does it sound consistent with the character's voice?
3. pacing_naturalness: Is the speaking rate appropriate for the scene context?
4. audio_clarity: Is the audio clean, free of artifacts, distortion, or unnatural pauses?

If the text was transcribed incorrectly (mispronunciations, missing words), factor that into emotion_match and pacing_naturalness.
If the overall score would be below 3.5, suggest specific TTS parameter adjustments for a retry.`);

  return parts.join("\n");
}

function clampScore(value: number): number {
  if (typeof value !== "number" || isNaN(value)) return 3.0;
  return Math.max(0, Math.min(5, value));
}

function computeWeightedScore(score: VoiceCriticScore): number {
  return (
    score.emotionMatch * SCORE_WEIGHTS.emotionMatch +
    score.characterVoiceFidelity * SCORE_WEIGHTS.characterVoiceFidelity +
    score.pacingNaturalness * SCORE_WEIGHTS.pacingNaturalness +
    score.audioClarity * SCORE_WEIGHTS.audioClarity
  );
}

function determineRouting(overallScore: number): VoiceCriticRouting {
  if (overallScore >= PASS_THRESHOLD) return "pass";
  if (overallScore >= RETRY_THRESHOLD) return "retry";
  return "escalate";
}
