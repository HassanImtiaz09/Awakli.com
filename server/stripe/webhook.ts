import { Request, Response } from "express";
import { getStripe } from "./client";
import { ENV } from "../_core/env";
import { getDb } from "../db";
import { subscriptions, stripeEventsLog, creditPacks } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import { normalizeTier, TIERS, CREDIT_PACKS, isUpgrade, isDowngrade, type TierKey } from "./products";
import { grantSubscriptionCredits, grantPackCredits, processRollover, getBalance, refundCredits } from "../credit-ledger";
import { stripeLog } from "../observability/logger";
import { handleConnectWebhookEvent } from "./connect";

// ─── Event Deduplication ─────────────────────────────────────────────

async function isEventProcessed(stripeEventId: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const existing = await db.select().from(stripeEventsLog)
    .where(eq(stripeEventsLog.stripeEventId, stripeEventId)).limit(1);
  return existing.length > 0;
}

async function logEvent(stripeEventId: string, eventType: string, payload: any): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    await db.insert(stripeEventsLog).values({
      stripeEventId,
      eventType,
      payload,
    });
  } catch (err: any) {
    // Duplicate key = already processed, safe to ignore
    if (err.code === "ER_DUP_ENTRY") return;
    throw err;
  }
}

// ─── Subscription Defaults Helper ────────────────────────────────────

function getSubscriptionDefaults(tier: TierKey) {
  const config = TIERS[tier];
  return {
    monthlyCreditGrant: config.credits,
    rolloverPercentage: String(config.rolloverPercentage),
    rolloverCap: config.rolloverCap,
    episodeLengthCapSeconds: config.episodeLengthCapSeconds,
    allowedModelTiers: config.allowedModelTiers,
    concurrentGenerationLimit: config.concurrentGenerationLimit,
    teamSeats: config.teamSeats,
    queuePriority: config.queuePriority,
  };
}

// ─── Main Webhook Handler ────────────────────────────────────────────

export async function handleStripeWebhook(req: Request, res: Response) {
  const stripe = getStripe();
  const sig = req.headers["stripe-signature"] as string;

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      ENV.stripeWebhookSecret
    );
  } catch (err: any) {
    stripeLog.error("Signature verification failed", { error: err.message });
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle test events
  if (event.id.startsWith("evt_test_")) {
    stripeLog.info("Test event detected, returning verification response");
    return res.json({ verified: true });
  }

  stripeLog.info("Received event", { type: event.type, eventId: event.id });

  // ── Idempotency check ──
  if (await isEventProcessed(event.id)) {
    stripeLog.info("Event already processed, skipping", { eventId: event.id });
    return res.json({ received: true, deduplicated: true });
  }

  try {
    switch (event.type) {
      // ── Subscription Created ──
      case "customer.subscription.created": {
        const sub = event.data.object as any;
        const db = await getDb();
        if (!db) break;

        const customerId = sub.customer as string;
        // Find user by existing stripe customer ID or metadata
        const metadata = sub.metadata || {};
        const userId = parseInt(metadata.user_id || "0");
        if (!userId) {
          stripeLog.warn("No user_id in subscription metadata");
          break;
        }

        const tier = normalizeTier(metadata.tier || "creator");
        const defaults = getSubscriptionDefaults(tier);
        const interval = sub.items?.data?.[0]?.price?.recurring?.interval;

        const existing = await db.select().from(subscriptions)
          .where(eq(subscriptions.userId, userId)).limit(1);

        if (existing.length > 0) {
          await db.update(subscriptions).set({
            tier,
            stripeCustomerId: customerId,
            stripeSubscriptionId: sub.id,
            status: sub.status === "trialing" ? "trialing" : "active",
            billingInterval: interval === "year" ? "annual" : "monthly",
            currentPeriodStart: new Date(sub.current_period_start * 1000),
            currentPeriodEnd: new Date(sub.current_period_end * 1000),
            ...defaults,
          }).where(eq(subscriptions.userId, userId));
        } else {
          await db.insert(subscriptions).values({
            userId,
            tier,
            stripeCustomerId: customerId,
            stripeSubscriptionId: sub.id,
            status: sub.status === "trialing" ? "trialing" : "active",
            billingInterval: interval === "year" ? "annual" : "monthly",
            currentPeriodStart: new Date(sub.current_period_start * 1000),
            currentPeriodEnd: new Date(sub.current_period_end * 1000),
            ...defaults,
          });
        }
        stripeLog.info("Subscription created", { userId, tier });
        break;
      }

      // ── Checkout Completed ──
      case "checkout.session.completed": {
        const session = event.data.object as any;
        const userId = parseInt(session.metadata?.user_id || session.client_reference_id || "0");
        const customerId = session.customer as string;
        const subscriptionId = session.subscription as string;

        if (userId && subscriptionId) {
          const db = await getDb();
          if (db) {
            const sub = await stripe.subscriptions.retrieve(subscriptionId);
            const interval = sub.items.data[0]?.price?.recurring?.interval;
            const tier = normalizeTier(session.metadata?.tier || "creator");
            const defaults = getSubscriptionDefaults(tier);

            const existing = await db.select().from(subscriptions)
              .where(eq(subscriptions.userId, userId)).limit(1);

            if (existing.length > 0) {
              await db.update(subscriptions).set({
                tier,
                stripeCustomerId: customerId,
                stripeSubscriptionId: subscriptionId,
                status: "active",
                billingInterval: interval === "year" ? "annual" : "monthly",
                currentPeriodStart: new Date((sub as any).current_period_start * 1000),
                currentPeriodEnd: new Date((sub as any).current_period_end * 1000),
                ...defaults,
              }).where(eq(subscriptions.userId, userId));
            } else {
              await db.insert(subscriptions).values({
                userId,
                tier,
                stripeCustomerId: customerId,
                stripeSubscriptionId: subscriptionId,
                status: "active",
                billingInterval: interval === "year" ? "annual" : "monthly",
                currentPeriodStart: new Date((sub as any).current_period_start * 1000),
                currentPeriodEnd: new Date((sub as any).current_period_end * 1000),
                ...defaults,
              });
            }
            stripeLog.info("Checkout completed", { userId, tier });
          }
        }
        break;
      }

      // ── Subscription Updated (tier change, status change) ──
      case "customer.subscription.updated": {
        const sub = event.data.object as any;
        const db = await getDb();
        if (!db) break;

        const subId = sub.id as string;
        const status = sub.status;
        const cancelAtPeriodEnd = sub.cancel_at_period_end ? 1 : 0;

        // Determine if tier changed
        const metadata = sub.metadata || {};
        const tierUpdate: Record<string, any> = {
          status: status === "active" ? "active" :
                  status === "past_due" ? "past_due" :
                  status === "canceled" ? "canceled" :
                  status === "trialing" ? "trialing" :
                  status === "paused" ? "paused" : "incomplete",
          cancelAtPeriodEnd,
          currentPeriodStart: new Date(sub.current_period_start * 1000),
          currentPeriodEnd: new Date(sub.current_period_end * 1000),
        };

        // If tier metadata changed, update tier and its defaults
        if (metadata.tier) {
          const newTier = normalizeTier(metadata.tier);
          const defaults = getSubscriptionDefaults(newTier);
          Object.assign(tierUpdate, { tier: newTier, ...defaults });
        }

        await db.update(subscriptions).set(tierUpdate)
          .where(eq(subscriptions.stripeSubscriptionId, subId));

        stripeLog.info("Subscription updated", { subId, status });
        break;
      }

      // ── Subscription Deleted ──
      case "customer.subscription.deleted": {
        const sub = event.data.object as any;
        const db = await getDb();
        if (!db) break;

        const defaults = getSubscriptionDefaults("free_trial");
        await db.update(subscriptions).set({
          tier: "free_trial",
          status: "canceled",
          stripeSubscriptionId: null,
          ...defaults,
        }).where(eq(subscriptions.stripeSubscriptionId, sub.id));

        stripeLog.info("Subscription deleted", { subId: sub.id });
        break;
      }

      // ── Invoice Payment Succeeded (monthly credit grant trigger) ──
      case "invoice.payment_succeeded": {
        const invoice = event.data.object as any;
        const db = await getDb();
        if (!db || !invoice.subscription) break;

        // Update subscription status to active
        await db.update(subscriptions).set({
          status: "active",
        }).where(eq(subscriptions.stripeSubscriptionId, invoice.subscription));

        // Find the subscription to get userId and tier
        const [subRecord] = await db.select().from(subscriptions)
          .where(eq(subscriptions.stripeSubscriptionId, invoice.subscription)).limit(1);

        if (subRecord) {
          const tier = subRecord.tier as TierKey;
          const tierConfig = TIERS[tier];

          // Process rollover from previous period before granting new credits
          await processRollover(subRecord.userId);

          // Grant monthly credits via ledger
          const periodLabel = new Date(invoice.period_start * 1000).toISOString().slice(0, 7);
          await grantSubscriptionCredits(
            subRecord.userId,
            tierConfig.credits,
            periodLabel
          );

          stripeLog.info("Invoice paid, credits granted", { userId: subRecord.userId, credits: tierConfig.credits, tier });
        }
        break;
      }

      // ── Invoice Payment Failed (dunning) ──
      case "invoice.payment_failed": {
        const invoice = event.data.object as any;
        const db = await getDb();
        if (!db || !invoice.subscription) break;

        await db.update(subscriptions).set({
          status: "past_due",
        }).where(eq(subscriptions.stripeSubscriptionId, invoice.subscription));
        stripeLog.warn("Payment failed for subscription", { subscriptionId: invoice.subscription });
        break;
      }

      // ── Payment Intent Succeeded (credit pack purchase) ──
      case "payment_intent.succeeded": {
        const pi = event.data.object as any;
        const db = await getDb();
        if (!db) break;

        const metadata = pi.metadata || {};
        if (metadata.type === "credit_pack") {
          // Find the credit pack record
          const [pack] = await db.select().from(creditPacks)
            .where(eq(creditPacks.stripePaymentIntentId, pi.id)).limit(1);

          if (pack && pack.status !== "completed") {
            // Update credit pack status
            await db.update(creditPacks).set({
              status: "completed",
            }).where(eq(creditPacks.stripePaymentIntentId, pi.id));

            // Grant credits via ledger
            const { ledgerEntryId } = await grantPackCredits(
              pack.userId,
              pack.creditsGranted,
              pack.id,
              pi.id
            );

            // Link ledger entry back to pack
            await db.update(creditPacks).set({
              ledgerEntryId,
            }).where(eq(creditPacks.id, pack.id));

            stripeLog.info("Credit pack fulfilled", { userId: pack.userId, credits: pack.creditsGranted });
          }
        }
        break;
      }

      // ── Payment Intent Failed (credit pack) ──
      case "payment_intent.payment_failed": {
        const pi = event.data.object as any;
        const db = await getDb();
        if (!db) break;

        const metadata = pi.metadata || {};
        if (metadata.type === "credit_pack") {
          await db.update(creditPacks).set({
            status: "failed",
          }).where(eq(creditPacks.stripePaymentIntentId, pi.id));

          stripeLog.warn("Credit pack payment failed", { paymentIntentId: pi.id });
        }
        break;
      }

      // ── Charge Disputed (freeze account + revoke credits) ──
      case "charge.dispute.created": {
        const dispute = event.data.object as any;
        const db = await getDb();
        if (db) {
          const customerId = dispute.customer;
          if (customerId) {
            const [sub] = await db.select().from(subscriptions)
              .where(eq(subscriptions.stripeCustomerId, customerId)).limit(1);
            if (sub) {
              const balance = await getBalance(sub.userId);
              if (balance.availableBalance > 0) {
                await refundCredits(
                  sub.userId,
                  -balance.availableBalance,
                  `Account frozen: dispute ${dispute.id}`,
                );
              }
              stripeLog.warn("DISPUTE: Froze user and revoked credits", { userId: sub.userId, revokedCredits: balance.availableBalance });
            }
          }
        }
        stripeLog.warn("DISPUTE created", { disputeId: dispute.id, chargeId: dispute.charge });
        break;
      }

      // ── Charge Refunded (H-3: proportional credit reversal) ──
      case "charge.refunded": {
        const charge = event.data.object as any;
        const db = await getDb();
        if (!db) break;

        const refundedAmountCents = charge.amount_refunded ?? 0;
        const totalAmountCents = charge.amount ?? 1;
        const refundRatio = refundedAmountCents / totalAmountCents;

        const paymentIntentId = charge.payment_intent;
        if (paymentIntentId) {
          const [pack] = await db.select().from(creditPacks)
            .where(eq(creditPacks.stripePaymentIntentId, paymentIntentId)).limit(1);
          if (pack && pack.status === "completed") {
            const creditsToRevoke = Math.ceil(pack.creditsGranted * refundRatio);
            const currentBalance = await getBalance(pack.userId);
            const safeRevoke = Math.min(creditsToRevoke, currentBalance.availableBalance);
            if (safeRevoke > 0) {
              await refundCredits(
                pack.userId,
                -safeRevoke,
                `Refund reversal for charge ${charge.id} (${(refundRatio * 100).toFixed(0)}% of ${pack.creditsGranted} credits)`,
              );
            }
            await db.update(creditPacks).set({
              status: "refunded" as any,
            }).where(eq(creditPacks.id, pack.id));
            stripeLog.info("Charge refunded, credits revoked", { chargeId: charge.id, revokedCredits: safeRevoke, userId: pack.userId });
          }
        }
        break;
      }

      // ── Stripe Connect Events ──
      case "account.updated":
      case "payout.paid":
      case "payout.failed":
      case "account.application.deauthorized": {
        await handleConnectWebhookEvent(event);
        break;
      }

      default:
        stripeLog.info("Unhandled event type", { type: event.type });
    }

    // Log event as processed (idempotency)
    await logEvent(event.id, event.type, { id: event.id, type: event.type });

  } catch (err: any) {
    stripeLog.error(`Error processing event`, { type: event.type, error: err.message });
    // Still log the event to prevent infinite retries on permanent failures
    await logEvent(event.id, event.type, { id: event.id, type: event.type, error: err.message });
  }

  res.json({ received: true });
}
