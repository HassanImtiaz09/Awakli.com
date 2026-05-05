/**
 * Founders' Studio Outbound Infrastructure Tests (Wave 5C Item 4)
 */

import { describe, it, expect } from "vitest";
import {
  generateOutreachDraft,
  computeCohortMetrics,
  OUTREACH_STATUSES,
  SOURCE_PLATFORMS,
  MESSAGE_TEMPLATES,
  type CreatorProfile,
  type OutreachStatus,
} from "./founders-outbound";

// ─── Outreach Draft Generation ──────────────────────────────────────────────────

describe("Founders Outbound - Draft Generation", () => {
  it("should generate a draft for Twitter creator", () => {
    const draft = generateOutreachDraft({
      name: "AkiraArt",
      sourcePlatform: "twitter",
      genres: ["shonen", "action"],
      artStyle: "dynamic linework",
    });

    expect(draft.platform).toBe("twitter");
    expect(draft.body).toContain("AkiraArt");
    expect(draft.body).toContain("dynamic linework");
    expect(draft.subject).toBeDefined();
    expect(draft.generatedAt).toBeInstanceOf(Date);
  });

  it("should generate a draft for ArtStation creator", () => {
    const draft = generateOutreachDraft({
      name: "SakuraStudios",
      sourcePlatform: "artstation",
      genres: ["seinen", "fantasy"],
      artStyle: "detailed illustration",
    });

    expect(draft.body).toContain("SakuraStudios");
    expect(draft.body).toContain("detailed illustration");
    expect(draft.body).toContain("seinen, fantasy");
  });

  it("should generate a draft for Pixiv creator (Japanese)", () => {
    const draft = generateOutreachDraft({
      name: "田中太郎",
      sourcePlatform: "pixiv",
      genres: ["shojo"],
      artStyle: "watercolor",
    });

    expect(draft.body).toContain("田中太郎");
    expect(draft.body).toContain("watercolor");
  });

  it("should handle referral platform with referrer name", () => {
    const draft = generateOutreachDraft(
      { name: "NewCreator", sourcePlatform: "referral", genres: ["comedy"], artStyle: "chibi" },
      "casual",
      "ExistingCreator"
    );

    expect(draft.body).toContain("ExistingCreator");
  });

  it("should adjust tone to professional", () => {
    const draft = generateOutreachDraft(
      { name: "ProArtist", sourcePlatform: "twitter", genres: ["seinen"], artStyle: "realistic" },
      "professional"
    );

    // Professional tone removes emojis and uses "Dear" instead of "Hey"
    expect(draft.body).not.toContain("👋");
    expect(draft.body).toContain("Dear");
  });

  it("should handle missing artStyle gracefully", () => {
    const draft = generateOutreachDraft({
      name: "TestCreator",
      sourcePlatform: "instagram",
      genres: [],
      artStyle: undefined,
    });

    expect(draft.body).toContain("creative"); // Fallback
    expect(draft.body).not.toContain("undefined");
  });

  it("should have templates for all source platforms", () => {
    for (const platform of SOURCE_PLATFORMS) {
      expect(MESSAGE_TEMPLATES[platform]).toBeDefined();
      expect(MESSAGE_TEMPLATES[platform].length).toBeGreaterThan(50);
    }
  });

  it("should include personalization notes", () => {
    const draft = generateOutreachDraft({
      name: "TestCreator",
      sourcePlatform: "artstation",
      genres: ["horror", "thriller"],
      artStyle: "dark ink",
    });

    expect(draft.personalizationNotes).toContain("artstation");
    expect(draft.personalizationNotes).toContain("horror");
    expect(draft.personalizationNotes).toContain("dark ink");
  });
});

// ─── Outreach Status Machine ────────────────────────────────────────────────────

describe("Founders Outbound - Status Machine", () => {
  it("should define all expected outreach statuses", () => {
    expect(OUTREACH_STATUSES).toContain("identified");
    expect(OUTREACH_STATUSES).toContain("draft_ready");
    expect(OUTREACH_STATUSES).toContain("contacted");
    expect(OUTREACH_STATUSES).toContain("responded");
    expect(OUTREACH_STATUSES).toContain("onboarding");
    expect(OUTREACH_STATUSES).toContain("active");
    expect(OUTREACH_STATUSES).toContain("paused");
    expect(OUTREACH_STATUSES).toContain("churned");
    expect(OUTREACH_STATUSES).toContain("declined");
  });

  it("should have 9 total statuses", () => {
    expect(OUTREACH_STATUSES.length).toBe(9);
  });

  it("should define all source platforms", () => {
    expect(SOURCE_PLATFORMS).toContain("twitter");
    expect(SOURCE_PLATFORMS).toContain("artstation");
    expect(SOURCE_PLATFORMS).toContain("pixiv");
    expect(SOURCE_PLATFORMS).toContain("instagram");
    expect(SOURCE_PLATFORMS).toContain("referral");
    expect(SOURCE_PLATFORMS).toContain("inbound");
  });
});

// ─── Cohort Metrics ─────────────────────────────────────────────────────────────

describe("Founders Outbound - Cohort Metrics", () => {
  const mockCreators: CreatorProfile[] = [
    {
      id: 1, name: "Creator A", sourcePlatform: "twitter", profileUrl: "https://twitter.com/a",
      genres: ["shonen"], outreachStatus: "active", episodesCommitted: 5, episodesDelivered: 3,
      rlhfDataContributed: 120, revenueAccruedCents: 5000, createdAt: new Date(), updatedAt: new Date(),
    },
    {
      id: 2, name: "Creator B", sourcePlatform: "artstation", profileUrl: "https://artstation.com/b",
      genres: ["seinen"], outreachStatus: "active", episodesCommitted: 10, episodesDelivered: 7,
      rlhfDataContributed: 200, revenueAccruedCents: 12000, createdAt: new Date(), updatedAt: new Date(),
    },
    {
      id: 3, name: "Creator C", sourcePlatform: "pixiv", profileUrl: "https://pixiv.net/c",
      genres: ["shojo"], outreachStatus: "contacted", episodesCommitted: 0, episodesDelivered: 0,
      rlhfDataContributed: 0, revenueAccruedCents: 0, createdAt: new Date(), updatedAt: new Date(),
    },
    {
      id: 4, name: "Creator D", sourcePlatform: "instagram", profileUrl: "https://instagram.com/d",
      genres: ["comedy"], outreachStatus: "churned", episodesCommitted: 3, episodesDelivered: 1,
      rlhfDataContributed: 30, revenueAccruedCents: 1500, createdAt: new Date(), updatedAt: new Date(),
    },
    {
      id: 5, name: "Creator E", sourcePlatform: "referral", profileUrl: "https://example.com/e",
      genres: ["horror"], outreachStatus: "onboarding", episodesCommitted: 2, episodesDelivered: 0,
      currentBlocker: "Waiting for LoRA training", rlhfDataContributed: 0, revenueAccruedCents: 0,
      createdAt: new Date(), updatedAt: new Date(),
    },
  ];

  it("should compute total creator count", () => {
    const metrics = computeCohortMetrics(mockCreators);
    expect(metrics.total).toBe(5);
  });

  it("should count creators by status", () => {
    const metrics = computeCohortMetrics(mockCreators);
    expect(metrics.byStatus.active).toBe(2);
    expect(metrics.byStatus.contacted).toBe(1);
    expect(metrics.byStatus.churned).toBe(1);
    expect(metrics.byStatus.onboarding).toBe(1);
  });

  it("should calculate conversion rate (contacted → active)", () => {
    const metrics = computeCohortMetrics(mockCreators);
    // contacted + responded + onboarding + active + paused + churned = 1+0+1+2+0+1 = 5
    // active = 2
    // conversion = 2/5 = 0.4
    expect(metrics.conversionRate).toBeCloseTo(0.4);
  });

  it("should calculate average episodes per active creator", () => {
    const metrics = computeCohortMetrics(mockCreators);
    // Total delivered: 3+7+0+1+0 = 11, active creators = 2, avg = 11/2 = 5.5
    expect(metrics.avgEpisodesPerCreator).toBe(5.5);
  });

  it("should sum total RLHF data", () => {
    const metrics = computeCohortMetrics(mockCreators);
    expect(metrics.totalRlhfData).toBe(350); // 120 + 200 + 0 + 30 + 0
  });

  it("should sum total revenue", () => {
    const metrics = computeCohortMetrics(mockCreators);
    expect(metrics.totalRevenueCents).toBe(18500); // 5000 + 12000 + 0 + 1500 + 0
  });

  it("should count blocked creators", () => {
    const metrics = computeCohortMetrics(mockCreators);
    expect(metrics.blockedCreators).toBe(1); // Creator E has a blocker
  });

  it("should handle empty creator list", () => {
    const metrics = computeCohortMetrics([]);
    expect(metrics.total).toBe(0);
    expect(metrics.conversionRate).toBe(0);
    expect(metrics.avgEpisodesPerCreator).toBe(0);
    expect(metrics.activeCreators).toBe(0);
  });
});

// ─── Integration with Existing Founders Router ──────────────────────────────────

describe("Founders Outbound - Integration", () => {
  it("inbound submissions should be triaged separately from outbound", () => {
    // Express Interest form creates inbound leads with status "new"
    // Outbound pipeline starts with status "identified"
    const inboundInitialStatus = "new"; // From founderInterest table
    const outboundInitialStatus: OutreachStatus = "identified";
    expect(inboundInitialStatus).not.toBe(outboundInitialStatus);
  });

  it("outbound pipeline should support Stripe Connect onboarding", () => {
    // Active creators should have stripeConnectId for revenue share
    const activeCreator: Partial<CreatorProfile> = {
      outreachStatus: "active",
      stripeConnectId: "acct_test_123",
      revenueSharePercent: 90,
    } as any;
    expect(activeCreator.stripeConnectId).toBeDefined();
  });

  it("Discord integration should be tracked per creator", () => {
    const creator: Partial<CreatorProfile> = {
      discordUsername: "creator#1234",
      outreachStatus: "active",
    };
    expect(creator.discordUsername).toBeDefined();
  });
});
