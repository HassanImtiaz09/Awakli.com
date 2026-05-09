import { z } from "zod";
import { router, protectedProcedure, publicProcedure, adminProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { getStripe } from "./stripe/client";
import { TIERS, CREDIT_COSTS, CREDIT_PACKS, TIER_ORDER, getTierFeatureList, normalizeTier, isUpgrade, isDowngrade, type TierKey } from "./stripe/products";
import {
  getSubscriptionByUserId, upsertSubscription,
  createUsageRecord, getUsageRecordsByUser, getMonthlyUsageSummary,
  createTip, getTipsByCreator, getCreatorEarnings,
  createModerationItem, getModerationQueue, updateModerationItem,
  getAdminMetrics, getAdminUserList, getAllSubscriptions,
} from "./db-phase6";
import { getPlatformConfig, getPlatformConfigMulti, setPlatformConfig, getDb } from "./db";
import { DEMO_CONFIG_KEYS } from "../shared/demo-scenario";
import { generateAllDemoAssets } from "./demo-assets";
import * as cfStream from "./cloudflare-stream";
import {
  getBalance, getLedgerHistory, grantSubscriptionCredits,
  grantPromotionalCredits, adminAdjustment, reconcileBalance,
  releaseStaleHolds, getUsageSummary,
} from "./credit-ledger";
import { creditPacks, subscriptions, creditLedger, creditBalances, usageEvents, episodeCosts, users } from "../drizzle/schema";
import { eq, sql, and, gte, lte, count, sum, desc } from "drizzle-orm";

// ─── Billing Router ────────────────────────────────────────────────────

export const billingRouter = router({
  // Get current user's subscription
  getSubscription: protectedProcedure.query(async ({ ctx }) => {
    const sub = await getSubscriptionByUserId(ctx.user.id);
    if (!sub) {
      return {
        tier: "free_trial" as TierKey,
        status: "active",
        limits: TIERS.free_trial,
        features: getTierFeatureList("free_trial"),
      };
    }
    return {
      ...sub,
      limits: TIERS[sub.tier as TierKey] || TIERS.free_trial,
      features: getTierFeatureList(sub.tier as TierKey || "free_trial"),
    };
  }),

  // Get tier info (public)
  getTiers: publicProcedure.query(() => {
    return Object.entries(TIERS).map(([key, config]) => ({
      key: key as TierKey,
      ...config,
      features: getTierFeatureList(key as TierKey),
    }));
  }),

  // Create checkout session for subscription
  createCheckout: protectedProcedure
    .input(z.object({
      tier: z.enum(["creator", "creator_pro", "studio"]),
      interval: z.enum(["monthly", "annual"]).default("monthly"),
    }))
    .mutation(async ({ ctx, input }) => {
      const stripe = getStripe();
      const tierConfig = TIERS[input.tier];

      // Check for existing subscription (upgrade path)
      const existingSub = await getSubscriptionByUserId(ctx.user.id);
      if (existingSub?.stripeSubscriptionId && existingSub.status === "active") {
        const currentTier = existingSub.tier as TierKey;
        if (isUpgrade(currentTier, input.tier)) {
          // Upgrade: modify existing subscription with proration
          const stripeSub = await stripe.subscriptions.retrieve(existingSub.stripeSubscriptionId);
          // Create a new price for the upgrade tier
          const newPrice = await stripe.prices.create({
            currency: "usd",
            product_data: {
              name: `Awakli ${tierConfig.name}`,
            },
            unit_amount: input.interval === "annual"
              ? Math.round(tierConfig.annualPrice / 12)
              : tierConfig.monthlyPrice,
            recurring: {
              interval: input.interval === "annual" ? "year" : "month",
            },
          });
          await stripe.subscriptions.update(existingSub.stripeSubscriptionId, {
            items: [{
              id: stripeSub.items.data[0].id,
              price: newPrice.id,
            }],
            proration_behavior: "create_prorations",
            metadata: {
              user_id: ctx.user.id.toString(),
              tier: input.tier,
            },
          });
          return { url: null, upgraded: true, newTier: input.tier };
        } else if (isDowngrade(currentTier, input.tier)) {
          // Downgrade: check 30-day cooling-off
          if (existingSub.lastDowngradeAt) {
            const daysSinceLastDowngrade = (Date.now() - new Date(existingSub.lastDowngradeAt).getTime()) / (1000 * 60 * 60 * 24);
            if (daysSinceLastDowngrade < 30) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: `Downgrade cooling-off: please wait ${Math.ceil(30 - daysSinceLastDowngrade)} more days before downgrading again.`,
              });
            }
          }
          // Schedule downgrade at period end
          const stripeSubForDowngrade = await stripe.subscriptions.retrieve(existingSub.stripeSubscriptionId);
          const downgradePrice = await stripe.prices.create({
            currency: "usd",
            product_data: {
              name: `Awakli ${tierConfig.name}`,
            },
            unit_amount: input.interval === "annual"
              ? Math.round(tierConfig.annualPrice / 12)
              : tierConfig.monthlyPrice,
            recurring: {
              interval: input.interval === "annual" ? "year" : "month",
            },
          });
          await stripe.subscriptions.update(existingSub.stripeSubscriptionId, {
            cancel_at_period_end: false,
            items: [{
              id: stripeSubForDowngrade.items.data[0].id,
              price: downgradePrice.id,
            }],
            proration_behavior: "none",
            metadata: {
              user_id: ctx.user.id.toString(),
              tier: input.tier,
            },
          });
          // Record downgrade timestamp
          const db = await getDb();
          if (db) {
            await db.update(subscriptions).set({
              lastDowngradeAt: new Date(),
            }).where(eq(subscriptions.userId, ctx.user.id));
          }
          return { url: null, downgraded: true, newTier: input.tier };
        }
      }

      // New subscription checkout
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        payment_method_types: ["card"],
        allow_promotion_codes: true,
        client_reference_id: ctx.user.id.toString(),
        customer_email: ctx.user.email || undefined,
        metadata: {
          user_id: ctx.user.id.toString(),
          tier: input.tier,
          customer_name: ctx.user.name || "",
          customer_email: ctx.user.email || "",
        },
        line_items: [{
          price_data: {
            currency: "usd",
            product_data: {
              name: `Awakli ${tierConfig.name}`,
              description: `${tierConfig.name} plan - ${input.interval}`,
            },
            unit_amount: input.interval === "annual"
              ? Math.round(tierConfig.annualPrice / 12)
              : tierConfig.monthlyPrice,
            recurring: {
              interval: input.interval === "annual" ? "year" : "month",
            },
          },
          quantity: 1,
        }],
        success_url: `${ctx.req.headers.origin}/studio?checkout=success`,
        cancel_url: `${ctx.req.headers.origin}/pricing?checkout=canceled`,
      });

      return { url: session.url };
    }),

  // Create billing portal session
  createPortal: protectedProcedure.mutation(async ({ ctx }) => {
    const sub = await getSubscriptionByUserId(ctx.user.id);
    if (!sub?.stripeCustomerId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "No active subscription found" });
    }
    const stripe = getStripe();
    const session = await stripe.billingPortal.sessions.create({
      customer: sub.stripeCustomerId,
      return_url: `${ctx.req.headers.origin}/studio`,
    });
    return { url: session.url };
  }),

  // Get credit balance
  getBalance: protectedProcedure.query(async ({ ctx }) => {
    return getBalance(ctx.user.id);
  }),

  // Get ledger history
  getLedgerHistory: protectedProcedure
    .input(z.object({
      limit: z.number().min(1).max(200).default(50),
      offset: z.number().min(0).default(0),
    }).optional())
    .query(async ({ ctx, input }) => {
      return getLedgerHistory(ctx.user.id, input?.limit || 50, input?.offset || 0);
    }),

  // Create credit pack checkout
  createPackCheckout: protectedProcedure
    .input(z.object({
      packSize: z.enum(["small", "medium", "large"]),
    }))
    .mutation(async ({ ctx, input }) => {
      const stripe = getStripe();
      const packConfig = CREDIT_PACKS[input.packSize];
      if (!packConfig) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid pack size" });
      }

      // Check tier-based discount
      const sub = await getSubscriptionByUserId(ctx.user.id);
      const tier = (sub?.tier || "free_trial") as TierKey;
      const tierConfig = TIERS[tier];
      const discountPct = tierConfig.packDiscount;
      const discountedPrice = Math.round(packConfig.basePriceCents * (1 - discountPct));

      // Create Stripe checkout session for one-time payment
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        payment_method_types: ["card"],
        allow_promotion_codes: true,
        client_reference_id: ctx.user.id.toString(),
        customer_email: ctx.user.email || undefined,
        metadata: {
          user_id: ctx.user.id.toString(),
          type: "credit_pack",
          pack_size: input.packSize,
          credits: packConfig.credits.toString(),
          customer_name: ctx.user.name || "",
        },
        line_items: [{
          price_data: {
            currency: "usd",
            product_data: {
              name: `Awakli ${packConfig.name} (${packConfig.credits} credits)`,
              description: discountPct > 0
                ? `${packConfig.credits} credits with ${Math.round(discountPct * 100)}% ${tierConfig.name} discount`
                : `${packConfig.credits} credits`,
            },
            unit_amount: discountedPrice,
          },
          quantity: 1,
        }],
        success_url: `${ctx.req.headers.origin}/studio/billing?pack=success`,
        cancel_url: `${ctx.req.headers.origin}/studio/billing?pack=canceled`,
      });

      // Create pending credit pack record
      const db = await getDb();
      if (db && session.payment_intent) {
        await db.insert(creditPacks).values({
          userId: ctx.user.id,
          stripePaymentIntentId: session.payment_intent as string,
          packSize: input.packSize,
          creditsGranted: packConfig.credits,
          pricePaidCents: discountedPrice,
          appliedDiscountPercentage: String(discountPct),
          status: "pending",
        });
      }

      return { url: session.url };
    }),

  // Get credit packs info (public)
  getCreditPacks: publicProcedure.query(() => {
    return Object.entries(CREDIT_PACKS).map(([key, config]) => ({
      key,
      ...config,
    }));
  }),

  // Get usage summary for current billing period
  getUsageSummary: protectedProcedure.query(async ({ ctx }) => {
    const sub = await getSubscriptionByUserId(ctx.user.id);
    const periodStart = sub?.currentPeriodStart || new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const periodEnd = sub?.currentPeriodEnd || new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0);
    return getUsageSummary(ctx.user.id, periodStart, periodEnd);
  }),
});

// ─── Usage Router ──────────────────────────────────────────────────────

export const usageRouter = router({
  // Get current month usage summary
  getSummary: protectedProcedure.query(async ({ ctx }) => {
    const summary = await getMonthlyUsageSummary(ctx.user.id);
    const sub = await getSubscriptionByUserId(ctx.user.id);
    const tier = (sub?.tier || "free_trial") as TierKey;
    const allocation = TIERS[tier].credits;

    return {
      ...summary,
      allocation,
      tier,
      remaining: Math.max(0, allocation - summary.total),
      percentUsed: allocation > 0 ? Math.min(100, (summary.total / allocation) * 100) : 0,
    };
  }),

  // Get usage history
  getHistory: protectedProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).default(50),
    }).optional())
    .query(async ({ ctx, input }) => {
      const records = await getUsageRecordsByUser(ctx.user.id);
      return records.slice(0, input?.limit || 50);
    }),

  // Record usage (internal, called by other procedures)
  record: protectedProcedure
    .input(z.object({
      actionType: z.enum(["script", "panel", "video", "voice", "lora_train"]),
      projectId: z.number().optional(),
      episodeId: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const credits = CREDIT_COSTS[input.actionType] || 0;

      // Check tier limits
      const sub = await getSubscriptionByUserId(ctx.user.id);
      const tier = (sub?.tier || "free_trial") as TierKey;
      const summary = await getMonthlyUsageSummary(ctx.user.id);
      const allocation = TIERS[tier].credits;

      if (summary.total + credits > allocation && tier === "free_trial") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `Monthly credit limit reached (${allocation} credits). Upgrade to Pro for more.`,
        });
      }

      return createUsageRecord({
        userId: ctx.user.id,
        actionType: input.actionType,
        creditsUsed: credits,
        projectId: input.projectId || null,
        episodeId: input.episodeId || null,
      });
    }),
});

// ─── Creator Marketplace Router ────────────────────────────────────────

export const marketplaceRouter = router({
  // Send a tip
  sendTip: protectedProcedure
    .input(z.object({
      episodeId: z.number(),
      toUserId: z.number(),
      amountCents: z.number().min(100).max(50000),
    }))
    .mutation(async ({ ctx, input }) => {
      const creatorShare = Math.round(input.amountCents * 0.8);
      const platformShare = input.amountCents - creatorShare;

      const tipId = await createTip({
        fromUserId: ctx.user.id,
        toUserId: input.toUserId,
        episodeId: input.episodeId,
        amountCents: input.amountCents,
        creatorShareCents: creatorShare,
        platformShareCents: platformShare,
        status: "completed",
      });

      return { tipId, creatorShare, platformShare };
    }),

  // Get creator earnings
  getEarnings: protectedProcedure.query(async ({ ctx }) => {
    return getCreatorEarnings(ctx.user.id);
  }),

  // Get tips received
  getTips: protectedProcedure.query(async ({ ctx }) => {
    return getTipsByCreator(ctx.user.id);
  }),
});

// ─── Admin Router ──────────────────────────────────────────────────────

export const adminRouter = router({
  // Get admin metrics
  getMetrics: adminProcedure.query(async () => {
    return getAdminMetrics();
  }),

  // Get user list
  getUsers: adminProcedure
    .input(z.object({
      page: z.number().min(1).default(1),
      limit: z.number().min(1).max(100).default(20),
    }).optional())
    .query(async ({ input }) => {
      return getAdminUserList(input?.page || 1, input?.limit || 20);
    }),

  // Get all subscriptions
  getSubscriptions: adminProcedure.query(async () => {
    return getAllSubscriptions();
  }),

  // Get moderation queue
  getModerationQueue: adminProcedure
    .input(z.object({
      status: z.enum(["pending", "approved", "removed", "dismissed"]).default("pending"),
    }).optional())
    .query(async ({ input }) => {
      return getModerationQueue(input?.status || "pending");
    }),

  // Review moderation item
  reviewModeration: adminProcedure
    .input(z.object({
      id: z.number(),
      status: z.enum(["approved", "removed", "dismissed"]),
    }))
    .mutation(async ({ ctx, input }) => {
      await updateModerationItem(input.id, {
        status: input.status,
        reviewedBy: ctx.user.id,
      });
      return { success: true };
    }),

  // Update user role
  updateUserRole: adminProcedure
    .input(z.object({
      userId: z.number(),
      role: z.enum(["user", "admin"]),
    }))
    .mutation(async ({ input }) => {
      const { getDb } = await import("./db");
      const { users } = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      await db.update(users).set({ role: input.role }).where(eq(users.id, input.userId));
      return { success: true };
    }),

  // Get demo video configuration
  getDemoConfig: adminProcedure.query(async () => {
    const keys = Object.values(DEMO_CONFIG_KEYS);
    const config = await getPlatformConfigMulti(keys);
    return {
      panelUrls: config[DEMO_CONFIG_KEYS.PANEL_URLS] ? JSON.parse(config[DEMO_CONFIG_KEYS.PANEL_URLS]) as string[] : [],
      characterUrls: config[DEMO_CONFIG_KEYS.CHARACTER_URLS] ? JSON.parse(config[DEMO_CONFIG_KEYS.CHARACTER_URLS]) as Record<string, string> : {},
      scriptText: config["demo_script_text"] || "",
      fallbackUrls: config[DEMO_CONFIG_KEYS.FALLBACK_URLS] ? JSON.parse(config[DEMO_CONFIG_KEYS.FALLBACK_URLS]) as string[] : [],
      streamId: config[DEMO_CONFIG_KEYS.STREAM_ID] || null,
      posterUrl: config[DEMO_CONFIG_KEYS.POSTER_URL] || null,
      updatedAt: config[DEMO_CONFIG_KEYS.UPDATED_AT] || null,
      status: config[DEMO_CONFIG_KEYS.STATUS] || "not_started",
    };
  }),

  // Regenerate demo assets
  regenerateDemo: adminProcedure.mutation(async () => {
    // Run in background (don't await)
    generateAllDemoAssets().catch((err) => {
      console.error("[Demo] Asset generation failed:", err);
      setPlatformConfig(DEMO_CONFIG_KEYS.STATUS, "failed").catch(() => {});
    });
    return { success: true, message: "Demo asset generation started. Check status via getDemoConfig." };
  }),

  // Upload a video to Cloudflare Stream from a public URL
  uploadDemoVideo: adminProcedure
    .input(z.object({
      videoUrl: z.string().url(),
      waitForReady: z.boolean().default(false),
    }))
    .mutation(async ({ input }) => {
      await setPlatformConfig(DEMO_CONFIG_KEYS.STATUS, "uploading_stream");

      try {
        if (input.waitForReady) {
          // Upload and wait until ready (may take a few minutes)
          const result = await cfStream.uploadAndWait(input.videoUrl, { name: "awakli-demo" }, { timeoutMs: 10 * 60 * 1000 });
          await setPlatformConfig(DEMO_CONFIG_KEYS.STREAM_ID, result.uid);
          await setPlatformConfig("demo_video_embed_url", result.embedUrl);
          await setPlatformConfig(DEMO_CONFIG_KEYS.POSTER_URL, result.thumbnailUrl);
          await setPlatformConfig(DEMO_CONFIG_KEYS.STATUS, "stream_ready");
          await setPlatformConfig(DEMO_CONFIG_KEYS.UPDATED_AT, new Date().toISOString());
          return { success: true, uid: result.uid, embedUrl: result.embedUrl, thumbnailUrl: result.thumbnailUrl };
        } else {
          // Upload and return immediately (poll separately)
          const uploaded = await cfStream.uploadFromUrl(input.videoUrl, { name: "awakli-demo" });
          await setPlatformConfig(DEMO_CONFIG_KEYS.STREAM_ID, uploaded.uid);
          await setPlatformConfig(DEMO_CONFIG_KEYS.STATUS, "stream_processing");
          await setPlatformConfig(DEMO_CONFIG_KEYS.UPDATED_AT, new Date().toISOString());
          return { success: true, uid: uploaded.uid, status: uploaded.status.state };
        }
      } catch (err: any) {
        console.error("[Admin] Demo video upload failed:", err);
        await setPlatformConfig(DEMO_CONFIG_KEYS.STATUS, "stream_failed");
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err.message || "Stream upload failed" });
      }
    }),

  // Check the processing status of a Cloudflare Stream video
  checkStreamStatus: adminProcedure
    .input(z.object({ uid: z.string().optional() }))
    .query(async ({ input }) => {
      const uid = input.uid || await getPlatformConfig(DEMO_CONFIG_KEYS.STREAM_ID);
      if (!uid) return { ready: false, status: "no_video", uid: null };

      try {
        const video = await cfStream.getVideoStatus(uid);
        // If newly ready, update platform config with embed/poster URLs
        if (video.readyToStream) {
          const embedUrl = cfStream.getEmbedUrl(video);
          const thumbnailUrl = cfStream.getThumbnailUrl(video);
          await setPlatformConfig("demo_video_embed_url", embedUrl);
          await setPlatformConfig(DEMO_CONFIG_KEYS.POSTER_URL, thumbnailUrl);
          await setPlatformConfig(DEMO_CONFIG_KEYS.STATUS, "stream_ready");
        }
        return {
          ready: video.readyToStream,
          status: video.status.state,
          uid: video.uid,
          pctComplete: video.status.pctComplete || null,
          duration: video.duration || null,
          embedUrl: video.readyToStream ? cfStream.getEmbedUrl(video) : null,
          thumbnailUrl: video.thumbnail || null,
        };
      } catch (err: any) {
        return { ready: false, status: "error", uid, error: err.message };
      }
    }),

  // List all videos in Cloudflare Stream account
  listStreamVideos: adminProcedure.query(async () => {
    try {
      const videos = await cfStream.listVideos({ perPage: 20 });
      return videos.map((v) => ({
        uid: v.uid,
        name: v.meta?.name || "Untitled",
        ready: v.readyToStream,
        status: v.status.state,
        duration: v.duration || null,
        created: v.created,
        thumbnail: v.thumbnail,
      }));
    } catch (err: any) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err.message || "Failed to list videos" });
    }
  }),

  // ─── Prompt 15: Admin Credit Analytics ──────────────────────────────

  // Issue promotional credits to a user
  issuePromoCredits: adminProcedure
    .input(z.object({
      userId: z.number(),
      amount: z.number().min(1).max(10000),
      reasonCode: z.string().min(1).max(200),
    }))
    .mutation(async ({ ctx, input }) => {
      const result = await grantPromotionalCredits(
        input.userId,
        input.amount,
        input.reasonCode
      );
      return { success: true, ...result };
    }),

  // Admin adjustment (positive or negative)
  adminCreditAdjustment: adminProcedure
    .input(z.object({
      userId: z.number(),
      amount: z.number(),
      reason: z.string().min(1).max(500),
    }))
    .mutation(async ({ ctx, input }) => {
      const result = await adminAdjustment(
        input.userId,
        input.amount,
        input.reason,
        ctx.user.id
      );
      return { success: true, ...result };
    }),

  // Run reconciliation
  runReconciliation: adminProcedure
    .input(z.object({ userId: z.number() }))
    .mutation(async ({ input }) => {
      return reconcileBalance(input.userId);
    }),

  // Release stale holds
  releaseStaleHolds: adminProcedure
    .input(z.object({ userId: z.number() }))
    .mutation(async ({ input }) => {
      return releaseStaleHolds(input.userId);
    }),

  // Get platform-wide credit analytics
  getCreditAnalytics: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    // MRR from active subscriptions
    const [mrrResult] = await db.select({
      totalMrr: sql<number>`COALESCE(SUM(
        CASE
          WHEN ${subscriptions.tier} = 'creator' THEN 2900
          WHEN ${subscriptions.tier} = 'creator_pro' THEN 9900
          WHEN ${subscriptions.tier} = 'studio' THEN 49900
          ELSE 0
        END
      ), 0)`.as("totalMrr"),
      activeCount: count(),
    }).from(subscriptions)
      .where(eq(subscriptions.status, "active"));

    // Credits granted this month
    const [grantsResult] = await db.select({
      totalGranted: sql<number>`COALESCE(SUM(${creditLedger.amountCredits}), 0)`.as("totalGranted"),
    }).from(creditLedger)
      .where(and(
        sql`${creditLedger.transactionType} IN ('grant_subscription', 'grant_pack_purchase', 'grant_promotional')`,
        gte(creditLedger.createdAt, monthStart)
      ));

    // Credits consumed this month
    const [consumedResult] = await db.select({
      totalConsumed: sql<number>`COALESCE(SUM(ABS(${creditLedger.amountCredits})), 0)`.as("totalConsumed"),
    }).from(creditLedger)
      .where(and(
        eq(creditLedger.transactionType, "commit_consumption"),
        gte(creditLedger.createdAt, monthStart)
      ));

    // Pack revenue this month
    const [packRevenue] = await db.select({
      totalPackRevenue: sql<number>`COALESCE(SUM(${creditPacks.pricePaidCents}), 0)`.as("totalPackRevenue"),
      packCount: count(),
    }).from(creditPacks)
      .where(and(
        eq(creditPacks.status, "completed"),
        gte(creditPacks.createdAt, monthStart)
      ));

    // COGS estimate (credits consumed * $0.55 per credit)
    const cogsUsdCents = Math.round((consumedResult?.totalConsumed || 0) * 55);
    const totalRevenueCents = (mrrResult?.totalMrr || 0) + (packRevenue?.totalPackRevenue || 0);
    const marginPct = totalRevenueCents > 0 ? ((totalRevenueCents - cogsUsdCents) / totalRevenueCents * 100) : 0;

    // Tier distribution
    const tierDist = await db.select({
      tier: subscriptions.tier,
      count: count(),
    }).from(subscriptions)
      .where(eq(subscriptions.status, "active"))
      .groupBy(subscriptions.tier);

    // Active holds
    const [holdsResult] = await db.select({
      totalHolds: sql<number>`COALESCE(SUM(${creditBalances.activeHolds}), 0)`.as("totalHolds"),
    }).from(creditBalances);

    return {
      mrr: {
        totalCents: mrrResult?.totalMrr || 0,
        activeSubscriptions: Number(mrrResult?.activeCount) || 0,
      },
      credits: {
        grantedThisMonth: grantsResult?.totalGranted || 0,
        consumedThisMonth: consumedResult?.totalConsumed || 0,
        activeHolds: holdsResult?.totalHolds || 0,
      },
      packs: {
        revenueCents: packRevenue?.totalPackRevenue || 0,
        count: Number(packRevenue?.packCount) || 0,
      },
      economics: {
        totalRevenueCents,
        cogsUsdCents,
        marginPct: Math.round(marginPct * 100) / 100,
        targetMarginPct: 33,
      },
      tierDistribution: tierDist.map(t => ({
        tier: t.tier,
        count: Number(t.count),
      })),
    };
  }),

  // Get per-creator cost breakdown (top consumers)
  getCreatorCostBreakdown: adminProcedure
    .input(z.object({
      limit: z.number().min(1).max(100).default(20),
    }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      // Top consumers by credits used this month
      const topConsumers = await db.select({
        userId: usageEvents.userId,
        totalCredits: sql<number>`COALESCE(SUM(${usageEvents.creditsConsumed}), 0)`.as("totalCredits"),
        totalUsdCents: sql<number>`COALESCE(SUM(${usageEvents.usdCostCents}), 0)`.as("totalUsdCents"),
        callCount: count(),
      }).from(usageEvents)
        .where(gte(usageEvents.createdAt, monthStart))
        .groupBy(usageEvents.userId)
        .orderBy(desc(sql`totalCredits`))
        .limit(input?.limit || 20);

      // Enrich with user info and subscription tier
      const enriched = await Promise.all(topConsumers.map(async (c) => {
        const [user] = await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, c.userId)).limit(1);
        const sub = await getSubscriptionByUserId(c.userId);
        const balance = await getBalance(c.userId);
        return {
          userId: c.userId,
          name: user?.name || "Unknown",
          email: user?.email || "",
          tier: sub?.tier || "free_trial",
          creditsConsumed: c.totalCredits,
          usdCostCents: c.totalUsdCents,
          apiCalls: Number(c.callCount),
          currentBalance: balance.availableBalance,
          cogsEstimateCents: Math.round(c.totalCredits * 55),
        };
      }));

      return enriched;
    }),

  // Get user's detailed credit info (for admin)
  getUserCreditInfo: adminProcedure
    .input(z.object({ userId: z.number() }))
    .query(async ({ input }) => {
      const balance = await getBalance(input.userId);
      const sub = await getSubscriptionByUserId(input.userId);
      const history = await getLedgerHistory(input.userId, 20, 0);

      return {
        balance,
        subscription: sub,
        recentLedger: history,
      };
    }),

  // Delete a video from Cloudflare Stream
  deleteStreamVideo: adminProcedure
    .input(z.object({ uid: z.string() }))
    .mutation(async ({ input }) => {
      try {
        await cfStream.deleteVideo(input.uid);
        // If this was the demo video, clear the config
        const currentStreamId = await getPlatformConfig(DEMO_CONFIG_KEYS.STREAM_ID);
        if (currentStreamId === input.uid) {
          await setPlatformConfig(DEMO_CONFIG_KEYS.STREAM_ID, "");
          await setPlatformConfig("demo_video_embed_url", "");
          await setPlatformConfig(DEMO_CONFIG_KEYS.POSTER_URL, "");
          await setPlatformConfig(DEMO_CONFIG_KEYS.STATUS, "assets_ready");
        }
        return { success: true };
      } catch (err: any) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: err.message || "Failed to delete video" });
      }
    }),

  // ─── Pipeline Observability (Wave 8 Item 2b) ────────────────────────────
  getPipelineObservability: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
    const { pipelineRuns, harnessResults, pipelineStages } = await import("../drizzle/schema");
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Recent pipeline runs (last 7 days)
    const recentRuns = await db.select({
      id: pipelineRuns.id,
      status: pipelineRuns.status,
      progress: pipelineRuns.progress,
      totalCost: pipelineRuns.totalCost,
      currentNode: pipelineRuns.currentNode,
      nodeStatuses: pipelineRuns.nodeStatuses,
      nodeCosts: pipelineRuns.nodeCosts,
      errors: pipelineRuns.errors,
      startedAt: pipelineRuns.startedAt,
      completedAt: pipelineRuns.completedAt,
      createdAt: pipelineRuns.createdAt,
    }).from(pipelineRuns)
      .where(gte(pipelineRuns.createdAt, weekAgo))
      .orderBy(desc(pipelineRuns.createdAt))
      .limit(50);

    // Aggregate stats
    const [stats] = await db.select({
      totalRuns: count(),
      completedRuns: sql<number>`SUM(CASE WHEN ${pipelineRuns.status} = 'completed' THEN 1 ELSE 0 END)`.as("completedRuns"),
      failedRuns: sql<number>`SUM(CASE WHEN ${pipelineRuns.status} = 'failed' THEN 1 ELSE 0 END)`.as("failedRuns"),
      runningRuns: sql<number>`SUM(CASE WHEN ${pipelineRuns.status} = 'running' THEN 1 ELSE 0 END)`.as("runningRuns"),
      avgCostCents: sql<number>`AVG(${pipelineRuns.totalCost})`.as("avgCostCents"),
      totalCostCents: sql<number>`SUM(${pipelineRuns.totalCost})`.as("totalCostCents"),
    }).from(pipelineRuns)
      .where(gte(pipelineRuns.createdAt, weekAgo));

    // Harness layer scores (last 7 days)
    const layerScores = await db.select({
      layer: harnessResults.layer,
      result: harnessResults.result,
      avgScore: sql<number>`AVG(${harnessResults.score})`.as("avgScore"),
      checkCount: count(),
    }).from(harnessResults)
      .where(gte(harnessResults.createdAt, weekAgo))
      .groupBy(harnessResults.layer, harnessResults.result);

    // Error breakdown by node
    const nodeErrors = await db.select({
      currentNode: pipelineRuns.currentNode,
      errorCount: count(),
    }).from(pipelineRuns)
      .where(and(
        eq(pipelineRuns.status, "failed"),
        gte(pipelineRuns.createdAt, weekAgo)
      ))
      .groupBy(pipelineRuns.currentNode);

    // Avg duration for completed runs
    const [durationStats] = await db.select({
      avgDurationMs: sql<number>`AVG(TIMESTAMPDIFF(SECOND, ${pipelineRuns.startedAt}, ${pipelineRuns.completedAt}) * 1000)`.as("avgDurationMs"),
      minDurationMs: sql<number>`MIN(TIMESTAMPDIFF(SECOND, ${pipelineRuns.startedAt}, ${pipelineRuns.completedAt}) * 1000)`.as("minDurationMs"),
      maxDurationMs: sql<number>`MAX(TIMESTAMPDIFF(SECOND, ${pipelineRuns.startedAt}, ${pipelineRuns.completedAt}) * 1000)`.as("maxDurationMs"),
    }).from(pipelineRuns)
      .where(and(
        eq(pipelineRuns.status, "completed"),
        gte(pipelineRuns.createdAt, weekAgo)
      ));

    return {
      recentRuns,
      stats: {
        totalRuns: Number(stats?.totalRuns || 0),
        completedRuns: Number(stats?.completedRuns || 0),
        failedRuns: Number(stats?.failedRuns || 0),
        runningRuns: Number(stats?.runningRuns || 0),
        avgCostCents: Number(stats?.avgCostCents || 0),
        totalCostCents: Number(stats?.totalCostCents || 0),
        successRate: stats?.totalRuns ? (Number(stats.completedRuns || 0) / Number(stats.totalRuns) * 100) : 0,
      },
      layerScores,
      nodeErrors,
      duration: {
        avgMs: Number(durationStats?.avgDurationMs || 0),
        minMs: Number(durationStats?.minDurationMs || 0),
        maxMs: Number(durationStats?.maxDurationMs || 0),
      },
    };
  }),

  // Cost spot-check: compare actual pipeline costs against reference
  getCostSpotCheck: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
    const { pipelineRuns } = await import("../drizzle/schema");

    // Get all completed runs with cost data
    const runs = await db.select({
      id: pipelineRuns.id,
      totalCost: pipelineRuns.totalCost,
      nodeCosts: pipelineRuns.nodeCosts,
      completedAt: pipelineRuns.completedAt,
    }).from(pipelineRuns)
      .where(eq(pipelineRuns.status, "completed"))
      .orderBy(desc(pipelineRuns.completedAt))
      .limit(20);

    // Reference costs from §6 spec (cents)
    const referenceCosts = {
      video_gen: 200,
      voice_gen: 80,
      music_gen: 40,
      assembly: 20,
      total: 340,
    };

    // Compare each run against reference
    const comparisons = runs.map(run => {
      const nodeCosts = (run.nodeCosts as Record<string, number>) || {};
      const actualTotal = run.totalCost || 0;
      const variance = referenceCosts.total > 0
        ? ((actualTotal - referenceCosts.total) / referenceCosts.total * 100)
        : 0;
      return {
        runId: run.id,
        actualCostCents: actualTotal,
        referenceCostCents: referenceCosts.total,
        variancePct: Math.round(variance * 10) / 10,
        withinTolerance: Math.abs(variance) <= 20,
        nodeCosts,
        completedAt: run.completedAt,
      };
    });

    const avgVariance = comparisons.length > 0
      ? comparisons.reduce((sum, c) => sum + c.variancePct, 0) / comparisons.length
      : 0;

    return {
      referenceCosts,
      comparisons,
      avgVariancePct: Math.round(avgVariance * 10) / 10,
      allWithinTolerance: comparisons.every(c => c.withinTolerance),
    };
  }),
});

// ─── Report Content ────────────────────────────────────────────────────

export const reportRouter = router({
  create: protectedProcedure
    .input(z.object({
      contentType: z.enum(["project", "episode", "comment", "panel"]),
      contentId: z.number(),
      reason: z.string().min(1).max(1000),
    }))
    .mutation(async ({ ctx, input }) => {
      return createModerationItem({
        contentType: input.contentType,
        contentId: input.contentId,
        reportedBy: ctx.user.id,
        reason: input.reason,
      });
    }),
});
