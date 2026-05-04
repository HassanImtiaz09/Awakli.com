import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the style-bundles module
const mockListActiveBundles = vi.fn();
const mockListAllBundles = vi.fn();
const mockGetBundleByGenreKey = vi.fn();
const mockGetBundleById = vi.fn();
const mockCreateBundle = vi.fn();
const mockUpdateBundle = vi.fn();
const mockDeactivateBundle = vi.fn();

vi.mock("./benchmarks/d0/style-bundles", () => ({
  listActiveBundles: (...args: any[]) => mockListActiveBundles(...args),
  listAllBundles: (...args: any[]) => mockListAllBundles(...args),
  getBundleByGenreKey: (...args: any[]) => mockGetBundleByGenreKey(...args),
  getBundleById: (...args: any[]) => mockGetBundleById(...args),
  createBundle: (...args: any[]) => mockCreateBundle(...args),
  updateBundle: (...args: any[]) => mockUpdateBundle(...args),
  deactivateBundle: (...args: any[]) => mockDeactivateBundle(...args),
}));

// Sample test data
const sampleBundle = {
  id: 1,
  genreKey: "shonen",
  name: "Shonen",
  description: "Bold action-driven style",
  aestheticNotes: null,
  promptTemplate: "shonen anime style, dynamic action poses",
  negativePrompt: "static poses, muted colors",
  colorPalette: { primary: "#FF6B35", secondary: "#1A1A2E", accent: "#FFD700", background: "#0F0F23", highlight: "#FF4444", shadow: "#0A0A1A" },
  frameRateDefault: 12,
  referenceImageUrls: null,
  musicMoodVector: { energy: 0.85, valence: 0.7, tempo_bpm: 140, instrumentation_tags: ["electric_guitar", "drums"] },
  loraConfig: { model_id: null, trigger_word: "shonen_style", weight_range: [0.6, 0.9], compatible_bases: ["sdxl", "flux"] },
  previewImageUrl: null,
  iconIdentifier: "sword",
  isActive: 1,
  sortOrder: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const sampleBundle2 = {
  ...sampleBundle,
  id: 2,
  genreKey: "seinen",
  name: "Seinen",
  description: "Mature, detailed art",
  sortOrder: 2,
};

describe("Style Bundles Router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("listActive", () => {
    it("returns active bundles ordered by sortOrder", async () => {
      mockListActiveBundles.mockResolvedValue([sampleBundle, sampleBundle2]);

      const { styleBundlesRouter } = await import("./routers-style-bundles");
      const caller = styleBundlesRouter.createCaller({ user: null, req: {} as any, res: {} as any });
      const result = await caller.listActive();

      expect(result).toHaveLength(2);
      expect(result[0].genreKey).toBe("shonen");
      expect(result[1].genreKey).toBe("seinen");
      expect(mockListActiveBundles).toHaveBeenCalledOnce();
    });

    it("returns empty array when no bundles exist", async () => {
      mockListActiveBundles.mockResolvedValue([]);

      const { styleBundlesRouter } = await import("./routers-style-bundles");
      const caller = styleBundlesRouter.createCaller({ user: null, req: {} as any, res: {} as any });
      const result = await caller.listActive();

      expect(result).toEqual([]);
    });
  });

  describe("getByGenreKey", () => {
    it("returns bundle for valid genre key", async () => {
      mockGetBundleByGenreKey.mockResolvedValue(sampleBundle);

      const { styleBundlesRouter } = await import("./routers-style-bundles");
      const caller = styleBundlesRouter.createCaller({
        user: { id: 1, role: "user", name: "Test", openId: "test" },
        req: {} as any,
        res: {} as any,
      });
      const result = await caller.getByGenreKey({ genreKey: "shonen" });

      expect(result.genreKey).toBe("shonen");
      expect(result.promptTemplate).toContain("shonen");
      expect(mockGetBundleByGenreKey).toHaveBeenCalledWith("shonen");
    });

    it("throws NOT_FOUND for missing genre key", async () => {
      mockGetBundleByGenreKey.mockResolvedValue(null);

      const { styleBundlesRouter } = await import("./routers-style-bundles");
      const caller = styleBundlesRouter.createCaller({
        user: { id: 1, role: "user", name: "Test", openId: "test" },
        req: {} as any,
        res: {} as any,
      });

      await expect(caller.getByGenreKey({ genreKey: "nonexistent" })).rejects.toThrow("not found");
    });
  });

  describe("Admin operations", () => {
    const adminCtx = {
      user: { id: 1, role: "admin" as const, name: "Admin", openId: "admin" },
      req: {} as any,
      res: {} as any,
    };

    const userCtx = {
      user: { id: 2, role: "user" as const, name: "User", openId: "user" },
      req: {} as any,
      res: {} as any,
    };

    it("listAll returns all bundles for admin", async () => {
      mockListAllBundles.mockResolvedValue([sampleBundle, { ...sampleBundle2, isActive: 0 }]);

      const { styleBundlesRouter } = await import("./routers-style-bundles");
      const caller = styleBundlesRouter.createCaller(adminCtx);
      const result = await caller.listAll();

      expect(result).toHaveLength(2);
      expect(mockListAllBundles).toHaveBeenCalledOnce();
    });

    it("listAll throws FORBIDDEN for non-admin", async () => {
      const { styleBundlesRouter } = await import("./routers-style-bundles");
      const caller = styleBundlesRouter.createCaller(userCtx);

      await expect(caller.listAll()).rejects.toThrow("Admin access required");
    });

    it("create creates a bundle for admin", async () => {
      mockCreateBundle.mockResolvedValue({ id: 3 });

      const { styleBundlesRouter } = await import("./routers-style-bundles");
      const caller = styleBundlesRouter.createCaller(adminCtx);
      const result = await caller.create({
        genreKey: "chibi",
        name: "Chibi",
        promptTemplate: "chibi anime style, super deformed",
        negativePrompt: "realistic proportions",
        colorPalette: { primary: "#FF69B4", secondary: "#FFD700", accent: "#87CEEB", background: "#FFF0F5", highlight: "#FFFFFF", shadow: "#DDA0DD" },
      });

      expect(result.success).toBe(true);
      expect(result.id).toBe(3);
    });

    it("create rejects invalid genre key format", async () => {
      const { styleBundlesRouter } = await import("./routers-style-bundles");
      const caller = styleBundlesRouter.createCaller(adminCtx);

      await expect(caller.create({
        genreKey: "Invalid Key!",
        name: "Test",
        promptTemplate: "test",
        negativePrompt: "test",
        colorPalette: { primary: "#FF0000", secondary: "#00FF00", accent: "#0000FF", background: "#000000", highlight: "#FFFFFF", shadow: "#333333" },
      })).rejects.toThrow();
    });

    it("update updates a bundle for admin", async () => {
      mockUpdateBundle.mockResolvedValue(true);

      const { styleBundlesRouter } = await import("./routers-style-bundles");
      const caller = styleBundlesRouter.createCaller(adminCtx);
      const result = await caller.update({
        id: 1,
        name: "Shonen Updated",
        frameRateDefault: 24,
      });

      expect(result.success).toBe(true);
      expect(mockUpdateBundle).toHaveBeenCalledWith(1, { name: "Shonen Updated", frameRateDefault: 24 });
    });

    it("deactivate deactivates a bundle for admin", async () => {
      mockDeactivateBundle.mockResolvedValue(true);

      const { styleBundlesRouter } = await import("./routers-style-bundles");
      const caller = styleBundlesRouter.createCaller(adminCtx);
      const result = await caller.deactivate({ id: 1 });

      expect(result.success).toBe(true);
      expect(mockDeactivateBundle).toHaveBeenCalledWith(1);
    });

    it("deactivate throws FORBIDDEN for non-admin", async () => {
      const { styleBundlesRouter } = await import("./routers-style-bundles");
      const caller = styleBundlesRouter.createCaller(userCtx);

      await expect(caller.deactivate({ id: 1 })).rejects.toThrow("Admin access required");
    });
  });

  describe("Bundle data structure", () => {
    it("colorPalette has all required fields", () => {
      const palette = sampleBundle.colorPalette;
      expect(palette).toHaveProperty("primary");
      expect(palette).toHaveProperty("secondary");
      expect(palette).toHaveProperty("accent");
      expect(palette).toHaveProperty("background");
      expect(palette).toHaveProperty("highlight");
      expect(palette).toHaveProperty("shadow");
    });

    it("musicMoodVector has valid ranges", () => {
      const mood = sampleBundle.musicMoodVector;
      expect(mood.energy).toBeGreaterThanOrEqual(0);
      expect(mood.energy).toBeLessThanOrEqual(1);
      expect(mood.valence).toBeGreaterThanOrEqual(0);
      expect(mood.valence).toBeLessThanOrEqual(1);
      expect(mood.tempo_bpm).toBeGreaterThan(0);
      expect(mood.instrumentation_tags).toBeInstanceOf(Array);
    });

    it("loraConfig has null model_id (placeholder)", () => {
      const lora = sampleBundle.loraConfig;
      expect(lora.model_id).toBeNull();
      expect(lora.trigger_word).toBeTruthy();
      expect(lora.weight_range).toHaveLength(2);
      expect(lora.compatible_bases).toContain("sdxl");
    });
  });
});
