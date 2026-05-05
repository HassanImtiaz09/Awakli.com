/**
 * D9 Sakufuu Tracker — Pipeline Integration Tests
 * Wave 4.5 hotfix: verifies D9 is callable from the pipeline
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { injectSakufuuBias, recordSakufuuMemory } from "./sakufuu-pipeline";

// Mock database functions
vi.mock("../../db.js", () => ({
  getEpisodeById: vi.fn(),
  getEpisodesByProject: vi.fn(),
  getPipelineAssetsByRun: vi.fn(),
  getPanelsByEpisode: vi.fn(),
}));

import { getEpisodeById, getEpisodesByProject, getPipelineAssetsByRun, getPanelsByEpisode } from "../../db.js";

const mockGetEpisodeById = vi.mocked(getEpisodeById);
const mockGetEpisodesByProject = vi.mocked(getEpisodesByProject);
const mockGetPipelineAssetsByRun = vi.mocked(getPipelineAssetsByRun);
const mockGetPanelsByEpisode = vi.mocked(getPanelsByEpisode);

describe("D9 Sakufuu Pipeline Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("injectSakufuuBias (Pre-Generation Stage 2)", () => {
    it("returns empty bias for episode 1 (no prior data)", async () => {
      mockGetEpisodeById.mockResolvedValue({ id: 1, episodeNumber: 1, status: "pipeline" } as any);
      mockGetEpisodesByProject.mockResolvedValue([
        { id: 1, episodeNumber: 1, status: "pipeline" },
      ] as any);

      const result = await injectSakufuuBias({
        pipelineRunId: 100,
        episodeId: 1,
        projectId: 10,
      });

      expect(result.bias.active).toBe(false);
      expect(result.episodeNumber).toBe(1);
      expect(result.priorEpisodeCount).toBe(0);
      expect(result.bias.signatureFx).toEqual([]);
      expect(result.bias.suggestedPalette).toEqual([]);
      expect(result.bias.suggestedCameraStyle).toEqual({});
    });

    it("returns empty bias when episode not found", async () => {
      mockGetEpisodeById.mockResolvedValue(undefined);

      const result = await injectSakufuuBias({
        pipelineRunId: 100,
        episodeId: 999,
        projectId: 10,
      });

      expect(result.bias.active).toBe(false);
      expect(result.episodeNumber).toBe(1);
    });

    it("returns active bias for episode 2+ with prior data", async () => {
      mockGetEpisodeById.mockResolvedValue({ id: 2, episodeNumber: 2, status: "pipeline" } as any);
      mockGetEpisodesByProject.mockResolvedValue([
        { id: 1, episodeNumber: 1, status: "published" },
        { id: 2, episodeNumber: 2, status: "pipeline" },
      ] as any);
      // Prior episode has panels with camera angles
      mockGetPanelsByEpisode.mockResolvedValue([
        { id: 1, cameraAngle: "close_up", transition: "cut" },
        { id: 2, cameraAngle: "wide", transition: "fade" },
        { id: 3, cameraAngle: "close_up", transition: "cut" },
        { id: 4, cameraAngle: "medium", transition: "dissolve" },
        { id: 5, cameraAngle: "close_up", transition: "cut" },
        { id: 6, cameraAngle: "wide", transition: "fade" },
      ] as any);

      const result = await injectSakufuuBias({
        pipelineRunId: 101,
        episodeId: 2,
        projectId: 10,
      });

      expect(result.bias.active).toBe(true);
      expect(result.episodeNumber).toBe(2);
      expect(result.priorEpisodeCount).toBe(1);
      // Camera style should reflect prior episode's distribution
      expect(result.bias.suggestedCameraStyle).toBeDefined();
      expect(Object.keys(result.bias.suggestedCameraStyle).length).toBeGreaterThan(0);
    });

    it("excludes draft episodes from prior data", async () => {
      mockGetEpisodeById.mockResolvedValue({ id: 3, episodeNumber: 3, status: "pipeline" } as any);
      mockGetEpisodesByProject.mockResolvedValue([
        { id: 1, episodeNumber: 1, status: "published" },
        { id: 2, episodeNumber: 2, status: "draft" }, // Should be excluded
        { id: 3, episodeNumber: 3, status: "pipeline" },
      ] as any);
      mockGetPanelsByEpisode.mockResolvedValue([
        { id: 1, cameraAngle: "medium", transition: "cut" },
        { id: 2, cameraAngle: "close_up", transition: "fade" },
        { id: 3, cameraAngle: "wide", transition: "cut" },
        { id: 4, cameraAngle: "medium", transition: "cut" },
        { id: 5, cameraAngle: "medium", transition: "dissolve" },
        { id: 6, cameraAngle: "close_up", transition: "cut" },
      ] as any);

      const result = await injectSakufuuBias({
        pipelineRunId: 102,
        episodeId: 3,
        projectId: 10,
      });

      // Only episode 1 (published) counts as prior data
      expect(result.priorEpisodeCount).toBe(1);
      expect(result.bias.active).toBe(true);
    });

    it("returns active bias for episode 5 with rich prior history", async () => {
      mockGetEpisodeById.mockResolvedValue({ id: 5, episodeNumber: 5, status: "pipeline" } as any);
      mockGetEpisodesByProject.mockResolvedValue([
        { id: 1, episodeNumber: 1, status: "published" },
        { id: 2, episodeNumber: 2, status: "published" },
        { id: 3, episodeNumber: 3, status: "published" },
        { id: 4, episodeNumber: 4, status: "published" },
        { id: 5, episodeNumber: 5, status: "pipeline" },
      ] as any);
      // Each prior episode has panels
      mockGetPanelsByEpisode.mockResolvedValue([
        { id: 1, cameraAngle: "close_up", transition: "cut" },
        { id: 2, cameraAngle: "close_up", transition: "cut" },
        { id: 3, cameraAngle: "medium", transition: "fade" },
        { id: 4, cameraAngle: "wide", transition: "dissolve" },
        { id: 5, cameraAngle: "close_up", transition: "cut" },
        { id: 6, cameraAngle: "medium", transition: "cut" },
        { id: 7, cameraAngle: "close_up", transition: "fade" },
        { id: 8, cameraAngle: "wide", transition: "cut" },
      ] as any);

      const result = await injectSakufuuBias({
        pipelineRunId: 105,
        episodeId: 5,
        projectId: 10,
      });

      expect(result.bias.active).toBe(true);
      expect(result.priorEpisodeCount).toBe(4);
      expect(result.bias.confidence).toBeGreaterThan(0);
    });
  });

  describe("recordSakufuuMemory (Post-Assembly)", () => {
    it("records memory after successful assembly", async () => {
      mockGetEpisodeById.mockResolvedValue({ id: 1, episodeNumber: 1, status: "review" } as any);
      mockGetPanelsByEpisode.mockResolvedValue([
        { id: 1, cameraAngle: "close_up", transition: "cut" },
        { id: 2, cameraAngle: "medium", transition: "fade" },
        { id: 3, cameraAngle: "wide", transition: "cut" },
        { id: 4, cameraAngle: "close_up", transition: "dissolve" },
        { id: 5, cameraAngle: "medium", transition: "cut" },
        { id: 6, cameraAngle: "close_up", transition: "cut" },
      ] as any);
      mockGetPipelineAssetsByRun.mockResolvedValue([
        { metadata: { dominantColor: "#FF4500" } },
        { metadata: { dominantColor: "#1E90FF" } },
        { metadata: { dominantColor: "#FF4500" } },
      ] as any);
      mockGetEpisodesByProject.mockResolvedValue([
        { id: 1, episodeNumber: 1, status: "review" },
      ] as any);

      const result = await recordSakufuuMemory({
        pipelineRunId: 100,
        episodeId: 1,
        projectId: 10,
        fxResults: [
          { type: "hikaku", intensity: 75 },
          { type: "bokeh_pull", intensity: 50 },
        ],
        voiceResults: {
          protagonist: { stability: 0.8, similarity: 0.9, speed: 1.0, emotion: "excited" },
          villain: { stability: 0.6, similarity: 0.85, speed: 0.9, emotion: "menacing" },
        },
        panelDurations: [4500, 4200, 5000, 4800, 4300, 4700],
      });

      expect(result.memoryRecorded).toBe(true);
      expect(result.profileUpdated).toBe(true);
      expect(result.episodeNumber).toBe(1);
      expect(result.confidence).toBeGreaterThan(0);
    });

    it("returns failure when episode not found", async () => {
      mockGetEpisodeById.mockResolvedValue(undefined);

      const result = await recordSakufuuMemory({
        pipelineRunId: 100,
        episodeId: 999,
        projectId: 10,
      });

      expect(result.memoryRecorded).toBe(false);
      expect(result.profileUpdated).toBe(false);
      expect(result.episodeNumber).toBe(0);
    });

    it("records memory with minimal data (no FX, no voice)", async () => {
      mockGetEpisodeById.mockResolvedValue({ id: 1, episodeNumber: 1, status: "review" } as any);
      mockGetPanelsByEpisode.mockResolvedValue([
        { id: 1, cameraAngle: "medium", transition: "cut" },
        { id: 2, cameraAngle: "medium", transition: "cut" },
      ] as any);
      mockGetPipelineAssetsByRun.mockResolvedValue([] as any);
      mockGetEpisodesByProject.mockResolvedValue([
        { id: 1, episodeNumber: 1, status: "review" },
      ] as any);

      const result = await recordSakufuuMemory({
        pipelineRunId: 100,
        episodeId: 1,
        projectId: 10,
        // No fxUsed, no voiceResults, no avgPanelDurationMs
      });

      expect(result.memoryRecorded).toBe(true);
      expect(result.confidence).toBeGreaterThan(0);
      // Lower confidence with less data
      expect(result.confidence).toBeLessThan(0.7);
    });

    it("handles color extraction from asset metadata", async () => {
      mockGetEpisodeById.mockResolvedValue({ id: 2, episodeNumber: 2, status: "review" } as any);
      mockGetPanelsByEpisode.mockResolvedValue([
        { id: 1, cameraAngle: "close_up", transition: "cut" },
        { id: 2, cameraAngle: "wide", transition: "fade" },
        { id: 3, cameraAngle: "medium", transition: "cut" },
        { id: 4, cameraAngle: "close_up", transition: "cut" },
        { id: 5, cameraAngle: "medium", transition: "dissolve" },
        { id: 6, cameraAngle: "wide", transition: "cut" },
      ] as any);
      mockGetPipelineAssetsByRun.mockResolvedValue([
        { metadata: { dominantColor: "#FF0000" } },
        { metadata: { dominantColor: "#FF0000" } },
        { metadata: { dominantColor: "#FF0000" } },
        { metadata: { dominantColor: "#00FF00" } },
        { metadata: {} }, // No color data
        { metadata: null }, // No metadata
      ] as any);
      mockGetEpisodesByProject.mockResolvedValue([
        { id: 1, episodeNumber: 1, status: "published" },
        { id: 2, episodeNumber: 2, status: "review" },
      ] as any);

      const result = await recordSakufuuMemory({
        pipelineRunId: 101,
        episodeId: 2,
        projectId: 10,
        fxUsed: [{ type: "nami_glass", count: 5, avgIntensity: 60 }],
      });

      expect(result.memoryRecorded).toBe(true);
      expect(result.profileUpdated).toBe(true);
    });
  });

  describe("Pipeline Integration Contract", () => {
    it("injectSakufuuBias returns SakufuuBias with all required fields", async () => {
      mockGetEpisodeById.mockResolvedValue({ id: 3, episodeNumber: 3, status: "pipeline" } as any);
      mockGetEpisodesByProject.mockResolvedValue([
        { id: 1, episodeNumber: 1, status: "published" },
        { id: 2, episodeNumber: 2, status: "published" },
        { id: 3, episodeNumber: 3, status: "pipeline" },
      ] as any);
      mockGetPanelsByEpisode.mockResolvedValue([
        { id: 1, cameraAngle: "close_up", transition: "cut" },
        { id: 2, cameraAngle: "medium", transition: "fade" },
        { id: 3, cameraAngle: "wide", transition: "cut" },
        { id: 4, cameraAngle: "close_up", transition: "dissolve" },
        { id: 5, cameraAngle: "medium", transition: "cut" },
        { id: 6, cameraAngle: "close_up", transition: "fade" },
      ] as any);

      const result = await injectSakufuuBias({
        pipelineRunId: 103,
        episodeId: 3,
        projectId: 10,
      });

      // Verify all SakufuuBias fields are present
      const bias = result.bias;
      expect(bias).toHaveProperty("active");
      expect(bias).toHaveProperty("signatureFx");
      expect(bias).toHaveProperty("suggestedPalette");
      expect(bias).toHaveProperty("suggestedTemperature");
      expect(bias).toHaveProperty("voiceTargets");
      expect(bias).toHaveProperty("suggestedPacing");
      expect(bias).toHaveProperty("suggestedCameraStyle");
      expect(bias).toHaveProperty("confidence");
      expect(bias).toHaveProperty("sources");
      expect(Array.isArray(bias.signatureFx)).toBe(true);
      expect(Array.isArray(bias.suggestedPalette)).toBe(true);
      expect(typeof bias.voiceTargets).toBe("object");
      expect(Array.isArray(bias.sources)).toBe(true);
    });

    it("recordSakufuuMemory returns SakufuuPostAssemblyResult with all required fields", async () => {
      mockGetEpisodeById.mockResolvedValue({ id: 1, episodeNumber: 1, status: "review" } as any);
      mockGetPanelsByEpisode.mockResolvedValue([
        { id: 1, cameraAngle: "medium", transition: "cut" },
        { id: 2, cameraAngle: "close_up", transition: "fade" },
        { id: 3, cameraAngle: "wide", transition: "cut" },
        { id: 4, cameraAngle: "medium", transition: "dissolve" },
        { id: 5, cameraAngle: "close_up", transition: "cut" },
        { id: 6, cameraAngle: "medium", transition: "cut" },
      ] as any);
      mockGetPipelineAssetsByRun.mockResolvedValue([] as any);
      mockGetEpisodesByProject.mockResolvedValue([
        { id: 1, episodeNumber: 1, status: "review" },
      ] as any);

      const result = await recordSakufuuMemory({
        pipelineRunId: 100,
        episodeId: 1,
        projectId: 10,
      });

      expect(result).toHaveProperty("memoryRecorded");
      expect(result).toHaveProperty("profileUpdated");
      expect(result).toHaveProperty("episodeNumber");
      expect(result).toHaveProperty("confidence");
      expect(typeof result.memoryRecorded).toBe("boolean");
      expect(typeof result.confidence).toBe("number");
    });

    it("bias confidence increases with more prior episodes", async () => {
      // Episode 2 with 1 prior
      mockGetEpisodeById.mockResolvedValueOnce({ id: 2, episodeNumber: 2, status: "pipeline" } as any);
      mockGetEpisodesByProject.mockResolvedValueOnce([
        { id: 1, episodeNumber: 1, status: "published" },
        { id: 2, episodeNumber: 2, status: "pipeline" },
      ] as any);
      mockGetPanelsByEpisode.mockResolvedValue([
        { id: 1, cameraAngle: "close_up", transition: "cut" },
        { id: 2, cameraAngle: "medium", transition: "fade" },
        { id: 3, cameraAngle: "wide", transition: "cut" },
        { id: 4, cameraAngle: "close_up", transition: "dissolve" },
        { id: 5, cameraAngle: "medium", transition: "cut" },
        { id: 6, cameraAngle: "close_up", transition: "fade" },
      ] as any);

      const result2 = await injectSakufuuBias({
        pipelineRunId: 102,
        episodeId: 2,
        projectId: 10,
      });

      // Episode 5 with 4 priors
      mockGetEpisodeById.mockResolvedValueOnce({ id: 5, episodeNumber: 5, status: "pipeline" } as any);
      mockGetEpisodesByProject.mockResolvedValueOnce([
        { id: 1, episodeNumber: 1, status: "published" },
        { id: 2, episodeNumber: 2, status: "published" },
        { id: 3, episodeNumber: 3, status: "published" },
        { id: 4, episodeNumber: 4, status: "published" },
        { id: 5, episodeNumber: 5, status: "pipeline" },
      ] as any);

      const result5 = await injectSakufuuBias({
        pipelineRunId: 105,
        episodeId: 5,
        projectId: 10,
      });

      // More prior episodes should yield higher confidence
      expect(result5.bias.confidence).toBeGreaterThanOrEqual(result2.bias.confidence);
    });
  });
});
