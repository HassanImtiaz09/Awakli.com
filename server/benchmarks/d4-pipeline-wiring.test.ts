/**
 * Wave 4 Item 1: Pipeline Wiring Integration Test
 *
 * Tests the D4→D8→D7 pipeline wiring with mocked dependencies.
 * Verifies:
 *   - D4 Timing Director pipeline integration
 *   - D8 Voice Critic retry-and-rerun loop
 *   - D7 FX Compositor + Render Executor pipeline
 *   - Pipeline wiring orchestration (wireD4, wireD8, wireD7)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock Dependencies ──────────────────────────────────────────────────────

// Mock db.ts
vi.mock("../db.js", () => ({
  getPipelineAssetsByRun: vi.fn(),
  getPanelsByEpisode: vi.fn(),
  getEpisodeById: vi.fn(),
  createPipelineAsset: vi.fn(),
  getDb: vi.fn(),
}));

// Mock drizzle schema
vi.mock("../../drizzle/schema.js", () => ({
  projects: { id: "id" },
}));

// Mock drizzle-orm
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a, b) => ({ field: a, value: b })),
}));

// Mock observability
vi.mock("../observability/logger.js", () => ({
  pipelineLog: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock D4 timing pipeline
vi.mock("./d4-timing/timing-pipeline.js", () => ({
  runTimingPipeline: vi.fn(),
}));

// Mock D8 voice critic pipeline
vi.mock("./d8-voice-critic/voice-critic-pipeline.js", () => ({
  runVoiceCriticPipeline: vi.fn(),
}));

// Mock D7 fx compositor
vi.mock("./d7-fx-compositor/fx-compositor.js", () => ({
  composeFxBatch: vi.fn(),
}));

// Mock D7 fx renderer
vi.mock("./d7-fx-compositor/fx-renderer.js", () => ({
  renderFxBatch: vi.fn(),
}));

// Mock provider-router
vi.mock("../provider-router/index.js", () => ({
  generateWithCredits: vi.fn(),
}));

// Mock D4 db-helpers
vi.mock("./d4-timing/db-helpers.js", () => ({
  getResolvedXSheet: vi.fn(),
  getLatestXSheet: vi.fn(),
  getXSheetEntries: vi.fn(),
  createXSheet: vi.fn(),
  createXSheetEntries: vi.fn(),
  getOverridesForSheet: vi.fn(),
  mergeEntriesWithOverrides: vi.fn(),
  getApprovedXSheet: vi.fn(),
}));

// Mock D8 voice-critic
vi.mock("./d8-voice-critic/voice-critic.js", () => ({
  evaluateVoiceClip: vi.fn(),
  runD8RetryLoop: vi.fn(),
  PASS_THRESHOLD: 3.5,
  MAX_RETRIES_PER_CLIP: 2,
  COST_PER_EVALUATION: 0.02,
}));

// Mock storage
vi.mock("../storage.js", () => ({
  storagePut: vi.fn(),
}));

// ─── Import after mocks ─────────────────────────────────────────────────────

import {
  wireD4TimingDirector,
  wireD8VoiceCritic,
  wireD7FxCompositor,
  type PipelineWiringContext,
} from "./pipeline-wiring.js";
import { runTimingPipeline } from "./d4-timing/timing-pipeline.js";
import { runVoiceCriticPipeline } from "./d8-voice-critic/voice-critic-pipeline.js";
import { composeFxBatch } from "./d7-fx-compositor/fx-compositor.js";
import { renderFxBatch } from "./d7-fx-compositor/fx-renderer.js";
import { getPipelineAssetsByRun, getPanelsByEpisode, getDb } from "../db.js";

// ─── Test Data ──────────────────────────────────────────────────────────────

const CTX: PipelineWiringContext = {
  pipelineRunId: 100,
  episodeId: 1,
  userId: 42,
  projectId: 7,
};

// ─── D4 Timing Director Wiring Tests ────────────────────────────────────────

describe("wireD4TimingDirector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns success with timing result when D4 succeeds", async () => {
    const mockResult = {
      source: "generated" as const,
      xSheetId: 1,
      entryCount: 10,
      overridesApplied: 0,
      entries: [],
      totalDurationMs: 30000,
      costUsd: 0.02,
      durationMs: 500,
    };
    vi.mocked(runTimingPipeline).mockResolvedValue(mockResult);

    const result = await wireD4TimingDirector(CTX);

    expect(result.success).toBe(true);
    expect(result.result).toEqual(mockResult);
    expect(result.costUsd).toBe(0.02);
    expect(runTimingPipeline).toHaveBeenCalledWith({
      pipelineRunId: 100,
      episodeId: 1,
      userId: 42,
      projectId: 7,
    });
  });

  it("returns failure without blocking pipeline when D4 fails", async () => {
    vi.mocked(runTimingPipeline).mockRejectedValue(new Error("LLM timeout"));

    const result = await wireD4TimingDirector(CTX);

    expect(result.success).toBe(false);
    expect(result.error).toBe("LLM timeout");
    expect(result.costUsd).toBe(0);
  });

  it("passes correct options including projectId for override lookup", async () => {
    vi.mocked(runTimingPipeline).mockResolvedValue({
      source: "cached_with_overrides",
      xSheetId: 5,
      entryCount: 8,
      overridesApplied: 3,
      entries: [],
      totalDurationMs: 25000,
      costUsd: 0,
      durationMs: 50,
    });

    const result = await wireD4TimingDirector(CTX);

    expect(result.success).toBe(true);
    expect(result.result!.source).toBe("cached_with_overrides");
    expect(result.result!.overridesApplied).toBe(3);
  });
});

// ─── D8 Voice Critic Wiring Tests ───────────────────────────────────────────

describe("wireD8VoiceCritic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns success with canProceed=true when pass rate >= 80%", async () => {
    vi.mocked(runVoiceCriticPipeline).mockResolvedValue({
      totalClips: 10,
      passCount: 9,
      escalateCount: 1,
      totalRetries: 3,
      avgScore: 4.2,
      totalCostUsd: 0.15,
      finalResults: [],
      totalDurationMs: 5000,
      canProceed: true,
    });

    const result = await wireD8VoiceCritic(CTX);

    expect(result.success).toBe(true);
    expect(result.canProceedToLipSync).toBe(true);
    expect(result.costUsd).toBe(0.15);
    expect(result.result!.totalRetries).toBe(3);
  });

  it("returns canProceed=false when too many clips fail", async () => {
    vi.mocked(runVoiceCriticPipeline).mockResolvedValue({
      totalClips: 10,
      passCount: 5,
      escalateCount: 5,
      totalRetries: 10,
      avgScore: 2.8,
      totalCostUsd: 0.30,
      finalResults: [],
      totalDurationMs: 15000,
      canProceed: false,
    });

    const result = await wireD8VoiceCritic(CTX);

    expect(result.success).toBe(true);
    expect(result.canProceedToLipSync).toBe(false);
  });

  it("returns canProceedToLipSync=true when D8 crashes (non-blocking)", async () => {
    vi.mocked(runVoiceCriticPipeline).mockRejectedValue(new Error("Transcription service down"));

    const result = await wireD8VoiceCritic(CTX);

    expect(result.success).toBe(false);
    expect(result.canProceedToLipSync).toBe(true); // Non-blocking
    expect(result.error).toBe("Transcription service down");
  });

  it("passes userId for provider-router credit holds", async () => {
    vi.mocked(runVoiceCriticPipeline).mockResolvedValue({
      totalClips: 5,
      passCount: 5,
      escalateCount: 0,
      totalRetries: 0,
      avgScore: 4.5,
      totalCostUsd: 0.10,
      finalResults: [],
      totalDurationMs: 3000,
      canProceed: true,
    });

    await wireD8VoiceCritic(CTX);

    expect(runVoiceCriticPipeline).toHaveBeenCalledWith({
      pipelineRunId: 100,
      episodeId: 1,
      userId: 42,
    });
  });
});

// ─── D7 FX Compositor Wiring Tests ──────────────────────────────────────────

describe("wireD7FxCompositor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips when no video clips found", async () => {
    vi.mocked(getPipelineAssetsByRun).mockResolvedValue([]);

    const result = await wireD7FxCompositor(CTX);

    expect(result.success).toBe(true);
    expect(result.clipsRendered).toBe(0);
    expect(composeFxBatch).not.toHaveBeenCalled();
  });

  it("runs full compositor + renderer pipeline when clips exist", async () => {
    // Mock video clip assets
    vi.mocked(getPipelineAssetsByRun).mockResolvedValue([
      { id: 1, panelId: 10, assetType: "video_clip", url: "https://s3/clip1.mp4", metadata: { duration: 5 } },
      { id: 2, panelId: 11, assetType: "video_clip", url: "https://s3/clip2.mp4", metadata: { duration: 3 } },
    ] as any);

    // Mock panels
    vi.mocked(getPanelsByEpisode).mockResolvedValue([
      { id: 10, panelNumber: 1, sceneNumber: 1, sfx: "光角", visualDescription: "Bright flash", cameraAngle: "close-up", dialogue: null },
      { id: 11, panelNumber: 2, sceneNumber: 1, sfx: null, visualDescription: "Character walking", cameraAngle: "medium", dialogue: [{ text: "Hello" }] },
    ] as any);

    // Mock DB for project lookup
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ animeStyle: "shonen", genre: "action" }]),
    };
    vi.mocked(getDb).mockResolvedValue(mockDb as any);

    // Mock compositor result
    vi.mocked(composeFxBatch).mockResolvedValue({
      plans: [
        { panelId: 10, panelNumber: 1, sceneNumber: 1, clipUrl: "https://s3/clip1.mp4", effects: [{ type: "hikaku", intensity: 80 }], hasEffects: true, renderCostUsd: 0.03 },
        { panelId: 11, panelNumber: 2, sceneNumber: 1, clipUrl: "https://s3/clip2.mp4", effects: [], hasEffects: false, renderCostUsd: 0 },
      ],
      totalEffectsApplied: 1,
      totalCostUsd: 0.01,
      genreProfile: "shonen",
      ekonteDrivenCount: 1,
      llmSuggestedCount: 0,
    } as any);

    // Mock renderer result
    vi.mocked(renderFxBatch).mockResolvedValue({
      renderedClips: [
        { panelId: 10, panelNumber: 1, url: "https://s3/clip1-fx.mp4", wasRendered: true, effectsApplied: ["hikaku"] },
      ],
      successCount: 1,
      failedCount: 0,
      skippedCount: 1,
      totalCostUsd: 0.03,
      totalDurationMs: 2000,
    });

    const result = await wireD7FxCompositor(CTX);

    expect(result.success).toBe(true);
    expect(result.clipsRendered).toBe(1);
    expect(result.costUsd).toBe(0.04); // 0.01 compositor + 0.03 renderer
    expect(composeFxBatch).toHaveBeenCalledWith(expect.objectContaining({
      animeStyle: "shonen",
      genre: "action",
      clips: expect.arrayContaining([
        expect.objectContaining({ panelId: 10, sfxTag: "光角" }),
      ]),
    }));
    expect(renderFxBatch).toHaveBeenCalledWith(expect.objectContaining({
      pipelineRunId: 100,
      episodeId: 1,
    }));
  });

  it("skips rendering when no plans have effects", async () => {
    vi.mocked(getPipelineAssetsByRun).mockResolvedValue([
      { id: 1, panelId: 10, assetType: "video_clip", url: "https://s3/clip1.mp4", metadata: {} },
    ] as any);
    vi.mocked(getPanelsByEpisode).mockResolvedValue([
      { id: 10, panelNumber: 1, sceneNumber: 1, sfx: null, visualDescription: "Static scene", cameraAngle: "wide", dialogue: null },
    ] as any);
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ animeStyle: "seinen", genre: "drama" }]),
    };
    vi.mocked(getDb).mockResolvedValue(mockDb as any);

    vi.mocked(composeFxBatch).mockResolvedValue({
      plans: [
        { panelId: 10, panelNumber: 1, sceneNumber: 1, clipUrl: "https://s3/clip1.mp4", effects: [], hasEffects: false, renderCostUsd: 0 },
      ],
      totalEffectsApplied: 0,
      totalCostUsd: 0,
      genreProfile: "seinen",
      ekonteDrivenCount: 0,
      llmSuggestedCount: 0,
    } as any);

    const result = await wireD7FxCompositor(CTX);

    expect(result.success).toBe(true);
    expect(result.clipsRendered).toBe(0);
    expect(renderFxBatch).not.toHaveBeenCalled();
  });

  it("returns non-blocking failure when D7 crashes", async () => {
    vi.mocked(getPipelineAssetsByRun).mockRejectedValue(new Error("DB connection lost"));

    const result = await wireD7FxCompositor(CTX);

    expect(result.success).toBe(false);
    expect(result.error).toBe("DB connection lost");
    expect(result.clipsRendered).toBe(0);
  });

  it("handles synced_clip assets (lip-synced) as input", async () => {
    vi.mocked(getPipelineAssetsByRun).mockResolvedValue([
      { id: 1, panelId: 10, assetType: "synced_clip", url: "https://s3/synced1.mp4", metadata: { duration: 4 } },
    ] as any);
    vi.mocked(getPanelsByEpisode).mockResolvedValue([
      { id: 10, panelNumber: 1, sceneNumber: 1, sfx: "波ガラス", visualDescription: "Water ripple", cameraAngle: "close-up", dialogue: null },
    ] as any);
    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ animeStyle: "shojo", genre: "romance" }]),
    };
    vi.mocked(getDb).mockResolvedValue(mockDb as any);

    vi.mocked(composeFxBatch).mockResolvedValue({
      plans: [
        { panelId: 10, panelNumber: 1, sceneNumber: 1, clipUrl: "https://s3/synced1.mp4", effects: [{ type: "namigarasu", intensity: 60 }], hasEffects: true, renderCostUsd: 0.03 },
      ],
      totalEffectsApplied: 1,
      totalCostUsd: 0.01,
      genreProfile: "shojo",
      ekonteDrivenCount: 1,
      llmSuggestedCount: 0,
    } as any);

    vi.mocked(renderFxBatch).mockResolvedValue({
      renderedClips: [
        { panelId: 10, panelNumber: 1, url: "https://s3/synced1-fx.mp4", wasRendered: true, effectsApplied: ["namigarasu"] },
      ],
      successCount: 1,
      failedCount: 0,
      skippedCount: 0,
      totalCostUsd: 0.03,
      totalDurationMs: 1500,
    });

    const result = await wireD7FxCompositor(CTX);

    expect(result.success).toBe(true);
    expect(result.clipsRendered).toBe(1);
    expect(composeFxBatch).toHaveBeenCalledWith(expect.objectContaining({
      clips: expect.arrayContaining([
        expect.objectContaining({ panelId: 10, sfxTag: "波ガラス" }),
      ]),
    }));
  });
});

// ─── Pipeline Execution Order Tests ─────────────────────────────────────────

describe("Pipeline Wiring Execution Order", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("D4→D8→D7 order is maintained by orchestrator calling in sequence", async () => {
    const callOrder: string[] = [];

    vi.mocked(runTimingPipeline).mockImplementation(async () => {
      callOrder.push("D4");
      return {
        source: "generated" as const,
        xSheetId: 1,
        entryCount: 5,
        overridesApplied: 0,
        entries: [],
        totalDurationMs: 15000,
        costUsd: 0.02,
        durationMs: 200,
      };
    });

    vi.mocked(runVoiceCriticPipeline).mockImplementation(async () => {
      callOrder.push("D8");
      return {
        totalClips: 5,
        passCount: 5,
        escalateCount: 0,
        totalRetries: 0,
        avgScore: 4.5,
        totalCostUsd: 0.10,
        finalResults: [],
        totalDurationMs: 3000,
        canProceed: true,
      };
    });

    vi.mocked(getPipelineAssetsByRun).mockImplementation(async () => {
      callOrder.push("D7");
      return [];
    });

    // Simulate orchestrator calling in order
    await wireD4TimingDirector(CTX);
    await wireD8VoiceCritic(CTX);
    await wireD7FxCompositor(CTX);

    expect(callOrder).toEqual(["D4", "D8", "D7"]);
  });

  it("D8 failure does not block D7 execution", async () => {
    vi.mocked(runVoiceCriticPipeline).mockRejectedValue(new Error("D8 crashed"));
    vi.mocked(getPipelineAssetsByRun).mockResolvedValue([]);

    const d8Result = await wireD8VoiceCritic(CTX);
    const d7Result = await wireD7FxCompositor(CTX);

    expect(d8Result.success).toBe(false);
    expect(d8Result.canProceedToLipSync).toBe(true);
    expect(d7Result.success).toBe(true);
  });
});

// ─── D8 Retry Loop Functional Tests ─────────────────────────────────────────

describe("D8 Voice Critic Retry Loop (Functional)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports retry count when clips are regenerated", async () => {
    vi.mocked(runVoiceCriticPipeline).mockResolvedValue({
      totalClips: 3,
      passCount: 3,
      escalateCount: 0,
      totalRetries: 2, // 2 clips needed retry
      avgScore: 4.0,
      totalCostUsd: 0.18,
      finalResults: [
        { panelId: 1, character: "A", intendedText: "Hi", transcribedText: "Hi", score: { overallScore: 4.5, emotionMatch: 4, characterVoiceFidelity: 5, pacingNaturalness: 4, audioClarity: 5 }, routing: "pass", feedback: "Good", suggestedAdjustments: null, costUsd: 0.02, latencyMs: 500 },
        { panelId: 2, character: "B", intendedText: "Hello", transcribedText: "Hello", score: { overallScore: 3.8, emotionMatch: 3, characterVoiceFidelity: 4, pacingNaturalness: 4, audioClarity: 4 }, routing: "pass", feedback: "Improved after retry", suggestedAdjustments: null, costUsd: 0.04, latencyMs: 1200 },
        { panelId: 3, character: "A", intendedText: "Bye", transcribedText: "Bye", score: { overallScore: 4.0, emotionMatch: 4, characterVoiceFidelity: 4, pacingNaturalness: 4, audioClarity: 4 }, routing: "pass", feedback: "Improved after retry", suggestedAdjustments: null, costUsd: 0.04, latencyMs: 1100 },
      ],
      totalDurationMs: 5000,
      canProceed: true,
    });

    const result = await wireD8VoiceCritic(CTX);

    expect(result.success).toBe(true);
    expect(result.result!.totalRetries).toBe(2);
    expect(result.result!.passCount).toBe(3);
    expect(result.canProceedToLipSync).toBe(true);
  });

  it("reports escalated clips that failed all retries", async () => {
    vi.mocked(runVoiceCriticPipeline).mockResolvedValue({
      totalClips: 5,
      passCount: 3,
      escalateCount: 2,
      totalRetries: 4,
      avgScore: 3.2,
      totalCostUsd: 0.25,
      finalResults: [],
      totalDurationMs: 12000,
      canProceed: false, // 3/5 = 60% < 80%
    });

    const result = await wireD8VoiceCritic(CTX);

    expect(result.success).toBe(true);
    expect(result.canProceedToLipSync).toBe(false);
    expect(result.result!.escalateCount).toBe(2);
  });
});

// ─── D7 Ekonte Tag Priority Tests ───────────────────────────────────────────

describe("D7 Ekonte Tag Priority in Pipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes ekonte sfxTag from panel.sfx as primary source to compositor", async () => {
    vi.mocked(getPipelineAssetsByRun).mockResolvedValue([
      { id: 1, panelId: 10, assetType: "video_clip", url: "https://s3/clip1.mp4", metadata: { duration: 5 } },
      { id: 2, panelId: 11, assetType: "video_clip", url: "https://s3/clip2.mp4", metadata: { duration: 3 } },
      { id: 3, panelId: 12, assetType: "video_clip", url: "https://s3/clip3.mp4", metadata: { duration: 4 } },
    ] as any);

    vi.mocked(getPanelsByEpisode).mockResolvedValue([
      { id: 10, panelNumber: 1, sceneNumber: 1, sfx: "光角", visualDescription: "Impact", cameraAngle: "close-up", dialogue: null },
      { id: 11, panelNumber: 2, sceneNumber: 1, sfx: "ガブレ", visualDescription: "Shake", cameraAngle: "wide", dialogue: null },
      { id: 12, panelNumber: 3, sceneNumber: 1, sfx: null, visualDescription: "Calm scene", cameraAngle: "medium", dialogue: null },
    ] as any);

    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ animeStyle: "shonen", genre: "action" }]),
    };
    vi.mocked(getDb).mockResolvedValue(mockDb as any);

    vi.mocked(composeFxBatch).mockResolvedValue({
      plans: [],
      totalEffectsApplied: 0,
      totalCostUsd: 0,
      genreProfile: "shonen",
      ekonteDrivenCount: 2,
      llmSuggestedCount: 0,
    } as any);

    await wireD7FxCompositor(CTX);

    const callArgs = vi.mocked(composeFxBatch).mock.calls[0][0];
    expect(callArgs.clips[0].sfxTag).toBe("光角");
    expect(callArgs.clips[1].sfxTag).toBe("ガブレ");
    expect(callArgs.clips[2].sfxTag).toBeNull(); // LLM fallback for this one
  });

  it("passes anime style from project for genre-driven FX library", async () => {
    vi.mocked(getPipelineAssetsByRun).mockResolvedValue([
      { id: 1, panelId: 10, assetType: "video_clip", url: "https://s3/clip.mp4", metadata: { duration: 5 } },
    ] as any);
    vi.mocked(getPanelsByEpisode).mockResolvedValue([
      { id: 10, panelNumber: 1, sceneNumber: 1, sfx: "bokeh-pull", visualDescription: "Romantic scene", cameraAngle: "close-up", dialogue: null },
    ] as any);

    const mockDb = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ animeStyle: "shojo", genre: "romance" }]),
    };
    vi.mocked(getDb).mockResolvedValue(mockDb as any);

    vi.mocked(composeFxBatch).mockResolvedValue({
      plans: [],
      totalEffectsApplied: 0,
      totalCostUsd: 0,
      genreProfile: "shojo",
      ekonteDrivenCount: 1,
      llmSuggestedCount: 0,
    } as any);

    await wireD7FxCompositor(CTX);

    const callArgs = vi.mocked(composeFxBatch).mock.calls[0][0];
    expect(callArgs.animeStyle).toBe("shojo");
    expect(callArgs.genre).toBe("romance");
  });
});
