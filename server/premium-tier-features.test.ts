/**
 * Wave 6B — Item 3: Premium Tier Features Tests
 *
 * Covers:
 * - 3.1: Model access gating (tier → provider tier mapping)
 * - 3.2: Priority queue weighting (scheduling, promotion, wait estimation)
 * - 3.3: Extended generation limits (panels, episodes, chapters, LoRA, duration)
 * - 3.4: Premium composition mode gating (single/dual/triple adapter)
 * - Aggregate tier status + upgrade benefits
 */

import { describe, it, expect } from "vitest";
import {
  // 3.1: Model Access Gating
  getMaxProviderTier,
  isModelTierAllowed,
  getAllowedModelTiers,
  resolveEffectiveProviderTier,
  getUpgradeSuggestionForModelTier,
  // 3.2: Priority Queue
  getQueuePriority,
  getConcurrentGenerationLimit,
  shouldPromoteInQueue,
  sortByPriority,
  estimateWaitTime,
  hasPriorityQueueAccess,
  // 3.3: Generation Limits
  getGenerationLimits,
  canCreatePanel,
  canGenerateEpisode,
  canCreateChapter,
  canTrainLoraCharacter,
  isEpisodeDurationAllowed,
  canTrainMotionLora,
  // 3.4: Composition Mode Gating
  getMaxCompositionMode,
  getMaxAdapterCount,
  isCompositionAllowed,
  getAllowedLoraStackLayers,
  isLoraLayerAllowed,
  // Aggregate
  getPremiumTierStatus,
  getUpgradeBenefits,
  // Types
  type CompositionMode,
  type GenerationLimits,
  type PremiumTierStatus,
} from "./premium-tier-features";

// ═══════════════════════════════════════════════════════════════════════════
// 3.1: MODEL ACCESS GATING
// ═══════════════════════════════════════════════════════════════════════════

describe("3.1: Model Access Gating", () => {
  describe("getMaxProviderTier", () => {
    it("free_trial maps to budget", () => {
      expect(getMaxProviderTier("free_trial")).toBe("budget");
    });

    it("creator maps to standard", () => {
      expect(getMaxProviderTier("creator")).toBe("standard");
    });

    it("creator_pro maps to premium", () => {
      expect(getMaxProviderTier("creator_pro")).toBe("premium");
    });

    it("studio maps to flagship", () => {
      expect(getMaxProviderTier("studio")).toBe("flagship");
    });

    it("enterprise maps to flagship", () => {
      expect(getMaxProviderTier("enterprise")).toBe("flagship");
    });

    it("unknown tier defaults to budget (via normalizeTier)", () => {
      expect(getMaxProviderTier("nonexistent")).toBe("budget");
    });
  });

  describe("isModelTierAllowed", () => {
    it("free_trial can only access budget", () => {
      expect(isModelTierAllowed("free_trial", "budget")).toBe(true);
      expect(isModelTierAllowed("free_trial", "standard")).toBe(false);
      expect(isModelTierAllowed("free_trial", "premium")).toBe(false);
      expect(isModelTierAllowed("free_trial", "ultra")).toBe(false);
    });

    it("creator can access budget and standard", () => {
      expect(isModelTierAllowed("creator", "budget")).toBe(true);
      expect(isModelTierAllowed("creator", "standard")).toBe(true);
      expect(isModelTierAllowed("creator", "premium")).toBe(false);
    });

    it("creator_pro can access budget, standard, and premium", () => {
      expect(isModelTierAllowed("creator_pro", "budget")).toBe(true);
      expect(isModelTierAllowed("creator_pro", "standard")).toBe(true);
      expect(isModelTierAllowed("creator_pro", "premium")).toBe(true);
      expect(isModelTierAllowed("creator_pro", "ultra")).toBe(false);
    });

    it("studio can access all tiers including ultra", () => {
      expect(isModelTierAllowed("studio", "budget")).toBe(true);
      expect(isModelTierAllowed("studio", "standard")).toBe(true);
      expect(isModelTierAllowed("studio", "premium")).toBe(true);
      expect(isModelTierAllowed("studio", "ultra")).toBe(true);
    });
  });

  describe("getAllowedModelTiers", () => {
    it("returns correct tiers for each subscription level", () => {
      expect(getAllowedModelTiers("free_trial")).toEqual(["budget"]);
      expect(getAllowedModelTiers("creator")).toEqual(["budget", "standard"]);
      expect(getAllowedModelTiers("creator_pro")).toEqual(["budget", "standard", "premium"]);
      expect(getAllowedModelTiers("studio")).toEqual(["budget", "standard", "premium", "ultra"]);
    });

    it("returns a copy (not mutable reference)", () => {
      const tiers = getAllowedModelTiers("studio");
      tiers.push("test");
      expect(getAllowedModelTiers("studio")).not.toContain("test");
    });
  });

  describe("resolveEffectiveProviderTier", () => {
    it("honors requested tier when within subscription limit", () => {
      expect(resolveEffectiveProviderTier("studio", "budget")).toBe("budget");
      expect(resolveEffectiveProviderTier("studio", "premium")).toBe("premium");
      expect(resolveEffectiveProviderTier("creator_pro", "standard")).toBe("standard");
    });

    it("clamps to max when requested tier exceeds subscription", () => {
      expect(resolveEffectiveProviderTier("free_trial", "premium")).toBe("budget");
      expect(resolveEffectiveProviderTier("creator", "flagship")).toBe("standard");
      expect(resolveEffectiveProviderTier("creator_pro", "flagship")).toBe("premium");
    });

    it("flagship tier only available for studio+", () => {
      expect(resolveEffectiveProviderTier("studio", "flagship")).toBe("flagship");
      expect(resolveEffectiveProviderTier("enterprise", "flagship")).toBe("flagship");
      expect(resolveEffectiveProviderTier("creator_pro", "flagship")).toBe("premium");
    });
  });

  describe("getUpgradeSuggestionForModelTier", () => {
    it("suggests free_trial for budget (already available at lowest)", () => {
      const result = getUpgradeSuggestionForModelTier("budget");
      expect(result).not.toBeNull();
      expect(result!.requiredTier).toBe("free_trial");
    });

    it("suggests creator for standard tier", () => {
      const result = getUpgradeSuggestionForModelTier("standard");
      expect(result).not.toBeNull();
      expect(result!.requiredTier).toBe("creator");
    });

    it("suggests creator_pro for premium tier", () => {
      const result = getUpgradeSuggestionForModelTier("premium");
      expect(result).not.toBeNull();
      expect(result!.requiredTier).toBe("creator_pro");
    });

    it("suggests studio for ultra tier", () => {
      const result = getUpgradeSuggestionForModelTier("ultra");
      expect(result).not.toBeNull();
      expect(result!.requiredTier).toBe("studio");
    });

    it("returns null for nonexistent model tier", () => {
      expect(getUpgradeSuggestionForModelTier("mythical")).toBeNull();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3.2: PRIORITY QUEUE WEIGHTING
// ═══════════════════════════════════════════════════════════════════════════

describe("3.2: Priority Queue Weighting", () => {
  describe("getQueuePriority", () => {
    it("free_trial has lowest priority (5)", () => {
      expect(getQueuePriority("free_trial")).toBe(5);
    });

    it("creator has priority 4", () => {
      expect(getQueuePriority("creator")).toBe(4);
    });

    it("creator_pro has priority 3", () => {
      expect(getQueuePriority("creator_pro")).toBe(3);
    });

    it("studio has highest priority (1)", () => {
      expect(getQueuePriority("studio")).toBe(1);
    });

    it("enterprise has highest priority (1)", () => {
      expect(getQueuePriority("enterprise")).toBe(1);
    });

    it("priority values are monotonically decreasing with tier level", () => {
      const priorities = [
        getQueuePriority("free_trial"),
        getQueuePriority("creator"),
        getQueuePriority("creator_pro"),
        getQueuePriority("studio"),
      ];
      for (let i = 1; i < priorities.length; i++) {
        expect(priorities[i]).toBeLessThan(priorities[i - 1]);
      }
    });
  });

  describe("getConcurrentGenerationLimit", () => {
    it("free_trial allows 1 concurrent job", () => {
      expect(getConcurrentGenerationLimit("free_trial")).toBe(1);
    });

    it("creator allows 2 concurrent jobs", () => {
      expect(getConcurrentGenerationLimit("creator")).toBe(2);
    });

    it("creator_pro allows 3 concurrent jobs", () => {
      expect(getConcurrentGenerationLimit("creator_pro")).toBe(3);
    });

    it("studio allows 5 concurrent jobs", () => {
      expect(getConcurrentGenerationLimit("studio")).toBe(5);
    });

    it("enterprise allows 10 concurrent jobs", () => {
      expect(getConcurrentGenerationLimit("enterprise")).toBe(10);
    });
  });

  describe("shouldPromoteInQueue", () => {
    it("promotes when job priority is below average", () => {
      expect(shouldPromoteInQueue(1, [3, 4, 5, 5])).toBe(true);
    });

    it("does not promote when job priority equals average", () => {
      expect(shouldPromoteInQueue(4, [3, 4, 5])).toBe(false);
    });

    it("does not promote when job priority is above average", () => {
      expect(shouldPromoteInQueue(5, [3, 4, 5])).toBe(false);
    });

    it("returns false for empty queue", () => {
      expect(shouldPromoteInQueue(1, [])).toBe(false);
    });

    it("promotes studio user (priority 1) in queue of free users (priority 5)", () => {
      expect(shouldPromoteInQueue(1, [5, 5, 5, 5, 5])).toBe(true);
    });
  });

  describe("sortByPriority", () => {
    it("sorts by priority ascending (lower = higher priority)", () => {
      const jobs = [
        { priority: 5, queuedAt: 100 },
        { priority: 1, queuedAt: 200 },
        { priority: 3, queuedAt: 150 },
      ];
      const sorted = sortByPriority(jobs);
      expect(sorted[0].priority).toBe(1);
      expect(sorted[1].priority).toBe(3);
      expect(sorted[2].priority).toBe(5);
    });

    it("uses FIFO ordering within same priority", () => {
      const jobs = [
        { priority: 3, queuedAt: 300 },
        { priority: 3, queuedAt: 100 },
        { priority: 3, queuedAt: 200 },
      ];
      const sorted = sortByPriority(jobs);
      expect(sorted[0].queuedAt).toBe(100);
      expect(sorted[1].queuedAt).toBe(200);
      expect(sorted[2].queuedAt).toBe(300);
    });

    it("does not mutate original array", () => {
      const jobs = [
        { priority: 5, queuedAt: 100 },
        { priority: 1, queuedAt: 200 },
      ];
      const sorted = sortByPriority(jobs);
      expect(jobs[0].priority).toBe(5); // Original unchanged
      expect(sorted[0].priority).toBe(1);
    });

    it("handles empty array", () => {
      expect(sortByPriority([])).toEqual([]);
    });
  });

  describe("estimateWaitTime", () => {
    it("priority 1 gets 60% discount on wait", () => {
      const wait = estimateWaitTime(10, 1, 15_000);
      // Effective position: ceil(10 * (1 - 0.60)) = ceil(4) = 4
      expect(wait).toBe(4 * 15_000);
    });

    it("priority 5 gets no discount", () => {
      const wait = estimateWaitTime(10, 5, 15_000);
      // Effective position: ceil(10 * (1 - 0.00)) = 10
      expect(wait).toBe(10 * 15_000);
    });

    it("priority 3 gets 30% discount", () => {
      const wait = estimateWaitTime(10, 3, 15_000);
      // Effective position: ceil(10 * (1 - 0.30)) = ceil(7) = 7
      expect(wait).toBe(7 * 15_000);
    });

    it("minimum effective position is 1", () => {
      const wait = estimateWaitTime(1, 1, 15_000);
      // Effective position: max(1, ceil(1 * 0.40)) = max(1, 1) = 1
      expect(wait).toBe(1 * 15_000);
    });
  });

  describe("hasPriorityQueueAccess", () => {
    it("free_trial does not have priority access", () => {
      expect(hasPriorityQueueAccess("free_trial")).toBe(false);
    });

    it("creator does not have priority access", () => {
      expect(hasPriorityQueueAccess("creator")).toBe(false);
    });

    it("creator_pro has priority access", () => {
      expect(hasPriorityQueueAccess("creator_pro")).toBe(true);
    });

    it("studio has priority access", () => {
      expect(hasPriorityQueueAccess("studio")).toBe(true);
    });

    it("enterprise has priority access", () => {
      expect(hasPriorityQueueAccess("enterprise")).toBe(true);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3.3: EXTENDED GENERATION LIMITS
// ═══════════════════════════════════════════════════════════════════════════

describe("3.3: Extended Generation Limits", () => {
  describe("getGenerationLimits", () => {
    it("returns correct limits for free_trial", () => {
      const limits = getGenerationLimits("free_trial");
      expect(limits.maxPanelsPerChapter).toBe(20);
      expect(limits.maxAnimeEpisodesPerMonth).toBe(1);
      expect(limits.maxChaptersPerProject).toBe(3);
      expect(limits.maxProjects).toBe(3);
      expect(limits.maxLoraCharacters).toBe(0);
      expect(limits.concurrentGenerationLimit).toBe(1);
      expect(limits.episodeLengthCapSeconds).toBe(300);
      expect(limits.maxMotionLoraTrainingsPerMonth).toBe(0);
    });

    it("returns correct limits for creator", () => {
      const limits = getGenerationLimits("creator");
      expect(limits.maxPanelsPerChapter).toBe(30);
      expect(limits.maxAnimeEpisodesPerMonth).toBe(5);
      expect(limits.maxChaptersPerProject).toBe(12);
      expect(limits.maxLoraCharacters).toBe(3);
      expect(limits.concurrentGenerationLimit).toBe(2);
    });

    it("returns correct limits for creator_pro", () => {
      const limits = getGenerationLimits("creator_pro");
      expect(limits.maxPanelsPerChapter).toBe(50);
      expect(limits.maxAnimeEpisodesPerMonth).toBe(15);
      expect(limits.maxChaptersPerProject).toBe(50);
      expect(limits.maxLoraCharacters).toBe(10);
      expect(limits.concurrentGenerationLimit).toBe(3);
      expect(limits.maxMotionLoraTrainingsPerMonth).toBe(5);
    });

    it("returns correct limits for studio", () => {
      const limits = getGenerationLimits("studio");
      expect(limits.maxPanelsPerChapter).toBe(999);
      expect(limits.maxAnimeEpisodesPerMonth).toBe(999);
      expect(limits.maxChaptersPerProject).toBe(999);
      expect(limits.concurrentGenerationLimit).toBe(5);
      expect(limits.episodeLengthCapSeconds).toBe(3600);
      expect(limits.maxMotionLoraTrainingsPerMonth).toBe(20);
    });

    it("limits increase monotonically with tier level", () => {
      const tiers = ["free_trial", "creator", "creator_pro", "studio"];
      for (let i = 1; i < tiers.length; i++) {
        const prev = getGenerationLimits(tiers[i - 1]);
        const curr = getGenerationLimits(tiers[i]);
        expect(curr.maxPanelsPerChapter).toBeGreaterThanOrEqual(prev.maxPanelsPerChapter);
        expect(curr.maxAnimeEpisodesPerMonth).toBeGreaterThanOrEqual(prev.maxAnimeEpisodesPerMonth);
        expect(curr.concurrentGenerationLimit).toBeGreaterThanOrEqual(prev.concurrentGenerationLimit);
      }
    });
  });

  describe("canCreatePanel", () => {
    it("allows panel creation when under limit", () => {
      const result = canCreatePanel("free_trial", 10);
      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(20);
      expect(result.current).toBe(10);
    });

    it("blocks panel creation at limit", () => {
      const result = canCreatePanel("free_trial", 20);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Panel limit reached");
      expect(result.limit).toBe(20);
    });

    it("blocks panel creation above limit", () => {
      const result = canCreatePanel("creator", 30);
      expect(result.allowed).toBe(false);
    });

    it("studio has effectively unlimited panels (999)", () => {
      const result = canCreatePanel("studio", 500);
      expect(result.allowed).toBe(true);
    });
  });

  describe("canGenerateEpisode", () => {
    it("allows episode generation when under limit", () => {
      const result = canGenerateEpisode("creator", 3);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(2);
    });

    it("blocks episode generation at limit", () => {
      const result = canGenerateEpisode("free_trial", 1);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Monthly episode limit reached");
      expect(result.remaining).toBe(0);
    });

    it("creator_pro allows 15 episodes/month", () => {
      const result = canGenerateEpisode("creator_pro", 14);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(1);
    });

    it("correctly reports remaining count", () => {
      const result = canGenerateEpisode("creator", 2);
      expect(result.remaining).toBe(3); // 5 - 2 = 3
    });
  });

  describe("canCreateChapter", () => {
    it("allows chapter creation under limit", () => {
      const result = canCreateChapter("free_trial", 2);
      expect(result.allowed).toBe(true);
    });

    it("blocks chapter creation at limit", () => {
      const result = canCreateChapter("free_trial", 3);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Chapter limit reached");
    });

    it("creator allows 12 chapters per project", () => {
      const result = canCreateChapter("creator", 11);
      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(12);
    });
  });

  describe("canTrainLoraCharacter", () => {
    it("free_trial cannot train any LoRA characters", () => {
      const result = canTrainLoraCharacter("free_trial", 0);
      expect(result.allowed).toBe(false);
      expect(result.limit).toBe(0);
    });

    it("creator can train up to 3 LoRA characters", () => {
      const result = canTrainLoraCharacter("creator", 2);
      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(3);
    });

    it("blocks at limit", () => {
      const result = canTrainLoraCharacter("creator", 3);
      expect(result.allowed).toBe(false);
    });

    it("creator_pro allows 10 LoRA characters", () => {
      const result = canTrainLoraCharacter("creator_pro", 9);
      expect(result.allowed).toBe(true);
    });
  });

  describe("isEpisodeDurationAllowed", () => {
    it("free_trial allows up to 5 minutes (300s)", () => {
      expect(isEpisodeDurationAllowed("free_trial", 300).allowed).toBe(true);
      expect(isEpisodeDurationAllowed("free_trial", 301).allowed).toBe(false);
    });

    it("creator allows up to 15 minutes (900s)", () => {
      expect(isEpisodeDurationAllowed("creator", 900).allowed).toBe(true);
      expect(isEpisodeDurationAllowed("creator", 901).allowed).toBe(false);
    });

    it("studio allows up to 60 minutes (3600s)", () => {
      expect(isEpisodeDurationAllowed("studio", 3600).allowed).toBe(true);
      expect(isEpisodeDurationAllowed("studio", 3601).allowed).toBe(false);
    });

    it("provides informative error message with minutes", () => {
      const result = isEpisodeDurationAllowed("free_trial", 600);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("5 minutes");
      expect(result.reason).toContain("10 minutes");
    });
  });

  describe("canTrainMotionLora", () => {
    it("free_trial cannot train motion LoRA", () => {
      const result = canTrainMotionLora("free_trial", 0);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("not available");
    });

    it("creator cannot train motion LoRA", () => {
      const result = canTrainMotionLora("creator", 0);
      expect(result.allowed).toBe(false);
    });

    it("creator_pro can train up to 5 motion LoRAs/month", () => {
      expect(canTrainMotionLora("creator_pro", 4).allowed).toBe(true);
      expect(canTrainMotionLora("creator_pro", 5).allowed).toBe(false);
    });

    it("studio can train up to 20 motion LoRAs/month", () => {
      expect(canTrainMotionLora("studio", 19).allowed).toBe(true);
      expect(canTrainMotionLora("studio", 20).allowed).toBe(false);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3.4: PREMIUM COMPOSITION MODE GATING
// ═══════════════════════════════════════════════════════════════════════════

describe("3.4: Premium Composition Mode Gating", () => {
  describe("getMaxCompositionMode", () => {
    it("free_trial gets single mode only", () => {
      expect(getMaxCompositionMode("free_trial")).toBe("single");
    });

    it("creator gets dual mode (genre + character)", () => {
      expect(getMaxCompositionMode("creator")).toBe("dual");
    });

    it("creator_pro gets triple mode (genre + character + sakufuu)", () => {
      expect(getMaxCompositionMode("creator_pro")).toBe("triple");
    });

    it("studio gets triple mode", () => {
      expect(getMaxCompositionMode("studio")).toBe("triple");
    });

    it("enterprise gets triple mode", () => {
      expect(getMaxCompositionMode("enterprise")).toBe("triple");
    });
  });

  describe("getMaxAdapterCount", () => {
    it("free_trial: 1 adapter max", () => {
      expect(getMaxAdapterCount("free_trial")).toBe(1);
    });

    it("creator: 2 adapters max", () => {
      expect(getMaxAdapterCount("creator")).toBe(2);
    });

    it("creator_pro: 3 adapters max", () => {
      expect(getMaxAdapterCount("creator_pro")).toBe(3);
    });

    it("studio: 3 adapters max", () => {
      expect(getMaxAdapterCount("studio")).toBe(3);
    });
  });

  describe("isCompositionAllowed", () => {
    it("free_trial can use 1 adapter", () => {
      const result = isCompositionAllowed("free_trial", 1);
      expect(result.allowed).toBe(true);
      expect(result.mode).toBe("single");
    });

    it("free_trial cannot use 2 adapters", () => {
      const result = isCompositionAllowed("free_trial", 2);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Creator");
    });

    it("creator can use 2 adapters", () => {
      const result = isCompositionAllowed("creator", 2);
      expect(result.allowed).toBe(true);
    });

    it("creator cannot use 3 adapters", () => {
      const result = isCompositionAllowed("creator", 3);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Creator Pro");
    });

    it("creator_pro can use 3 adapters", () => {
      const result = isCompositionAllowed("creator_pro", 3);
      expect(result.allowed).toBe(true);
      expect(result.mode).toBe("triple");
    });

    it("studio can use 3 adapters", () => {
      const result = isCompositionAllowed("studio", 3);
      expect(result.allowed).toBe(true);
    });
  });

  describe("getAllowedLoraStackLayers", () => {
    it("free_trial has no LoRA layers", () => {
      expect(getAllowedLoraStackLayers("free_trial")).toEqual([]);
    });

    it("creator has appearance only", () => {
      expect(getAllowedLoraStackLayers("creator")).toEqual(["appearance"]);
    });

    it("creator_pro has appearance + motion", () => {
      expect(getAllowedLoraStackLayers("creator_pro")).toEqual(["appearance", "motion"]);
    });

    it("studio has all 4 layers", () => {
      expect(getAllowedLoraStackLayers("studio")).toEqual(
        ["appearance", "motion", "environment", "style"]
      );
    });

    it("returns a copy (not mutable reference)", () => {
      const layers = getAllowedLoraStackLayers("studio");
      layers.push("appearance");
      expect(getAllowedLoraStackLayers("studio")).toHaveLength(4);
    });
  });

  describe("isLoraLayerAllowed", () => {
    it("free_trial cannot use any layer", () => {
      expect(isLoraLayerAllowed("free_trial", "appearance")).toBe(false);
      expect(isLoraLayerAllowed("free_trial", "motion")).toBe(false);
    });

    it("creator can use appearance but not motion", () => {
      expect(isLoraLayerAllowed("creator", "appearance")).toBe(true);
      expect(isLoraLayerAllowed("creator", "motion")).toBe(false);
    });

    it("creator_pro can use appearance and motion but not environment", () => {
      expect(isLoraLayerAllowed("creator_pro", "appearance")).toBe(true);
      expect(isLoraLayerAllowed("creator_pro", "motion")).toBe(true);
      expect(isLoraLayerAllowed("creator_pro", "environment")).toBe(false);
    });

    it("studio can use all layers", () => {
      expect(isLoraLayerAllowed("studio", "appearance")).toBe(true);
      expect(isLoraLayerAllowed("studio", "motion")).toBe(true);
      expect(isLoraLayerAllowed("studio", "environment")).toBe(true);
      expect(isLoraLayerAllowed("studio", "style")).toBe(true);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AGGREGATE TIER STATUS & UPGRADE BENEFITS
// ═══════════════════════════════════════════════════════════════════════════

describe("Aggregate Tier Status", () => {
  describe("getPremiumTierStatus", () => {
    it("returns complete status for free_trial", () => {
      const status = getPremiumTierStatus("free_trial");
      expect(status.tier).toBe("free_trial");
      expect(status.tierLevel).toBe(0);
      expect(status.modelAccess.maxProviderTier).toBe("budget");
      expect(status.queue.priority).toBe(5);
      expect(status.queue.hasPriorityAccess).toBe(false);
      expect(status.queue.concurrentLimit).toBe(1);
      expect(status.composition.mode).toBe("single");
      expect(status.composition.maxAdapters).toBe(1);
      expect(status.features.canUploadManga).toBe(false);
      expect(status.features.motionLoraEnabled).toBe(false);
    });

    it("returns complete status for creator_pro", () => {
      const status = getPremiumTierStatus("creator_pro");
      expect(status.tier).toBe("creator_pro");
      expect(status.tierLevel).toBe(2);
      expect(status.modelAccess.maxProviderTier).toBe("premium");
      expect(status.modelAccess.allowedModelTiers).toContain("premium");
      expect(status.queue.priority).toBe(3);
      expect(status.queue.hasPriorityAccess).toBe(true);
      expect(status.queue.concurrentLimit).toBe(3);
      expect(status.composition.mode).toBe("triple");
      expect(status.composition.maxAdapters).toBe(3);
      expect(status.composition.allowedLoraLayers).toContain("motion");
      expect(status.features.canUploadManga).toBe(true);
      expect(status.features.motionLoraEnabled).toBe(true);
    });

    it("returns complete status for studio", () => {
      const status = getPremiumTierStatus("studio");
      expect(status.tier).toBe("studio");
      expect(status.tierLevel).toBe(3);
      expect(status.modelAccess.maxProviderTier).toBe("flagship");
      expect(status.queue.priority).toBe(1);
      expect(status.queue.concurrentLimit).toBe(5);
      expect(status.features.hasApiAccess).toBe(true);
      expect(status.features.hasPrioritySupport).toBe(true);
    });

    it("handles unknown tier via normalization", () => {
      const status = getPremiumTierStatus("unknown_tier");
      expect(status.tier).toBe("free_trial");
    });
  });

  describe("getUpgradeBenefits", () => {
    it("returns gains for free_trial → creator", () => {
      const result = getUpgradeBenefits("free_trial");
      expect(result).not.toBeNull();
      expect(result!.nextTier).toBe("creator");
      expect(result!.gains.length).toBeGreaterThan(0);
      expect(result!.gains.some(g => g.includes("standard"))).toBe(true);
    });

    it("returns gains for creator → creator_pro", () => {
      const result = getUpgradeBenefits("creator");
      expect(result).not.toBeNull();
      expect(result!.nextTier).toBe("creator_pro");
      expect(result!.gains.some(g => g.includes("premium"))).toBe(true);
      expect(result!.gains.some(g => g.includes("Priority queue"))).toBe(true);
      expect(result!.gains.some(g => g.includes("triple"))).toBe(true);
    });

    it("returns gains for creator_pro → studio", () => {
      const result = getUpgradeBenefits("creator_pro");
      expect(result).not.toBeNull();
      expect(result!.nextTier).toBe("studio");
      expect(result!.gains.some(g => g.includes("ultra"))).toBe(true);
    });

    it("returns null for enterprise (already at top)", () => {
      expect(getUpgradeBenefits("enterprise")).toBeNull();
    });

    it("includes composition mode upgrade in gains", () => {
      const result = getUpgradeBenefits("free_trial");
      expect(result!.gains.some(g => g.includes("dual") || g.includes("composition"))).toBe(true);
    });

    it("includes motion LoRA in gains when upgrading to creator_pro", () => {
      const result = getUpgradeBenefits("creator");
      expect(result!.gains.some(g => g.includes("Motion LoRA"))).toBe(true);
    });
  });
});
