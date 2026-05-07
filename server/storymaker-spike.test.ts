/**
 * Wave 7 — Item 1a: StoryMaker Mitsua Compatibility Spike Tests
 *
 * Tests the StoryMaker adapter, character identity rubric scoring,
 * deployment configuration resolution, and IMAGE→VIDEO handoff quality.
 *
 * These tests validate:
 * 1. Identity rubric scoring (face similarity, outfit, multi-pose, hair-color)
 * 2. Adapter parameter validation
 * 3. Cost estimation
 * 4. Endpoint resolution (dormant mode, fal.ai, RunPod)
 * 5. Batch identity evaluation with recommendations
 * 6. Histogram/proportion comparison utilities
 * 7. Error mapping and fallback behavior
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  StoryMakerAdapter,
  computeIdentityRubric,
  computeFaceSimilarity,
  computeHistogramSimilarity,
  computeProportionStability,
  batchEvaluateIdentity,
  resolveStoryMakerEndpoint,
  IDENTITY_RUBRIC_THRESHOLDS,
  IDENTITY_RUBRIC_WEIGHTS,
  DEPLOYMENT_CONFIGS,
  type StoryMakerParams,
  type CharacterIdentityRubric,
} from "./provider-router/adapters/storymaker-adapter";

// ─── Test Fixtures ──────────────────────────────────────────────────────────

const MOCK_FACE_EMBEDDING_A = Array.from({ length: 512 }, (_, i) => Math.sin(i * 0.1));
const MOCK_FACE_EMBEDDING_B = Array.from({ length: 512 }, (_, i) => Math.sin(i * 0.1 + 0.05)); // Very similar
const MOCK_FACE_EMBEDDING_C = Array.from({ length: 512 }, (_, i) => Math.cos(i * 0.3)); // Different

const MOCK_OUTFIT_HISTOGRAM = [0.1, 0.2, 0.3, 0.15, 0.1, 0.05, 0.05, 0.05];
const MOCK_OUTFIT_HISTOGRAM_SIMILAR = [0.12, 0.18, 0.28, 0.16, 0.11, 0.06, 0.04, 0.05];
const MOCK_OUTFIT_HISTOGRAM_DIFFERENT = [0.05, 0.05, 0.1, 0.1, 0.2, 0.2, 0.15, 0.15];

const MOCK_HAIR_HISTOGRAM = [0.0, 0.0, 0.1, 0.3, 0.4, 0.15, 0.05, 0.0];
const MOCK_HAIR_HISTOGRAM_SIMILAR = [0.0, 0.0, 0.12, 0.28, 0.38, 0.16, 0.06, 0.0];

const MOCK_PROPORTIONS_REF = { headToBodyRatio: 0.14, shoulderWidth: 0.25, height: 1.0 };
const MOCK_PROPORTIONS_SIMILAR = { headToBodyRatio: 0.145, shoulderWidth: 0.24, height: 0.98 };
const MOCK_PROPORTIONS_DIFFERENT = { headToBodyRatio: 0.2, shoulderWidth: 0.35, height: 0.7 };

// ─── Identity Rubric Tests ──────────────────────────────────────────────────

describe("Character Identity Rubric", () => {
  describe("computeIdentityRubric", () => {
    it("should pass when all dimensions exceed thresholds", () => {
      const rubric = computeIdentityRubric({
        faceSimilarity: 0.92,
        outfitConsistency: 0.88,
        multiPoseStability: 0.82,
        hairColorStability: 0.95,
      });

      expect(rubric.passes).toBe(true);
      expect(rubric.compositeScore).toBeGreaterThan(IDENTITY_RUBRIC_THRESHOLDS.compositeMinimum);
      expect(rubric.dimensionResults.faceSimilarity.passes).toBe(true);
      expect(rubric.dimensionResults.outfitConsistency.passes).toBe(true);
      expect(rubric.dimensionResults.multiPoseStability.passes).toBe(true);
      expect(rubric.dimensionResults.hairColorStability.passes).toBe(true);
    });

    it("should fail when face similarity is below threshold (critical dimension)", () => {
      const rubric = computeIdentityRubric({
        faceSimilarity: 0.70, // Below 0.85 threshold
        outfitConsistency: 0.90,
        multiPoseStability: 0.85,
        hairColorStability: 0.95,
      });

      expect(rubric.passes).toBe(false);
      expect(rubric.dimensionResults.faceSimilarity.passes).toBe(false);
      // Other dimensions may still pass
      expect(rubric.dimensionResults.outfitConsistency.passes).toBe(true);
    });

    it("should fail when composite score is below minimum even if face passes", () => {
      const rubric = computeIdentityRubric({
        faceSimilarity: 0.86, // Just above threshold
        outfitConsistency: 0.50, // Well below
        multiPoseStability: 0.50, // Well below
        hairColorStability: 0.60, // Below
      });

      expect(rubric.passes).toBe(false);
      expect(rubric.compositeScore).toBeLessThan(IDENTITY_RUBRIC_THRESHOLDS.compositeMinimum);
    });

    it("should compute correct weighted composite score", () => {
      const rubric = computeIdentityRubric({
        faceSimilarity: 1.0,
        outfitConsistency: 1.0,
        multiPoseStability: 1.0,
        hairColorStability: 1.0,
      });

      // All 1.0 → composite should be 1.0
      expect(rubric.compositeScore).toBe(1.0);
    });

    it("should compute weighted composite correctly with mixed scores", () => {
      const rubric = computeIdentityRubric({
        faceSimilarity: 0.9,
        outfitConsistency: 0.8,
        multiPoseStability: 0.7,
        hairColorStability: 0.6,
      });

      const expected =
        0.9 * IDENTITY_RUBRIC_WEIGHTS.faceSimilarity +
        0.8 * IDENTITY_RUBRIC_WEIGHTS.outfitConsistency +
        0.7 * IDENTITY_RUBRIC_WEIGHTS.multiPoseStability +
        0.6 * IDENTITY_RUBRIC_WEIGHTS.hairColorStability;

      expect(rubric.compositeScore).toBeCloseTo(expected, 3);
    });

    it("should clamp scores to [0, 1] range", () => {
      const rubric = computeIdentityRubric({
        faceSimilarity: 1.5, // Over 1.0
        outfitConsistency: -0.2, // Below 0.0
        multiPoseStability: 0.8,
        hairColorStability: 0.9,
      });

      expect(rubric.faceSimilarity).toBe(1.0);
      expect(rubric.outfitConsistency).toBe(0.0);
    });

    it("should include correct thresholds in dimension results", () => {
      const rubric = computeIdentityRubric({
        faceSimilarity: 0.9,
        outfitConsistency: 0.85,
        multiPoseStability: 0.8,
        hairColorStability: 0.92,
      });

      expect(rubric.dimensionResults.faceSimilarity.threshold).toBe(0.85);
      expect(rubric.dimensionResults.outfitConsistency.threshold).toBe(0.80);
      expect(rubric.dimensionResults.multiPoseStability.threshold).toBe(0.75);
      expect(rubric.dimensionResults.hairColorStability.threshold).toBe(0.90);
    });

    it("should handle edge case: all zeros", () => {
      const rubric = computeIdentityRubric({
        faceSimilarity: 0,
        outfitConsistency: 0,
        multiPoseStability: 0,
        hairColorStability: 0,
      });

      expect(rubric.passes).toBe(false);
      expect(rubric.compositeScore).toBe(0);
    });

    it("should handle borderline scores correctly", () => {
      const rubric = computeIdentityRubric({
        faceSimilarity: 0.85, // Exactly at threshold
        outfitConsistency: 0.80,
        multiPoseStability: 0.75,
        hairColorStability: 0.90,
      });

      expect(rubric.dimensionResults.faceSimilarity.passes).toBe(true);
      expect(rubric.dimensionResults.outfitConsistency.passes).toBe(true);
      expect(rubric.dimensionResults.multiPoseStability.passes).toBe(true);
      expect(rubric.dimensionResults.hairColorStability.passes).toBe(true);
    });
  });

  describe("computeFaceSimilarity", () => {
    it("should return 1.0 for identical embeddings", () => {
      const score = computeFaceSimilarity(MOCK_FACE_EMBEDDING_A, MOCK_FACE_EMBEDDING_A);
      expect(score).toBeCloseTo(1.0, 2);
    });

    it("should return high score for similar embeddings", () => {
      const score = computeFaceSimilarity(MOCK_FACE_EMBEDDING_A, MOCK_FACE_EMBEDDING_B);
      expect(score).toBeGreaterThan(0.9);
    });

    it("should return lower score for different embeddings", () => {
      const score = computeFaceSimilarity(MOCK_FACE_EMBEDDING_A, MOCK_FACE_EMBEDDING_C);
      expect(score).toBeLessThan(0.9);
    });

    it("should return 0 for empty embeddings", () => {
      expect(computeFaceSimilarity([], [])).toBe(0);
    });

    it("should return 0 for mismatched lengths", () => {
      expect(computeFaceSimilarity([1, 2, 3], [1, 2])).toBe(0);
    });

    it("should return 0 for zero vectors", () => {
      const zeros = Array(512).fill(0);
      expect(computeFaceSimilarity(zeros, zeros)).toBe(0);
    });

    it("should be symmetric", () => {
      const ab = computeFaceSimilarity(MOCK_FACE_EMBEDDING_A, MOCK_FACE_EMBEDDING_B);
      const ba = computeFaceSimilarity(MOCK_FACE_EMBEDDING_B, MOCK_FACE_EMBEDDING_A);
      expect(ab).toBeCloseTo(ba, 10);
    });

    it("should produce scores in [0, 1] range", () => {
      const score = computeFaceSimilarity(MOCK_FACE_EMBEDDING_A, MOCK_FACE_EMBEDDING_C);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    });
  });

  describe("computeHistogramSimilarity", () => {
    it("should return 1.0 for identical histograms", () => {
      const score = computeHistogramSimilarity(MOCK_OUTFIT_HISTOGRAM, MOCK_OUTFIT_HISTOGRAM);
      expect(score).toBeCloseTo(1.0, 2);
    });

    it("should return high score for similar histograms", () => {
      const score = computeHistogramSimilarity(MOCK_OUTFIT_HISTOGRAM, MOCK_OUTFIT_HISTOGRAM_SIMILAR);
      expect(score).toBeGreaterThan(0.95);
    });

    it("should return lower score for different histograms", () => {
      const score = computeHistogramSimilarity(MOCK_OUTFIT_HISTOGRAM, MOCK_OUTFIT_HISTOGRAM_DIFFERENT);
      expect(score).toBeLessThan(0.9);
    });

    it("should return 0 for empty histograms", () => {
      expect(computeHistogramSimilarity([], [])).toBe(0);
    });

    it("should return 0 for mismatched lengths", () => {
      expect(computeHistogramSimilarity([0.5, 0.5], [0.3, 0.3, 0.4])).toBe(0);
    });

    it("should handle all-zero histograms gracefully", () => {
      const zeros = [0, 0, 0, 0];
      const score = computeHistogramSimilarity(zeros, zeros);
      // Division by zero protection → should return 0 (no information)
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    });

    it("should be symmetric", () => {
      const ab = computeHistogramSimilarity(MOCK_OUTFIT_HISTOGRAM, MOCK_OUTFIT_HISTOGRAM_DIFFERENT);
      const ba = computeHistogramSimilarity(MOCK_OUTFIT_HISTOGRAM_DIFFERENT, MOCK_OUTFIT_HISTOGRAM);
      expect(ab).toBeCloseTo(ba, 10);
    });
  });

  describe("computeProportionStability", () => {
    it("should return 1.0 for identical proportions", () => {
      const score = computeProportionStability(MOCK_PROPORTIONS_REF, MOCK_PROPORTIONS_REF);
      expect(score).toBeCloseTo(1.0, 2);
    });

    it("should return high score for similar proportions", () => {
      const score = computeProportionStability(MOCK_PROPORTIONS_REF, MOCK_PROPORTIONS_SIMILAR);
      expect(score).toBeGreaterThan(0.9);
    });

    it("should return lower score for different proportions", () => {
      const score = computeProportionStability(MOCK_PROPORTIONS_REF, MOCK_PROPORTIONS_DIFFERENT);
      expect(score).toBeLessThan(0.7);
    });

    it("should handle zero reference values gracefully", () => {
      const score = computeProportionStability(
        { headToBodyRatio: 0, shoulderWidth: 0, height: 0 },
        MOCK_PROPORTIONS_REF,
      );
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    });

    it("should weight head-to-body ratio highest (0.4)", () => {
      // Only head ratio differs significantly
      const score1 = computeProportionStability(
        MOCK_PROPORTIONS_REF,
        { ...MOCK_PROPORTIONS_REF, headToBodyRatio: 0.28 }, // 100% deviation
      );
      // Only shoulder width differs significantly
      const score2 = computeProportionStability(
        MOCK_PROPORTIONS_REF,
        { ...MOCK_PROPORTIONS_REF, shoulderWidth: 0.50 }, // 100% deviation
      );
      // Head ratio deviation should cause more penalty (0.4 weight vs 0.3)
      expect(score1).toBeLessThan(score2);
    });
  });

  describe("batchEvaluateIdentity", () => {
    it("should return 'accept' when all views pass", () => {
      const result = batchEvaluateIdentity(
        MOCK_FACE_EMBEDDING_A,
        [
          { viewAngle: "three_quarter", faceEmbedding: MOCK_FACE_EMBEDDING_B, outfitColorHistogram: MOCK_OUTFIT_HISTOGRAM_SIMILAR, hairColorHistogram: MOCK_HAIR_HISTOGRAM_SIMILAR, bodyProportions: MOCK_PROPORTIONS_SIMILAR },
          { viewAngle: "side", faceEmbedding: MOCK_FACE_EMBEDDING_B, outfitColorHistogram: MOCK_OUTFIT_HISTOGRAM_SIMILAR, hairColorHistogram: MOCK_HAIR_HISTOGRAM_SIMILAR, bodyProportions: MOCK_PROPORTIONS_SIMILAR },
          { viewAngle: "back", faceEmbedding: MOCK_FACE_EMBEDDING_B, outfitColorHistogram: MOCK_OUTFIT_HISTOGRAM_SIMILAR, hairColorHistogram: MOCK_HAIR_HISTOGRAM_SIMILAR, bodyProportions: MOCK_PROPORTIONS_SIMILAR },
        ],
        MOCK_OUTFIT_HISTOGRAM,
        MOCK_HAIR_HISTOGRAM,
        MOCK_PROPORTIONS_REF,
      );

      expect(result.recommendation).toBe("accept");
      expect(result.retryAngles).toHaveLength(0);
      expect(result.perView).toHaveLength(3);
      expect(result.aggregate.passes).toBe(true);
    });

    it("should return 'retry_specific' when 1-2 views fail with decent aggregate", () => {
      const result = batchEvaluateIdentity(
        MOCK_FACE_EMBEDDING_A,
        [
          { viewAngle: "three_quarter", faceEmbedding: MOCK_FACE_EMBEDDING_B, outfitColorHistogram: MOCK_OUTFIT_HISTOGRAM_SIMILAR, hairColorHistogram: MOCK_HAIR_HISTOGRAM_SIMILAR, bodyProportions: MOCK_PROPORTIONS_SIMILAR },
          { viewAngle: "side", faceEmbedding: MOCK_FACE_EMBEDDING_C, outfitColorHistogram: MOCK_OUTFIT_HISTOGRAM_DIFFERENT, hairColorHistogram: MOCK_HAIR_HISTOGRAM, bodyProportions: MOCK_PROPORTIONS_DIFFERENT },
          { viewAngle: "back", faceEmbedding: MOCK_FACE_EMBEDDING_B, outfitColorHistogram: MOCK_OUTFIT_HISTOGRAM_SIMILAR, hairColorHistogram: MOCK_HAIR_HISTOGRAM_SIMILAR, bodyProportions: MOCK_PROPORTIONS_SIMILAR },
        ],
        MOCK_OUTFIT_HISTOGRAM,
        MOCK_HAIR_HISTOGRAM,
        MOCK_PROPORTIONS_REF,
      );

      // The side view should fail due to different face embedding
      expect(result.recommendation).toBe("retry_specific");
      expect(result.retryAngles).toContain("side");
    });

    it("should return 'retry_all' when most views fail", () => {
      const result = batchEvaluateIdentity(
        MOCK_FACE_EMBEDDING_A,
        [
          { viewAngle: "three_quarter", faceEmbedding: MOCK_FACE_EMBEDDING_C },
          { viewAngle: "side", faceEmbedding: MOCK_FACE_EMBEDDING_C },
          { viewAngle: "back", faceEmbedding: MOCK_FACE_EMBEDDING_C },
        ],
        MOCK_OUTFIT_HISTOGRAM,
        MOCK_HAIR_HISTOGRAM,
        MOCK_PROPORTIONS_REF,
      );

      expect(result.recommendation).toBe("retry_all");
      expect(result.retryAngles.length).toBeGreaterThanOrEqual(2);
    });

    it("should use conservative defaults when embeddings are missing", () => {
      const result = batchEvaluateIdentity(
        MOCK_FACE_EMBEDDING_A,
        [
          { viewAngle: "three_quarter" }, // No embeddings at all
          { viewAngle: "side" },
        ],
      );

      // Should still produce results with conservative defaults
      expect(result.perView).toHaveLength(2);
      expect(result.perView[0].rubric.faceSimilarity).toBe(0.5); // Default
      expect(result.perView[0].rubric.outfitConsistency).toBe(0.7); // Default
    });

    it("should compute aggregate as average of per-view scores", () => {
      const result = batchEvaluateIdentity(
        MOCK_FACE_EMBEDDING_A,
        [
          { viewAngle: "three_quarter", faceEmbedding: MOCK_FACE_EMBEDDING_A },
          { viewAngle: "side", faceEmbedding: MOCK_FACE_EMBEDDING_A },
        ],
      );

      // Both views use identical embedding → face similarity should be ~1.0
      const avgFace = result.perView.reduce((s, v) => s + v.rubric.faceSimilarity, 0) / 2;
      expect(result.aggregate.faceSimilarity).toBeCloseTo(avgFace, 3);
    });
  });
});

// ─── Adapter Tests ──────────────────────────────────────────────────────────

describe("StoryMakerAdapter", () => {
  let adapter: StoryMakerAdapter;

  beforeEach(() => {
    adapter = new StoryMakerAdapter();
  });

  describe("providerId", () => {
    it("should have correct provider ID", () => {
      expect(adapter.providerId).toBe("storymaker_v1");
    });
  });

  describe("validateParams", () => {
    it("should pass with valid StoryMaker params", () => {
      const result = adapter.validateParams({
        prompt: "anime girl, blue hair, school uniform",
        faceImageUrl: "https://example.com/face.png",
        width: 1024,
        height: 1024,
      } as StoryMakerParams);

      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it("should fail without prompt", () => {
      const result = adapter.validateParams({
        prompt: "",
        faceImageUrl: "https://example.com/face.png",
      } as StoryMakerParams);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("prompt is required");
    });

    it("should fail without faceImageUrl", () => {
      const result = adapter.validateParams({
        prompt: "test prompt",
        faceImageUrl: "",
      } as StoryMakerParams);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("faceImageUrl is required for StoryMaker identity preservation");
    });

    it("should fail with width below minimum (512)", () => {
      const result = adapter.validateParams({
        prompt: "test",
        faceImageUrl: "https://example.com/face.png",
        width: 256,
      } as StoryMakerParams);

      expect(result.valid).toBe(false);
      expect(result.errors?.[0]).toContain("width must be 512-1536");
    });

    it("should fail with width above maximum (1536)", () => {
      const result = adapter.validateParams({
        prompt: "test",
        faceImageUrl: "https://example.com/face.png",
        width: 2048,
      } as StoryMakerParams);

      expect(result.valid).toBe(false);
      expect(result.errors?.[0]).toContain("width must be 512-1536");
    });

    it("should fail with height below minimum (512)", () => {
      const result = adapter.validateParams({
        prompt: "test",
        faceImageUrl: "https://example.com/face.png",
        height: 256,
      } as StoryMakerParams);

      expect(result.valid).toBe(false);
      expect(result.errors?.[0]).toContain("height must be 512-1536");
    });

    it("should fail with invalid faceScale (>1.0)", () => {
      const result = adapter.validateParams({
        prompt: "test",
        faceImageUrl: "https://example.com/face.png",
        faceScale: 1.5,
      } as StoryMakerParams);

      expect(result.valid).toBe(false);
      expect(result.errors?.[0]).toContain("faceScale must be 0.0-1.0");
    });

    it("should fail with invalid faceScale (<0)", () => {
      const result = adapter.validateParams({
        prompt: "test",
        faceImageUrl: "https://example.com/face.png",
        faceScale: -0.1,
      } as StoryMakerParams);

      expect(result.valid).toBe(false);
      expect(result.errors?.[0]).toContain("faceScale must be 0.0-1.0");
    });

    it("should fail with invalid outfitScale", () => {
      const result = adapter.validateParams({
        prompt: "test",
        faceImageUrl: "https://example.com/face.png",
        outfitScale: 2.0,
      } as StoryMakerParams);

      expect(result.valid).toBe(false);
      expect(result.errors?.[0]).toContain("outfitScale must be 0.0-1.0");
    });

    it("should fail with invalid URL format for faceImageUrl", () => {
      const result = adapter.validateParams({
        prompt: "test",
        faceImageUrl: "not-a-url",
      } as StoryMakerParams);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("faceImageUrl must be a valid HTTP(S) URL");
    });

    it("should fail with invalid URL format for outfitImageUrl", () => {
      const result = adapter.validateParams({
        prompt: "test",
        faceImageUrl: "https://example.com/face.png",
        outfitImageUrl: "ftp://invalid.com/outfit.png",
      } as StoryMakerParams);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain("outfitImageUrl must be a valid HTTP(S) URL");
    });

    it("should collect multiple errors", () => {
      const result = adapter.validateParams({
        prompt: "",
        faceImageUrl: "",
        width: 2048,
        faceScale: 1.5,
      } as StoryMakerParams);

      expect(result.valid).toBe(false);
      expect(result.errors!.length).toBeGreaterThanOrEqual(3);
    });

    it("should accept valid optional outfitImageUrl", () => {
      const result = adapter.validateParams({
        prompt: "test",
        faceImageUrl: "https://example.com/face.png",
        outfitImageUrl: "https://example.com/outfit.png",
      } as StoryMakerParams);

      expect(result.valid).toBe(true);
    });
  });

  describe("estimateCostUsd", () => {
    it("should estimate base cost for standard resolution", () => {
      const cost = adapter.estimateCostUsd({
        prompt: "test",
        faceImageUrl: "https://example.com/face.png",
        width: 1024,
        height: 1024,
      } as StoryMakerParams);

      expect(cost).toBe(0.1); // $0.10 base
    });

    it("should apply high-res multiplier for >1024 width", () => {
      const cost = adapter.estimateCostUsd({
        prompt: "test",
        faceImageUrl: "https://example.com/face.png",
        width: 1280,
        height: 960,
      } as StoryMakerParams);

      expect(cost).toBe(0.15); // $0.10 * 1.5
    });

    it("should apply high-res multiplier for >1024 height", () => {
      const cost = adapter.estimateCostUsd({
        prompt: "test",
        faceImageUrl: "https://example.com/face.png",
        width: 960,
        height: 1280,
      } as StoryMakerParams);

      expect(cost).toBe(0.15);
    });

    it("should multiply by numImages", () => {
      const cost = adapter.estimateCostUsd({
        prompt: "test",
        faceImageUrl: "https://example.com/face.png",
        width: 1024,
        height: 1024,
        numImages: 4,
      } as StoryMakerParams);

      expect(cost).toBe(0.4); // $0.10 * 4
    });

    it("should default to 1 image when numImages not specified", () => {
      const cost = adapter.estimateCostUsd({
        prompt: "test",
        faceImageUrl: "https://example.com/face.png",
      } as StoryMakerParams);

      expect(cost).toBe(0.1);
    });
  });

  describe("execute (dormant mode)", () => {
    it("should throw UNSUPPORTED when no endpoint configured", async () => {
      // Ensure env var is not set
      const original = process.env.STORYMAKER_ENDPOINT_URL;
      delete process.env.STORYMAKER_ENDPOINT_URL;

      try {
        await expect(
          adapter.execute(
            { prompt: "test", faceImageUrl: "https://example.com/face.png" } as StoryMakerParams,
            { apiKey: "test", apiKeyId: 1, endpointUrl: "", timeout: 30000 },
          ),
        ).rejects.toThrow(/StoryMaker endpoint not available/);
      } finally {
        if (original) process.env.STORYMAKER_ENDPOINT_URL = original;
      }
    });
  });
});

// ─── Endpoint Resolution Tests ──────────────────────────────────────────────

describe("resolveStoryMakerEndpoint", () => {
  const originalEnv = process.env.STORYMAKER_ENDPOINT_URL;

  afterEach(() => {
    if (originalEnv) {
      process.env.STORYMAKER_ENDPOINT_URL = originalEnv;
    } else {
      delete process.env.STORYMAKER_ENDPOINT_URL;
    }
  });

  it("should return unavailable when env not set", () => {
    delete process.env.STORYMAKER_ENDPOINT_URL;
    const result = resolveStoryMakerEndpoint();

    expect(result.available).toBe(false);
    expect(result.config).toBeNull();
    expect(result.endpointUrl).toBeNull();
    expect(result.reason).toContain("STORYMAKER_ENDPOINT_URL not configured");
  });

  it("should detect fal.ai endpoint from URL", () => {
    process.env.STORYMAKER_ENDPOINT_URL = "https://fal.run/user123/storymaker-v1";
    const result = resolveStoryMakerEndpoint();

    expect(result.available).toBe(true);
    expect(result.config!.provider).toBe("fal_custom");
    expect(result.endpointUrl).toBe("https://fal.run/user123/storymaker-v1");
  });

  it("should detect RunPod endpoint from URL", () => {
    process.env.STORYMAKER_ENDPOINT_URL = "https://api.runpod.ai/v2/abc123def456";
    const result = resolveStoryMakerEndpoint();

    expect(result.available).toBe(true);
    expect(result.config!.provider).toBe("runpod");
    expect(result.endpointUrl).toBe("https://api.runpod.ai/v2/abc123def456");
  });

  it("should default to fal_custom for unknown URL patterns", () => {
    process.env.STORYMAKER_ENDPOINT_URL = "https://custom-server.example.com/storymaker";
    const result = resolveStoryMakerEndpoint();

    expect(result.available).toBe(true);
    expect(result.config!.provider).toBe("fal_custom");
  });

  it("should set correct timeout values for fal_custom", () => {
    process.env.STORYMAKER_ENDPOINT_URL = "https://fal.run/user/model";
    const result = resolveStoryMakerEndpoint();

    expect(result.config!.coldStartTimeoutMs).toBe(90_000);
    expect(result.config!.warmTimeoutMs).toBe(30_000);
  });

  it("should set correct timeout values for runpod", () => {
    process.env.STORYMAKER_ENDPOINT_URL = "https://api.runpod.ai/v2/endpoint123";
    const result = resolveStoryMakerEndpoint();

    expect(result.config!.coldStartTimeoutMs).toBe(120_000);
    expect(result.config!.warmTimeoutMs).toBe(45_000);
  });
});

// ─── Configuration Constants Tests ──────────────────────────────────────────

describe("Configuration Constants", () => {
  describe("IDENTITY_RUBRIC_THRESHOLDS", () => {
    it("should have all required threshold dimensions", () => {
      expect(IDENTITY_RUBRIC_THRESHOLDS.faceSimilarity).toBe(0.85);
      expect(IDENTITY_RUBRIC_THRESHOLDS.outfitConsistency).toBe(0.80);
      expect(IDENTITY_RUBRIC_THRESHOLDS.multiPoseStability).toBe(0.75);
      expect(IDENTITY_RUBRIC_THRESHOLDS.hairColorStability).toBe(0.90);
      expect(IDENTITY_RUBRIC_THRESHOLDS.compositeMinimum).toBe(0.80);
    });
  });

  describe("IDENTITY_RUBRIC_WEIGHTS", () => {
    it("should sum to 1.0", () => {
      const sum =
        IDENTITY_RUBRIC_WEIGHTS.faceSimilarity +
        IDENTITY_RUBRIC_WEIGHTS.outfitConsistency +
        IDENTITY_RUBRIC_WEIGHTS.multiPoseStability +
        IDENTITY_RUBRIC_WEIGHTS.hairColorStability;

      expect(sum).toBeCloseTo(1.0, 10);
    });

    it("should weight face similarity highest", () => {
      expect(IDENTITY_RUBRIC_WEIGHTS.faceSimilarity).toBeGreaterThan(IDENTITY_RUBRIC_WEIGHTS.outfitConsistency);
      expect(IDENTITY_RUBRIC_WEIGHTS.faceSimilarity).toBeGreaterThan(IDENTITY_RUBRIC_WEIGHTS.multiPoseStability);
      expect(IDENTITY_RUBRIC_WEIGHTS.faceSimilarity).toBeGreaterThan(IDENTITY_RUBRIC_WEIGHTS.hairColorStability);
    });
  });

  describe("DEPLOYMENT_CONFIGS", () => {
    it("should have fal_custom config", () => {
      expect(DEPLOYMENT_CONFIGS.fal_custom).toBeDefined();
      expect(DEPLOYMENT_CONFIGS.fal_custom.provider).toBe("fal_custom");
      expect(DEPLOYMENT_CONFIGS.fal_custom.apiKeyEnv).toBe("FAL_API_KEY");
    });

    it("should have runpod config", () => {
      expect(DEPLOYMENT_CONFIGS.runpod).toBeDefined();
      expect(DEPLOYMENT_CONFIGS.runpod.provider).toBe("runpod");
      expect(DEPLOYMENT_CONFIGS.runpod.apiKeyEnv).toBe("RUNPOD_API_KEY");
    });

    it("should have reasonable cold-start timeouts", () => {
      expect(DEPLOYMENT_CONFIGS.fal_custom.coldStartTimeoutMs).toBeGreaterThanOrEqual(60_000);
      expect(DEPLOYMENT_CONFIGS.runpod.coldStartTimeoutMs).toBeGreaterThanOrEqual(60_000);
    });
  });
});

// ─── IMAGE→VIDEO Handoff Quality Tests ──────────────────────────────────────

describe("IMAGE→VIDEO Handoff Quality Assessment", () => {
  it("should define the handoff quality measurement contract", () => {
    /**
     * The Mitsua compatibility spike validates that StoryMaker-generated
     * character reference images maintain identity when fed into downstream
     * video generation (PixVerse, Kling, Seedance).
     *
     * The handoff contract:
     * 1. StoryMaker generates a character reference image (1024x1024, PNG)
     * 2. The image URL is passed as `imageUrl` to VideoParams
     * 3. Video generation uses it as the first frame / reference
     * 4. Identity should be preserved in the generated video
     *
     * This test validates the contract shape, not actual API calls.
     */
    const storymakerOutput: AdapterResult = {
      storageUrl: "https://s3.example.com/characters/42/front_1234.png",
      mimeType: "image/png",
      metadata: {
        model: "storymaker_v1",
        provider: "fal_custom",
        seed: 12345,
        faceAnalysis: {
          face_count: 1,
          confidence: 0.98,
          embedding: MOCK_FACE_EMBEDDING_A.slice(0, 10), // Truncated for test
        },
      },
    };

    // The storageUrl from StoryMaker feeds into VideoParams.imageUrl
    const videoParams = {
      imageUrl: storymakerOutput.storageUrl,
      prompt: "anime girl walking in park, gentle breeze, sakura petals",
      durationSeconds: 5,
      aspectRatio: "16:9",
    };

    expect(videoParams.imageUrl).toBe(storymakerOutput.storageUrl);
    expect(storymakerOutput.mimeType).toBe("image/png");
    expect(storymakerOutput.metadata?.faceAnalysis).toBeDefined();
  });

  it("should validate that face embeddings can be compared across pipeline stages", () => {
    // Stage 1: StoryMaker generates front view with face embedding
    const frontViewEmbedding = MOCK_FACE_EMBEDDING_A;

    // Stage 2: StoryMaker generates side view with face embedding
    const sideViewEmbedding = MOCK_FACE_EMBEDDING_B;

    // Stage 3: Video frame extracted face embedding (simulated)
    const videoFrameEmbedding = Array.from({ length: 512 }, (_, i) => Math.sin(i * 0.1 + 0.02));

    // Cross-stage similarity should remain high
    const frontToSide = computeFaceSimilarity(frontViewEmbedding, sideViewEmbedding);
    const frontToVideo = computeFaceSimilarity(frontViewEmbedding, videoFrameEmbedding);

    expect(frontToSide).toBeGreaterThan(0.9);
    expect(frontToVideo).toBeGreaterThan(0.9);

    // The handoff quality is: frontToVideo should not degrade significantly from frontToSide
    const degradation = frontToSide - frontToVideo;
    expect(degradation).toBeLessThan(0.1); // Max 10% degradation acceptable
  });

  it("should define the spike result fixture schema", () => {
    // This is the schema for test-results/storymaker-mitsua-compat-YYYY-MM-DD.json
    const spikeResultSchema = {
      timestamp: expect.any(String),
      version: "1.0.0",
      provider: "storymaker_v1",
      deploymentTarget: expect.stringMatching(/fal_custom|runpod|mock/),
      characterCount: expect.any(Number),
      results: expect.arrayContaining([
        expect.objectContaining({
          characterId: expect.any(String),
          views: expect.arrayContaining([
            expect.objectContaining({
              viewAngle: expect.stringMatching(/front|three_quarter|side|back/),
              imageUrl: expect.any(String),
              faceEmbedding: expect.any(Array),
              inferenceTimeMs: expect.any(Number),
            }),
          ]),
          rubric: expect.objectContaining({
            compositeScore: expect.any(Number),
            passes: expect.any(Boolean),
          }),
        }),
      ]),
      aggregate: expect.objectContaining({
        avgCompositeScore: expect.any(Number),
        passRate: expect.any(Number),
        avgInferenceTimeMs: expect.any(Number),
      }),
      handoffQuality: expect.objectContaining({
        avgDegradation: expect.any(Number),
        maxDegradation: expect.any(Number),
        recommendation: expect.stringMatching(/production_ready|needs_tuning|not_viable/),
      }),
    };

    // Validate the schema shape (this documents the expected fixture format)
    const mockFixture = {
      timestamp: new Date().toISOString(),
      version: "1.0.0",
      provider: "storymaker_v1",
      deploymentTarget: "mock",
      characterCount: 5,
      results: [
        {
          characterId: "char_001",
          views: [
            { viewAngle: "front", imageUrl: "https://s3.example.com/front.png", faceEmbedding: [0.1, 0.2], inferenceTimeMs: 8500 },
            { viewAngle: "three_quarter", imageUrl: "https://s3.example.com/3q.png", faceEmbedding: [0.1, 0.2], inferenceTimeMs: 7200 },
          ],
          rubric: { compositeScore: 0.88, passes: true },
        },
      ],
      aggregate: { avgCompositeScore: 0.88, passRate: 1.0, avgInferenceTimeMs: 7850 },
      handoffQuality: { avgDegradation: 0.03, maxDegradation: 0.07, recommendation: "production_ready" },
    };

    expect(mockFixture).toMatchObject(spikeResultSchema);
  });
});

// ─── Import Type Check ──────────────────────────────────────────────────────

describe("Module Exports", () => {
  it("should export all required types and functions", () => {
    expect(StoryMakerAdapter).toBeDefined();
    expect(computeIdentityRubric).toBeInstanceOf(Function);
    expect(computeFaceSimilarity).toBeInstanceOf(Function);
    expect(computeHistogramSimilarity).toBeInstanceOf(Function);
    expect(computeProportionStability).toBeInstanceOf(Function);
    expect(batchEvaluateIdentity).toBeInstanceOf(Function);
    expect(resolveStoryMakerEndpoint).toBeInstanceOf(Function);
    expect(IDENTITY_RUBRIC_THRESHOLDS).toBeDefined();
    expect(IDENTITY_RUBRIC_WEIGHTS).toBeDefined();
    expect(DEPLOYMENT_CONFIGS).toBeDefined();
  });

  it("should self-register the adapter on import", async () => {
    // The adapter registers itself when imported
    const { hasAdapter } = await import("./provider-router/registry");
    expect(hasAdapter("storymaker_v1")).toBe(true);
  });
});
