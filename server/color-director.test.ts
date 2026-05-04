import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock the color-director module functions ─────────────────────────
const mockGenerateColorScript = vi.fn();
const mockGetColorScriptByEpisode = vi.fn();
const mockGetColorScriptById = vi.fn();
const mockGetColorScriptsByProject = vi.fn();
const mockApproveColorScript = vi.fn();
const mockRejectColorScript = vi.fn();
const mockLockPalettes = vi.fn();
const mockUnlockPalettes = vi.fn();
const mockUpdateCharacterPalette = vi.fn();
const mockUpdateScenePalette = vi.fn();
const mockGetCharacterColorPalette = vi.fn();
const mockGetSceneColorPalette = vi.fn();
const mockGetSceneMoodPoint = vi.fn();
const mockArePalettesLocked = vi.fn();

vi.mock("./benchmarks/d6/color-director", () => ({
  generateColorScript: (...args: any[]) => mockGenerateColorScript(...args),
  getColorScriptByEpisode: (...args: any[]) => mockGetColorScriptByEpisode(...args),
  getColorScriptById: (...args: any[]) => mockGetColorScriptById(...args),
  getColorScriptsByProject: (...args: any[]) => mockGetColorScriptsByProject(...args),
  approveColorScript: (...args: any[]) => mockApproveColorScript(...args),
  rejectColorScript: (...args: any[]) => mockRejectColorScript(...args),
  lockPalettes: (...args: any[]) => mockLockPalettes(...args),
  unlockPalettes: (...args: any[]) => mockUnlockPalettes(...args),
  updateCharacterPalette: (...args: any[]) => mockUpdateCharacterPalette(...args),
  updateScenePalette: (...args: any[]) => mockUpdateScenePalette(...args),
  getCharacterColorPalette: (...args: any[]) => mockGetCharacterColorPalette(...args),
  getSceneColorPalette: (...args: any[]) => mockGetSceneColorPalette(...args),
  getSceneMoodPoint: (...args: any[]) => mockGetSceneMoodPoint(...args),
  arePalettesLocked: (...args: any[]) => mockArePalettesLocked(...args),
}));

import { appRouter } from "./routers";

// ─── Sample Data ──────────────────────────────────────────────────────
const sampleColorScript = {
  id: 1,
  projectId: 1,
  episodeId: 1,
  characterPalettes: [{
    characterId: 1,
    characterName: "Hero",
    primary: "#FF4444",
    secondary: "#4444FF",
    accent: "#44FF44",
    skin: "#F5D0B0",
    hair: "#1A1A2E",
    eyes: "#7C4DFF",
    outline: "#000000",
  }],
  scenePalettes: [{
    sceneNumber: 1,
    background: "#0D0D1A",
    midground: "#1A1A2E",
    foreground: "#2A2A3E",
    ambient: "#1A1A2E",
    lighting: "#FFE4B5",
    accent: "#00E5FF",
    timeOfDay: "noon",
    weather: "clear",
  }],
  moodProgression: [{
    sceneNumber: 1,
    warmth: 0.6,
    saturation: 0.8,
    brightness: 0.7,
    dominantHue: "#FF4444",
    mood: "action",
  }],
  paletteLock: { locked: false, lockedBy: null, lockedAt: null, lockedPalettes: [] },
  styleBundleKey: "shonen",
  generationCostUsd: "0.0800",
  status: "generated",
  approvedAt: null,
  rejectedReason: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ─── Test Contexts ────────────────────────────────────────────────────
const authedCtx = {
  user: { id: 1, name: "Test User", role: "admin" as const, openId: "test-open-id" },
  req: { headers: { origin: "http://localhost:3000" } } as any,
  res: {} as any,
};

const unauthCtx = {
  user: null,
  req: { headers: {} } as any,
  res: {} as any,
};

function createCaller(ctx: any) {
  return appRouter.createCaller(ctx);
}

// ─── Tests ────────────────────────────────────────────────────────────

describe("Color Director Router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("generate", () => {
    it("requires authentication", async () => {
      const caller = createCaller(unauthCtx);
      await expect(
        caller.colorDirector.generate({ projectId: 1, episodeId: 1 })
      ).rejects.toThrow();
    });

    it("generates a color script for authenticated user", async () => {
      mockGenerateColorScript.mockResolvedValue({
        colorScriptId: 1,
        characterPalettes: sampleColorScript.characterPalettes,
        scenePalettes: sampleColorScript.scenePalettes,
        moodProgression: sampleColorScript.moodProgression,
        costUsd: 0.08,
      });

      const caller = createCaller(authedCtx);
      const result = await caller.colorDirector.generate({
        projectId: 1,
        episodeId: 1,
        styleBundleKey: "shonen",
      });

      expect(result.colorScriptId).toBe(1);
      expect(result.characterPalettes).toHaveLength(1);
      expect(result.scenePalettes).toHaveLength(1);
      expect(result.moodProgression).toHaveLength(1);
      expect(result.costUsd).toBe(0.08);
      expect(mockGenerateColorScript).toHaveBeenCalledWith({
        projectId: 1,
        episodeId: 1,
        userId: 1,
        styleBundleKey: "shonen",
      });
    });
  });

  describe("getByEpisode", () => {
    it("requires authentication", async () => {
      const caller = createCaller(unauthCtx);
      await expect(
        caller.colorDirector.getByEpisode({ episodeId: 1 })
      ).rejects.toThrow();
    });

    it("returns null when no color script exists", async () => {
      mockGetColorScriptByEpisode.mockResolvedValue(null);
      const caller = createCaller(authedCtx);
      const result = await caller.colorDirector.getByEpisode({ episodeId: 999 });
      expect(result).toBeNull();
    });

    it("returns formatted color script when it exists", async () => {
      mockGetColorScriptByEpisode.mockResolvedValue(sampleColorScript);
      const caller = createCaller(authedCtx);
      const result = await caller.colorDirector.getByEpisode({ episodeId: 1 });
      expect(result).not.toBeNull();
      expect(result!.status).toBe("generated");
      expect(result!.generationCostUsd).toBe(0.08);
      expect(result!.characterPalettes).toHaveLength(1);
    });
  });

  describe("getById", () => {
    it("throws NOT_FOUND for missing color script", async () => {
      mockGetColorScriptById.mockResolvedValue(null);
      const caller = createCaller(authedCtx);
      await expect(
        caller.colorDirector.getById({ id: 999 })
      ).rejects.toThrow("Color script not found");
    });

    it("returns color script by ID", async () => {
      mockGetColorScriptById.mockResolvedValue(sampleColorScript);
      const caller = createCaller(authedCtx);
      const result = await caller.colorDirector.getById({ id: 1 });
      expect(result.id).toBe(1);
      expect(result.status).toBe("generated");
    });
  });

  describe("listByProject", () => {
    it("returns all color scripts for a project", async () => {
      mockGetColorScriptsByProject.mockResolvedValue([sampleColorScript]);
      const caller = createCaller(authedCtx);
      const result = await caller.colorDirector.listByProject({ projectId: 1 });
      expect(result).toHaveLength(1);
    });
  });

  describe("approve", () => {
    it("requires authentication", async () => {
      const caller = createCaller(unauthCtx);
      await expect(
        caller.colorDirector.approve({ id: 1 })
      ).rejects.toThrow();
    });

    it("approves a generated color script", async () => {
      mockApproveColorScript.mockResolvedValue(true);
      const caller = createCaller(authedCtx);
      const result = await caller.colorDirector.approve({ id: 1 });
      expect(result.success).toBe(true);
      expect(mockApproveColorScript).toHaveBeenCalledWith(1, 1);
    });

    it("rejects approval of non-generated script", async () => {
      mockApproveColorScript.mockResolvedValue(false);
      const caller = createCaller(authedCtx);
      await expect(
        caller.colorDirector.approve({ id: 1 })
      ).rejects.toThrow("Cannot approve");
    });
  });

  describe("reject", () => {
    it("validates reason is provided", async () => {
      const caller = createCaller(authedCtx);
      await expect(
        caller.colorDirector.reject({ id: 1, reason: "" })
      ).rejects.toThrow();
    });

    it("rejects a color script with reason", async () => {
      mockRejectColorScript.mockResolvedValue(true);
      const caller = createCaller(authedCtx);
      const result = await caller.colorDirector.reject({
        id: 1,
        reason: "Colors too muted for shonen genre",
      });
      expect(result.success).toBe(true);
    });

    it("throws when script not found", async () => {
      mockRejectColorScript.mockResolvedValue(false);
      const caller = createCaller(authedCtx);
      await expect(
        caller.colorDirector.reject({ id: 999, reason: "Bad colors" })
      ).rejects.toThrow("Cannot reject");
    });
  });

  describe("lockPalettes", () => {
    it("requires at least one palette group", async () => {
      const caller = createCaller(authedCtx);
      await expect(
        caller.colorDirector.lockPalettes({ id: 1, palettes: [] })
      ).rejects.toThrow();
    });

    it("validates palette group names", async () => {
      const caller = createCaller(authedCtx);
      await expect(
        caller.colorDirector.lockPalettes({ id: 1, palettes: ["invalid" as any] })
      ).rejects.toThrow();
    });

    it("locks valid palette groups", async () => {
      mockLockPalettes.mockResolvedValue(true);
      const caller = createCaller(authedCtx);
      const result = await caller.colorDirector.lockPalettes({
        id: 1,
        palettes: ["characters", "scenes"],
      });
      expect(result.success).toBe(true);
      expect(mockLockPalettes).toHaveBeenCalledWith(1, 1, ["characters", "scenes"]);
    });

    it("fails for non-approved script", async () => {
      mockLockPalettes.mockResolvedValue(false);
      const caller = createCaller(authedCtx);
      await expect(
        caller.colorDirector.lockPalettes({ id: 1, palettes: ["characters"] })
      ).rejects.toThrow("Cannot lock");
    });
  });

  describe("unlockPalettes", () => {
    it("unlocks locked palettes", async () => {
      mockUnlockPalettes.mockResolvedValue(true);
      const caller = createCaller(authedCtx);
      const result = await caller.colorDirector.unlockPalettes({ id: 1 });
      expect(result.success).toBe(true);
    });

    it("fails for non-locked script", async () => {
      mockUnlockPalettes.mockResolvedValue(false);
      const caller = createCaller(authedCtx);
      await expect(
        caller.colorDirector.unlockPalettes({ id: 1 })
      ).rejects.toThrow("Cannot unlock");
    });
  });

  describe("updateCharacterPalette", () => {
    it("validates hex color format", async () => {
      const caller = createCaller(authedCtx);
      await expect(
        caller.colorDirector.updateCharacterPalette({
          colorScriptId: 1,
          characterId: 1,
          updates: { primary: "not-a-hex" },
        })
      ).rejects.toThrow();
    });

    it("accepts valid hex colors", async () => {
      mockUpdateCharacterPalette.mockResolvedValue(true);
      const caller = createCaller(authedCtx);
      const result = await caller.colorDirector.updateCharacterPalette({
        colorScriptId: 1,
        characterId: 1,
        updates: { primary: "#AA0000", eyes: "#00AAFF" },
      });
      expect(result.success).toBe(true);
    });

    it("fails for missing character", async () => {
      mockUpdateCharacterPalette.mockResolvedValue(false);
      const caller = createCaller(authedCtx);
      await expect(
        caller.colorDirector.updateCharacterPalette({
          colorScriptId: 1,
          characterId: 999,
          updates: { primary: "#AA0000" },
        })
      ).rejects.toThrow("Failed to update");
    });
  });

  describe("updateScenePalette", () => {
    it("validates hex color format", async () => {
      const caller = createCaller(authedCtx);
      await expect(
        caller.colorDirector.updateScenePalette({
          colorScriptId: 1,
          sceneNumber: 1,
          updates: { background: "invalid" },
        })
      ).rejects.toThrow();
    });

    it("accepts valid scene palette updates", async () => {
      mockUpdateScenePalette.mockResolvedValue(true);
      const caller = createCaller(authedCtx);
      const result = await caller.colorDirector.updateScenePalette({
        colorScriptId: 1,
        sceneNumber: 1,
        updates: { background: "#1A1A2E", timeOfDay: "dusk" },
      });
      expect(result.success).toBe(true);
    });
  });

  describe("integration queries", () => {
    it("getCharacterPalette returns null for missing script", async () => {
      mockGetCharacterColorPalette.mockResolvedValue(null);
      const caller = createCaller(authedCtx);
      const result = await caller.colorDirector.getCharacterPalette({
        episodeId: 1,
        characterId: 1,
      });
      expect(result).toBeNull();
    });

    it("getCharacterPalette returns palette for valid request", async () => {
      mockGetCharacterColorPalette.mockResolvedValue({
        characterId: 1,
        characterName: "Hero",
        primary: "#FF4444",
      });
      const caller = createCaller(authedCtx);
      const result = await caller.colorDirector.getCharacterPalette({
        episodeId: 1,
        characterId: 1,
      });
      expect(result).not.toBeNull();
      expect(result!.primary).toBe("#FF4444");
    });

    it("getScenePalette returns null for missing script", async () => {
      mockGetSceneColorPalette.mockResolvedValue(null);
      const caller = createCaller(authedCtx);
      const result = await caller.colorDirector.getScenePalette({
        episodeId: 1,
        sceneNumber: 1,
      });
      expect(result).toBeNull();
    });

    it("isLocked returns false for missing script", async () => {
      mockArePalettesLocked.mockResolvedValue(false);
      const caller = createCaller(authedCtx);
      const result = await caller.colorDirector.isLocked({ episodeId: 1 });
      expect(result.locked).toBe(false);
    });

    it("isLocked returns true for locked script", async () => {
      mockArePalettesLocked.mockResolvedValue(true);
      const caller = createCaller(authedCtx);
      const result = await caller.colorDirector.isLocked({ episodeId: 1 });
      expect(result.locked).toBe(true);
    });
  });
});
