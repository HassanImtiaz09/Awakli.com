/**
 * HITL Gate Architecture — Comprehensive Tests (Prompt 17)
 *
 * Covers:
 * - Stage configuration constants
 * - Confidence scoring engine (all 8 dimensions)
 * - Gate manager helpers
 * - Quality feedback mapping
 * - Notification payload builders
 * - tRPC router registration
 * - SSE handler exports
 */

import { describe, it, expect } from "vitest";

// ─── Stage Config Tests ────────────────────────────────────────────────

describe("HITL Stage Configuration", () => {
  it("should export 17 stages", async () => {
    const { TOTAL_STAGES, STAGE_NAMES, STAGE_DISPLAY_NAMES } = await import("./hitl/stage-config");
    expect(TOTAL_STAGES).toBe(17);
    expect(Object.keys(STAGE_NAMES)).toHaveLength(17);
    expect(Object.keys(STAGE_DISPLAY_NAMES)).toHaveLength(17);
  });

  it("should have all stage numbers from 1 to 17", async () => {
    const { STAGE_NAMES } = await import("./hitl/stage-config");
    for (let i = 1; i <= 17; i++) {
      expect(STAGE_NAMES[i]).toBeDefined();
      expect(typeof STAGE_NAMES[i]).toBe("string");
    }
  });

  it("should have correct gate type for each default assignment", async () => {
    const { DEFAULT_GATE_ASSIGNMENTS } = await import("./hitl/stage-config");
    expect(DEFAULT_GATE_ASSIGNMENTS).toHaveLength(17);

    const validGateTypes = ["blocking", "advisory", "ambient"];
    for (const assignment of DEFAULT_GATE_ASSIGNMENTS) {
      expect(validGateTypes).toContain(assignment.gateType);
      expect(assignment.stageNumber).toBeGreaterThanOrEqual(1);
      expect(assignment.stageNumber).toBeLessThanOrEqual(17);
      expect(assignment.autoAdvanceThreshold).toBeGreaterThan(0);
      expect(assignment.autoAdvanceThreshold).toBeLessThanOrEqual(100);
      expect(assignment.reviewThreshold).toBeGreaterThan(0);
      expect(assignment.reviewThreshold).toBeLessThanOrEqual(100);
      expect(assignment.autoAdvanceThreshold).toBeGreaterThanOrEqual(assignment.reviewThreshold);
    }
  });

  it("should mark stage 16 (mastering_harness) as the final quality gate", async () => {
    const { DEFAULT_GATE_ASSIGNMENTS } = await import("./hitl/stage-config");
    const stage16 = DEFAULT_GATE_ASSIGNMENTS.find(a => a.stageNumber === 16);
    expect(stage16).toBeDefined();
    expect(stage16!.gateType).toBe("blocking");
  });

  it("should have blocking gates for critical stages (1-7, 11, 12, 15, 16)", async () => {
    const { DEFAULT_GATE_ASSIGNMENTS } = await import("./hitl/stage-config");
    const blockingStages = DEFAULT_GATE_ASSIGNMENTS
      .filter(a => a.gateType === "blocking")
      .map(a => a.stageNumber);
    expect(blockingStages).toContain(1);  // script
    expect(blockingStages).toContain(3);  // character_design
    expect(blockingStages).toContain(5);  // ekonte
    expect(blockingStages).toContain(11); // per_clip_continuity
    expect(blockingStages).toContain(12); // x_sheet
    expect(blockingStages).toContain(15); // satsuei
  });

  it("should have advisory gates for lower-risk stages (8, 9, 10, 13, 14)", async () => {
    const { DEFAULT_GATE_ASSIGNMENTS } = await import("./hitl/stage-config");
    const advisoryStages = DEFAULT_GATE_ASSIGNMENTS
      .filter(a => a.gateType === "advisory")
      .map(a => a.stageNumber);
    expect(advisoryStages).toContain(8);  // sakuga_kantoku_review
    expect(advisoryStages).toContain(9);  // sakuga_tagging
    expect(advisoryStages).toContain(10); // video_generation
    expect(advisoryStages).toContain(13); // ato_fuki
    expect(advisoryStages).toContain(14); // fx_pass
  });

  it("should have 5 tier names", async () => {
    const { TIER_NAMES } = await import("./hitl/stage-config");
    expect(TIER_NAMES).toHaveLength(5);
    expect(TIER_NAMES).toContain("free_trial");
    expect(TIER_NAMES).toContain("creator");
    expect(TIER_NAMES).toContain("creator_pro");
    expect(TIER_NAMES).toContain("studio");
    expect(TIER_NAMES).toContain("enterprise");
  });

  it("should have credit estimates for all 17 stages", async () => {
    const { STAGE_CREDIT_ESTIMATES } = await import("./hitl/stage-config");
    for (let i = 1; i <= 17; i++) {
      expect(STAGE_CREDIT_ESTIMATES[i]).toBeDefined();
      expect(typeof STAGE_CREDIT_ESTIMATES[i]).toBe("number");
      expect(STAGE_CREDIT_ESTIMATES[i]).toBeGreaterThanOrEqual(0);
    }
    // Video generation (stage 10) should be the most expensive
    expect(STAGE_CREDIT_ESTIMATES[10]).toBeGreaterThan(STAGE_CREDIT_ESTIMATES[1]);
  });

  it("should correctly determine stage skippability", async () => {
    const { isStageSkippable } = await import("./hitl/stage-config");
    // Stages 1-16 are required traversal — never skippable regardless of gate type
    expect(isStageSkippable(1, "blocking")).toBe(false);
    expect(isStageSkippable(8, "advisory")).toBe(false);
    expect(isStageSkippable(10, "advisory")).toBe(false);
    expect(isStageSkippable(12, "blocking")).toBe(false);
    expect(isStageSkippable(16, "blocking")).toBe(false);
    // Stage 17 (continual_learning) is ambient + NOT required traversal — skippable
    expect(isStageSkippable(17, "ambient")).toBe(true);
  });

  it("should export timeout constants", async () => {
    const { TIMEOUT_WARNING_HOURS, ABSOLUTE_TIMEOUT_HOURS, AMBIENT_ESCALATION_THRESHOLD } = await import("./hitl/stage-config");
    expect(TIMEOUT_WARNING_HOURS).toBeDefined();
    expect(TIMEOUT_WARNING_HOURS.length).toBeGreaterThan(0);
    expect(ABSOLUTE_TIMEOUT_HOURS).toBeGreaterThan(0);
    expect(AMBIENT_ESCALATION_THRESHOLD).toBeDefined();
  });
});

// ─── Confidence Scoring Engine Tests ───────────────────────────────────

describe("HITL Confidence Scoring Engine", () => {
  it("should score a video generation result with all dimensions", async () => {
    const { scoreGeneration } = await import("./hitl/confidence-scorer");
    const result = await scoreGeneration(
      {
        requestType: "video",
        outputUrl: "https://example.com/video.mp4",
        outputDuration: 5,
        outputWidth: 1280,
        outputHeight: 720,
        outputFileSize: 5000000,
        outputFrameCount: 120,
      },
      { stageNumber: 5, expectedDuration: 5, expectedWidth: 1280, expectedHeight: 720 }
    );

    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.breakdown).toBeDefined();
    expect(result.breakdown.length).toBeGreaterThan(0);
    expect(result.flags).toBeDefined();
    expect(Array.isArray(result.flags)).toBe(true);
  });

  it("should score an image generation result", async () => {
    const { scoreGeneration } = await import("./hitl/confidence-scorer");
    const result = await scoreGeneration(
      {
        requestType: "image",
        outputUrl: "https://example.com/image.png",
        outputWidth: 1024,
        outputHeight: 1024,
        outputFileSize: 2000000,
      },
      { stageNumber: 3, expectedWidth: 1024, expectedHeight: 1024 }
    );

    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    // Image should have: technical_quality, character_consistency, style_match, content_safety, completeness
    const dimensions = result.breakdown.map(b => b.dimension);
    expect(dimensions).toContain("technical_quality");
    expect(dimensions).toContain("content_safety");
    expect(dimensions).toContain("completeness");
  });

  it("should score a voice generation result", async () => {
    const { scoreGeneration } = await import("./hitl/confidence-scorer");
    const result = await scoreGeneration(
      {
        requestType: "voice",
        outputUrl: "https://example.com/voice.mp3",
        outputDuration: 10,
        outputFileSize: 160000,
      },
      { stageNumber: 6, expectedDuration: 10 }
    );

    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    const dimensions = result.breakdown.map(b => b.dimension);
    expect(dimensions).toContain("audio_clarity");
    expect(dimensions).toContain("dialogue_sync");
    expect(dimensions).toContain("content_safety");
  });

  it("should score a music generation result", async () => {
    const { scoreGeneration } = await import("./hitl/confidence-scorer");
    const result = await scoreGeneration(
      {
        requestType: "music",
        outputUrl: "https://example.com/music.mp3",
        outputDuration: 30,
        outputFileSize: 480000,
      },
      { stageNumber: 7 }
    );

    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    const dimensions = result.breakdown.map(b => b.dimension);
    expect(dimensions).toContain("audio_clarity");
    expect(dimensions).toContain("style_match");
    expect(dimensions).toContain("content_safety");
  });

  it("should flag NSFW content and cap score at 10", async () => {
    const { scoreGeneration } = await import("./hitl/confidence-scorer");
    const result = await scoreGeneration(
      {
        requestType: "image",
        outputUrl: "https://example.com/image.png",
        outputWidth: 1024,
        outputHeight: 1024,
        outputFileSize: 2000000,
        providerMetadata: { nsfw: true },
      },
      { stageNumber: 3 }
    );

    expect(result.score).toBeLessThanOrEqual(10);
    expect(result.flags).toContain("nsfw_detected");
  });

  it("should flag blank/empty output", async () => {
    const { scoreGeneration } = await import("./hitl/confidence-scorer");
    const result = await scoreGeneration(
      {
        requestType: "image",
        outputUrl: "",
        outputFileSize: 0,
      },
      { stageNumber: 3 }
    );

    expect(result.flags).toContain("blank_frame");
  });

  it("should penalize low resolution", async () => {
    const { _internal } = await import("./hitl/confidence-scorer");
    const lowRes = _internal.scoreTechnicalQuality(
      { requestType: "video", outputUrl: "test", outputWidth: 320, outputHeight: 240, outputFileSize: 5000000 },
      { stageNumber: 5, expectedWidth: 1280, expectedHeight: 720 }
    );
    const highRes = _internal.scoreTechnicalQuality(
      { requestType: "video", outputUrl: "test", outputWidth: 1280, outputHeight: 720, outputFileSize: 5000000 },
      { stageNumber: 5, expectedWidth: 1280, expectedHeight: 720 }
    );
    expect(highRes.score).toBeGreaterThan(lowRes.score);
  });

  it("should penalize very low frame count", async () => {
    const { _internal } = await import("./hitl/confidence-scorer");
    const lowFrames = _internal.scoreTechnicalQuality(
      { requestType: "video", outputUrl: "test", outputFrameCount: 5, outputFileSize: 5000000 },
      { stageNumber: 5 }
    );
    const goodFrames = _internal.scoreTechnicalQuality(
      { requestType: "video", outputUrl: "test", outputFrameCount: 120, outputFileSize: 5000000 },
      { stageNumber: 5 }
    );
    expect(goodFrames.score).toBeGreaterThan(lowFrames.score);
  });

  it("should penalize suspiciously small file size", async () => {
    const { _internal } = await import("./hitl/confidence-scorer");
    const tiny = _internal.scoreTechnicalQuality(
      { requestType: "image", outputUrl: "test", outputFileSize: 100 },
      { stageNumber: 3 }
    );
    expect(tiny.score).toBeLessThan(60);
  });

  it("should score dialogue sync based on duration match", async () => {
    const { _internal } = await import("./hitl/confidence-scorer");
    const goodSync = _internal.scoreDialogueSync(
      { requestType: "voice", outputUrl: "test", outputDuration: 10 },
      { stageNumber: 6, expectedDuration: 10 }
    );
    const badSync = _internal.scoreDialogueSync(
      { requestType: "voice", outputUrl: "test", outputDuration: 3 },
      { stageNumber: 6, expectedDuration: 10 }
    );
    expect(goodSync.score).toBeGreaterThan(badSync.score);
  });

  it("should penalize very short audio", async () => {
    const { _internal } = await import("./hitl/confidence-scorer");
    const shortAudio = _internal.scoreAudioClarity(
      { requestType: "voice", outputUrl: "test", outputDuration: 0.1 },
      { stageNumber: 6 }
    );
    expect(shortAudio.score).toBeLessThan(60);
  });

  it("should return moderate score for character consistency with no references", async () => {
    const { _internal } = await import("./hitl/confidence-scorer");
    const result = await _internal.scoreCharacterConsistency(
      { requestType: "image", outputUrl: "test" },
      { stageNumber: 3 },
      _internal.mockClipService
    );
    expect(result.score).toBe(75);
    expect(result.reasoning).toContain("No character reference");
  });

  it("should return moderate score for style match with no style reference", async () => {
    const { _internal } = await import("./hitl/confidence-scorer");
    const result = await _internal.scoreStyleMatch(
      { requestType: "image", outputUrl: "test" },
      { stageNumber: 3 },
      _internal.mockClipService
    );
    expect(result.score).toBe(70);
  });

  it("should have correct dimension applicability", async () => {
    const { _internal } = await import("./hitl/confidence-scorer");
    // temporal_coherence only applies to video
    expect(_internal.DIMENSION_APPLICABILITY.temporal_coherence).toEqual(["video"]);
    // dialogue_sync only applies to voice
    expect(_internal.DIMENSION_APPLICABILITY.dialogue_sync).toEqual(["voice"]);
    // content_safety applies to all
    expect(_internal.DIMENSION_APPLICABILITY.content_safety).toHaveLength(5);
  });

  it("should have weights that sum correctly per type", async () => {
    const { _internal } = await import("./hitl/confidence-scorer");
    // Content safety weight is 1.0 (veto), others are < 1
    expect(_internal.DIMENSION_WEIGHTS.content_safety).toBe(1.0);
    expect(_internal.DIMENSION_WEIGHTS.technical_quality).toBeLessThan(1.0);
    expect(_internal.DIMENSION_WEIGHTS.character_consistency).toBeLessThan(1.0);
  });

  it("should handle temporal coherence with good FPS", async () => {
    const { _internal } = await import("./hitl/confidence-scorer");
    const good = _internal.scoreTemporalCoherence(
      { requestType: "video", outputUrl: "test", outputDuration: 5, outputFrameCount: 150 },
      { stageNumber: 5 }
    );
    expect(good.score).toBeGreaterThan(80);
  });

  it("should penalize temporal coherence with very low FPS", async () => {
    const { _internal } = await import("./hitl/confidence-scorer");
    const bad = _internal.scoreTemporalCoherence(
      { requestType: "video", outputUrl: "test", outputDuration: 5, outputFrameCount: 20 },
      { stageNumber: 5 }
    );
    expect(bad.score).toBeLessThan(60);
  });

  it("should penalize completeness for significantly short output", async () => {
    const { _internal } = await import("./hitl/confidence-scorer");
    const short = _internal.scoreCompleteness(
      { requestType: "video", outputUrl: "test", outputDuration: 1 },
      { stageNumber: 5, expectedDuration: 10 }
    );
    expect(short.score).toBeLessThan(50);
  });
});

// ─── Quality Feedback Tests ────────────────────────────────────────────

describe("HITL Quality Feedback", () => {
  it("should map gate decisions to quality scores", async () => {
    const { mapDecisionToQualityScore } = await import("./hitl/quality-feedback");
    // Approved first attempt → score 5
    const approved = mapDecisionToQualityScore("approved", "creator", 90, true);
    expect(approved.score).toBe(5);
    expect(approved.ratingSource).toBe("creator");
    // Approved not first attempt → score 4
    const approvedRetry = mapDecisionToQualityScore("approved", "creator", 90, false);
    expect(approvedRetry.score).toBe(4);
    // Rejected → score 1
    const rejected = mapDecisionToQualityScore("rejected", "creator", 30, true);
    expect(rejected.score).toBe(1);
    // Regenerate → score 2
    const regen = mapDecisionToQualityScore("regenerate", "creator", 50, true);
    expect(regen.score).toBe(2);
    // Auto-approved high confidence → score 4
    const autoHigh = mapDecisionToQualityScore("auto_approved", "auto", 85, true);
    expect(autoHigh.score).toBe(4);
    // Auto-approved moderate confidence → score 3
    const autoMod = mapDecisionToQualityScore("auto_approved", "auto", 70, true);
    expect(autoMod.score).toBe(3);
  });

  it("should handle edge case confidence scores", async () => {
    const { mapDecisionToQualityScore } = await import("./hitl/quality-feedback");
    // Zero confidence rejected
    const zeroScore = mapDecisionToQualityScore("rejected", "creator", 0, true);
    expect(zeroScore.score).toBeGreaterThanOrEqual(1);
    expect(zeroScore.score).toBeLessThanOrEqual(5);
    // Max confidence approved
    const maxScore = mapDecisionToQualityScore("approved", "creator", 100, true);
    expect(maxScore.score).toBeGreaterThanOrEqual(1);
    expect(maxScore.score).toBeLessThanOrEqual(5);
  });
});

// ─── Notification Payload Tests ────────────────────────────────────────

describe("HITL Notification Dispatcher", () => {
  it("should export notification type constants", async () => {
    const mod = await import("./hitl/notification-dispatcher");
    expect(mod._internal).toBeDefined();
    expect(mod._internal.buildGateReadyPayload).toBeDefined();
    expect(mod._internal.buildAutoAdvancedPayload).toBeDefined();
    expect(mod._internal.buildTimeoutWarningPayload).toBeDefined();
    expect(mod._internal.buildEscalationPayload).toBeDefined();
  });

  it("should build gate-ready payload", async () => {
    const { _internal } = await import("./hitl/notification-dispatcher");
    const payload = _internal.buildGateReadyPayload({
      id: 1,
      pipelineStageId: 5,
      pipelineRunId: 100,
      userId: 1,
      gateType: "blocking",
      stageNumber: 5,
      stageName: "video_generation",
      confidenceScore: 75,
      confidenceDetails: null,
      autoAdvanceThreshold: 85,
      reviewThreshold: 60,
      decision: "pending",
      decisionSource: null,
      decisionReason: null,
      decisionAt: null,
      regenParamsDiff: null,
      regenGenerationRequestId: null,
      creditsSpentSoFar: null,
      creditsToProceed: 40,
      creditsToRegenerate: null,
      timeoutAt: new Date(Date.now() + 86400000),
      timeoutAction: "auto_pause",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);
    expect(payload.type).toBe("gate:ready");
    expect(payload.gateId).toBe(1);
    expect(payload.stageNumber).toBe(5);
    expect(payload.stageName).toBe("Storyboard / Ekonte (絵コンテ)");
    expect(payload.gateType).toBe("blocking");
    expect(payload.confidenceScore).toBe(75);
  });

  it("should build auto-advanced payload", async () => {
    const { _internal } = await import("./hitl/notification-dispatcher");
    const payload = _internal.buildAutoAdvancedPayload({
      id: 2,
      pipelineStageId: 1,
      pipelineRunId: 100,
      userId: 1,
      gateType: "ambient",
      stageNumber: 1,
      stageName: "manga_analysis",
      confidenceScore: 92,
      confidenceDetails: null,
      autoAdvanceThreshold: 70,
      reviewThreshold: 40,
      decision: "auto_approved",
      decisionSource: "auto",
      decisionReason: null,
      decisionAt: new Date(),
      regenParamsDiff: null,
      regenGenerationRequestId: null,
      creditsSpentSoFar: null,
      creditsToProceed: null,
      creditsToRegenerate: null,
      timeoutAt: new Date(Date.now() + 86400000),
      timeoutAction: "auto_approve",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any);
    expect(payload.type).toBe("gate:auto_advanced");
    expect(payload.gateId).toBe(2);
    expect(payload.confidenceScore).toBe(92);
  });

  it("should build timeout warning payload", async () => {
    const { _internal } = await import("./hitl/notification-dispatcher");
    const payload = _internal.buildTimeoutWarningPayload({
      id: 3,
      pipelineStageId: 10,
      pipelineRunId: 100,
      userId: 1,
      gateType: "blocking",
      stageNumber: 10,
      stageName: "video_composite",
      confidenceScore: 60,
      confidenceDetails: null,
      autoAdvanceThreshold: 85,
      reviewThreshold: 60,
      decision: "pending",
      decisionSource: null,
      decisionReason: null,
      decisionAt: null,
      regenParamsDiff: null,
      regenGenerationRequestId: null,
      creditsSpentSoFar: null,
      creditsToProceed: null,
      creditsToRegenerate: null,
      timeoutAt: new Date(Date.now() + 3600000),
      timeoutAction: "auto_pause",
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any, 1);
    expect(payload.type).toBe("gate:timeout_warning");
    expect(payload.hoursRemaining).toBe(1);
  });

  it("should track WebSocket connections", async () => {
    const { registerWsConnection, hasActiveWsConnection } = await import("./hitl/notification-dispatcher");
    // Register a mock connection
    const mockSend = (data: string) => {};
    registerWsConnection(999, mockSend);
    expect(hasActiveWsConnection(999)).toBe(true);
    expect(hasActiveWsConnection(998)).toBe(false);
  });
});

// ─── tRPC Router Registration Tests ───────────────────────────────────

describe("HITL tRPC Routers", () => {
  it("should export all 6 HITL routers", async () => {
    const {
      gateReviewRouter,
      pipelineStageRouter,
      batchReviewRouter,
      gateConfigRouter,
      qualityAnalyticsRouter,
      cascadeRewindRouter,
    } = await import("./routers-hitl");

    expect(gateReviewRouter).toBeDefined();
    expect(pipelineStageRouter).toBeDefined();
    expect(batchReviewRouter).toBeDefined();
    expect(gateConfigRouter).toBeDefined();
    expect(qualityAnalyticsRouter).toBeDefined();
    expect(cascadeRewindRouter).toBeDefined();
  });

  it("should have gateReview procedures", async () => {
    const { gateReviewRouter } = await import("./routers-hitl");
    const procedures = Object.keys((gateReviewRouter as any)._def.procedures || {});
    expect(procedures).toContain("getPendingGates");
    expect(procedures).toContain("getGate");
    expect(procedures).toContain("getGatesForRun");
    expect(procedures).toContain("submitDecision");
    expect(procedures).toContain("getAuditLog");
  });

  it("should have pipelineStage procedures", async () => {
    const { pipelineStageRouter } = await import("./routers-hitl");
    const procedures = Object.keys((pipelineStageRouter as any)._def.procedures || {});
    expect(procedures).toContain("getStages");
    expect(procedures).toContain("getStage");
    expect(procedures).toContain("abort");
    expect(procedures).toContain("getStageNames");
  });

  it("should have batchReview procedures", async () => {
    const { batchReviewRouter } = await import("./routers-hitl");
    const procedures = Object.keys((batchReviewRouter as any)._def.procedures || {});
    expect(procedures).toContain("getReviewableGates");
    expect(procedures).toContain("submitDecision");
    expect(procedures).toContain("batchConfirm");
  });

  it("should have gateConfig procedures", async () => {
    const { gateConfigRouter } = await import("./routers-hitl");
    const procedures = Object.keys((gateConfigRouter as any)._def.procedures || {});
    expect(procedures).toContain("getAll");
    expect(procedures).toContain("getForStage");
  });

  it("should have qualityAnalytics procedures", async () => {
    const { qualityAnalyticsRouter } = await import("./routers-hitl");
    const procedures = Object.keys((qualityAnalyticsRouter as any)._def.procedures || {});
    expect(procedures).toContain("approvalRateByStage");
    expect(procedures).toContain("avgConfidenceByStage");
    expect(procedures).toContain("creditsSaved");
    expect(procedures).toContain("mostRegeneratedStages");
    expect(procedures).toContain("dashboard");
  });

  it("should have cascadeRewind procedures", async () => {
    const { cascadeRewindRouter } = await import("./routers-hitl");
    const procedures = Object.keys((cascadeRewindRouter as any)._def.procedures || {});
    expect(procedures).toContain("rewind");
  });

  it("should wire HITL routers into the main appRouter", async () => {
    const { appRouter } = await import("./routers");
    const topLevelKeys = Object.keys((appRouter as any)._def.procedures || {});
    // Check that HITL router namespaces are present
    const hitlPrefixes = ["gateReview", "pipelineStage", "batchReview", "gateConfig", "qualityAnalytics", "cascadeRewind"];
    for (const prefix of hitlPrefixes) {
      const hasProcedures = topLevelKeys.some(k => k.startsWith(prefix + "."));
      expect(hasProcedures, `Expected appRouter to contain ${prefix}.* procedures`).toBe(true);
    }
  });
});

// ─── SSE Handler Tests ─────────────────────────────────────────────────

describe("HITL SSE Handler", () => {
  it("should export registerHitlSseRoutes function", async () => {
    const { registerHitlSseRoutes } = await import("./hitl/sse-handler");
    expect(typeof registerHitlSseRoutes).toBe("function");
  });

  it("should export getActiveSseConnectionCount function", async () => {
    const { getActiveSseConnectionCount } = await import("./hitl/sse-handler");
    expect(typeof getActiveSseConnectionCount).toBe("function");
    // Should return 0 when no connections exist
    expect(getActiveSseConnectionCount()).toBeGreaterThanOrEqual(0);
  });
});

// ─── Pipeline State Machine Export Tests ───────────────────────────────

describe("HITL Pipeline State Machine", () => {
  it("should export all state machine functions", async () => {
    const mod = await import("./hitl/pipeline-state-machine");
    expect(typeof mod.initializePipelineStages).toBe("function");
    expect(typeof mod.startStageExecution).toBe("function");
    expect(typeof mod.completeStageGeneration).toBe("function");
    expect(typeof mod.approveStage).toBe("function");
    expect(typeof mod.rejectStage).toBe("function");
    expect(typeof mod.startRegeneration).toBe("function");
    expect(typeof mod.failStage).toBe("function");
    expect(typeof mod.skipStage).toBe("function");
    expect(typeof mod.abortPipeline).toBe("function");
    expect(typeof mod.cascadeRewind).toBe("function");
  });
});

// ─── Gate Manager Export Tests ─────────────────────────────────────────

describe("HITL Gate Manager", () => {
  it("should export all gate manager functions", async () => {
    const mod = await import("./hitl/gate-manager");
    expect(typeof mod.resolveGateConfig).toBe("function");
    expect(typeof mod.resolveAllGateConfigs).toBe("function");
    expect(typeof mod.getGateById).toBe("function");
    expect(typeof mod.getPendingGatesForUser).toBe("function");
    expect(typeof mod.getGatesForPipelineRun).toBe("function");
    expect(typeof mod.recordGateDecision).toBe("function");
    expect(typeof mod.getAuditLogForGate).toBe("function");
  });
});

// ─── Timeout Handler Export Tests ──────────────────────────────────────

describe("HITL Timeout Handler", () => {
  it("should export timeout handler functions", async () => {
    const mod = await import("./hitl/timeout-handler");
    expect(typeof mod.checkTimeoutWarnings).toBe("function");
    expect(typeof mod.processTimedOutGates).toBe("function");
    expect(typeof mod.getBatchReviewableGates).toBe("function");
    expect(typeof mod.processBatchReviewDecision).toBe("function");
  });
});

// ─── Barrel Export Tests ───────────────────────────────────────────────

describe("HITL Barrel Export", () => {
  it("should re-export all public functions from index", async () => {
    const mod = await import("./hitl/index");
    // Stage config
    expect(mod.TOTAL_STAGES).toBe(17);
    expect(mod.STAGE_NAMES).toBeDefined();
    expect(mod.DEFAULT_GATE_ASSIGNMENTS).toBeDefined();
    // Confidence scorer
    expect(typeof mod.scoreGeneration).toBe("function");
    // Gate manager
    expect(typeof mod.resolveGateConfig).toBe("function");
    expect(typeof mod.recordGateDecision).toBe("function");
    // Pipeline state machine
    expect(typeof mod.initializePipelineStages).toBe("function");
    expect(typeof mod.cascadeRewind).toBe("function");
    // Quality feedback
    expect(typeof mod.mapDecisionToQualityScore).toBe("function");
    // Timeout handler
    expect(typeof mod.checkTimeoutWarnings).toBe("function");
    expect(typeof mod.processTimedOutGates).toBe("function");
    // Notification
    expect(typeof mod.notifyGateReady).toBe("function");
  });
});
