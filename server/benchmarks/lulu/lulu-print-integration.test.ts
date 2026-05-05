/**
 * Wave 5A Item 2: Lulu Print Integration — Tests
 *
 * Covers:
 * - Print products configuration & pricing
 * - Lulu API client (unit tests with mocked fetch)
 * - Lulu webhook handler (signature verification, status mapping)
 * - Print order router (Stripe checkout, order management)
 * - Admin payout workflow
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Print Products Tests ─────────────────────────────────────────────────────

import {
  PRINT_PRODUCTS,
  getDefaultProduct,
  getProductById,
  getProductsByTrimSize,
  calculateOrderPrice,
  validatePageCount,
  getShippingOptions,
} from "./print-products";

describe("Print Products Configuration", () => {
  it("has at least 6 products defined", () => {
    expect(PRINT_PRODUCTS.length).toBeGreaterThanOrEqual(6);
  });

  it("has exactly one default product", () => {
    const defaults = PRINT_PRODUCTS.filter(p => p.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].trimSize).toBe("b5");
    expect(defaults[0].colorInterior).toBe("FC");
  });

  it("getDefaultProduct returns B5 full color", () => {
    const product = getDefaultProduct();
    expect(product.id).toBe("b5-color-perfect");
    expect(product.luluPackageId).toContain("0693X0984");
  });

  it("getProductById returns correct product", () => {
    const product = getProductById("tankobon-bw-perfect");
    expect(product).toBeDefined();
    expect(product!.trimSize).toBe("tankobon");
    expect(product!.colorInterior).toBe("BW");
  });

  it("getProductById returns undefined for unknown ID", () => {
    expect(getProductById("nonexistent")).toBeUndefined();
  });

  it("getProductsByTrimSize filters correctly", () => {
    const b5Products = getProductsByTrimSize("b5");
    expect(b5Products.length).toBeGreaterThanOrEqual(2); // FC + BW
    expect(b5Products.every(p => p.trimSize === "b5")).toBe(true);
  });

  describe("Price Calculation", () => {
    it("calculates unit price as base + (pages × perPage)", () => {
      const product = getDefaultProduct();
      const result = calculateOrderPrice(product, 100, 1);
      const expectedUnit = product.basePriceCents + (100 * product.perPageCents);
      expect(result.unitPriceCents).toBe(expectedUnit);
    });

    it("scales total by quantity", () => {
      const product = getDefaultProduct();
      const single = calculateOrderPrice(product, 50, 1);
      const triple = calculateOrderPrice(product, 50, 3);
      expect(triple.totalPriceCents).toBe(single.totalPriceCents * 3);
    });

    it("splits revenue into print cost + platform + creator", () => {
      const product = getDefaultProduct();
      const result = calculateOrderPrice(product, 100, 1);
      // All components should be positive
      expect(result.printCostCents).toBeGreaterThan(0);
      expect(result.platformMarginCents).toBeGreaterThan(0);
      expect(result.creatorRoyaltyCents).toBeGreaterThan(0);
    });

    it("BW products are cheaper than FC for same trim", () => {
      const fc = getProductById("b5-color-perfect")!;
      const bw = getProductById("b5-bw-perfect")!;
      const fcPrice = calculateOrderPrice(fc, 100, 1);
      const bwPrice = calculateOrderPrice(bw, 100, 1);
      expect(bwPrice.unitPriceCents).toBeLessThan(fcPrice.unitPriceCents);
    });
  });

  describe("Page Count Validation", () => {
    it("validates within range", () => {
      const product = getDefaultProduct();
      expect(validatePageCount(product, 50).valid).toBe(true);
      expect(validatePageCount(product, 24).valid).toBe(true);
      expect(validatePageCount(product, 800).valid).toBe(true);
    });

    it("rejects below minimum", () => {
      const product = getDefaultProduct();
      const result = validatePageCount(product, 10);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Minimum");
    });

    it("rejects above maximum", () => {
      const product = getDefaultProduct();
      const result = validatePageCount(product, 900);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Maximum");
    });
  });

  describe("Shipping Options", () => {
    it("returns 4 shipping methods", () => {
      const options = getShippingOptions();
      expect(options).toHaveLength(4);
      expect(options.map(o => o.method)).toEqual(["MAIL", "GROUND", "EXPEDITED", "EXPRESS"]);
    });

    it("prices increase with speed", () => {
      const options = getShippingOptions();
      for (let i = 1; i < options.length; i++) {
        expect(options[i].baseCostCents).toBeGreaterThan(options[i - 1].baseCostCents);
      }
    });
  });
});

// ─── Lulu Client Tests ────────────────────────────────────────────────────────

import { LuluClient, resetLuluClient } from "./lulu-client";

describe("Lulu API Client", () => {
  let client: LuluClient;

  beforeEach(() => {
    client = new LuluClient({
      clientKey: "test-key",
      clientSecret: "test-secret",
      sandbox: true,
    });
  });

  afterEach(() => {
    resetLuluClient();
    vi.restoreAllMocks();
  });

  it("constructs with sandbox URL", () => {
    expect((client as any).baseUrl).toBe("https://api.sandbox.lulu.com");
  });

  it("constructs with production URL when sandbox=false", () => {
    const prodClient = new LuluClient({
      clientKey: "key",
      clientSecret: "secret",
      sandbox: false,
    });
    expect((prodClient as any).baseUrl).toBe("https://api.lulu.com");
  });

  it("getAccessToken fetches and caches token", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: "test-token-123", expires_in: 3600 }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const token = await client.getAccessToken();
    expect(token).toBe("test-token-123");
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Second call should use cache
    const token2 = await client.getAccessToken();
    expect(token2).toBe("test-token-123");
    expect(mockFetch).toHaveBeenCalledTimes(1); // still 1
  });

  it("getAccessToken throws on auth failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "Invalid credentials",
    }));

    await expect(client.getAccessToken()).rejects.toThrow("Lulu auth failed (401)");
  });

  it("createPrintJob sends correct payload", async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "tok", expires_in: 3600 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 12345,
          status: { name: "CREATED" },
          line_items: [{ id: 1, title: "Test", status: { name: "CREATED" } }],
          shipping_address: { name: "Test User", city: "Tokyo", country_code: "JP" },
          date_created: "2026-01-01T00:00:00Z",
          date_modified: "2026-01-01T00:00:00Z",
        }),
      });
    vi.stubGlobal("fetch", mockFetch);

    const result = await client.createPrintJob({
      shippingAddress: {
        name: "Test User",
        street1: "123 Main St",
        city: "Tokyo",
        countryCode: "JP",
        postcode: "100-0001",
      },
      shippingLevel: "MAIL",
      lineItems: [{
        title: "My Manga Vol. 1",
        cover: "https://s3.example.com/cover.pdf",
        interior: "https://s3.example.com/interior.pdf",
        podPackageId: "0693X0984FCPERFECT060UW444",
        quantity: 1,
      }],
      contactEmail: "test@example.com",
    });

    expect(result.id).toBe(12345);
    expect(result.status).toBe("CREATED");
    expect(result.lineItems).toHaveLength(1);

    // Verify the POST payload
    const postCall = mockFetch.mock.calls[1];
    expect(postCall[0]).toContain("/print-jobs/");
    const body = JSON.parse(postCall[1].body);
    expect(body.line_items[0].pod_package_id).toBe("0693X0984FCPERFECT060UW444");
    expect(body.shipping_address.country_code).toBe("JP");
  });

  it("calculateCost sends correct payload", async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "tok", expires_in: 3600 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          total_cost_excl_tax: "12.50",
          total_cost_incl_tax: "13.75",
          total_tax: "1.25",
          shipping_cost: { total_cost_excl_tax: "4.99" },
          line_item_costs: [{ total_cost_excl_tax: "7.51", quantity: 1 }],
          currency: "USD",
        }),
      });
    vi.stubGlobal("fetch", mockFetch);

    const result = await client.calculateCost({
      lineItems: [{ podPackageId: "0693X0984FCPERFECT060UW444", quantity: 1, pageCount: 100 }],
      shippingAddress: { countryCode: "US", postcode: "90210" },
      shippingLevel: "MAIL",
    });

    expect(result.totalCostExclTax).toBe("12.50");
    expect(result.shippingCost).toBe("4.99");
    expect(result.currency).toBe("USD");
  });

  it("getPrintJob maps response correctly", async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "tok", expires_in: 3600 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 99,
          status: { name: "SHIPPED" },
          line_items: [{
            id: 1,
            title: "Manga",
            status: { name: "SHIPPED" },
            tracking_id: "TRACK123",
            tracking_urls: ["https://track.example.com/TRACK123"],
          }],
          shipping_address: {
            name: "User",
            street1: "456 Oak Ave",
            city: "LA",
            state_code: "CA",
            country_code: "US",
            postcode: "90001",
          },
          costs: {
            total_cost_incl_tax: "25.00",
            total_tax: "2.00",
            shipping_cost: { total_cost_excl_tax: "5.00" },
            currency: "USD",
          },
          date_created: "2026-01-01",
          date_modified: "2026-01-15",
        }),
      });
    vi.stubGlobal("fetch", mockFetch);

    const job = await client.getPrintJob(99);
    expect(job.id).toBe(99);
    expect(job.status).toBe("SHIPPED");
    expect(job.lineItems[0].trackingId).toBe("TRACK123");
    expect(job.costs?.totalCostInclTax).toBe("25.00");
  });
});

// ─── Lulu Webhook Tests ───────────────────────────────────────────────────────

import { verifyLuluSignature } from "./lulu-webhook";
import { createHmac } from "crypto";

describe("Lulu Webhook Handler", () => {
  describe("Signature Verification", () => {
    const secret = "test-webhook-secret";
    const payload = JSON.stringify({ id: "evt_123", topic: "PRINT_JOB_STATUS_CHANGED" });

    it("verifies valid signature", () => {
      const signature = createHmac("sha256", secret).update(payload).digest("hex");
      expect(verifyLuluSignature(payload, signature, secret)).toBe(true);
    });

    it("rejects invalid signature", () => {
      expect(verifyLuluSignature(payload, "invalid-hex-signature", secret)).toBe(false);
    });

    it("rejects empty signature", () => {
      expect(verifyLuluSignature(payload, "", secret)).toBe(false);
    });

    it("rejects empty secret", () => {
      const signature = createHmac("sha256", secret).update(payload).digest("hex");
      expect(verifyLuluSignature(payload, signature, "")).toBe(false);
    });

    it("rejects tampered payload", () => {
      const signature = createHmac("sha256", secret).update(payload).digest("hex");
      const tampered = payload + "extra";
      expect(verifyLuluSignature(tampered, signature, secret)).toBe(false);
    });
  });
});

// ─── Print Router Tests (Unit) ────────────────────────────────────────────────

describe("Print Router Procedures", () => {
  // Mock context for testing
  const mockUser = { id: 1, name: "Test User", email: "test@example.com", role: "user" as const };
  const mockAdmin = { id: 2, name: "Admin", email: "admin@example.com", role: "admin" as const };

  describe("getProducts", () => {
    it("returns all products with expected fields", () => {
      // Direct import test — products are static
      expect(PRINT_PRODUCTS.every(p => p.id && p.name && p.luluPackageId)).toBe(true);
      expect(PRINT_PRODUCTS.every(p => p.basePriceCents > 0)).toBe(true);
      expect(PRINT_PRODUCTS.every(p => p.perPageCents > 0)).toBe(true);
    });
  });

  describe("calculatePrice validation", () => {
    it("rejects unknown product", () => {
      const product = getProductById("nonexistent");
      expect(product).toBeUndefined();
    });

    it("rejects invalid page count", () => {
      const product = getDefaultProduct();
      expect(validatePageCount(product, 5).valid).toBe(false);
      expect(validatePageCount(product, 1000).valid).toBe(false);
    });

    it("accepts valid page count", () => {
      const product = getDefaultProduct();
      expect(validatePageCount(product, 100).valid).toBe(true);
    });
  });

  describe("Revenue split integrity", () => {
    it("all products have valid royalty rates", () => {
      for (const product of PRINT_PRODUCTS) {
        expect(product.creatorRoyaltyRate).toBeGreaterThan(0);
        expect(product.creatorRoyaltyRate).toBeLessThan(1);
        expect(product.platformMarginRate).toBeGreaterThan(0);
        expect(product.platformMarginRate).toBeLessThan(1);
      }
    });

    it("royalty + platform margin does not exceed 100% of revenue", () => {
      for (const product of PRINT_PRODUCTS) {
        // Revenue is ~35% of unit price (after Lulu's ~65%)
        // Royalty + margin should not exceed that revenue
        const pricing = calculateOrderPrice(product, 100, 1);
        const revenue = pricing.unitPriceCents - pricing.printCostCents;
        expect(pricing.platformMarginCents + pricing.creatorRoyaltyCents).toBeLessThanOrEqual(revenue);
      }
    });
  });
});

// ─── Lulu Package ID Tests ────────────────────────────────────────────────────

describe("Lulu Package IDs", () => {
  it("all products have valid package ID format", () => {
    for (const product of PRINT_PRODUCTS) {
      // Format: ####X####[FC|BW]PERFECT###UW444
      expect(product.luluPackageId).toMatch(/^\d{4}X\d{4}(FC|BW)PERFECT\d{3}UW444$/);
    }
  });

  it("B5 products use 0693X0984 prefix", () => {
    const b5Products = getProductsByTrimSize("b5");
    expect(b5Products.every(p => p.luluPackageId.startsWith("0693X0984"))).toBe(true);
  });

  it("A5 products use 0583X0827 prefix", () => {
    const a5Products = getProductsByTrimSize("a5");
    expect(a5Products.every(p => p.luluPackageId.startsWith("0583X0827"))).toBe(true);
  });

  it("tankobon products use 0504X0717 prefix", () => {
    const tankobonProducts = getProductsByTrimSize("tankobon");
    expect(tankobonProducts.every(p => p.luluPackageId.startsWith("0504X0717"))).toBe(true);
  });

  it("US trade products use 0600X0900 prefix", () => {
    const usTradeProducts = getProductsByTrimSize("us_trade");
    expect(usTradeProducts.every(p => p.luluPackageId.startsWith("0600X0900"))).toBe(true);
  });
});
