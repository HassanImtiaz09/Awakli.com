/**
 * Print Order & Creator Payout Database Helpers
 *
 * Wave 5A: Lulu Print Integration
 */

import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { getDb } from "./db";
import { printOrders, creatorPayouts, users, projects } from "../drizzle/schema";
import type { PrintOrder, InsertPrintOrder, CreatorPayout, InsertCreatorPayout } from "../drizzle/schema";

// ─── Print Orders ─────────────────────────────────────────────────────────────

export async function createPrintOrder(data: Omit<InsertPrintOrder, 'id' | 'createdAt' | 'updatedAt'>): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(printOrders).values(data as any);
  return (result as any)[0].insertId;
}

export async function getPrintOrderById(id: number): Promise<PrintOrder | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(printOrders).where(eq(printOrders.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function getPrintOrderByStripeSession(sessionId: string): Promise<PrintOrder | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(printOrders)
    .where(eq(printOrders.stripeCheckoutSessionId, sessionId))
    .limit(1);
  return rows[0] ?? null;
}

export async function getPrintOrderByLuluJobId(luluJobId: string): Promise<PrintOrder | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(printOrders)
    .where(eq(printOrders.luluPrintJobId, luluJobId))
    .limit(1);
  return rows[0] ?? null;
}

export async function getUserPrintOrders(userId: number, limit = 50): Promise<PrintOrder[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(printOrders)
    .where(eq(printOrders.userId, userId))
    .orderBy(desc(printOrders.createdAt))
    .limit(limit);
}

export async function updatePrintOrderStatus(
  id: number,
  status: PrintOrder['status'],
  extra?: Partial<Pick<PrintOrder,
    'stripePaymentIntentId' | 'luluPrintJobId' | 'luluLineItemId' |
    'trackingNumber' | 'trackingUrl' | 'errorMessage' |
    'paidAt' | 'submittedAt' | 'shippedAt' | 'deliveredAt' | 'webhookEvents'
  >>
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(printOrders).set({
    status,
    ...extra,
  } as any).where(eq(printOrders.id, id));
}

export async function appendWebhookEvent(orderId: number, event: unknown): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const order = await getPrintOrderById(orderId);
  if (!order) return;
  const events = Array.isArray(order.webhookEvents) ? order.webhookEvents : [];
  events.push(event);
  await db.update(printOrders).set({ webhookEvents: events } as any).where(eq(printOrders.id, orderId));
}

export async function getAllPrintOrders(options: {
  status?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<{ orders: PrintOrder[]; total: number }> {
  const db = await getDb();
  if (!db) return { orders: [], total: 0 };

  const conditions = [];
  if (options.status) {
    conditions.push(eq(printOrders.status, options.status as any));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [orders, countResult] = await Promise.all([
    db.select().from(printOrders)
      .where(where)
      .orderBy(desc(printOrders.createdAt))
      .limit(options.limit ?? 50)
      .offset(options.offset ?? 0),
    db.select({ count: sql<number>`COUNT(*)` }).from(printOrders).where(where),
  ]);

  return { orders, total: Number(countResult[0]?.count ?? 0) };
}

// ─── Creator Payouts ──────────────────────────────────────────────────────────

export async function createCreatorPayout(data: Omit<InsertCreatorPayout, 'id' | 'createdAt'>): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(creatorPayouts).values(data as any);
  return (result as any)[0].insertId;
}

export async function getCreatorPayoutsByUser(creatorUserId: number): Promise<CreatorPayout[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(creatorPayouts)
    .where(eq(creatorPayouts.creatorUserId, creatorUserId))
    .orderBy(desc(creatorPayouts.createdAt));
}

export async function getPendingPayouts(): Promise<Array<CreatorPayout & { creatorName: string | null; creatorEmail: string | null }>> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({
    payout: creatorPayouts,
    creatorName: users.name,
    creatorEmail: users.email,
  })
    .from(creatorPayouts)
    .innerJoin(users, eq(creatorPayouts.creatorUserId, users.id))
    .where(eq(creatorPayouts.status, 'pending'))
    .orderBy(desc(creatorPayouts.createdAt));

  return rows.map(r => ({
    ...r.payout,
    creatorName: r.creatorName,
    creatorEmail: r.creatorEmail,
  }));
}

export async function getCreatorPayoutSummary(): Promise<Array<{
  creatorUserId: number;
  creatorName: string | null;
  creatorEmail: string | null;
  pendingAmountCents: number;
  paidAmountCents: number;
  pendingCount: number;
}>> {
  const db = await getDb();
  if (!db) return [];

  const rows = await db.select({
    creatorUserId: creatorPayouts.creatorUserId,
    creatorName: users.name,
    creatorEmail: users.email,
    status: creatorPayouts.status,
    totalAmount: sql<number>`SUM(${creatorPayouts.amountCents})`,
    count: sql<number>`COUNT(*)`,
  })
    .from(creatorPayouts)
    .innerJoin(users, eq(creatorPayouts.creatorUserId, users.id))
    .groupBy(creatorPayouts.creatorUserId, creatorPayouts.status, users.name, users.email);

  // Aggregate into per-creator summary
  const summaryMap = new Map<number, {
    creatorUserId: number;
    creatorName: string | null;
    creatorEmail: string | null;
    pendingAmountCents: number;
    paidAmountCents: number;
    pendingCount: number;
  }>();

  for (const row of rows) {
    const existing = summaryMap.get(row.creatorUserId) ?? {
      creatorUserId: row.creatorUserId,
      creatorName: row.creatorName,
      creatorEmail: row.creatorEmail,
      pendingAmountCents: 0,
      paidAmountCents: 0,
      pendingCount: 0,
    };

    if (row.status === 'pending') {
      existing.pendingAmountCents = Number(row.totalAmount);
      existing.pendingCount = Number(row.count);
    } else if (row.status === 'paid') {
      existing.paidAmountCents = Number(row.totalAmount);
    }

    summaryMap.set(row.creatorUserId, existing);
  }

  return Array.from(summaryMap.values());
}

export async function approvePayouts(payoutIds: number[], adminUserId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const result = await db.update(creatorPayouts).set({
    status: 'approved',
    processedByUserId: adminUserId,
    approvedAt: new Date(),
  } as any).where(
    and(
      inArray(creatorPayouts.id, payoutIds),
      eq(creatorPayouts.status, 'pending')
    )
  );
  return (result as any)[0]?.affectedRows ?? 0;
}

export async function markPayoutsPaid(
  payoutIds: number[],
  stripeTransferId: string,
  adminNotes?: string
): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const result = await db.update(creatorPayouts).set({
    status: 'paid',
    stripeTransferId,
    adminNotes,
    paidAt: new Date(),
  } as any).where(
    and(
      inArray(creatorPayouts.id, payoutIds),
      eq(creatorPayouts.status, 'approved')
    )
  );
  return (result as any)[0]?.affectedRows ?? 0;
}
