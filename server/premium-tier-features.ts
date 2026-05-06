/**
 * Wave 6B — Item 3: Premium Tier Features
 *
 * Consolidates all subscription-tier-gated runtime behaviors:
 * 1. Model access gating: maps subscription tier → provider-router request tier
 * 2. Priority queue weighting: tier-derived priority for job scheduling
 * 3. Extended generation limits: panels/episode, episodes/month enforcement
 * 4. Composition mode gating: three-adapter composition restricted to Creator Pro+
 *
 * This module is the single source of truth for "what does this tier unlock?"
 * at runtime. It reads from the canonical TIERS config (stripe/products.ts)
 * and provides enforcement functions consumed by:
 * - credit-gateway.ts (model tier check)
 * - generation-queue.ts (priority weighting)
 * - batch-assembly-queue.ts (priority weighting)
 * - adapter-composer-pipeline.ts (composition gating)
 * - pipelineOrchestrator.ts (limit enforcement)
 *
 * @see server/stripe/products.ts for tier definitions
 * @see shared/tiers.ts for tier ordering
 */

import { TIERS, type TierKey, normalizeTier } from "./stripe/products";
import type { ProviderTier } from "./provider-router/types";
import { tierLevel, meetsMinTier } from "../shared/tiers";

// ─── 3.1: Model Access Gating ──────────────────────────────────────────────

/**
 * Maps a subscription tier to the highest allowed provider-router request tier.
 * This determines which quality level of models the user can access.
 *
 * Mapping:
 * - free_trial → "budget"
 * - creator → "standard"
 * - creator_pro → "premium"
 * - studio → "flagship"
 * - enterprise → "flagship"
 */
export function getMaxProviderTier(subscriptionTier: string): ProviderTier {
  const normalized = normalizeTier(subscriptionTier);
  const config = TIERS[normalized];
  const allowed = config.allowedModelTiers;

  // Map the highest allowed model tier to a ProviderTier
  if (allowed.includes("ultra")) return "flagship";
  if (allowed.includes("premium")) return "premium";
  if (allowed.includes("standard")) return "standard";
  return "budget";
}

/**
 * Check if a user's subscription tier allows access to a specific model tier.
 * Used by credit-gateway before placing holds.
 */
export function isModelTierAllowed(
  subscriptionTier: string,
  requestedModelTier: string
): boolean {
  const normalized = normalizeTier(subscriptionTier);
  const config = TIERS[normalized];
  return config.allowedModelTiers.includes(requestedModelTier);
}

/**
 * Get all allowed model tiers for a subscription tier.
 * Returns an ordered array from lowest to highest quality.
 */
export function getAllowedModelTiers(subscriptionTier: string): string[] {
  const normalized = normalizeTier(subscriptionTier);
  return [...TIERS[normalized].allowedModelTiers];
}

/**
 * Resolve the effective provider-router request tier for a generation request.
 * If the user requests a tier higher than their subscription allows, it's
 * clamped down to their max. If they request lower, it's honored as-is.
 *
 * @param subscriptionTier - User's subscription tier (e.g., "creator_pro")
 * @param requestedTier - The tier requested for this generation (e.g., "premium")
 * @returns The effective tier to use (clamped to subscription max)
 */
export function resolveEffectiveProviderTier(
  subscriptionTier: string,
  requestedTier: ProviderTier
): ProviderTier {
  const maxTier = getMaxProviderTier(subscriptionTier);
  const tierOrder: ProviderTier[] = ["budget", "standard", "premium", "flagship"];
  const maxIdx = tierOrder.indexOf(maxTier);
  const requestedIdx = tierOrder.indexOf(requestedTier);

  if (requestedIdx <= maxIdx) {
    return requestedTier; // User can afford this tier
  }
  return maxTier; // Clamp to max allowed
}

/**
 * Get the model tier upgrade suggestion when a user is blocked.
 * Returns the minimum subscription tier needed for the requested model tier.
 */
export function getUpgradeSuggestionForModelTier(
  requestedModelTier: string
): { requiredTier: TierKey; tierName: string } | null {
  const tierKeys: TierKey[] = ["free_trial", "creator", "creator_pro", "studio", "enterprise"];
  for (const tier of tierKeys) {
    if (TIERS[tier].allowedModelTiers.includes(requestedModelTier)) {
      return { requiredTier: tier, tierName: TIERS[tier].name };
    }
  }
  return null;
}

// ─── 3.2: Priority Queue Weighting ─────────────────────────────────────────

/**
 * Queue priority values by subscription tier.
 * Lower number = higher priority (processed first).
 *
 * From TIERS config:
 * - free_trial: 5 (lowest priority)
 * - creator: 4
 * - creator_pro: 3
 * - studio: 1 (highest priority)
 * - enterprise: 1 (highest priority)
 */
export function getQueuePriority(subscriptionTier: string): number {
  const normalized = normalizeTier(subscriptionTier);
  return TIERS[normalized].queuePriority;
}

/**
 * Get the concurrent generation limit for a subscription tier.
 * This determines how many jobs can run simultaneously for one user.
 */
export function getConcurrentGenerationLimit(subscriptionTier: string): number {
  const normalized = normalizeTier(subscriptionTier);
  return TIERS[normalized].concurrentGenerationLimit;
}

/**
 * Determine if a job should be promoted in the queue based on tier priority.
 * A job is promotable if its priority is strictly higher (lower number) than
 * the average priority of currently queued jobs.
 */
export function shouldPromoteInQueue(
  jobPriority: number,
  queuedJobPriorities: number[]
): boolean {
  if (queuedJobPriorities.length === 0) return false;
  const avgPriority = queuedJobPriorities.reduce((a, b) => a + b, 0) / queuedJobPriorities.length;
  return jobPriority < avgPriority;
}

/**
 * Sort jobs by priority (lower number first), then by queue time (FIFO within same priority).
 * This is the canonical ordering function for all queue implementations.
 */
export function sortByPriority<T extends { priority: number; queuedAt: number }>(
  jobs: T[]
): T[] {
  return [...jobs].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.queuedAt - b.queuedAt; // FIFO within same priority
  });
}

/**
 * Calculate estimated wait time based on position and priority.
 * Premium users get shorter estimated waits due to priority promotion.
 *
 * @param position - Position in the queue (1-indexed)
 * @param priority - Job priority (1-5)
 * @param avgJobDurationMs - Average job duration in ms (default: 15s)
 * @returns Estimated wait time in ms
 */
export function estimateWaitTime(
  position: number,
  priority: number,
  avgJobDurationMs: number = 15_000
): number {
  // Priority discount: higher priority jobs skip ahead
  // Priority 1 gets 60% discount, priority 5 gets 0% discount
  const priorityDiscount = (5 - priority) * 0.15;
  const effectivePosition = Math.max(1, Math.ceil(position * (1 - priorityDiscount)));
  return effectivePosition * avgJobDurationMs;
}

/**
 * Check if a user has priority queue access (Creator Pro+ tiers).
 */
export function hasPriorityQueueAccess(subscriptionTier: string): boolean {
  const normalized = normalizeTier(subscriptionTier);
  return TIERS[normalized].hasPriorityQueue;
}

// ─── 3.3: Extended Generation Limits ────────────────────────────────────────

/**
 * Generation limit configuration resolved from subscription tier.
 */
export interface GenerationLimits {
  /** Max panels per chapter/episode */
  maxPanelsPerChapter: number;
  /** Max anime episodes per month */
  maxAnimeEpisodesPerMonth: number;
  /** Max chapters per project */
  maxChaptersPerProject: number;
  /** Max projects */
  maxProjects: number;
  /** Max LoRA characters */
  maxLoraCharacters: number;
  /** Max voice clones */
  maxVoiceClones: number;
  /** Max concurrent generation jobs */
  concurrentGenerationLimit: number;
  /** Episode length cap in seconds */
  episodeLengthCapSeconds: number;
  /** Max motion LoRA trainings per month */
  maxMotionLoraTrainingsPerMonth: number;
}

/**
 * Get all generation limits for a subscription tier.
 */
export function getGenerationLimits(subscriptionTier: string): GenerationLimits {
  const normalized = normalizeTier(subscriptionTier);
  const config = TIERS[normalized];
  return {
    maxPanelsPerChapter: config.maxPanelsPerChapter,
    maxAnimeEpisodesPerMonth: config.maxAnimeEpisodesPerMonth,
    maxChaptersPerProject: config.maxChaptersPerProject,
    maxProjects: config.maxProjects,
    maxLoraCharacters: config.maxLoraCharacters,
    maxVoiceClones: config.maxVoiceClones,
    concurrentGenerationLimit: config.concurrentGenerationLimit,
    episodeLengthCapSeconds: config.episodeLengthCapSeconds,
    maxMotionLoraTrainingsPerMonth: config.maxMotionLoraTrainingsPerMonth,
  };
}

/**
 * Check if a user can create another panel in a chapter.
 *
 * @param subscriptionTier - User's subscription tier
 * @param currentPanelCount - Current number of panels in the chapter
 * @returns Whether the panel can be created, with reason if not
 */
export function canCreatePanel(
  subscriptionTier: string,
  currentPanelCount: number
): { allowed: boolean; reason?: string; limit: number; current: number } {
  const limits = getGenerationLimits(subscriptionTier);
  const limit = limits.maxPanelsPerChapter;

  if (currentPanelCount >= limit) {
    const normalized = normalizeTier(subscriptionTier);
    const tierName = TIERS[normalized].name;
    return {
      allowed: false,
      reason: `Panel limit reached: ${tierName} plan allows ${limit} panels per chapter. Current: ${currentPanelCount}.`,
      limit,
      current: currentPanelCount,
    };
  }

  return { allowed: true, limit, current: currentPanelCount };
}

/**
 * Check if a user can generate another anime episode this month.
 *
 * @param subscriptionTier - User's subscription tier
 * @param currentMonthlyEpisodeCount - Episodes generated this billing month
 * @returns Whether the episode can be generated, with reason if not
 */
export function canGenerateEpisode(
  subscriptionTier: string,
  currentMonthlyEpisodeCount: number
): { allowed: boolean; reason?: string; limit: number; current: number; remaining: number } {
  const limits = getGenerationLimits(subscriptionTier);
  const limit = limits.maxAnimeEpisodesPerMonth;
  const remaining = Math.max(0, limit - currentMonthlyEpisodeCount);

  if (currentMonthlyEpisodeCount >= limit) {
    const normalized = normalizeTier(subscriptionTier);
    const tierName = TIERS[normalized].name;
    return {
      allowed: false,
      reason: `Monthly episode limit reached: ${tierName} plan allows ${limit} episodes/month. Used: ${currentMonthlyEpisodeCount}.`,
      limit,
      current: currentMonthlyEpisodeCount,
      remaining: 0,
    };
  }

  return { allowed: true, limit, current: currentMonthlyEpisodeCount, remaining };
}

/**
 * Check if a user can create another chapter in a project.
 */
export function canCreateChapter(
  subscriptionTier: string,
  currentChapterCount: number
): { allowed: boolean; reason?: string; limit: number; current: number } {
  const limits = getGenerationLimits(subscriptionTier);
  const limit = limits.maxChaptersPerProject;

  if (currentChapterCount >= limit) {
    const normalized = normalizeTier(subscriptionTier);
    const tierName = TIERS[normalized].name;
    return {
      allowed: false,
      reason: `Chapter limit reached: ${tierName} plan allows ${limit} chapters per project. Current: ${currentChapterCount}.`,
      limit,
      current: currentChapterCount,
    };
  }

  return { allowed: true, limit, current: currentChapterCount };
}

/**
 * Check if a user can train another LoRA character.
 */
export function canTrainLoraCharacter(
  subscriptionTier: string,
  currentLoraCount: number
): { allowed: boolean; reason?: string; limit: number; current: number } {
  const limits = getGenerationLimits(subscriptionTier);
  const limit = limits.maxLoraCharacters;

  if (currentLoraCount >= limit) {
    const normalized = normalizeTier(subscriptionTier);
    const tierName = TIERS[normalized].name;
    return {
      allowed: false,
      reason: `LoRA character limit reached: ${tierName} plan allows ${limit} LoRA characters. Current: ${currentLoraCount}.`,
      limit,
      current: currentLoraCount,
    };
  }

  return { allowed: true, limit, current: currentLoraCount };
}

/**
 * Check if an episode duration is within the tier's cap.
 */
export function isEpisodeDurationAllowed(
  subscriptionTier: string,
  durationSeconds: number
): { allowed: boolean; reason?: string; capSeconds: number } {
  const limits = getGenerationLimits(subscriptionTier);
  const cap = limits.episodeLengthCapSeconds;

  if (durationSeconds > cap) {
    const normalized = normalizeTier(subscriptionTier);
    const tierName = TIERS[normalized].name;
    const capMinutes = Math.floor(cap / 60);
    const requestedMinutes = Math.ceil(durationSeconds / 60);
    return {
      allowed: false,
      reason: `Episode too long: ${tierName} plan caps at ${capMinutes} minutes. Requested: ${requestedMinutes} minutes.`,
      capSeconds: cap,
    };
  }

  return { allowed: true, capSeconds: cap };
}

/**
 * Check if a user can train another motion LoRA this month.
 */
export function canTrainMotionLora(
  subscriptionTier: string,
  currentMonthlyTrainingCount: number
): { allowed: boolean; reason?: string; limit: number; current: number } {
  const limits = getGenerationLimits(subscriptionTier);
  const limit = limits.maxMotionLoraTrainingsPerMonth;

  if (limit === 0) {
    const normalized = normalizeTier(subscriptionTier);
    const tierName = TIERS[normalized].name;
    return {
      allowed: false,
      reason: `Motion LoRA training not available on ${tierName} plan. Upgrade to Creator Pro or higher.`,
      limit: 0,
      current: currentMonthlyTrainingCount,
    };
  }

  if (currentMonthlyTrainingCount >= limit) {
    const normalized = normalizeTier(subscriptionTier);
    const tierName = TIERS[normalized].name;
    return {
      allowed: false,
      reason: `Monthly motion LoRA training limit reached: ${tierName} plan allows ${limit}/month. Used: ${currentMonthlyTrainingCount}.`,
      limit,
      current: currentMonthlyTrainingCount,
    };
  }

  return { allowed: true, limit, current: currentMonthlyTrainingCount };
}

// ─── 3.4: Premium Composition Mode Gating ──────────────────────────────────

/**
 * Composition modes available at each tier level:
 * - "single": Legacy single-LoRA path (all tiers)
 * - "dual": Two-adapter composition: genre + character (Creator+)
 * - "triple": Three-adapter composition: genre + character + sakufuu (Creator Pro+)
 */
export type CompositionMode = "single" | "dual" | "triple";

/**
 * Get the maximum composition mode allowed for a subscription tier.
 *
 * Mapping:
 * - free_trial: "single" (no LoRA composition)
 * - creator: "dual" (genre + character)
 * - creator_pro: "triple" (genre + character + sakufuu)
 * - studio: "triple"
 * - enterprise: "triple"
 */
export function getMaxCompositionMode(subscriptionTier: string): CompositionMode {
  const normalized = normalizeTier(subscriptionTier);
  const config = TIERS[normalized];

  // Three-adapter requires Creator Pro+ (has priority queue as proxy indicator)
  if (config.hasPriorityQueue) return "triple";
  // Dual requires at least Creator (has LoRA characters)
  if (config.maxLoraCharacters > 0) return "dual";
  // Free tier: single only
  return "single";
}

/**
 * Get the maximum number of adapters allowed for composition.
 */
export function getMaxAdapterCount(subscriptionTier: string): number {
  const mode = getMaxCompositionMode(subscriptionTier);
  switch (mode) {
    case "triple": return 3;
    case "dual": return 2;
    case "single": return 1;
  }
}

/**
 * Check if a specific composition configuration is allowed for a tier.
 *
 * @param subscriptionTier - User's subscription tier
 * @param adapterCount - Number of adapters being composed
 * @returns Whether the composition is allowed
 */
export function isCompositionAllowed(
  subscriptionTier: string,
  adapterCount: number
): { allowed: boolean; reason?: string; maxAdapters: number; mode: CompositionMode } {
  const maxAdapters = getMaxAdapterCount(subscriptionTier);
  const mode = getMaxCompositionMode(subscriptionTier);

  if (adapterCount > maxAdapters) {
    const normalized = normalizeTier(subscriptionTier);
    const tierName = TIERS[normalized].name;
    return {
      allowed: false,
      reason: `${adapterCount}-adapter composition requires ${adapterCount === 3 ? "Creator Pro" : "Creator"} plan or higher. Your ${tierName} plan allows up to ${maxAdapters} adapter(s).`,
      maxAdapters,
      mode,
    };
  }

  return { allowed: true, maxAdapters, mode };
}

/**
 * Get the allowed LoRA stack layers for a subscription tier.
 * This determines which adapter roles can be stacked.
 *
 * From TIERS config:
 * - free_trial: [] (no LoRA)
 * - creator: ["appearance"]
 * - creator_pro: ["appearance", "motion"]
 * - studio: ["appearance", "motion", "environment", "style"]
 * - enterprise: ["appearance", "motion", "environment", "style"]
 */
export function getAllowedLoraStackLayers(
  subscriptionTier: string
): ("appearance" | "motion" | "environment" | "style")[] {
  const normalized = normalizeTier(subscriptionTier);
  return [...TIERS[normalized].loraStackLayers];
}

/**
 * Check if a specific LoRA layer is allowed for a tier.
 */
export function isLoraLayerAllowed(
  subscriptionTier: string,
  layer: "appearance" | "motion" | "environment" | "style"
): boolean {
  const allowed = getAllowedLoraStackLayers(subscriptionTier);
  return allowed.includes(layer);
}

// ─── Aggregate Tier Status ──────────────────────────────────────────────────

/**
 * Complete premium tier status for a user.
 * Used by the frontend to display tier benefits and current usage.
 */
export interface PremiumTierStatus {
  tier: TierKey;
  tierName: string;
  tierLevel: number;
  modelAccess: {
    maxProviderTier: ProviderTier;
    allowedModelTiers: string[];
  };
  queue: {
    priority: number;
    hasPriorityAccess: boolean;
    concurrentLimit: number;
  };
  limits: GenerationLimits;
  composition: {
    mode: CompositionMode;
    maxAdapters: number;
    allowedLoraLayers: string[];
  };
  features: {
    canUploadManga: boolean;
    canMonetize: boolean;
    canExportManga: boolean;
    canExportAnime: boolean;
    hasApiAccess: boolean;
    hasCustomNarrator: boolean;
    hasPrioritySupport: boolean;
    motionLoraEnabled: boolean;
  };
}

/**
 * Get the complete premium tier status for a subscription tier.
 * This is the single function the frontend calls to understand all tier benefits.
 */
export function getPremiumTierStatus(subscriptionTier: string): PremiumTierStatus {
  const normalized = normalizeTier(subscriptionTier);
  const config = TIERS[normalized];

  return {
    tier: normalized,
    tierName: config.name,
    tierLevel: tierLevel(normalized),
    modelAccess: {
      maxProviderTier: getMaxProviderTier(normalized),
      allowedModelTiers: getAllowedModelTiers(normalized),
    },
    queue: {
      priority: getQueuePriority(normalized),
      hasPriorityAccess: hasPriorityQueueAccess(normalized),
      concurrentLimit: getConcurrentGenerationLimit(normalized),
    },
    limits: getGenerationLimits(normalized),
    composition: {
      mode: getMaxCompositionMode(normalized),
      maxAdapters: getMaxAdapterCount(normalized),
      allowedLoraLayers: getAllowedLoraStackLayers(normalized),
    },
    features: {
      canUploadManga: config.canUploadManga,
      canMonetize: config.canMonetize,
      canExportManga: config.canExportManga,
      canExportAnime: config.canExportAnime,
      hasApiAccess: config.hasApiAccess,
      hasCustomNarrator: config.hasCustomNarrator,
      hasPrioritySupport: config.hasPrioritySupport,
      motionLoraEnabled: config.motionLoraEnabled,
    },
  };
}

/**
 * Get the upgrade path for a user — what they'd gain by upgrading.
 * Returns null if already at the highest tier.
 */
export function getUpgradeBenefits(
  currentTier: string
): { nextTier: TierKey; gains: string[] } | null {
  const normalized = normalizeTier(currentTier);
  const currentLevel = tierLevel(normalized);

  const tierKeys: TierKey[] = ["free_trial", "creator", "creator_pro", "studio", "enterprise"];
  if (currentLevel >= tierKeys.length - 1) return null; // Already at enterprise

  const nextTier = tierKeys[currentLevel + 1];
  const currentConfig = TIERS[normalized];
  const nextConfig = TIERS[nextTier];

  const gains: string[] = [];

  // Model access gains
  const newModelTiers = nextConfig.allowedModelTiers.filter(
    t => !currentConfig.allowedModelTiers.includes(t)
  );
  if (newModelTiers.length > 0) {
    gains.push(`Access to ${newModelTiers.join(", ")} model tier(s)`);
  }

  // Episode limit gains
  if (nextConfig.maxAnimeEpisodesPerMonth > currentConfig.maxAnimeEpisodesPerMonth) {
    gains.push(`${nextConfig.maxAnimeEpisodesPerMonth} episodes/month (up from ${currentConfig.maxAnimeEpisodesPerMonth})`);
  }

  // Panel limit gains
  if (nextConfig.maxPanelsPerChapter > currentConfig.maxPanelsPerChapter) {
    gains.push(`${nextConfig.maxPanelsPerChapter} panels/chapter (up from ${currentConfig.maxPanelsPerChapter})`);
  }

  // Concurrency gains
  if (nextConfig.concurrentGenerationLimit > currentConfig.concurrentGenerationLimit) {
    gains.push(`${nextConfig.concurrentGenerationLimit} concurrent generations (up from ${currentConfig.concurrentGenerationLimit})`);
  }

  // Priority queue
  if (nextConfig.hasPriorityQueue && !currentConfig.hasPriorityQueue) {
    gains.push("Priority queue access");
  }

  // Composition mode
  const currentMode = getMaxCompositionMode(normalized);
  const nextMode = getMaxCompositionMode(nextTier);
  if (currentMode !== nextMode) {
    gains.push(`${nextMode}-adapter composition (up from ${currentMode})`);
  }

  // LoRA
  if (nextConfig.maxLoraCharacters > currentConfig.maxLoraCharacters) {
    gains.push(`${nextConfig.maxLoraCharacters} LoRA characters (up from ${currentConfig.maxLoraCharacters})`);
  }

  // Motion LoRA
  if (nextConfig.motionLoraEnabled && !currentConfig.motionLoraEnabled) {
    gains.push("Motion LoRA training enabled");
  }

  return { nextTier, gains };
}
