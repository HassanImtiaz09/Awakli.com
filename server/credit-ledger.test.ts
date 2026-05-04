import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import {
  TIERS, CREDIT_PACKS, CREDIT_COSTS, CREDIT_ECONOMICS,
  getTierFeatureList, normalizeTier, TIER_ORDER, isUpgrade, isDowngrade,
  type TierKey,
} from "./stripe/products";
import {
  getCreditCost, getAllCreditCosts,
  type GenerationAction,
} from "./credit-gateway";

// ─── Helper: create mock tRPC context ──────────────────────────────────────
type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(overrides?: Partial<AuthenticatedUser>): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-user-001",
    email: "test@awakli.com",
    name: "Test Creator",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
    ...overrides,
  };
  return {
    user,
    req: { protocol: "https", headers: { origin: "https://test.awakli.com" } } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

function createAdminContext(): TrpcContext {
  return createAuthContext({ id: 99, role: "admin", name: "Admin User" });
}

function createPublicContext(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: { origin: "https://test.awakli.com" } } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

const caller = appRouter.createCaller;

// ═══════════════════════════════════════════════════════════════════════════
// 1. TIER CONFIGURATION & PRODUCTS
// ═══════════════════════════════════════════════════════════════════════════

describe("Tier Configuration (products.ts)", () => {
  it("defines exactly 5 tiers", () => {
    const tierKeys = Object.keys(TIERS);
    expect(tierKeys).toHaveLength(5);
    expect(tierKeys).toEqual(["free_trial", "creator", "creator_pro", "studio", "enterprise"]);
  });

  it("free_trial has 15 credits and $0 pricing", () => {
    const ft = TIERS.free_trial;
    expect(ft.credits).toBe(15);
    expect(ft.monthlyPrice).toBe(0);
    expect(ft.annualPrice).toBe(0);
    expect(ft.episodeLengthCapSeconds).toBe(300);
    expect(ft.allowedModelTiers).toEqual(["budget"]);
    expect(ft.rolloverPercentage).toBe(0);
    expect(ft.packDiscount).toBe(0);
  });

  it("creator has 35 credits at $19/mo", () => {
    const c = TIERS.creator;
    expect(c.credits).toBe(35);
    expect(c.monthlyPrice).toBe(1900);
    expect(c.episodeLengthCapSeconds).toBe(900);
    expect(c.allowedModelTiers).toContain("standard");
    expect(c.rolloverPercentage).toBe(0);
    expect(c.packDiscount).toBe(0);
  });

  it("creator_pro has 120 credits at $49/mo", () => {
    const cp = TIERS.creator_pro;
    expect(cp.credits).toBe(120);
    expect(cp.monthlyPrice).toBe(4900);
    expect(cp.episodeLengthCapSeconds).toBe(1800);
    expect(cp.allowedModelTiers).toContain("premium");
    expect(cp.rolloverPercentage).toBe(0.20);
    expect(cp.packDiscount).toBe(0.10);
  });

  it("studio has 600 credits at $149/mo", () => {
    const s = TIERS.studio;
    expect(s.credits).toBe(600);
    expect(s.monthlyPrice).toBe(14900);
    expect(s.episodeLengthCapSeconds).toBe(3600);
    expect(s.allowedModelTiers).toContain("ultra");
    expect(s.rolloverPercentage).toBe(0.50);
    expect(s.packDiscount).toBe(0.20);
    expect(s.queuePriority).toBe(1);
  });

  it("enterprise has custom pricing and 100% rollover", () => {
    const e = TIERS.enterprise;
    expect(e.monthlyPrice).toBe(0); // custom
    expect(e.episodeLengthCapSeconds).toBe(7200);
    expect(e.allowedModelTiers).toContain("ultra");
    expect(e.rolloverPercentage).toBe(1.0);
    expect(e.rolloverCap).toBeNull();
    expect(e.packDiscount).toBe(0.30);
    expect(e.queuePriority).toBe(1);
  });

  it("all tiers have required fields", () => {
    for (const [key, tier] of Object.entries(TIERS)) {
      expect(tier.name).toBeTruthy();
      expect(tier.credits).toBeGreaterThanOrEqual(0);
      expect(tier.monthlyPrice).toBeGreaterThanOrEqual(0);
      expect(typeof tier.episodeLengthCapSeconds).toBe("number");
      expect(Array.isArray(tier.allowedModelTiers)).toBe(true);
      expect(tier.rolloverPercentage).toBeGreaterThanOrEqual(0);
      expect(tier.rolloverPercentage).toBeLessThanOrEqual(1);
      expect(tier.packDiscount).toBeGreaterThanOrEqual(0);
      expect(tier.packDiscount).toBeLessThanOrEqual(1);
    }
  });

  it("annual pricing is always less than 12x monthly for paid tiers", () => {
    for (const [key, tier] of Object.entries(TIERS)) {
      if (tier.monthlyPrice > 0 && tier.annualPrice > 0) {
        expect(tier.annualPrice).toBeLessThan(tier.monthlyPrice * 12);
      }
    }
  });
});

describe("Credit Packs", () => {
  it("defines 3 pack sizes", () => {
    const packKeys = Object.keys(CREDIT_PACKS);
    expect(packKeys).toHaveLength(3);
    expect(packKeys).toEqual(["small", "medium", "large"]);
  });

  it("small pack: 50 credits at $35", () => {
    const s = CREDIT_PACKS.small;
    expect(s.credits).toBe(50);
    expect(s.basePriceCents).toBe(3500);
  });

  it("medium pack: 150 credits at $95", () => {
    const m = CREDIT_PACKS.medium;
    expect(m.credits).toBe(150);
    expect(m.basePriceCents).toBe(9500);
  });

  it("large pack: 500 credits at $275", () => {
    const l = CREDIT_PACKS.large;
    expect(l.credits).toBe(500);
    expect(l.basePriceCents).toBe(27500);
  });

  it("larger packs have better per-credit pricing", () => {
    const perCredit = Object.values(CREDIT_PACKS).map(p => p.basePriceCents / p.credits);
    for (let i = 1; i < perCredit.length; i++) {
      expect(perCredit[i]).toBeLessThan(perCredit[i - 1]);
    }
  });
});

describe("Credit Economics", () => {
  it("defines COGS value at $0.55 per credit", () => {
    expect(CREDIT_ECONOMICS.COGS_VALUE_USD).toBe(0.55);
  });

  it("target margin is 33%", () => {
    expect(CREDIT_ECONOMICS.MARGIN_TARGET).toBe(0.33);
  });

  it("subscription rate per credit at $0.82", () => {
    expect(CREDIT_ECONOMICS.SUBSCRIPTION_RATE_USD).toBe(0.82);
  });

  it("pack rates decrease with size", () => {
    expect(CREDIT_ECONOMICS.PACK_RATE_SMALL_USD).toBeGreaterThan(CREDIT_ECONOMICS.PACK_RATE_MEDIUM_USD);
    expect(CREDIT_ECONOMICS.PACK_RATE_MEDIUM_USD).toBeGreaterThan(CREDIT_ECONOMICS.PACK_RATE_LARGE_USD);
  });
});

describe("Tier Utilities", () => {
  it("normalizeTier maps legacy names", () => {
    expect(normalizeTier("free")).toBe("free_trial");
    expect(normalizeTier("pro")).toBe("creator");
    expect(normalizeTier("creator")).toBe("creator");
    expect(normalizeTier("studio")).toBe("studio");
    expect(normalizeTier("unknown")).toBe("free_trial");
  });

  it("isUpgrade correctly identifies upgrades", () => {
    expect(isUpgrade("free_trial", "creator")).toBe(true);
    expect(isUpgrade("creator", "creator_pro")).toBe(true);
    expect(isUpgrade("creator_pro", "studio")).toBe(true);
    expect(isUpgrade("studio", "enterprise")).toBe(true);
  });

  it("isUpgrade returns false for same or lower tier", () => {
    expect(isUpgrade("creator", "creator")).toBe(false);
    expect(isUpgrade("studio", "creator")).toBe(false);
    expect(isUpgrade("enterprise", "free_trial")).toBe(false);
  });

  it("isDowngrade correctly identifies downgrades", () => {
    expect(isDowngrade("creator", "free_trial")).toBe(true);
    expect(isDowngrade("studio", "creator_pro")).toBe(true);
    expect(isDowngrade("enterprise", "studio")).toBe(true);
  });

  it("isDowngrade returns false for same or higher tier", () => {
    expect(isDowngrade("creator", "creator")).toBe(false);
    expect(isDowngrade("creator", "studio")).toBe(false);
  });

  it("TIER_ORDER has correct ascending order", () => {
    expect(TIER_ORDER.free_trial).toBeLessThan(TIER_ORDER.creator);
    expect(TIER_ORDER.creator).toBeLessThan(TIER_ORDER.creator_pro);
    expect(TIER_ORDER.creator_pro).toBeLessThan(TIER_ORDER.studio);
    expect(TIER_ORDER.studio).toBeLessThan(TIER_ORDER.enterprise);
  });

  it("getTierFeatureList returns non-empty arrays for all tiers", () => {
    for (const tier of Object.keys(TIERS) as TierKey[]) {
      const features = getTierFeatureList(tier);
      expect(features.length).toBeGreaterThan(0);
      features.forEach(f => expect(typeof f).toBe("string"));
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. CREDIT GATEWAY (Pure Functions)
// ═══════════════════════════════════════════════════════════════════════════

describe("Credit Gateway - getCreditCost", () => {
  it("returns correct cost for video_5s_budget", () => {
    expect(getCreditCost("video_5s_budget")).toBe(1);
  });

  it("returns correct cost for video_5s_standard", () => {
    expect(getCreditCost("video_5s_standard")).toBe(2);
  });

  it("returns correct cost for video_5s_premium", () => {
    expect(getCreditCost("video_5s_premium")).toBe(4);
  });

  it("returns correct cost for video_10s_budget", () => {
    expect(getCreditCost("video_10s_budget")).toBe(2);
  });

  it("returns correct cost for video_10s_standard", () => {
    expect(getCreditCost("video_10s_standard")).toBe(4);
  });

  it("returns correct cost for video_10s_premium", () => {
    expect(getCreditCost("video_10s_premium")).toBe(8);
  });

  it("returns correct cost for voice_synthesis", () => {
    expect(getCreditCost("voice_synthesis")).toBe(1);
  });

  it("returns correct cost for voice_clone", () => {
    expect(getCreditCost("voice_clone")).toBe(3);
  });

  it("returns correct cost for script_generation", () => {
    expect(getCreditCost("script_generation")).toBe(1);
  });

  it("returns correct cost for panel_generation", () => {
    expect(getCreditCost("panel_generation")).toBe(1);
  });

  it("returns correct cost for music_generation", () => {
    expect(getCreditCost("music_generation")).toBe(2);
  });

  it("returns correct cost for lora_train", () => {
    expect(getCreditCost("lora_train")).toBe(10);
  });

  it("returns 0 for unknown action", () => {
    expect(getCreditCost("nonexistent" as GenerationAction)).toBe(0);
  });
});

describe("Credit Gateway - getAllCreditCosts", () => {
  it("returns all costs as a record", () => {
    const costs = getAllCreditCosts();
    expect(typeof costs).toBe("object");
    expect(Object.keys(costs).length).toBeGreaterThan(5);
  });

  it("includes all known generation actions", () => {
    const costs = getAllCreditCosts();
    expect(costs).toHaveProperty("video_5s_budget");
    expect(costs).toHaveProperty("video_5s_standard");
    expect(costs).toHaveProperty("video_5s_premium");
    expect(costs).toHaveProperty("video_10s_budget");
    expect(costs).toHaveProperty("video_10s_standard");
    expect(costs).toHaveProperty("video_10s_premium");
    expect(costs).toHaveProperty("voice_synthesis");
    expect(costs).toHaveProperty("voice_clone");
    expect(costs).toHaveProperty("script_generation");
    expect(costs).toHaveProperty("panel_generation");
    expect(costs).toHaveProperty("music_generation");
    expect(costs).toHaveProperty("lora_train");
  });

  it("all costs are non-negative integers", () => {
    const costs = getAllCreditCosts();
    for (const [action, cost] of Object.entries(costs)) {
      expect(cost).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(cost)).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. tRPC ENDPOINT REGISTRATION
// ═══════════════════════════════════════════════════════════════════════════

describe("tRPC Billing Router Endpoints", () => {
  it("billing.getSubscription is registered", () => {
    const c = caller(createAuthContext());
    expect(c.billing.getSubscription).toBeDefined();
  });

  it("billing.getBalance is registered", () => {
    const c = caller(createAuthContext());
    expect(c.billing.getBalance).toBeDefined();
  });

  it("billing.getLedgerHistory is registered", () => {
    const c = caller(createAuthContext());
    expect(c.billing.getLedgerHistory).toBeDefined();
  });

  it("billing.getUsageSummary is registered", () => {
    const c = caller(createAuthContext());
    expect(c.billing.getUsageSummary).toBeDefined();
  });

  it("billing.createCheckout is registered", () => {
    const c = caller(createAuthContext());
    expect(c.billing.createCheckout).toBeDefined();
  });

  it("billing.createPortal is registered", () => {
    const c = caller(createAuthContext());
    expect(c.billing.createPortal).toBeDefined();
  });

  it("billing.createPackCheckout is registered", () => {
    const c = caller(createAuthContext());
    expect(c.billing.createPackCheckout).toBeDefined();
  });

  it("billing.getCreditPacks is registered (public)", () => {
    const c = caller(createPublicContext());
    expect(c.billing.getCreditPacks).toBeDefined();
  });
});

describe("tRPC Credit Gateway Endpoints", () => {
  it("creditGateway.canAfford is registered", () => {
    const c = caller(createAuthContext());
    expect(c.creditGateway.canAfford).toBeDefined();
  });

  it("creditGateway.canAffordBatch is registered", () => {
    const c = caller(createAuthContext());
    expect(c.creditGateway.canAffordBatch).toBeDefined();
  });

  it("creditGateway.getCosts is registered (public)", () => {
    const c = caller(createPublicContext());
    expect(c.creditGateway.getCosts).toBeDefined();
  });

  it("creditGateway.getCost is registered (public)", () => {
    const c = caller(createPublicContext());
    expect(c.creditGateway.getCost).toBeDefined();
  });
});

describe("tRPC Admin Credit Endpoints", () => {
  it("admin.issuePromoCredits is registered", () => {
    const c = caller(createAdminContext());
    expect(c.admin.issuePromoCredits).toBeDefined();
  });

  it("admin.adminCreditAdjustment is registered", () => {
    const c = caller(createAdminContext());
    expect(c.admin.adminCreditAdjustment).toBeDefined();
  });

  it("admin.runReconciliation is registered", () => {
    const c = caller(createAdminContext());
    expect(c.admin.runReconciliation).toBeDefined();
  });

  it("admin.releaseStaleHolds is registered", () => {
    const c = caller(createAdminContext());
    expect(c.admin.releaseStaleHolds).toBeDefined();
  });

  it("admin.getCreditAnalytics is registered", () => {
    const c = caller(createAdminContext());
    expect(c.admin.getCreditAnalytics).toBeDefined();
  });

  it("admin.getCreatorCostBreakdown is registered", () => {
    const c = caller(createAdminContext());
    expect(c.admin.getCreatorCostBreakdown).toBeDefined();
  });

  it("admin.getUserCreditInfo is registered", () => {
    const c = caller(createAdminContext());
    expect(c.admin.getUserCreditInfo).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. CREDIT COSTS MATCH SPEC
// ═══════════════════════════════════════════════════════════════════════════

describe("Credit Costs Match Spec", () => {
  it("CREDIT_COSTS includes all generation types", () => {
    expect(CREDIT_COSTS.video_5s_budget).toBeDefined();
    expect(CREDIT_COSTS.video_5s_standard).toBeDefined();
    expect(CREDIT_COSTS.video_5s_premium).toBeDefined();
    expect(CREDIT_COSTS.video_10s_budget).toBeDefined();
    expect(CREDIT_COSTS.video_10s_standard).toBeDefined();
    expect(CREDIT_COSTS.video_10s_premium).toBeDefined();
    expect(CREDIT_COSTS.voice_synthesis).toBeDefined();
    expect(CREDIT_COSTS.voice_clone).toBeDefined();
    expect(CREDIT_COSTS.script_generation).toBeDefined();
    expect(CREDIT_COSTS.panel_generation).toBeDefined();
    expect(CREDIT_COSTS.music_generation).toBeDefined();
    expect(CREDIT_COSTS.lora_train).toBeDefined();
  });

  it("10s video costs more than 5s video at same tier", () => {
    expect(CREDIT_COSTS.video_10s_budget).toBeGreaterThan(CREDIT_COSTS.video_5s_budget);
    expect(CREDIT_COSTS.video_10s_standard).toBeGreaterThan(CREDIT_COSTS.video_5s_standard);
    expect(CREDIT_COSTS.video_10s_premium).toBeGreaterThan(CREDIT_COSTS.video_5s_premium);
  });

  it("premium video costs more than standard at same length", () => {
    expect(CREDIT_COSTS.video_5s_premium).toBeGreaterThan(CREDIT_COSTS.video_5s_standard);
    expect(CREDIT_COSTS.video_10s_premium).toBeGreaterThan(CREDIT_COSTS.video_10s_standard);
  });

  it("voice_clone costs more than voice_synthesis", () => {
    expect(CREDIT_COSTS.voice_clone).toBeGreaterThan(CREDIT_COSTS.voice_synthesis);
  });

  it("lora_train is the most expensive action", () => {
    const maxCost = Math.max(...Object.values(CREDIT_COSTS));
    expect(CREDIT_COSTS.lora_train).toBe(maxCost);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. TIER FEATURE GATING
// ═══════════════════════════════════════════════════════════════════════════

describe("Tier Feature Gating", () => {
  it("free_trial allows budget model tier only", () => {
    expect(TIERS.free_trial.allowedModelTiers).toEqual(["budget"]);
  });

  it("creator allows budget and standard model tiers", () => {
    expect(TIERS.creator.allowedModelTiers).toContain("budget");
    expect(TIERS.creator.allowedModelTiers).toContain("standard");
    expect(TIERS.creator.allowedModelTiers).not.toContain("premium");
  });

  it("creator_pro allows up to premium model tier", () => {
    expect(TIERS.creator_pro.allowedModelTiers).toContain("premium");
    expect(TIERS.creator_pro.allowedModelTiers).not.toContain("ultra");
  });

  it("studio allows all model tiers including ultra", () => {
    expect(TIERS.studio.allowedModelTiers).toContain("ultra");
  });

  it("free_trial has no rollover", () => {
    expect(TIERS.free_trial.rolloverPercentage).toBe(0);
  });

  it("creator has no rollover", () => {
    expect(TIERS.creator.rolloverPercentage).toBe(0);
  });

  it("creator_pro has 20% rollover capped at 240", () => {
    expect(TIERS.creator_pro.rolloverPercentage).toBe(0.20);
    expect(TIERS.creator_pro.rolloverCap).toBe(240);
  });

  it("studio has 50% rollover capped at 1800", () => {
    expect(TIERS.studio.rolloverPercentage).toBe(0.50);
    expect(TIERS.studio.rolloverCap).toBe(1800);
  });

  it("enterprise has 100% rollover with no cap", () => {
    expect(TIERS.enterprise.rolloverPercentage).toBe(1.0);
    expect(TIERS.enterprise.rolloverCap).toBeNull();
  });

  it("queue priority: studio has highest priority (1)", () => {
    expect(TIERS.studio.queuePriority).toBe(1);
    expect(TIERS.free_trial.queuePriority).toBeGreaterThan(TIERS.studio.queuePriority);
  });

  it("episode length cap increases with tier", () => {
    expect(TIERS.free_trial.episodeLengthCapSeconds).toBeLessThan(TIERS.creator.episodeLengthCapSeconds);
    expect(TIERS.creator.episodeLengthCapSeconds).toBeLessThan(TIERS.creator_pro.episodeLengthCapSeconds);
    expect(TIERS.creator_pro.episodeLengthCapSeconds).toBeLessThan(TIERS.studio.episodeLengthCapSeconds);
    expect(TIERS.studio.episodeLengthCapSeconds).toBeLessThan(TIERS.enterprise.episodeLengthCapSeconds);
  });

  it("pack discount increases with tier", () => {
    expect(TIERS.free_trial.packDiscount).toBeLessThanOrEqual(TIERS.creator.packDiscount);
    expect(TIERS.creator.packDiscount).toBeLessThanOrEqual(TIERS.creator_pro.packDiscount);
    expect(TIERS.creator_pro.packDiscount).toBeLessThanOrEqual(TIERS.studio.packDiscount);
    expect(TIERS.studio.packDiscount).toBeLessThanOrEqual(TIERS.enterprise.packDiscount);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. TYPE EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

describe("Type Exports", () => {
  it("TierKey type covers all tiers", () => {
    const allTiers: TierKey[] = ["free_trial", "creator", "creator_pro", "studio", "enterprise"];
    allTiers.forEach(t => expect(TIERS[t]).toBeDefined());
  });

  it("GenerationAction type covers all actions", () => {
    const actions: GenerationAction[] = [
      "video_5s_budget", "video_5s_standard", "video_5s_premium",
      "video_10s_budget", "video_10s_standard", "video_10s_premium",
      "voice_synthesis", "voice_clone",
      "script_generation", "panel_generation", "image_upscale",
      "music_generation", "sfx_generation", "narrator_generation",
      "lora_train",
    ];
    actions.forEach(a => expect(getCreditCost(a)).toBeGreaterThanOrEqual(0));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. PUBLIC ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════

describe("getCreditPacks endpoint", () => {
  it("returns pack data via public procedure", async () => {
    const c = caller(createPublicContext());
    const packs = await c.billing.getCreditPacks();
    expect(packs).toHaveLength(3);
    packs.forEach((p: any) => {
      expect(p.key).toBeTruthy();
      expect(p.credits).toBeGreaterThan(0);
      expect(p.basePriceCents).toBeGreaterThan(0);
      expect(p.name).toBeTruthy();
    });
  });
});

describe("getCosts endpoint", () => {
  it("returns all credit costs via public procedure", async () => {
    const c = caller(createPublicContext());
    const costs = await c.creditGateway.getCosts();
    expect(costs).toHaveProperty("video_5s_budget");
    expect(costs).toHaveProperty("panel_generation");
    expect(costs.video_5s_budget).toBe(1);
    expect(costs.video_10s_premium).toBe(8);
  });
});

describe("getCost endpoint", () => {
  it("returns single action cost for video_5s_standard", async () => {
    const c = caller(createPublicContext());
    const result = await c.creditGateway.getCost({ action: "video_5s_standard" });
    expect(result.cost).toBe(2);
    expect(result.action).toBe("video_5s_standard");
  });

  it("returns single action cost for lora_train", async () => {
    const c = caller(createPublicContext());
    const result = await c.creditGateway.getCost({ action: "lora_train" });
    expect(result.cost).toBe(10);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. SCHEMA VALIDATION (table existence via type checks)
// ═══════════════════════════════════════════════════════════════════════════

describe("Schema Tables Exist", () => {
  it("credit_ledger table is importable", async () => {
    const { creditLedger } = await import("../drizzle/schema");
    expect(creditLedger).toBeDefined();
    expect(creditLedger.userId).toBeDefined();
    expect(creditLedger.amountCredits).toBeDefined();
    expect(creditLedger.transactionType).toBeDefined();
  });

  it("credit_balances table is importable", async () => {
    const { creditBalances } = await import("../drizzle/schema");
    expect(creditBalances).toBeDefined();
    expect(creditBalances.userId).toBeDefined();
    expect(creditBalances.committedBalance).toBeDefined();
    expect(creditBalances.activeHolds).toBeDefined();
  });

  it("credit_packs table is importable", async () => {
    const { creditPacks } = await import("../drizzle/schema");
    expect(creditPacks).toBeDefined();
    expect(creditPacks.userId).toBeDefined();
    expect(creditPacks.creditsGranted).toBeDefined();
    expect(creditPacks.pricePaidCents).toBeDefined();
  });

  it("usage_events table is importable", async () => {
    const { usageEvents } = await import("../drizzle/schema");
    expect(usageEvents).toBeDefined();
    expect(usageEvents.userId).toBeDefined();
    expect(usageEvents.creditsConsumed).toBeDefined();
  });

  it("episode_costs table is importable", async () => {
    const { episodeCosts } = await import("../drizzle/schema");
    expect(episodeCosts).toBeDefined();
    expect(episodeCosts.episodeId).toBeDefined();
    expect(episodeCosts.videoCostCredits).toBeDefined();
  });

  it("stripe_events_log table is importable", async () => {
    const { stripeEventsLog } = await import("../drizzle/schema");
    expect(stripeEventsLog).toBeDefined();
    expect(stripeEventsLog.stripeEventId).toBeDefined();
    expect(stripeEventsLog.eventType).toBeDefined();
  });

  it("subscriptions table has Prompt 15 columns", async () => {
    const { subscriptions } = await import("../drizzle/schema");
    expect(subscriptions).toBeDefined();
    expect(subscriptions.tier).toBeDefined();
    expect(subscriptions.monthlyCreditGrant).toBeDefined();
    expect(subscriptions.rolloverPercentage).toBeDefined();
    expect(subscriptions.queuePriority).toBeDefined();
    expect(subscriptions.allowedModelTiers).toBeDefined();
  });
});
