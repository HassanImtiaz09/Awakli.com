/**
 * Stripe Connect Integration
 *
 * Handles Express account creation, onboarding links, automated payouts,
 * and Connect webhook events.
 *
 * Wave 5B Item 4: Replaces manual payout workflow with automated transfers.
 */

import { getStripe } from "./client";
import { getDb } from "../db";
import { stripeConnectAccounts, creatorPayouts } from "../../drizzle/schema";
import { eq, and, sql } from "drizzle-orm";
import { serverLog } from "../observability/logger";

// ─── Express Account Creation ───────────────────────────────────────────────

export interface CreateConnectAccountParams {
  userId: number;
  email: string;
  country?: string;
}

/**
 * Create a Stripe Express account for a creator.
 * Returns the account ID for storage.
 */
export async function createExpressAccount(params: CreateConnectAccountParams): Promise<{
  accountId: string;
  onboardingUrl: string;
}> {
  const stripe = getStripe();

  const account = await stripe.accounts.create({
    type: "express",
    email: params.email,
    country: params.country || "US",
    capabilities: {
      transfers: { requested: true },
    },
    metadata: {
      awakli_user_id: params.userId.toString(),
    },
  });

  // Save to DB
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  await db.insert(stripeConnectAccounts).values({
    userId: params.userId,
    stripeAccountId: account.id,
    accountType: "express",
    onboardingStatus: "pending",
    country: params.country || "US",
  });

  // Generate onboarding link
  const onboardingUrl = await generateOnboardingLink(account.id, params.userId);

  serverLog.info("[Connect] Express account created", {
    userId: params.userId,
    accountId: account.id,
  });

  return { accountId: account.id, onboardingUrl };
}

// ─── Onboarding Link Generation ────────────────────────────────────────────

/**
 * Generate an Account Link for onboarding (or re-onboarding).
 */
export async function generateOnboardingLink(
  stripeAccountId: string,
  userId: number,
  origin?: string,
): Promise<string> {
  const stripe = getStripe();
  const baseUrl = origin || process.env.APP_URL || "https://awakli.manus.space";

  const accountLink = await stripe.accountLinks.create({
    account: stripeAccountId,
    refresh_url: `${baseUrl}/studio/payouts?refresh=true`,
    return_url: `${baseUrl}/studio/payouts?onboarding=complete`,
    type: "account_onboarding",
  });

  return accountLink.url;
}

// ─── Account Status Check ───────────────────────────────────────────────────

export interface ConnectAccountStatus {
  accountId: string;
  onboardingComplete: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  country: string | null;
  defaultCurrency: string | null;
  requiresAction: boolean;
  dashboardUrl: string | null;
}

/**
 * Check the current status of a Connect account from Stripe.
 */
export async function getAccountStatus(stripeAccountId: string): Promise<ConnectAccountStatus> {
  const stripe = getStripe();
  const account = await stripe.accounts.retrieve(stripeAccountId);

  const onboardingComplete = !!(account.details_submitted && account.charges_enabled);

  // Generate login link for Express accounts
  let dashboardUrl: string | null = null;
  if (onboardingComplete) {
    try {
      const loginLink = await stripe.accounts.createLoginLink(stripeAccountId);
      dashboardUrl = loginLink.url;
    } catch {
      // Login link may fail if account is restricted
    }
  }

  return {
    accountId: stripeAccountId,
    onboardingComplete,
    chargesEnabled: account.charges_enabled || false,
    payoutsEnabled: account.payouts_enabled || false,
    country: account.country || null,
    defaultCurrency: account.default_currency || null,
    requiresAction: !!(account.requirements?.currently_due?.length),
    dashboardUrl,
  };
}

// ─── Automated Payout (Transfer) ────────────────────────────────────────────

export interface PayoutTransferParams {
  payoutId: number;
  creatorUserId: number;
  amountCents: number;
  description?: string;
}

/**
 * Execute an automated transfer to a creator's Connect account.
 * Updates the creator_payouts record with the transfer ID.
 */
export async function executeAutomatedPayout(params: PayoutTransferParams): Promise<{
  success: boolean;
  transferId?: string;
  error?: string;
}> {
  const db = await getDb();
  if (!db) return { success: false, error: "Database unavailable" };

  // Get creator's Connect account
  const [connectAccount] = await db
    .select()
    .from(stripeConnectAccounts)
    .where(
      and(
        eq(stripeConnectAccounts.userId, params.creatorUserId),
        eq(stripeConnectAccounts.onboardingStatus, "complete"),
        eq(stripeConnectAccounts.payoutsEnabled, 1),
      ),
    )
    .limit(1);

  if (!connectAccount) {
    return {
      success: false,
      error: "Creator has no active Connect account with payouts enabled",
    };
  }

  try {
    const stripe = getStripe();
    const transfer = await stripe.transfers.create({
      amount: params.amountCents,
      currency: connectAccount.defaultCurrency || "usd",
      destination: connectAccount.stripeAccountId,
      description: params.description || `Awakli creator payout #${params.payoutId}`,
      metadata: {
        payout_id: params.payoutId.toString(),
        creator_user_id: params.creatorUserId.toString(),
      },
    });

    // Update payout record
    await db.update(creatorPayouts)
      .set({
        status: "paid",
        stripeTransferId: transfer.id,
        paidAt: new Date(),
      })
      .where(eq(creatorPayouts.id, params.payoutId));

    serverLog.info("[Connect] Automated payout executed", {
      payoutId: params.payoutId,
      transferId: transfer.id,
      amountCents: params.amountCents,
      creatorUserId: params.creatorUserId,
    });

    return { success: true, transferId: transfer.id };
  } catch (error: any) {
    serverLog.error("[Connect] Payout transfer failed", {
      payoutId: params.payoutId,
      error: error.message,
    });

    // Mark payout as failed
    await db.update(creatorPayouts)
      .set({ status: "failed", adminNotes: `Transfer failed: ${error.message}` })
      .where(eq(creatorPayouts.id, params.payoutId));

    return { success: false, error: error.message };
  }
}

// ─── Batch Payout Processing ────────────────────────────────────────────────

/**
 * Process all approved payouts that haven't been paid yet.
 * Only processes payouts for creators with active Connect accounts.
 */
export async function processPendingPayouts(): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
}> {
  const db = await getDb();
  if (!db) return { processed: 0, succeeded: 0, failed: 0, skipped: 0 };

  // Get all approved but unpaid payouts
  const pendingPayouts = await db
    .select()
    .from(creatorPayouts)
    .where(eq(creatorPayouts.status, "approved"));

  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  for (const payout of pendingPayouts) {
    // Check if creator has Connect account
    const [connectAccount] = await db
      .select()
      .from(stripeConnectAccounts)
      .where(
        and(
          eq(stripeConnectAccounts.userId, payout.creatorUserId),
          eq(stripeConnectAccounts.payoutsEnabled, 1),
        ),
      )
      .limit(1);

    if (!connectAccount) {
      skipped++;
      continue;
    }

    const result = await executeAutomatedPayout({
      payoutId: payout.id,
      creatorUserId: payout.creatorUserId,
      amountCents: payout.amountCents,
      description: `Print royalty payout - Order #${payout.printOrderId}`,
    });

    if (result.success) {
      succeeded++;
    } else {
      failed++;
    }
  }

  serverLog.info("[Connect] Batch payout processing complete", {
    processed: pendingPayouts.length,
    succeeded,
    failed,
    skipped,
  });

  return { processed: pendingPayouts.length, succeeded, failed, skipped };
}

// ─── Connect Webhook Handler ────────────────────────────────────────────────

/**
 * Handle Stripe Connect webhook events.
 * Called from the webhook route handler.
 */
export async function handleConnectWebhookEvent(event: any): Promise<void> {
  const db = await getDb();
  if (!db) return;

  switch (event.type) {
    case "account.updated": {
      const account = event.data.object;
      const stripeAccountId = account.id;

      // Determine onboarding status
      let onboardingStatus: "pending" | "incomplete" | "complete" = "pending";
      if (account.details_submitted && account.charges_enabled) {
        onboardingStatus = "complete";
      } else if (account.details_submitted) {
        onboardingStatus = "incomplete";
      }

      await db.update(stripeConnectAccounts)
        .set({
          onboardingStatus,
          chargesEnabled: account.charges_enabled ? 1 : 0,
          payoutsEnabled: account.payouts_enabled ? 1 : 0,
          country: account.country || null,
          defaultCurrency: account.default_currency || null,
        })
        .where(eq(stripeConnectAccounts.stripeAccountId, stripeAccountId));

      serverLog.info("[Connect] Account updated via webhook", {
        stripeAccountId,
        onboardingStatus,
        chargesEnabled: account.charges_enabled,
        payoutsEnabled: account.payouts_enabled,
      });
      break;
    }

    case "payout.paid": {
      // A payout to the creator's bank has been completed
      const payout = event.data.object;
      serverLog.info("[Connect] Payout to bank completed", {
        payoutId: payout.id,
        amount: payout.amount,
        currency: payout.currency,
        destination: payout.destination,
      });
      break;
    }

    case "payout.failed": {
      const payout = event.data.object;
      serverLog.error("[Connect] Payout to bank failed", {
        payoutId: payout.id,
        failureCode: payout.failure_code,
        failureMessage: payout.failure_message,
      });
      break;
    }

    case "account.application.deauthorized": {
      // Creator disconnected their account
      const account = event.data.object;
      await db.update(stripeConnectAccounts)
        .set({
          onboardingStatus: "pending",
          chargesEnabled: 0,
          payoutsEnabled: 0,
        })
        .where(eq(stripeConnectAccounts.stripeAccountId, account.id));

      serverLog.warn("[Connect] Account deauthorized", { accountId: account.id });
      break;
    }

    default:
      serverLog.debug("[Connect] Unhandled event type", { type: event.type });
  }
}

// ─── Migration Helper ───────────────────────────────────────────────────────

/**
 * Migrate a creator from manual payouts to automated Connect payouts.
 * Call after a creator completes Connect onboarding.
 */
export async function migrateToAutomatedPayouts(userId: number): Promise<{
  migratedCount: number;
  totalOwed: number;
}> {
  const db = await getDb();
  if (!db) return { migratedCount: 0, totalOwed: 0 };

  // Get all pending manual payouts for this creator
  const pendingPayouts = await db
    .select()
    .from(creatorPayouts)
    .where(
      and(
        eq(creatorPayouts.creatorUserId, userId),
        eq(creatorPayouts.status, "pending"),
      ),
    );

  // Auto-approve them for automated processing
  if (pendingPayouts.length > 0) {
    await db.update(creatorPayouts)
      .set({ status: "approved" })
      .where(
        and(
          eq(creatorPayouts.creatorUserId, userId),
          eq(creatorPayouts.status, "pending"),
        ),
      );
  }

  const totalOwed = pendingPayouts.reduce((sum, p) => sum + p.amountCents, 0);

  serverLog.info("[Connect] Migrated to automated payouts", {
    userId,
    migratedCount: pendingPayouts.length,
    totalOwedCents: totalOwed,
  });

  return { migratedCount: pendingPayouts.length, totalOwed };
}
