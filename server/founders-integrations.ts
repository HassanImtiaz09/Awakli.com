/**
 * Founders' Studio — External Integrations
 *
 * Cal.com scheduling integration for weekly office hours
 * Discord cohort integration for private community management
 *
 * Wave 5C Gap 2a: These were agreed scope but not shipped.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, adminProcedure, protectedProcedure } from "./_core/trpc";
import { createLogger } from "./observability/logger";

const log = createLogger("founders-integrations");

// ─── Cal.com Configuration ──────────────────────────────────────────────────

export interface CalComConfig {
  apiKey: string;
  baseUrl: string;
  eventTypeId: number;  // The "Office Hours" event type
  teamId?: number;
}

function getCalComConfig(): CalComConfig {
  const apiKey = process.env.CALCOM_API_KEY;
  if (!apiKey) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Cal.com API key not configured. Set CALCOM_API_KEY env var.",
    });
  }
  return {
    apiKey,
    baseUrl: process.env.CALCOM_BASE_URL || "https://api.cal.com/v1",
    eventTypeId: parseInt(process.env.CALCOM_OFFICE_HOURS_EVENT_TYPE_ID || "0", 10),
    teamId: process.env.CALCOM_TEAM_ID ? parseInt(process.env.CALCOM_TEAM_ID, 10) : undefined,
  };
}

// ─── Cal.com Types ──────────────────────────────────────────────────────────

export interface CalComBooking {
  id: number;
  uid: string;
  title: string;
  startTime: string;
  endTime: string;
  status: "ACCEPTED" | "PENDING" | "CANCELLED" | "REJECTED";
  attendees: Array<{ email: string; name: string; timeZone: string }>;
  meetingUrl?: string;
}

export interface CalComAvailability {
  date: string;
  slots: Array<{ time: string; available: boolean }>;
}

// ─── Cal.com API Helpers ────────────────────────────────────────────────────

/**
 * Fetch upcoming office hours bookings from Cal.com
 */
export async function getUpcomingOfficeHours(limit = 10): Promise<CalComBooking[]> {
  const config = getCalComConfig();
  const url = new URL(`${config.baseUrl}/bookings`);
  url.searchParams.set("apiKey", config.apiKey);
  url.searchParams.set("eventTypeId", String(config.eventTypeId));
  url.searchParams.set("status", "upcoming");
  url.searchParams.set("limit", String(limit));

  const response = await fetch(url.toString());
  if (!response.ok) {
    const text = await response.text();
    log.error("calcom_fetch_failed", { status: response.status, body: text });
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `Cal.com API error: ${response.status}`,
    });
  }

  const data = await response.json() as { bookings: CalComBooking[] };
  return data.bookings || [];
}

/**
 * Get available slots for the next N days
 */
export async function getAvailableSlots(
  startDate: string,
  endDate: string,
): Promise<CalComAvailability[]> {
  const config = getCalComConfig();
  const url = new URL(`${config.baseUrl}/availability`);
  url.searchParams.set("apiKey", config.apiKey);
  url.searchParams.set("eventTypeId", String(config.eventTypeId));
  url.searchParams.set("startTime", startDate);
  url.searchParams.set("endTime", endDate);

  const response = await fetch(url.toString());
  if (!response.ok) {
    log.error("calcom_availability_failed", { status: response.status });
    return [];
  }

  const data = await response.json() as { availability: CalComAvailability[] };
  return data.availability || [];
}

/**
 * Create a booking for a founder's office hours session
 */
export async function createOfficeHoursBooking(params: {
  creatorName: string;
  creatorEmail: string;
  startTime: string;
  timeZone: string;
  notes?: string;
}): Promise<{ bookingId: number; uid: string; meetingUrl: string }> {
  const config = getCalComConfig();
  const url = new URL(`${config.baseUrl}/bookings`);
  url.searchParams.set("apiKey", config.apiKey);

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      eventTypeId: config.eventTypeId,
      start: params.startTime,
      responses: {
        name: params.creatorName,
        email: params.creatorEmail,
        notes: params.notes || "Weekly office hours session",
      },
      timeZone: params.timeZone,
      language: "en",
      metadata: { source: "awakli_founders_studio" },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    log.error("calcom_booking_failed", { status: response.status, body: text });
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `Failed to create booking: ${response.status}`,
    });
  }

  const booking = await response.json() as CalComBooking & { meetingUrl: string };
  log.info("office_hours_booked", {
    creatorEmail: params.creatorEmail,
    bookingId: booking.id,
    startTime: params.startTime,
  });

  return {
    bookingId: booking.id,
    uid: booking.uid,
    meetingUrl: booking.meetingUrl || "",
  };
}

// ─── Discord Integration ────────────────────────────────────────────────────

export interface DiscordConfig {
  botToken: string;
  guildId: string;
  cohortRoleId: string;
  cohortChannelId: string;
  webhookUrl: string;
}

function getDiscordConfig(): DiscordConfig {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  const guildId = process.env.DISCORD_GUILD_ID;
  const webhookUrl = process.env.DISCORD_COHORT_WEBHOOK_URL;

  if (!botToken || !guildId || !webhookUrl) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Discord integration not fully configured. Set DISCORD_BOT_TOKEN, DISCORD_GUILD_ID, DISCORD_COHORT_WEBHOOK_URL.",
    });
  }

  return {
    botToken,
    guildId,
    cohortRoleId: process.env.DISCORD_COHORT_ROLE_ID || "",
    cohortChannelId: process.env.DISCORD_COHORT_CHANNEL_ID || "",
    webhookUrl,
  };
}

/**
 * Send a message to the cohort Discord channel via webhook
 */
export async function sendCohortMessage(params: {
  content: string;
  username?: string;
  embeds?: Array<{
    title: string;
    description: string;
    color?: number;
    fields?: Array<{ name: string; value: string; inline?: boolean }>;
  }>;
}): Promise<{ success: boolean; messageId?: string }> {
  const config = getDiscordConfig();

  const response = await fetch(`${config.webhookUrl}?wait=true`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content: params.content,
      username: params.username || "Awakli Founders' Studio",
      embeds: params.embeds,
    }),
  });

  if (!response.ok) {
    log.error("discord_webhook_failed", { status: response.status });
    return { success: false };
  }

  const msg = await response.json() as { id: string };
  log.info("discord_message_sent", { messageId: msg.id });
  return { success: true, messageId: msg.id };
}

/**
 * Generate a one-time Discord invite link for a new cohort member
 */
export async function generateCohortInvite(params: {
  maxUses?: number;
  maxAge?: number; // seconds, 0 = never expires
}): Promise<{ inviteUrl: string; code: string }> {
  const config = getDiscordConfig();

  const response = await fetch(
    `https://discord.com/api/v10/channels/${config.cohortChannelId}/invites`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bot ${config.botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        max_uses: params.maxUses || 1,
        max_age: params.maxAge || 604800, // 7 days default
        unique: true,
      }),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    log.error("discord_invite_failed", { status: response.status, body: text });
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `Failed to generate Discord invite: ${response.status}`,
    });
  }

  const invite = await response.json() as { code: string };
  return {
    inviteUrl: `https://discord.gg/${invite.code}`,
    code: invite.code,
  };
}

/**
 * Assign the cohort role to a Discord user (by their Discord user ID)
 */
export async function assignCohortRole(discordUserId: string): Promise<boolean> {
  const config = getDiscordConfig();

  const response = await fetch(
    `https://discord.com/api/v10/guilds/${config.guildId}/members/${discordUserId}/roles/${config.cohortRoleId}`,
    {
      method: "PUT",
      headers: {
        "Authorization": `Bot ${config.botToken}`,
      },
    },
  );

  if (!response.ok && response.status !== 204) {
    log.error("discord_role_assign_failed", { discordUserId, status: response.status });
    return false;
  }

  log.info("discord_role_assigned", { discordUserId });
  return true;
}

// ─── tRPC Router ────────────────────────────────────────────────────────────

export const foundersIntegrationsRouter = router({
  // ── Cal.com: Get upcoming office hours ──────────────────────────────
  getOfficeHours: protectedProcedure
    .query(async () => {
      try {
        const bookings = await getUpcomingOfficeHours(10);
        return {
          configured: true,
          bookings: bookings.map(b => ({
            id: b.id,
            uid: b.uid,
            title: b.title,
            startTime: b.startTime,
            endTime: b.endTime,
            status: b.status,
            attendeeCount: b.attendees.length,
            meetingUrl: b.meetingUrl,
          })),
        };
      } catch (e: any) {
        if (e.code === "INTERNAL_SERVER_ERROR" && e.message?.includes("not configured")) {
          return { configured: false, bookings: [] };
        }
        throw e;
      }
    }),

  // ── Cal.com: Get available slots ────────────────────────────────────
  getAvailableSlots: protectedProcedure
    .input(z.object({
      startDate: z.string(), // ISO date
      endDate: z.string(),   // ISO date
    }))
    .query(async ({ input }) => {
      const slots = await getAvailableSlots(input.startDate, input.endDate);
      return { slots };
    }),

  // ── Cal.com: Book office hours ──────────────────────────────────────
  bookOfficeHours: protectedProcedure
    .input(z.object({
      startTime: z.string(), // ISO datetime
      timeZone: z.string().default("UTC"),
      notes: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const result = await createOfficeHoursBooking({
        creatorName: ctx.user.name || "Founder",
        creatorEmail: ctx.user.email || "",
        startTime: input.startTime,
        timeZone: input.timeZone,
        notes: input.notes,
      });
      return result;
    }),

  // ── Discord: Send cohort announcement ───────────────────────────────
  sendAnnouncement: adminProcedure
    .input(z.object({
      content: z.string().min(1).max(2000),
      title: z.string().max(256).optional(),
      description: z.string().max(4096).optional(),
    }))
    .mutation(async ({ input }) => {
      const embeds = input.title ? [{
        title: input.title,
        description: input.description || "",
        color: 0x9333EA, // Purple accent
      }] : undefined;

      const result = await sendCohortMessage({
        content: input.content,
        embeds,
      });
      return result;
    }),

  // ── Discord: Generate invite for new cohort member ──────────────────
  generateInvite: adminProcedure
    .input(z.object({
      maxUses: z.number().int().min(1).max(10).default(1),
      expiresInDays: z.number().int().min(1).max(30).default(7),
    }))
    .mutation(async ({ input }) => {
      const invite = await generateCohortInvite({
        maxUses: input.maxUses,
        maxAge: input.expiresInDays * 86400,
      });
      return invite;
    }),

  // ── Discord: Assign cohort role ─────────────────────────────────────
  assignRole: adminProcedure
    .input(z.object({
      discordUserId: z.string().min(1).max(30),
    }))
    .mutation(async ({ input }) => {
      const success = await assignCohortRole(input.discordUserId);
      return { success };
    }),

  // ── Admin: Integration status check ─────────────────────────────────
  integrationStatus: adminProcedure
    .query(async () => {
      const calConfigured = !!process.env.CALCOM_API_KEY;
      const discordConfigured = !!(
        process.env.DISCORD_BOT_TOKEN &&
        process.env.DISCORD_GUILD_ID &&
        process.env.DISCORD_COHORT_WEBHOOK_URL
      );

      return {
        calcom: {
          configured: calConfigured,
          eventTypeId: process.env.CALCOM_OFFICE_HOURS_EVENT_TYPE_ID || null,
        },
        discord: {
          configured: discordConfigured,
          guildId: process.env.DISCORD_GUILD_ID || null,
          hasWebhook: !!process.env.DISCORD_COHORT_WEBHOOK_URL,
          hasBot: !!process.env.DISCORD_BOT_TOKEN,
        },
      };
    }),
});
