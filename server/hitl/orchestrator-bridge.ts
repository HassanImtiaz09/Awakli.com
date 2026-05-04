/**
 * HITL Orchestrator Bridge (v1.9 Pipeline Blueprint)
 *
 * Connects the pipeline orchestrator to the 17-stage HITL gate system.
 * Maps orchestrator nodes to HITL stages, triggers gates after generation
 * completes, and resumes the pipeline after creator decisions.
 *
 * v1.9 Node-to-Stage Mapping:
 * ┌─────────────────────┬──────────────────────────────────────────────────────┐
 * │ Orchestrator Node    │ HITL Stages                                          │
 * ├─────────────────────┼──────────────────────────────────────────────────────┤
 * │ pre_production       │ 1: script, 2: anime_type, 3: character_design,      │
 * │                      │ 4: color_script, 5: ekonte                          │
 * │ key_animation        │ 6: layout, 7: genga, 8: sakuga_kantoku_review,      │
 * │                      │ 9: sakuga_tagging                                   │
 * │ video_gen            │ 10: video_generation                                │
 * │ post_video           │ 11: per_clip_continuity                             │
 * │ audio_timing         │ 12: x_sheet, 13: ato_fuki                           │
 * │ fx_composite         │ 14: fx_pass, 15: satsuei                            │
 * │ mastering            │ 16: mastering_harness                               │
 * │ learning             │ 17: continual_learning                              │
 * └─────────────────────┴──────────────────────────────────────────────────────┘
 *
 * Key Design Decisions:
 * - All 17 stages are required traversal (except Stage 17)
 * - Advisory gates auto-advance but MUST still execute (e.g., sakuga_tagging)
 * - D10 is NOT a node — it's a retrieval service consulted within other nodes
 * - Branch stages (5.5, 7.5) are user-triggered side-paths, not in main flow
 * - D2/D3 are subsumed into per-agent helpers, not pipeline stages
 * - D9 at Stage 2 provides sakufuu-profile-aware default-bias for episodes 2+
 *   (no-op for first episode)
 *
 * Flow:
 * 1. Pipeline starts → initializeHitlForRun() creates 17 stage rows
 * 2. Pre-production stages (1-5) execute sequentially with individual gates
 * 3. Key animation stages (6-9) execute sequentially
 * 4. sakuga_tagging (Stage 9) is advisory but REQUIRED traversal before Stage 10
 * 5. Each subsequent node executes its stages in order
 * 6. If gate blocks → pipeline pauses, SSE notification sent
 * 7. Creator approves → resumePipelineAfterApproval() advances to next stage
 * 8. 'Publish to catalog' is a user action AFTER Stage 16, not a pipeline stage
 */

import { getDb } from "../db";
import { sql } from "drizzle-orm";
import { getPipelineRunById, updatePipelineRun } from "../db";
import {
  initializePipelineStages,
  completeStageGeneration,
  startStageExecution,
  approveStage,
  getStageByNumber,
  getAllStages,
  getNextPendingStage,
  isPipelineComplete,
  type StageCompletionResult,
} from "./pipeline-state-machine";
import {
  resolveGateConfig,
  resolveAllGateConfigs,
  getGateById,
  type GateConfig,
} from "./gate-manager";
import {
  notifyGateReady,
  notifyAutoAdvanced,
} from "./notification-dispatcher";
import type { GenerateResult, ScoreContext } from "./confidence-scorer";
import { STAGE_NAMES, STAGE_CREDIT_ESTIMATES, TOTAL_STAGES, isRequiredTraversal } from "./stage-config";
import { pipelineLog } from "../observability/logger";
import { checkTimeoutWarnings, processTimedOutGates } from "./timeout-handler";

// ─── Node-to-Stage Mapping (v1.9) ──────────────────────────────────────

export type OrchestratorNode =
  | "pre_production"   // Stages 1-5
  | "key_animation"    // Stages 6-9
  | "video_gen"        // Stage 10
  | "post_video"       // Stage 11
  | "audio_timing"     // Stages 12-13
  | "fx_composite"     // Stages 14-15
  | "mastering"        // Stage 16
  | "learning";        // Stage 17

/**
 * Maps each orchestrator node to its owned pipeline stages (in execution order).
 * Within a node, stages execute sequentially — each with its own gate check.
 */
export const NODE_TO_STAGES: Record<OrchestratorNode, number[]> = {
  pre_production: [1, 2, 3, 4, 5],
  key_animation: [6, 7, 8, 9],
  video_gen: [10],
  post_video: [11],
  audio_timing: [12, 13],
  fx_composite: [14, 15],
  mastering: [16],
  learning: [17],
};

/**
 * Maps each orchestrator node to its primary HITL stage.
 * The "primary" stage is the first stage in the node group.
 */
export const NODE_TO_PRIMARY_STAGE: Record<OrchestratorNode, number> = {
  pre_production: 1,
  key_animation: 6,
  video_gen: 10,
  post_video: 11,
  audio_timing: 12,
  fx_composite: 14,
  mastering: 16,
  learning: 17,
};

/**
 * Pre-flight stages that execute before the main generation pipeline.
 * In v1.9, stages 1-5 (pre_production node) are pre-flight.
 */
export const PRE_FLIGHT_STAGES = [1, 2, 3, 4, 5];

/**
 * Secondary stages grouped by their primary node stage.
 * Within a node, these stages execute after the primary stage.
 */
export const SECONDARY_STAGES: Record<number, number[]> = {
  6: [7, 8, 9],    // key_animation: layout → genga → sakuga_review → sakuga_tagging
  12: [13],        // audio_timing: x_sheet → ato_fuki
  14: [15],        // fx_composite: fx_pass → satsuei
};

/**
 * Reverse mapping: stage number → owning orchestrator node.
 */
export const STAGE_TO_NODE: Record<number, OrchestratorNode> = {};
for (const [node, stages] of Object.entries(NODE_TO_STAGES)) {
  for (const stage of stages) {
    (STAGE_TO_NODE as Record<number, OrchestratorNode>)[stage] = node as OrchestratorNode;
  }
}

// ─── Pipeline Initialization ────────────────────────────────────────────

/**
 * Initialize HITL stages for a pipeline run.
 * Called at the start of runPipeline() before any node executes.
 * Creates 17 stage rows per v1.9 Blueprint.
 */
export async function initializeHitlForRun(
  pipelineRunId: number,
  userId: number,
  tierName: string = "free_trial"
): Promise<void> {
  pipelineLog.info(`[HITL Bridge] Initializing ${TOTAL_STAGES} HITL stages for run ${pipelineRunId}`);

  await initializePipelineStages({
    pipelineRunId,
    userId,
    tierName,
    episodeId: 0, // Will be resolved from the pipeline run
  });

  // Update pipeline run with HITL metadata
  const db = await getDb();
  if (db) {
    await db.execute(sql`
      UPDATE pipeline_runs SET
        currentStageNumber = 0,
        totalStages = ${TOTAL_STAGES}
      WHERE id = ${pipelineRunId}
    `);
  }

  pipelineLog.info(`[HITL Bridge] ${TOTAL_STAGES} stages initialized for run ${pipelineRunId}`);
}

// ─── Pre-flight Stage Processing ────────────────────────────────────────

/**
 * Process pre-flight stages (1-5: script → anime_type → character_design →
 * color_script → ekonte).
 *
 * Each stage executes sequentially with its own gate check. All are blocking
 * gates in v1.9 (user must approve script, character design, etc. before
 * proceeding to key animation).
 */
export async function processPreFlightStages(
  pipelineRunId: number,
  userId: number,
  tierName: string = "free_trial"
): Promise<{ blocked: boolean; blockingGateId?: number; blockingStage?: number }> {
  pipelineLog.info(`[HITL Bridge] Processing pre-flight stages for run ${pipelineRunId}`);

  for (const stageNum of PRE_FLIGHT_STAGES) {
    const gateConfig = await resolveGateConfig(stageNum, tierName, userId);

    // Start execution
    await startStageExecution(pipelineRunId, stageNum);

    // Create a synthetic result for pre-production stages
    const syntheticResult: GenerateResult = {
      requestType: "text",
      outputUrl: "",
      outputFileSize: 1000,
    };

    const scoreContext: ScoreContext = {
      stageNumber: stageNum,
    };

    const result = await completeStageGeneration(
      pipelineRunId,
      stageNum,
      userId,
      syntheticResult,
      scoreContext,
      gateConfig
    );

    // If a gate blocks (expected for blocking gates like character_design)
    if (result.nextAction === "wait_for_creator") {
      pipelineLog.info(`[HITL Bridge] Pre-flight stage ${stageNum} (${STAGE_NAMES[stageNum]}) blocked! Gate ${result.gateId}`);
      const gate = await getGateById(result.gateId);
      if (gate) await notifyGateReady(gate);
      return { blocked: true, blockingGateId: result.gateId, blockingStage: stageNum };
    }

    // Notify if auto-advanced
    if (result.behavior === "auto_advance" || result.behavior === "log_only") {
      const gate = await getGateById(result.gateId);
      if (gate) await notifyAutoAdvanced(gate);
    }

    pipelineLog.info(`[HITL Bridge] Pre-flight stage ${stageNum} (${STAGE_NAMES[stageNum]}) completed: ${result.behavior} (score: ${result.confidenceScore})`);
  }

  return { blocked: false };
}

// ─── Post-Node Gate Processing ──────────────────────────────────────────

export interface NodeCompletionParams {
  pipelineRunId: number;
  node: OrchestratorNode;
  userId: number;
  tierName?: string;
  /** The primary generation result */
  generationResult: GenerateResult;
  /** Context for confidence scoring */
  scoreContext?: Partial<ScoreContext>;
  /** Generation request ID from the provider router */
  generationRequestId?: number;
  /** Credit hold ID */
  holdId?: string;
  /** Actual credits spent */
  creditsActual?: number;
  /** Specific stage within the node to process (for sequential stage-by-stage execution) */
  targetStage?: number;
}

/**
 * Process HITL gates after a node completes generation.
 *
 * In v1.9, each stage within a node executes sequentially with its own gate.
 * For nodes with multiple stages (key_animation, audio_timing, fx_composite),
 * the orchestrator calls this once per stage, advancing through the node.
 *
 * sakuga_tagging (Stage 9) is advisory but REQUIRED traversal — the orchestrator
 * MUST execute it before advancing to video_gen (Stage 10).
 */
export async function completeNodeWithGate(
  params: NodeCompletionParams
): Promise<{
  blocked: boolean;
  gateResult: StageCompletionResult;
  primaryStage: number;
  secondaryStagesAdvanced: number[];
}> {
  const {
    pipelineRunId,
    node,
    userId,
    tierName = "free_trial",
    generationResult,
    scoreContext = {},
    generationRequestId,
    holdId,
    creditsActual,
    targetStage,
  } = params;

  // Determine which stage to process
  const nodeStages = NODE_TO_STAGES[node];
  const primaryStage = targetStage || nodeStages[0];
  const secondaryStagesAdvanced: number[] = [];

  pipelineLog.info(`[HITL Bridge] Processing node '${node}' stage ${primaryStage} (${STAGE_NAMES[primaryStage]})`);

  // Execute the target stage
  await startStageExecution(pipelineRunId, primaryStage);

  const gateConfig = await resolveGateConfig(primaryStage, tierName, userId);
  const fullScoreContext: ScoreContext = {
    stageNumber: primaryStage,
    ...scoreContext,
  };

  const gateResult = await completeStageGeneration(
    pipelineRunId,
    primaryStage,
    userId,
    generationResult,
    fullScoreContext,
    gateConfig,
    generationRequestId,
    holdId,
    creditsActual
  );

  // Send notifications
  const gate = await getGateById(gateResult.gateId);
  if (gate) {
    if (gateResult.nextAction === "wait_for_creator") {
      await notifyGateReady(gate);
      pipelineLog.info(`[HITL Bridge] Gate BLOCKED at stage ${primaryStage} (${STAGE_NAMES[primaryStage]}, score: ${gateResult.confidenceScore})`);
    } else {
      await notifyAutoAdvanced(gate);
      pipelineLog.info(`[HITL Bridge] Gate auto-advanced at stage ${primaryStage} (${STAGE_NAMES[primaryStage]}, score: ${gateResult.confidenceScore})`);
    }
  }

  // Update pipeline run current stage
  const db = await getDb();
  if (db) {
    await db.execute(sql`
      UPDATE pipeline_runs SET currentStageNumber = ${primaryStage}
      WHERE id = ${pipelineRunId}
    `);
  }

  return {
    blocked: gateResult.nextAction === "wait_for_creator",
    gateResult,
    primaryStage,
    secondaryStagesAdvanced,
  };
}

// ─── Pipeline Resume After Gate Decision ────────────────────────────────

export interface ResumeResult {
  resumed: boolean;
  nextNode?: OrchestratorNode;
  nextStage?: number;
  pipelineComplete?: boolean;
  error?: string;
}

/**
 * Resume the pipeline after a creator approves a gate.
 * Determines the next stage to execute and returns the owning node.
 *
 * In v1.9, stages advance one-by-one within a node. If the approved stage
 * is not the last in its node, the next stage within the same node executes.
 * If it IS the last, the next node begins.
 */
export async function resumePipelineAfterApproval(
  pipelineRunId: number
): Promise<ResumeResult> {
  const run = await getPipelineRunById(pipelineRunId);
  if (!run) return { resumed: false, error: "Pipeline run not found" };

  // Check if pipeline is complete
  if (await isPipelineComplete(pipelineRunId)) {
    await updatePipelineRun(pipelineRunId, {
      status: "completed",
      completedAt: new Date(),
    } as any);
    return { resumed: true, pipelineComplete: true };
  }

  // Find the next pending stage
  const stages = await getAllStages(pipelineRunId);
  const nextPending = stages.find(s =>
    s.status === "pending" || s.status === "regenerating"
  );

  if (!nextPending) {
    return { resumed: true, pipelineComplete: true };
  }

  const nextStageNumber = nextPending.stageNumber;
  const nextNode = STAGE_TO_NODE[nextStageNumber];

  if (!nextNode) {
    return { resumed: false, error: `Stage ${nextStageNumber} has no mapped orchestrator node` };
  }

  // Update pipeline run status to active
  await updatePipelineRun(pipelineRunId, {
    status: "running",
    currentNode: nextNode,
  } as any);

  pipelineLog.info(`[HITL Bridge] Pipeline ${pipelineRunId} resuming at node '${nextNode}' stage ${nextStageNumber} (${STAGE_NAMES[nextStageNumber]})`);

  return { resumed: true, nextNode, nextStage: nextStageNumber };
}

/**
 * Resume the pipeline after a creator requests regeneration.
 * Returns the node that needs to re-execute the given stage.
 */
export async function resumePipelineAfterRegeneration(
  pipelineRunId: number,
  stageNumber: number
): Promise<ResumeResult> {
  const node = STAGE_TO_NODE[stageNumber];
  if (!node) {
    return { resumed: false, error: `Stage ${stageNumber} has no mapped orchestrator node` };
  }

  // Update pipeline run status
  await updatePipelineRun(pipelineRunId, {
    status: "running",
    currentNode: node,
  } as any);

  pipelineLog.info(`[HITL Bridge] Pipeline ${pipelineRunId} regenerating at node '${node}' stage ${stageNumber} (${STAGE_NAMES[stageNumber]})`);

  return { resumed: true, nextNode: node, nextStage: stageNumber };
}

// ─── Pipeline Pause ─────────────────────────────────────────────────────

/**
 * Pause the pipeline when a gate blocks.
 * Updates the pipeline run status and stores the blocking gate info.
 */
export async function pausePipelineForGate(
  pipelineRunId: number,
  gateId: number,
  stageNumber: number
): Promise<void> {
  const db = await getDb();
  if (!db) return;

  await db.execute(sql`
    UPDATE pipeline_runs SET
      status = 'paused',
      currentStageNumber = ${stageNumber}
    WHERE id = ${pipelineRunId}
  `);

  pipelineLog.info(`[HITL Bridge] Pipeline ${pipelineRunId} paused at stage ${stageNumber} (${STAGE_NAMES[stageNumber]}, gate ${gateId})`);
}

// ─── Timeout Cron Integration ───────────────────────────────────────────

/**
 * Process all timeout-related actions. Should be called on a cron schedule
 * (e.g., every 5 minutes).
 *
 * 1. Send timeout warnings (1h, 6h, 23h before expiry)
 * 2. Process gates that have exceeded their timeout
 * 3. Resume pipelines that were auto-approved by timeout
 */
export async function processTimeouts(): Promise<{
  warningsSent: number;
  gatesProcessed: number;
  pipelinesResumed: number;
}> {
  pipelineLog.info("[HITL Bridge] Processing timeouts...");

  // 1. Send warnings
  const warningsResult = await checkTimeoutWarnings();
  const warningsSent = typeof warningsResult === 'number' ? warningsResult : (warningsResult as any)?.warningsSent ?? 0;

  // 2. Process timed-out gates
  const timeoutResult = await processTimedOutGates();
  const gatesProcessed = typeof timeoutResult === 'number' ? timeoutResult : (timeoutResult as any)?.processed ?? 0;

  // 3. Check if any auto-approved gates need pipeline resumption
  let pipelinesResumed = 0;
  const db = await getDb();
  if (db) {
    const [rows] = await db.execute(sql`
      SELECT DISTINCT pr.id
      FROM pipeline_runs pr
      WHERE pr.status = 'paused'
        AND NOT EXISTS (
          SELECT 1 FROM gates g
          WHERE g.pipelineRunId = pr.id AND g.decision = 'pending'
        )
    `);
    const pausedRuns = rows as unknown as any[];

    for (const run of pausedRuns) {
      try {
        const result = await resumePipelineAfterApproval(run.id);
        if (result.resumed) pipelinesResumed++;
      } catch (err) {
        pipelineLog.error(`[HITL Bridge] Failed to resume pipeline ${run.id} after timeout:`, { error: String(err) });
      }
    }
  }

  pipelineLog.info(`[HITL Bridge] Timeouts processed: ${warningsSent} warnings, ${gatesProcessed} gates, ${pipelinesResumed} pipelines resumed`);

  return { warningsSent, gatesProcessed, pipelinesResumed };
}

// ─── Helper: Get user tier from pipeline run ────────────────────────────

export async function getUserTierForRun(pipelineRunId: number): Promise<string> {
  const db = await getDb();
  if (!db) return "free_trial";

  const [rows] = await db.execute(sql`
    SELECT s.planId
    FROM pipeline_runs pr
    JOIN users u ON pr.userId = u.id
    LEFT JOIN subscriptions s ON s.userId = u.id AND s.status = 'active'
    WHERE pr.id = ${pipelineRunId}
    LIMIT 1
  `);
  const results = rows as unknown as any[];
  if (results.length === 0) return "free_trial";

  const planId = results[0]?.planId;
  const planToTier: Record<string, string> = {
    creator_monthly: "creator",
    creator_yearly: "creator",
    creator_pro_monthly: "creator_pro",
    creator_pro_yearly: "creator_pro",
    studio_monthly: "studio",
    studio_yearly: "studio",
    enterprise: "enterprise",
  };

  return planToTier[planId] || "free_trial";
}
