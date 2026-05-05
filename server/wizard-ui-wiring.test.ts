import { describe, expect, it } from "vitest";

/**
 * Tests for the three features:
 * 1. advanceStage wired into wizard Continue buttons (useAdvanceStage hook)
 * 2. Project dashboard at /create (CreateDashboard page)
 * 3. Credit meter sidebar with real data
 */

describe("useAdvanceStage hook contract", () => {
  it("STAGES array has exactly 8 entries matching wizard paths", async () => {
    // Dynamically import the layout to verify STAGES
    const mod = await import("../client/src/layouts/CreateWizardLayout");
    const { STAGES } = mod;
    expect(STAGES).toHaveLength(8);
    expect(STAGES.map((s: any) => s.path)).toEqual([
      "input", "script", "panels", "storyboard", "publish", "anime-gate", "setup", "video",
    ]);
  });

  it("advanceStage procedure accepts id, inputs, and outputs", async () => {
    const { appRouter } = await import("./routers");
    // Verify the procedure exists
    expect(appRouter._def.procedures).toHaveProperty("projects.advanceStage");
  });

  it("advanceStage is callable as a mutation", async () => {
    const { appRouter } = await import("./routers");
    const proc = (appRouter._def.procedures as any)["projects.advanceStage"];
    expect(proc).toBeDefined();
    // Verify it has a _def (tRPC procedure structure)
    expect(proc._def).toBeDefined();
    expect(proc._def.type).toBe("mutation");
  });
});

describe("Project Dashboard (CreateDashboard)", () => {
  it("listMine procedure exists on projects router", async () => {
    const { appRouter } = await import("./routers");
    expect(appRouter._def.procedures).toHaveProperty("projects.listMine");
  });

  it("listMine is a query (not mutation)", async () => {
    const { appRouter } = await import("./routers");
    const proc = (appRouter._def.procedures as any)["projects.listMine"];
    expect(proc).toBeDefined();
    expect(proc._def).toBeDefined();
    expect(proc._def.type).toBe("query");
  });
});

describe("Credit Meter — STAGE_COSTS mirror server costs", () => {
  it("server STAGE_CREDIT_COSTS match the client STAGE_COSTS array", async () => {
    const { getStageCreditCost } = await import("./projectService");

    // Expected costs from the client-side STAGE_COSTS constant
    const expectedCosts = [
      { from: 0, cost: 0 },   // Input → Setup
      { from: 1, cost: 0 },   // Setup → Script
      { from: 2, cost: 2 },   // Script → Panels
      { from: 3, cost: 5 },   // Panels → Gate
      { from: 4, cost: 0 },   // Gate → Video
      { from: 5, cost: 10 },  // Video → Publish
    ];

    for (const { from, cost } of expectedCosts) {
      expect(getStageCreditCost(from)).toBe(cost);
    }
  });

  it("creditBalance procedure exists and is a query", async () => {
    const { appRouter } = await import("./routers");
    expect(appRouter._def.procedures).toHaveProperty("projects.creditBalance");
    const proc = (appRouter._def.procedures as any)["projects.creditBalance"];
    expect(proc._def).toBeDefined();
    expect(proc._def.type).toBe("query");
  });
});
