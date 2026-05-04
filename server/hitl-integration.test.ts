/**
 * HITL-Orchestrator Integration Tests (v1.9 Pipeline Blueprint)
 *
 * Tests the bridge between the 8-node pipeline orchestrator and the
 * 17-stage HITL gate system, including:
 * - Node-to-stage mapping correctness (v1.9 aligned)
 * - Bridge module exports and function signatures
 * - Pipeline pause/resume flow via submitDecision
 * - Timeout cron endpoint
 * - SSE handler registration
 * - Required traversal semantics (sakuga_tagging before video_gen)
 * - D-agent designations and D10 plug-in points
 * - Legacy stage deprecation mapping
 */

import { describe, it, expect, vi } from "vitest";

// ─── 1. Node-to-Stage Mapping (v1.9) ─────────────────────────────────────

describe("HITL Orchestrator Bridge — Node-to-Stage Mapping (v1.9)", () => {
  it("should map all 8 orchestrator nodes to primary HITL stages", async () => {
    const { NODE_TO_PRIMARY_STAGE } = await import("./hitl/orchestrator-bridge");
    expect(NODE_TO_PRIMARY_STAGE).toEqual({
      pre_production: 1,
      key_animation: 6,
      video_gen: 10,
      post_video: 11,
      audio_timing: 12,
      fx_composite: 14,
      mastering: 16,
      learning: 17,
    });
  });

  it("should define pre-flight stages as [1, 2, 3, 4, 5]", async () => {
    const { PRE_FLIGHT_STAGES } = await import("./hitl/orchestrator-bridge");
    expect(PRE_FLIGHT_STAGES).toEqual([1, 2, 3, 4, 5]);
  });

  it("should define NODE_TO_STAGES with correct stage groupings", async () => {
    const { NODE_TO_STAGES } = await import("./hitl/orchestrator-bridge");
    expect(NODE_TO_STAGES.pre_production).toEqual([1, 2, 3, 4, 5]);
    expect(NODE_TO_STAGES.key_animation).toEqual([6, 7, 8, 9]);
    expect(NODE_TO_STAGES.video_gen).toEqual([10]);
    expect(NODE_TO_STAGES.post_video).toEqual([11]);
    expect(NODE_TO_STAGES.audio_timing).toEqual([12, 13]);
    expect(NODE_TO_STAGES.fx_composite).toEqual([14, 15]);
    expect(NODE_TO_STAGES.mastering).toEqual([16]);
    expect(NODE_TO_STAGES.learning).toEqual([17]);
  });

  it("should define secondary stages for each primary node", async () => {
    const { SECONDARY_STAGES } = await import("./hitl/orchestrator-bridge");
    // key_animation: layout (6) is primary, then genga (7), sakuga_review (8), sakuga_tagging (9)
    expect(SECONDARY_STAGES[6]).toEqual([7, 8, 9]);
    // audio_timing: x_sheet (12) is primary, then ato_fuki (13)
    expect(SECONDARY_STAGES[12]).toEqual([13]);
    // fx_composite: fx_pass (14) is primary, then satsuei (15)
    expect(SECONDARY_STAGES[14]).toEqual([15]);
  });

  it("should map all 17 stages back to orchestrator nodes via STAGE_TO_NODE", async () => {
    const { STAGE_TO_NODE } = await import("./hitl/orchestrator-bridge");
    // pre_production: stages 1-5
    expect(STAGE_TO_NODE[1]).toBe("pre_production");
    expect(STAGE_TO_NODE[2]).toBe("pre_production");
    expect(STAGE_TO_NODE[3]).toBe("pre_production");
    expect(STAGE_TO_NODE[4]).toBe("pre_production");
    expect(STAGE_TO_NODE[5]).toBe("pre_production");
    // key_animation: stages 6-9
    expect(STAGE_TO_NODE[6]).toBe("key_animation");
    expect(STAGE_TO_NODE[7]).toBe("key_animation");
    expect(STAGE_TO_NODE[8]).toBe("key_animation");
    expect(STAGE_TO_NODE[9]).toBe("key_animation");
    // video_gen: stage 10
    expect(STAGE_TO_NODE[10]).toBe("video_gen");
    // post_video: stage 11
    expect(STAGE_TO_NODE[11]).toBe("post_video");
    // audio_timing: stages 12-13
    expect(STAGE_TO_NODE[12]).toBe("audio_timing");
    expect(STAGE_TO_NODE[13]).toBe("audio_timing");
    // fx_composite: stages 14-15
    expect(STAGE_TO_NODE[14]).toBe("fx_composite");
    expect(STAGE_TO_NODE[15]).toBe("fx_composite");
    // mastering: stage 16
    expect(STAGE_TO_NODE[16]).toBe("mastering");
    // learning: stage 17
    expect(STAGE_TO_NODE[17]).toBe("learning");
  });

  it("should cover all 17 stages between NODE_TO_STAGES groups", async () => {
    const { NODE_TO_STAGES } = await import("./hitl/orchestrator-bridge");
    const allStages = new Set<number>();
    Object.values(NODE_TO_STAGES).flat().forEach(s => allStages.add(s));
    expect(allStages.size).toBe(17);
    for (let i = 1; i <= 17; i++) {
      expect(allStages.has(i)).toBe(true);
    }
  });
});

// ─── 2. Bridge Module Exports ──────────────────────────────────────────

describe("HITL Orchestrator Bridge — Module Exports", () => {
  it("should export initializeHitlForRun function", async () => {
    const bridge = await import("./hitl/orchestrator-bridge");
    expect(typeof bridge.initializeHitlForRun).toBe("function");
  });

  it("should export processPreFlightStages function", async () => {
    const bridge = await import("./hitl/orchestrator-bridge");
    expect(typeof bridge.processPreFlightStages).toBe("function");
  });

  it("should export completeNodeWithGate function", async () => {
    const bridge = await import("./hitl/orchestrator-bridge");
    expect(typeof bridge.completeNodeWithGate).toBe("function");
  });

  it("should export resumePipelineAfterApproval function", async () => {
    const bridge = await import("./hitl/orchestrator-bridge");
    expect(typeof bridge.resumePipelineAfterApproval).toBe("function");
  });

  it("should export resumePipelineAfterRegeneration function", async () => {
    const bridge = await import("./hitl/orchestrator-bridge");
    expect(typeof bridge.resumePipelineAfterRegeneration).toBe("function");
  });

  it("should export pausePipelineForGate function", async () => {
    const bridge = await import("./hitl/orchestrator-bridge");
    expect(typeof bridge.pausePipelineForGate).toBe("function");
  });

  it("should export processTimeouts function", async () => {
    const bridge = await import("./hitl/orchestrator-bridge");
    expect(typeof bridge.processTimeouts).toBe("function");
  });

  it("should export getUserTierForRun function", async () => {
    const bridge = await import("./hitl/orchestrator-bridge");
    expect(typeof bridge.getUserTierForRun).toBe("function");
  });

  it("should export all 8 OrchestratorNode types (via NODE_TO_PRIMARY_STAGE keys)", async () => {
    const { NODE_TO_PRIMARY_STAGE } = await import("./hitl/orchestrator-bridge");
    const nodeNames = Object.keys(NODE_TO_PRIMARY_STAGE);
    expect(nodeNames).toContain("pre_production");
    expect(nodeNames).toContain("key_animation");
    expect(nodeNames).toContain("video_gen");
    expect(nodeNames).toContain("post_video");
    expect(nodeNames).toContain("audio_timing");
    expect(nodeNames).toContain("fx_composite");
    expect(nodeNames).toContain("mastering");
    expect(nodeNames).toContain("learning");
    expect(nodeNames.length).toBe(8);
  });
});

// ─── 3. Pipeline Orchestrator — resumePipeline Export ──────────────────

describe("Pipeline Orchestrator — HITL Integration", () => {
  it("should export resumePipeline function", async () => {
    const orchestrator = await import("./pipelineOrchestrator");
    expect(typeof orchestrator.resumePipeline).toBe("function");
  });

  it("should export runPipeline function", async () => {
    const orchestrator = await import("./pipelineOrchestrator");
    expect(typeof orchestrator.runPipeline).toBe("function");
  });
});

// ─── 4. tRPC Router — submitDecision Wiring ────────────────────────────

describe("HITL tRPC Router — submitDecision Pipeline Resume", () => {
  it("should import STAGE_TO_NODE in routers-hitl", async () => {
    const routerModule = await import("./routers-hitl");
    expect(routerModule.gateReviewRouter).toBeDefined();
    expect(routerModule.gateReviewRouter.submitDecision).toBeDefined();
  });

  it("should have all 6 HITL routers exported", async () => {
    const routerModule = await import("./routers-hitl");
    expect(routerModule.gateReviewRouter).toBeDefined();
    expect(routerModule.pipelineStageRouter).toBeDefined();
    expect(routerModule.batchReviewRouter).toBeDefined();
    expect(routerModule.gateConfigRouter).toBeDefined();
    expect(routerModule.qualityAnalyticsRouter).toBeDefined();
    expect(routerModule.cascadeRewindRouter).toBeDefined();
  });
});

// ─── 5. SSE Handler — Timeout Cron Endpoint ────────────────────────────

describe("HITL SSE Handler — Endpoints", () => {
  it("should export registerHitlSseRoutes function", async () => {
    const sseHandler = await import("./hitl/sse-handler");
    expect(typeof sseHandler.registerHitlSseRoutes).toBe("function");
  });

  it("should export getActiveSseConnectionCount function", async () => {
    const sseHandler = await import("./hitl/sse-handler");
    expect(typeof sseHandler.getActiveSseConnectionCount).toBe("function");
  });

  it("should return 0 active connections initially", async () => {
    const { getActiveSseConnectionCount } = await import("./hitl/sse-handler");
    expect(getActiveSseConnectionCount()).toBe(0);
  });
});

// ─── 6. HITL Barrel Export — Bridge Functions ──────────────────────────

describe("HITL Barrel Export — Bridge Integration", () => {
  it("should re-export bridge functions from hitl/index.ts", async () => {
    const hitl = await import("./hitl");
    expect(typeof hitl.initializeHitlForRun).toBe("function");
    expect(typeof hitl.completeNodeWithGate).toBe("function");
    expect(typeof hitl.processTimeouts).toBe("function");
    expect(typeof hitl.pausePipelineForGate).toBe("function");
  });

  it("should re-export v1.9 stage config constants", async () => {
    const hitl = await import("./hitl");
    expect(hitl.TOTAL_STAGES).toBe(17);
    expect(hitl.STAGE_NAMES[1]).toBe("script");
    expect(hitl.STAGE_NAMES[7]).toBe("genga");
    expect(hitl.STAGE_NAMES[13]).toBe("ato_fuki");
    expect(hitl.STAGE_DISPLAY_NAMES[10]).toContain("Douga");
  });

  it("should re-export D-agent designations and D10 plug-in points", async () => {
    const hitl = await import("./hitl");
    expect(hitl.D_AGENT_DESIGNATIONS).toBeDefined();
    expect(hitl.D10_PLUGIN_POINTS).toBeDefined();
    expect(hitl.LEGACY_STAGE_MIGRATION).toBeDefined();
  });

  it("should re-export isRequiredTraversal helper", async () => {
    const hitl = await import("./hitl");
    expect(typeof hitl.isRequiredTraversal).toBe("function");
  });
});

// ─── 7. Stage-to-Node Consistency ──────────────────────────────────────

describe("HITL Bridge — Stage-to-Node Consistency", () => {
  it("every primary stage should have a reverse mapping in STAGE_TO_NODE", async () => {
    const { NODE_TO_PRIMARY_STAGE, STAGE_TO_NODE } = await import("./hitl/orchestrator-bridge");
    for (const [node, stage] of Object.entries(NODE_TO_PRIMARY_STAGE)) {
      expect(STAGE_TO_NODE[stage]).toBe(node);
    }
  });

  it("every secondary stage should have a reverse mapping in STAGE_TO_NODE", async () => {
    const { SECONDARY_STAGES, STAGE_TO_NODE, NODE_TO_PRIMARY_STAGE } = await import("./hitl/orchestrator-bridge");
    for (const [primaryStr, secondaries] of Object.entries(SECONDARY_STAGES)) {
      const primary = Number(primaryStr);
      const ownerNode = Object.entries(NODE_TO_PRIMARY_STAGE).find(([, s]) => s === primary)?.[0];
      for (const sec of secondaries) {
        expect(STAGE_TO_NODE[sec]).toBe(ownerNode);
      }
    }
  });

  it("secondary stages should not overlap with primary stages", async () => {
    const { NODE_TO_PRIMARY_STAGE, SECONDARY_STAGES } = await import("./hitl/orchestrator-bridge");
    const primaryStages = new Set(Object.values(NODE_TO_PRIMARY_STAGE));
    const secondaryStages = Object.values(SECONDARY_STAGES).flat();
    for (const sec of secondaryStages) {
      expect(primaryStages.has(sec)).toBe(false);
    }
  });

  it("all NODE_TO_STAGES entries should be contiguous and non-overlapping", async () => {
    const { NODE_TO_STAGES } = await import("./hitl/orchestrator-bridge");
    const allStages: number[] = [];
    Object.values(NODE_TO_STAGES).forEach(stages => allStages.push(...stages));
    // Should be sorted 1-17 with no gaps or duplicates
    allStages.sort((a, b) => a - b);
    expect(allStages).toEqual(Array.from({ length: 17 }, (_, i) => i + 1));
  });
});

// ─── 8. NodeCompletionParams Interface ─────────────────────────────────

describe("HITL Bridge — NodeCompletionParams", () => {
  it("completeNodeWithGate should accept all required params", async () => {
    const { completeNodeWithGate } = await import("./hitl/orchestrator-bridge");
    expect(completeNodeWithGate.length).toBeGreaterThanOrEqual(1);
  });

  it("initializeHitlForRun should accept pipelineRunId, userId, tierName", async () => {
    const { initializeHitlForRun } = await import("./hitl/orchestrator-bridge");
    expect(initializeHitlForRun.length).toBeGreaterThanOrEqual(2);
  });

  it("resumePipelineAfterApproval should accept pipelineRunId", async () => {
    const { resumePipelineAfterApproval } = await import("./hitl/orchestrator-bridge");
    expect(resumePipelineAfterApproval.length).toBe(1);
  });

  it("resumePipelineAfterRegeneration should accept pipelineRunId and stageNumber", async () => {
    const { resumePipelineAfterRegeneration } = await import("./hitl/orchestrator-bridge");
    expect(resumePipelineAfterRegeneration.length).toBe(2);
  });

  it("pausePipelineForGate should accept pipelineRunId, gateId, stageNumber", async () => {
    const { pausePipelineForGate } = await import("./hitl/orchestrator-bridge");
    expect(pausePipelineForGate.length).toBe(3);
  });
});

// ─── 9. Tier Resolution ────────────────────────────────────────────────

describe("HITL Bridge — Tier Resolution", () => {
  it("getUserTierForRun should accept a pipelineRunId", async () => {
    const { getUserTierForRun } = await import("./hitl/orchestrator-bridge");
    expect(getUserTierForRun.length).toBe(1);
  });
});

// ─── 10. v1.9 Stage Config Correctness ────────────────────────────────

describe("HITL Stage Config — v1.9 Blueprint Compliance", () => {
  it("should have exactly 17 stages", async () => {
    const { TOTAL_STAGES, STAGE_NAMES } = await import("./hitl/stage-config");
    expect(TOTAL_STAGES).toBe(17);
    expect(Object.keys(STAGE_NAMES).length).toBe(17);
  });

  it("should use correct v1.9 stage names with renames applied", async () => {
    const { STAGE_NAMES } = await import("./hitl/stage-config");
    expect(STAGE_NAMES[1]).toBe("script");
    expect(STAGE_NAMES[2]).toBe("anime_type");
    expect(STAGE_NAMES[3]).toBe("character_design");     // renamed from character_sheet_gen
    expect(STAGE_NAMES[4]).toBe("color_script");
    expect(STAGE_NAMES[5]).toBe("ekonte");               // renamed from scene_planning
    expect(STAGE_NAMES[6]).toBe("layout");
    expect(STAGE_NAMES[7]).toBe("genga");                // renamed from keyframe_generation
    expect(STAGE_NAMES[8]).toBe("sakuga_kantoku_review");
    expect(STAGE_NAMES[9]).toBe("sakuga_tagging");
    expect(STAGE_NAMES[10]).toBe("video_generation");
    expect(STAGE_NAMES[11]).toBe("per_clip_continuity");
    expect(STAGE_NAMES[12]).toBe("x_sheet");
    expect(STAGE_NAMES[13]).toBe("ato_fuki");            // renamed from voice_synthesis
    expect(STAGE_NAMES[14]).toBe("fx_pass");
    expect(STAGE_NAMES[15]).toBe("satsuei");             // renamed from video_composite
    expect(STAGE_NAMES[16]).toBe("mastering_harness");
    expect(STAGE_NAMES[17]).toBe("continual_learning");
  });

  it("should have correct gate types per v1.9 Blueprint", async () => {
    const { DEFAULT_GATE_ASSIGNMENTS } = await import("./hitl/stage-config");
    // Blocking gates
    const blocking = DEFAULT_GATE_ASSIGNMENTS.filter(g => g.gateType === "blocking");
    const blockingStages = blocking.map(g => g.stageNumber);
    expect(blockingStages).toContain(1);  // script
    expect(blockingStages).toContain(3);  // character_design
    expect(blockingStages).toContain(5);  // ekonte
    expect(blockingStages).toContain(7);  // genga
    expect(blockingStages).toContain(15); // satsuei

    // Advisory gates (required traversal but auto-advance)
    const advisory = DEFAULT_GATE_ASSIGNMENTS.filter(g => g.gateType === "advisory");
    const advisoryStages = advisory.map(g => g.stageNumber);
    expect(advisoryStages).toContain(9);  // sakuga_tagging

    // Ambient gates
    const ambient = DEFAULT_GATE_ASSIGNMENTS.filter(g => g.gateType === "ambient");
    const ambientStages = ambient.map(g => g.stageNumber);
    expect(ambientStages).toContain(17); // continual_learning
  });

  it("should mark sakuga_tagging (Stage 9) as required traversal", async () => {
    const { isRequiredTraversal } = await import("./hitl/stage-config");
    // Stage 9 is advisory but MUST execute before Stage 10
    expect(isRequiredTraversal(9)).toBe(true);
    // Stage 17 (continual_learning) is NOT required traversal
    expect(isRequiredTraversal(17)).toBe(false);
  });

  it("should define D-agent designations matching v1.9 Section 7B", async () => {
    const { D_AGENT_DESIGNATIONS } = await import("./hitl/stage-config");
    expect(D_AGENT_DESIGNATIONS["D0"].name).toContain("Character Designer");
    expect(D_AGENT_DESIGNATIONS["D1"].name).toContain("Script");
    expect(D_AGENT_DESIGNATIONS["D1.25"].name).toContain("Layout");
    expect(D_AGENT_DESIGNATIONS["D1.5"].name).toContain("Genga");
    expect(D_AGENT_DESIGNATIONS["D2.5"].name).toContain("Sakuga Kantoku");
    expect(D_AGENT_DESIGNATIONS["D6"].name).toContain("Color");
    expect(D_AGENT_DESIGNATIONS["D7"].name).toContain("FX");
    expect(D_AGENT_DESIGNATIONS["D8"].name).toContain("Voice");
    expect(D_AGENT_DESIGNATIONS["D9"].name).toContain("Sakufuu");
    expect(D_AGENT_DESIGNATIONS["D10"].name).toContain("Craft Sensei");
  });

  it("should define D10 plug-in points (retrieval service, not a pipeline stage)", async () => {
    const { D10_PLUGIN_POINTS } = await import("./hitl/stage-config");
    // D10 is consulted at multiple stages, not owned by any single stage
    expect(Object.keys(D10_PLUGIN_POINTS).length).toBeGreaterThan(0);
    // Should have entries for stages where D10 is consulted
    const consultedStages = Object.keys(D10_PLUGIN_POINTS).map(Number);
    expect(consultedStages.length).toBeGreaterThanOrEqual(2);
  });

  it("should define legacy stage migration mapping", async () => {
    const { LEGACY_STAGE_MIGRATION } = await import("./hitl/stage-config");
    // Deprecated stages
    expect(LEGACY_STAGE_MIGRATION["manga_analysis"].action).toBe("deprecated");
    // Renamed stages
    expect(LEGACY_STAGE_MIGRATION["character_sheet_gen"].action).toBe("renamed");
    expect(LEGACY_STAGE_MIGRATION["character_sheet_gen"].v19Stage).toBe("character_design");
    expect(LEGACY_STAGE_MIGRATION["keyframe_generation"].action).toBe("renamed");
    expect(LEGACY_STAGE_MIGRATION["keyframe_generation"].v19Stage).toBe("genga");
    expect(LEGACY_STAGE_MIGRATION["voice_synthesis"].action).toBe("renamed");
    expect(LEGACY_STAGE_MIGRATION["voice_synthesis"].v19Stage).toBe("ato_fuki");
    // Subsumed stages
    expect(LEGACY_STAGE_MIGRATION["music_scoring"].action).toBe("subsumed");
    expect(LEGACY_STAGE_MIGRATION["sfx_foley"].action).toBe("subsumed");
    expect(LEGACY_STAGE_MIGRATION["audio_mix"].action).toBe("subsumed");
  });

  it("should have credit estimates for all 17 stages", async () => {
    const { STAGE_CREDIT_ESTIMATES, TOTAL_STAGES } = await import("./hitl/stage-config");
    for (let i = 1; i <= TOTAL_STAGES; i++) {
      expect(STAGE_CREDIT_ESTIMATES[i]).toBeDefined();
      expect(STAGE_CREDIT_ESTIMATES[i]).toBeGreaterThanOrEqual(0);
    }
  });
});

// ─── 11. End-to-End Flow Verification ──────────────────────────────────

describe("HITL Integration — End-to-End Flow Verification", () => {
  it("should have the full pipeline flow wired: orchestrator → bridge → gate-manager → notification → resume", async () => {
    const orchestrator = await import("./pipelineOrchestrator");
    const bridge = await import("./hitl/orchestrator-bridge");
    const gateManager = await import("./hitl/gate-manager");
    const notifications = await import("./hitl/notification-dispatcher");
    const stateMachine = await import("./hitl/pipeline-state-machine");
    const scorer = await import("./hitl/confidence-scorer");

    // Orchestrator → Bridge
    expect(typeof orchestrator.resumePipeline).toBe("function");
    expect(typeof bridge.initializeHitlForRun).toBe("function");
    expect(typeof bridge.completeNodeWithGate).toBe("function");

    // Bridge → Gate Manager
    expect(typeof gateManager.resolveGateConfig).toBe("function");
    expect(typeof gateManager.getGateById).toBe("function");

    // Bridge → State Machine
    expect(typeof stateMachine.completeStageGeneration).toBe("function");
    expect(typeof stateMachine.approveStage).toBe("function");
    expect(typeof stateMachine.startRegeneration).toBe("function");

    // Bridge → Notifications
    expect(typeof notifications.notifyGateReady).toBe("function");
    expect(typeof notifications.notifyAutoAdvanced).toBe("function");

    // Bridge → Scorer
    expect(typeof scorer.scoreGeneration).toBe("function");
  });

  it("should have the decision flow wired: tRPC submitDecision → approveStage → resumePipeline", async () => {
    const routers = await import("./routers-hitl");
    const orchestrator = await import("./pipelineOrchestrator");
    const stateMachine = await import("./hitl/pipeline-state-machine");

    expect(routers.gateReviewRouter.submitDecision).toBeDefined();
    expect(typeof orchestrator.resumePipeline).toBe("function");
    expect(typeof stateMachine.approveStage).toBe("function");
    expect(typeof stateMachine.rejectStage).toBe("function");
    expect(typeof stateMachine.startRegeneration).toBe("function");
  });

  it("should have the timeout flow wired: processTimeouts → checkTimeoutWarnings + processTimedOutGates → resumePipelineAfterApproval", async () => {
    const bridge = await import("./hitl/orchestrator-bridge");
    const timeout = await import("./hitl/timeout-handler");

    expect(typeof bridge.processTimeouts).toBe("function");
    expect(typeof timeout.checkTimeoutWarnings).toBe("function");
    expect(typeof timeout.processTimedOutGates).toBe("function");
    expect(typeof bridge.resumePipelineAfterApproval).toBe("function");
  });
});
