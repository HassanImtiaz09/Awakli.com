/**
 * Lulu Webhook Handler
 *
 * Handles PRINT_JOB_STATUS_CHANGED events from Lulu's webhook system.
 * Verifies HMAC-SHA256 signature, updates order status, and triggers
 * downstream actions (notifications, payout creation).
 *
 * Wave 5A: Registered at /api/lulu/webhook in server/_core/index.ts
 */

import { createHmac, timingSafeEqual } from "crypto";
import type { Request, Response } from "express";
import {
  getPrintOrderByLuluJobId,
  updatePrintOrderStatus,
  appendWebhookEvent,
  createCreatorPayout,
} from "../../db-print";
import { notifyOwner } from "../../_core/notification";
import type { LuluWebhookEvent, LuluPrintJobStatus } from "./lulu-client";

// ─── Signature Verification ───────────────────────────────────────────────────

/**
 * Verify the Lulu HMAC-SHA256 webhook signature.
 */
export function verifyLuluSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  if (!signature || !secret) return false;

  try {
    const expectedSignature = createHmac("sha256", secret)
      .update(payload)
      .digest("hex");

    return timingSafeEqual(
      Buffer.from(signature, "hex"),
      Buffer.from(expectedSignature, "hex")
    );
  } catch {
    return false;
  }
}

// ─── Status Mapping ───────────────────────────────────────────────────────────

/**
 * Map Lulu print job status to our internal order status.
 */
function mapLuluStatusToOrderStatus(luluStatus: LuluPrintJobStatus): string | null {
  switch (luluStatus) {
    case "CREATED":
    case "UNPAID":
    case "PAYMENT_IN_PROGRESS":
      return "submitted_to_lulu";
    case "PRODUCTION_DELAYED":
    case "PRODUCTION_READY":
    case "IN_PRODUCTION":
      return "production";
    case "SHIPPED":
      return "shipped";
    case "DELIVERED":
      return "delivered";
    case "CANCELLED":
      return "cancelled";
    case "ERROR":
      return "failed";
    default:
      return null;
  }
}

// ─── Webhook Handler ──────────────────────────────────────────────────────────

/**
 * Express handler for Lulu webhook events.
 *
 * Expects raw body (registered before express.json() middleware).
 */
export async function handleLuluWebhook(req: Request, res: Response): Promise<void> {
  const signature = req.headers["lulu-hmac-sha256"] as string | undefined;
  const rawBody = typeof req.body === "string" ? req.body : req.body?.toString("utf-8");

  if (!rawBody) {
    res.status(400).json({ error: "Empty request body" });
    return;
  }

  // Verify signature if webhook secret is configured
  const webhookSecret = process.env.LULU_WEBHOOK_SECRET;
  if (webhookSecret) {
    if (!signature || !verifyLuluSignature(rawBody, signature, webhookSecret)) {
      console.warn("[Lulu Webhook] Invalid signature");
      res.status(401).json({ error: "Invalid signature" });
      return;
    }
  }

  let event: LuluWebhookEvent;
  try {
    event = JSON.parse(rawBody);
  } catch {
    res.status(400).json({ error: "Invalid JSON" });
    return;
  }

  console.log(`[Lulu Webhook] Received event: ${event.topic} for print job ${event.data?.id}`);

  // Handle test events
  if (event.id?.startsWith("test_")) {
    console.log("[Lulu Webhook] Test event detected, returning verification response");
    res.json({ verified: true });
    return;
  }

  // Only handle PRINT_JOB_STATUS_CHANGED
  if (event.topic !== "PRINT_JOB_STATUS_CHANGED") {
    console.log(`[Lulu Webhook] Ignoring topic: ${event.topic}`);
    res.json({ received: true });
    return;
  }

  const luluJobId = event.data?.id?.toString();
  if (!luluJobId) {
    res.status(400).json({ error: "Missing print job ID in event data" });
    return;
  }

  // Find the order
  const order = await getPrintOrderByLuluJobId(luluJobId);
  if (!order) {
    console.warn(`[Lulu Webhook] No order found for Lulu job ID: ${luluJobId}`);
    // Return 200 to prevent retries — order might have been deleted
    res.json({ received: true, warning: "Order not found" });
    return;
  }

  // Map status
  const newStatus = mapLuluStatusToOrderStatus(event.data.status);
  if (!newStatus) {
    console.warn(`[Lulu Webhook] Unknown Lulu status: ${event.data.status}`);
    res.json({ received: true });
    return;
  }

  // Build update extras
  const extras: Record<string, any> = {};

  // Extract tracking info from shipped events
  if (event.data.status === "SHIPPED" && event.data.lineItems?.length) {
    const lineItem = event.data.lineItems[0];
    if (lineItem.trackingId) extras.trackingNumber = lineItem.trackingId;
    if (lineItem.trackingUrls?.length) extras.trackingUrl = lineItem.trackingUrls[0];
    extras.shippedAt = new Date();
  }

  if (event.data.status === "DELIVERED") {
    extras.deliveredAt = new Date();
  }

  if (event.data.status === "ERROR") {
    extras.errorMessage = `Lulu production error (job ${luluJobId})`;
  }

  // Update order status
  await updatePrintOrderStatus(order.id, newStatus as any, extras);

  // Append webhook event to audit log
  await appendWebhookEvent(order.id, {
    eventId: event.id,
    topic: event.topic,
    status: event.data.status,
    timestamp: event.timestamp,
    receivedAt: new Date().toISOString(),
  });

  // Trigger downstream actions
  await handleStatusChange(order.id, newStatus, event.data.status);

  res.json({ received: true, orderId: order.id, newStatus });
}

// ─── Downstream Actions ───────────────────────────────────────────────────────

async function handleStatusChange(
  orderId: number,
  internalStatus: string,
  luluStatus: LuluPrintJobStatus
): Promise<void> {
  const order = await (await import("../../db-print")).getPrintOrderById(orderId);
  if (!order) return;

  switch (luluStatus) {
    case "SHIPPED":
      // Create creator payout record when order ships
      if (order.creatorUserId && order.creatorRoyaltyCents && order.creatorRoyaltyCents > 0) {
        try {
          await createCreatorPayout({
            creatorUserId: order.creatorUserId,
            printOrderId: order.id,
            amountCents: order.creatorRoyaltyCents,
            status: "pending",
          });
          console.log(`[Lulu Webhook] Created payout record: ${order.creatorRoyaltyCents}¢ for creator ${order.creatorUserId}`);
        } catch (err: any) {
          console.error(`[Lulu Webhook] Failed to create payout: ${err.message}`);
        }
      }

      // Notify owner
      await notifyOwner({
        title: "Print Order Shipped",
        content: `Order #${order.id} has shipped. Tracking: ${order.trackingNumber || "pending"}`,
      });
      break;

    case "DELIVERED":
      await notifyOwner({
        title: "Print Order Delivered",
        content: `Order #${order.id} has been delivered.`,
      });
      break;

    case "ERROR":
      await notifyOwner({
        title: "Print Order Failed",
        content: `Order #${order.id} encountered a production error at Lulu. Please check the admin panel.`,
      });
      break;
  }
}
