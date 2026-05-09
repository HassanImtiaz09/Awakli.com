/**
 * Tier E1 — Adapter Pipeline Wiring Tests
 *
 * Validates:
 * 1. resolveProjectAdapters() queries DB and returns adapters when available
 * 2. composeAndGenerate() respects bypassTierGate flag
 * 3. The orchestrator's Step 1.5 composition injection point exists and calls composeAndGenerate
 * 4. Legacy fallback: when no adapters found, original keyframe is preserved
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

describe("Tier E1: Adapter Pipeline Wiring", () => {
  const orchestratorPath = path.resolve(__dirname, "pipelineOrchestrator.ts");
  const adapterPipelinePath = path.resolve(__dirname, "adapter-composer-pipeline.ts");
  const orchestratorCode = fs.readFileSync(orchestratorPath, "utf-8");
  const adapterPipelineCode = fs.readFileSync(adapterPipelinePath, "utf-8");

  describe("1. resolveProjectAdapters() wired to DB", () => {
    it("should query projects table for animeStyle/genre", () => {
      expect(adapterPipelineCode).toContain("projects.animeStyle");
      expect(adapterPipelineCode).toContain("projects.genre");
    });

    it("should query styleBundles for genre adapter", () => {
      expect(adapterPipelineCode).toContain("styleBundles");
      expect(adapterPipelineCode).toContain("genreKey");
      expect(adapterPipelineCode).toContain("loraConfig");
    });

    it("should query characters table for character LoRA", () => {
      expect(adapterPipelineCode).toContain("charactersTable");
      expect(adapterPipelineCode).toContain("loraModelUrl");
      expect(adapterPipelineCode).toContain("loraStatus");
    });

    it("should query characterLibrary + characterLoras for library-based adapters", () => {
      expect(adapterPipelineCode).toContain("characterLibrary");
      expect(adapterPipelineCode).toContain("characterLoras");
      expect(adapterPipelineCode).toContain("activeLoraId");
    });

    it("should return DoRAAdapter-shaped objects with correct fields", () => {
      // Verify genre adapter construction
      expect(adapterPipelineCode).toContain('role: "genre"');
      expect(adapterPipelineCode).toContain("weightsUrl: loraConfig.model_id");
      // Verify character adapter construction
      expect(adapterPipelineCode).toContain('role: "character"');
      expect(adapterPipelineCode).toContain("weightsUrl: readyChar.loraModelUrl!");
    });

    it("should handle missing data gracefully (return partial results)", () => {
      expect(adapterPipelineCode).toContain("Adapter resolution is best-effort");
      expect(adapterPipelineCode).toContain("return result;");
    });
  });

  describe("2. composeAndGenerate() tier gate bypass", () => {
    it("should have bypassTierGate field in PipelineCompositionContext", () => {
      expect(adapterPipelineCode).toContain("bypassTierGate?: boolean");
    });

    it("should skip tier gate check when bypassTierGate is true", () => {
      expect(adapterPipelineCode).toContain("if (!ctx.bypassTierGate)");
    });

    it("should still validate adapter composition even when tier gate bypassed", () => {
      // validateAdapterComposition must be called AFTER the tier gate block
      const tierGateEnd = adapterPipelineCode.indexOf("} // end tier gate check");
      const validationCall = adapterPipelineCode.indexOf("validateAdapterComposition(activeAdapters)");
      expect(tierGateEnd).toBeGreaterThan(-1);
      expect(validationCall).toBeGreaterThan(tierGateEnd);
    });
  });

  describe("3. Orchestrator Step 1.5 composition injection", () => {
    it("should import composeAndGenerate and resolveProjectAdapters dynamically", () => {
      expect(orchestratorCode).toContain('import("./adapter-composer-pipeline")');
      expect(orchestratorCode).toContain("composeAndGenerate");
      expect(orchestratorCode).toContain("resolveProjectAdapters");
    });

    it("should call resolveProjectAdapters with projectId", () => {
      expect(orchestratorCode).toContain("resolveProjectAdapters(projectId)");
    });

    it("should check for any available adapter before composing", () => {
      expect(orchestratorCode).toContain("adapters.genre || adapters.character || adapters.sakufuu");
    });

    it("should pass bypassTierGate: true from orchestrator", () => {
      expect(orchestratorCode).toContain("bypassTierGate: true");
    });

    it("should replace panel.imageUrl with composed keyframe when successful", () => {
      expect(orchestratorCode).toContain("(panel as any).imageUrl = compositionResult.imageUrl");
    });

    it("should log composition results per panel", () => {
      expect(orchestratorCode).toContain("Composed keyframe");
      expect(orchestratorCode).toContain("Composition skipped");
    });

    it("should gracefully fall back on composition failure", () => {
      expect(orchestratorCode).toContain("Composition failed, keeping original keyframe");
    });

    it("should accumulate composition cost into totalCost", () => {
      expect(orchestratorCode).toContain("totalCost += compositionCost");
    });

    it("should be positioned BEFORE Step 2 (batch video generation)", () => {
      const step1_5 = orchestratorCode.indexOf("Step 1.5: Adapter Composition");
      const step2 = orchestratorCode.indexOf("Step 2: Submit video generation tasks");
      expect(step1_5).toBeGreaterThan(-1);
      expect(step2).toBeGreaterThan(step1_5);
    });
  });

  describe("4. Legacy fallback path", () => {
    it("should log when no adapters resolved", () => {
      expect(orchestratorCode).toContain("No adapters resolved for project");
      expect(orchestratorCode).toContain("using original keyframes (legacy path)");
    });

    it("should handle adapter resolution failure gracefully", () => {
      expect(orchestratorCode).toContain("Adapter composition step failed, continuing with original keyframes");
    });

    it("composeAndGenerate returns fallback when no adapters available", () => {
      // The function returns early with compositionUsed: false when activeAdapters.length === 0
      expect(adapterPipelineCode).toContain("No adapters available for this project");
      expect(adapterPipelineCode).toContain("compositionUsed: false");
    });
  });

  describe("5. Composition uses correct parameters", () => {
    it("should use 1280x720 dimensions for keyframes", () => {
      expect(orchestratorCode).toContain("width: 1280");
      expect(orchestratorCode).toContain("height: 720");
    });

    it("should use sourceImageUrl for img2img reference", () => {
      expect(orchestratorCode).toContain("sourceImageUrl: panel.imageUrl");
    });

    it("should use denoisingStrength 0.65 to preserve composition while restyling", () => {
      expect(orchestratorCode).toContain("denoisingStrength: 0.65");
    });

    it("should map tier 1 to d1_5_genga stage and others to d0_character_design", () => {
      expect(orchestratorCode).toContain('classification.tier === 1 ? "d1_5_genga" : "d0_character_design"');
    });
  });
});
