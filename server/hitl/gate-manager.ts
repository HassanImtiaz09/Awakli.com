/**
 * HITL Gate Manager (Prompt 17)
 *
 * Manages the lifecycle of gates: creation, decision capture, audit logging,
 * and gate config resolution (tier defaults + user overrides).
 */

import { getDb } from "../db";
import { eq, and, sql } from "drizzle-orm";
import {
  GateType, GateDecision, DecisionSource,
  STAGE_NAMES, STAGE_CREDIT_ESTIMATES,
  AMBIENT_ESCALATION_THRESHOLD,
  TOTAL_STAGES,
} from "./stage-config";

// ─── Types ──────────────────────────────────────────────────────────────

export interface GateConfig {
  stageNumber: number;
  gateType: GateType;
  autoAdvanceThreshold: number;
  reviewThreshold: number;
  timeoutHours: number;
  timeoutAction: "auto_approve" | "auto_reject" | "auto_pause";
  isLocked: boolean;
}

export interface CreateGateParams {
  pipelineStageId: number;
  pipelineRunId: number;
  userId: number;
  stageNumber: number;
  gateType: GateType;
  confidenceScore?: number;
  confidenceDetails?: Record<string, unknown>;
  autoAdvanceThreshold: number;
  reviewThreshold: number;
  timeoutHours: number;
  timeoutAction: "auto_approve" | "auto_reject" | "auto_pause";
  creditsSpentSoFar?: number;
  creditsToProceed?: number;
  creditsToRegenerate?: number;
  creditsSavedIfReject?: number;
}

export interface GateDecisionParams {
  gateId: number;
  decision: GateDecision;
  decisionSource: DecisionSource;
  decisionReason?: string;
  qualityScore?: number;
  regenParamsDiff?: Record<string, unknown>;
}

export interface GateRow {
  id: number;
  pipelineStageId: number;
  pipelineRunId: number;
  userId: number;
  gateType: GateType;
  stageNumber: number;
  stageName: string;
  confidenceScore: number | null;
  confidenceDetails: Record<string, unknown> | null;
  autoAdvanceThreshold: number;
  reviewThreshold: number;
  decision: GateDecision;
  decisionSource: DecisionSource | null;
  decisionReason: string | null;
  decisionAt: Date | null;
  regenParamsDiff: Record<string, unknown> | null;
  regenGenerationRequestId: number | null;
  creditsSpentSoFar: number | null;
  creditsToProceed: number | null;
  creditsToRegenerate: number | null;
  creditsSavedIfReject: number | null;
  timeoutAt: Date | null;
  timeoutAction: "auto_approve" | "auto_reject" | "auto_pause";
  qualityScore: number | null;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Gate Config Resolution ─────────────────────────────────────────────

/**
 * Resolve gate config for a specific stage. Priority:
 * 1. User override (scope='user_override', scopeRef=userId)
 * 2. Tier default (scope='tier_default', scopeRef=tierName)
 * 3. Hardcoded fallback from stage-config.ts
 */
export async function resolveGateConfig(
  stageNumber: number,
  tierName: string,
  userId?: number
): Promise<GateConfig> {
  const db = await getDb();
  if (!db) {
    // Fallback to hardcoded defaults
    const { DEFAULT_GATE_ASSIGNMENTS } = await import("./stage-config");
    const def = DEFAULT_GATE_ASSIGNMENTS.find(d => d.stageNumber === stageNumber);
    return def ? {
      stageNumber: def.stageNumber,
      gateType: def.gateType,
      autoAdvanceThreshold: def.autoAdvanceThreshold,
      reviewThreshold: def.reviewThreshold,
      timeoutHours: def.timeoutHours,
      timeoutAction: def.timeoutAction,
      isLocked: def.isLocked,
    } : {
      stageNumber,
      gateType: "blocking",
      autoAdvanceThreshold: 85,
      reviewThreshold: 60,
      timeoutHours: 24,
      timeoutAction: "auto_pause" as const,
      isLocked: false,
    };
  }

  // Check user override first
  if (userId) {
    const [userOverride] = await db.execute(sql`
      SELECT * FROM gate_configs
      WHERE scope = 'user_override'
        AND scopeRef = ${String(userId)}
        AND stageNumber = ${stageNumber}
      LIMIT 1
    `);
    const rows = userOverride as unknown as any[];
    if (rows && rows.length > 0) {
      const row = rows[0];
      return {
        stageNumber: row.stageNumber,
        gateType: row.gateType,
        autoAdvanceThreshold: row.autoAdvanceThreshold,
        reviewThreshold: row.reviewThreshold,
        timeoutHours: row.timeoutHours,
        timeoutAction: row.timeoutAction,
        isLocked: Boolean(row.isLocked),
      };
    }
  }

  // Check tier default
  const [tierDefault] = await db.execute(sql`
    SELECT * FROM gate_configs
    WHERE scope = 'tier_default'
      AND scopeRef = ${tierName}
      AND stageNumber = ${stageNumber}
    LIMIT 1
  `);
  const tierRows = tierDefault as unknown as any[];
  if (tierRows && tierRows.length > 0) {
    const row = tierRows[0];
    return {
      stageNumber: row.stageNumber,
      gateType: row.gateType,
      autoAdvanceThreshold: row.autoAdvanceThreshold,
      reviewThreshold: row.reviewThreshold,
      timeoutHours: row.timeoutHours,
      timeoutAction: row.timeoutAction,
      isLocked: Boolean(row.isLocked),
    };
  }

  // Hardcoded fallback
  const { DEFAULT_GATE_ASSIGNMENTS } = await import("./stage-config");
  const def = DEFAULT_GATE_ASSIGNMENTS.find(d => d.stageNumber === stageNumber);
  return def ? {
    stageNumber: def.stageNumber,
    gateType: def.gateType,
    autoAdvanceThreshold: def.autoAdvanceThreshold,
    reviewThreshold: def.reviewThreshold,
    timeoutHours: def.timeoutHours,
    timeoutAction: def.timeoutAction,
    isLocked: def.isLocked,
  } : {
    stageNumber,
    gateType: "blocking",
    autoAdvanceThreshold: 85,
    reviewThreshold: 60,
    timeoutHours: 24,
    timeoutAction: "auto_pause" as const,
    isLocked: false,
  };
}

/**
 * Resolve all gate configs for a pipeline run (v1.9: 17 stages).
 */
export async function resolveAllGateConfigs(
  tierName: string,
  userId?: number
): Promise<GateConfig[]> {
  const configs: GateConfig[] = [];
  for (let i = 1; i <= TOTAL_STAGES; i++) {
    configs.push(await resolveGateConfig(i, tierName, userId));
  }
  return configs;
}

// ─── Gate CRUD ──────────────────────────────────────────────────────────

/**
 * Create a new gate for a pipeline stage.
 */
export async function createGate(params: CreateGateParams): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const stageName = STAGE_NAMES[params.stageNumber] || `stage_${params.stageNumber}`;
  const timeoutAt = new Date(Date.now() + params.timeoutHours * 60 * 60 * 1000);

  const [result] = await db.execute(sql`
    INSERT INTO gates (
      pipelineStageId, pipelineRunId, userId, gateType,
      stageNumber, stageName,
      confidenceScore, confidenceDetails,
      autoAdvanceThreshold, reviewThreshold,
      decision, timeoutAt, timeoutAction,
      creditsSpentSoFar, creditsToProceed, creditsToRegenerate, creditsSavedIfReject
    ) VALUES (
      ${params.pipelineStageId}, ${params.pipelineRunId}, ${params.userId}, ${params.gateType},
      ${params.stageNumber}, ${stageName},
      ${params.confidenceScore ?? null}, ${params.confidenceDetails ? JSON.stringify(params.confidenceDetails) : null},
      ${params.autoAdvanceThreshold}, ${params.reviewThreshold},
      'pending', ${timeoutAt}, ${params.timeoutAction},
      ${params.creditsSpentSoFar ?? null}, ${params.creditsToProceed ?? null},
      ${params.creditsToRegenerate ?? null}, ${params.creditsSavedIfReject ?? null}
    )
  `);

  const insertResult = result as any;
  const gateId = insertResult.insertId;

  // Write audit log for gate creation
  await writeAuditLog({
    gateId,
    pipelineRunId: params.pipelineRunId,
    stageNumber: params.stageNumber,
    eventType: "gate_created",
    oldState: null,
    newState: { decision: "pending", gateType: params.gateType, confidenceScore: params.confidenceScore },
    actor: "system",
  });

  return gateId;
}

/**
 * Record a decision on a gate.
 */
export async function recordGateDecision(params: GateDecisionParams): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Get current gate state for audit
  const [currentRows] = await db.execute(sql`
    SELECT decision, gateType, stageNumber, pipelineRunId FROM gates WHERE id = ${params.gateId}
  `);
  const current = (currentRows as unknown as any[])[0];
  if (!current) throw new Error(`Gate ${params.gateId} not found`);

  await db.execute(sql`
    UPDATE gates SET
      decision = ${params.decision},
      decisionSource = ${params.decisionSource},
      decisionReason = ${params.decisionReason ?? null},
      decisionAt = NOW(),
      qualityScore = ${params.qualityScore ?? null},
      regenParamsDiff = ${params.regenParamsDiff ? JSON.stringify(params.regenParamsDiff) : null}
    WHERE id = ${params.gateId}
  `);

  // Write audit log
  await writeAuditLog({
    gateId: params.gateId,
    pipelineRunId: current.pipelineRunId,
    stageNumber: current.stageNumber,
    eventType: `gate_${params.decision}`,
    oldState: { decision: current.decision },
    newState: {
      decision: params.decision,
      decisionSource: params.decisionSource,
      qualityScore: params.qualityScore,
    },
    actor: params.decisionSource === "creator" ? "creator" : "system",
    metadata: params.regenParamsDiff ? { regenParamsDiff: params.regenParamsDiff } : undefined,
  });
}

/**
 * Get a gate by ID.
 */
export async function getGateById(gateId: number): Promise<GateRow | null> {
  const db = await getDb();
  if (!db) return null;

  const [rows] = await db.execute(sql`SELECT * FROM gates WHERE id = ${gateId}`);
  const results = rows as unknown as any[];
  return results.length > 0 ? results[0] as GateRow : null;
}

/**
 * Get all pending gates for a user.
 */
export async function getPendingGatesForUser(userId: number): Promise<GateRow[]> {
  const db = await getDb();
  if (!db) return [];

  const [rows] = await db.execute(sql`
    SELECT * FROM gates
    WHERE userId = ${userId} AND decision = 'pending'
    ORDER BY createdAt ASC
  `);
  return (rows as unknown as any[]) as GateRow[];
}

/**
 * Pending gate summary for the Studio dashboard.
 * Joins gates → pipeline_runs → projects to provide project context.
 */
export interface PendingGateSummaryItem {
  gateId: number;
  pipelineRunId: number;
  projectId: number;
  projectTitle: string;
  stageNumber: number;
  stageName: string;
  gateType: GateType;
  confidenceScore: number | null;
  timeoutAt: Date | null;
  timeoutAction: string;
  createdAt: Date;
}

export async function getPendingGateSummary(userId: number): Promise<PendingGateSummaryItem[]> {
  const db = await getDb();
  if (!db) return [];

  const [rows] = await db.execute(sql`
    SELECT
      g.id AS gateId,
      g.pipelineRunId,
      pr.projectId,
      p.title AS projectTitle,
      g.stageNumber,
      g.stageName,
      g.gateType,
      g.confidenceScore,
      g.timeoutAt,
      g.timeoutAction,
      g.createdAt
    FROM gates g
    JOIN pipeline_runs pr ON pr.id = g.pipelineRunId
    JOIN projects p ON p.id = pr.projectId
    WHERE g.userId = ${userId}
      AND g.decision = 'pending'
    ORDER BY
      CASE g.gateType WHEN 'blocking' THEN 0 WHEN 'advisory' THEN 1 ELSE 2 END ASC,
      g.timeoutAt ASC,
      g.createdAt ASC
  `);
  return (rows as unknown as any[]) as PendingGateSummaryItem[];
}

/**
 * Get all gates for a pipeline run.
 */
export async function getGatesForPipelineRun(pipelineRunId: number): Promise<GateRow[]> {
  const db = await getDb();
  if (!db) return [];

  const [rows] = await db.execute(sql`
    SELECT * FROM gates
    WHERE pipelineRunId = ${pipelineRunId}
    ORDER BY stageNumber ASC
  `);
  return (rows as unknown as any[]) as GateRow[];
}

/**
 * Get auto-advanced gates within the 1-hour review window for batch review.
 */
export async function getAutoAdvancedGatesForReview(
  pipelineRunId: number
): Promise<GateRow[]> {
  const db = await getDb();
  if (!db) return [];

  const [rows] = await db.execute(sql`
    SELECT * FROM gates
    WHERE pipelineRunId = ${pipelineRunId}
      AND decision = 'auto_approved'
      AND decisionAt >= DATE_SUB(NOW(), INTERVAL 1 HOUR)
    ORDER BY stageNumber ASC
  `);
  return (rows as unknown as any[]) as GateRow[];
}

/**
 * Get gates that have timed out and need auto-action.
 */
export async function getTimedOutGates(): Promise<GateRow[]> {
  const db = await getDb();
  if (!db) return [];

  const [rows] = await db.execute(sql`
    SELECT * FROM gates
    WHERE decision = 'pending'
      AND timeoutAt <= NOW()
    ORDER BY timeoutAt ASC
  `);
  return (rows as unknown as any[]) as GateRow[];
}

/**
 * Determine the effective gate behavior based on gate type and confidence score.
 * Returns the actual behavior: 'block', 'auto_advance', 'soft_notify', or 'log_only'.
 */
export function determineGateBehavior(
  gateType: GateType,
  confidenceScore: number,
  autoAdvanceThreshold: number,
  reviewThreshold: number,
  flags: string[] = []
): "block" | "auto_advance" | "soft_notify" | "log_only" {
  // Content safety veto — always block
  if (flags.includes("nsfw_detected") || flags.includes("content_violation")) {
    return "block";
  }

  switch (gateType) {
    case "blocking":
      // Blocking gates always block, regardless of score
      return "block";

    case "advisory":
      if (confidenceScore >= autoAdvanceThreshold) {
        return "auto_advance";
      } else if (confidenceScore >= reviewThreshold) {
        return "soft_notify";
      } else {
        // Below review threshold — escalate to blocking
        return "block";
      }

    case "ambient":
      if (confidenceScore < AMBIENT_ESCALATION_THRESHOLD) {
        // Catastrophic failure — escalate to blocking
        return "block";
      }
      if (flags.length > 0) {
        // Any safety flags — escalate
        return "block";
      }
      return "log_only";

    default:
      return "block";
  }
}

// ─── Audit Log ──────────────────────────────────────────────────────────

interface AuditLogEntry {
  gateId: number;
  pipelineRunId: number;
  stageNumber: number;
  eventType: string;
  oldState: Record<string, unknown> | null;
  newState: Record<string, unknown> | null;
  actor: string;
  metadata?: Record<string, unknown>;
}

export async function writeAuditLog(entry: AuditLogEntry): Promise<void> {
  const db = await getDb();
  if (!db) return;

  try {
    await db.execute(sql`
      INSERT INTO gate_audit_log (
        gateId, pipelineRunId, stageNumber, eventType,
        oldState, newState, actor, metadata
      ) VALUES (
        ${entry.gateId}, ${entry.pipelineRunId}, ${entry.stageNumber}, ${entry.eventType},
        ${entry.oldState ? JSON.stringify(entry.oldState) : null},
        ${entry.newState ? JSON.stringify(entry.newState) : null},
        ${entry.actor},
        ${entry.metadata ? JSON.stringify(entry.metadata) : null}
      )
    `);
  } catch (err) {
    console.error("[GateManager] Failed to write audit log:", err);
  }
}

/**
 * Get audit log entries for a gate.
 */
export async function getAuditLogForGate(gateId: number): Promise<AuditLogEntry[]> {
  const db = await getDb();
  if (!db) return [];

  const [rows] = await db.execute(sql`
    SELECT * FROM gate_audit_log
    WHERE gateId = ${gateId}
    ORDER BY createdAt ASC
  `);
  return (rows as unknown as any[]) as AuditLogEntry[];
}
