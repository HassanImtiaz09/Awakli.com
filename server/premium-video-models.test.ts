/**
 * Wave 6B — Item 4: Premium Video Model Integration Tests
 *
 * Covers:
 * - 4.1: Comparative quality test matrix (scoring, recommendations)
 * - 4.2: Provider adapter registration + validation
 * - 4.3: Tier-based video routing
 * - 4.4: Silent-output enforcement (§5.1)
 * - 4.5: Cost tracking per provider
 */

import { describe, it, expect } from "vitest";
import {
  // 4.1: Quality Matrix
  PREMIUM_VIDEO_QUALITY_MATRIX,
  QUALITY_WEIGHTS,
  computeOverallScore,
  getRecommendedProvider,
  // 4.2: Adapter registration (tested via registry)
  // 4.3: Tier-based routing
  VIDEO_TIER_ROUTING,
  resolveVideoRouting,
  isVideoProviderAvailable,
  getDefaultVideoProvider,
  // 4.4: Silent-output enforcement
  resolveAudioMode,
  enforceSilentOutput,
  type AudioMode,
  type SilentOutputConfig,
  // 4.5: Cost tracking
  VIDEO_COST_RATES,
  estimateVideoCost,
  compareProviderCosts,
  type VideoCostEstimate,
} from "./provider-router/adapters/premium-video-models";
import type { VideoParams } from "./provider-router/types";

// ═══════════════════════════════════════════════════════════════════════════
// 4.1: COMPARATIVE QUALITY TEST MATRIX
// ═══════════════════════════════════════════════════════════════════════════

describe("4.1: Comparative Quality Test Matrix", () => {
  describe("PREMIUM_VIDEO_QUALITY_MATRIX", () => {
    it("contains exactly 4 providers (PixVerse, Seedance, Veo 3.1, Kling 3.0)", () => {
      expect(PREMIUM_VIDEO_QUALITY_MATRIX).toHaveLength(4);
      const ids = PREMIUM_VIDEO_QUALITY_MATRIX.map(m => m.providerId);
      expect(ids).toContain("pixverse_v45");
      expect(ids).toContain("seedance_20_fast");
      expect(ids).toContain("veo_31_lite");
      expect(ids).toContain("fal_kling_v3_pro");
    });

    it("all entries have computed overallScore > 0", () => {
      for (const entry of PREMIUM_VIDEO_QUALITY_MATRIX) {
        expect(entry.overallScore).toBeGreaterThan(0);
      }
    });

    it("all metric values are in valid range (0-100)", () => {
      for (const entry of PREMIUM_VIDEO_QUALITY_MATRIX) {
        expect(entry.visualFidelity).toBeGreaterThanOrEqual(0);
        expect(entry.visualFidelity).toBeLessThanOrEqual(100);
        expect(entry.motionCoherence).toBeGreaterThanOrEqual(0);
        expect(entry.motionCoherence).toBeLessThanOrEqual(100);
        expect(entry.animeStyleAdherence).toBeGreaterThanOrEqual(0);
        expect(entry.animeStyleAdherence).toBeLessThanOrEqual(100);
        expect(entry.characterConsistency).toBeGreaterThanOrEqual(0);
        expect(entry.characterConsistency).toBeLessThanOrEqual(100);
        expect(entry.promptAdherence).toBeGreaterThanOrEqual(0);
        expect(entry.promptAdherence).toBeLessThanOrEqual(100);
      }
    });

    it("PixVerse has highest anime style adherence", () => {
      const pixverse = PREMIUM_VIDEO_QUALITY_MATRIX.find(m => m.providerId === "pixverse_v45")!;
      for (const other of PREMIUM_VIDEO_QUALITY_MATRIX) {
        if (other.providerId !== "pixverse_v45") {
          expect(pixverse.animeStyleAdherence).toBeGreaterThanOrEqual(other.animeStyleAdherence);
        }
      }
    });

    it("Veo 3.1 has highest visual fidelity and motion coherence", () => {
      const veo = PREMIUM_VIDEO_QUALITY_MATRIX.find(m => m.providerId === "veo_31_lite")!;
      for (const other of PREMIUM_VIDEO_QUALITY_MATRIX) {
        if (other.providerId !== "veo_31_lite") {
          expect(veo.visualFidelity).toBeGreaterThanOrEqual(other.visualFidelity);
          expect(veo.motionCoherence).toBeGreaterThanOrEqual(other.motionCoherence);
        }
      }
    });

    it("only Veo 3.1 and Kling 3.0 support native audio", () => {
      const pixverse = PREMIUM_VIDEO_QUALITY_MATRIX.find(m => m.providerId === "pixverse_v45")!;
      const seedance = PREMIUM_VIDEO_QUALITY_MATRIX.find(m => m.providerId === "seedance_20_fast")!;
      const veo = PREMIUM_VIDEO_QUALITY_MATRIX.find(m => m.providerId === "veo_31_lite")!;
      const kling = PREMIUM_VIDEO_QUALITY_MATRIX.find(m => m.providerId === "fal_kling_v3_pro")!;

      expect(pixverse.nativeAudioQuality).toBeNull();
      expect(seedance.nativeAudioQuality).toBeNull();
      expect(veo.nativeAudioQuality).toBeGreaterThan(0);
      expect(kling.nativeAudioQuality).toBeGreaterThan(0);
    });

    it("Seedance is the fastest generator", () => {
      const seedance = PREMIUM_VIDEO_QUALITY_MATRIX.find(m => m.providerId === "seedance_20_fast")!;
      for (const other of PREMIUM_VIDEO_QUALITY_MATRIX) {
        if (other.providerId !== "seedance_20_fast") {
          expect(seedance.generationSpeedSec).toBeLessThanOrEqual(other.generationSpeedSec);
        }
      }
    });
  });

  describe("computeOverallScore", () => {
    it("produces score in valid range (0-100)", () => {
      for (const entry of PREMIUM_VIDEO_QUALITY_MATRIX) {
        const score = computeOverallScore(entry);
        expect(score).toBeGreaterThan(0);
        expect(score).toBeLessThanOrEqual(100);
      }
    });

    it("weights sum to 1.0", () => {
      const sum = Object.values(QUALITY_WEIGHTS).reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1.0, 5);
    });

    it("higher anime adherence increases score (given same other metrics)", () => {
      const base = {
        providerId: "test",
        modelName: "Test",
        visualFidelity: 80,
        motionCoherence: 80,
        animeStyleAdherence: 50,
        characterConsistency: 80,
        promptAdherence: 80,
        generationSpeedSec: 30,
        costPer5sClip: 0.30,
        nativeAudioQuality: null,
        lipSyncAccuracy: null,
        maxResolution: "1080p",
        maxDurationSec: 10,
        loraSupport: false,
        overallScore: 0,
      };

      const highAnime = { ...base, animeStyleAdherence: 95 };
      expect(computeOverallScore(highAnime)).toBeGreaterThan(computeOverallScore(base));
    });

    it("lower cost increases score (cost efficiency component)", () => {
      const expensive = {
        providerId: "test",
        modelName: "Test",
        visualFidelity: 80,
        motionCoherence: 80,
        animeStyleAdherence: 80,
        characterConsistency: 80,
        promptAdherence: 80,
        generationSpeedSec: 30,
        costPer5sClip: 0.90,
        nativeAudioQuality: null,
        lipSyncAccuracy: null,
        maxResolution: "1080p",
        maxDurationSec: 10,
        loraSupport: false,
        overallScore: 0,
      };

      const cheap = { ...expensive, costPer5sClip: 0.10 };
      expect(computeOverallScore(cheap)).toBeGreaterThan(computeOverallScore(expensive));
    });
  });

  describe("getRecommendedProvider", () => {
    it("returns provider matching all constraints", () => {
      const result = getRecommendedProvider({
        maxCostPer5s: 0.50,
        minAnimeScore: 75,
      });
      expect(result).not.toBeNull();
      expect(result!.costPer5sClip).toBeLessThanOrEqual(0.50);
      expect(result!.animeStyleAdherence).toBeGreaterThanOrEqual(75);
    });

    it("returns Veo when native audio is required", () => {
      const result = getRecommendedProvider({
        requiresNativeAudio: true,
        maxCostPer5s: 0.50,
      });
      expect(result).not.toBeNull();
      expect(result!.nativeAudioQuality).not.toBeNull();
    });

    it("returns null when no provider matches constraints", () => {
      const result = getRecommendedProvider({
        maxCostPer5s: 0.01, // Too cheap for any provider
      });
      expect(result).toBeNull();
    });

    it("returns fastest provider when speed constraint is tight", () => {
      const result = getRecommendedProvider({
        maxGenerationTimeSec: 30,
      });
      expect(result).not.toBeNull();
      expect(result!.providerId).toBe("seedance_20_fast"); // 25s
    });

    it("returns highest-scoring provider among candidates", () => {
      const result = getRecommendedProvider({});
      expect(result).not.toBeNull();
      // Should be the highest overall score
      const maxScore = Math.max(...PREMIUM_VIDEO_QUALITY_MATRIX.map(m => m.overallScore));
      expect(result!.overallScore).toBe(maxScore);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4.2: PROVIDER ADAPTER REGISTRATION
// ═══════════════════════════════════════════════════════════════════════════

describe("4.2: Provider Adapter Registration", () => {
  // Import registry to check adapter registration
  it("PixVerse V4.5 adapter is registered", async () => {
    // Import triggers side-effect registration
    const { hasAdapter } = await import("./provider-router/registry");
    expect(hasAdapter("pixverse_v45")).toBe(true);
  });

  it("Seedance 2.0 Fast adapter is registered", async () => {
    const { hasAdapter } = await import("./provider-router/registry");
    expect(hasAdapter("seedance_20_fast")).toBe(true);
  });

  it("Veo 3.1 Lite adapter is registered", async () => {
    const { hasAdapter } = await import("./provider-router/registry");
    expect(hasAdapter("veo_31_lite")).toBe(true);
  });

  it("PixVerse validates imageUrl requirement", async () => {
    const { getAdapter } = await import("./provider-router/registry");
    const adapter = getAdapter("pixverse_v45")!;
    const result = adapter.validateParams({ prompt: "test" } as VideoParams);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("image_url required for PixVerse V4.5");
  });

  it("PixVerse validates max duration (8s)", async () => {
    const { getAdapter } = await import("./provider-router/registry");
    const adapter = getAdapter("pixverse_v45")!;
    const result = adapter.validateParams({
      prompt: "test",
      imageUrl: "https://example.com/img.png",
      durationSeconds: 10,
    } as VideoParams);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("max 8s for PixVerse V4.5");
  });

  it("Seedance validates imageUrl requirement", async () => {
    const { getAdapter } = await import("./provider-router/registry");
    const adapter = getAdapter("seedance_20_fast")!;
    const result = adapter.validateParams({ prompt: "test" } as VideoParams);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("image_url required for Seedance 2.0 Fast");
  });

  it("Seedance validates max duration (10s)", async () => {
    const { getAdapter } = await import("./provider-router/registry");
    const adapter = getAdapter("seedance_20_fast")!;
    const result = adapter.validateParams({
      prompt: "test",
      imageUrl: "https://example.com/img.png",
      durationSeconds: 12,
    } as VideoParams);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("max 10s for Seedance 2.0 Fast");
  });

  it("Veo 3.1 validates max duration (8s)", async () => {
    const { getAdapter } = await import("./provider-router/registry");
    const adapter = getAdapter("veo_31_lite")!;
    const result = adapter.validateParams({
      prompt: "test",
      durationSeconds: 12,
    } as VideoParams);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("max 8s for Veo 3.1 Lite");
  });

  it("Veo 3.1 does not require imageUrl (supports text-to-video)", async () => {
    const { getAdapter } = await import("./provider-router/registry");
    const adapter = getAdapter("veo_31_lite")!;
    const result = adapter.validateParams({
      prompt: "A beautiful anime scene",
      durationSeconds: 5,
    } as VideoParams);
    expect(result.valid).toBe(true);
  });

  it("PixVerse cost estimation: $0.06/sec", async () => {
    const { getAdapter } = await import("./provider-router/registry");
    const adapter = getAdapter("pixverse_v45")!;
    expect(adapter.estimateCostUsd({ prompt: "test", durationSeconds: 5 } as VideoParams)).toBeCloseTo(0.30, 2);
    expect(adapter.estimateCostUsd({ prompt: "test", durationSeconds: 8 } as VideoParams)).toBeCloseTo(0.48, 2);
  });

  it("Seedance cost estimation: $0.05/sec", async () => {
    const { getAdapter } = await import("./provider-router/registry");
    const adapter = getAdapter("seedance_20_fast")!;
    expect(adapter.estimateCostUsd({ prompt: "test", durationSeconds: 5 } as VideoParams)).toBeCloseTo(0.25, 2);
    expect(adapter.estimateCostUsd({ prompt: "test", durationSeconds: 10 } as VideoParams)).toBeCloseTo(0.50, 2);
  });

  it("Veo 3.1 cost estimation: $0.05/sec (silent), $0.06/sec (dialogue)", async () => {
    const { getAdapter } = await import("./provider-router/registry");
    const adapter = getAdapter("veo_31_lite")!;
    // Silent
    expect(adapter.estimateCostUsd({ prompt: "test", durationSeconds: 5 } as VideoParams)).toBeCloseTo(0.25, 2);
    // Dialogue (generateAudio=true)
    expect(adapter.estimateCostUsd({ prompt: "test", durationSeconds: 5, generateAudio: true } as VideoParams)).toBeCloseTo(0.30, 2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4.3: TIER-BASED VIDEO ROUTING
// ═══════════════════════════════════════════════════════════════════════════

describe("4.3: Tier-Based Video Routing", () => {
  describe("VIDEO_TIER_ROUTING", () => {
    it("defines routing for all 5 tiers", () => {
      expect(VIDEO_TIER_ROUTING).toHaveProperty("free_trial");
      expect(VIDEO_TIER_ROUTING).toHaveProperty("creator");
      expect(VIDEO_TIER_ROUTING).toHaveProperty("creator_pro");
      expect(VIDEO_TIER_ROUTING).toHaveProperty("studio");
      expect(VIDEO_TIER_ROUTING).toHaveProperty("enterprise");
    });

    it("free_trial has only budget providers", () => {
      const routing = VIDEO_TIER_ROUTING.free_trial;
      expect(routing.maxProviderTier).toBe("budget");
      expect(routing.nativeAudioAvailable).toBe(false);
      expect(routing.availableProviders).not.toContain("pixverse_v45");
      expect(routing.availableProviders).not.toContain("veo_31_lite");
    });

    it("creator adds PixVerse and Seedance", () => {
      const routing = VIDEO_TIER_ROUTING.creator;
      expect(routing.availableProviders).toContain("pixverse_v45");
      expect(routing.availableProviders).toContain("seedance_20_fast");
      expect(routing.availableProviders).not.toContain("veo_31_lite");
      expect(routing.nativeAudioAvailable).toBe(false);
    });

    it("creator_pro adds Veo 3.1 and Kling Pro", () => {
      const routing = VIDEO_TIER_ROUTING.creator_pro;
      expect(routing.availableProviders).toContain("veo_31_lite");
      expect(routing.availableProviders).toContain("fal_kling_v3_pro");
      expect(routing.nativeAudioAvailable).toBe(true);
    });

    it("studio adds Kling Omni and Luma Ray3", () => {
      const routing = VIDEO_TIER_ROUTING.studio;
      expect(routing.availableProviders).toContain("fal_kling_v3_omni");
      expect(routing.availableProviders).toContain("luma_ray3");
    });

    it("enterprise includes all providers", () => {
      const routing = VIDEO_TIER_ROUTING.enterprise;
      expect(routing.availableProviders.length).toBeGreaterThanOrEqual(
        VIDEO_TIER_ROUTING.studio.availableProviders.length
      );
      expect(routing.availableProviders).toContain("runway_gen4");
    });

    it("provider count increases monotonically with tier", () => {
      const tiers = ["free_trial", "creator", "creator_pro", "studio", "enterprise"];
      for (let i = 1; i < tiers.length; i++) {
        const prev = VIDEO_TIER_ROUTING[tiers[i - 1]].availableProviders.length;
        const curr = VIDEO_TIER_ROUTING[tiers[i]].availableProviders.length;
        expect(curr).toBeGreaterThanOrEqual(prev);
      }
    });
  });

  describe("resolveVideoRouting", () => {
    it("returns correct routing for known tiers", () => {
      expect(resolveVideoRouting("creator_pro").maxProviderTier).toBe("premium");
    });

    it("defaults to free_trial for unknown tiers", () => {
      const routing = resolveVideoRouting("nonexistent");
      expect(routing.maxProviderTier).toBe("budget");
    });
  });

  describe("isVideoProviderAvailable", () => {
    it("PixVerse available for creator", () => {
      expect(isVideoProviderAvailable("creator", "pixverse_v45")).toBe(true);
    });

    it("PixVerse not available for free_trial", () => {
      expect(isVideoProviderAvailable("free_trial", "pixverse_v45")).toBe(false);
    });

    it("Veo 3.1 available for creator_pro", () => {
      expect(isVideoProviderAvailable("creator_pro", "veo_31_lite")).toBe(true);
    });

    it("Veo 3.1 not available for creator", () => {
      expect(isVideoProviderAvailable("creator", "veo_31_lite")).toBe(false);
    });

    it("Kling Omni only available for studio+", () => {
      expect(isVideoProviderAvailable("creator_pro", "fal_kling_v3_omni")).toBe(false);
      expect(isVideoProviderAvailable("studio", "fal_kling_v3_omni")).toBe(true);
    });
  });

  describe("getDefaultVideoProvider", () => {
    it("free_trial defaults to wan_21 for both scene types", () => {
      expect(getDefaultVideoProvider("free_trial", false)).toBe("wan_21");
      expect(getDefaultVideoProvider("free_trial", true)).toBe("wan_21");
    });

    it("creator defaults to pixverse_v45 for silent scenes", () => {
      expect(getDefaultVideoProvider("creator", false)).toBe("pixverse_v45");
    });

    it("creator_pro defaults to veo_31_lite for dialogue scenes", () => {
      expect(getDefaultVideoProvider("creator_pro", true)).toBe("veo_31_lite");
    });

    it("studio defaults to fal_kling_v3_omni for dialogue scenes", () => {
      expect(getDefaultVideoProvider("studio", true)).toBe("fal_kling_v3_omni");
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4.4: SILENT-OUTPUT ENFORCEMENT (§5.1)
// ═══════════════════════════════════════════════════════════════════════════

describe("4.4: Silent-Output Enforcement (§5.1)", () => {
  describe("resolveAudioMode", () => {
    it("returns silent for providers without native audio", () => {
      const params: VideoParams = { prompt: "test", generateAudio: true };
      const config = resolveAudioMode(params, false);
      expect(config.audioMode).toBe("silent");
      expect(config.supportsNativeAudio).toBe(false);
    });

    it("returns silent by default even for audio-capable providers", () => {
      const params: VideoParams = { prompt: "test" };
      const config = resolveAudioMode(params, true);
      expect(config.audioMode).toBe("silent");
      expect(config.supportsNativeAudio).toBe(true);
    });

    it("suppresses audio when generateAudio=true but not dialogue scene", () => {
      const params: VideoParams = { prompt: "test", generateAudio: true };
      const config = resolveAudioMode(params, true, false);
      expect(config.audioMode).toBe("silent");
      expect(config.suppressionReason).toContain("§5.1");
    });

    it("allows native audio only for explicit dialogue scenes", () => {
      const params: VideoParams = { prompt: "test", generateAudio: true };
      const config = resolveAudioMode(params, true, true);
      expect(config.audioMode).toBe("dialogue_native");
      expect(config.suppressionReason).toBeUndefined();
    });

    it("does not enable audio for dialogue scene if generateAudio is false", () => {
      const params: VideoParams = { prompt: "test", generateAudio: false };
      const config = resolveAudioMode(params, true, true);
      expect(config.audioMode).toBe("silent");
    });

    it("does not enable audio for dialogue scene if generateAudio is undefined", () => {
      const params: VideoParams = { prompt: "test" };
      const config = resolveAudioMode(params, true, true);
      expect(config.audioMode).toBe("silent");
    });
  });

  describe("enforceSilentOutput", () => {
    it("strips generateAudio in silent mode", () => {
      const params: VideoParams = { prompt: "test", generateAudio: true };
      const config: SilentOutputConfig = { supportsNativeAudio: true, audioMode: "silent" };
      const cleaned = enforceSilentOutput(params, config);
      expect(cleaned.generateAudio).toBe(false);
    });

    it("strips audioUrl in silent mode", () => {
      const params: VideoParams = { prompt: "test", audioUrl: "https://audio.mp3" };
      const config: SilentOutputConfig = { supportsNativeAudio: true, audioMode: "silent" };
      const cleaned = enforceSilentOutput(params, config);
      expect(cleaned.audioUrl).toBeUndefined();
    });

    it("preserves all params in dialogue_native mode", () => {
      const params: VideoParams = { prompt: "test", generateAudio: true, audioUrl: "https://audio.mp3" };
      const config: SilentOutputConfig = { supportsNativeAudio: true, audioMode: "dialogue_native" };
      const cleaned = enforceSilentOutput(params, config);
      expect(cleaned.generateAudio).toBe(true);
      expect(cleaned.audioUrl).toBe("https://audio.mp3");
    });

    it("does not mutate original params", () => {
      const params: VideoParams = { prompt: "test", generateAudio: true };
      const config: SilentOutputConfig = { supportsNativeAudio: true, audioMode: "silent" };
      enforceSilentOutput(params, config);
      expect(params.generateAudio).toBe(true); // Original unchanged
    });

    it("preserves non-audio params in silent mode", () => {
      const params: VideoParams = {
        prompt: "anime scene",
        imageUrl: "https://img.png",
        durationSeconds: 5,
        aspectRatio: "16:9",
        seed: 42,
        generateAudio: true,
      };
      const config: SilentOutputConfig = { supportsNativeAudio: true, audioMode: "silent" };
      const cleaned = enforceSilentOutput(params, config);
      expect(cleaned.prompt).toBe("anime scene");
      expect(cleaned.imageUrl).toBe("https://img.png");
      expect(cleaned.durationSeconds).toBe(5);
      expect(cleaned.aspectRatio).toBe("16:9");
      expect(cleaned.seed).toBe(42);
      expect(cleaned.generateAudio).toBe(false);
    });
  });

  describe("§5.1 integration with adapters", () => {
    it("PixVerse always produces silent output (no native audio support)", () => {
      const params: VideoParams = { prompt: "test", generateAudio: true };
      const config = resolveAudioMode(params, false); // PixVerse has no audio
      expect(config.audioMode).toBe("silent");
    });

    it("Seedance always produces silent output (no native audio support)", () => {
      const params: VideoParams = { prompt: "test", generateAudio: true };
      const config = resolveAudioMode(params, false); // Seedance has no audio
      expect(config.audioMode).toBe("silent");
    });

    it("Veo 3.1 produces silent output by default", () => {
      const params: VideoParams = { prompt: "test" };
      const config = resolveAudioMode(params, true); // Veo supports audio
      expect(config.audioMode).toBe("silent");
    });

    it("Veo 3.1 enables audio only for explicit dialogue scenes", () => {
      const params: VideoParams = { prompt: "character speaking", generateAudio: true };
      const config = resolveAudioMode(params, true, true);
      expect(config.audioMode).toBe("dialogue_native");
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4.5: COST TRACKING
// ═══════════════════════════════════════════════════════════════════════════

describe("4.5: Cost Tracking", () => {
  describe("VIDEO_COST_RATES", () => {
    it("contains rates for all premium providers", () => {
      expect(VIDEO_COST_RATES).toHaveProperty("pixverse_v45");
      expect(VIDEO_COST_RATES).toHaveProperty("seedance_20_fast");
      expect(VIDEO_COST_RATES).toHaveProperty("veo_31_lite");
      expect(VIDEO_COST_RATES).toHaveProperty("fal_kling_v3_pro");
    });

    it("all rates have positive perSecond values", () => {
      for (const [id, rates] of Object.entries(VIDEO_COST_RATES)) {
        expect(rates.perSecond).toBeGreaterThan(0);
        expect(rates.minClipCost).toBeGreaterThan(0);
      }
    });

    it("only Veo 3.1 has audio surcharge", () => {
      expect(VIDEO_COST_RATES.pixverse_v45.audioSurchargePercent).toBe(0);
      expect(VIDEO_COST_RATES.seedance_20_fast.audioSurchargePercent).toBe(0);
      expect(VIDEO_COST_RATES.veo_31_lite.audioSurchargePercent).toBe(20);
      expect(VIDEO_COST_RATES.fal_kling_v3_pro.audioSurchargePercent).toBe(0);
    });
  });

  describe("estimateVideoCost", () => {
    it("calculates PixVerse cost correctly", () => {
      const estimate = estimateVideoCost("pixverse_v45", 5);
      expect(estimate.estimatedCostUsd).toBeCloseTo(0.30, 2);
      expect(estimate.costPerSecond).toBe(0.06);
      expect(estimate.hasAudioSurcharge).toBe(false);
    });

    it("calculates Seedance cost correctly", () => {
      const estimate = estimateVideoCost("seedance_20_fast", 10);
      expect(estimate.estimatedCostUsd).toBeCloseTo(0.50, 2);
    });

    it("applies minimum clip cost", () => {
      // 1 second at $0.06/sec = $0.06, but min is $0.20
      const estimate = estimateVideoCost("pixverse_v45", 1);
      expect(estimate.estimatedCostUsd).toBe(0.20);
    });

    it("applies Veo 3.1 audio surcharge (20%)", () => {
      const silent = estimateVideoCost("veo_31_lite", 5, false);
      const withAudio = estimateVideoCost("veo_31_lite", 5, true);
      expect(withAudio.estimatedCostUsd).toBeGreaterThan(silent.estimatedCostUsd);
      expect(withAudio.hasAudioSurcharge).toBe(true);
      expect(withAudio.audioSurchargePercent).toBe(20);
      // $0.25 * 1.20 = $0.30
      expect(withAudio.estimatedCostUsd).toBeCloseTo(0.30, 2);
    });

    it("returns zero for unknown provider", () => {
      const estimate = estimateVideoCost("nonexistent", 5);
      expect(estimate.estimatedCostUsd).toBe(0);
      expect(estimate.costPerSecond).toBe(0);
    });

    it("Kling Pro is most expensive per second", () => {
      const pixverse = estimateVideoCost("pixverse_v45", 5);
      const seedance = estimateVideoCost("seedance_20_fast", 5);
      const veo = estimateVideoCost("veo_31_lite", 5);
      const kling = estimateVideoCost("fal_kling_v3_pro", 5);

      expect(kling.costPerSecond).toBeGreaterThan(pixverse.costPerSecond);
      expect(kling.costPerSecond).toBeGreaterThan(seedance.costPerSecond);
      expect(kling.costPerSecond).toBeGreaterThan(veo.costPerSecond);
    });
  });

  describe("compareProviderCosts", () => {
    it("returns sorted costs for free_trial (cheapest first)", () => {
      const costs = compareProviderCosts("free_trial", 5);
      expect(costs.length).toBeGreaterThan(0);
      for (let i = 1; i < costs.length; i++) {
        expect(costs[i].estimatedCostUsd).toBeGreaterThanOrEqual(costs[i - 1].estimatedCostUsd);
      }
    });

    it("creator has more providers than free_trial", () => {
      const freeCosts = compareProviderCosts("free_trial", 5);
      const creatorCosts = compareProviderCosts("creator", 5);
      expect(creatorCosts.length).toBeGreaterThan(freeCosts.length);
    });

    it("creator_pro includes Veo 3.1 in comparison", () => {
      const costs = compareProviderCosts("creator_pro", 5);
      expect(costs.some(c => c.providerId === "veo_31_lite")).toBe(true);
    });

    it("applies audio surcharge when requested", () => {
      const silentCosts = compareProviderCosts("creator_pro", 5, false);
      const audioCosts = compareProviderCosts("creator_pro", 5, true);
      const veoSilent = silentCosts.find(c => c.providerId === "veo_31_lite");
      const veoAudio = audioCosts.find(c => c.providerId === "veo_31_lite");
      expect(veoAudio!.estimatedCostUsd).toBeGreaterThan(veoSilent!.estimatedCostUsd);
    });

    it("all estimates have positive cost", () => {
      const costs = compareProviderCosts("studio", 5);
      for (const cost of costs) {
        expect(cost.estimatedCostUsd).toBeGreaterThan(0);
      }
    });
  });
});
