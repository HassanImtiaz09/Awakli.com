import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import { TIERS, CREDIT_COSTS, getTierFeatureList, type TierKey } from "./stripe/products";
import type { TrpcContext } from "./_core/context";

// ─── Helpers ───────────────────────────────────────────────────────────

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(role: "user" | "admin" = "user"): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-user-001",
    email: "test@awakli.com",
    name: "Test User",
    loginMethod: "manus",
    role,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  return {
    user,
    req: {
      protocol: "https",
      headers: { origin: "https://test.awakli.com" },
    } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };
}

function createPublicContext(): TrpcContext {
  return {
    user: null,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };
}

// ─── Tier Config Tests ─────────────────────────────────────────────────

describe("Tier Configuration", () => {
  it("should have correct tier keys (5 tiers)", () => {
    expect(Object.keys(TIERS)).toEqual(["free_trial", "creator", "creator_pro", "studio", "enterprise"]);
  });

  it("free_trial tier should have 15 credits and 0 price", () => {
    expect(TIERS.free_trial.credits).toBe(15);
    expect(TIERS.free_trial.monthlyPrice).toBe(0);
    expect(TIERS.free_trial.annualPrice).toBe(0);
    expect(TIERS.free_trial.hasWatermark).toBe(true);
    expect(TIERS.free_trial.maxProjects).toBe(3);
  });

  it("creator tier should have 35 credits and $19/mo", () => {
    expect(TIERS.creator.credits).toBe(35);
    expect(TIERS.creator.monthlyPrice).toBe(1900);
    expect(TIERS.creator.hasWatermark).toBe(false);
    expect(TIERS.creator.maxProjects).toBe(10);
  });

  it("studio tier should have 600 credits and $149/mo", () => {
    expect(TIERS.studio.credits).toBe(600);
    expect(TIERS.studio.monthlyPrice).toBe(14900);
    expect(TIERS.studio.hasApiAccess).toBe(true);
    expect(TIERS.studio.hasPrioritySupport).toBe(true);
  });

  it("annual pricing should be discounted from monthly", () => {
    const creatorMonthly = TIERS.creator.monthlyPrice * 12;
    const creatorAnnual = TIERS.creator.annualPrice;
    expect(creatorAnnual).toBeLessThan(creatorMonthly);
    expect(creatorAnnual / creatorMonthly).toBeLessThan(1);
  });

  it("credit costs should be defined for all action types", () => {
    expect(CREDIT_COSTS.script_generation).toBe(1);
    expect(CREDIT_COSTS.panel_generation).toBe(1);
    expect(CREDIT_COSTS.video_5s_standard).toBe(2);
    expect(CREDIT_COSTS.voice_synthesis).toBe(1);
    expect(CREDIT_COSTS.lora_train).toBe(10);
  });
});

// ─── Feature List Tests ────────────────────────────────────────────────

describe("getTierFeatureList", () => {
  it("should return features for free_trial tier", () => {
    const features = getTierFeatureList("free_trial");
    expect(features.length).toBeGreaterThan(0);
  });

  it("should return features for creator tier", () => {
    const features = getTierFeatureList("creator");
    expect(features.length).toBeGreaterThan(0);
  });

  it("should return features for studio tier", () => {
    const features = getTierFeatureList("studio");
    expect(features.length).toBeGreaterThan(0);
  });
});

// ─── Billing Router Tests ──────────────────────────────────────────────

describe("billing.getSubscription", () => {
  it("should return free_trial tier for user without subscription", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.billing.getSubscription();
    expect(result.tier).toBe("free_trial");
    expect(result.limits).toBeDefined();
    expect(result.features).toBeInstanceOf(Array);
    expect(result.features.length).toBeGreaterThan(0);
  });
});

describe("billing.getTiers", () => {
  it("should return all 5 tiers (public endpoint)", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.billing.getTiers();
    expect(result).toHaveLength(5);
    expect(result.map((t) => t.key)).toEqual(["free_trial", "creator", "creator_pro", "studio", "enterprise"]);
    result.forEach((tier) => {
      expect(tier.features).toBeInstanceOf(Array);
      expect(tier.name).toBeDefined();
      expect(tier.credits).toBeGreaterThanOrEqual(0);
    });
  });
});

// ─── Usage Router Tests ────────────────────────────────────────────────

describe("usage.getSummary", () => {
  it("should return usage summary for authenticated user", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.usage.getSummary();
    expect(result).toHaveProperty("total");
    expect(result).toHaveProperty("allocation");
    expect(result).toHaveProperty("tier");
    expect(result).toHaveProperty("remaining");
    expect(result).toHaveProperty("percentUsed");
    expect(result).toHaveProperty("byType");
    expect(result.tier).toBe("free_trial");
    expect(result.allocation).toBe(15);
    expect(result.remaining).toBeLessThanOrEqual(15);
  });
});

describe("usage.getHistory", () => {
  it("should return empty history for new user", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.usage.getHistory();
    expect(result).toBeInstanceOf(Array);
  });
});

// ─── Marketplace Router Tests ──────────────────────────────────────────

describe("marketplace.getEarnings", () => {
  it("should return earnings data for authenticated user", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.marketplace.getEarnings();
    expect(result).toHaveProperty("totalEarnings");
    expect(result).toHaveProperty("totalTips");
    expect(result).toHaveProperty("monthlyEarnings");
    expect(result.totalEarnings).toBeGreaterThanOrEqual(0);
    expect(result.totalTips).toBeGreaterThanOrEqual(0);
  });
});

describe("marketplace.getTips", () => {
  it("should return tips for authenticated user", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.marketplace.getTips();
    expect(result).toBeInstanceOf(Array);
  });
});

// ─── Admin Router Tests ────────────────────────────────────────────────

describe("admin.getMetrics", () => {
  it("should return metrics for admin user", async () => {
    const ctx = createAuthContext("admin");
    const caller = appRouter.createCaller(ctx);

    const result = await caller.admin.getMetrics();
    expect(result).toHaveProperty("totalUsers");
    expect(result).toHaveProperty("totalCreators");
    expect(result).toHaveProperty("totalProjects");
    expect(result).toHaveProperty("totalRevenue");
    expect(result).toHaveProperty("subscriptionCounts");
    expect(result.totalUsers).toBeGreaterThanOrEqual(0);
  });

  it("should reject non-admin user", async () => {
    const ctx = createAuthContext("user");
    const caller = appRouter.createCaller(ctx);

    await expect(caller.admin.getMetrics()).rejects.toThrow();
  });
});

describe("admin.getUsers", () => {
  it("should return paginated user list for admin", async () => {
    const ctx = createAuthContext("admin");
    const caller = appRouter.createCaller(ctx);

    const result = await caller.admin.getUsers({ page: 1, limit: 10 });
    expect(result).toHaveProperty("users");
    expect(result).toHaveProperty("total");
    expect(result.users).toBeInstanceOf(Array);
    expect(result.total).toBeGreaterThanOrEqual(0);
  });
});

describe("admin.getModerationQueue", () => {
  it("should return moderation queue for admin", async () => {
    const ctx = createAuthContext("admin");
    const caller = appRouter.createCaller(ctx);

    const result = await caller.admin.getModerationQueue({ status: "pending" });
    expect(result).toBeInstanceOf(Array);
  });
});

describe("admin.getSubscriptions", () => {
  it("should return subscriptions for admin", async () => {
    const ctx = createAuthContext("admin");
    const caller = appRouter.createCaller(ctx);

    const result = await caller.admin.getSubscriptions();
    expect(result).toBeInstanceOf(Array);
  });
});
