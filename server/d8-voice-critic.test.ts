/**
 * D8 Voice Director Critic — Integration Tests
 *
 * Tests the full evaluation + retry loop for voice quality scoring.
 * Mocks: invokeLLM, transcribeAudio, pipelineLog
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("./_core/llm", () => ({
  invokeLLM: vi.fn(),
}));

vi.mock("./_core/voiceTranscription", () => ({
  transcribeAudio: vi.fn(),
}));

vi.mock("./observability/logger", () => ({
  pipelineLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { invokeLLM } from "./_core/llm";
import { transcribeAudio } from "./_core/voiceTranscription";
import {
  evaluateVoiceClip,
  evaluateVoiceBatch,
  runD8RetryLoop,
  SCORE_WEIGHTS,
  PASS_THRESHOLD,
  RETRY_THRESHOLD,
  COST_PER_EVALUATION,
  type VoiceClipInput,
  type EmotionAdjustment,
} from "./benchmarks/d8-voice-critic/voice-critic";

// ─── Helpers ────────────────────────────────────────────────────────────────

const mockLLM = invokeLLM as ReturnType<typeof vi.fn>;
const mockTranscribe = transcribeAudio as ReturnType<typeof vi.fn>;

function makeClip(overrides: Partial<VoiceClipInput> = {}): VoiceClipInput {
  return {
    panelId: 1,
    character: "Mira",
    intendedText: "I won't give up!",
    intendedEmotion: "determined",
    audioUrl: "https://storage.example.com/voice/panel-1.mp3",
    voiceSettings: { stability: 0.4, similarityBoost: 0.8, style: 0.3, speakingRate: 1.0 },
    sceneContext: { mood: "tense", cameraAngle: "close-up" },
    ...overrides,
  };
}

function mockLLMResponse(scores: {
  emotionMatch: number;
  characterVoiceFidelity: number;
  pacingNaturalness: number;
  audioClarity: number;
  feedback?: string;
  suggestedEmotion?: string;
  suggestedStability?: number;
  suggestedSimilarityBoost?: number;
  suggestedStyle?: number;
  suggestedSpeakingRate?: number;
  directionNote?: string;
}) {
  const content = JSON.stringify({
    emotionMatch: scores.emotionMatch,
    characterVoiceFidelity: scores.characterVoiceFidelity,
    pacingNaturalness: scores.pacingNaturalness,
    audioClarity: scores.audioClarity,
    feedback: scores.feedback || "Good delivery",
    suggestedEmotion: scores.suggestedEmotion || "none",
    suggestedStability: scores.suggestedStability ?? -1,
    suggestedSimilarityBoost: scores.suggestedSimilarityBoost ?? -1,
    suggestedStyle: scores.suggestedStyle ?? -1,
    suggestedSpeakingRate: scores.suggestedSpeakingRate ?? -1,
    directionNote: scores.directionNote || "",
  });
  return { choices: [{ message: { content } }] };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("D8 Voice Director Critic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: transcription succeeds
    mockTranscribe.mockResolvedValue({
      task: "transcribe",
      language: "en",
      duration: 2.5,
      text: "I won't give up!",
      segments: [],
    });
  });

  describe("evaluateVoiceClip", () => {
    it("returns pass routing for high scores", async () => {
      mockLLM.mockResolvedValue(
        mockLLMResponse({
          emotionMatch: 4.5,
          characterVoiceFidelity: 4.0,
          pacingNaturalness: 4.2,
          audioClarity: 4.8,
        })
      );

      const result = await evaluateVoiceClip(makeClip());

      expect(result.routing).toBe("pass");
      expect(result.score.overallScore).toBeGreaterThanOrEqual(PASS_THRESHOLD);
      expect(result.panelId).toBe(1);
      expect(result.character).toBe("Mira");
      expect(result.transcribedText).toBe("I won't give up!");
      expect(result.costUsd).toBe(COST_PER_EVALUATION);
      expect(result.suggestedAdjustments).toBeNull();
    });

    it("returns retry routing for medium scores with adjustments", async () => {
      mockLLM.mockResolvedValue(
        mockLLMResponse({
          emotionMatch: 2.8,
          characterVoiceFidelity: 3.0,
          pacingNaturalness: 3.2,
          audioClarity: 4.0,
          feedback: "Emotion too flat for determined delivery",
          suggestedEmotion: "fierce",
          suggestedStability: 0.3,
          suggestedStyle: 0.4,
          directionNote: "Push more intensity, shorter pauses",
        })
      );

      const result = await evaluateVoiceClip(makeClip());

      expect(result.routing).toBe("retry");
      expect(result.score.overallScore).toBeGreaterThanOrEqual(RETRY_THRESHOLD);
      expect(result.score.overallScore).toBeLessThan(PASS_THRESHOLD);
      expect(result.suggestedAdjustments).not.toBeNull();
      expect(result.suggestedAdjustments!.emotion).toBe("fierce");
      expect(result.suggestedAdjustments!.stability).toBe(0.3);
      expect(result.suggestedAdjustments!.style).toBe(0.4);
      expect(result.suggestedAdjustments!.directionNote).toBe("Push more intensity, shorter pauses");
    });

    it("returns escalate routing for very low scores", async () => {
      mockLLM.mockResolvedValue(
        mockLLMResponse({
          emotionMatch: 1.5,
          characterVoiceFidelity: 2.0,
          pacingNaturalness: 2.2,
          audioClarity: 2.5,
          feedback: "Completely wrong character voice",
          suggestedEmotion: "determined",
          directionNote: "Voice mismatch — needs different voice ID",
        })
      );

      const result = await evaluateVoiceClip(makeClip());

      expect(result.routing).toBe("escalate");
      expect(result.score.overallScore).toBeLessThan(RETRY_THRESHOLD);
    });

    it("handles transcription failure gracefully", async () => {
      mockTranscribe.mockResolvedValue({
        error: "Service unavailable",
        code: "SERVICE_ERROR",
      });
      mockLLM.mockResolvedValue(
        mockLLMResponse({
          emotionMatch: 4.0,
          characterVoiceFidelity: 4.0,
          pacingNaturalness: 4.0,
          audioClarity: 4.5,
        })
      );

      const result = await evaluateVoiceClip(makeClip());

      expect(result.routing).toBe("pass");
      expect(result.transcribedText).toBeNull();
      // LLM still evaluates (with "[transcription unavailable]" in prompt)
      expect(mockLLM).toHaveBeenCalledTimes(1);
    });

    it("handles LLM failure with conservative pass fallback", async () => {
      mockLLM.mockRejectedValue(new Error("LLM timeout"));

      const result = await evaluateVoiceClip(makeClip());

      // Conservative fallback: assume pass to avoid blocking pipeline
      expect(result.routing).toBe("pass");
      expect(result.score.overallScore).toBeGreaterThanOrEqual(PASS_THRESHOLD);
      expect(result.feedback).toContain("unavailable");
    });

    it("includes character profile in evaluation prompt", async () => {
      mockLLM.mockResolvedValue(
        mockLLMResponse({ emotionMatch: 4.0, characterVoiceFidelity: 4.0, pacingNaturalness: 4.0, audioClarity: 4.0 })
      );

      await evaluateVoiceClip(makeClip(), {
        voiceName: "Sarah",
        description: "Young woman, determined, speaks with quiet strength",
        typicalEmotions: ["determined", "compassionate", "fierce"],
      });

      const llmCall = mockLLM.mock.calls[0][0];
      const userContent = llmCall.messages[1].content;
      expect(userContent).toContain("Sarah");
      expect(userContent).toContain("quiet strength");
      expect(userContent).toContain("determined, compassionate, fierce");
    });

    it("includes scene context in evaluation prompt", async () => {
      mockLLM.mockResolvedValue(
        mockLLMResponse({ emotionMatch: 4.0, characterVoiceFidelity: 4.0, pacingNaturalness: 4.0, audioClarity: 4.0 })
      );

      await evaluateVoiceClip(makeClip({
        sceneContext: {
          mood: "climactic",
          cameraAngle: "extreme-close-up",
          precedingDialogue: "You can't stop me.",
          followingDialogue: "Let's finish this!",
        },
      }));

      const llmCall = mockLLM.mock.calls[0][0];
      const userContent = llmCall.messages[1].content;
      expect(userContent).toContain("climactic");
      expect(userContent).toContain("extreme-close-up");
      expect(userContent).toContain("You can't stop me.");
    });

    it("clamps out-of-range scores to 0-5", async () => {
      mockLLM.mockResolvedValue(
        mockLLMResponse({
          emotionMatch: 7.0,  // Over 5
          characterVoiceFidelity: -2.0,  // Under 0
          pacingNaturalness: 4.0,
          audioClarity: 4.0,
        })
      );

      const result = await evaluateVoiceClip(makeClip());

      expect(result.score.emotionMatch).toBe(5);
      expect(result.score.characterVoiceFidelity).toBe(0);
    });

    it("computes weighted score correctly", async () => {
      mockLLM.mockResolvedValue(
        mockLLMResponse({
          emotionMatch: 4.0,
          characterVoiceFidelity: 3.0,
          pacingNaturalness: 5.0,
          audioClarity: 2.0,
        })
      );

      const result = await evaluateVoiceClip(makeClip());

      const expected =
        4.0 * SCORE_WEIGHTS.emotionMatch +
        3.0 * SCORE_WEIGHTS.characterVoiceFidelity +
        5.0 * SCORE_WEIGHTS.pacingNaturalness +
        2.0 * SCORE_WEIGHTS.audioClarity;
      expect(result.score.overallScore).toBeCloseTo(expected, 2);
    });
  });

  describe("evaluateVoiceBatch", () => {
    it("evaluates multiple clips and aggregates results", async () => {
      // Clip 1: pass
      mockLLM.mockResolvedValueOnce(
        mockLLMResponse({ emotionMatch: 4.5, characterVoiceFidelity: 4.0, pacingNaturalness: 4.0, audioClarity: 4.5 })
      );
      // Clip 2: retry
      mockLLM.mockResolvedValueOnce(
        mockLLMResponse({
          emotionMatch: 2.8, characterVoiceFidelity: 3.0, pacingNaturalness: 3.0, audioClarity: 3.5,
          suggestedEmotion: "gentle",
          directionNote: "Softer delivery needed",
        })
      );
      // Clip 3: escalate
      mockLLM.mockResolvedValueOnce(
        mockLLMResponse({ emotionMatch: 1.0, characterVoiceFidelity: 1.5, pacingNaturalness: 2.0, audioClarity: 2.0,
          suggestedEmotion: "neutral",
          directionNote: "Wrong voice entirely",
        })
      );

      const result = await evaluateVoiceBatch({
        clips: [
          makeClip({ panelId: 1 }),
          makeClip({ panelId: 2, intendedEmotion: "gentle" }),
          makeClip({ panelId: 3, character: "Ren" }),
        ],
      });

      expect(result.results).toHaveLength(3);
      expect(result.passCount).toBe(1);
      expect(result.retryCount).toBe(1);
      expect(result.escalateCount).toBe(1);
      expect(result.totalCostUsd).toBe(COST_PER_EVALUATION * 3);
    });

    it("passes character profiles to individual evaluations", async () => {
      mockLLM.mockResolvedValue(
        mockLLMResponse({ emotionMatch: 4.0, characterVoiceFidelity: 4.0, pacingNaturalness: 4.0, audioClarity: 4.0 })
      );

      await evaluateVoiceBatch({
        clips: [makeClip()],
        characterProfiles: {
          Mira: { voiceName: "Sarah", description: "Determined warrior", typicalEmotions: ["fierce"] },
        },
      });

      const llmCall = mockLLM.mock.calls[0][0];
      expect(llmCall.messages[1].content).toContain("Sarah");
    });
  });

  describe("runD8RetryLoop", () => {
    it("passes clips through without retry when score is high", async () => {
      mockLLM.mockResolvedValue(
        mockLLMResponse({ emotionMatch: 4.5, characterVoiceFidelity: 4.0, pacingNaturalness: 4.0, audioClarity: 4.5 })
      );

      const regenerateClip = vi.fn();
      const result = await runD8RetryLoop({
        clips: [makeClip()],
        regenerateClip,
      });

      expect(result.passCount).toBe(1);
      expect(result.escalateCount).toBe(0);
      expect(result.totalRetries).toBe(0);
      expect(regenerateClip).not.toHaveBeenCalled();
    });

    it("retries clips with adjusted params when score is medium", async () => {
      // First evaluation: retry
      mockLLM.mockResolvedValueOnce(
        mockLLMResponse({
          emotionMatch: 2.8, characterVoiceFidelity: 3.0, pacingNaturalness: 3.2, audioClarity: 4.0,
          suggestedEmotion: "fierce",
          suggestedStability: 0.3,
          directionNote: "More intensity",
        })
      );
      // After retry: pass
      mockLLM.mockResolvedValueOnce(
        mockLLMResponse({ emotionMatch: 4.5, characterVoiceFidelity: 4.0, pacingNaturalness: 4.0, audioClarity: 4.5 })
      );

      const regenerateClip = vi.fn().mockResolvedValue({
        audioUrl: "https://storage.example.com/voice/panel-1-retry.mp3",
      });

      const result = await runD8RetryLoop({
        clips: [makeClip()],
        regenerateClip,
      });

      expect(result.passCount).toBe(1);
      expect(result.escalateCount).toBe(0);
      expect(result.totalRetries).toBe(1);
      expect(regenerateClip).toHaveBeenCalledWith(1, expect.objectContaining({
        emotion: "fierce",
        stability: 0.3,
        directionNote: "More intensity",
      }));
    });

    it("escalates after max retries exhausted", async () => {
      // All evaluations return retry-range scores
      mockLLM.mockResolvedValue(
        mockLLMResponse({
          emotionMatch: 2.8, characterVoiceFidelity: 3.0, pacingNaturalness: 3.0, audioClarity: 3.5,
          suggestedEmotion: "fierce",
          suggestedStability: 0.3,
          directionNote: "Try harder",
        })
      );

      const regenerateClip = vi.fn().mockResolvedValue({
        audioUrl: "https://storage.example.com/voice/panel-1-retry.mp3",
      });

      const result = await runD8RetryLoop({
        clips: [makeClip()],
        maxRetries: 2,
        regenerateClip,
      });

      expect(result.passCount).toBe(0);
      expect(result.escalateCount).toBe(1);
      expect(result.totalRetries).toBe(2);
      expect(regenerateClip).toHaveBeenCalledTimes(2);
      // Cost: initial eval + 2 retry evals = 3 evaluations
      expect(result.totalCostUsd).toBe(COST_PER_EVALUATION * 3);
    });

    it("escalates immediately for very low scores (no adjustments)", async () => {
      mockLLM.mockResolvedValue(
        mockLLMResponse({
          emotionMatch: 1.0, characterVoiceFidelity: 1.5, pacingNaturalness: 1.5, audioClarity: 2.0,
          suggestedEmotion: "none",
          directionNote: "",
        })
      );

      const regenerateClip = vi.fn();
      const result = await runD8RetryLoop({
        clips: [makeClip()],
        regenerateClip,
      });

      expect(result.passCount).toBe(0);
      expect(result.escalateCount).toBe(1);
      expect(result.totalRetries).toBe(0);
      expect(regenerateClip).not.toHaveBeenCalled();
    });

    it("handles regeneration failure by escalating", async () => {
      mockLLM.mockResolvedValue(
        mockLLMResponse({
          emotionMatch: 2.8, characterVoiceFidelity: 3.0, pacingNaturalness: 3.0, audioClarity: 3.5,
          suggestedEmotion: "fierce",
          directionNote: "More intensity",
        })
      );

      const regenerateClip = vi.fn().mockRejectedValue(new Error("TTS provider down"));

      const result = await runD8RetryLoop({
        clips: [makeClip()],
        regenerateClip,
      });

      expect(result.passCount).toBe(0);
      expect(result.escalateCount).toBe(1);
      expect(result.totalRetries).toBe(0);
    });

    it("handles mixed batch: some pass, some retry, some escalate", async () => {
      // Clip 1: pass immediately
      mockLLM.mockResolvedValueOnce(
        mockLLMResponse({ emotionMatch: 4.5, characterVoiceFidelity: 4.0, pacingNaturalness: 4.0, audioClarity: 4.5 })
      );
      // Clip 2: retry once then pass
      mockLLM.mockResolvedValueOnce(
        mockLLMResponse({
          emotionMatch: 3.0, characterVoiceFidelity: 3.0, pacingNaturalness: 3.0, audioClarity: 3.5,
          suggestedEmotion: "gentle",
          directionNote: "Softer",
        })
      );
      mockLLM.mockResolvedValueOnce(
        mockLLMResponse({ emotionMatch: 4.0, characterVoiceFidelity: 4.0, pacingNaturalness: 4.0, audioClarity: 4.0 })
      );
      // Clip 3: escalate immediately (very low)
      mockLLM.mockResolvedValueOnce(
        mockLLMResponse({
          emotionMatch: 1.0, characterVoiceFidelity: 1.0, pacingNaturalness: 1.5, audioClarity: 2.0,
          suggestedEmotion: "none",
          directionNote: "",
        })
      );

      const regenerateClip = vi.fn().mockResolvedValue({
        audioUrl: "https://storage.example.com/voice/retry.mp3",
      });

      const result = await runD8RetryLoop({
        clips: [
          makeClip({ panelId: 1 }),
          makeClip({ panelId: 2, intendedEmotion: "gentle" }),
          makeClip({ panelId: 3, character: "Ren" }),
        ],
        regenerateClip,
      });

      expect(result.passCount).toBe(2);
      expect(result.escalateCount).toBe(1);
      expect(result.totalRetries).toBe(1);
      expect(regenerateClip).toHaveBeenCalledTimes(1);
    });

    it("respects custom maxRetries setting", async () => {
      mockLLM.mockResolvedValue(
        mockLLMResponse({
          emotionMatch: 3.0, characterVoiceFidelity: 3.0, pacingNaturalness: 3.0, audioClarity: 3.5,
          suggestedEmotion: "fierce",
          directionNote: "Try again",
        })
      );

      const regenerateClip = vi.fn().mockResolvedValue({
        audioUrl: "https://storage.example.com/voice/retry.mp3",
      });

      const result = await runD8RetryLoop({
        clips: [makeClip()],
        maxRetries: 1,
        regenerateClip,
      });

      // 1 retry max → 2 evaluations total (initial + 1 retry)
      expect(result.totalRetries).toBe(1);
      expect(regenerateClip).toHaveBeenCalledTimes(1);
      expect(result.escalateCount).toBe(1);
    });
  });

  describe("Score Weights", () => {
    it("weights sum to 1.0", () => {
      const sum = Object.values(SCORE_WEIGHTS).reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1.0, 5);
    });

    it("emotion_match has highest weight (40%)", () => {
      expect(SCORE_WEIGHTS.emotionMatch).toBe(0.4);
      expect(SCORE_WEIGHTS.emotionMatch).toBeGreaterThan(SCORE_WEIGHTS.characterVoiceFidelity);
    });

    it("audio_clarity has lowest weight (10%)", () => {
      expect(SCORE_WEIGHTS.audioClarity).toBe(0.1);
    });
  });

  describe("Thresholds", () => {
    it("pass threshold is 3.5", () => {
      expect(PASS_THRESHOLD).toBe(3.5);
    });

    it("retry threshold is 2.5", () => {
      expect(RETRY_THRESHOLD).toBe(2.5);
    });

    it("pass > retry thresholds", () => {
      expect(PASS_THRESHOLD).toBeGreaterThan(RETRY_THRESHOLD);
    });
  });
});
