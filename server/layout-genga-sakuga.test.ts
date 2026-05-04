import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── D1.25 Layout Director Mocks ────────────────────────────────────────
const mockGenerateLayouts = vi.fn();
const mockGetLayoutsByEpisode = vi.fn();
const mockGetLayoutsByScene = vi.fn();
const mockGetLayoutById = vi.fn();
const mockApproveLayout = vi.fn();
const mockRejectLayout = vi.fn();
const mockUpdateLayoutComposition = vi.fn();
const mockGenerateCompositionSketch = vi.fn();
const mockApproveAllLayoutsForEpisode = vi.fn();

vi.mock("./benchmarks/d1-25/layout-director", () => ({
  generateLayouts: (...args: any[]) => mockGenerateLayouts(...args),
  getLayoutsByEpisode: (...args: any[]) => mockGetLayoutsByEpisode(...args),
  getLayoutsByScene: (...args: any[]) => mockGetLayoutsByScene(...args),
  getLayoutById: (...args: any[]) => mockGetLayoutById(...args),
  approveLayout: (...args: any[]) => mockApproveLayout(...args),
  rejectLayout: (...args: any[]) => mockRejectLayout(...args),
  updateLayoutComposition: (...args: any[]) => mockUpdateLayoutComposition(...args),
  generateCompositionSketch: (...args: any[]) => mockGenerateCompositionSketch(...args),
  approveAllLayoutsForEpisode: (...args: any[]) => mockApproveAllLayoutsForEpisode(...args),
  CAMERA_ANGLES: ["wide", "medium", "close_up", "extreme_close_up", "birds_eye", "worms_eye", "dutch_angle", "over_shoulder"],
}));

// ─── D1.5 Genga Director Mocks ─────────────────────────────────────────
const mockGenerateRoughGenga = vi.fn();
const mockGenerateCleanGenga = vi.fn();
const mockAssembleFlipBookPreview = vi.fn();
const mockApproveRoughGenga = vi.fn();
const mockApproveCleanGenga = vi.fn();
const mockRejectGenga = vi.fn();
const mockApproveFlipBook = vi.fn();
const mockGetKeyframeById = vi.fn();
const mockGetKeyframesByEpisode = vi.fn();
const mockGetKeyframesByScene = vi.fn();
const mockGetFlipBooksByEpisode = vi.fn();
const mockGetFlipBookById = vi.fn();
const mockRegenerateKeyframe = vi.fn();

vi.mock("./benchmarks/d1-5/genga-director", () => ({
  generateRoughGenga: (...args: any[]) => mockGenerateRoughGenga(...args),
  generateCleanGenga: (...args: any[]) => mockGenerateCleanGenga(...args),
  assembleFlipBookPreview: (...args: any[]) => mockAssembleFlipBookPreview(...args),
  approveRoughGenga: (...args: any[]) => mockApproveRoughGenga(...args),
  approveCleanGenga: (...args: any[]) => mockApproveCleanGenga(...args),
  rejectGenga: (...args: any[]) => mockRejectGenga(...args),
  approveFlipBook: (...args: any[]) => mockApproveFlipBook(...args),
  getKeyframeById: (...args: any[]) => mockGetKeyframeById(...args),
  getKeyframesByEpisode: (...args: any[]) => mockGetKeyframesByEpisode(...args),
  getKeyframesByScene: (...args: any[]) => mockGetKeyframesByScene(...args),
  getFlipBooksByEpisode: (...args: any[]) => mockGetFlipBooksByEpisode(...args),
  getFlipBookById: (...args: any[]) => mockGetFlipBookById(...args),
  regenerateKeyframe: (...args: any[]) => mockRegenerateKeyframe(...args),
}));

// ─── D2.5 Sakuga Kantoku Mocks ─────────────────────────────────────────
const mockRunSakugaReview = vi.fn();
const mockGetReviewById = vi.fn();
const mockGetReviewsByEpisode = vi.fn();
const mockGetLatestReview = vi.fn();
const mockGetReviewsByProject = vi.fn();
const mockAcknowledgeReview = vi.fn();

vi.mock("./benchmarks/d2-5/sakuga-kantoku", () => ({
  runSakugaReview: (...args: any[]) => mockRunSakugaReview(...args),
  getReviewById: (...args: any[]) => mockGetReviewById(...args),
  getReviewsByEpisode: (...args: any[]) => mockGetReviewsByEpisode(...args),
  getLatestReview: (...args: any[]) => mockGetLatestReview(...args),
  getReviewsByProject: (...args: any[]) => mockGetReviewsByProject(...args),
  acknowledgeReview: (...args: any[]) => mockAcknowledgeReview(...args),
}));

// ─── Mock db module ─────────────────────────────────────────────────────
vi.mock("./db", () => ({
  getDb: vi.fn().mockResolvedValue({}),
}));

import { layoutDirectorRouter, gengaDirectorRouter, sakugaKantokuRouter } from "./routers-layout-genga-sakuga";

const userCtx = { user: { id: 1, name: "Test", role: "user" }, req: {} as any, res: {} as any };
const nullCtx = { user: null, req: {} as any, res: {} as any };

beforeEach(() => {
  vi.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════
// D1.25 Layout Director Tests
// ═══════════════════════════════════════════════════════════════════════════
describe("Layout Director Router", () => {
  describe("generate", () => {
    it("requires authentication", async () => {
      const caller = layoutDirectorRouter.createCaller(nullCtx);
      await expect(caller.generate({
        projectId: 1, episodeId: 1,
        scriptScenes: [], characters: [],
      })).rejects.toThrow();
    });

    it("calls generateLayouts with user context", async () => {
      mockGenerateLayouts.mockResolvedValue({ layouts: [], totalCost: 0.04 });
      const caller = layoutDirectorRouter.createCaller(userCtx);
      const result = await caller.generate({
        projectId: 1, episodeId: 1,
        scriptScenes: [{ sceneNumber: 1, location: "park", timeOfDay: "day", mood: "happy", description: "test", panels: [{ panelNumber: 1, visualDescription: "test", dialogue: [] }] }],
        characters: [{ id: 1, name: "Hero", role: "protagonist" }],
      });
      expect(mockGenerateLayouts).toHaveBeenCalledOnce();
      expect(result.totalCost).toBe(0.04);
    });
  });

  describe("getByEpisode", () => {
    it("returns layouts for episode", async () => {
      mockGetLayoutsByEpisode.mockResolvedValue([{ id: 1, sceneNumber: 1, panelNumber: 1 }]);
      const caller = layoutDirectorRouter.createCaller(userCtx);
      const result = await caller.getByEpisode({ episodeId: 1 });
      expect(result).toHaveLength(1);
    });
  });

  describe("getByScene", () => {
    it("returns layouts for specific scene", async () => {
      mockGetLayoutsByScene.mockResolvedValue([{ id: 1, panelNumber: 1 }]);
      const caller = layoutDirectorRouter.createCaller(userCtx);
      const result = await caller.getByScene({ episodeId: 1, sceneNumber: 1 });
      expect(result).toHaveLength(1);
    });
  });

  describe("getById", () => {
    it("returns layout by id", async () => {
      mockGetLayoutById.mockResolvedValue({ id: 1, cameraAngle: "wide" });
      const caller = layoutDirectorRouter.createCaller(userCtx);
      const result = await caller.getById({ id: 1 });
      expect(result.cameraAngle).toBe("wide");
    });

    it("throws NOT_FOUND for missing layout", async () => {
      mockGetLayoutById.mockResolvedValue(null);
      const caller = layoutDirectorRouter.createCaller(userCtx);
      await expect(caller.getById({ id: 999 })).rejects.toThrow("Layout not found");
    });
  });

  describe("approve", () => {
    it("approves a layout", async () => {
      mockApproveLayout.mockResolvedValue(true);
      const caller = layoutDirectorRouter.createCaller(userCtx);
      const result = await caller.approve({ id: 1 });
      expect(result.success).toBe(true);
    });

    it("throws on invalid approval", async () => {
      mockApproveLayout.mockResolvedValue(false);
      const caller = layoutDirectorRouter.createCaller(userCtx);
      await expect(caller.approve({ id: 1 })).rejects.toThrow("Cannot approve");
    });
  });

  describe("reject", () => {
    it("rejects a layout with reason", async () => {
      mockRejectLayout.mockResolvedValue(true);
      const caller = layoutDirectorRouter.createCaller(userCtx);
      const result = await caller.reject({ id: 1, reason: "Bad framing" });
      expect(result.success).toBe(true);
    });

    it("requires non-empty reason", async () => {
      const caller = layoutDirectorRouter.createCaller(userCtx);
      await expect(caller.reject({ id: 1, reason: "" })).rejects.toThrow();
    });
  });

  describe("updateComposition", () => {
    it("updates layout composition", async () => {
      mockUpdateLayoutComposition.mockResolvedValue(true);
      const caller = layoutDirectorRouter.createCaller(userCtx);
      const result = await caller.updateComposition({
        id: 1, updates: { cameraAngle: "close_up" },
      });
      expect(result.success).toBe(true);
    });
  });

  describe("approveAll", () => {
    it("approves all layouts for episode", async () => {
      mockApproveAllLayoutsForEpisode.mockResolvedValue(5);
      const caller = layoutDirectorRouter.createCaller(userCtx);
      const result = await caller.approveAll({ episodeId: 1 });
      expect(result.approved).toBe(5);
    });
  });

  describe("cameraAngles", () => {
    it("returns camera angle vocabulary", async () => {
      const caller = layoutDirectorRouter.createCaller(nullCtx);
      const result = await caller.cameraAngles();
      expect(result).toContain("wide");
      expect(result).toContain("dutch_angle");
      expect(result).toHaveLength(8);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// D1.5 Genga Director Tests
// ═══════════════════════════════════════════════════════════════════════════
describe("Genga Director Router", () => {
  describe("generateRough", () => {
    it("requires authentication", async () => {
      const caller = gengaDirectorRouter.createCaller(nullCtx);
      await expect(caller.generateRough({
        projectId: 1, episodeId: 1, layouts: [], characterSheets: [],
      })).rejects.toThrow();
    });

    it("generates rough genga from layouts", async () => {
      mockGenerateRoughGenga.mockResolvedValue({
        keyframes: [{ keyframeId: 1, sceneNumber: 1, panelNumber: 1, roughGengaUrl: "url", status: "rough_ready" }],
        totalCost: 0.05,
      });
      const caller = gengaDirectorRouter.createCaller(userCtx);
      const result = await caller.generateRough({
        projectId: 1, episodeId: 1,
        layouts: [{ layoutId: 1, sceneNumber: 1, panelNumber: 1, cameraAngle: "wide", characterPlacements: [], depthLayers: {} }],
        characterSheets: [{ characterId: 1, name: "Hero" }],
      });
      expect(result.keyframes).toHaveLength(1);
      expect(result.totalCost).toBe(0.05);
    });
  });

  describe("generateClean", () => {
    it("generates clean genga from approved rough", async () => {
      mockGenerateCleanGenga.mockResolvedValue({ cleanGengaUrl: "clean-url", cost: 0.10 });
      const caller = gengaDirectorRouter.createCaller(userCtx);
      const result = await caller.generateClean({ keyframeId: 1, projectId: 1 });
      expect(result.cleanGengaUrl).toBe("clean-url");
    });
  });

  describe("assembleFlipBook", () => {
    it("assembles flip-book preview", async () => {
      mockAssembleFlipBookPreview.mockResolvedValue({ previewId: 1, frameCount: 5 });
      const caller = gengaDirectorRouter.createCaller(userCtx);
      const result = await caller.assembleFlipBook({ projectId: 1, episodeId: 1, sceneNumber: 1 });
      expect(result.frameCount).toBe(5);
    });
  });

  describe("approveRough", () => {
    it("approves rough genga", async () => {
      mockApproveRoughGenga.mockResolvedValue(true);
      const caller = gengaDirectorRouter.createCaller(userCtx);
      const result = await caller.approveRough({ keyframeId: 1 });
      expect(result.success).toBe(true);
    });

    it("throws on invalid approval", async () => {
      mockApproveRoughGenga.mockResolvedValue(false);
      const caller = gengaDirectorRouter.createCaller(userCtx);
      await expect(caller.approveRough({ keyframeId: 1 })).rejects.toThrow("Cannot approve");
    });
  });

  describe("approveClean", () => {
    it("approves clean genga", async () => {
      mockApproveCleanGenga.mockResolvedValue(true);
      const caller = gengaDirectorRouter.createCaller(userCtx);
      const result = await caller.approveClean({ keyframeId: 1 });
      expect(result.success).toBe(true);
    });
  });

  describe("reject", () => {
    it("rejects a keyframe with reason", async () => {
      mockRejectGenga.mockResolvedValue(true);
      const caller = gengaDirectorRouter.createCaller(userCtx);
      const result = await caller.reject({ keyframeId: 1, reason: "Proportions off" });
      expect(result.success).toBe(true);
    });
  });

  describe("approveFlipBook", () => {
    it("approves flip-book preview", async () => {
      mockApproveFlipBook.mockResolvedValue(true);
      const caller = gengaDirectorRouter.createCaller(userCtx);
      const result = await caller.approveFlipBook({ previewId: 1 });
      expect(result.success).toBe(true);
    });
  });

  describe("regenerate", () => {
    it("regenerates a keyframe", async () => {
      mockRegenerateKeyframe.mockResolvedValue({
        keyframeId: 1, sceneNumber: 1, panelNumber: 1, roughGengaUrl: "new-url", status: "rough_ready",
      });
      const caller = gengaDirectorRouter.createCaller(userCtx);
      const result = await caller.regenerate({ keyframeId: 1, projectId: 1 });
      expect(result.roughGengaUrl).toBe("new-url");
    });
  });

  describe("getById", () => {
    it("returns keyframe by id", async () => {
      mockGetKeyframeById.mockResolvedValue({ id: 1, status: "rough_ready" });
      const caller = gengaDirectorRouter.createCaller(userCtx);
      const result = await caller.getById({ id: 1 });
      expect(result.status).toBe("rough_ready");
    });

    it("throws NOT_FOUND for missing keyframe", async () => {
      mockGetKeyframeById.mockResolvedValue(null);
      const caller = gengaDirectorRouter.createCaller(userCtx);
      await expect(caller.getById({ id: 999 })).rejects.toThrow("Keyframe not found");
    });
  });

  describe("getByEpisode", () => {
    it("returns keyframes for episode", async () => {
      mockGetKeyframesByEpisode.mockResolvedValue([{ id: 1 }, { id: 2 }]);
      const caller = gengaDirectorRouter.createCaller(userCtx);
      const result = await caller.getByEpisode({ episodeId: 1 });
      expect(result).toHaveLength(2);
    });
  });

  describe("getFlipBooks", () => {
    it("returns flip-books for episode", async () => {
      mockGetFlipBooksByEpisode.mockResolvedValue([{ id: 1, frameCount: 5 }]);
      const caller = gengaDirectorRouter.createCaller(userCtx);
      const result = await caller.getFlipBooks({ episodeId: 1 });
      expect(result).toHaveLength(1);
    });
  });

  describe("getFlipBookById", () => {
    it("throws NOT_FOUND for missing flip-book", async () => {
      mockGetFlipBookById.mockResolvedValue(null);
      const caller = gengaDirectorRouter.createCaller(userCtx);
      await expect(caller.getFlipBookById({ id: 999 })).rejects.toThrow("Flip-book not found");
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// D2.5 Sakuga Kantoku Tests
// ═══════════════════════════════════════════════════════════════════════════
describe("Sakuga Kantoku Router", () => {
  describe("runReview", () => {
    it("requires authentication", async () => {
      const caller = sakugaKantokuRouter.createCaller(nullCtx);
      await expect(caller.runReview({
        projectId: 1, episodeId: 1, keyframes: [], characters: [],
      })).rejects.toThrow();
    });

    it("runs a sakuga review", async () => {
      mockRunSakugaReview.mockResolvedValue({
        reviewId: 1,
        punchList: [
          { type: "character_scale_drift", severity: "warning", sceneNumber: 1, panelNumber: 2, description: "Hero is 10% larger", affectedCharacters: ["Hero"], suggestion: "Scale down" },
        ],
        scores: { overall: 78, characterConsistency: 72, perspective: 85, motionArc: 80, colorConsistency: 75 },
        totalCost: 0.40,
      });
      const caller = sakugaKantokuRouter.createCaller(userCtx);
      const result = await caller.runReview({
        projectId: 1, episodeId: 1,
        keyframes: [
          { sceneNumber: 1, panelNumber: 1, cameraAngle: "wide" },
          { sceneNumber: 1, panelNumber: 2, cameraAngle: "medium" },
        ],
        characters: [{ name: "Hero" }],
      });
      expect(result.punchList).toHaveLength(1);
      expect(result.scores.overall).toBe(78);
      expect(result.totalCost).toBe(0.40);
    });
  });

  describe("getById", () => {
    it("returns review by id", async () => {
      mockGetReviewById.mockResolvedValue({ id: 1, issueCount: 3, overallScore: "78.00" });
      const caller = sakugaKantokuRouter.createCaller(userCtx);
      const result = await caller.getById({ id: 1 });
      expect(result.issueCount).toBe(3);
    });

    it("throws NOT_FOUND for missing review", async () => {
      mockGetReviewById.mockResolvedValue(null);
      const caller = sakugaKantokuRouter.createCaller(userCtx);
      await expect(caller.getById({ id: 999 })).rejects.toThrow("Review not found");
    });
  });

  describe("getByEpisode", () => {
    it("returns reviews for episode", async () => {
      mockGetReviewsByEpisode.mockResolvedValue([{ id: 1 }, { id: 2 }]);
      const caller = sakugaKantokuRouter.createCaller(userCtx);
      const result = await caller.getByEpisode({ episodeId: 1 });
      expect(result).toHaveLength(2);
    });
  });

  describe("getLatest", () => {
    it("returns latest review for episode", async () => {
      mockGetLatestReview.mockResolvedValue({ id: 2, overallScore: "85.00" });
      const caller = sakugaKantokuRouter.createCaller(userCtx);
      const result = await caller.getLatest({ episodeId: 1 });
      expect(result?.id).toBe(2);
    });

    it("returns null when no reviews exist", async () => {
      mockGetLatestReview.mockResolvedValue(null);
      const caller = sakugaKantokuRouter.createCaller(userCtx);
      const result = await caller.getLatest({ episodeId: 999 });
      expect(result).toBeNull();
    });
  });

  describe("getByProject", () => {
    it("returns reviews for project", async () => {
      mockGetReviewsByProject.mockResolvedValue([{ id: 1 }]);
      const caller = sakugaKantokuRouter.createCaller(userCtx);
      const result = await caller.getByProject({ projectId: 1 });
      expect(result).toHaveLength(1);
    });
  });

  describe("acknowledge", () => {
    it("acknowledges a review", async () => {
      mockAcknowledgeReview.mockResolvedValue(true);
      const caller = sakugaKantokuRouter.createCaller(userCtx);
      const result = await caller.acknowledge({ reviewId: 1 });
      expect(result.success).toBe(true);
    });

    it("throws on invalid acknowledgment", async () => {
      mockAcknowledgeReview.mockResolvedValue(false);
      const caller = sakugaKantokuRouter.createCaller(userCtx);
      await expect(caller.acknowledge({ reviewId: 1 })).rejects.toThrow("Cannot acknowledge");
    });
  });
});
