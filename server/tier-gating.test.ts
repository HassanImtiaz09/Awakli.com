/**
 * Tier Gating Tests — shared/tierMatrix.ts + server/middleware/requireTier.ts
 */
import { describe, it, expect } from "vitest";
import {
  TIER_ORDER,
  TIER_META,
  CAPABILITY_KEYS,
  getMinTier,
  tierHasCapability,
  getTierCapabilities,
  getFullMatrix,
  buildUpgradePayload,
  stageToCapability,
  tierLevel,
  meetsMinTier,
} from "../shared/tierMatrix";

// ─── TierMatrix Unit Tests ──────────────────────────────────────────────────

describe("shared/tierMatrix", () => {
  describe("TIER_ORDER", () => {
    it("has exactly 5 tiers in ascending order", () => {
      expect(TIER_ORDER).toEqual([
        "free_trial",
        "creator",
        "creator_pro",
        "studio",
        "enterprise",
      ]);
    });
  });

  describe("TIER_META", () => {
    it("has metadata for every tier", () => {
      for (const tier of TIER_ORDER) {
        expect(TIER_META[tier]).toBeDefined();
        expect(TIER_META[tier].name).toBe(tier);
        expect(TIER_META[tier].displayName).toBeTruthy();
      }
    });

    it("free_trial has $0 price and no upgrade SKU", () => {
      expect(TIER_META.free_trial.monthlyPrice).toBe(0);
      expect(TIER_META.free_trial.upgradeSku).toBe("");
    });

    it("creator has display name Mangaka", () => {
      expect(TIER_META.creator.displayName).toBe("Mangaka");
    });

    it("creator_pro has display name Studio", () => {
      expect(TIER_META.creator_pro.displayName).toBe("Studio");
    });

    it("enterprise has null price (contact us)", () => {
      expect(TIER_META.enterprise.monthlyPrice).toBeNull();
    });
  });

  describe("tierLevel", () => {
    it("returns correct numeric levels", () => {
      expect(tierLevel("free_trial")).toBe(0);
      expect(tierLevel("creator")).toBe(1);
      expect(tierLevel("creator_pro")).toBe(2);
      expect(tierLevel("studio")).toBe(3);
      expect(tierLevel("enterprise")).toBe(4);
    });

    it("returns 0 for unknown tiers", () => {
      expect(tierLevel("nonexistent")).toBe(0);
    });
  });

  describe("meetsMinTier", () => {
    it("free_trial meets free_trial", () => {
      expect(meetsMinTier("free_trial", "free_trial")).toBe(true);
    });

    it("creator meets free_trial", () => {
      expect(meetsMinTier("creator", "free_trial")).toBe(true);
    });

    it("free_trial does NOT meet creator", () => {
      expect(meetsMinTier("free_trial", "creator")).toBe(false);
    });

    it("studio meets creator_pro", () => {
      expect(meetsMinTier("studio", "creator_pro")).toBe(true);
    });

    it("enterprise meets everything", () => {
      for (const tier of TIER_ORDER) {
        expect(meetsMinTier("enterprise", tier)).toBe(true);
      }
    });
  });

  describe("getMinTier", () => {
    it("stage_input requires free_trial", () => {
      expect(getMinTier("stage_input")).toBe("free_trial");
    });

    it("stage_anime_gate requires free_trial (X2: gate visible to all, upsells)", () => {
      expect(getMinTier("stage_anime_gate")).toBe("free_trial");
    });

    it("stage_video requires creator (X2 update)", () => {
      expect(getMinTier("stage_video")).toBe("creator");
    });

    it("stage_publish requires free_trial (X2: open to all)", () => {
      expect(getMinTier("stage_publish")).toBe("free_trial");
    });

    it("voice_cloning requires creator_pro", () => {
      expect(getMinTier("voice_cloning")).toBe("creator_pro");
    });

    it("api_access requires enterprise", () => {
      expect(getMinTier("api_access")).toBe("enterprise");
    });
  });

  describe("tierHasCapability", () => {
    it("free_trial can access stage_input", () => {
      expect(tierHasCapability("free_trial", "stage_input")).toBe(true);
    });

    it("free_trial can access stage_anime_gate (X2: gate visible to all)", () => {
      expect(tierHasCapability("free_trial", "stage_anime_gate")).toBe(true);
    });

    it("creator can access stage_anime_gate", () => {
      expect(tierHasCapability("creator", "stage_anime_gate")).toBe(true);
    });

    it("creator can access stage_video (X2 update)", () => {
      expect(tierHasCapability("creator", "stage_video")).toBe(true);
    });

    it("creator_pro can access stage_video", () => {
      expect(tierHasCapability("creator_pro", "stage_video")).toBe(true);
    });

    it("enterprise can access everything", () => {
      for (const cap of CAPABILITY_KEYS) {
        expect(tierHasCapability("enterprise", cap)).toBe(true);
      }
    });
  });

  describe("getTierCapabilities", () => {
    it("free_trial has a subset of capabilities", () => {
      const caps = getTierCapabilities("free_trial");
      expect(caps).toContain("stage_input");
      expect(caps).toContain("stage_script");
      expect(caps).toContain("stage_panels");
      expect(caps).toContain("community_voting");
      expect(caps).toContain("stage_anime_gate"); // X2: gate visible to all
      expect(caps).not.toContain("stage_setup"); // X2: now creator tier
      expect(caps).not.toContain("ai_video_generation");
    });

    it("enterprise has all capabilities", () => {
      const caps = getTierCapabilities("enterprise");
      expect(caps.length).toBe(CAPABILITY_KEYS.length);
    });

    it("higher tiers have more capabilities", () => {
      const freeCaps = getTierCapabilities("free_trial").length;
      const creatorCaps = getTierCapabilities("creator").length;
      const proCaps = getTierCapabilities("creator_pro").length;
      const studioCaps = getTierCapabilities("studio").length;
      const entCaps = getTierCapabilities("enterprise").length;

      expect(creatorCaps).toBeGreaterThanOrEqual(freeCaps);
      expect(proCaps).toBeGreaterThanOrEqual(creatorCaps);
      expect(studioCaps).toBeGreaterThanOrEqual(proCaps);
      expect(entCaps).toBeGreaterThanOrEqual(studioCaps);
    });
  });

  describe("getFullMatrix", () => {
    it("returns a record with all 5 tiers", () => {
      const matrix = getFullMatrix();
      expect(Object.keys(matrix)).toHaveLength(5);
      for (const tier of TIER_ORDER) {
        expect(matrix[tier]).toBeDefined();
        expect(Array.isArray(matrix[tier])).toBe(true);
      }
    });
  });

  describe("buildUpgradePayload", () => {
    it("returns correct payload for free_trial user denied stage_setup", () => {
      const payload = buildUpgradePayload("free_trial", "stage_setup");
      expect(payload.currentTier).toBe("free_trial");
      expect(payload.required).toBe("creator");
      expect(payload.requiredDisplayName).toBe("Mangaka");
      expect(payload.upgradeSku).toBeTruthy();
      expect(payload.ctaText).toContain("Mangaka");
      expect(payload.pricingUrl).toBe("/pricing");
    });

    it("returns correct payload for free_trial denied ai_video_generation", () => {
      const payload = buildUpgradePayload("free_trial", "ai_video_generation");
      expect(payload.currentTier).toBe("free_trial");
      expect(payload.required).toBe("creator_pro");
      expect(payload.requiredDisplayName).toBe("Studio");
    });

    it("returns correct payload for creator denied voice_cloning", () => {
      const payload = buildUpgradePayload("creator", "voice_cloning");
      expect(payload.currentTier).toBe("creator");
      expect(payload.required).toBe("creator_pro");
      expect(payload.requiredDisplayName).toBe("Studio");
    });
  });

  describe("stageToCapability", () => {
    it("maps stage indices 0-6 to capability keys (new pipeline order)", () => {
      expect(stageToCapability(0)).toBe("stage_input");
      expect(stageToCapability(1)).toBe("stage_script");
      expect(stageToCapability(2)).toBe("stage_panels");
      expect(stageToCapability(3)).toBe("stage_publish");
      expect(stageToCapability(4)).toBe("stage_anime_gate");
      expect(stageToCapability(5)).toBe("stage_setup");
      expect(stageToCapability(6)).toBe("stage_video");
    });

    it("returns null for out-of-range indices", () => {
      expect(stageToCapability(7)).toBeNull();
      expect(stageToCapability(-1)).toBeNull();
    });
  });
});

// ─── Server Middleware Tests ────────────────────────────────────────────────

describe("server/middleware/requireTier", () => {
  it("exports requireCapability function", async () => {
    const mod = await import("./middleware/requireTier");
    expect(typeof mod.requireCapability).toBe("function");
  });

  it("exports requireMinTier function", async () => {
    const mod = await import("./middleware/requireTier");
    expect(typeof mod.requireMinTier).toBe("function");
  });

  it("exports extractTierDeniedPayload function", async () => {
    const mod = await import("./middleware/requireTier");
    expect(typeof mod.extractTierDeniedPayload).toBe("function");
  });

  it("extractTierDeniedPayload returns null for non-TRPCError", async () => {
    const { extractTierDeniedPayload } = await import("./middleware/requireTier");
    expect(extractTierDeniedPayload(new Error("regular error"))).toBeNull();
    expect(extractTierDeniedPayload("string error")).toBeNull();
    expect(extractTierDeniedPayload(null)).toBeNull();
  });

  it("extractTierDeniedPayload returns payload for PAYMENT_REQUIRED TRPCError", async () => {
    const { extractTierDeniedPayload } = await import("./middleware/requireTier");
    const { TRPCError } = await import("@trpc/server");

    const error = new TRPCError({
      code: "FORBIDDEN",
      message: "Upgrade required",
      cause: {
        type: "PAYMENT_REQUIRED",
        currentTier: "free_trial",
        required: "creator",
        requiredDisplayName: "Mangaka",
        upgradeSku: "price_mangaka_monthly",
        ctaText: "Unlock with Mangaka — from $19/mo",
        pricingUrl: "/pricing",
      },
    });

    const payload = extractTierDeniedPayload(error);
    expect(payload).not.toBeNull();
    expect(payload!.cause).toBe("PAYMENT_REQUIRED");
    expect(payload!.currentTier).toBe("free_trial");
    expect(payload!.required).toBe("creator");
    expect(payload!.requiredDisplayName).toBe("Mangaka");
  });
});

// ─── Integration: Matrix Consistency ────────────────────────────────────────

describe("tier matrix consistency", () => {
  it("every capability has a valid min tier from TIER_ORDER", () => {
    for (const cap of CAPABILITY_KEYS) {
      const minTier = getMinTier(cap);
      expect(TIER_ORDER).toContain(minTier);
    }
  });

  it("stage capabilities follow expected tier progression", () => {
    // New order: Input(free) → Script(free) → Panels(free) → Publish(free) → Gate(free) → Setup(creator) → Video(creator)
    const stages = [0, 1, 2, 3, 4, 5, 6].map(i => {
      const cap = stageToCapability(i);
      return cap ? tierLevel(getMinTier(cap)) : 0;
    });
    // First 5 stages are free_trial (0), last 2 are creator (1)
    expect(stages.slice(0, 5).every(l => l === 0)).toBe(true);
    expect(stages.slice(5).every(l => l >= 1)).toBe(true);
  });

  it("TIER_META display names match the spec copy", () => {
    // Spec says: "Available on Mangaka" for lock tooltip
    expect(TIER_META.creator.displayName).toBe("Mangaka");
    // Spec says: "Unlock with Mangaka — from $19/mo" for soft deny CTA
    expect(TIER_META.creator.ctaText).toContain("Mangaka");
    expect(TIER_META.creator.ctaText).toContain("$19/mo");
    // Spec says: "This stage is part of the Studio tier" for hard deny
    expect(TIER_META.creator_pro.displayName).toBe("Studio");
  });
});
