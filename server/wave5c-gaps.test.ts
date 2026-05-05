/**
 * Wave 5C Gap Closure Tests
 *
 * Verifies:
 * 1. trainCharacterLora + adminApproveCharacterLora + adminRejectCharacterLora exist in routers-character-bible.ts
 * 2. Cal.com scheduling integration (getUpcomingOfficeHours, createOfficeHoursBooking)
 * 3. Discord cohort integration (sendCohortMessage, generateCohortInvite, assignCohortRole)
 * 4. initiateStripeConnectOnboarding exists in routers-founders.ts
 * 5. Founder dashboard UI route registered
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "..");

function readFile(relPath: string): string {
  const fullPath = resolve(ROOT, relPath);
  if (!existsSync(fullPath)) throw new Error(`File not found: ${relPath}`);
  return readFileSync(fullPath, "utf-8");
}

describe("Gap 1: Per-Character LoRA tRPC Procedures in routers-character-bible.ts", () => {
  const content = readFile("server/routers-character-bible.ts");

  it("exports trainCharacterLora procedure", () => {
    expect(content).toContain("trainCharacterLora: protectedProcedure");
  });

  it("trainCharacterLora inserts with pending_admin_approval (no provider call)", () => {
    expect(content).toContain('status: "pending_admin_approval"');
    expect(content).toContain("estimateTrainingJob");
    // Should NOT contain a direct Replicate call in trainCharacterLora
    const trainLoraSection = content.split("trainCharacterLora:")[1]?.split("adminApproveCharacterLora:")[0] || "";
    expect(trainLoraSection).not.toContain("api.replicate.com/v1/trainings");
  });

  it("trainCharacterLora returns cost estimate", () => {
    expect(content).toContain("estimatedCostCents");
    expect(content).toContain("estimate.withMargin.costUsd");
  });

  it("trainCharacterLora blocks if already in-flight", () => {
    expect(content).toContain("Training already in progress or pending approval");
  });

  it("trainCharacterLora requires reference sheet", () => {
    expect(content).toContain("Character must have a reference sheet before training");
  });

  it("exports adminApproveCharacterLora procedure", () => {
    expect(content).toContain("adminApproveCharacterLora: adminProcedure");
  });

  it("adminApproveCharacterLora submits to Replicate after approval", () => {
    const approveSection = content.split("adminApproveCharacterLora:")[1]?.split("adminRejectCharacterLora:")[0] || "";
    expect(approveSection).toContain("api.replicate.com/v1/trainings");
    expect(approveSection).toContain("REPLICATE_API_TOKEN");
  });

  it("adminApproveCharacterLora transitions to queued status", () => {
    const approveSection = content.split("adminApproveCharacterLora:")[1]?.split("adminRejectCharacterLora:")[0] || "";
    expect(approveSection).toContain('status: "queued"');
  });

  it("adminApproveCharacterLora validates job is in pending_admin_approval", () => {
    expect(content).toContain("Can only approve jobs in pending_admin_approval status");
  });

  it("exports adminRejectCharacterLora procedure", () => {
    expect(content).toContain("adminRejectCharacterLora: adminProcedure");
  });

  it("adminRejectCharacterLora cancels with reason", () => {
    const rejectSection = content.split("adminRejectCharacterLora:")[1] || "";
    expect(rejectSection).toContain('status: "cancelled"');
    expect(rejectSection).toContain("rejectionReason: input.reason");
  });

  it("adminRejectCharacterLora resets character loraStatus", () => {
    const rejectSection = content.split("adminRejectCharacterLora:")[1] || "";
    expect(rejectSection).toContain('loraStatus: "untrained"');
  });

  it("follows same schema status enum as sakufuu (pending_admin_approval → queued → training)", () => {
    expect(content).toContain("pending_admin_approval");
    expect(content).toContain('"queued"');
    expect(content).toContain('"training"');
  });

  it("is wired into the main router via characterBible namespace", () => {
    const routersContent = readFile("server/routers.ts");
    expect(routersContent).toContain('import { characterBibleRouter } from "./routers-character-bible"');
  });
});

describe("Gap 2a: Cal.com Scheduling Integration", () => {
  const content = readFile("server/founders-integrations.ts");

  it("exports getUpcomingOfficeHours function", () => {
    expect(content).toContain("export async function getUpcomingOfficeHours");
  });

  it("exports getAvailableSlots function", () => {
    expect(content).toContain("export async function getAvailableSlots");
  });

  it("exports createOfficeHoursBooking function", () => {
    expect(content).toContain("export async function createOfficeHoursBooking");
  });

  it("getCalComConfig reads CALCOM_API_KEY env", () => {
    expect(content).toContain("process.env.CALCOM_API_KEY");
  });

  it("getCalComConfig reads CALCOM_OFFICE_HOURS_EVENT_TYPE_ID", () => {
    expect(content).toContain("CALCOM_OFFICE_HOURS_EVENT_TYPE_ID");
  });

  it("tRPC router exposes getOfficeHours query", () => {
    expect(content).toContain("getOfficeHours: protectedProcedure");
  });

  it("tRPC router exposes bookOfficeHours mutation", () => {
    expect(content).toContain("bookOfficeHours: protectedProcedure");
  });

  it("tRPC router exposes getAvailableSlots query", () => {
    expect(content).toContain("getAvailableSlots: protectedProcedure");
  });
});

describe("Gap 2a: Discord Cohort Integration", () => {
  const content = readFile("server/founders-integrations.ts");

  it("exports sendCohortMessage function", () => {
    expect(content).toContain("export async function sendCohortMessage");
  });

  it("exports generateCohortInvite function", () => {
    expect(content).toContain("export async function generateCohortInvite");
  });

  it("exports assignCohortRole function", () => {
    expect(content).toContain("export async function assignCohortRole");
  });

  it("getDiscordConfig reads DISCORD_BOT_TOKEN", () => {
    expect(content).toContain("process.env.DISCORD_BOT_TOKEN");
  });

  it("getDiscordConfig reads DISCORD_GUILD_ID", () => {
    expect(content).toContain("process.env.DISCORD_GUILD_ID");
  });

  it("getDiscordConfig reads DISCORD_COHORT_WEBHOOK_URL", () => {
    expect(content).toContain("DISCORD_COHORT_WEBHOOK_URL");
  });

  it("tRPC router exposes sendAnnouncement mutation (admin)", () => {
    expect(content).toContain("sendAnnouncement: adminProcedure");
  });

  it("tRPC router exposes generateInvite mutation (admin)", () => {
    expect(content).toContain("generateInvite: adminProcedure");
  });

  it("tRPC router exposes assignRole mutation (admin)", () => {
    expect(content).toContain("assignRole: adminProcedure");
  });

  it("tRPC router exposes integrationStatus query (admin)", () => {
    expect(content).toContain("integrationStatus: adminProcedure");
  });
});

describe("Gap 2b: initiateStripeConnectOnboarding Router Procedure", () => {
  const content = readFile("server/routers-founders.ts");

  it("exports initiateStripeConnectOnboarding procedure", () => {
    expect(content).toContain("initiateStripeConnectOnboarding: adminProcedure");
  });

  it("imports createExpressAccount from stripe/connect", () => {
    expect(content).toContain('import { createExpressAccount, generateOnboardingLink } from "./stripe/connect"');
  });

  it("validates founder status is shortlisted or contacted", () => {
    expect(content).toContain("shortlisted");
    expect(content).toContain("contacted");
    expect(content).toContain("Cannot initiate onboarding for status");
  });

  it("checks for existing Connect account before creating", () => {
    expect(content).toContain("stripeConnectAccounts");
    expect(content).toContain("already has a completed Stripe Connect account");
  });

  it("generates fresh onboarding link for incomplete accounts", () => {
    expect(content).toContain("generateOnboardingLink");
    expect(content).toContain("Existing incomplete account");
  });

  it("requires user account before onboarding", () => {
    expect(content).toContain("must have a registered user account before Stripe Connect onboarding");
  });

  it("returns onboarding URL on success", () => {
    expect(content).toContain("onboardingUrl");
    expect(content).toContain("Share the onboarding URL with the founder");
  });
});

describe("Gap 2c: Founder Dashboard UI Routes", () => {
  it("AdminFoundersDashboard.tsx exists", () => {
    expect(existsSync(resolve(ROOT, "client/src/pages/AdminFoundersDashboard.tsx"))).toBe(true);
  });

  it("route /admin/founders is registered in App.tsx", () => {
    const appContent = readFile("client/src/App.tsx");
    expect(appContent).toContain('/admin/founders');
    expect(appContent).toContain("AdminFoundersDashboard");
  });

  it("dashboard uses trpc.foundersOutbound.cohortMetrics", () => {
    const dashContent = readFile("client/src/pages/AdminFoundersDashboard.tsx");
    expect(dashContent).toContain("trpc.foundersOutbound.cohortMetrics");
  });

  it("dashboard uses trpc.foundersIntegrations.integrationStatus", () => {
    const dashContent = readFile("client/src/pages/AdminFoundersDashboard.tsx");
    expect(dashContent).toContain("trpc.foundersIntegrations.integrationStatus");
  });

  it("dashboard uses trpc.foundersIntegrations.getOfficeHours", () => {
    const dashContent = readFile("client/src/pages/AdminFoundersDashboard.tsx");
    expect(dashContent).toContain("trpc.foundersIntegrations.getOfficeHours");
  });

  it("dashboard uses trpc.founders.initiateStripeConnectOnboarding", () => {
    const dashContent = readFile("client/src/pages/AdminFoundersDashboard.tsx");
    expect(dashContent).toContain("trpc.founders.initiateStripeConnectOnboarding");
  });

  it("dashboard has tabs: overview, outbound, inbound, integrations, onboarding", () => {
    const dashContent = readFile("client/src/pages/AdminFoundersDashboard.tsx");
    expect(dashContent).toContain('"overview"');
    expect(dashContent).toContain('"outbound"');
    expect(dashContent).toContain('"inbound"');
    expect(dashContent).toContain('"integrations"');
    expect(dashContent).toContain('"onboarding"');
  });
});

describe("Wiring: New routers registered in main router", () => {
  const content = readFile("server/routers.ts");

  it("foundersIntegrationsRouter is imported", () => {
    expect(content).toContain('import { foundersIntegrationsRouter } from "./founders-integrations"');
  });

  it("foundersOutboundRouter is imported", () => {
    expect(content).toContain('import { foundersOutboundRouter } from "./founders-outbound"');
  });

  it("foundersIntegrations is registered in appRouter", () => {
    expect(content).toContain("foundersIntegrations: foundersIntegrationsRouter");
  });

  it("foundersOutbound is registered in appRouter", () => {
    expect(content).toContain("foundersOutbound: foundersOutboundRouter");
  });
});
