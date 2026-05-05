/**
 * Stripe Connect Integration Tests
 *
 * Wave 5B Item 4: Tests for Express account creation, onboarding,
 * automated payouts, and Connect webhook handling.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock setup using vi.hoisted to avoid hoisting issues
const { mockStripe, mockDb } = vi.hoisted(() => {
  const mockStripe = {
    accounts: {
      create: vi.fn(),
      retrieve: vi.fn(),
      createLoginLink: vi.fn(),
    },
    accountLinks: {
      create: vi.fn(),
    },
    transfers: {
      create: vi.fn(),
    },
  };

  const mockDb: any = {};
  mockDb.insert = vi.fn(() => mockDb);
  mockDb.values = vi.fn().mockResolvedValue(undefined);
  mockDb.select = vi.fn(() => mockDb);
  mockDb.from = vi.fn(() => mockDb);
  mockDb.where = vi.fn(() => mockDb);
  mockDb.limit = vi.fn().mockResolvedValue([]);
  mockDb.update = vi.fn(() => mockDb);
  mockDb.set = vi.fn(() => mockDb);
  mockDb.orderBy = vi.fn(() => mockDb);

  return { mockStripe, mockDb };
});

vi.mock("./client", () => ({
  getStripe: () => mockStripe,
}));

vi.mock("../db", () => ({
  getDb: vi.fn().mockResolvedValue(mockDb),
}));

vi.mock("../../drizzle/schema", () => ({
  stripeConnectAccounts: { userId: "user_id", stripeAccountId: "stripe_account_id", onboardingStatus: "onboarding_status", payoutsEnabled: "payouts_enabled" },
  creatorPayouts: { id: "id", creatorUserId: "creator_user_id", status: "status", amountCents: "amount_cents", printOrderId: "print_order_id" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a: any, b: any) => ({ field: a, value: b })),
  and: vi.fn((...args: any[]) => ({ type: "and", conditions: args })),
  sql: vi.fn(),
  desc: vi.fn((field: any) => ({ field, direction: "desc" })),
}));

vi.mock("../observability/logger", () => ({
  serverLog: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  createExpressAccount,
  generateOnboardingLink,
  getAccountStatus,
  executeAutomatedPayout,
  processPendingPayouts,
  handleConnectWebhookEvent,
  migrateToAutomatedPayouts,
} from "./connect";

describe("Stripe Connect: createExpressAccount()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.insert.mockReturnThis();
    mockDb.values.mockResolvedValue(undefined);
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.limit.mockResolvedValue([]);
  });

  it("should create an Express account with correct parameters", async () => {
    mockStripe.accounts.create.mockResolvedValue({ id: "acct_test123" });
    mockStripe.accountLinks.create.mockResolvedValue({ url: "https://connect.stripe.com/setup/test" });

    const result = await createExpressAccount({
      userId: 42,
      email: "creator@example.com",
      country: "JP",
    });

    expect(mockStripe.accounts.create).toHaveBeenCalledWith({
      type: "express",
      email: "creator@example.com",
      country: "JP",
      capabilities: { transfers: { requested: true } },
      metadata: { awakli_user_id: "42" },
    });
    expect(result.accountId).toBe("acct_test123");
    expect(result.onboardingUrl).toBe("https://connect.stripe.com/setup/test");
  });

  it("should default to US country when not specified", async () => {
    mockStripe.accounts.create.mockResolvedValue({ id: "acct_us" });
    mockStripe.accountLinks.create.mockResolvedValue({ url: "https://connect.stripe.com/setup/us" });

    await createExpressAccount({
      userId: 1,
      email: "test@test.com",
    });

    expect(mockStripe.accounts.create).toHaveBeenCalledWith(
      expect.objectContaining({ country: "US" }),
    );
  });

  it("should save account to database", async () => {
    mockStripe.accounts.create.mockResolvedValue({ id: "acct_db" });
    mockStripe.accountLinks.create.mockResolvedValue({ url: "https://connect.stripe.com/setup/db" });

    await createExpressAccount({
      userId: 99,
      email: "db@test.com",
      country: "GB",
    });

    expect(mockDb.insert).toHaveBeenCalled();
    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 99,
        stripeAccountId: "acct_db",
        accountType: "express",
        onboardingStatus: "pending",
        country: "GB",
      }),
    );
  });
});

describe("Stripe Connect: generateOnboardingLink()", () => {
  it("should create an account link with correct URLs", async () => {
    mockStripe.accountLinks.create.mockResolvedValue({
      url: "https://connect.stripe.com/setup/link123",
    });

    const url = await generateOnboardingLink("acct_test", 1, "https://myapp.com");

    expect(mockStripe.accountLinks.create).toHaveBeenCalledWith({
      account: "acct_test",
      refresh_url: "https://myapp.com/studio/payouts?refresh=true",
      return_url: "https://myapp.com/studio/payouts?onboarding=complete",
      type: "account_onboarding",
    });
    expect(url).toBe("https://connect.stripe.com/setup/link123");
  });

  it("should use default base URL when origin not provided", async () => {
    mockStripe.accountLinks.create.mockResolvedValue({ url: "https://link" });

    await generateOnboardingLink("acct_test", 1);

    expect(mockStripe.accountLinks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        refresh_url: expect.stringContaining("/studio/payouts?refresh=true"),
      }),
    );
  });
});

describe("Stripe Connect: getAccountStatus()", () => {
  it("should return complete status for fully onboarded account", async () => {
    mockStripe.accounts.retrieve.mockResolvedValue({
      id: "acct_complete",
      details_submitted: true,
      charges_enabled: true,
      payouts_enabled: true,
      country: "US",
      default_currency: "usd",
      requirements: { currently_due: [] },
    });
    mockStripe.accounts.createLoginLink.mockResolvedValue({
      url: "https://dashboard.stripe.com/login",
    });

    const status = await getAccountStatus("acct_complete");

    expect(status.onboardingComplete).toBe(true);
    expect(status.chargesEnabled).toBe(true);
    expect(status.payoutsEnabled).toBe(true);
    expect(status.country).toBe("US");
    expect(status.dashboardUrl).toBe("https://dashboard.stripe.com/login");
    expect(status.requiresAction).toBe(false);
  });

  it("should return incomplete status when details not submitted", async () => {
    mockStripe.accounts.retrieve.mockResolvedValue({
      id: "acct_incomplete",
      details_submitted: false,
      charges_enabled: false,
      payouts_enabled: false,
      country: "JP",
      default_currency: "jpy",
      requirements: { currently_due: ["individual.verification.document"] },
    });

    const status = await getAccountStatus("acct_incomplete");

    expect(status.onboardingComplete).toBe(false);
    expect(status.requiresAction).toBe(true);
    expect(status.dashboardUrl).toBeNull();
  });
});

describe("Stripe Connect: executeAutomatedPayout()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-establish the chain after clearAllMocks
    mockDb.insert.mockReturnValue(mockDb);
    mockDb.select.mockReturnValue(mockDb);
    mockDb.from.mockReturnValue(mockDb);
    mockDb.where.mockReturnValue(mockDb);
    mockDb.limit.mockResolvedValue([]);
    mockDb.update.mockReturnValue(mockDb);
    mockDb.set.mockReturnValue(mockDb);
    mockDb.orderBy.mockReturnValue(mockDb);
  });

  it("should execute transfer to creator's Connect account", async () => {
    mockDb.limit.mockResolvedValueOnce([{
      stripeAccountId: "acct_creator",
      defaultCurrency: "usd",
      payoutsEnabled: 1,
    }]);
    mockStripe.transfers.create.mockResolvedValue({ id: "tr_test123" });

    const result = await executeAutomatedPayout({
      payoutId: 1,
      creatorUserId: 42,
      amountCents: 5000,
      description: "Test payout",
    });

    expect(result.success).toBe(true);
    expect(result.transferId).toBe("tr_test123");
    expect(mockStripe.transfers.create).toHaveBeenCalledWith({
      amount: 5000,
      currency: "usd",
      destination: "acct_creator",
      description: "Test payout",
      metadata: {
        payout_id: "1",
        creator_user_id: "42",
      },
    });
  });

  it("should fail when creator has no Connect account", async () => {
    mockDb.limit.mockResolvedValueOnce([]);

    const result = await executeAutomatedPayout({
      payoutId: 1,
      creatorUserId: 99,
      amountCents: 1000,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("no active Connect account");
  });

  it("should handle Stripe transfer failure gracefully", async () => {
    mockDb.limit.mockResolvedValueOnce([{
      stripeAccountId: "acct_fail",
      defaultCurrency: "usd",
      payoutsEnabled: 1,
    }]);
    mockStripe.transfers.create.mockRejectedValue(new Error("Insufficient funds"));

    const result = await executeAutomatedPayout({
      payoutId: 2,
      creatorUserId: 42,
      amountCents: 100000,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Insufficient funds");
  });
});

describe("Stripe Connect: handleConnectWebhookEvent()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.update.mockReturnThis();
    mockDb.set.mockReturnThis();
    mockDb.where.mockResolvedValue(undefined);
  });

  it("should update account on account.updated event", async () => {
    await handleConnectWebhookEvent({
      type: "account.updated",
      data: {
        object: {
          id: "acct_updated",
          details_submitted: true,
          charges_enabled: true,
          payouts_enabled: true,
          country: "US",
          default_currency: "usd",
        },
      },
    });

    expect(mockDb.update).toHaveBeenCalled();
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({
        onboardingStatus: "complete",
        chargesEnabled: 1,
        payoutsEnabled: 1,
      }),
    );
  });

  it("should set incomplete status when details submitted but charges not enabled", async () => {
    await handleConnectWebhookEvent({
      type: "account.updated",
      data: {
        object: {
          id: "acct_partial",
          details_submitted: true,
          charges_enabled: false,
          payouts_enabled: false,
          country: "JP",
          default_currency: "jpy",
        },
      },
    });

    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({
        onboardingStatus: "incomplete",
        chargesEnabled: 0,
        payoutsEnabled: 0,
      }),
    );
  });

  it("should handle account.application.deauthorized event", async () => {
    await handleConnectWebhookEvent({
      type: "account.application.deauthorized",
      data: {
        object: { id: "acct_deauth" },
      },
    });

    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({
        onboardingStatus: "pending",
        chargesEnabled: 0,
        payoutsEnabled: 0,
      }),
    );
  });

  it("should handle payout.paid event without error", async () => {
    await expect(
      handleConnectWebhookEvent({
        type: "payout.paid",
        data: {
          object: {
            id: "po_paid",
            amount: 5000,
            currency: "usd",
            destination: "ba_123",
          },
        },
      }),
    ).resolves.not.toThrow();
  });

  it("should handle payout.failed event without error", async () => {
    await expect(
      handleConnectWebhookEvent({
        type: "payout.failed",
        data: {
          object: {
            id: "po_failed",
            failure_code: "account_closed",
            failure_message: "Bank account closed",
          },
        },
      }),
    ).resolves.not.toThrow();
  });
});

describe("Stripe Connect: migrateToAutomatedPayouts()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.insert.mockReturnValue(mockDb);
    mockDb.select.mockReturnValue(mockDb);
    mockDb.from.mockReturnValue(mockDb);
    mockDb.where.mockReturnValue(mockDb);
    mockDb.limit.mockResolvedValue([]);
    mockDb.update.mockReturnValue(mockDb);
    mockDb.set.mockReturnValue(mockDb);
    mockDb.orderBy.mockReturnValue(mockDb);
  });

  it("should auto-approve pending payouts for migrated creator", async () => {
    mockDb.where.mockResolvedValueOnce([
      { id: 1, amountCents: 2500, status: "pending" },
      { id: 2, amountCents: 3000, status: "pending" },
    ]);
    mockDb.where.mockResolvedValueOnce(undefined); // update result

    const result = await migrateToAutomatedPayouts(42);

    expect(result.migratedCount).toBe(2);
    expect(result.totalOwed).toBe(5500);
  });

  it("should return zero counts when no pending payouts exist", async () => {
    mockDb.where.mockResolvedValueOnce([]);

    const result = await migrateToAutomatedPayouts(99);

    expect(result.migratedCount).toBe(0);
    expect(result.totalOwed).toBe(0);
  });
});

describe("Stripe Connect: processPendingPayouts()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.insert.mockReturnValue(mockDb);
    mockDb.select.mockReturnValue(mockDb);
    mockDb.from.mockReturnValue(mockDb);
    mockDb.where.mockReturnValue(mockDb);
    mockDb.limit.mockResolvedValue([]);
    mockDb.update.mockReturnValue(mockDb);
    mockDb.set.mockReturnValue(mockDb);
    mockDb.orderBy.mockReturnValue(mockDb);
  });

  it("should skip payouts for creators without Connect accounts", async () => {
    // First call: get approved payouts
    mockDb.where.mockResolvedValueOnce([
      { id: 1, creatorUserId: 10, amountCents: 1000, printOrderId: 1 },
    ]);
    // Second call: check Connect account — none found
    mockDb.limit.mockResolvedValueOnce([]);

    const result = await processPendingPayouts();

    expect(result.skipped).toBe(1);
    expect(result.succeeded).toBe(0);
  });

  it("should process payouts for creators with active Connect accounts", async () => {
    // The flow is: db.select().from().where() → awaited as pendingPayouts (array)
    // Then inside loop: db.select().from().where().limit(1) → awaited as [connectAccount]
    // Then executeAutomatedPayout also does db.select().from().where().limit(1)
    
    // First where() resolves to array of pending payouts (no .limit() call)
    mockDb.where
      .mockResolvedValueOnce([
        { id: 1, creatorUserId: 10, amountCents: 2000, printOrderId: 5 },
      ])
    // Second where() (inside loop, has .limit): return chain object
      .mockReturnValueOnce({ limit: vi.fn().mockResolvedValue([{
        stripeAccountId: "acct_active",
        defaultCurrency: "usd",
        payoutsEnabled: 1,
        onboardingStatus: "complete",
      }]) } as any)
    // Third where() (inside executeAutomatedPayout, has .limit): return chain object
      .mockReturnValueOnce({ limit: vi.fn().mockResolvedValue([{
        stripeAccountId: "acct_active",
        defaultCurrency: "usd",
        payoutsEnabled: 1,
        onboardingStatus: "complete",
      }]) } as any)
    // Remaining where() calls (updates): return mockDb for chaining
      .mockReturnValue(mockDb);
    mockStripe.transfers.create.mockResolvedValue({ id: "tr_batch1" });

    const result = await processPendingPayouts();

    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(0);
  });
});
