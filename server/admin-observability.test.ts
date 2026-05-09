import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAdminContext(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "admin-user",
    email: "admin@awakli.com",
    name: "Admin User",
    loginMethod: "manus",
    role: "admin",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
  return {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };
}

function createUserContext(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 2,
    openId: "regular-user",
    email: "user@example.com",
    name: "Regular User",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
  return {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };
}

describe("admin.getPipelineObservability", () => {
  it("returns observability data for admin users", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.admin.getPipelineObservability();

    // Verify structure
    expect(result).toHaveProperty("recentRuns");
    expect(result).toHaveProperty("stats");
    expect(result).toHaveProperty("layerScores");
    expect(result).toHaveProperty("nodeErrors");
    expect(result).toHaveProperty("duration");

    // Verify stats shape
    expect(result.stats).toHaveProperty("totalRuns");
    expect(result.stats).toHaveProperty("completedRuns");
    expect(result.stats).toHaveProperty("failedRuns");
    expect(result.stats).toHaveProperty("runningRuns");
    expect(result.stats).toHaveProperty("avgCostCents");
    expect(result.stats).toHaveProperty("totalCostCents");
    expect(result.stats).toHaveProperty("successRate");

    // Verify duration shape
    expect(result.duration).toHaveProperty("avgMs");
    expect(result.duration).toHaveProperty("minMs");
    expect(result.duration).toHaveProperty("maxMs");

    // All numeric values should be numbers
    expect(typeof result.stats.totalRuns).toBe("number");
    expect(typeof result.stats.successRate).toBe("number");
    expect(typeof result.duration.avgMs).toBe("number");

    // recentRuns should be an array
    expect(Array.isArray(result.recentRuns)).toBe(true);
    expect(Array.isArray(result.layerScores)).toBe(true);
    expect(Array.isArray(result.nodeErrors)).toBe(true);
  });

  it("rejects non-admin users", async () => {
    const ctx = createUserContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.admin.getPipelineObservability()).rejects.toThrow();
  });
});

describe("admin.getCostSpotCheck", () => {
  it("returns cost spot-check data for admin users", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.admin.getCostSpotCheck();

    // Verify structure
    expect(result).toHaveProperty("referenceCosts");
    expect(result).toHaveProperty("comparisons");
    expect(result).toHaveProperty("avgVariancePct");
    expect(result).toHaveProperty("allWithinTolerance");

    // Reference costs should have expected keys
    expect(result.referenceCosts).toHaveProperty("video_gen");
    expect(result.referenceCosts).toHaveProperty("voice_gen");
    expect(result.referenceCosts).toHaveProperty("music_gen");
    expect(result.referenceCosts).toHaveProperty("assembly");
    expect(result.referenceCosts).toHaveProperty("total");

    // Comparisons should be an array
    expect(Array.isArray(result.comparisons)).toBe(true);

    // Type checks
    expect(typeof result.avgVariancePct).toBe("number");
    expect(typeof result.allWithinTolerance).toBe("boolean");
  });

  it("rejects non-admin users", async () => {
    const ctx = createUserContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.admin.getCostSpotCheck()).rejects.toThrow();
  });
});
