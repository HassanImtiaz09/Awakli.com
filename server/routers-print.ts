/**
 * Print Order Router — tRPC procedures for Lulu print integration
 *
 * Wave 5A: Stripe checkout for print orders, order management,
 * admin payout workflow.
 */

import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { getStripe } from "./stripe/client";
import {
  PRINT_PRODUCTS,
  getDefaultProduct,
  getProductById,
  calculateOrderPrice,
  validatePageCount,
  getShippingOptions,
} from "./benchmarks/lulu/print-products";
import {
  createPrintOrder,
  getPrintOrderById,
  getUserPrintOrders,
  updatePrintOrderStatus,
  getAllPrintOrders,
  getPendingPayouts,
  getCreatorPayoutSummary,
  approvePayouts,
  markPayoutsPaid,
  createCreatorPayout,
  getCreatorPayoutsByUser,
} from "./db-print";
import { getLuluClient } from "./benchmarks/lulu/lulu-client";
import { getDb } from "./db";
import { projects } from "../drizzle/schema";
import { eq } from "drizzle-orm";

// ─── Print Order Router ───────────────────────────────────────────────────────

export const printRouter = router({
  // Get available print products
  getProducts: protectedProcedure.query(() => {
    return PRINT_PRODUCTS.map(p => ({
      id: p.id,
      name: p.name,
      trimSize: p.trimSize,
      trimLabel: p.trimLabel,
      dimensionsMm: p.dimensionsMm,
      colorInterior: p.colorInterior,
      bindingType: p.bindingType,
      basePriceCents: p.basePriceCents,
      perPageCents: p.perPageCents,
      minPages: p.minPages,
      maxPages: p.maxPages,
      isDefault: p.isDefault,
      description: p.description,
    }));
  }),

  // Get shipping options
  getShippingOptions: protectedProcedure.query(() => {
    return getShippingOptions();
  }),

  // Calculate price for a print order
  calculatePrice: protectedProcedure
    .input(z.object({
      productId: z.string(),
      pageCount: z.number().int().positive(),
      quantity: z.number().int().positive().default(1),
    }))
    .query(({ input }) => {
      const product = getProductById(input.productId);
      if (!product) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Product not found" });
      }

      const validation = validatePageCount(product, input.pageCount);
      if (!validation.valid) {
        throw new TRPCError({ code: "BAD_REQUEST", message: validation.error });
      }

      return calculateOrderPrice(product, input.pageCount, input.quantity);
    }),

  // Create a print order and Stripe checkout session
  createCheckout: protectedProcedure
    .input(z.object({
      projectId: z.number().int(),
      episodeId: z.number().int().optional(),
      productId: z.string(),
      pageCount: z.number().int().positive(),
      quantity: z.number().int().positive().default(1),
      shippingMethod: z.enum(["MAIL", "GROUND", "EXPEDITED", "EXPRESS"]).default("MAIL"),
    }))
    .mutation(async ({ ctx, input }) => {
      const product = getProductById(input.productId);
      if (!product) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Product not found" });
      }

      const validation = validatePageCount(product, input.pageCount);
      if (!validation.valid) {
        throw new TRPCError({ code: "BAD_REQUEST", message: validation.error });
      }

      // Verify project exists and user owns it or it's public
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });

      const [project] = await db.select().from(projects)
        .where(eq(projects.id, input.projectId))
        .limit(1);

      if (!project) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
      }

      // Calculate pricing
      const pricing = calculateOrderPrice(product, input.pageCount, input.quantity);
      const shippingOptions = getShippingOptions();
      const shipping = shippingOptions.find(s => s.method === input.shippingMethod)!;
      const totalWithShipping = pricing.totalPriceCents + shipping.baseCostCents;

      // Create print order record
      const orderId = await createPrintOrder({
        userId: ctx.user.id,
        projectId: input.projectId,
        episodeId: input.episodeId ?? null,
        status: 'payment_pending',
        trimSize: product.trimSize,
        pageCount: input.pageCount,
        luluPackageId: product.luluPackageId,
        totalPriceCents: totalWithShipping,
        printCostCents: pricing.printCostCents,
        platformMarginCents: pricing.platformMarginCents,
        creatorRoyaltyCents: pricing.creatorRoyaltyCents,
        creatorUserId: project.userId,
        shippingMethod: input.shippingMethod,
        shippingCostCents: shipping.baseCostCents,
        quantity: input.quantity,
      });

      // Create Stripe checkout session
      const stripe = getStripe();
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        payment_method_types: ["card"],
        allow_promotion_codes: true,
        client_reference_id: ctx.user.id.toString(),
        customer_email: ctx.user.email || undefined,
        metadata: {
          user_id: ctx.user.id.toString(),
          order_id: orderId.toString(),
          order_type: "print",
          product_id: input.productId,
          project_id: input.projectId.toString(),
          customer_name: ctx.user.name || "",
          customer_email: ctx.user.email || "",
        },
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: `${product.name} — ${project.title}`,
                description: `${input.pageCount} pages, ${product.trimLabel}, ${product.bindingType === 'PERFECT' ? 'Perfect Bound' : 'Saddle-Stitch'}`,
              },
              unit_amount: pricing.unitPriceCents,
            },
            quantity: input.quantity,
          },
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: `Shipping (${shipping.label})`,
                description: shipping.estimatedDays,
              },
              unit_amount: shipping.baseCostCents,
            },
            quantity: 1,
          },
        ],
        shipping_address_collection: {
          allowed_countries: [
            'US', 'CA', 'GB', 'DE', 'FR', 'JP', 'AU', 'NZ', 'IT', 'ES',
            'NL', 'BE', 'AT', 'CH', 'SE', 'NO', 'DK', 'FI', 'IE', 'PT',
            'SG', 'HK', 'KR', 'TW', 'IN', 'BR', 'MX', 'PL', 'CZ',
          ],
        },
        success_url: `${ctx.req.headers.origin}/studio/orders/${orderId}?checkout=success`,
        cancel_url: `${ctx.req.headers.origin}/studio/orders?checkout=canceled`,
      });

      // Update order with Stripe session ID
      await updatePrintOrderStatus(orderId, 'payment_pending', {
        stripeCheckoutSessionId: session.id!,
      } as any);

      return { url: session.url, orderId };
    }),

  // Get user's print orders
  getMyOrders: protectedProcedure
    .input(z.object({ limit: z.number().int().positive().default(50) }).optional())
    .query(async ({ ctx, input }) => {
      return getUserPrintOrders(ctx.user.id, input?.limit ?? 50);
    }),

  // Get a specific order
  getOrder: protectedProcedure
    .input(z.object({ orderId: z.number().int() }))
    .query(async ({ ctx, input }) => {
      const order = await getPrintOrderById(input.orderId);
      if (!order) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });
      }
      // Users can only see their own orders (admins can see all)
      if (order.userId !== ctx.user.id && ctx.user.role !== 'admin') {
        throw new TRPCError({ code: "FORBIDDEN", message: "Access denied" });
      }
      return order;
    }),

  // Get creator's payout history
  getMyPayouts: protectedProcedure.query(async ({ ctx }) => {
    return getCreatorPayoutsByUser(ctx.user.id);
  }),
});

// ─── Admin Print Router ───────────────────────────────────────────────────────

export const adminPrintRouter = router({
  // Get all print orders (admin)
  getAllOrders: adminProcedure
    .input(z.object({
      status: z.string().optional(),
      limit: z.number().int().positive().default(50),
      offset: z.number().int().min(0).default(0),
    }).optional())
    .query(async ({ input }) => {
      return getAllPrintOrders({
        status: input?.status,
        limit: input?.limit ?? 50,
        offset: input?.offset ?? 0,
      });
    }),

  // Get payout summary (admin)
  getPayoutSummary: adminProcedure.query(async () => {
    return getCreatorPayoutSummary();
  }),

  // Get pending payouts (admin)
  getPendingPayouts: adminProcedure.query(async () => {
    return getPendingPayouts();
  }),

  // Approve payouts (admin)
  approvePayouts: adminProcedure
    .input(z.object({
      payoutIds: z.array(z.number().int()),
    }))
    .mutation(async ({ ctx, input }) => {
      const count = await approvePayouts(input.payoutIds, ctx.user.id);
      return { approved: count };
    }),

  // Mark payouts as paid (admin — manual Stripe transfer)
  markPaid: adminProcedure
    .input(z.object({
      payoutIds: z.array(z.number().int()),
      stripeTransferId: z.string().min(1),
      adminNotes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const count = await markPayoutsPaid(
        input.payoutIds,
        input.stripeTransferId,
        input.adminNotes
      );
      return { paid: count };
    }),

  // Submit order to Lulu (admin — manual trigger after payment confirmed)
  submitToLulu: adminProcedure
    .input(z.object({ orderId: z.number().int() }))
    .mutation(async ({ input }) => {
      const order = await getPrintOrderById(input.orderId);
      if (!order) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });
      }
      if (order.status !== 'paid') {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Order status is '${order.status}', expected 'paid'` });
      }
      if (!order.interiorPdfUrl || !order.coverPdfUrl) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Interior and cover PDFs must be uploaded before submitting to Lulu" });
      }

      const luluClient = getLuluClient();
      if (!luluClient) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Lulu API credentials not configured" });
      }

      const shippingAddress = order.shippingAddress as any;
      if (!shippingAddress) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Shipping address not set" });
      }

      try {
        const printJob = await luluClient.createPrintJob({
          shippingAddress: {
            name: shippingAddress.name,
            street1: shippingAddress.line1 || shippingAddress.street1,
            street2: shippingAddress.line2 || shippingAddress.street2,
            city: shippingAddress.city,
            stateCode: shippingAddress.state,
            countryCode: shippingAddress.country,
            postcode: shippingAddress.postal_code || shippingAddress.postcode,
          },
          shippingLevel: (order.shippingMethod as any) || 'MAIL',
          lineItems: [{
            title: `Order #${order.id}`,
            cover: order.coverPdfUrl!,
            interior: order.interiorPdfUrl!,
            podPackageId: order.luluPackageId!,
            quantity: order.quantity,
          }],
          externalId: order.id.toString(),
          contactEmail: shippingAddress.email || '',
        });

        await updatePrintOrderStatus(order.id, 'submitted_to_lulu', {
          luluPrintJobId: printJob.id.toString(),
          luluLineItemId: printJob.lineItems[0]?.id?.toString(),
          submittedAt: new Date(),
        });

        return { success: true, luluPrintJobId: printJob.id };
      } catch (err: any) {
        await updatePrintOrderStatus(order.id, 'failed', {
          errorMessage: err.message,
        });
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Lulu submission failed: ${err.message}`,
        });
      }
    }),

  // Update order status manually (admin)
  updateOrderStatus: adminProcedure
    .input(z.object({
      orderId: z.number().int(),
      status: z.enum(["created", "payment_pending", "paid", "submitted_to_lulu", "production", "shipped", "delivered", "failed", "cancelled", "refunded"]),
      trackingNumber: z.string().optional(),
      trackingUrl: z.string().optional(),
      errorMessage: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const order = await getPrintOrderById(input.orderId);
      if (!order) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });
      }

      const extra: any = {};
      if (input.trackingNumber) extra.trackingNumber = input.trackingNumber;
      if (input.trackingUrl) extra.trackingUrl = input.trackingUrl;
      if (input.errorMessage) extra.errorMessage = input.errorMessage;
      if (input.status === 'shipped') extra.shippedAt = new Date();
      if (input.status === 'delivered') extra.deliveredAt = new Date();

      await updatePrintOrderStatus(input.orderId, input.status, extra);
      return { success: true };
    }),
});
