/**
 * Stripe Connect Router
 *
 * tRPC procedures for creator Connect onboarding, payout management,
 * and admin payout processing.
 */

import { z } from "zod";
import { router, protectedProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "./db";
import { stripeConnectAccounts, creatorPayouts } from "../drizzle/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import {
  createExpressAccount,
  generateOnboardingLink,
  getAccountStatus,
  executeAutomatedPayout,
  processPendingPayouts,
  migrateToAutomatedPayouts,
} from "./stripe/connect";

// Admin guard
const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
  return next({ ctx });
});

export const connectRouter = router({
  // ─── Creator Procedures ──────────────────────────────────────────────────

  /** Get creator's Connect account status */
  getMyAccount: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

    const [account] = await db
      .select()
      .from(stripeConnectAccounts)
      .where(eq(stripeConnectAccounts.userId, ctx.user.id))
      .limit(1);

    if (!account) {
      return { hasAccount: false as const };
    }

    // Fetch live status from Stripe if onboarding is complete
    let liveStatus = null;
    if (account.onboardingStatus === "complete") {
      try {
        liveStatus = await getAccountStatus(account.stripeAccountId);
      } catch {
        // Stripe API may be unavailable
      }
    }

    return {
      hasAccount: true as const,
      account: {
        id: account.id,
        stripeAccountId: account.stripeAccountId,
        onboardingStatus: account.onboardingStatus,
        chargesEnabled: !!account.chargesEnabled,
        payoutsEnabled: !!account.payoutsEnabled,
        country: account.country,
        defaultCurrency: account.defaultCurrency,
      },
      liveStatus,
    };
  }),

  /** Start Connect onboarding (create Express account) */
  startOnboarding: protectedProcedure
    .input(z.object({
      country: z.string().length(2).optional(),
      origin: z.string().url(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      // Check if already has an account
      const [existing] = await db
        .select()
        .from(stripeConnectAccounts)
        .where(eq(stripeConnectAccounts.userId, ctx.user.id))
        .limit(1);

      if (existing) {
        // If incomplete, generate new onboarding link
        if (existing.onboardingStatus !== "complete") {
          const url = await generateOnboardingLink(
            existing.stripeAccountId,
            ctx.user.id,
            input.origin,
          );
          return { accountId: existing.stripeAccountId, onboardingUrl: url };
        }
        throw new TRPCError({
          code: "CONFLICT",
          message: "You already have a connected account",
        });
      }

      const email = ctx.user.email;
      if (!email) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Email required for Connect onboarding",
        });
      }

      const result = await createExpressAccount({
        userId: ctx.user.id,
        email,
        country: input.country,
      });

      return result;
    }),

  /** Get a fresh onboarding link (for returning to incomplete onboarding) */
  getOnboardingLink: protectedProcedure
    .input(z.object({ origin: z.string().url() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [account] = await db
        .select()
        .from(stripeConnectAccounts)
        .where(eq(stripeConnectAccounts.userId, ctx.user.id))
        .limit(1);

      if (!account) {
        throw new TRPCError({ code: "NOT_FOUND", message: "No Connect account found" });
      }

      if (account.onboardingStatus === "complete") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Onboarding already complete" });
      }

      const url = await generateOnboardingLink(
        account.stripeAccountId,
        ctx.user.id,
        input.origin,
      );

      return { onboardingUrl: url };
    }),

  /** Get creator's Stripe Express dashboard link */
  getDashboardLink: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

    const [account] = await db
      .select()
      .from(stripeConnectAccounts)
      .where(
        and(
          eq(stripeConnectAccounts.userId, ctx.user.id),
          eq(stripeConnectAccounts.onboardingStatus, "complete"),
        ),
      )
      .limit(1);

    if (!account) {
      throw new TRPCError({ code: "NOT_FOUND", message: "No active Connect account" });
    }

    const status = await getAccountStatus(account.stripeAccountId);
    return { dashboardUrl: status.dashboardUrl };
  }),

  /** Get creator's payout history */
  getMyPayouts: protectedProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).default(20),
      offset: z.number().min(0).default(0),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const payouts = await db
        .select()
        .from(creatorPayouts)
        .where(eq(creatorPayouts.creatorUserId, ctx.user.id))
        .orderBy(desc(creatorPayouts.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      const [countResult] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(creatorPayouts)
        .where(eq(creatorPayouts.creatorUserId, ctx.user.id));

      const [totalResult] = await db
        .select({ total: sql<number>`SUM(amount_cents)` })
        .from(creatorPayouts)
        .where(
          and(
            eq(creatorPayouts.creatorUserId, ctx.user.id),
            eq(creatorPayouts.status, "paid"),
          ),
        );

      return {
        payouts,
        total: countResult?.count || 0,
        totalPaidCents: totalResult?.total || 0,
      };
    }),

  // ─── Admin Procedures ────────────────────────────────────────────────────

  /** List all Connect accounts (admin) */
  adminListAccounts: adminProcedure
    .input(z.object({
      status: z.enum(["pending", "incomplete", "complete"]).optional(),
      limit: z.number().min(1).max(100).default(50),
      offset: z.number().min(0).default(0),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      let query = db.select().from(stripeConnectAccounts)
        .orderBy(desc(stripeConnectAccounts.createdAt));

      if (input.status) {
        query = query.where(eq(stripeConnectAccounts.onboardingStatus, input.status)) as typeof query;
      }

      const accounts = await query.limit(input.limit).offset(input.offset);

      const [countResult] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(stripeConnectAccounts);

      return { accounts, total: countResult?.count || 0 };
    }),

  /** Process all pending automated payouts (admin) */
  adminProcessPayouts: adminProcedure.mutation(async () => {
    const result = await processPendingPayouts();
    return result;
  }),

  /** Manually trigger payout for a specific record (admin) */
  adminExecutePayout: adminProcedure
    .input(z.object({ payoutId: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [payout] = await db
        .select()
        .from(creatorPayouts)
        .where(eq(creatorPayouts.id, input.payoutId))
        .limit(1);

      if (!payout) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      if (payout.status === "paid") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Already paid" });
      }

      // Approve if pending
      if (payout.status === "pending") {
        await db.update(creatorPayouts)
          .set({ status: "approved", approvedAt: new Date() })
          .where(eq(creatorPayouts.id, input.payoutId));
      }

      const result = await executeAutomatedPayout({
        payoutId: payout.id,
        creatorUserId: payout.creatorUserId,
        amountCents: payout.amountCents,
        description: `Manual admin payout - Order #${payout.printOrderId}`,
      });

      return result;
    }),

  /** Get payout summary stats (admin) */
  adminPayoutSummary: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

    const [summary] = await db
      .select({
        totalPayouts: sql<number>`COUNT(*)`,
        pendingCount: sql<number>`SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END)`,
        approvedCount: sql<number>`SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END)`,
        paidCount: sql<number>`SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END)`,
        failedCount: sql<number>`SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END)`,
        totalPendingCents: sql<number>`SUM(CASE WHEN status IN ('pending', 'approved') THEN amount_cents ELSE 0 END)`,
        totalPaidCents: sql<number>`SUM(CASE WHEN status = 'paid' THEN amount_cents ELSE 0 END)`,
      })
      .from(creatorPayouts);

    const [connectSummary] = await db
      .select({
        totalAccounts: sql<number>`COUNT(*)`,
        completeAccounts: sql<number>`SUM(CASE WHEN onboarding_status = 'complete' THEN 1 ELSE 0 END)`,
        payoutsEnabledCount: sql<number>`SUM(CASE WHEN payouts_enabled = 1 THEN 1 ELSE 0 END)`,
      })
      .from(stripeConnectAccounts);

    return {
      payouts: {
        total: summary?.totalPayouts || 0,
        pending: summary?.pendingCount || 0,
        approved: summary?.approvedCount || 0,
        paid: summary?.paidCount || 0,
        failed: summary?.failedCount || 0,
        totalPendingUsd: ((summary?.totalPendingCents || 0) / 100).toFixed(2),
        totalPaidUsd: ((summary?.totalPaidCents || 0) / 100).toFixed(2),
      },
      connect: {
        totalAccounts: connectSummary?.totalAccounts || 0,
        completeAccounts: connectSummary?.completeAccounts || 0,
        payoutsEnabled: connectSummary?.payoutsEnabledCount || 0,
      },
    };
  }),

  /** Migrate a creator to automated payouts after onboarding (admin) */
  adminMigrateCreator: adminProcedure
    .input(z.object({ userId: z.number() }))
    .mutation(async ({ input }) => {
      return migrateToAutomatedPayouts(input.userId);
    }),
});
