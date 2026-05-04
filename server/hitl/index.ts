/**
 * HITL Gate Architecture — Public API
 *
 * Re-exports all HITL modules for clean imports:
 * import { createGate, scoreGeneration, ... } from "./hitl";
 */

// Stage configuration & constants
export {
  TOTAL_STAGES,
  STAGE_NAMES,
  STAGE_DISPLAY_NAMES,
  STAGE_CREDIT_ESTIMATES,
  DEFAULT_GATE_ASSIGNMENTS,
  AMBIENT_ESCALATION_THRESHOLD,
  BRANCH_STAGES,
  D_AGENT_DESIGNATIONS,
  D10_PLUGIN_POINTS,
  LEGACY_STAGE_MIGRATION,
  TIER_NAMES,
  isRequiredTraversal,
  isStageSkippable,
  type GateType,
  type GateDecision,
  type DecisionSource,
  type StageStatus,
  type PipelineRunStatus,
  type TierName,
} from "./stage-config";

// Gate manager
export {
  resolveGateConfig,
  resolveAllGateConfigs,
  createGate,
  recordGateDecision,
  getGateById,
  getPendingGatesForUser,
  getPendingGateSummary,
  getGatesForPipelineRun,
  type PendingGateSummaryItem,
  getAutoAdvancedGatesForReview,
  getTimedOutGates,
  determineGateBehavior,
  writeAuditLog,
  getAuditLogForGate,
  type GateConfig,
  type CreateGateParams,
  type GateDecisionParams,
  type GateRow,
} from "./gate-manager";

// Confidence scorer
export {
  scoreGeneration,
  type GenerateResult,
  type ScoreContext,
  type ConfidenceResult,
  type SubScore,
  type ClipService,
} from "./confidence-scorer";

// Pipeline state machine
export {
  initializePipelineStages,
  startStageExecution,
  completeStageGeneration,
  approveStage,
  rejectStage,
  startRegeneration,
  failStage,
  skipStage,
  abortPipeline,
  cascadeRewind,
  getStageByNumber,
  getAllStages,
  getNextPendingStage,
  isPipelineComplete,
  type PipelineStageRow,
  type InitPipelineParams,
  type StageCompletionResult,
} from "./pipeline-state-machine";

// Notification dispatcher
export {
  registerWsConnection,
  hasActiveWsConnection,
  notifyGateReady,
  notifyAutoAdvanced,
  notifyTimeoutWarning,
  notifyEscalation,
  getUndeliveredEmailNotifications,
  markEmailNotificationsDelivered,
  type NotificationType,
  type NotificationChannel,
  type GateNotificationPayload,
} from "./notification-dispatcher";

// Quality feedback loop
export {
  mapDecisionToQualityScore,
  writeQualityScore,
  getApprovalRateByStage,
  getAvgConfidenceByStage,
  getCreditsSavedByHitl,
  getMostRegeneratedStages,
  type QualityFeedbackParams,
} from "./quality-feedback";

// Timeout handler
export {
  checkTimeoutWarnings,
  processTimedOutGates,
  getBatchReviewableGates,
  processBatchReviewDecision,
} from "./timeout-handler";

// CLIP client
export {
  realClipService,
  getClipService,
  getTextEmbedding,
  imageSimilarity,
  batchSimilarity,
  textImageSimilarity,
  checkSafety,
  checkClipHealth,
  clearEmbeddingCache,
  resetHealthState,
  type SimilarityResult,
  type BatchSimilarityResult,
  type SafetyResult,
  type ClipHealthStatus,
} from "./clip-client";

// Cron scheduler
export {
  runTimeoutTick,
  startCronScheduler,
  stopCronScheduler,
  isCronSchedulerRunning,
  getCronStats,
  resetCronStats,
  registerShutdownHandlers,
  registerCronRoutes,
  type CronRunResult,
  type CronStats,
} from "./cron-scheduler";

// Orchestrator bridge
export {
  initializeHitlForRun,
  processPreFlightStages,
  completeNodeWithGate,
  resumePipelineAfterApproval,
  resumePipelineAfterRegeneration,
  pausePipelineForGate,
  processTimeouts,
  getUserTierForRun,
  NODE_TO_STAGES,
  NODE_TO_PRIMARY_STAGE,
  PRE_FLIGHT_STAGES,
  SECONDARY_STAGES,
  STAGE_TO_NODE,
  type OrchestratorNode,
  type NodeCompletionParams,
  type ResumeResult,
} from "./orchestrator-bridge";
