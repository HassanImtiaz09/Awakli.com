import { describe, expect, it } from "vitest";
import {
  TIER_DISPLAY_NAMES,
  TIER_MONTHLY_PRICE_CENTS,
  TIER_ANNUAL_MONTHLY_PRICE_CENTS,
  TIER_MONTHLY_CREDITS,
  TIER_KEYS,
  type TierKey,
} from "../shared/pricingCatalog";
import {
  TIERS as SERVER_TIERS,
  getTierFeatureList,
  TIER_ORDER,
  type TierKey as ServerTierKey,
} from "./stripe/products";

// ═══════════════════════════════════════════════════════════════════════════
// Pricing Page Data Integrity Tests
// Ensures the frontend pricing page data stays in sync with the catalog
// ═══════════════════════════════════════════════════════════════════════════

describe("Pricing Catalog (shared/pricingCatalog.ts)", () => {
  it("defines exactly 5 tier keys", () => {
    expect(TIER_KEYS).toHaveLength(5);
    expect([...TIER_KEYS]).toEqual([
      "free_trial",
      "creator",
      "creator_pro",
      "studio",
      "enterprise",
    ]);
  });

  it("every tier key has a display name", () => {
    for (const key of TIER_KEYS) {
      expect(TIER_DISPLAY_NAMES[key]).toBeDefined();
      expect(TIER_DISPLAY_NAMES[key].length).toBeGreaterThan(0);
    }
  });

  it("display names match the brand names", () => {
    expect(TIER_DISPLAY_NAMES.free_trial).toBe("Apprentice");
    expect(TIER_DISPLAY_NAMES.creator).toBe("Mangaka");
    expect(TIER_DISPLAY_NAMES.creator_pro).toBe("Studio");
    expect(TIER_DISPLAY_NAMES.studio).toBe("Studio Pro");
    expect(TIER_DISPLAY_NAMES.enterprise).toBe("Enterprise");
  });

  it("monthly prices are in cents and correct", () => {
    expect(TIER_MONTHLY_PRICE_CENTS.free_trial).toBe(0);
    expect(TIER_MONTHLY_PRICE_CENTS.creator).toBe(1900);
    expect(TIER_MONTHLY_PRICE_CENTS.creator_pro).toBe(4900);
    expect(TIER_MONTHLY_PRICE_CENTS.studio).toBe(14900);
    expect(TIER_MONTHLY_PRICE_CENTS.enterprise).toBe(0);
  });

  it("annual prices are strictly less than monthly prices for paid tiers", () => {
    const paidTiers: TierKey[] = ["creator", "creator_pro", "studio"];
    for (const key of paidTiers) {
      expect(TIER_ANNUAL_MONTHLY_PRICE_CENTS[key]).toBeLessThan(
        TIER_MONTHLY_PRICE_CENTS[key]
      );
    }
  });

  it("annual prices represent ~20% discount", () => {
    const paidTiers: TierKey[] = ["creator", "creator_pro", "studio"];
    for (const key of paidTiers) {
      const monthly = TIER_MONTHLY_PRICE_CENTS[key];
      const annualMonthly = TIER_ANNUAL_MONTHLY_PRICE_CENTS[key];
      const discount = 1 - annualMonthly / monthly;
      // Allow 15-25% range for rounding
      expect(discount).toBeGreaterThanOrEqual(0.15);
      expect(discount).toBeLessThanOrEqual(0.25);
    }
  });

  it("monthly credits are defined for all tiers", () => {
    expect(TIER_MONTHLY_CREDITS.free_trial).toBe(15);
    expect(TIER_MONTHLY_CREDITS.creator).toBe(200);
    expect(TIER_MONTHLY_CREDITS.creator_pro).toBe(600);
    expect(TIER_MONTHLY_CREDITS.studio).toBe(2000);
    expect(TIER_MONTHLY_CREDITS.enterprise).toBe(0); // custom
  });

  it("credits increase monotonically across paid tiers", () => {
    expect(TIER_MONTHLY_CREDITS.creator).toBeGreaterThan(
      TIER_MONTHLY_CREDITS.free_trial
    );
    expect(TIER_MONTHLY_CREDITS.creator_pro).toBeGreaterThan(
      TIER_MONTHLY_CREDITS.creator
    );
    expect(TIER_MONTHLY_CREDITS.studio).toBeGreaterThan(
      TIER_MONTHLY_CREDITS.creator_pro
    );
  });
});

describe("Server Tier Config (stripe/products.ts) matches Catalog", () => {
  it("server defines the same 5 tier keys", () => {
    const serverKeys = Object.keys(SERVER_TIERS);
    expect(serverKeys).toHaveLength(5);
    expect(serverKeys).toEqual([...TIER_KEYS]);
  });

  it("server tier names match catalog display names", () => {
    for (const key of TIER_KEYS) {
      expect(SERVER_TIERS[key as ServerTierKey].name).toBe(
        TIER_DISPLAY_NAMES[key]
      );
    }
  });

  it("server monthly prices match catalog (in cents)", () => {
    for (const key of TIER_KEYS) {
      expect(SERVER_TIERS[key as ServerTierKey].monthlyPrice).toBe(
        TIER_MONTHLY_PRICE_CENTS[key]
      );
    }
  });

  it("server annual monthly prices match catalog (in cents)", () => {
    for (const key of TIER_KEYS) {
      expect(SERVER_TIERS[key as ServerTierKey].annualMonthlyPrice).toBe(
        TIER_ANNUAL_MONTHLY_PRICE_CENTS[key]
      );
    }
  });

  it("tier order is strictly increasing", () => {
    const ordered: ServerTierKey[] = [
      "free_trial",
      "creator",
      "creator_pro",
      "studio",
      "enterprise",
    ];
    for (let i = 1; i < ordered.length; i++) {
      expect(TIER_ORDER[ordered[i]]).toBeGreaterThan(
        TIER_ORDER[ordered[i - 1]]
      );
    }
  });

  it("every tier has a non-empty feature list", () => {
    for (const key of TIER_KEYS) {
      const features = getTierFeatureList(key as ServerTierKey);
      expect(features.length).toBeGreaterThan(0);
    }
  });

  it("checkout-eligible tiers are creator, creator_pro, studio", () => {
    // These are the tiers accepted by billing.createCheckout
    const checkoutTiers: ServerTierKey[] = [
      "creator",
      "creator_pro",
      "studio",
    ];
    for (const key of checkoutTiers) {
      expect(SERVER_TIERS[key].monthlyPrice).toBeGreaterThan(0);
      // Ensure they have pricing set (not custom/free)
    }
    // free_trial and enterprise should NOT go through checkout
    expect(SERVER_TIERS.free_trial.monthlyPrice).toBe(0);
    expect(SERVER_TIERS.enterprise.monthlyPrice).toBe(0);
  });
});
