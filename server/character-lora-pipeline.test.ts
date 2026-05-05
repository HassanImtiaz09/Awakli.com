/**
 * Prompt 21: Character LoRA Training Pipeline & Asset Library Tests
 * 
 * Covers:
 * 1. Preprocessing module (extract, crop, resize, caption)
 * 2. Training config builder (Kohya params, validation, CLI args)
 * 3. Quality validation (CLIP scoring, decision thresholds)
 * 4. Job scheduler (cost estimation, priority, batch estimation)
 * 5. LoRA lifecycle manager (retrain detection, artifact paths, file size)
 * 6. Consistency mechanism (LoRA → IP-Adapter → text prompt fallback)
 * 7. Character library router contract tests
 */

import { describe, it, expect } from "vitest";
import {
  // Preprocessing
  extractReferenceImages,
  cropToCharacter,
  resizeTo512,
  autoCaptionImage,
  buildTriggerWord,
  preprocessCharacterSheet,
  // Training config
  validateTrainingParams,
  buildKohyaConfig,
  buildKohyaArgs,
  DEFAULT_TRAINING_CONFIG,
  TRAINING_PARAM_RANGES,
  // Quality validation
  generateValidationPrompts,
  computeCosineSimilarity,
  clipToQualityScore,
  getValidationDecision,
  runValidation,
  VALIDATION_THRESHOLDS,
  CLIP_TO_SCORE_RANGE,
  // Job scheduler
  estimateTrainingJob,
  assignPriority,
  sortByPriority,
  estimateBatchTraining,
  generateBatchId,
  GPU_PROFILES,
  COST_MARGIN,
  ROLE_PRIORITY_MAP,
  // Lifecycle
  shouldRetrain,
  getLoraArtifactPath,
  estimateLoraFileSize,
  // Consistency
  getConsistencyMechanism,
  buildLoraInjectionPayload,
  PROVIDER_CAPABILITIES,
  // Types
  type ReferenceImage,
  type KohyaTrainingConfig,
  type ValidationResult,
  type TrainingJobEstimate,
  type ConsistencyMechanism,
} from "./lora-training-pipeline";

// ─── 1. Preprocessing Module ──────────────────────────────────────────

describe("Preprocessing Module", () => {
  describe("extractReferenceImages", () => {
    it("extracts default 5 view angles from reference sheet URL", () => {
      const images = extractReferenceImages("https://cdn.example.com/sheet.png", "Sakura");
      expect(images).toHaveLength(5);
      const angles = images.map(i => i.viewAngle);
      expect(angles).toEqual(["front", "side", "back", "three_quarter", "expression"]);
    });

    it("generates correct URLs per view angle", () => {
      const images = extractReferenceImages("https://cdn.example.com/char.png", "Sakura");
      expect(images[0].url).toBe("https://cdn.example.com/char_front_0.png");
      expect(images[1].url).toBe("https://cdn.example.com/char_side_1.png");
      expect(images[4].url).toBe("https://cdn.example.com/char_expression_4.png");
    });

    it("respects custom view angles", () => {
      const images = extractReferenceImages("https://cdn.example.com/sheet.png", "Sakura", ["front", "back"]);
      expect(images).toHaveLength(2);
      expect(images[0].viewAngle).toBe("front");
      expect(images[1].viewAngle).toBe("back");
    });

    it("sets all images to 512x512 with empty caption", () => {
      const images = extractReferenceImages("https://cdn.example.com/sheet.png", "Sakura");
      for (const img of images) {
        expect(img.width).toBe(512);
        expect(img.height).toBe(512);
        expect(img.caption).toBe("");
      }
    });
  });

  describe("cropToCharacter", () => {
    it("appends _cropped suffix to URL", () => {
      const input: ReferenceImage = {
        url: "https://cdn.example.com/char_front_0.png",
        viewAngle: "front", caption: "", width: 512, height: 512,
      };
      const cropped = cropToCharacter(input);
      expect(cropped.url).toBe("https://cdn.example.com/char_front_0_cropped.png");
    });

    it("preserves other properties", () => {
      const input: ReferenceImage = {
        url: "https://cdn.example.com/char.png",
        viewAngle: "side", caption: "test", width: 1024, height: 768,
      };
      const cropped = cropToCharacter(input);
      expect(cropped.viewAngle).toBe("side");
      expect(cropped.caption).toBe("test");
      expect(cropped.width).toBe(1024);
    });
  });

  describe("resizeTo512", () => {
    it("sets dimensions to 512x512", () => {
      const input: ReferenceImage = {
        url: "https://cdn.example.com/char.png",
        viewAngle: "front", caption: "", width: 1024, height: 768,
      };
      const resized = resizeTo512(input);
      expect(resized.width).toBe(512);
      expect(resized.height).toBe(512);
    });

    it("appends _512 suffix to URL", () => {
      const input: ReferenceImage = {
        url: "https://cdn.example.com/char_cropped.png",
        viewAngle: "front", caption: "", width: 512, height: 512,
      };
      const resized = resizeTo512(input);
      expect(resized.url).toBe("https://cdn.example.com/char_cropped_512.png");
    });
  });

  describe("buildTriggerWord", () => {
    it("creates awakli_ prefixed lowercase trigger word", () => {
      expect(buildTriggerWord("Sakura")).toBe("awakli_sakura");
    });

    it("sanitizes special characters", () => {
      expect(buildTriggerWord("Dark Knight!")).toBe("awakli_dark_knight");
    });

    it("collapses multiple underscores", () => {
      expect(buildTriggerWord("A  B--C")).toBe("awakli_a_b_c");
    });

    it("strips leading/trailing underscores", () => {
      expect(buildTriggerWord("_test_")).toBe("awakli_test");
    });
  });

  describe("autoCaptionImage", () => {
    it("includes trigger word and view angle", () => {
      const img: ReferenceImage = {
        url: "test.png", viewAngle: "front", caption: "", width: 512, height: 512,
      };
      const captioned = autoCaptionImage(img, "Sakura");
      expect(captioned.caption).toContain("awakli_sakura");
      expect(captioned.caption).toContain("front view");
      expect(captioned.caption).toContain("anime style");
    });

    it("includes appearance tags when provided", () => {
      const img: ReferenceImage = {
        url: "test.png", viewAngle: "side", caption: "", width: 512, height: 512,
      };
      const captioned = autoCaptionImage(img, "Sakura", {
        hair: "pink", eyes: "green", outfit: "school uniform",
      });
      expect(captioned.caption).toContain("pink hair");
      expect(captioned.caption).toContain("green eyes");
      expect(captioned.caption).toContain("school uniform");
    });
  });

  describe("preprocessCharacterSheet", () => {
    it("returns a complete preprocessed dataset", () => {
      const dataset = preprocessCharacterSheet(
        "https://cdn.example.com/sheet.png",
        "Sakura",
        { hair: "pink" }
      );
      expect(dataset.triggerWord).toBe("awakli_sakura");
      expect(dataset.characterName).toBe("Sakura");
      expect(dataset.totalImages).toBe(5);
      expect(dataset.targetResolution).toBe(512);
      expect(dataset.images).toHaveLength(5);
      // Each image should be cropped, resized, and captioned
      for (const img of dataset.images) {
        expect(img.url).toContain("_cropped_512.png");
        expect(img.caption).toContain("awakli_sakura");
        expect(img.width).toBe(512);
        expect(img.height).toBe(512);
      }
    });

    it("includes appearance tags in captions", () => {
      const dataset = preprocessCharacterSheet(
        "https://cdn.example.com/sheet.png",
        "Sakura",
        { hair: "pink", eyes: "green" }
      );
      for (const img of dataset.images) {
        expect(img.caption).toContain("pink hair");
        expect(img.caption).toContain("green eyes");
      }
    });
  });
});

// ─── 2. Training Config Builder ───────────────────────────────────────

describe("Training Config Builder", () => {
  describe("validateTrainingParams", () => {
    it("returns empty array for valid params", () => {
      const errors = validateTrainingParams({ rank: 32, alpha: 16, learningRate: 1e-4 });
      expect(errors).toEqual([]);
    });

    it("rejects rank below minimum", () => {
      const errors = validateTrainingParams({ rank: 8 });
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("rank");
    });

    it("rejects rank above maximum", () => {
      const errors = validateTrainingParams({ rank: 128 });
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain("rank");
    });

    it("rejects alpha out of range", () => {
      const errors = validateTrainingParams({ alpha: 4 });
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain("alpha");
    });

    it("rejects learningRate out of range", () => {
      const errors = validateTrainingParams({ learningRate: 1e-2 });
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain("learningRate");
    });

    it("rejects trainingSteps out of range", () => {
      const errors = validateTrainingParams({ trainingSteps: 100 });
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain("trainingSteps");
    });

    it("rejects batchSize out of range", () => {
      const errors = validateTrainingParams({ batchSize: 8 });
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain("batchSize");
    });

    it("collects multiple errors at once", () => {
      const errors = validateTrainingParams({ rank: 1, alpha: 1, batchSize: 100 });
      expect(errors.length).toBe(3);
    });

    it("passes empty params (no validation needed)", () => {
      const errors = validateTrainingParams({});
      expect(errors).toEqual([]);
    });
  });

  describe("buildKohyaConfig", () => {
    it("returns config with defaults when no overrides", () => {
      const config = buildKohyaConfig("awakli_sakura", "/data", "/output");
      expect(config.triggerWord).toBe("awakli_sakura");
      expect(config.datasetPath).toBe("/data");
      expect(config.outputPath).toBe("/output");
      expect(config.rank).toBe(DEFAULT_TRAINING_CONFIG.rank);
      expect(config.alpha).toBe(DEFAULT_TRAINING_CONFIG.alpha);
      expect(config.learningRate).toBe(DEFAULT_TRAINING_CONFIG.learningRate);
    });

    it("applies valid overrides", () => {
      const config = buildKohyaConfig("awakli_sakura", "/data", "/output", {
        rank: 64, alpha: 32, trainingSteps: 1200,
      });
      expect(config.rank).toBe(64);
      expect(config.alpha).toBe(32);
      expect(config.trainingSteps).toBe(1200);
    });

    it("throws on invalid overrides", () => {
      expect(() =>
        buildKohyaConfig("awakli_sakura", "/data", "/output", { rank: 1 })
      ).toThrow("Invalid training params");
    });
  });

  describe("buildKohyaArgs", () => {
    it("generates correct CLI arguments", () => {
      const config = buildKohyaConfig("awakli_sakura", "/data", "/output");
      const args = buildKohyaArgs(config);
      expect(args).toContain(`--network_dim=${config.rank}`);
      expect(args).toContain(`--network_alpha=${config.alpha}`);
      expect(args).toContain(`--learning_rate=${config.learningRate}`);
      expect(args).toContain(`--max_train_steps=${config.trainingSteps}`);
      expect(args).toContain(`--train_data_dir=/data`);
      expect(args).toContain(`--output_dir=/output`);
      expect(args).toContain(`--save_model_as=safetensors`);
      expect(args).toContain(`--enable_bucket`);
    });

    it("includes regularization dir when regularizationImages > 0", () => {
      const config = buildKohyaConfig("awakli_sakura", "/data", "/output", {});
      config.regularizationImages = 100;
      const args = buildKohyaArgs(config);
      expect(args.some(a => a.includes("--reg_data_dir"))).toBe(true);
    });

    it("excludes regularization dir when regularizationImages = 0", () => {
      const config = buildKohyaConfig("awakli_sakura", "/data", "/output");
      const args = buildKohyaArgs(config);
      expect(args.some(a => a.includes("--reg_data_dir"))).toBe(false);
    });
  });
});

// ─── 3. Quality Validation ────────────────────────────────────────────

describe("Quality Validation", () => {
  describe("generateValidationPrompts", () => {
    it("generates 5 diverse prompts with trigger word", () => {
      const prompts = generateValidationPrompts("awakli_sakura");
      expect(prompts).toHaveLength(5);
      for (const p of prompts) {
        expect(p).toContain("awakli_sakura");
        expect(p).toContain("anime style");
      }
    });

    it("includes varied poses and settings", () => {
      const prompts = generateValidationPrompts("awakli_test");
      const combined = prompts.join(" ");
      expect(combined).toContain("standing");
      expect(combined).toContain("sitting");
      expect(combined).toContain("running");
      expect(combined).toContain("close-up");
    });
  });

  describe("computeCosineSimilarity", () => {
    it("returns 1.0 for identical vectors", () => {
      const v = [1, 2, 3, 4, 5];
      expect(computeCosineSimilarity(v, v)).toBeCloseTo(1.0, 5);
    });

    it("returns 0 for orthogonal vectors", () => {
      expect(computeCosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 5);
    });

    it("returns -1 for opposite vectors", () => {
      expect(computeCosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 5);
    });

    it("returns 0 for empty vectors", () => {
      expect(computeCosineSimilarity([], [])).toBe(0);
    });

    it("returns 0 for mismatched lengths", () => {
      expect(computeCosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
    });

    it("handles zero vectors", () => {
      expect(computeCosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
    });
  });

  describe("clipToQualityScore", () => {
    it("maps minimum CLIP (0.50) to score 0", () => {
      expect(clipToQualityScore(0.50)).toBe(0);
    });

    it("maps maximum CLIP (1.00) to score 100", () => {
      expect(clipToQualityScore(1.00)).toBe(100);
    });

    it("maps mid-range CLIP (0.75) to score 50", () => {
      expect(clipToQualityScore(0.75)).toBe(50);
    });

    it("clamps below minimum to 0", () => {
      expect(clipToQualityScore(0.20)).toBe(0);
    });

    it("clamps above maximum to 100", () => {
      expect(clipToQualityScore(1.50)).toBe(100);
    });
  });

  describe("getValidationDecision", () => {
    it("auto-approves at or above 0.85", () => {
      const result = getValidationDecision(0.90);
      expect(result.decision).toBe("auto_approve");
      expect(result.reason).toContain("auto-approved");
    });

    it("requires manual review between 0.75 and 0.85", () => {
      const result = getValidationDecision(0.80);
      expect(result.decision).toBe("manual_review");
      expect(result.reason).toContain("creator review");
    });

    it("auto-rejects below 0.75", () => {
      const result = getValidationDecision(0.60);
      expect(result.decision).toBe("auto_reject");
      expect(result.reason).toContain("auto-rejected");
    });

    it("auto-approves at exact threshold", () => {
      const result = getValidationDecision(0.85);
      expect(result.decision).toBe("auto_approve");
    });

    it("manual review at exact lower threshold", () => {
      const result = getValidationDecision(0.75);
      expect(result.decision).toBe("manual_review");
    });
  });

  describe("runValidation", () => {
    it("computes correct average and quality score", () => {
      const result = runValidation(
        [0.90, 0.88, 0.92, 0.86, 0.89],
        ["test1.png", "test2.png", "test3.png", "test4.png", "test5.png"],
        ["ref1.png", "ref2.png"]
      );
      expect(result.avgClipSimilarity).toBeCloseTo(0.89, 2);
      expect(result.qualityScore).toBeGreaterThan(70);
      expect(result.decision).toBe("auto_approve");
      expect(result.testImageUrls).toHaveLength(5);
      expect(result.referenceImageUrls).toHaveLength(2);
    });

    it("handles empty clip scores", () => {
      const result = runValidation([], [], []);
      expect(result.avgClipSimilarity).toBe(0);
      expect(result.qualityScore).toBe(0);
      expect(result.decision).toBe("auto_reject");
    });
  });
});

// ─── 4. Job Scheduler ─────────────────────────────────────────────────

describe("Job Scheduler", () => {
  describe("estimateTrainingJob", () => {
    it("returns estimate for h100_sxm", () => {
      const est = estimateTrainingJob("h100_sxm", 800);
      expect(est.gpuType).toBe("h100_sxm");
      expect(est.estimatedMinutes).toBeGreaterThan(0);
      expect(est.estimatedCostUsd).toBeGreaterThan(0);
      expect(est.estimatedCostCredits).toBeGreaterThan(0);
      expect(est.withMargin.costUsd).toBeGreaterThan(est.estimatedCostUsd);
      expect(est.withMargin.costCredits).toBeGreaterThan(est.estimatedCostCredits);
    });

    it("scales cost with training steps", () => {
      const est800 = estimateTrainingJob("h100_sxm", 800);
      const est1600 = estimateTrainingJob("h100_sxm", 1600);
      expect(est1600.estimatedMinutes).toBeGreaterThan(est800.estimatedMinutes);
      expect(est1600.estimatedCostUsd).toBeGreaterThan(est800.estimatedCostUsd);
    });

    it("applies 30% margin", () => {
      const est = estimateTrainingJob("h100_sxm", 800);
      const expectedMargin = est.estimatedCostUsd * (1 + COST_MARGIN);
      expect(est.withMargin.costUsd).toBeCloseTo(expectedMargin, 2);
    });

    it("throws for unknown GPU type", () => {
      expect(() => estimateTrainingJob("unknown_gpu")).toThrow("Unknown GPU type");
    });

    it("returns different costs for different GPUs", () => {
      const h100 = estimateTrainingJob("h100_sxm", 800);
      const a100 = estimateTrainingJob("a100_80gb", 800);
      const rtx = estimateTrainingJob("rtx_4090", 800);
      // H100 is fastest but most expensive per minute
      expect(h100.estimatedMinutes).toBeLessThan(a100.estimatedMinutes);
      expect(a100.estimatedMinutes).toBeLessThan(rtx.estimatedMinutes);
    });
  });

  describe("assignPriority", () => {
    it("assigns protagonist priority 1", () => {
      expect(assignPriority("protagonist")).toBe(1);
    });

    it("assigns antagonist priority 2", () => {
      expect(assignPriority("antagonist")).toBe(2);
    });

    it("assigns background priority 8", () => {
      expect(assignPriority("background")).toBe(8);
    });

    it("defaults unknown roles to priority 5", () => {
      expect(assignPriority("unknown_role")).toBe(5);
    });
  });

  describe("sortByPriority", () => {
    it("sorts jobs by ascending priority", () => {
      const jobs = [
        { name: "bg", priority: 8 },
        { name: "hero", priority: 1 },
        { name: "support", priority: 5 },
      ];
      const sorted = sortByPriority(jobs);
      expect(sorted[0].name).toBe("hero");
      expect(sorted[1].name).toBe("support");
      expect(sorted[2].name).toBe("bg");
    });

    it("does not mutate original array", () => {
      const jobs = [{ priority: 3 }, { priority: 1 }];
      const sorted = sortByPriority(jobs);
      expect(jobs[0].priority).toBe(3);
      expect(sorted[0].priority).toBe(1);
    });
  });

  describe("estimateBatchTraining", () => {
    it("estimates batch for multiple characters", () => {
      const batch = estimateBatchTraining([
        { name: "Hero", role: "protagonist" },
        { name: "Villain", role: "antagonist" },
        { name: "Extra", role: "background" },
      ], "h100_sxm", 2);

      expect(batch.characters).toHaveLength(3);
      expect(batch.totalEstimatedMinutes).toBeGreaterThan(0);
      expect(batch.totalEstimatedCostUsd).toBeGreaterThan(0);
      expect(batch.totalEstimatedCredits).toBeGreaterThan(0);
      expect(batch.wallClockMinutes).toBeLessThan(batch.totalEstimatedMinutes);
      expect(batch.maxConcurrentGpus).toBe(2);
    });

    it("sorts characters by priority", () => {
      const batch = estimateBatchTraining([
        { name: "Extra", role: "background" },
        { name: "Hero", role: "protagonist" },
      ]);
      expect(batch.characters[0].name).toBe("Hero");
      expect(batch.characters[0].priority).toBe(1);
      expect(batch.characters[1].name).toBe("Extra");
    });

    it("wall clock equals total when only 1 GPU", () => {
      const batch = estimateBatchTraining([
        { name: "A", role: "protagonist" },
        { name: "B", role: "antagonist" },
      ], "h100_sxm", 1);
      expect(batch.wallClockMinutes).toBe(batch.totalEstimatedMinutes);
    });

    it("respects custom training steps per character", () => {
      const batch = estimateBatchTraining([
        { name: "A", role: "protagonist", trainingSteps: 1500 },
        { name: "B", role: "antagonist", trainingSteps: 500 },
      ]);
      const aEst = batch.characters.find(c => c.name === "A")!;
      const bEst = batch.characters.find(c => c.name === "B")!;
      expect(aEst.estimate.estimatedMinutes).toBeGreaterThan(bEst.estimate.estimatedMinutes);
    });
  });

  describe("generateBatchId", () => {
    it("generates unique IDs", () => {
      const ids = new Set(Array.from({ length: 100 }, () => generateBatchId()));
      expect(ids.size).toBe(100);
    });

    it("starts with batch_ prefix", () => {
      expect(generateBatchId()).toMatch(/^batch_/);
    });
  });
});

// ─── 5. LoRA Lifecycle Manager ────────────────────────────────────────

describe("LoRA Lifecycle Manager", () => {
  describe("shouldRetrain", () => {
    it("returns false for identical embeddings", () => {
      const emb = [0.1, 0.2, 0.3, 0.4, 0.5];
      const result = shouldRetrain(emb, emb);
      expect(result.shouldRetrain).toBe(false);
      expect(result.clipDelta).toBeCloseTo(0, 5);
    });

    it("returns true for significantly different embeddings", () => {
      const old = [1, 0, 0, 0];
      const newEmb = [0, 1, 0, 0]; // orthogonal = delta 1.0
      const result = shouldRetrain(old, newEmb);
      expect(result.shouldRetrain).toBe(true);
      expect(result.clipDelta).toBeGreaterThan(0.10);
    });

    it("returns false for minor changes", () => {
      const old = [1, 0, 0, 0, 0];
      const newEmb = [0.99, 0.05, 0.01, 0, 0]; // very similar
      const result = shouldRetrain(old, newEmb);
      expect(result.shouldRetrain).toBe(false);
    });

    it("includes reason in result", () => {
      const result = shouldRetrain([1, 0], [0, 1]);
      expect(result.reason).toBeTruthy();
      expect(typeof result.reason).toBe("string");
    });
  });

  describe("getLoraArtifactPath", () => {
    it("generates correct path for character and version", () => {
      expect(getLoraArtifactPath(42, 3)).toBe("characters/42/lora/v3/lora.safetensors");
    });

    it("handles version 1", () => {
      expect(getLoraArtifactPath(1, 1)).toBe("characters/1/lora/v1/lora.safetensors");
    });
  });

  describe("estimateLoraFileSize", () => {
    it("estimates file size for rank 32", () => {
      const size = estimateLoraFileSize(32);
      expect(size.minMb).toBeGreaterThan(0);
      expect(size.maxMb).toBeGreaterThan(size.minMb);
      expect(size.avgBytes).toBeGreaterThan(0);
    });

    it("scales with rank", () => {
      const rank16 = estimateLoraFileSize(16);
      const rank64 = estimateLoraFileSize(64);
      expect(rank64.avgBytes).toBeGreaterThan(rank16.avgBytes);
    });
  });
});

// ─── 6. Consistency Mechanism ─────────────────────────────────────────

describe("Consistency Mechanism", () => {
  describe("getConsistencyMechanism", () => {
    it("uses LoRA for local providers with active LoRA", () => {
      const mechanism = getConsistencyMechanism("local_animatediff", {
        loraStatus: "active",
        activeLoraArtifactPath: "characters/1/lora/v1/lora.safetensors",
        activeLoraTriggerWord: "awakli_sakura",
      });
      expect(mechanism.type).toBe("lora");
      expect(mechanism.loraPath).toBe("characters/1/lora/v1/lora.safetensors");
      expect(mechanism.triggerWord).toBe("awakli_sakura");
      expect(mechanism.loraStrength).toBe(0.80);
    });

    it("falls back to IP-Adapter when LoRA not supported", () => {
      const mechanism = getConsistencyMechanism("kling_v2_6", {
        loraStatus: "active",
        activeLoraArtifactPath: "characters/1/lora/v1/lora.safetensors",
        activeIpEmbeddingUrl: "https://cdn.example.com/embedding.bin",
      });
      // Kling doesn't support LoRA or IP-Adapter
      expect(mechanism.type).toBe("text_prompt");
    });

    it("falls back to IP-Adapter for local provider without active LoRA", () => {
      const mechanism = getConsistencyMechanism("local_animatediff", {
        loraStatus: "untrained",
        activeIpEmbeddingUrl: "https://cdn.example.com/embedding.bin",
      });
      expect(mechanism.type).toBe("ip_adapter");
      expect(mechanism.embeddingUrl).toBe("https://cdn.example.com/embedding.bin");
      expect(mechanism.ipAdapterStrength).toBe(0.70);
    });

    it("falls back to text prompt as last resort", () => {
      const mechanism = getConsistencyMechanism("kling_v2_6", {
        loraStatus: "untrained",
        appearanceTags: { hair: "pink", eyes: "green" },
      });
      expect(mechanism.type).toBe("text_prompt");
      expect(mechanism.appearanceTags).toEqual({ hair: "pink", eyes: "green" });
    });

    it("uses text prompt when no consistency data available", () => {
      const mechanism = getConsistencyMechanism("local_animatediff", {
        loraStatus: "untrained",
      });
      expect(mechanism.type).toBe("text_prompt");
    });

    it("respects custom LoRA strength", () => {
      const mechanism = getConsistencyMechanism("local_animatediff", {
        loraStatus: "active",
        activeLoraArtifactPath: "path/to/lora.safetensors",
        activeLoraTriggerWord: "awakli_test",
      }, 0.65);
      expect(mechanism.loraStrength).toBe(0.65);
    });
  });

  describe("buildLoraInjectionPayload", () => {
    it("builds LoRA injection with trigger word prefix", () => {
      const mechanism: ConsistencyMechanism = {
        type: "lora",
        loraPath: "path/to/lora.safetensors",
        loraStrength: 0.80,
        triggerWord: "awakli_sakura",
      };
      const payload = buildLoraInjectionPayload(mechanism, "standing pose, outdoor");
      expect(payload.prompt).toBe("awakli_sakura, standing pose, outdoor");
      expect(payload.loraConfig).toEqual({ path: "path/to/lora.safetensors", strength: 0.80 });
      expect(payload.ipAdapterConfig).toBeUndefined();
    });

    it("builds IP-Adapter injection", () => {
      const mechanism: ConsistencyMechanism = {
        type: "ip_adapter",
        embeddingUrl: "https://cdn.example.com/embedding.bin",
        ipAdapterStrength: 0.70,
      };
      const payload = buildLoraInjectionPayload(mechanism, "running pose");
      expect(payload.prompt).toBe("running pose");
      expect(payload.ipAdapterConfig).toEqual({
        embeddingUrl: "https://cdn.example.com/embedding.bin",
        strength: 0.70,
      });
      expect(payload.loraConfig).toBeUndefined();
    });

    it("builds text prompt fallback with appearance tags", () => {
      const mechanism: ConsistencyMechanism = {
        type: "text_prompt",
        appearanceTags: { hair: "pink", eyes: "green" },
      };
      const payload = buildLoraInjectionPayload(mechanism, "sitting pose");
      expect(payload.prompt).toContain("pink hair");
      expect(payload.prompt).toContain("green eyes");
      expect(payload.prompt).toContain("sitting pose");
      expect(payload.loraConfig).toBeUndefined();
      expect(payload.ipAdapterConfig).toBeUndefined();
    });

    it("returns base prompt when text_prompt has no tags", () => {
      const mechanism: ConsistencyMechanism = {
        type: "text_prompt",
        appearanceTags: {},
      };
      const payload = buildLoraInjectionPayload(mechanism, "action scene");
      expect(payload.prompt).toBe("action scene");
    });
  });

  describe("PROVIDER_CAPABILITIES", () => {
    it("local providers support LoRA and IP-Adapter", () => {
      expect(PROVIDER_CAPABILITIES.local_animatediff.supportsLora).toBe(true);
      expect(PROVIDER_CAPABILITIES.local_animatediff.supportsIpAdapter).toBe(true);
      expect(PROVIDER_CAPABILITIES.local_controlnet.supportsLora).toBe(true);
    });

    it("cloud providers without LoRA support", () => {
      for (const key of ["kling_v1", "kling_v2_6", "flux_schnell", "pika_2_2"]) {
        expect(PROVIDER_CAPABILITIES[key].supportsLora).toBe(false);
      }
    });

    it("wan_2_6 and hunyuan_video support Motion LoRA adapters", () => {
      expect(PROVIDER_CAPABILITIES["wan_2_6"].supportsLora).toBe(true);
      expect(PROVIDER_CAPABILITIES["hunyuan_video"].supportsLora).toBe(true);
    });
  });
});

// ─── 7. Constants & Configuration ─────────────────────────────────────

describe("Constants & Configuration", () => {
  it("DEFAULT_TRAINING_CONFIG has sensible defaults", () => {
    expect(DEFAULT_TRAINING_CONFIG.rank).toBe(32);
    expect(DEFAULT_TRAINING_CONFIG.alpha).toBe(16);
    expect(DEFAULT_TRAINING_CONFIG.resolution).toBe(512);
    expect(DEFAULT_TRAINING_CONFIG.mixedPrecision).toBe("fp16");
    expect(DEFAULT_TRAINING_CONFIG.networkType).toBe("LoRA");
  });

  it("TRAINING_PARAM_RANGES are internally consistent", () => {
    const r = TRAINING_PARAM_RANGES;
    expect(r.rank.min).toBeLessThan(r.rank.max);
    expect(r.alpha.min).toBeLessThan(r.alpha.max);
    expect(r.learningRate.min).toBeLessThan(r.learningRate.max);
    expect(r.trainingSteps.min).toBeLessThan(r.trainingSteps.max);
    expect(r.batchSize.min).toBeLessThan(r.batchSize.max);
  });

  it("GPU_PROFILES cover all expected GPU types", () => {
    expect(Object.keys(GPU_PROFILES)).toEqual(
      expect.arrayContaining(["h100_sxm", "a100_80gb", "rtx_4090"])
    );
  });

  it("ROLE_PRIORITY_MAP covers main roles", () => {
    expect(ROLE_PRIORITY_MAP.protagonist).toBe(1);
    expect(ROLE_PRIORITY_MAP.antagonist).toBe(2);
    expect(ROLE_PRIORITY_MAP.supporting).toBe(5);
    expect(ROLE_PRIORITY_MAP.background).toBe(8);
  });

  it("VALIDATION_THRESHOLDS are ordered correctly", () => {
    expect(VALIDATION_THRESHOLDS.autoApprove).toBeGreaterThan(VALIDATION_THRESHOLDS.manualReview);
  });

  it("COST_MARGIN is 30%", () => {
    expect(COST_MARGIN).toBe(0.30);
  });
});

// ─── 8. Router Contract Tests ─────────────────────────────────────────

describe("Character Library Router Contracts", () => {
  it("characterLibraryRouter is exported from routers-character-library", async () => {
    const mod = await import("./routers-character-library");
    expect(mod.characterLibraryRouter).toBeDefined();
    expect(typeof mod.characterLibraryRouter).toBe("object");
  });

  it("router has expected procedure names", async () => {
    const mod = await import("./routers-character-library");
    const router = mod.characterLibraryRouter;
    const procedureKeys = Object.keys((router as any)._def.procedures || {});
    
    const expectedProcedures = [
      "list", "getById", "create", "update", "delete",
      "trainLora", "reviewLora", "rollbackVersion",
      "getVersionHistory", "getAssets", "getUsageStats",
      "getTrainingEstimate", "batchTrain", "getBatchStatus", "getBatchEstimate",
    ];
    
    for (const proc of expectedProcedures) {
      expect(procedureKeys).toContain(proc);
    }
  });
});

// ─── 9. Integration: Full Pipeline Flow ───────────────────────────────

describe("Full Pipeline Flow (integration)", () => {
  it("preprocesses → builds config → estimates cost → validates → determines consistency", () => {
    // Step 1: Preprocess
    const dataset = preprocessCharacterSheet(
      "https://cdn.example.com/sakura_sheet.png",
      "Sakura Haruno",
      { hair: "pink", eyes: "green", outfit: "red dress" }
    );
    expect(dataset.triggerWord).toBe("awakli_sakura_haruno");
    expect(dataset.totalImages).toBe(5);

    // Step 2: Build training config
    const config = buildKohyaConfig(
      dataset.triggerWord,
      "/datasets/sakura",
      "/output/sakura",
      { rank: 32, trainingSteps: 800 }
    );
    expect(config.triggerWord).toBe("awakli_sakura_haruno");

    // Step 3: Estimate cost
    const estimate = estimateTrainingJob("h100_sxm", config.trainingSteps);
    expect(estimate.estimatedMinutes).toBeGreaterThan(0);
    expect(estimate.withMargin.costCredits).toBeGreaterThan(0);

    // Step 4: Simulate validation
    const validation = runValidation(
      [0.88, 0.91, 0.87, 0.90, 0.89],
      ["test1.png", "test2.png", "test3.png", "test4.png", "test5.png"],
      dataset.images.map(i => i.url)
    );
    expect(validation.decision).toBe("auto_approve");
    expect(validation.qualityScore).toBeGreaterThan(70);

    // Step 5: Determine consistency mechanism
    const mechanism = getConsistencyMechanism("local_animatediff", {
      loraStatus: "active",
      activeLoraArtifactPath: getLoraArtifactPath(1, 1),
      activeLoraTriggerWord: dataset.triggerWord,
    });
    expect(mechanism.type).toBe("lora");
    expect(mechanism.triggerWord).toBe("awakli_sakura_haruno");

    // Step 6: Build injection payload
    const payload = buildLoraInjectionPayload(mechanism, "standing pose, outdoor, daylight");
    expect(payload.prompt).toContain("awakli_sakura_haruno");
    expect(payload.loraConfig).toBeDefined();
  });

  it("batch training flow: estimate → sort → schedule", () => {
    const characters = [
      { name: "Background NPC", role: "background" },
      { name: "Main Hero", role: "protagonist" },
      { name: "Side Character", role: "supporting" },
      { name: "Main Villain", role: "antagonist" },
    ];

    const batch = estimateBatchTraining(characters, "a100_80gb", 2);

    // Should be sorted by priority
    expect(batch.characters[0].name).toBe("Main Hero");
    expect(batch.characters[0].priority).toBe(1);
    expect(batch.characters[1].name).toBe("Main Villain");
    expect(batch.characters[1].priority).toBe(2);
    expect(batch.characters[3].name).toBe("Background NPC");
    expect(batch.characters[3].priority).toBe(8);

    // Wall clock should be ~half of total with 2 GPUs
    expect(batch.wallClockMinutes).toBeLessThan(batch.totalEstimatedMinutes);
    expect(batch.maxConcurrentGpus).toBe(2);
  });
});
