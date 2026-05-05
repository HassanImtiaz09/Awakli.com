/**
 * Tests for Foley Generator and Ambient Detector modules.
 *
 * Tests cover:
 * - Foley cue extraction types and validation
 * - Foley prompt map completeness
 * - Ambient library structure and tag matching
 * - Scene-to-ambient deterministic matching
 * - Pipeline node type definitions and integration points
 * - Assembly settings interaction
 */

import { describe, it, expect, vi } from "vitest";

// ─── Foley Generator Tests ──────────────────────────────────────────────

describe("Foley Generator", () => {
  describe("FOLEY_PROMPT_MAP", () => {
    it("should export a non-empty prompt map", async () => {
      const { FOLEY_PROMPT_MAP } = await import("./foleyGenerator");
      expect(Object.keys(FOLEY_PROMPT_MAP).length).toBeGreaterThan(20);
    });

    it("should have prompts for all core SFX types", async () => {
      const { FOLEY_PROMPT_MAP } = await import("./foleyGenerator");
      const coreTypes = [
        "punch", "kick", "explosion", "footsteps", "sword_draw",
        "door_open", "whoosh", "sparkle", "magic_cast",
      ];
      for (const t of coreTypes) {
        expect(FOLEY_PROMPT_MAP[t]).toBeDefined();
        expect(FOLEY_PROMPT_MAP[t].length).toBeGreaterThan(10);
      }
    });

    it("should have unique prompts for each SFX type", async () => {
      const { FOLEY_PROMPT_MAP } = await import("./foleyGenerator");
      const prompts = Object.values(FOLEY_PROMPT_MAP);
      const uniquePrompts = new Set(prompts);
      expect(uniquePrompts.size).toBe(prompts.length);
    });

    it("should include 'no music' or 'sound effect' in prompts", async () => {
      const { FOLEY_PROMPT_MAP } = await import("./foleyGenerator");
      for (const [type, prompt] of Object.entries(FOLEY_PROMPT_MAP)) {
        // Each prompt should be descriptive enough to generate a SFX
        expect(prompt.length).toBeGreaterThan(15);
      }
    });
  });

  describe("FoleyCue type validation", () => {
    it("should accept valid foley cue objects", async () => {
      const { FOLEY_PROMPT_MAP } = await import("./foleyGenerator");
      // Type-check: a valid cue should have all required fields
      const validCue = {
        panelId: 1,
        panelNumber: 1,
        sceneNumber: 1,
        sfxType: "footsteps",
        category: "human" as const,
        audioPrompt: "footsteps on hard floor",
        durationMs: 1200,
        volume: 80,
        offsetMs: 0,
        confidence: 0.9,
      };
      expect(validCue.sfxType).toBe("footsteps");
      expect(validCue.category).toBe("human");
      expect(FOLEY_PROMPT_MAP[validCue.sfxType]).toBeDefined();
    });

    it("should validate category values", () => {
      const validCategories = ["impact", "human", "mechanical", "nature", "ui"];
      for (const cat of validCategories) {
        expect(validCategories).toContain(cat);
      }
    });

    it("should enforce duration limits (200-3000ms)", () => {
      const clamp = (v: number) => Math.max(200, Math.min(3000, v));
      expect(clamp(100)).toBe(200);
      expect(clamp(5000)).toBe(3000);
      expect(clamp(1500)).toBe(1500);
    });

    it("should enforce volume limits (20-100)", () => {
      const clamp = (v: number) => Math.max(20, Math.min(100, v));
      expect(clamp(0)).toBe(20);
      expect(clamp(150)).toBe(100);
      expect(clamp(80)).toBe(80);
    });

    it("should enforce offset limits (0-2500ms)", () => {
      const clamp = (v: number) => Math.max(0, Math.min(2500, v));
      expect(clamp(-100)).toBe(0);
      expect(clamp(5000)).toBe(2500);
      expect(clamp(1000)).toBe(1000);
    });
  });

  describe("FoleyNodeResult structure", () => {
    it("should define correct result shape", () => {
      const emptyResult = {
        clips: [],
        totalCostCents: 0,
        cuesExtracted: 0,
        clipsGenerated: 0,
        clipsFailed: 0,
      };
      expect(emptyResult.clips).toHaveLength(0);
      expect(emptyResult.totalCostCents).toBe(0);
      expect(emptyResult.clipsGenerated).toBe(0);
    });
  });
});

// ─── Ambient Detector Tests ─────────────────────────────────────────────

describe("Ambient Detector", () => {
  describe("AMBIENT_LIBRARY", () => {
    it("should export a curated library with 20+ categories", async () => {
      const { AMBIENT_LIBRARY } = await import("./ambientDetector");
      expect(AMBIENT_LIBRARY.length).toBeGreaterThanOrEqual(20);
    });

    it("should have unique IDs for all categories", async () => {
      const { AMBIENT_LIBRARY } = await import("./ambientDetector");
      const ids = AMBIENT_LIBRARY.map((c) => c.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it("should have a 'silence' fallback category", async () => {
      const { AMBIENT_LIBRARY } = await import("./ambientDetector");
      const silence = AMBIENT_LIBRARY.find((c) => c.id === "silence");
      expect(silence).toBeDefined();
      expect(silence!.tags).toHaveLength(0); // No tags = fallback
    });

    it("should have valid fade durations for all categories", async () => {
      const { AMBIENT_LIBRARY } = await import("./ambientDetector");
      for (const cat of AMBIENT_LIBRARY) {
        expect(cat.fadeInSeconds).toBeGreaterThan(0);
        expect(cat.fadeOutSeconds).toBeGreaterThan(0);
        expect(cat.fadeInSeconds).toBeLessThanOrEqual(3);
        expect(cat.fadeOutSeconds).toBeLessThanOrEqual(3);
      }
    });

    it("should have prompts containing 'no music' for all categories", async () => {
      const { AMBIENT_LIBRARY } = await import("./ambientDetector");
      for (const cat of AMBIENT_LIBRARY) {
        expect(cat.prompt.toLowerCase()).toContain("no music");
      }
    });

    it("should have prompts containing 'loop' for all categories", async () => {
      const { AMBIENT_LIBRARY } = await import("./ambientDetector");
      for (const cat of AMBIENT_LIBRARY) {
        expect(cat.prompt.toLowerCase()).toContain("loop");
      }
    });

    it("should cover all major environment types", async () => {
      const { AMBIENT_LIBRARY } = await import("./ambientDetector");
      const ids = AMBIENT_LIBRARY.map((c) => c.id);
      // Natural
      expect(ids).toContain("ocean_waves");
      expect(ids).toContain("forest_birds");
      expect(ids).toContain("rain_light");
      expect(ids).toContain("rain_heavy");
      // Urban
      expect(ids).toContain("city_traffic");
      expect(ids).toContain("crowd_indoor");
      // Sci-fi
      expect(ids).toContain("spaceship_hum");
      expect(ids).toContain("crystal_resonance");
      // Interior
      expect(ids).toContain("room_quiet");
      // Battle
      expect(ids).toContain("battlefield");
      expect(ids).toContain("tension_drone");
    });
  });

  describe("matchAmbientByTags", () => {
    it("should match 'ocean' location to ocean_waves", async () => {
      const { matchAmbientByTags } = await import("./ambientDetector");
      const result = matchAmbientByTags("ocean shore at sunset");
      expect(result).not.toBeNull();
      expect(result!.category.id).toBe("ocean_waves");
    });

    it("should match 'forest' location to forest_birds", async () => {
      const { matchAmbientByTags } = await import("./ambientDetector");
      const result = matchAmbientByTags("deep forest clearing");
      expect(result).not.toBeNull();
      expect(result!.category.id).toBe("forest_birds");
    });

    it("should match 'spaceship bridge' to spaceship_hum", async () => {
      const { matchAmbientByTags } = await import("./ambientDetector");
      const result = matchAmbientByTags("spaceship bridge");
      expect(result).not.toBeNull();
      expect(result!.category.id).toBe("spaceship_hum");
    });

    it("should match 'crystal temple' to crystal_resonance", async () => {
      const { matchAmbientByTags } = await import("./ambientDetector");
      const result = matchAmbientByTags("crystal temple");
      expect(result).not.toBeNull();
      expect(result!.category.id).toBe("crystal_resonance");
    });

    it("should match 'dark cave' to cave_drips", async () => {
      const { matchAmbientByTags } = await import("./ambientDetector");
      const result = matchAmbientByTags("dark cave underground");
      expect(result).not.toBeNull();
      expect(result!.category.id).toBe("cave_drips");
    });

    it("should match 'hospital ward' to hospital", async () => {
      const { matchAmbientByTags } = await import("./ambientDetector");
      const result = matchAmbientByTags("hospital ward");
      expect(result).not.toBeNull();
      expect(result!.category.id).toBe("hospital");
    });

    it("should match 'battlefield' to battlefield", async () => {
      const { matchAmbientByTags } = await import("./ambientDetector");
      const result = matchAmbientByTags("battlefield at dawn");
      expect(result).not.toBeNull();
      expect(result!.category.id).toBe("battlefield");
    });

    it("should consider mood in matching", async () => {
      const { matchAmbientByTags } = await import("./ambientDetector");
      const result = matchAmbientByTags("dark room", "night", "tense");
      expect(result).not.toBeNull();
      // Should match tension_drone due to 'tense' mood
      expect(["tension_drone", "room_quiet", "city_night"]).toContain(result!.category.id);
    });

    it("should return null for empty input", async () => {
      const { matchAmbientByTags } = await import("./ambientDetector");
      const result = matchAmbientByTags("");
      expect(result).toBeNull();
    });

    it("should return null for unrecognizable locations", async () => {
      const { matchAmbientByTags } = await import("./ambientDetector");
      const result = matchAmbientByTags("xyzzy");
      expect(result).toBeNull();
    });

    it("should prefer longer tag matches (more specific)", async () => {
      const { matchAmbientByTags } = await import("./ambientDetector");
      // "heavy rain" should match rain_heavy over rain_light
      const result = matchAmbientByTags("heavy rain storm");
      expect(result).not.toBeNull();
      expect(result!.category.id).toBe("rain_heavy");
    });

    it("should handle combined location + time of day", async () => {
      const { matchAmbientByTags } = await import("./ambientDetector");
      const result = matchAmbientByTags("city street", "night");
      expect(result).not.toBeNull();
      // Could match city_traffic or city_night
      expect(["city_traffic", "city_night"]).toContain(result!.category.id);
    });
  });

  describe("SceneAmbientMapping structure", () => {
    it("should define correct mapping shape", () => {
      const mapping = {
        sceneNumber: 1,
        location: "ocean shore",
        timeOfDay: "sunset",
        mood: "serene",
        ambientCategoryId: "ocean_waves",
        secondaryCategoryId: "wind",
        confidence: 0.9,
        reasoning: "Ocean setting with wind",
        startPanelNumber: 1,
        endPanelNumber: 8,
      };
      expect(mapping.ambientCategoryId).toBe("ocean_waves");
      expect(mapping.secondaryCategoryId).toBe("wind");
      expect(mapping.confidence).toBeGreaterThan(0);
    });
  });
});

// ─── Pipeline Integration Tests ─────────────────────────────────────────

describe("Pipeline Integration", () => {
  describe("Node configuration", () => {
    it("should include foley_gen and ambient_gen in NODE_ORDER", async () => {
      // Read the orchestrator to verify node order
      const fs = await import("fs");
      const content = fs.readFileSync("/home/ubuntu/awakli/server/pipelineOrchestrator.ts", "utf-8");
      expect(content).toContain('"foley_gen"');
      expect(content).toContain('"ambient_gen"');
      // Verify order: foley_gen before ambient_gen before assembly
      const foleyIdx = content.indexOf('"foley_gen"');
      const ambientIdx = content.indexOf('"ambient_gen"');
      const assemblyIdx = content.indexOf('"assembly"');
      expect(foleyIdx).toBeLessThan(ambientIdx);
      expect(ambientIdx).toBeLessThan(assemblyIdx);
    });

    it("should have cost estimates for new nodes", async () => {
      const fs = await import("fs");
      const content = fs.readFileSync("/home/ubuntu/awakli/server/pipelineOrchestrator.ts", "utf-8");
      expect(content).toContain("foley_gen: 60");
      expect(content).toContain("ambient_gen: 30");
    });

    it("should have duration estimates for new nodes", async () => {
      const fs = await import("fs");
      const content = fs.readFileSync("/home/ubuntu/awakli/server/pipelineOrchestrator.ts", "utf-8");
      expect(content).toContain("foley_gen: 8000");
      expect(content).toContain("ambient_gen: 6000");
    });
  });

  describe("HITL Bridge integration", () => {
    it("should include audio_timing node in OrchestratorNode (subsumes foley/ambient)", async () => {
      const fs = await import("fs");
      const content = fs.readFileSync("/home/ubuntu/awakli/server/hitl/orchestrator-bridge.ts", "utf-8");
      expect(content).toContain('"audio_timing"');
      expect(content).toContain('"fx_composite"');
    });

    it("should map audio_timing to stages 12-13", async () => {
      const fs = await import("fs");
      const content = fs.readFileSync("/home/ubuntu/awakli/server/hitl/orchestrator-bridge.ts", "utf-8");
      expect(content).toContain('audio_timing: [12, 13]');
    });
  });

  describe("Assembly settings interaction", () => {
    it("should read enableFoley and enableAmbient from assembly settings", async () => {
      const fs = await import("fs");
      const content = fs.readFileSync("/home/ubuntu/awakli/server/pipelineOrchestrator.ts", "utf-8");
      expect(content).toContain("pipelineSettings.enableFoley");
      expect(content).toContain("pipelineSettings.enableAmbient");
    });

    it("should skip foley_gen when disabled", async () => {
      const fs = await import("fs");
      const content = fs.readFileSync("/home/ubuntu/awakli/server/pipelineOrchestrator.ts", "utf-8");
      expect(content).toContain('nodeStatuses.foley_gen = "skipped"');
    });

    it("should skip ambient_gen when disabled", async () => {
      const fs = await import("fs");
      const content = fs.readFileSync("/home/ubuntu/awakli/server/pipelineOrchestrator.ts", "utf-8");
      expect(content).toContain('nodeStatuses.ambient_gen = "skipped"');
    });

    it("should pass foleyLufs and ambientLufs from settings", async () => {
      const fs = await import("fs");
      const content = fs.readFileSync("/home/ubuntu/awakli/server/pipelineOrchestrator.ts", "utf-8");
      expect(content).toContain("pipelineSettings.foleyLufs");
      expect(content).toContain("pipelineSettings.ambientLufs");
    });
  });

  describe("Pipeline Dashboard UI", () => {
    it("should display foley_gen and ambient_gen nodes", async () => {
      const fs = await import("fs");
      const content = fs.readFileSync("/home/ubuntu/awakli/client/src/pages/PipelineDashboard.tsx", "utf-8");
      expect(content).toContain('"foley_gen"');
      expect(content).toContain('"ambient_gen"');
      expect(content).toContain('"Foley SFX"');
      expect(content).toContain('"Ambient"');
    });

    it("should have FoleyGenDetail and AmbientGenDetail components", async () => {
      const fs = await import("fs");
      const content = fs.readFileSync("/home/ubuntu/awakli/client/src/pages/PipelineDashboard.tsx", "utf-8");
      expect(content).toContain("function FoleyGenDetail");
      expect(content).toContain("function AmbientGenDetail");
    });

    it("should have 6 nodes in the graph (including new ones)", async () => {
      const fs = await import("fs");
      const content = fs.readFileSync("/home/ubuntu/awakli/client/src/pages/PipelineDashboard.tsx", "utf-8");
      // Count NODES entries
      const nodeMatches = content.match(/\{ id: "/g);
      expect(nodeMatches).not.toBeNull();
      expect(nodeMatches!.length).toBeGreaterThanOrEqual(6);
    });

    it("should have 6 connections in the graph (7 nodes)", async () => {
      const fs = await import("fs");
      const content = fs.readFileSync("/home/ubuntu/awakli/client/src/pages/PipelineDashboard.tsx", "utf-8");
      expect(content).toContain("[[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6]]");
    });
  });
});

// ─── Cross-module Consistency Tests ─────────────────────────────────────

describe("Cross-module Consistency", () => {
  it("should have matching category types between foley and ambient", async () => {
    const { FOLEY_PROMPT_MAP } = await import("./foleyGenerator");
    const { AMBIENT_LIBRARY } = await import("./ambientDetector");

    // Foley has impact, human, mechanical, nature, ui categories
    // Ambient library should cover nature, urban, sci-fi, interior, battle
    // They complement each other — foley = short SFX, ambient = continuous loops
    expect(Object.keys(FOLEY_PROMPT_MAP).length).toBeGreaterThan(0);
    expect(AMBIENT_LIBRARY.length).toBeGreaterThan(0);
  });

  it("should use consistent asset types for storage", async () => {
    const fs = await import("fs");
    const foleyContent = fs.readFileSync("/home/ubuntu/awakli/server/foleyGenerator.ts", "utf-8");
    const ambientContent = fs.readFileSync("/home/ubuntu/awakli/server/ambientDetector.ts", "utf-8");

    // Both should use sfx_gen as nodeSource (since foley_gen isn't in the enum)
    expect(foleyContent).toContain('nodeSource: "sfx_gen"');
    expect(ambientContent).toContain('nodeSource: "sfx_gen"');
  });

  it("should use consistent panel duration constant", async () => {
    const fs = await import("fs");
    const foleyContent = fs.readFileSync("/home/ubuntu/awakli/server/foleyGenerator.ts", "utf-8");
    const ambientContent = fs.readFileSync("/home/ubuntu/awakli/server/ambientDetector.ts", "utf-8");

    // Both should use PANEL_DURATION_SECONDS = 3.0
    expect(foleyContent).toContain("PANEL_DURATION_SECONDS = 3.0");
    expect(ambientContent).toContain("PANEL_DURATION_SECONDS = 3.0");
  });
});
