/**
 * Wave 2 Item 2: D0 Character Designer Tests
 *
 * Tests the tRPC router for multi-view reference sheet generation,
 * CLIP validation, and approval gate management.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the character-designer module
const mockGenerateCharacterViews = vi.fn();
const mockGetCharacterViews = vi.fn();
const mockGetGateByCharacter = vi.fn();
const mockGetReferenceSheetStatus = vi.fn();
const mockApproveReferenceSheet = vi.fn();
const mockRejectReferenceSheet = vi.fn();
const mockUpdateViewStatus = vi.fn();
const mockRegenerateView = vi.fn();

vi.mock("./benchmarks/d0/character-designer", () => ({
  generateCharacterViews: (...args: any[]) => mockGenerateCharacterViews(...args),
  getCharacterViews: (...args: any[]) => mockGetCharacterViews(...args),
  getGateByCharacter: (...args: any[]) => mockGetGateByCharacter(...args),
  getReferenceSheetStatus: (...args: any[]) => mockGetReferenceSheetStatus(...args),
  approveReferenceSheet: (...args: any[]) => mockApproveReferenceSheet(...args),
  rejectReferenceSheet: (...args: any[]) => mockRejectReferenceSheet(...args),
  updateViewStatus: (...args: any[]) => mockUpdateViewStatus(...args),
  regenerateView: (...args: any[]) => mockRegenerateView(...args),
}));

import { characterDesignerRouter } from "./routers-character-designer";

const mockUser = { id: 1, name: "TestUser", role: "admin" as const, openId: "test-open-id" };
const authedCtx = { user: mockUser, req: {} as any, res: {} as any };
const unauthCtx = { user: null, req: {} as any, res: {} as any };

describe("characterDesigner router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── Auth Tests ─────────────────────────────────────────────────────

  describe("authentication", () => {
    it("rejects unauthenticated generateViews", async () => {
      const caller = characterDesignerRouter.createCaller(unauthCtx);
      await expect(
        caller.generateViews({ characterId: 1, projectId: 1 })
      ).rejects.toThrow();
    });

    it("rejects unauthenticated getStatus", async () => {
      const caller = characterDesignerRouter.createCaller(unauthCtx);
      await expect(
        caller.getStatus({ characterId: 1 })
      ).rejects.toThrow();
    });

    it("rejects unauthenticated approveSheet", async () => {
      const caller = characterDesignerRouter.createCaller(unauthCtx);
      await expect(
        caller.approveSheet({ characterId: 1 })
      ).rejects.toThrow();
    });

    it("rejects unauthenticated rejectSheet", async () => {
      const caller = characterDesignerRouter.createCaller(unauthCtx);
      await expect(
        caller.rejectSheet({ characterId: 1, reason: "test" })
      ).rejects.toThrow();
    });

    it("rejects unauthenticated updateViewStatus", async () => {
      const caller = characterDesignerRouter.createCaller(unauthCtx);
      await expect(
        caller.updateViewStatus({ viewId: 1, status: "approved" })
      ).rejects.toThrow();
    });

    it("rejects unauthenticated regenerateView", async () => {
      const caller = characterDesignerRouter.createCaller(unauthCtx);
      await expect(
        caller.regenerateView({ viewId: 1 })
      ).rejects.toThrow();
    });
  });

  // ─── Input Validation Tests ─────────────────────────────────────────

  describe("input validation", () => {
    it("rejects invalid characterId in generateViews", async () => {
      const caller = characterDesignerRouter.createCaller(authedCtx);
      await expect(
        caller.generateViews({ characterId: -1, projectId: 1 })
      ).rejects.toThrow();
    });

    it("rejects invalid projectId in generateViews", async () => {
      const caller = characterDesignerRouter.createCaller(authedCtx);
      await expect(
        caller.generateViews({ characterId: 1, projectId: 0 })
      ).rejects.toThrow();
    });

    it("rejects empty reason in rejectSheet", async () => {
      const caller = characterDesignerRouter.createCaller(authedCtx);
      await expect(
        caller.rejectSheet({ characterId: 1, reason: "" })
      ).rejects.toThrow();
    });

    it("rejects invalid status in updateViewStatus", async () => {
      const caller = characterDesignerRouter.createCaller(authedCtx);
      await expect(
        caller.updateViewStatus({ viewId: 1, status: "invalid" as any })
      ).rejects.toThrow();
    });
  });

  // ─── generateViews Tests ────────────────────────────────────────────

  describe("generateViews", () => {
    it("calls generateCharacterViews with correct params", async () => {
      mockGenerateCharacterViews.mockResolvedValue({
        success: true,
        gateId: 1,
        totalCost: 0.40,
        views: [
          { viewAngle: "front", imageUrl: "https://cdn/front.png", clipScore: 1.0, status: "generated", attemptNumber: 1, costUsd: 0.10 },
          { viewAngle: "three_quarter", imageUrl: "https://cdn/tq.png", clipScore: 0.92, status: "generated", attemptNumber: 1, costUsd: 0.10 },
          { viewAngle: "side", imageUrl: "https://cdn/side.png", clipScore: 0.88, status: "generated", attemptNumber: 1, costUsd: 0.10 },
          { viewAngle: "back", imageUrl: "https://cdn/back.png", clipScore: 0.90, status: "generated", attemptNumber: 1, costUsd: 0.10 },
        ],
      });

      const caller = characterDesignerRouter.createCaller(authedCtx);
      const result = await caller.generateViews({
        characterId: 5,
        projectId: 2,
        styleBundleKey: "shonen",
      });

      expect(result.success).toBe(true);
      expect(result.gateId).toBe(1);
      expect(result.totalCost).toBe(0.40);
      expect(result.views).toHaveLength(4);
      expect(result.views[0].viewAngle).toBe("front");
      expect(result.views[0].clipScore).toBe(1.0);

      expect(mockGenerateCharacterViews).toHaveBeenCalledWith({
        characterId: 5,
        projectId: 2,
        userId: 1,
        styleBundleKey: "shonen",
      });
    });

    it("returns failure when generation fails", async () => {
      mockGenerateCharacterViews.mockResolvedValue({
        success: false,
        gateId: 2,
        totalCost: 0.10,
        views: [
          { viewAngle: "front", imageUrl: null, clipScore: null, status: "failed", attemptNumber: 3, costUsd: 0.10, error: "Generation timeout" },
        ],
      });

      const caller = characterDesignerRouter.createCaller(authedCtx);
      const result = await caller.generateViews({ characterId: 1, projectId: 1 });

      expect(result.success).toBe(false);
      expect(result.views[0].status).toBe("failed");
      expect(result.views[0].error).toBe("Generation timeout");
    });
  });

  // ─── getStatus Tests ────────────────────────────────────────────────

  describe("getStatus", () => {
    it("returns null gate for non-existent character", async () => {
      mockGetReferenceSheetStatus.mockResolvedValue({
        gate: null,
        views: [],
        character: null,
      });

      const caller = characterDesignerRouter.createCaller(authedCtx);
      const result = await caller.getStatus({ characterId: 999999 });

      expect(result.gate).toBeNull();
      expect(result.views).toEqual([]);
      expect(result.character).toBeNull();
    });

    it("returns full status with gate and views", async () => {
      mockGetReferenceSheetStatus.mockResolvedValue({
        gate: {
          id: 1,
          status: "all_views_generated",
          overallClipScore: "0.9200",
          totalCostUsd: "0.4000",
          totalAttempts: 1,
          approvedAt: null,
          rejectedReason: null,
        },
        views: [
          { id: 1, viewAngle: "front", imageUrl: "https://cdn/front.png", clipScore: "1.0000", status: "generated", attemptNumber: 1, generationCostUsd: "0.1000", errorMessage: null, createdAt: new Date() },
          { id: 2, viewAngle: "three_quarter", imageUrl: "https://cdn/tq.png", clipScore: "0.9200", status: "generated", attemptNumber: 1, generationCostUsd: "0.1000", errorMessage: null, createdAt: new Date() },
        ],
        character: { id: 5, name: "Akira", role: "protagonist", visualTraits: { hairColor: "black" } },
      });

      const caller = characterDesignerRouter.createCaller(authedCtx);
      const result = await caller.getStatus({ characterId: 5 });

      expect(result.gate).not.toBeNull();
      expect(result.gate!.status).toBe("all_views_generated");
      expect(result.gate!.overallClipScore).toBe(0.92);
      expect(result.views).toHaveLength(2);
      expect(result.character!.name).toBe("Akira");
    });
  });

  // ─── approveSheet Tests ─────────────────────────────────────────────

  describe("approveSheet", () => {
    it("approves when gate is in correct state", async () => {
      mockApproveReferenceSheet.mockResolvedValue(true);

      const caller = characterDesignerRouter.createCaller(authedCtx);
      const result = await caller.approveSheet({ characterId: 5 });

      expect(result.success).toBe(true);
      expect(mockApproveReferenceSheet).toHaveBeenCalledWith(5);
    });

    it("throws when gate is not in approvable state", async () => {
      mockApproveReferenceSheet.mockResolvedValue(false);

      const caller = characterDesignerRouter.createCaller(authedCtx);
      await expect(
        caller.approveSheet({ characterId: 5 })
      ).rejects.toThrow("Cannot approve");
    });
  });

  // ─── rejectSheet Tests ──────────────────────────────────────────────

  describe("rejectSheet", () => {
    it("rejects with reason", async () => {
      mockRejectReferenceSheet.mockResolvedValue(true);

      const caller = characterDesignerRouter.createCaller(authedCtx);
      const result = await caller.rejectSheet({
        characterId: 5,
        reason: "Hair color inconsistent across views",
      });

      expect(result.success).toBe(true);
      expect(mockRejectReferenceSheet).toHaveBeenCalledWith(5, "Hair color inconsistent across views");
    });

    it("throws when no gate exists", async () => {
      mockRejectReferenceSheet.mockResolvedValue(false);

      const caller = characterDesignerRouter.createCaller(authedCtx);
      await expect(
        caller.rejectSheet({ characterId: 999, reason: "Test" })
      ).rejects.toThrow("Cannot reject");
    });
  });

  // ─── updateViewStatus Tests ─────────────────────────────────────────

  describe("updateViewStatus", () => {
    it("approves a single view", async () => {
      mockUpdateViewStatus.mockResolvedValue(true);

      const caller = characterDesignerRouter.createCaller(authedCtx);
      const result = await caller.updateViewStatus({ viewId: 1, status: "approved" });

      expect(result.success).toBe(true);
      expect(mockUpdateViewStatus).toHaveBeenCalledWith(1, "approved");
    });

    it("rejects a single view", async () => {
      mockUpdateViewStatus.mockResolvedValue(true);

      const caller = characterDesignerRouter.createCaller(authedCtx);
      const result = await caller.updateViewStatus({ viewId: 2, status: "rejected" });

      expect(result.success).toBe(true);
      expect(mockUpdateViewStatus).toHaveBeenCalledWith(2, "rejected");
    });

    it("throws on failure", async () => {
      mockUpdateViewStatus.mockResolvedValue(false);

      const caller = characterDesignerRouter.createCaller(authedCtx);
      await expect(
        caller.updateViewStatus({ viewId: 1, status: "approved" })
      ).rejects.toThrow("Failed to update");
    });
  });

  // ─── regenerateView Tests ───────────────────────────────────────────

  describe("regenerateView", () => {
    it("regenerates a view and returns result", async () => {
      mockRegenerateView.mockResolvedValue({
        viewAngle: "side",
        imageUrl: "https://cdn/side_v2.png",
        clipScore: 0.91,
        status: "generated",
        attemptNumber: 2,
        costUsd: 0.10,
      });

      const caller = characterDesignerRouter.createCaller(authedCtx);
      const result = await caller.regenerateView({ viewId: 3 });

      expect(result.viewAngle).toBe("side");
      expect(result.imageUrl).toBe("https://cdn/side_v2.png");
      expect(result.clipScore).toBe(0.91);
      expect(result.status).toBe("generated");
      expect(mockRegenerateView).toHaveBeenCalledWith(3, 1); // viewId, userId
    });
  });
});
