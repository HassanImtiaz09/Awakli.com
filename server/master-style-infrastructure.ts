/**
 * Wave 7 — Item 4: Master-Style Infrastructure
 *
 * Implements the "creator-aesthetic" training pipeline and three-slot
 * replace-not-extend architecture. The master-style slot REPLACES the
 * existing "sakufuu" slot in the three-adapter composition stack:
 *
 *   Slot 1: Genre adapter (from style bundle / genre training)
 *   Slot 2: Character adapter (per-character, per-episode)
 *   Slot 3: Creator-aesthetic adapter (master-style — replaces sakufuu)
 *
 * The "sakufuu" name was a working title for the creator-style slot.
 * Master-style is the production name with expanded capabilities:
 * - Multi-episode style evolution tracking
 * - Admin-gated training pipeline (pre-spend approval)
 * - Style sample curation with quality scoring
 * - A/B testing between style versions
 * - Automatic retraining triggers (every 3-5 episodes)
 *
 * Architecture: Three-slot replace-not-extend means:
 * - The composition runtime still accepts exactly 3 adapters max
 * - The third slot's semantic role changes from "sakufuu" to "master_style"
 * - No fourth slot is added — tier gating remains single/dual/triple
 * - Existing sakufuu adapters are migrated to master_style role
 *
 * @see server/adapter-composer.ts for AdapterRole type (will add "master_style")
 * @see server/adapter-composer-pipeline.ts for ProjectAdapters interface
 * @see server/premium-tier-features.ts for composition mode gating
 * @see server/benchmarks/sakufuu/lora-training.ts for base training infrastructure
 */

import type {
  DoRAAdapter,
  AdapterRole,
  AdapterType,
  AdapterInitialization,
  DoRATrainingConfig,
} from "./adapter-composer";
import { DEFAULT_DORA_TRAINING_CONFIG, ROLE_TRAINING_OVERRIDES } from "./adapter-composer";

// ─── Master-Style Types ─────────────────────────────────────────────────────

/**
 * Extended AdapterRole that includes master_style as the third-slot replacement.
 * In production, AdapterRole in adapter-composer.ts will be updated to:
 *   type AdapterRole = "genre" | "character" | "master_style";
 * The "sakufuu" value is retained as an alias for backward compatibility.
 */
export type MasterStyleRole = "master_style";

/**
 * Master-style training configuration — extends base DoRA config
 * with creator-aesthetic-specific parameters.
 */
export interface MasterStyleTrainingConfig extends DoRATrainingConfig {
  /** Creator ID who owns this style */
  creatorId: number;
  /** Project IDs that contributed training samples */
  sourceProjectIds: number[];
  /** Episode range that contributed samples (for evolution tracking) */
  episodeRange: { start: number; end: number };
  /** Style evolution version (increments with each retraining) */
  styleVersion: number;
  /** Whether this is an auto-triggered retraining or manual */
  triggerType: "auto_episode_threshold" | "manual" | "initial";
  /** Minimum episodes between auto-retraining */
  retrainEpisodeInterval: number;
  /** Quality threshold for sample inclusion */
  sampleQualityThreshold: number;
  /** Maximum training samples per retraining cycle */
  maxSamplesPerCycle: number;
}

/**
 * Master-style training job status with admin gate.
 */
export interface MasterStyleJobStatus {
  id: string;
  creatorId: number;
  status: MasterStyleJobState;
  styleVersion: number;
  /** Pre-spend estimate (shown to admin for approval) */
  estimatedCostCents: number;
  /** Actual cost after completion */
  actualCostCents?: number;
  /** Admin who approved (null if pending) */
  adminApprovedBy?: string;
  adminApprovedAt?: number;
  /** Rejection reason (if rejected) */
  rejectionReason?: string;
  /** Training progress (0-100) */
  progress?: number;
  /** Training metrics */
  metrics?: {
    trainingLoss?: number;
    validationLoss?: number;
    elapsedSeconds?: number;
    samplesUsed?: number;
  };
  /** Trained model artifact */
  modelUrl?: string;
  modelFileKey?: string;
  /** Timestamps */
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

export type MasterStyleJobState =
  | "pending_admin_approval"
  | "approved"
  | "preparing"
  | "training"
  | "completed"
  | "failed"
  | "cancelled"
  | "rejected";

/**
 * Style sample for master-style training dataset.
 */
export interface MasterStyleSample {
  /** Source image URL */
  url: string;
  /** Processed/normalized image URL (after crop/resize) */
  processedUrl?: string;
  /** Auto-generated or manual caption */
  caption: string;
  /** Source type for provenance */
  sourceType: "panel" | "character_sheet" | "cover" | "custom" | "genga";
  /** Quality score (0-1) from automated assessment */
  qualityScore: number;
  /** Episode this sample came from */
  episodeId?: number;
  /** Whether this was auto-selected or manually curated */
  autoSelected: boolean;
  /** Crop region if extracted from larger image */
  cropRegion?: { x: number; y: number; w: number; h: number };
}

/**
 * Master-style A/B test configuration.
 */
export interface MasterStyleABTest {
  id: string;
  creatorId: number;
  /** Version A (current production) */
  versionA: { styleVersion: number; modelUrl: string; triggerWord: string };
  /** Version B (candidate) */
  versionB: { styleVersion: number; modelUrl: string; triggerWord: string };
  /** Test parameters */
  testConfig: {
    /** Number of panels to generate per version */
    panelsPerVersion: number;
    /** Evaluation criteria */
    evaluationCriteria: "creator_preference" | "automated_quality" | "both";
    /** Auto-promote if quality score exceeds threshold */
    autoPromoteThreshold?: number;
  };
  /** Test status */
  status: "pending" | "running" | "completed" | "cancelled";
  /** Results (populated after completion) */
  results?: {
    versionAScore: number;
    versionBScore: number;
    winner: "A" | "B" | "tie";
    sampleSize: number;
  };
}

// ─── Configuration ──────────────────────────────────────────────────────────

/**
 * Default master-style training configuration.
 * Extends the base DoRA config with creator-aesthetic defaults.
 */
export const DEFAULT_MASTER_STYLE_CONFIG: Omit<MasterStyleTrainingConfig, "creatorId" | "sourceProjectIds" | "episodeRange" | "styleVersion"> = {
  ...DEFAULT_DORA_TRAINING_CONFIG,
  // Override base DoRA defaults for master-style
  rank: 24,                    // Higher rank than character (16) for richer style capture
  steps: 1500,                 // More steps for style learning (vs 800 for character)
  learningRate: 0.00008,       // Slightly lower LR for style stability
  resolution: 768,             // Higher resolution for style detail
  batchSize: 2,                // Larger batch for style consistency
  useCaptions: true,           // Always use captions for style
  triggerWord: "master_style", // Will be overridden per-creator
  baseModel: "stabilityai/stable-diffusion-xl-base-1.0",
  adapterType: "dora" as AdapterType,
  initialization: "pissa" as AdapterInitialization,
  role: "master_style" as unknown as AdapterRole,
  alpha: 12,
  // Master-style-specific
  triggerType: "initial",
  retrainEpisodeInterval: 4,   // Retrain every 4 episodes
  sampleQualityThreshold: 0.65,
  maxSamplesPerCycle: 40,
};

/**
 * Episode threshold for auto-retraining trigger.
 * After this many new episodes since last training, auto-trigger retraining.
 */
export const AUTO_RETRAIN_EPISODE_THRESHOLD = 4;

/**
 * Minimum samples required to trigger training.
 */
export const MIN_TRAINING_SAMPLES = 10;

/**
 * Maximum cost (cents) that can be auto-approved without admin gate.
 * Jobs above this require explicit admin approval.
 */
export const AUTO_APPROVE_COST_THRESHOLD_CENTS = 200; // $2.00

// ─── Three-Slot Architecture ────────────────────────────────────────────────

/**
 * The three-slot composition architecture.
 * This is the canonical definition of what each slot means.
 *
 * IMPORTANT: This is a REPLACE, not EXTEND operation.
 * The composition runtime still accepts max 3 adapters.
 * The third slot changes from "sakufuu" to "master_style".
 */
export const THREE_SLOT_ARCHITECTURE = {
  slot1: {
    role: "genre" as AdapterRole,
    description: "Genre adapter from style bundle (shonen, shoujo, seinen, etc.)",
    source: "style_bundles table → trained DoRA",
    retrainFrequency: "On genre pool confidence upgrade",
    tierRequired: "creator",
  },
  slot2: {
    role: "character" as AdapterRole,
    description: "Per-character identity adapter (face, outfit, proportions)",
    source: "Character reference sheet → trained DoRA",
    retrainFrequency: "Per character creation / redesign",
    tierRequired: "creator",
  },
  slot3: {
    role: "master_style" as MasterStyleRole,
    description: "Creator-aesthetic adapter (personal art style, line weight, coloring)",
    source: "Creator's best panels across episodes → trained DoRA",
    retrainFrequency: "Every 3-5 episodes (auto-triggered)",
    tierRequired: "creator_pro",
    replacesLegacy: "sakufuu",
  },
} as const;

/**
 * Validate that a set of adapters conforms to the three-slot architecture.
 * Ensures no duplicate roles and max 3 adapters.
 */
export function validateThreeSlotComposition(adapters: DoRAAdapter[]): {
  valid: boolean;
  errors: string[];
  slotAssignment: Record<string, string>;
} {
  const errors: string[] = [];
  const slotAssignment: Record<string, string> = {};

  if (adapters.length > 3) {
    errors.push(`Three-slot architecture allows max 3 adapters, got ${adapters.length}. This is a REPLACE-not-EXTEND architecture.`);
  }

  // Check for duplicate roles
  const roleCounts: Record<string, number> = {};
  for (const adapter of adapters) {
    const role = normalizeMasterStyleRole(adapter.role);
    roleCounts[role] = (roleCounts[role] || 0) + 1;
    slotAssignment[adapter.id] = role;
  }

  for (const [role, count] of Object.entries(roleCounts)) {
    if (count > 1) {
      errors.push(`Duplicate role "${role}" — each slot can only have one adapter`);
    }
  }

  return { valid: errors.length === 0, errors, slotAssignment };
}

/**
 * Normalize legacy "sakufuu" role to "master_style".
 * Provides backward compatibility during migration.
 */
export function normalizeMasterStyleRole(role: AdapterRole | string): string {
  if (role === "sakufuu") return "master_style";
  return role;
}

/**
 * Check if a creator is eligible for master-style training.
 * Requirements:
 * - Creator Pro+ subscription
 * - At least MIN_TRAINING_SAMPLES quality panels available
 * - No currently running training job
 */
export function checkMasterStyleEligibility(params: {
  subscriptionTier: string;
  availableSampleCount: number;
  hasRunningJob: boolean;
  episodesSinceLastTraining?: number;
}): {
  eligible: boolean;
  reason?: string;
  autoTrigger: boolean;
} {
  // Tier check (Creator Pro+ required for third slot)
  const tierLevel = getTierLevel(params.subscriptionTier);
  if (tierLevel < 3) { // creator_pro = 3
    return {
      eligible: false,
      reason: "Master-style training requires Creator Pro plan or higher",
      autoTrigger: false,
    };
  }

  // Running job check
  if (params.hasRunningJob) {
    return {
      eligible: false,
      reason: "A master-style training job is already in progress",
      autoTrigger: false,
    };
  }

  // Sample count check
  if (params.availableSampleCount < MIN_TRAINING_SAMPLES) {
    return {
      eligible: false,
      reason: `Need at least ${MIN_TRAINING_SAMPLES} quality samples (have ${params.availableSampleCount}). Create more episodes to accumulate style samples.`,
      autoTrigger: false,
    };
  }

  // Auto-trigger check
  const autoTrigger = (params.episodesSinceLastTraining ?? 0) >= AUTO_RETRAIN_EPISODE_THRESHOLD;

  return { eligible: true, autoTrigger };
}

// ─── Training Pipeline ──────────────────────────────────────────────────────

/**
 * Prepare a master-style training job for admin approval.
 * This is the first step — creates the job in "pending_admin_approval" state.
 *
 * Flow:
 * 1. prepareMasterStyleJob() → creates job, estimates cost → pending_admin_approval
 * 2. Admin reviews in dashboard → approves/rejects
 * 3. If approved → executeMasterStyleTraining() → preparing → training → completed
 * 4. If rejected → job stays rejected with reason
 */
export function prepareMasterStyleJob(params: {
  creatorId: number;
  sourceProjectIds: number[];
  episodeRange: { start: number; end: number };
  samples: MasterStyleSample[];
  currentStyleVersion: number;
  triggerType: MasterStyleTrainingConfig["triggerType"];
  configOverrides?: Partial<MasterStyleTrainingConfig>;
}): {
  job: MasterStyleJobStatus;
  config: MasterStyleTrainingConfig;
  estimatedCostCents: number;
  requiresAdminApproval: boolean;
} {
  const styleVersion = params.currentStyleVersion + 1;
  const triggerWord = `master_style_${params.creatorId}_v${styleVersion}`;

  const config: MasterStyleTrainingConfig = {
    ...DEFAULT_MASTER_STYLE_CONFIG,
    creatorId: params.creatorId,
    sourceProjectIds: params.sourceProjectIds,
    episodeRange: params.episodeRange,
    styleVersion,
    triggerType: params.triggerType,
    triggerWord,
    ...params.configOverrides,
  };

  // Estimate cost based on steps and samples
  // Replicate pricing: ~$0.001/sec, typical training ~800-1500 seconds for master-style
  const estimatedSeconds = (config.steps / 1000) * 900; // ~900s per 1000 steps for SDXL
  const estimatedCostCents = Math.ceil(estimatedSeconds * 0.1); // $0.001/sec

  const requiresAdminApproval = estimatedCostCents > AUTO_APPROVE_COST_THRESHOLD_CENTS;

  const job: MasterStyleJobStatus = {
    id: `ms_${params.creatorId}_v${styleVersion}_${Date.now()}`,
    creatorId: params.creatorId,
    status: requiresAdminApproval ? "pending_admin_approval" : "approved",
    styleVersion,
    estimatedCostCents,
    progress: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  return { job, config, estimatedCostCents, requiresAdminApproval };
}

/**
 * Approve a pending master-style training job.
 * Called by admin from the dashboard.
 */
export function approveMasterStyleJob(
  job: MasterStyleJobStatus,
  adminId: string,
): MasterStyleJobStatus {
  if (job.status !== "pending_admin_approval") {
    throw new Error(`Cannot approve job in state "${job.status}" — must be "pending_admin_approval"`);
  }

  return {
    ...job,
    status: "approved",
    adminApprovedBy: adminId,
    adminApprovedAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/**
 * Reject a pending master-style training job.
 */
export function rejectMasterStyleJob(
  job: MasterStyleJobStatus,
  adminId: string,
  reason: string,
): MasterStyleJobStatus {
  if (job.status !== "pending_admin_approval") {
    throw new Error(`Cannot reject job in state "${job.status}" — must be "pending_admin_approval"`);
  }

  return {
    ...job,
    status: "rejected",
    adminApprovedBy: adminId,
    adminApprovedAt: Date.now(),
    rejectionReason: reason,
    updatedAt: Date.now(),
  };
}

/**
 * Build the DoRA adapter descriptor from a completed master-style training job.
 * This is what gets loaded into the composition runtime at inference time.
 */
export function buildMasterStyleAdapter(
  job: MasterStyleJobStatus,
  config: MasterStyleTrainingConfig,
): DoRAAdapter {
  if (job.status !== "completed" || !job.modelUrl) {
    throw new Error(`Cannot build adapter from job in state "${job.status}" — must be "completed" with modelUrl`);
  }

  return {
    id: `master_style_${job.creatorId}_v${job.styleVersion}`,
    role: "sakufuu" as AdapterRole, // Uses sakufuu slot in current type system (backward compat)
    type: config.adapterType || "dora",
    weightsUrl: job.modelUrl,
    triggerWord: config.triggerWord,
    defaultWeight: 0.7, // Master-style default weight
    rank: config.rank,
    initialization: config.initialization || "pissa",
    baseModel: config.baseModel,
    metadata: {
      trainedAt: job.completedAt,
      trainingSteps: config.steps,
      trainingLoss: job.metrics?.trainingLoss,
      version: job.styleVersion,
      projectId: config.sourceProjectIds[0],
    },
  };
}

// ─── Sample Curation ────────────────────────────────────────────────────────

/**
 * Select and score style samples for master-style training.
 * Applies quality filtering, diversity balancing, and source-type weighting.
 */
export function curateMasterStyleSamples(
  candidates: MasterStyleSample[],
  config: { qualityThreshold: number; maxSamples: number },
): {
  selected: MasterStyleSample[];
  rejected: Array<{ sample: MasterStyleSample; reason: string }>;
  stats: {
    totalCandidates: number;
    qualityFiltered: number;
    diversityBalanced: number;
    finalCount: number;
  };
} {
  const rejected: Array<{ sample: MasterStyleSample; reason: string }> = [];

  // Step 1: Quality filter
  const qualityFiltered = candidates.filter(s => {
    if (s.qualityScore < config.qualityThreshold) {
      rejected.push({ sample: s, reason: `Quality ${s.qualityScore.toFixed(2)} below threshold ${config.qualityThreshold}` });
      return false;
    }
    return true;
  });

  // Step 2: Diversity balance — ensure mix of source types
  const bySourceType = new Map<string, MasterStyleSample[]>();
  for (const sample of qualityFiltered) {
    const existing = bySourceType.get(sample.sourceType) || [];
    existing.push(sample);
    bySourceType.set(sample.sourceType, existing);
  }

  // Allocate slots proportionally with minimum representation
  const totalSlots = Math.min(config.maxSamples, qualityFiltered.length);
  const sourceTypes = Array.from(bySourceType.keys());
  const minPerType = Math.max(1, Math.floor(totalSlots * 0.1)); // At least 10% per type
  const remainingSlots = totalSlots - (minPerType * sourceTypes.length);

  const selected: MasterStyleSample[] = [];

  // First pass: minimum per type (sorted by quality)
  for (const [type, samples] of Array.from(bySourceType.entries())) {
    const sorted = samples.sort((a, b) => b.qualityScore - a.qualityScore);
    const take = Math.min(minPerType, sorted.length);
    selected.push(...sorted.slice(0, take));
  }

  // Second pass: fill remaining slots by quality (global sort)
  const alreadySelected = new Set(selected.map(s => s.url));
  const remaining = qualityFiltered
    .filter(s => !alreadySelected.has(s.url))
    .sort((a, b) => b.qualityScore - a.qualityScore);

  const additionalSlots = Math.max(0, totalSlots - selected.length);
  selected.push(...remaining.slice(0, additionalSlots));

  return {
    selected,
    rejected,
    stats: {
      totalCandidates: candidates.length,
      qualityFiltered: qualityFiltered.length,
      diversityBalanced: selected.length,
      finalCount: selected.length,
    },
  };
}

// ─── Auto-Retrain Trigger ───────────────────────────────────────────────────

/**
 * Check if auto-retraining should be triggered for a creator.
 * Called after each episode completion.
 */
export function shouldAutoRetrain(params: {
  creatorId: number;
  episodesSinceLastTraining: number;
  lastTrainingStyleVersion: number;
  availableSampleCount: number;
  hasRunningJob: boolean;
  subscriptionTier: string;
}): {
  shouldTrigger: boolean;
  reason?: string;
} {
  // Check eligibility first
  const eligibility = checkMasterStyleEligibility({
    subscriptionTier: params.subscriptionTier,
    availableSampleCount: params.availableSampleCount,
    hasRunningJob: params.hasRunningJob,
    episodesSinceLastTraining: params.episodesSinceLastTraining,
  });

  if (!eligibility.eligible) {
    return { shouldTrigger: false, reason: eligibility.reason };
  }

  if (!eligibility.autoTrigger) {
    return {
      shouldTrigger: false,
      reason: `Only ${params.episodesSinceLastTraining} episodes since last training (threshold: ${AUTO_RETRAIN_EPISODE_THRESHOLD})`,
    };
  }

  return {
    shouldTrigger: true,
    reason: `${params.episodesSinceLastTraining} episodes since last training (threshold: ${AUTO_RETRAIN_EPISODE_THRESHOLD}). Auto-retraining triggered.`,
  };
}

// ─── Style Version Toggle ───────────────────────────────────────────────────

/**
 * Toggle between master-style versions for a creator.
 * Supports A/B testing and rollback to previous versions.
 *
 * The three-slot architecture means:
 * - Only ONE master-style adapter is active at a time in slot 3
 * - Toggling replaces the active adapter, doesn't add a new slot
 * - Previous versions are retained for rollback
 */
export function toggleMasterStyleVersion(params: {
  creatorId: number;
  currentVersion: number;
  targetVersion: number;
  availableVersions: Array<{ version: number; modelUrl: string; triggerWord: string; qualityScore?: number }>;
}): {
  success: boolean;
  newActiveVersion: number;
  adapter: DoRAAdapter | null;
  reason?: string;
} {
  const target = params.availableVersions.find(v => v.version === params.targetVersion);

  if (!target) {
    return {
      success: false,
      newActiveVersion: params.currentVersion,
      adapter: null,
      reason: `Version ${params.targetVersion} not found. Available: ${params.availableVersions.map(v => v.version).join(", ")}`,
    };
  }

  // Build adapter for the target version
  const adapter: DoRAAdapter = {
    id: `master_style_${params.creatorId}_v${target.version}`,
    role: "sakufuu" as AdapterRole, // Backward compat — uses sakufuu slot
    type: "dora",
    weightsUrl: target.modelUrl,
    triggerWord: target.triggerWord,
    defaultWeight: 0.7,
    rank: 24,
    initialization: "pissa",
    baseModel: "stabilityai/stable-diffusion-xl-base-1.0",
    metadata: {
      version: target.version,
    },
  };

  return {
    success: true,
    newActiveVersion: target.version,
    adapter,
  };
}

// ─── Migration: Sakufuu → Master-Style ──────────────────────────────────────

/**
 * Migrate existing sakufuu training jobs to master-style format.
 * This is a metadata-only migration — the trained weights don't change,
 * only the role labeling and metadata structure.
 */
export function migrateSakufuuToMasterStyle(sakufuuJob: {
  id: string;
  creatorId: number;
  modelUrl: string;
  triggerWord: string;
  config: Record<string, unknown>;
  completedAt: number;
}): {
  masterStyleJob: Partial<MasterStyleJobStatus>;
  adapter: DoRAAdapter;
} {
  const masterStyleJob: Partial<MasterStyleJobStatus> = {
    id: `ms_migrated_${sakufuuJob.id}`,
    creatorId: sakufuuJob.creatorId,
    status: "completed",
    styleVersion: 1, // Migrated jobs start at version 1
    modelUrl: sakufuuJob.modelUrl,
    completedAt: sakufuuJob.completedAt,
    createdAt: sakufuuJob.completedAt,
    updatedAt: Date.now(),
  };

  const adapter: DoRAAdapter = {
    id: `master_style_${sakufuuJob.creatorId}_v1_migrated`,
    role: "sakufuu" as AdapterRole, // Still uses sakufuu slot in type system
    type: "dora",
    weightsUrl: sakufuuJob.modelUrl,
    triggerWord: sakufuuJob.triggerWord,
    defaultWeight: 0.7,
    rank: (sakufuuJob.config as any)?.loraRank ?? 16,
    initialization: "pissa",
    baseModel: (sakufuuJob.config as any)?.baseModel ?? "stabilityai/stable-diffusion-xl-base-1.0",
    metadata: {
      trainedAt: sakufuuJob.completedAt,
      version: 1,
    },
  };

  return { masterStyleJob, adapter };
}

// ─── Utility ────────────────────────────────────────────────────────────────

/**
 * Map subscription tier to numeric level for comparison.
 */
function getTierLevel(tier: string): number {
  const levels: Record<string, number> = {
    free_trial: 1,
    creator: 2,
    creator_pro: 3,
    studio: 4,
    enterprise: 5,
  };
  return levels[tier.toLowerCase()] ?? 1;
}

/**
 * Generate a unique trigger word for a creator's master-style.
 */
export function generateMasterStyleTriggerWord(creatorId: number, version: number): string {
  return `mstyle_${creatorId}_v${version}`;
}

/**
 * Estimate training cost in cents based on configuration.
 */
export function estimateTrainingCost(config: MasterStyleTrainingConfig): number {
  // Replicate pricing: ~$0.001/sec
  // SDXL training: ~900s per 1000 steps at resolution 768
  const resolutionFactor = config.resolution >= 768 ? 1.3 : 1.0;
  const estimatedSeconds = (config.steps / 1000) * 900 * resolutionFactor;
  return Math.ceil(estimatedSeconds * 0.1); // $0.001/sec → cents
}
