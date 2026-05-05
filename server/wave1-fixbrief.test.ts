/**
 * Wave 1 (X1-X4) Fix Brief tests
 * - X1: Pipeline order
 * - X2: Tier gating
 * - X3: Pricing catalog consolidation
 * - X4: Credit cost table
 */
import { describe, it, expect } from "vitest";

// X1: Pipeline order
import { STAGES } from "../client/src/layouts/CreateWizardLayout";

describe("X1: Pipeline order", () => {
  it("has 8 stages in the correct order (Storyboard added)", () => {
    expect(STAGES.length).toBe(8);
    expect(STAGES.map((s) => s.path)).toEqual([
      "input",
      "script",
      "panels",
      "storyboard",
      "publish",
      "anime-gate",
      "setup",
      "video",
    ]);
  });

  it("manga path is stages 0-4 (Input→Script→Panels→Storyboard→Publish)", () => {
    const mangaStages = STAGES.slice(0, 5).map((s) => s.label);
    expect(mangaStages).toEqual(["Input", "Script", "Panels", "Storyboard", "Publish"]);
  });

  it("anime path is stages 5-7 (Gate→Setup→Video)", () => {
    const animeStages = STAGES.slice(5).map((s) => s.label);
    expect(animeStages).toEqual(["Gate", "Setup", "Video"]);
  });
});

// X2: Tier gating
import {
  stageToCapability,
  getMinTier,
  tierHasCapability,
} from "../shared/tierMatrix";

describe("X2: Tier gating", () => {
  it("Publish (stage 3) is open to all tiers including free_trial", () => {
    const cap = stageToCapability(3);
    expect(cap).toBe("stage_publish");
    expect(getMinTier("stage_publish")).toBe("free_trial");
    expect(tierHasCapability("free_trial", "stage_publish")).toBe(true);
  });

  it("Video (stage 6) requires Mangaka (creator) tier", () => {
    const cap = stageToCapability(6);
    expect(cap).toBe("stage_video");
    expect(getMinTier("stage_video")).toBe("creator");
    expect(tierHasCapability("free_trial", "stage_video")).toBe(false);
    expect(tierHasCapability("creator", "stage_video")).toBe(true);
  });

  it("Setup (stage 5) requires Mangaka (creator) tier", () => {
    const cap = stageToCapability(5);
    expect(cap).toBe("stage_setup");
    expect(getMinTier("stage_setup")).toBe("creator");
  });

  it("Anime gate (stage 4) is visible to all tiers", () => {
    const cap = stageToCapability(4);
    expect(cap).toBe("stage_anime_gate");
    expect(getMinTier("stage_anime_gate")).toBe("free_trial");
  });

  it("stageToCapability maps all 7 stages correctly", () => {
    const expected = [
      "stage_input",
      "stage_script",
      "stage_panels",
      "stage_publish",
      "stage_anime_gate",
      "stage_setup",
      "stage_video",
    ];
    for (let i = 0; i < 7; i++) {
      expect(stageToCapability(i)).toBe(expected[i]);
    }
  });
});

// X3: Pricing catalog
import {
  TIER_DISPLAY_NAMES,
  TIER_MONTHLY_PRICE_CENTS,
  tierDisplayName,
  formatPrice,
  tierPriceLabel,
  CREDIT_PACKS,
} from "../shared/pricingCatalog";

describe("X3: Pricing catalog", () => {
  it("has canonical display names", () => {
    expect(TIER_DISPLAY_NAMES.free_trial).toBe("Apprentice");
    expect(TIER_DISPLAY_NAMES.creator).toBe("Mangaka");
    expect(TIER_DISPLAY_NAMES.creator_pro).toBe("Studio");
    expect(TIER_DISPLAY_NAMES.studio).toBe("Studio Pro");
    expect(TIER_DISPLAY_NAMES.enterprise).toBe("Enterprise");
  });

  it("has correct monthly prices", () => {
    expect(TIER_MONTHLY_PRICE_CENTS.free_trial).toBe(0);
    expect(TIER_MONTHLY_PRICE_CENTS.creator).toBe(1900);
    expect(TIER_MONTHLY_PRICE_CENTS.creator_pro).toBe(4900);
    expect(TIER_MONTHLY_PRICE_CENTS.studio).toBe(14900);
  });

  it("tierDisplayName falls back gracefully", () => {
    expect(tierDisplayName("creator")).toBe("Mangaka");
    expect(tierDisplayName("unknown_tier")).toBe("Unknown Tier");
  });

  it("formatPrice formats correctly", () => {
    expect(formatPrice(0)).toBe("Free");
    expect(formatPrice(1900)).toBe("$19");
    expect(formatPrice(4900)).toBe("$49");
    expect(formatPrice(14900)).toBe("$149");
    expect(formatPrice(1550)).toBe("$15.50");
  });

  it("tierPriceLabel returns correct labels", () => {
    expect(tierPriceLabel("free_trial")).toBe("Free");
    expect(tierPriceLabel("creator")).toBe("$19/mo");
    expect(tierPriceLabel("creator_pro")).toBe("$49/mo");
    expect(tierPriceLabel("enterprise")).toBe("Custom");
  });

  it("has 5 credit packs in ascending order", () => {
    expect(CREDIT_PACKS.length).toBe(5);
    expect(CREDIT_PACKS.map((p) => p.key)).toEqual([
      "spark", "flame", "blaze", "inferno", "supernova",
    ]);
    // Credits increase
    for (let i = 1; i < CREDIT_PACKS.length; i++) {
      expect(CREDIT_PACKS[i].credits).toBeGreaterThan(CREDIT_PACKS[i - 1].credits);
    }
    // Per-credit cost decreases (volume discount)
    for (let i = 1; i < CREDIT_PACKS.length; i++) {
      expect(CREDIT_PACKS[i].perCreditCents).toBeLessThan(CREDIT_PACKS[i - 1].perCreditCents);
    }
  });
});

// X4: Credit cost table
import {
  UNIT_COSTS,
  forecastCredits,
  quickEstimate,
} from "../shared/creditCostTable";

describe("X4: Credit cost table", () => {
  it("has expected unit costs", () => {
    expect(UNIT_COSTS.panel_gen).toBe(6);
    expect(UNIT_COSTS.panel_regen).toBe(3);
    expect(UNIT_COSTS.scene_regen).toBe(3);
    expect(UNIT_COSTS.lora_appearance).toBe(120);
    expect(UNIT_COSTS.voice_clone).toBe(80);
    expect(UNIT_COSTS.video_motion).toBe(12);
  });

  it("20-panel Apprentice project forecasts 120-180 credits", () => {
    const result = forecastCredits({ panelCount: 20 });
    // Script: 2c + Panels: 20×6=120c + Regens: 3×3=9c + SceneRegens: ~1×3=3c = ~134c
    expect(result.total).toBeGreaterThanOrEqual(120);
    expect(result.total).toBeLessThanOrEqual(180);
  });

  it("forecastCredits returns per-stage breakdown", () => {
    const result = forecastCredits({ panelCount: 10 });
    expect(result.stages.input).toBe(0);
    expect(result.stages.script).toBeGreaterThan(0);
    expect(result.stages.panels).toBeGreaterThan(0);
    expect(result.stages.publish).toBe(0);
    expect(result.stages.gate).toBe(0);
    // No anime path inputs → setup and video should be 0
    expect(result.stages.setup).toBe(0);
    expect(result.stages.video).toBe(0);
  });

  it("forecastCredits includes anime costs when specified", () => {
    const result = forecastCredits({
      panelCount: 20,
      videoDurationSec: 60,
      voiceLineCount: 10,
      hasLoRA: true,
      hasVoiceClone: true,
      hasMusicGen: true,
    });
    expect(result.stages.setup).toBeGreaterThan(0);
    expect(result.stages.video).toBeGreaterThan(0);
    // LoRA + voice clone in setup
    expect(result.stages.setup).toBeGreaterThanOrEqual(UNIT_COSTS.lora_appearance + UNIT_COSTS.voice_clone);
  });

  it("quickEstimate returns [min, max] range", () => {
    const [min, max] = quickEstimate(20, false);
    expect(min).toBeLessThan(max);
    expect(min).toBeGreaterThan(0);

    const [minAnime, maxAnime] = quickEstimate(20, true);
    expect(minAnime).toBeGreaterThan(min);
    expect(maxAnime).toBeGreaterThan(max);
  });

  it("lineItems sum matches total", () => {
    const result = forecastCredits({
      panelCount: 15,
      hasLoRA: true,
      videoDurationSec: 45,
      voiceLineCount: 5,
      hasMusicGen: true,
    });
    const lineItemSum = result.lineItems.reduce((sum, item) => sum + item.subtotal, 0);
    expect(lineItemSum).toBe(result.total);
  });
});
