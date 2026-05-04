/**
 * D5.5 · Pipeline Integration Tests
 *
 * Tests the runD5_5QualityGate function that bridges D5.5 per-clip-reviewer
 * and retry-orchestrator into the main pipeline orchestrator.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the per-clip-reviewer
vi.mock("./benchmarks/d5-5/per-clip-reviewer", () => ({
  runBatchD5_5Review: vi.fn(),
  MAX_D5_5_RETRIES_PER_CLIP: 3,
  DEFAULT_PASS_THRESHOLD: 3,
}));

// Mock the retry-orchestrator
vi.mock("./benchmarks/d5-5/retry-orchestrator", () => ({
  runEpisodeRetryLoop: vi.fn(),
}));

// Mock db-helpers
vi.mock("./benchmarks/d5-5/db-helpers", () => ({
  saveClipReviewBatch: vi.fn().mockResolvedValue([1, 2, 3]),
  computeHash: vi.fn().mockReturnValue("abc123"),
}));

// Mock observability logger
vi.mock("./observability/logger", () => ({
  pipelineLog: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock admin escalation queue
vi.mock("./admin/quality-escalation-queue", () => ({
  addToEscalationQueue: vi.fn(),
}));

import { runD5_5QualityGate, deriveStyleLock, buildCharacterBiblesMap } from "./benchmarks/d5-5/pipeline-integration";
import type { D5_5PipelineContext, ClipAssetInfo, PanelInfo } from "./benchmarks/d5-5/pipeline-integration";
import { runBatchD5_5Review } from "./benchmarks/d5-5/per-clip-reviewer";
import { runEpisodeRetryLoop } from "./benchmarks/d5-5/retry-orchestrator";
import { saveClipReviewBatch } from "./benchmarks/d5-5/db-helpers";

// ─── Test Fixtures ──────────────────────────────────────────────────────────

function makeClipAssets(count: number): ClipAssetInfo[] {
  return Array.from({ length: count }, (_, i) => ({
    assetId: i + 1,
    panelId: 100 + i,
    panelNumber: i + 1,
    url: `https://s3.example.com/clips/panel-${100 + i}.mp4`,
    duration: 5,
    assetType: "synced_clip" as const,
    metadata: { provider: "fal.ai", model: "kling-v3" },
  }));
}

function makePanels(count: number): PanelInfo[] {
  return Array.from({ length: count }, (_, i) => ({
    id: 100 + i,
    panelNumber: i + 1,
    sceneNumber: Math.floor(i / 3) + 1,
    visualDescription: `Character walks through a neon-lit alley, scene ${i + 1}`,
    cameraAngle: i % 2 === 0 ? "medium_shot" : "close_up",
    dialogue: i % 3 === 0
      ? [{ character: "Akira", text: "Let's go!", emotion: "determined" }]
      : null,
    sfx: i % 4 === 0 ? "footsteps" : null,
  }));
}

function makeBaseContext(clipCount = 5): D5_5PipelineContext {
  return {
    pipelineRunId: 1,
    episodeId: 10,
    projectId: 5,
    userId: 1,
    clipAssets: makeClipAssets(clipCount),
    panels: makePanels(clipCount),
    characterBibles: {
      Akira: { visualTraits: { hairColor: "black", eyeColor: "blue" }, referenceImages: [] },
    },
    styleLock: { primary: "shonen anime", forbidden: ["chibi proportions"] },
    regenerateClip: vi.fn().mockResolvedValue({
      clipUrl: "https://s3.example.com/clips/regenerated.mp4",
      keyframeUrls: ["https://s3.example.com/frames/regen-1.jpg"],
      costUsd: 0.20,
    }),
    userTier: "creator_pro",
  };
}

function makePassingReview(sliceId: number, attempt = 1) {
  return {
    sliceId,
    attempt,
    passed: true,
    scores: { character_consistency: 4, style: 4, prompt_alignment: 4, motion_quality: 4 },
    overallScore: 4,
    issues: [],
    routingDecision: "pass" as const,
    costUsd: 0.04,
    durationMs: 1500,
  };
}

function makeFailingReview(sliceId: number, attempt = 1) {
  return {
    sliceId,
    attempt,
    passed: false,
    scores: { character_consistency: 2, style: 3, prompt_alignment: 2, motion_quality: 2 },
    overallScore: 2,
    issues: [{ category: "character_consistency", severity: "major", description: "Wrong hair color", recommended_action: "retry_video" }],
    routingDecision: "retry_video" as const,
    costUsd: 0.04,
    durationMs: 1500,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("D5.5 Pipeline Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("runD5_5QualityGate", () => {
    it("returns canProceed=true when all clips pass on first attempt", async () => {
      const ctx = makeBaseContext(5);
      const reviews = ctx.clipAssets.map(c => makePassingReview(c.panelId));

      (runBatchD5_5Review as any).mockResolvedValue({
        episodeId: 10,
        projectId: 5,
        totalSlices: 5,
        passedSlices: 5,
        failedSlices: 0,
        escalatedSlices: 0,
        reviews,
        totalCostUsd: 0.20,
        totalDurationMs: 7500,
      });

      const result = await runD5_5QualityGate(ctx);

      expect(result.canProceed).toBe(true);
      expect(result.totalClips).toBe(5);
      expect(result.passedFirstAttempt).toBe(5);
      expect(result.passedAfterRetry).toBe(0);
      expect(result.escalated).toBe(0);
      expect(result.avgQualityScore).toBe(4);
      // Should NOT call retry loop
      expect(runEpisodeRetryLoop).not.toHaveBeenCalled();
    });

    it("runs retry loop for failed clips and recovers", async () => {
      const ctx = makeBaseContext(5);
      const reviews = [
        makePassingReview(100),
        makePassingReview(101),
        makePassingReview(102),
        makeFailingReview(103),
        makeFailingReview(104),
      ];

      (runBatchD5_5Review as any).mockResolvedValue({
        episodeId: 10,
        projectId: 5,
        totalSlices: 5,
        passedSlices: 3,
        failedSlices: 2,
        escalatedSlices: 0,
        reviews,
        totalCostUsd: 0.20,
        totalDurationMs: 7500,
      });

      (runEpisodeRetryLoop as any).mockResolvedValue({
        episodeId: 10,
        totalRetried: 2,
        totalPassed: 2,
        totalEscalated: 0,
        results: [
          { sliceId: 103, finalPassed: true, totalAttempts: 2, finalRoutingDecision: "pass", reviews: [makeFailingReview(103), makePassingReview(103, 2)], escalated: false, totalCostUsd: 0.24, totalDurationMs: 3000 },
          { sliceId: 104, finalPassed: true, totalAttempts: 2, finalRoutingDecision: "pass", reviews: [makeFailingReview(104), makePassingReview(104, 2)], escalated: false, totalCostUsd: 0.24, totalDurationMs: 3000 },
        ],
        totalCostUsd: 0.48,
        totalDurationMs: 6000,
        canProceedToAssembly: true,
      });

      const result = await runD5_5QualityGate(ctx);

      expect(result.canProceed).toBe(true);
      expect(result.passedFirstAttempt).toBe(3);
      expect(result.passedAfterRetry).toBe(2);
      expect(result.escalated).toBe(0);
      expect(runEpisodeRetryLoop).toHaveBeenCalledTimes(1);
      expect(saveClipReviewBatch).toHaveBeenCalledTimes(1);
    });

    it("blocks pipeline when escalations occur", async () => {
      const ctx = makeBaseContext(5);
      const reviews = [
        makePassingReview(100),
        makePassingReview(101),
        makePassingReview(102),
        makePassingReview(103),
        makeFailingReview(104),
      ];

      (runBatchD5_5Review as any).mockResolvedValue({
        episodeId: 10,
        projectId: 5,
        totalSlices: 5,
        passedSlices: 4,
        failedSlices: 1,
        escalatedSlices: 0,
        reviews,
        totalCostUsd: 0.20,
        totalDurationMs: 7500,
      });

      (runEpisodeRetryLoop as any).mockResolvedValue({
        episodeId: 10,
        totalRetried: 1,
        totalPassed: 0,
        totalEscalated: 1,
        results: [
          { sliceId: 104, finalPassed: false, totalAttempts: 3, finalRoutingDecision: "escalate", reviews: [makeFailingReview(104), makeFailingReview(104, 2), makeFailingReview(104, 3)], escalated: true, totalCostUsd: 0.52, totalDurationMs: 9000 },
        ],
        totalCostUsd: 0.52,
        totalDurationMs: 9000,
        canProceedToAssembly: false,
      });

      const result = await runD5_5QualityGate(ctx);

      expect(result.canProceed).toBe(false);
      expect(result.escalated).toBe(1);
      expect(result.passedFirstAttempt).toBe(4);
      expect(result.passedAfterRetry).toBe(0);
    });

    it("blocks pipeline when pass rate is below 85%", async () => {
      const ctx = makeBaseContext(10);
      // Only 7 pass (70% < 85%)
      const reviews = [
        ...Array.from({ length: 7 }, (_, i) => makePassingReview(100 + i)),
        ...Array.from({ length: 3 }, (_, i) => makeFailingReview(107 + i)),
      ];

      (runBatchD5_5Review as any).mockResolvedValue({
        episodeId: 10,
        projectId: 5,
        totalSlices: 10,
        passedSlices: 7,
        failedSlices: 3,
        escalatedSlices: 0,
        reviews,
        totalCostUsd: 0.40,
        totalDurationMs: 15000,
      });

      (runEpisodeRetryLoop as any).mockResolvedValue({
        episodeId: 10,
        totalRetried: 3,
        totalPassed: 1,  // Only 1 recovers → total = 8/10 = 80% < 85%
        totalEscalated: 2,
        results: [
          { sliceId: 107, finalPassed: true, totalAttempts: 2, finalRoutingDecision: "pass", reviews: [makeFailingReview(107), makePassingReview(107, 2)], escalated: false, totalCostUsd: 0.24, totalDurationMs: 3000 },
          { sliceId: 108, finalPassed: false, totalAttempts: 3, finalRoutingDecision: "escalate", reviews: [makeFailingReview(108), makeFailingReview(108, 2), makeFailingReview(108, 3)], escalated: true, totalCostUsd: 0.52, totalDurationMs: 9000 },
          { sliceId: 109, finalPassed: false, totalAttempts: 3, finalRoutingDecision: "escalate", reviews: [makeFailingReview(109), makeFailingReview(109, 2), makeFailingReview(109, 3)], escalated: true, totalCostUsd: 0.52, totalDurationMs: 9000 },
        ],
        totalCostUsd: 1.28,
        totalDurationMs: 21000,
        canProceedToAssembly: false,
      });

      const result = await runD5_5QualityGate(ctx);

      expect(result.canProceed).toBe(false);
      expect(result.totalClips).toBe(10);
      expect(result.passedFirstAttempt).toBe(7);
      expect(result.passedAfterRetry).toBe(1);
      expect(result.escalated).toBe(2);
    });

    it("handles empty clip assets gracefully", async () => {
      const ctx = makeBaseContext(0);
      ctx.clipAssets = [];
      ctx.panels = [];

      const result = await runD5_5QualityGate(ctx);

      expect(result.canProceed).toBe(true);
      expect(result.totalClips).toBe(0);
      expect(result.totalCostUsd).toBe(0);
      expect(runBatchD5_5Review).not.toHaveBeenCalled();
    });

    it("accumulates regeneration costs from callbacks", async () => {
      const ctx = makeBaseContext(3);
      const reviews = [
        makePassingReview(100),
        makeFailingReview(101),
        makePassingReview(102),
      ];

      (runBatchD5_5Review as any).mockResolvedValue({
        episodeId: 10,
        projectId: 5,
        totalSlices: 3,
        passedSlices: 2,
        failedSlices: 1,
        escalatedSlices: 0,
        reviews,
        totalCostUsd: 0.12,
        totalDurationMs: 4500,
      });

      // The retry loop calls regenerateClip which costs $0.20 each
      (runEpisodeRetryLoop as any).mockImplementation(async (options: any) => {
        // Simulate calling the regenerateVideo callback
        await options.callbacks.regenerateVideo(101, 2);
        return {
          episodeId: 10,
          totalRetried: 1,
          totalPassed: 1,
          totalEscalated: 0,
          results: [
            { sliceId: 101, finalPassed: true, totalAttempts: 2, finalRoutingDecision: "pass", reviews: [makeFailingReview(101), makePassingReview(101, 2)], escalated: false, totalCostUsd: 0.24, totalDurationMs: 3000 },
          ],
          totalCostUsd: 0.24,
          totalDurationMs: 3000,
          canProceedToAssembly: true,
        };
      });

      const result = await runD5_5QualityGate(ctx);

      expect(result.canProceed).toBe(true);
      // Total cost = batch review ($0.12) + retry review ($0.24) + regeneration ($0.20)
      expect(result.totalCostUsd).toBeCloseTo(0.56, 2);
      expect(ctx.regenerateClip).toHaveBeenCalledWith(101, 2);
    });

    it("provides correct clip results with attempt counts", async () => {
      const ctx = makeBaseContext(3);
      const reviews = [
        makePassingReview(100),
        makeFailingReview(101),
        makePassingReview(102),
      ];

      (runBatchD5_5Review as any).mockResolvedValue({
        episodeId: 10,
        projectId: 5,
        totalSlices: 3,
        passedSlices: 2,
        failedSlices: 1,
        escalatedSlices: 0,
        reviews,
        totalCostUsd: 0.12,
        totalDurationMs: 4500,
      });

      (runEpisodeRetryLoop as any).mockResolvedValue({
        episodeId: 10,
        totalRetried: 1,
        totalPassed: 1,
        totalEscalated: 0,
        results: [
          { sliceId: 101, finalPassed: true, totalAttempts: 2, finalRoutingDecision: "pass", reviews: [makeFailingReview(101), makePassingReview(101, 2)], escalated: false, totalCostUsd: 0.24, totalDurationMs: 3000 },
        ],
        totalCostUsd: 0.24,
        totalDurationMs: 3000,
        canProceedToAssembly: true,
      });

      const result = await runD5_5QualityGate(ctx);

      expect(result.clipResults).toHaveLength(3);
      // Panel 100: passed first attempt
      expect(result.clipResults[0]).toEqual({
        panelId: 100,
        panelNumber: 1,
        passed: true,
        score: 4,
        attempts: 1,
        escalated: false,
      });
      // Panel 101: passed after retry (2 initial + 1 = 3 total shown as totalAttempts+1)
      expect(result.clipResults[1]).toEqual({
        panelId: 101,
        panelNumber: 2,
        passed: true,
        score: 4,
        attempts: 3, // 2 retry attempts + 1 initial
        escalated: false,
      });
      // Panel 102: passed first attempt
      expect(result.clipResults[2]).toEqual({
        panelId: 102,
        panelNumber: 3,
        passed: true,
        score: 4,
        attempts: 1,
        escalated: false,
      });
    });

    it("passes correct batch options to runBatchD5_5Review", async () => {
      const ctx = makeBaseContext(2);
      const reviews = ctx.clipAssets.map(c => makePassingReview(c.panelId));

      (runBatchD5_5Review as any).mockResolvedValue({
        episodeId: 10,
        projectId: 5,
        totalSlices: 2,
        passedSlices: 2,
        failedSlices: 0,
        escalatedSlices: 0,
        reviews,
        totalCostUsd: 0.08,
        totalDurationMs: 3000,
      });

      await runD5_5QualityGate(ctx);

      expect(runBatchD5_5Review).toHaveBeenCalledWith(
        expect.objectContaining({
          episodeId: 10,
          projectId: 5,
          parallel: true,
          slices: expect.arrayContaining([
            expect.objectContaining({
              sliceId: 100,
              clipUrl: "https://s3.example.com/clips/panel-100.mp4",
              currentAttempt: 1,
            }),
          ]),
          characterBibles: ctx.characterBibles,
          styleLock: ctx.styleLock,
        })
      );
    });

    it("persists review results to database", async () => {
      const ctx = makeBaseContext(3);
      const reviews = ctx.clipAssets.map(c => makePassingReview(c.panelId));

      (runBatchD5_5Review as any).mockResolvedValue({
        episodeId: 10,
        projectId: 5,
        totalSlices: 3,
        passedSlices: 3,
        failedSlices: 0,
        escalatedSlices: 0,
        reviews,
        totalCostUsd: 0.12,
        totalDurationMs: 4500,
      });

      await runD5_5QualityGate(ctx);

      expect(saveClipReviewBatch).toHaveBeenCalledWith(
        reviews,
        {
          episodeId: 10,
          projectId: 5,
          pipelineRunId: 1,
          passThreshold: 3,
        }
      );
    });
  });

  describe("deriveStyleLock", () => {
    it("returns correct forbidden styles for shonen", () => {
      const lock = deriveStyleLock("shonen");
      expect(lock.primary).toBe("shonen");
      expect(lock.forbidden).toContain("chibi proportions");
      expect(lock.forbidden).toContain("pastel palette");
    });

    it("returns correct forbidden styles for seinen", () => {
      const lock = deriveStyleLock("seinen");
      expect(lock.forbidden).toContain("chibi proportions");
      expect(lock.forbidden).toContain("bright neon colors");
    });

    it("uses production bible artStyle as primary when available", () => {
      const lock = deriveStyleLock("shonen", { artStyle: "dark shonen with heavy inking" });
      expect(lock.primary).toBe("dark shonen with heavy inking");
    });

    it("returns empty forbidden list for unknown style", () => {
      const lock = deriveStyleLock("unknown_style");
      expect(lock.forbidden).toEqual([]);
    });

    it("returns tolerance band", () => {
      const lock = deriveStyleLock("cyberpunk");
      expect(lock.toleranceBand).toBe("minor_variation_acceptable");
    });
  });

  describe("buildCharacterBiblesMap", () => {
    it("builds map from character array", () => {
      const chars = [
        { name: "Akira", visualTraits: { hair: "black" }, referenceImages: ["url1"] },
        { name: "Yuki", visualTraits: { hair: "white" }, personalityTraits: ["calm"] },
      ];
      const map = buildCharacterBiblesMap(chars);

      expect(map.Akira.visualTraits.hair).toBe("black");
      expect(map.Akira.referenceImages).toEqual(["url1"]);
      expect(map.Yuki.personalityTraits).toEqual(["calm"]);
    });

    it("handles empty characters array", () => {
      const map = buildCharacterBiblesMap([]);
      expect(Object.keys(map)).toHaveLength(0);
    });

    it("provides defaults for missing fields", () => {
      const chars = [{ name: "Solo" }];
      const map = buildCharacterBiblesMap(chars);
      expect(map.Solo.visualTraits).toEqual({});
      expect(map.Solo.referenceImages).toEqual([]);
      expect(map.Solo.personalityTraits).toEqual([]);
    });
  });
});
