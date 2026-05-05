/**
 * D9 Sakufuu Tracker — Integration Test
 *
 * Tests the three-layer data-tracking MVP:
 *   Layer 1: Episode Memory collection
 *   Layer 2: Project Profile aggregation
 *   Bias injection: recommendations for episodes 2+
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the logger
vi.mock("../../observability/logger.js", () => ({
  pipelineLog: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  collectEpisodeMemory,
  aggregateProjectProfile,
  getSakufuuBias,
  classifyTemperature,
  classifyContrast,
  classifyPacing,
  buildDistribution,
  type EpisodeMemory,
  type CollectMemoryInput,
  type ColorRecord,
} from "./sakufuu-tracker.js";

// ─── Test Data ──────────────────────────────────────────────────────────────

const EPISODE_1_INPUT: CollectMemoryInput = {
  projectId: 1,
  episodeId: 100,
  episodeNumber: 1,
  fxResults: [
    { type: "hikaku", intensity: 80 },
    { type: "hikaku", intensity: 70 },
    { type: "namigarasu", intensity: 60 },
    { type: "gabre", intensity: 90 },
    { type: "hikaku", intensity: 85 },
  ],
  dominantColors: [
    { hex: "#FF4500", weight: 0.4 },
    { hex: "#1E90FF", weight: 0.3 },
    { hex: "#2E2E2E", weight: 0.3 },
  ],
  voiceParams: {
    "Protagonist": { stability: 0.7, similarity: 0.8, speed: 1.0, emotion: "determined" },
    "Rival": { stability: 0.6, similarity: 0.75, speed: 1.1, emotion: "angry" },
  },
  panelDurations: [5000, 4000, 6000, 3000, 5000],
  cameraAngles: ["close-up", "medium", "wide", "close-up", "medium"],
  transitions: ["cut", "cut", "fade", "cut", "dissolve"],
};

const EPISODE_2_INPUT: CollectMemoryInput = {
  projectId: 1,
  episodeId: 101,
  episodeNumber: 2,
  fxResults: [
    { type: "hikaku", intensity: 75 },
    { type: "bokeh_pull", intensity: 50 },
    { type: "gabre", intensity: 85 },
    { type: "gamen_dou", intensity: 70 },
  ],
  dominantColors: [
    { hex: "#FF6347", weight: 0.35 },
    { hex: "#4169E1", weight: 0.35 },
    { hex: "#333333", weight: 0.3 },
  ],
  voiceParams: {
    "Protagonist": { stability: 0.72, similarity: 0.82, speed: 1.0, emotion: "happy" },
    "Rival": { stability: 0.58, similarity: 0.73, speed: 1.15, emotion: "frustrated" },
  },
  panelDurations: [4500, 5000, 4000, 5500, 4000],
  cameraAngles: ["medium", "close-up", "wide", "medium", "close-up"],
  transitions: ["cut", "fade", "cut", "cut", "dissolve"],
};

// ─── Layer 1: Episode Memory Tests ──────────────────────────────────────────

describe("Layer 1: Episode Memory Collection", () => {
  it("collects FX usage with correct counts and averages", () => {
    const memory = collectEpisodeMemory(EPISODE_1_INPUT);

    expect(memory.fxUsed).toHaveLength(3);
    // hikaku: 3 uses, avg intensity (80+70+85)/3 = 78.33 → 78
    const hikaku = memory.fxUsed.find(f => f.type === "hikaku");
    expect(hikaku).toBeDefined();
    expect(hikaku!.count).toBe(3);
    expect(hikaku!.avgIntensity).toBe(78);
  });

  it("extracts top 3 FX as signature", () => {
    const memory = collectEpisodeMemory(EPISODE_1_INPUT);

    expect(memory.fxSignature).toHaveLength(3);
    expect(memory.fxSignature[0]).toBe("hikaku"); // most used
  });

  it("classifies color temperature correctly", () => {
    const memory = collectEpisodeMemory(EPISODE_1_INPUT);

    // Red dominant (FF4500 weight 0.4) > Blue (1E90FF weight 0.3)
    expect(memory.colorTemperature).toBe("warm");
  });

  it("collects voice patterns per character", () => {
    const memory = collectEpisodeMemory(EPISODE_1_INPUT);

    expect(memory.voicePatterns["Protagonist"]).toBeDefined();
    expect(memory.voicePatterns["Protagonist"].avgStability).toBe(0.7);
    expect(memory.voicePatterns["Protagonist"].emotionDistribution).toEqual({ determined: 1.0 });
  });

  it("calculates average panel duration", () => {
    const memory = collectEpisodeMemory(EPISODE_1_INPUT);

    // (5000+4000+6000+3000+5000)/5 = 4600
    expect(memory.avgPanelDurationMs).toBe(4600);
  });

  it("classifies pacing from panel duration", () => {
    const memory = collectEpisodeMemory(EPISODE_1_INPUT);

    // 4600ms → "normal" (between 3000 and 8000)
    expect(memory.pacingProfile).toBe("normal");
  });

  it("builds camera distribution as proportions", () => {
    const memory = collectEpisodeMemory(EPISODE_1_INPUT);

    expect(memory.cameraDistribution["close-up"]).toBe(0.4);
    expect(memory.cameraDistribution["medium"]).toBe(0.4);
    expect(memory.cameraDistribution["wide"]).toBe(0.2);
  });

  it("builds transition preferences as proportions", () => {
    const memory = collectEpisodeMemory(EPISODE_1_INPUT);

    expect(memory.transitionPreferences["cut"]).toBe(0.6);
    expect(memory.transitionPreferences["fade"]).toBe(0.2);
    expect(memory.transitionPreferences["dissolve"]).toBe(0.2);
  });

  it("calculates confidence based on data completeness", () => {
    const memory = collectEpisodeMemory(EPISODE_1_INPUT);

    // All 6 data points provided → confidence = 6/6 = 1.0
    expect(memory.confidence).toBe(1.0);
  });

  it("handles empty input gracefully with low confidence", () => {
    const memory = collectEpisodeMemory({
      projectId: 1,
      episodeId: 99,
      episodeNumber: 1,
    });

    expect(memory.fxUsed).toHaveLength(0);
    expect(memory.fxSignature).toHaveLength(0);
    expect(memory.confidence).toBe(0);
    expect(memory.pacingProfile).toBe("normal");
  });
});

// ─── Layer 2: Project Profile Aggregation Tests ─────────────────────────────

describe("Layer 2: Project Profile Aggregation", () => {
  let mem1: EpisodeMemory;
  let mem2: EpisodeMemory;

  beforeEach(() => {
    mem1 = collectEpisodeMemory(EPISODE_1_INPUT);
    mem2 = collectEpisodeMemory(EPISODE_2_INPUT);
  });

  it("returns empty profile for no episodes", () => {
    const profile = aggregateProjectProfile(1, []);

    expect(profile.episodesAnalyzed).toBe(0);
    expect(profile.confidence).toBe(0);
    expect(profile.signatureFx).toHaveLength(0);
  });

  it("aggregates signature FX across episodes (top 5)", () => {
    const profile = aggregateProjectProfile(1, [mem1, mem2]);

    expect(profile.signatureFx.length).toBeGreaterThan(0);
    expect(profile.signatureFx.length).toBeLessThanOrEqual(5);
    // hikaku appears in both episodes → highest frequency
    expect(profile.signatureFx[0].type).toBe("hikaku");
    expect(profile.signatureFx[0].frequency).toBe(1.0); // in 2/2 episodes
  });

  it("calculates FX diversity score", () => {
    const profile = aggregateProjectProfile(1, [mem1, mem2]);

    // 5 unique FX types out of ~12 possible
    expect(profile.fxDiversityScore).toBeGreaterThan(0);
    expect(profile.fxDiversityScore).toBeLessThanOrEqual(1);
  });

  it("aggregates color palette tendency", () => {
    const profile = aggregateProjectProfile(1, [mem1, mem2]);

    expect(profile.paletteTendency.length).toBeGreaterThan(0);
    // Weights should sum to ~1.0
    const totalWeight = profile.paletteTendency.reduce((a, b) => a + b.weight, 0);
    expect(totalWeight).toBeCloseTo(1.0, 1);
  });

  it("determines temperature tendency by majority vote", () => {
    const profile = aggregateProjectProfile(1, [mem1, mem2]);

    // Both episodes have warm colors dominant
    expect(profile.temperatureTendency).toBe("warm");
  });

  it("computes voice consistency across episodes", () => {
    const profile = aggregateProjectProfile(1, [mem1, mem2]);

    // Stability values are close (0.7 vs 0.72) → high consistency
    expect(profile.voiceConsistency).toBeGreaterThan(0.5);
  });

  it("determines preferred pacing by majority vote", () => {
    const profile = aggregateProjectProfile(1, [mem1, mem2]);

    expect(profile.preferredPacing).toBe("normal");
  });

  it("averages camera distributions", () => {
    const profile = aggregateProjectProfile(1, [mem1, mem2]);

    // close-up: (0.4 + 0.4) / 2 = 0.4
    expect(profile.cameraStyle["close-up"]).toBe(0.4);
  });

  it("confidence increases logarithmically with episodes", () => {
    const profile1 = aggregateProjectProfile(1, [mem1]);
    const profile2 = aggregateProjectProfile(1, [mem1, mem2]);

    expect(profile2.confidence).toBeGreaterThan(profile1.confidence);
    expect(profile2.confidence).toBeLessThanOrEqual(1.0);
  });

  it("tracks episodesAnalyzed count", () => {
    const profile = aggregateProjectProfile(1, [mem1, mem2]);

    expect(profile.episodesAnalyzed).toBe(2);
  });
});

// ─── Bias Injection Tests ───────────────────────────────────────────────────

describe("Bias Injection (Stage 2)", () => {
  let mem1: EpisodeMemory;
  let mem2: EpisodeMemory;

  beforeEach(() => {
    mem1 = collectEpisodeMemory(EPISODE_1_INPUT);
    mem2 = collectEpisodeMemory(EPISODE_2_INPUT);
  });

  it("returns inactive bias for episode 1 (no-op)", () => {
    const bias = getSakufuuBias({
      projectId: 1,
      episodeNumber: 1,
      episodeMemories: [],
    });

    expect(bias.active).toBe(false);
    expect(bias.signatureFx).toHaveLength(0);
    expect(bias.confidence).toBe(0);
    expect(bias.sources).toHaveLength(0);
  });

  it("returns inactive bias when no episode memories exist", () => {
    const bias = getSakufuuBias({
      projectId: 1,
      episodeNumber: 2,
      episodeMemories: [],
    });

    expect(bias.active).toBe(false);
  });

  it("returns active bias for episode 2 with signature FX", () => {
    const bias = getSakufuuBias({
      projectId: 1,
      episodeNumber: 2,
      episodeMemories: [mem1],
    });

    expect(bias.active).toBe(true);
    expect(bias.signatureFx.length).toBeGreaterThan(0);
    expect(bias.signatureFx).toContain("hikaku"); // top FX from episode 1
  });

  it("returns voice targets from most recent episode", () => {
    const bias = getSakufuuBias({
      projectId: 1,
      episodeNumber: 3,
      episodeMemories: [mem1, mem2],
    });

    expect(bias.voiceTargets["Protagonist"]).toBeDefined();
    // Should use mem2 values (most recent)
    expect(bias.voiceTargets["Protagonist"].stability).toBe(0.72);
  });

  it("includes both sources when multiple episodes exist", () => {
    const bias = getSakufuuBias({
      projectId: 1,
      episodeNumber: 3,
      episodeMemories: [mem1, mem2],
    });

    expect(bias.sources).toContain("episode_memory");
    expect(bias.sources).toContain("project_profile");
  });

  it("includes only episode_memory source for episode 2 (1 prior)", () => {
    const bias = getSakufuuBias({
      projectId: 1,
      episodeNumber: 2,
      episodeMemories: [mem1],
    });

    expect(bias.sources).toContain("episode_memory");
    expect(bias.sources).not.toContain("project_profile");
  });

  it("suggests color palette from project profile", () => {
    const bias = getSakufuuBias({
      projectId: 1,
      episodeNumber: 3,
      episodeMemories: [mem1, mem2],
    });

    expect(bias.suggestedPalette.length).toBeGreaterThan(0);
    expect(bias.suggestedTemperature).toBe("warm");
  });

  it("suggests pacing from project profile", () => {
    const bias = getSakufuuBias({
      projectId: 1,
      episodeNumber: 3,
      episodeMemories: [mem1, mem2],
    });

    expect(bias.suggestedPacing).toBe("normal");
  });

  it("uses pre-computed project profile when provided", () => {
    const customProfile = aggregateProjectProfile(1, [mem1, mem2]);
    customProfile.signatureFx = [{ type: "custom_fx", frequency: 1.0, avgIntensity: 90 }];

    const bias = getSakufuuBias({
      projectId: 1,
      episodeNumber: 3,
      episodeMemories: [mem1, mem2],
      projectProfile: customProfile,
    });

    expect(bias.signatureFx).toContain("custom_fx");
  });

  it("confidence reflects data quality", () => {
    const bias2 = getSakufuuBias({
      projectId: 1,
      episodeNumber: 2,
      episodeMemories: [mem1],
    });
    const bias3 = getSakufuuBias({
      projectId: 1,
      episodeNumber: 3,
      episodeMemories: [mem1, mem2],
    });

    // More episodes → higher confidence
    expect(bias3.confidence).toBeGreaterThan(bias2.confidence);
  });
});

// ─── Helper Function Tests ──────────────────────────────────────────────────

describe("Helper Functions", () => {
  describe("classifyTemperature", () => {
    it("returns warm for red-dominant palette", () => {
      expect(classifyTemperature([
        { hex: "#FF0000", weight: 0.6 },
        { hex: "#0000FF", weight: 0.4 },
      ])).toBe("warm");
    });

    it("returns cool for blue-dominant palette", () => {
      expect(classifyTemperature([
        { hex: "#0000FF", weight: 0.6 },
        { hex: "#FF0000", weight: 0.2 },
      ])).toBe("cool");
    });

    it("returns neutral for balanced palette", () => {
      expect(classifyTemperature([
        { hex: "#808080", weight: 0.5 },
        { hex: "#888888", weight: 0.5 },
      ])).toBe("neutral");
    });

    it("returns neutral for empty colors", () => {
      expect(classifyTemperature([])).toBe("neutral");
    });
  });

  describe("classifyContrast", () => {
    it("returns high for black+white palette", () => {
      expect(classifyContrast([
        { hex: "#000000", weight: 0.5 },
        { hex: "#FFFFFF", weight: 0.5 },
      ])).toBe("high");
    });

    it("returns low for similar grays", () => {
      expect(classifyContrast([
        { hex: "#808080", weight: 0.5 },
        { hex: "#909090", weight: 0.5 },
      ])).toBe("low");
    });

    it("returns medium for single color", () => {
      expect(classifyContrast([{ hex: "#FF0000", weight: 1.0 }])).toBe("medium");
    });
  });

  describe("classifyPacing", () => {
    it("returns fast for <3000ms", () => {
      expect(classifyPacing(2500)).toBe("fast");
    });

    it("returns slow for >8000ms", () => {
      expect(classifyPacing(9000)).toBe("slow");
    });

    it("returns normal for 3000-8000ms", () => {
      expect(classifyPacing(5000)).toBe("normal");
    });

    it("returns normal for null", () => {
      expect(classifyPacing(null)).toBe("normal");
    });
  });

  describe("buildDistribution", () => {
    it("builds proportional distribution", () => {
      const dist = buildDistribution(["a", "a", "b", "c", "c", "c"]);

      expect(dist["a"]).toBeCloseTo(0.33, 1);
      expect(dist["b"]).toBeCloseTo(0.17, 1);
      expect(dist["c"]).toBe(0.5);
    });

    it("returns empty for empty input", () => {
      expect(buildDistribution([])).toEqual({});
    });

    it("normalizes keys (lowercase, underscores)", () => {
      const dist = buildDistribution(["Close Up", "close_up", "CLOSE UP"]);

      expect(dist["close_up"]).toBe(1.0);
    });
  });
});

// ─── Integration with D7 FX Tests ───────────────────────────────────────────

describe("D9 → D7 Integration (Signature FX)", () => {
  it("provides signature FX list that D7 can prioritize", () => {
    const mem1 = collectEpisodeMemory(EPISODE_1_INPUT);
    const mem2 = collectEpisodeMemory(EPISODE_2_INPUT);

    const bias = getSakufuuBias({
      projectId: 1,
      episodeNumber: 3,
      episodeMemories: [mem1, mem2],
    });

    // D7 should receive these as priority FX types
    expect(bias.signatureFx).toContain("hikaku");
    expect(bias.signatureFx).toContain("gabre");
    // These are the project's "signature" effects
    expect(bias.signatureFx.length).toBeLessThanOrEqual(5);
  });

  it("empty bias for episode 1 means D7 uses only ekonte tags", () => {
    const bias = getSakufuuBias({
      projectId: 1,
      episodeNumber: 1,
      episodeMemories: [],
    });

    expect(bias.active).toBe(false);
    expect(bias.signatureFx).toHaveLength(0);
    // D7 will rely solely on ekonte tags + genre profile
  });
});
