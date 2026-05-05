/**
 * Founders' Studio — Pipeline Blueprint v1.9 §7C
 *
 * Public "Express Interest" submission + admin triage listing.
 * No open application — primary recruitment is outbound (Playbook 8.2).
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { publicProcedure, protectedProcedure, adminProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import { founderInterest, stripeConnectAccounts } from "../drizzle/schema";
import { eq, desc, sql } from "drizzle-orm";
import { notifyOwner } from "./_core/notification";
import { createExpressAccount, generateOnboardingLink } from "./stripe/connect";

const OUTPUT_TRACKS = ["manga", "genga", "full_anime"] as const;

export const foundersRouter = router({
  /**
   * Public: submit an Express Interest form.
   * Authenticated users get their userId attached; anonymous is allowed.
   */
  submit: publicProcedure
    .input(
      z.object({
        name: z.string().min(1).max(200),
        email: z.string().email().max(320),
        outputTrack: z.enum(OUTPUT_TRACKS),
        portfolioUrl: z.string().url().max(2000),
        genreFocus: z.string().max(200).optional(),
        pitch: z.string().min(20).max(2000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const userId = ctx.user?.id ?? null;

      await db.insert(founderInterest).values({
        userId,
        name: input.name,
        email: input.email,
        outputTrack: input.outputTrack,
        portfolioUrl: input.portfolioUrl,
        genreFocus: input.genreFocus ?? null,
        pitch: input.pitch,
        status: "new",
      });

      // Notify the owner about the new submission
      try {
        await notifyOwner({
          title: "New Founders' Studio Interest",
          content: `${input.name} (${input.email}) — ${input.outputTrack} track\nPortfolio: ${input.portfolioUrl}\n\n${input.pitch.slice(0, 200)}`,
        });
      } catch {
        // Non-blocking — submission is already saved
      }

      return { success: true } as const;
    }),

  /**
   * Admin: list all submissions for triage.
   */
  list: protectedProcedure
    .input(
      z.object({
        status: z.enum(["new", "reviewing", "shortlisted", "contacted", "declined", "all"]).optional().default("all"),
        limit: z.number().int().min(1).max(100).optional().default(50),
        offset: z.number().int().min(0).optional().default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin only" });
      }

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const conditions = input.status !== "all"
        ? eq(founderInterest.status, input.status)
        : undefined;

      const rows = await db
        .select()
        .from(founderInterest)
        .where(conditions)
        .orderBy(desc(founderInterest.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      const [countRow] = await db
        .select({ count: sql<number>`count(*)` })
        .from(founderInterest)
        .where(conditions);

      return {
        items: rows,
        total: countRow?.count ?? 0,
      };
    }),

  /**
   * Admin: update submission status and notes.
   */
  updateStatus: protectedProcedure
    .input(
      z.object({
        id: z.number().int(),
        status: z.enum(["new", "reviewing", "shortlisted", "contacted", "declined"]),
        adminNotes: z.string().max(5000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin only" });
      }

      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      await db
        .update(founderInterest)
        .set({
          status: input.status,
          ...(input.adminNotes !== undefined ? { adminNotes: input.adminNotes } : {}),
        })
        .where(eq(founderInterest.id, input.id));

      return { success: true } as const;
    }),

  /**
   * Admin: Initiate Stripe Connect onboarding for an approved founder.
   * Creates an Express account and returns the onboarding URL.
   * This bridges the gap between admin approval and actual Stripe Connect setup.
   */
  initiateStripeConnectOnboarding: adminProcedure
    .input(z.object({
      founderInterestId: z.number().int(),
      origin: z.string().url(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      // Get the founder interest record
      const [founder] = await db
        .select()
        .from(founderInterest)
        .where(eq(founderInterest.id, input.founderInterestId))
        .limit(1);

      if (!founder) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Founder interest record not found" });
      }

      // Must be shortlisted or contacted to initiate onboarding
      if (!founder.status || !['shortlisted', 'contacted'].includes(founder.status)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot initiate onboarding for status '${founder.status}'. Must be 'shortlisted' or 'contacted'.`,
        });
      }

      // Check if they already have a Connect account (via userId)
      if (founder.userId) {
        const [existing] = await db
          .select()
          .from(stripeConnectAccounts)
          .where(eq(stripeConnectAccounts.userId, founder.userId))
          .limit(1);

        if (existing) {
          // If incomplete, generate a fresh link
          if (existing.onboardingStatus !== 'complete') {
            const url = await generateOnboardingLink(
              existing.stripeAccountId,
              founder.userId,
              input.origin,
            );
            return {
              success: true,
              accountId: existing.stripeAccountId,
              onboardingUrl: url,
              isExisting: true,
              message: "Existing incomplete account — fresh onboarding link generated.",
            };
          }
          throw new TRPCError({
            code: "CONFLICT",
            message: "This founder already has a completed Stripe Connect account.",
          });
        }
      }

      // Create new Express account
      if (!founder.userId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Founder must have a registered user account before Stripe Connect onboarding. Ask them to sign up first.",
        });
      }

      const result = await createExpressAccount({
        userId: founder.userId,
        email: founder.email,
      });

      // Update status to contacted if it was shortlisted
      if (founder.status === 'shortlisted') {
        await db
          .update(founderInterest)
          .set({ status: 'contacted' })
          .where(eq(founderInterest.id, input.founderInterestId));
      }

      return {
        success: true,
        accountId: result.accountId,
        onboardingUrl: result.onboardingUrl,
        isExisting: false,
        message: "Stripe Connect Express account created. Share the onboarding URL with the founder.",
      };
    }),
});
