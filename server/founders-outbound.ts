/**
 * Founders' Studio Outbound Infrastructure (Wave 5C Item 4)
 *
 * Provides:
 * - Outreach automation: draft personalized messages from creator profiles
 * - Per-creator tracking (outreach status, source, genres, episodes, blockers)
 * - Admin review/send interface for outreach messages
 * - Cohort management (onboarding → active → churned)
 *
 * Primary recruitment is outbound (Playbook 8.2).
 * Express Interest page captures inbound for triage (not promoted as primary).
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, router } from "./_core/trpc";
import { createLogger } from "./observability/logger";

const log = createLogger("founders-outbound");

// ─── Types ──────────────────────────────────────────────────────────────────────

export const OUTREACH_STATUSES = [
  "identified",      // Found on platform, not yet contacted
  "draft_ready",     // Outreach message drafted, pending admin review
  "contacted",       // Message sent
  "responded",       // Creator replied
  "onboarding",      // In onboarding process
  "active",          // Active in Founders' Studio
  "paused",          // Temporarily paused
  "churned",         // Left the program
  "declined",        // Declined to participate
] as const;

export type OutreachStatus = typeof OUTREACH_STATUSES[number];

export const SOURCE_PLATFORMS = [
  "twitter",
  "artstation",
  "pixiv",
  "deviantart",
  "instagram",
  "youtube",
  "tiktok",
  "webtoon",
  "tapas",
  "personal_site",
  "referral",
  "inbound",         // From Express Interest form
] as const;

export type SourcePlatform = typeof SOURCE_PLATFORMS[number];

export interface CreatorProfile {
  id: number;
  name: string;
  email?: string;
  sourcePlatform: SourcePlatform;
  profileUrl: string;
  followerCount?: number;
  genres: string[];
  artStyle?: string;
  outreachStatus: OutreachStatus;
  outreachMessage?: string;
  outreachSentAt?: Date;
  responseNotes?: string;
  episodesCommitted: number;
  episodesDelivered: number;
  currentBlocker?: string;
  rlhfDataContributed: number;
  revenueAccruedCents: number;
  stripeConnectId?: string;
  discordUsername?: string;
  onboardedAt?: Date;
  lastActiveAt?: Date;
  adminNotes?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface OutreachDraft {
  creatorId: number;
  platform: SourcePlatform;
  subject: string;
  body: string;
  personalizationNotes: string;
  tone: "casual" | "professional" | "enthusiastic";
  generatedAt: Date;
}

// ─── Outreach Message Templates ─────────────────────────────────────────────────

export const MESSAGE_TEMPLATES: Record<SourcePlatform, string> = {
  twitter: `Hey {{name}}! 👋 I've been following your work and love your {{artStyle}} style. We're building Awakli — an AI platform that turns manga/comics into animated episodes. We're inviting a small cohort of creators for our Founders' Studio (free access, revenue share, direct input on the product). Would love to chat if you're interested! No pressure either way.`,
  artstation: `Hi {{name}}, I came across your portfolio on ArtStation and was really impressed by your {{artStyle}} work, especially your {{genres}} pieces. I'm reaching out from Awakli — we're building an AI-powered manga-to-anime pipeline and are assembling a small Founders' Studio cohort. As a founding creator, you'd get free platform access, 90% revenue share, and direct influence on product development. Would you be open to a quick chat?`,
  pixiv: `{{name}}さん、はじめまして！Pixivで作品を拝見し、{{artStyle}}のスタイルに感銘を受けました。Awakliという漫画→アニメのAIプラットフォームを開発中で、Founders' Studioの初期メンバーを募集しています。ご興味があれば、詳細をお伝えできればと思います。`,
  deviantart: `Hi {{name}}! I've been admiring your {{artStyle}} work on DeviantArt. We're building something that might interest you — Awakli is an AI platform that helps creators turn their manga/comics into animated episodes. We're looking for founding creators to join our studio program (free access + revenue share). Interested in learning more?`,
  instagram: `Hey {{name}}! 🎨 Love your {{artStyle}} content. Quick question — have you ever thought about turning your art into animated episodes? We're building an AI tool that does exactly that, and we're inviting a few creators to try it first (free, with revenue share). DM me if curious!`,
  youtube: `Hi {{name}}, I've been watching your content and really enjoy your {{genres}} work. We're building Awakli — an AI platform that helps creators produce animated episodes from manga/storyboards. We're assembling a small Founders' Studio cohort with free access and revenue share. Would love to tell you more if you're interested!`,
  tiktok: `Hey {{name}}! 🔥 Your {{artStyle}} content is amazing. Quick pitch: we're building an AI tool that turns manga into anime episodes, and we're looking for founding creators to join (free access + revenue share). Would you be down to chat?`,
  webtoon: `Hi {{name}}, I've been reading your work on Webtoon and love your {{genres}} storytelling. We're building Awakli — an AI-powered platform that can animate manga/webtoon panels into full episodes. We're inviting a small group of creators to our Founders' Studio (free access, 90% revenue share, direct product input). Interested?`,
  tapas: `Hi {{name}}, I discovered your work on Tapas and was drawn to your {{artStyle}} style. We're building an AI platform (Awakli) that helps creators turn their comics into animated episodes. We're looking for founding creators — free access, revenue share, and you'd help shape the product. Would love to chat!`,
  personal_site: `Hi {{name}}, I came across your portfolio and was impressed by your {{artStyle}} work in {{genres}}. I'm reaching out from Awakli — we're building an AI manga-to-anime pipeline and assembling a Founders' Studio cohort. As a founding creator, you'd get free platform access, 90% revenue share, and direct product influence. Would you be open to a conversation?`,
  referral: `Hi {{name}}, {{referrerName}} suggested I reach out to you. We're building Awakli — an AI platform for manga-to-anime creation — and are assembling a small Founders' Studio cohort. Free access, revenue share, and direct product input. Would love to tell you more!`,
  inbound: `Hi {{name}}, thanks for expressing interest in Awakli's Founders' Studio! We'd love to learn more about your work and discuss how we can collaborate. Are you available for a quick 15-minute call this week?`,
};

// ─── Outreach Draft Generator ───────────────────────────────────────────────────

export function generateOutreachDraft(
  profile: Pick<CreatorProfile, "name" | "sourcePlatform" | "genres" | "artStyle">,
  tone: "casual" | "professional" | "enthusiastic" = "casual",
  referrerName?: string,
): OutreachDraft {
  const template = MESSAGE_TEMPLATES[profile.sourcePlatform];

  let body = template
    .replace(/\{\{name\}\}/g, profile.name)
    .replace(/\{\{artStyle\}\}/g, profile.artStyle || "creative")
    .replace(/\{\{genres\}\}/g, profile.genres.join(", ") || "manga")
    .replace(/\{\{referrerName\}\}/g, referrerName || "a colleague");

  // Adjust tone
  if (tone === "professional") {
    body = body.replace(/Hey /g, "Dear ").replace(/! /g, ". ").replace(/👋|🎨|🔥/g, "");
  } else if (tone === "enthusiastic") {
    body = body.replace(/\. /g, "! ");
  }

  const subjects: Record<SourcePlatform, string> = {
    twitter: `Loved your work — Awakli Founders' Studio invite`,
    artstation: `Your ${profile.genres[0] || "art"} portfolio caught our eye — collaboration opportunity`,
    pixiv: `Awakli Founders' Studio — クリエイター募集`,
    deviantart: `Your art + AI animation = something amazing?`,
    instagram: `Quick collab idea for your art 🎨`,
    youtube: `Awakli Founders' Studio — creator invite`,
    tiktok: `Turn your art into anime episodes? 🔥`,
    webtoon: `Your webtoon → animated episodes (free tool invite)`,
    tapas: `Awakli Founders' Studio — creator invite`,
    personal_site: `Collaboration opportunity — Awakli Founders' Studio`,
    referral: `${referrerName || "A friend"} suggested we connect — Awakli`,
    inbound: `Welcome to Awakli's Founders' Studio!`,
  };

  return {
    creatorId: 0, // Set by caller
    platform: profile.sourcePlatform,
    subject: subjects[profile.sourcePlatform],
    body,
    personalizationNotes: `Source: ${profile.sourcePlatform}, Genres: ${profile.genres.join(", ")}, Style: ${profile.artStyle || "unknown"}`,
    tone,
    generatedAt: new Date(),
  };
}

// ─── Cohort Metrics ─────────────────────────────────────────────────────────────

export interface CohortMetrics {
  total: number;
  byStatus: Record<OutreachStatus, number>;
  conversionRate: number; // contacted → active
  avgEpisodesPerCreator: number;
  totalRlhfData: number;
  totalRevenueCents: number;
  activeCreators: number;
  blockedCreators: number;
}

export function computeCohortMetrics(creators: CreatorProfile[]): CohortMetrics {
  const byStatus: Record<OutreachStatus, number> = {
    identified: 0,
    draft_ready: 0,
    contacted: 0,
    responded: 0,
    onboarding: 0,
    active: 0,
    paused: 0,
    churned: 0,
    declined: 0,
  };

  let totalEpisodes = 0;
  let totalRlhf = 0;
  let totalRevenue = 0;
  let blockedCount = 0;

  for (const creator of creators) {
    byStatus[creator.outreachStatus]++;
    totalEpisodes += creator.episodesDelivered;
    totalRlhf += creator.rlhfDataContributed;
    totalRevenue += creator.revenueAccruedCents;
    if (creator.currentBlocker) blockedCount++;
  }

  const contacted = byStatus.contacted + byStatus.responded + byStatus.onboarding + byStatus.active + byStatus.paused + byStatus.churned;
  const active = byStatus.active;
  const conversionRate = contacted > 0 ? active / contacted : 0;
  const activeCreators = byStatus.active;
  const avgEpisodes = activeCreators > 0 ? totalEpisodes / activeCreators : 0;

  return {
    total: creators.length,
    byStatus,
    conversionRate,
    avgEpisodesPerCreator: avgEpisodes,
    totalRlhfData: totalRlhf,
    totalRevenueCents: totalRevenue,
    activeCreators,
    blockedCreators: blockedCount,
  };
}

// ─── tRPC Router ────────────────────────────────────────────────────────────────

export const foundersOutboundRouter = router({
  /**
   * Admin: Add a new creator prospect to the outbound pipeline.
   */
  addProspect: adminProcedure
    .input(z.object({
      name: z.string().min(1).max(200),
      email: z.string().email().max(320).optional(),
      sourcePlatform: z.enum(SOURCE_PLATFORMS),
      profileUrl: z.string().url().max(2000),
      followerCount: z.number().int().min(0).optional(),
      genres: z.array(z.string().max(100)).max(10),
      artStyle: z.string().max(200).optional(),
      adminNotes: z.string().max(5000).optional(),
    }))
    .mutation(async ({ input }) => {
      log.info("prospect_added", { name: input.name, platform: input.sourcePlatform });
      // In production this would insert into a founders_outbound table
      // For now, return the generated draft
      const draft = generateOutreachDraft({
        name: input.name,
        sourcePlatform: input.sourcePlatform,
        genres: input.genres,
        artStyle: input.artStyle,
      });
      return {
        success: true,
        draft,
      };
    }),

  /**
   * Admin: Generate an outreach draft for a creator.
   */
  generateDraft: adminProcedure
    .input(z.object({
      name: z.string().min(1).max(200),
      sourcePlatform: z.enum(SOURCE_PLATFORMS),
      genres: z.array(z.string().max(100)).max(10),
      artStyle: z.string().max(200).optional(),
      tone: z.enum(["casual", "professional", "enthusiastic"]).optional().default("casual"),
      referrerName: z.string().max(200).optional(),
    }))
    .mutation(async ({ input }) => {
      const draft = generateOutreachDraft(
        { name: input.name, sourcePlatform: input.sourcePlatform, genres: input.genres, artStyle: input.artStyle },
        input.tone,
        input.referrerName,
      );
      return draft;
    }),

  /**
   * Admin: Update a creator's outreach status and tracking info.
   */
  updateCreatorStatus: adminProcedure
    .input(z.object({
      creatorId: z.number().int(),
      status: z.enum(OUTREACH_STATUSES),
      responseNotes: z.string().max(5000).optional(),
      currentBlocker: z.string().max(500).optional(),
      episodesCommitted: z.number().int().min(0).optional(),
      episodesDelivered: z.number().int().min(0).optional(),
      discordUsername: z.string().max(100).optional(),
      adminNotes: z.string().max(5000).optional(),
    }))
    .mutation(async ({ input }) => {
      log.info("creator_status_updated", { creatorId: input.creatorId, status: input.status });
      return { success: true, updatedStatus: input.status };
    }),

  /**
   * Admin: Get cohort metrics overview.
   */
  cohortMetrics: adminProcedure
    .query(async () => {
      // In production, this would query the founders_outbound table
      // Return empty metrics for now
      const emptyMetrics: CohortMetrics = {
        total: 0,
        byStatus: {
          identified: 0, draft_ready: 0, contacted: 0, responded: 0,
          onboarding: 0, active: 0, paused: 0, churned: 0, declined: 0,
        },
        conversionRate: 0,
        avgEpisodesPerCreator: 0,
        totalRlhfData: 0,
        totalRevenueCents: 0,
        activeCreators: 0,
        blockedCreators: 0,
      };
      return emptyMetrics;
    }),
});
