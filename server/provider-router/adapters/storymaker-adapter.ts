/**
 * Wave 7 — Item 1a/1c: StoryMaker Character Identity Adapter
 *
 * Implements the ProviderAdapter interface for RED-AIGC StoryMaker,
 * a custom SDXL-based identity-preservation model that generates
 * character reference images with consistent face, outfit, hairstyle,
 * and body proportions across multiple poses.
 *
 * Deployment: StoryMaker has no pre-deployed API endpoint.
 * This adapter supports two configurable deployment targets:
 * 1. fal.ai Custom Inference (Enterprise Feature — requires access request)
 * 2. RunPod Serverless (fallback — custom Docker container)
 *
 * The endpoint URL is configurable via STORYMAKER_ENDPOINT_URL env var.
 * When no endpoint is configured, the adapter enters "dormant" mode
 * and returns a descriptive error guiding deployment.
 *
 * Character Identity Rubric (§7.2):
 * - Face Similarity: cosine similarity of face embeddings across poses (target ≥0.85)
 * - Outfit Consistency: clothing pattern/color preservation (target ≥0.80)
 * - Multi-Pose Stability: proportional consistency across front/3Q/side/back (target ≥0.75)
 * - Hair-Color Stability: hair color/style preservation across lighting (target ≥0.90)
 *
 * @see wave7-storymaker-architecture.md for deployment analysis
 * @see server/benchmarks/d0/character-designer.ts for downstream integration
 * @see Awakli_Pipeline_Blueprint_v1_9_1_Adapter_Architecture_Addendum §7.2
 */

import type {
  ProviderAdapter,
  GenerationParams,
  ImageParams,
  ExecutionContext,
  AdapterResult,
} from "../types";
import { ProviderError } from "../types";
import { registerAdapter, getActiveApiKey } from "../registry";

// ─── StoryMaker-Specific Types ──────────────────────────────────────────────

/**
 * Extended image params for StoryMaker identity-preserved generation.
 * Extends standard ImageParams with face/outfit reference inputs.
 */
export interface StoryMakerParams extends ImageParams {
  /** URL to the face reference image (primary identity anchor) */
  faceImageUrl: string;
  /** URL to the outfit/clothing reference image (optional, uses face image if omitted) */
  outfitImageUrl?: string;
  /** Character ID for tracking and consistency scoring */
  characterId?: string | number;
  /** IP-Adapter scale for face identity strength (0.0-1.0, default 0.8) */
  faceScale?: number;
  /** LoRA scale for clothing/body identity strength (0.0-1.0, default 0.8) */
  outfitScale?: number;
  /** Target pose/angle for the generated image */
  targetPose?: "front" | "three_quarter" | "side" | "back" | "custom";
  /** Whether to apply anime-style conditioning to the output */
  animeConditioning?: boolean;
}

/**
 * Character Identity Rubric — scoring dimensions for identity preservation.
 * Each dimension is scored 0.0-1.0 with configurable thresholds.
 */
export interface CharacterIdentityRubric {
  /** Face embedding cosine similarity across poses */
  faceSimilarity: number;
  /** Clothing pattern/color preservation score */
  outfitConsistency: number;
  /** Proportional consistency across multiple poses */
  multiPoseStability: number;
  /** Hair color/style preservation across lighting conditions */
  hairColorStability: number;
  /** Weighted composite score */
  compositeScore: number;
  /** Whether the composite passes the minimum threshold */
  passes: boolean;
  /** Per-dimension pass/fail */
  dimensionResults: {
    faceSimilarity: { score: number; passes: boolean; threshold: number };
    outfitConsistency: { score: number; passes: boolean; threshold: number };
    multiPoseStability: { score: number; passes: boolean; threshold: number };
    hairColorStability: { score: number; passes: boolean; threshold: number };
  };
}

/**
 * StoryMaker generation result with identity metadata.
 */
export interface StoryMakerResult {
  /** Generated image URL */
  imageUrl: string;
  /** Face analysis metadata from InsightFace */
  faceAnalysis?: {
    /** Number of faces detected */
    faceCount: number;
    /** Bounding box of primary face [x, y, w, h] */
    bbox?: number[];
    /** Face embedding vector (512-dim) for downstream comparison */
    embedding?: number[];
    /** Detection confidence */
    confidence: number;
  };
  /** Generation metadata */
  metadata: {
    /** Inference time in ms */
    inferenceTimeMs: number;
    /** Whether this was a cold-start request */
    wasColdStart: boolean;
    /** Model version used */
    modelVersion: string;
    /** Seed used for reproducibility */
    seed?: number;
    /** Actual scales applied */
    appliedFaceScale: number;
    appliedOutfitScale: number;
  };
}

// ─── Configuration ──────────────────────────────────────────────────────────

/**
 * Identity rubric thresholds — configurable per deployment.
 * These represent minimum acceptable scores for production use.
 */
export const IDENTITY_RUBRIC_THRESHOLDS = {
  faceSimilarity: 0.85,
  outfitConsistency: 0.80,
  multiPoseStability: 0.75,
  hairColorStability: 0.90,
  compositeMinimum: 0.80,
} as const;

/**
 * Rubric dimension weights for composite score calculation.
 * Face similarity is weighted highest as it's the primary identity anchor.
 */
export const IDENTITY_RUBRIC_WEIGHTS = {
  faceSimilarity: 0.35,
  outfitConsistency: 0.25,
  multiPoseStability: 0.20,
  hairColorStability: 0.20,
} as const;

/**
 * StoryMaker deployment configuration.
 */
export interface StoryMakerDeploymentConfig {
  /** Endpoint URL (fal.ai custom or RunPod serverless) */
  endpointUrl: string;
  /** Deployment provider type */
  provider: "fal_custom" | "runpod";
  /** API key environment variable name */
  apiKeyEnv: string;
  /** Cold-start timeout in ms (fal: 60s, RunPod: configurable) */
  coldStartTimeoutMs: number;
  /** Warm inference timeout in ms */
  warmTimeoutMs: number;
  /** Maximum concurrent requests */
  maxConcurrent: number;
}

/**
 * Default deployment configs for each provider option.
 */
export const DEPLOYMENT_CONFIGS: Record<string, StoryMakerDeploymentConfig> = {
  fal_custom: {
    endpointUrl: "", // Set via STORYMAKER_ENDPOINT_URL
    provider: "fal_custom",
    apiKeyEnv: "FAL_API_KEY",
    coldStartTimeoutMs: 90_000,  // SDXL cold start ~30-60s + buffer
    warmTimeoutMs: 30_000,       // Warm inference ~5-15s + buffer
    maxConcurrent: 10,
  },
  runpod: {
    endpointUrl: "", // Set via STORYMAKER_ENDPOINT_URL
    provider: "runpod",
    apiKeyEnv: "RUNPOD_API_KEY",
    coldStartTimeoutMs: 120_000, // RunPod cold start varies
    warmTimeoutMs: 45_000,       // RunPod warm ~10-20s + buffer
    maxConcurrent: 5,
  },
};

// ─── Identity Rubric Scoring ────────────────────────────────────────────────

/**
 * Compute the character identity rubric composite score.
 * Used to evaluate whether a StoryMaker generation maintains
 * sufficient identity preservation for production use.
 *
 * @param scores - Individual dimension scores (0.0-1.0 each)
 * @returns Full rubric assessment with pass/fail per dimension
 */
export function computeIdentityRubric(scores: {
  faceSimilarity: number;
  outfitConsistency: number;
  multiPoseStability: number;
  hairColorStability: number;
}): CharacterIdentityRubric {
  // Clamp all scores to [0, 1]
  const clamped = {
    faceSimilarity: Math.max(0, Math.min(1, scores.faceSimilarity)),
    outfitConsistency: Math.max(0, Math.min(1, scores.outfitConsistency)),
    multiPoseStability: Math.max(0, Math.min(1, scores.multiPoseStability)),
    hairColorStability: Math.max(0, Math.min(1, scores.hairColorStability)),
  };

  // Compute weighted composite
  const compositeScore =
    clamped.faceSimilarity * IDENTITY_RUBRIC_WEIGHTS.faceSimilarity +
    clamped.outfitConsistency * IDENTITY_RUBRIC_WEIGHTS.outfitConsistency +
    clamped.multiPoseStability * IDENTITY_RUBRIC_WEIGHTS.multiPoseStability +
    clamped.hairColorStability * IDENTITY_RUBRIC_WEIGHTS.hairColorStability;

  // Per-dimension pass/fail
  const dimensionResults = {
    faceSimilarity: {
      score: clamped.faceSimilarity,
      passes: clamped.faceSimilarity >= IDENTITY_RUBRIC_THRESHOLDS.faceSimilarity,
      threshold: IDENTITY_RUBRIC_THRESHOLDS.faceSimilarity,
    },
    outfitConsistency: {
      score: clamped.outfitConsistency,
      passes: clamped.outfitConsistency >= IDENTITY_RUBRIC_THRESHOLDS.outfitConsistency,
      threshold: IDENTITY_RUBRIC_THRESHOLDS.outfitConsistency,
    },
    multiPoseStability: {
      score: clamped.multiPoseStability,
      passes: clamped.multiPoseStability >= IDENTITY_RUBRIC_THRESHOLDS.multiPoseStability,
      threshold: IDENTITY_RUBRIC_THRESHOLDS.multiPoseStability,
    },
    hairColorStability: {
      score: clamped.hairColorStability,
      passes: clamped.hairColorStability >= IDENTITY_RUBRIC_THRESHOLDS.hairColorStability,
      threshold: IDENTITY_RUBRIC_THRESHOLDS.hairColorStability,
    },
  };

  // Overall pass: composite above minimum AND no critical dimension failures
  // Face similarity is critical — if it fails, the whole rubric fails
  const passes =
    compositeScore >= IDENTITY_RUBRIC_THRESHOLDS.compositeMinimum &&
    dimensionResults.faceSimilarity.passes;

  return {
    faceSimilarity: clamped.faceSimilarity,
    outfitConsistency: clamped.outfitConsistency,
    multiPoseStability: clamped.multiPoseStability,
    hairColorStability: clamped.hairColorStability,
    compositeScore: Math.round(compositeScore * 1000) / 1000,
    passes,
    dimensionResults,
  };
}

/**
 * Compare two face embeddings using cosine similarity.
 * Used for face similarity scoring in the identity rubric.
 *
 * @param embedding1 - First face embedding vector (512-dim from InsightFace)
 * @param embedding2 - Second face embedding vector
 * @returns Cosine similarity score (0.0-1.0)
 */
export function computeFaceSimilarity(
  embedding1: number[],
  embedding2: number[],
): number {
  if (embedding1.length !== embedding2.length || embedding1.length === 0) {
    return 0;
  }

  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;

  for (let i = 0; i < embedding1.length; i++) {
    dotProduct += embedding1[i] * embedding2[i];
    norm1 += embedding1[i] * embedding1[i];
    norm2 += embedding2[i] * embedding2[i];
  }

  const denominator = Math.sqrt(norm1) * Math.sqrt(norm2);
  if (denominator === 0) return 0;

  // Cosine similarity → [−1, 1], normalize to [0, 1]
  const cosineSim = dotProduct / denominator;
  return Math.max(0, Math.min(1, (cosineSim + 1) / 2));
}

/**
 * Batch evaluate identity rubric across multiple generated views.
 * Compares each generated view against the reference (front view).
 *
 * @param referenceEmbedding - Face embedding from the reference/front view
 * @param generatedViews - Array of generated views with their embeddings and metadata
 * @returns Per-view rubric scores and aggregate assessment
 */
export function batchEvaluateIdentity(
  referenceEmbedding: number[],
  generatedViews: Array<{
    viewAngle: string;
    faceEmbedding?: number[];
    outfitColorHistogram?: number[];
    hairColorHistogram?: number[];
    bodyProportions?: { headToBodyRatio: number; shoulderWidth: number; height: number };
  }>,
  referenceOutfitHistogram?: number[],
  referenceHairHistogram?: number[],
  referenceProportions?: { headToBodyRatio: number; shoulderWidth: number; height: number },
): {
  perView: Array<{ viewAngle: string; rubric: CharacterIdentityRubric }>;
  aggregate: CharacterIdentityRubric;
  recommendation: "accept" | "retry_specific" | "retry_all";
  retryAngles: string[];
} {
  const perView: Array<{ viewAngle: string; rubric: CharacterIdentityRubric }> = [];

  for (const view of generatedViews) {
    // Face similarity
    const faceSim = view.faceEmbedding
      ? computeFaceSimilarity(referenceEmbedding, view.faceEmbedding)
      : 0.5; // Conservative default if no embedding available

    // Outfit consistency (histogram comparison)
    const outfitConsistency = (view.outfitColorHistogram && referenceOutfitHistogram)
      ? computeHistogramSimilarity(referenceOutfitHistogram, view.outfitColorHistogram)
      : 0.7; // Conservative default

    // Multi-pose stability (proportion comparison)
    const multiPoseStability = (view.bodyProportions && referenceProportions)
      ? computeProportionStability(referenceProportions, view.bodyProportions)
      : 0.7; // Conservative default

    // Hair-color stability (histogram comparison)
    const hairColorStability = (view.hairColorHistogram && referenceHairHistogram)
      ? computeHistogramSimilarity(referenceHairHistogram, view.hairColorHistogram)
      : 0.8; // Conservative default

    const rubric = computeIdentityRubric({
      faceSimilarity: faceSim,
      outfitConsistency,
      multiPoseStability,
      hairColorStability,
    });

    perView.push({ viewAngle: view.viewAngle, rubric });
  }

  // Aggregate: average across all views
  const avgScores = {
    faceSimilarity: perView.reduce((s, v) => s + v.rubric.faceSimilarity, 0) / Math.max(perView.length, 1),
    outfitConsistency: perView.reduce((s, v) => s + v.rubric.outfitConsistency, 0) / Math.max(perView.length, 1),
    multiPoseStability: perView.reduce((s, v) => s + v.rubric.multiPoseStability, 0) / Math.max(perView.length, 1),
    hairColorStability: perView.reduce((s, v) => s + v.rubric.hairColorStability, 0) / Math.max(perView.length, 1),
  };
  const aggregate = computeIdentityRubric(avgScores);

  // Determine recommendation
  const failedViews = perView.filter(v => !v.rubric.passes);
  const retryAngles = failedViews.map(v => v.viewAngle);

  let recommendation: "accept" | "retry_specific" | "retry_all";
  if (failedViews.length === 0) {
    recommendation = "accept";
  } else if (failedViews.length <= 2 && aggregate.compositeScore >= 0.70) {
    recommendation = "retry_specific";
  } else {
    recommendation = "retry_all";
  }

  return { perView, aggregate, recommendation, retryAngles };
}

// ─── Histogram/Proportion Helpers ───────────────────────────────────────────

/**
 * Compute histogram intersection similarity (Bhattacharyya-like).
 * Used for outfit and hair color comparison.
 */
export function computeHistogramSimilarity(
  hist1: number[],
  hist2: number[],
): number {
  if (hist1.length !== hist2.length || hist1.length === 0) return 0;

  // Normalize histograms
  const sum1 = hist1.reduce((a, b) => a + b, 0) || 1;
  const sum2 = hist2.reduce((a, b) => a + b, 0) || 1;
  const norm1 = hist1.map(v => v / sum1);
  const norm2 = hist2.map(v => v / sum2);

  // Bhattacharyya coefficient
  let bc = 0;
  for (let i = 0; i < norm1.length; i++) {
    bc += Math.sqrt(norm1[i] * norm2[i]);
  }

  return Math.max(0, Math.min(1, bc));
}

/**
 * Compute body proportion stability between reference and generated view.
 * Measures how well proportions are preserved across poses.
 */
export function computeProportionStability(
  reference: { headToBodyRatio: number; shoulderWidth: number; height: number },
  generated: { headToBodyRatio: number; shoulderWidth: number; height: number },
): number {
  // Normalize each dimension's deviation
  const headRatioDev = Math.abs(reference.headToBodyRatio - generated.headToBodyRatio) / Math.max(reference.headToBodyRatio, 0.01);
  const shoulderDev = Math.abs(reference.shoulderWidth - generated.shoulderWidth) / Math.max(reference.shoulderWidth, 0.01);
  const heightDev = Math.abs(reference.height - generated.height) / Math.max(reference.height, 0.01);

  // Convert deviations to similarity (1.0 = perfect match)
  const headSim = Math.max(0, 1 - headRatioDev);
  const shoulderSim = Math.max(0, 1 - shoulderDev);
  const heightSim = Math.max(0, 1 - heightDev);

  // Weighted average (head ratio most important for anime)
  return headSim * 0.4 + shoulderSim * 0.3 + heightSim * 0.3;
}

// ─── StoryMaker Provider Adapter ────────────────────────────────────────────

/**
 * Resolve the active StoryMaker endpoint configuration.
 * Priority: STORYMAKER_ENDPOINT_URL env → dormant mode.
 */
export function resolveStoryMakerEndpoint(): {
  available: boolean;
  config: StoryMakerDeploymentConfig | null;
  endpointUrl: string | null;
  reason?: string;
} {
  const endpointUrl = process.env.STORYMAKER_ENDPOINT_URL;

  if (!endpointUrl) {
    return {
      available: false,
      config: null,
      endpointUrl: null,
      reason: "STORYMAKER_ENDPOINT_URL not configured. Deploy StoryMaker on fal.ai Custom Inference or RunPod Serverless, then set this env var to the endpoint URL.",
    };
  }

  // Detect provider from URL pattern
  const isFal = endpointUrl.includes("fal.run") || endpointUrl.includes("fal.ai");
  const isRunPod = endpointUrl.includes("runpod.ai") || endpointUrl.includes("runpod://");

  const provider = isFal ? "fal_custom" : isRunPod ? "runpod" : "fal_custom";
  const config: StoryMakerDeploymentConfig = {
    ...DEPLOYMENT_CONFIGS[provider],
    endpointUrl,
  };

  return { available: true, config, endpointUrl };
}

/**
 * StoryMaker ProviderAdapter implementation.
 *
 * Handles:
 * - Parameter validation (face image required, dimensions within SDXL limits)
 * - Cost estimation ($0.08-0.15 per generation depending on resolution)
 * - Execution via configurable endpoint (fal.ai custom or RunPod)
 * - Dormant mode when no endpoint is configured
 */
export class StoryMakerAdapter implements ProviderAdapter {
  readonly providerId = "storymaker_v1";

  private static readonly COST_PER_IMAGE_BASE = 0.10;
  private static readonly COST_HIGH_RES_MULTIPLIER = 1.5;
  private static readonly MAX_WIDTH = 1536;
  private static readonly MAX_HEIGHT = 1536;
  private static readonly MIN_WIDTH = 512;
  private static readonly MIN_HEIGHT = 512;

  validateParams(params: GenerationParams): { valid: boolean; errors?: string[] } {
    const p = params as StoryMakerParams;
    const errors: string[] = [];

    if (!p.prompt) errors.push("prompt is required");
    if (!p.faceImageUrl) errors.push("faceImageUrl is required for StoryMaker identity preservation");

    if (p.width && (p.width < StoryMakerAdapter.MIN_WIDTH || p.width > StoryMakerAdapter.MAX_WIDTH)) {
      errors.push(`width must be ${StoryMakerAdapter.MIN_WIDTH}-${StoryMakerAdapter.MAX_WIDTH} (SDXL limits)`);
    }
    if (p.height && (p.height < StoryMakerAdapter.MIN_HEIGHT || p.height > StoryMakerAdapter.MAX_HEIGHT)) {
      errors.push(`height must be ${StoryMakerAdapter.MIN_HEIGHT}-${StoryMakerAdapter.MAX_HEIGHT} (SDXL limits)`);
    }

    if (p.faceScale !== undefined && (p.faceScale < 0 || p.faceScale > 1)) {
      errors.push("faceScale must be 0.0-1.0");
    }
    if (p.outfitScale !== undefined && (p.outfitScale < 0 || p.outfitScale > 1)) {
      errors.push("outfitScale must be 0.0-1.0");
    }

    // Validate URL format for face/outfit images
    if (p.faceImageUrl && !isValidUrl(p.faceImageUrl)) {
      errors.push("faceImageUrl must be a valid HTTP(S) URL");
    }
    if (p.outfitImageUrl && !isValidUrl(p.outfitImageUrl)) {
      errors.push("outfitImageUrl must be a valid HTTP(S) URL");
    }

    return { valid: errors.length === 0, errors: errors.length > 0 ? errors : undefined };
  }

  estimateCostUsd(params: GenerationParams): number {
    const p = params as StoryMakerParams;
    const numImages = p.numImages ?? 1;
    const isHighRes = (p.width ?? 1024) > 1024 || (p.height ?? 1024) > 1024;
    const baseCost = StoryMakerAdapter.COST_PER_IMAGE_BASE;
    const multiplier = isHighRes ? StoryMakerAdapter.COST_HIGH_RES_MULTIPLIER : 1;
    return Math.round(baseCost * multiplier * numImages * 1000) / 1000;
  }

  async execute(params: GenerationParams, ctx: ExecutionContext): Promise<AdapterResult> {
    const p = params as StoryMakerParams;

    // Check endpoint availability
    const endpoint = resolveStoryMakerEndpoint();
    if (!endpoint.available || !endpoint.config || !endpoint.endpointUrl) {
      throw new ProviderError(
        "UNSUPPORTED",
        `StoryMaker endpoint not available: ${endpoint.reason}`,
        this.providerId,
        false,
        false,
      );
    }

    // Resolve API key
    const keyInfo = await getActiveApiKey(this.providerId);
    const apiKey = keyInfo?.decryptedKey || process.env[endpoint.config.apiKeyEnv] || "";
    if (!apiKey) {
      throw new ProviderError(
        "UNKNOWN",
        `No API key available for StoryMaker (checked ${endpoint.config.apiKeyEnv})`,
        this.providerId,
        false,
        false,
      );
    }

    // Build request body based on provider type
    const body = this.buildRequestBody(p, endpoint.config);
    const timeout = ctx.timeout || endpoint.config.warmTimeoutMs;

    // Execute based on provider type
    if (endpoint.config.provider === "fal_custom") {
      return this.executeFalCustom(body, apiKey, endpoint.endpointUrl, timeout);
    } else {
      return this.executeRunPod(body, apiKey, endpoint.endpointUrl, timeout);
    }
  }

  // ─── Private: Request Building ──────────────────────────────────────────

  private buildRequestBody(
    params: StoryMakerParams,
    config: StoryMakerDeploymentConfig,
  ): Record<string, unknown> {
    return {
      // StoryMaker-specific inputs
      face_image_url: params.faceImageUrl,
      outfit_image_url: params.outfitImageUrl || params.faceImageUrl,
      prompt: params.prompt,
      negative_prompt: params.negativePrompt || "low quality, blurry, deformed, ugly, bad anatomy",
      // Identity preservation scales
      ip_adapter_scale: params.faceScale ?? 0.8,
      lora_scale: params.outfitScale ?? 0.8,
      // Generation parameters
      width: params.width ?? 1024,
      height: params.height ?? 1024,
      num_inference_steps: 25,
      guidance_scale: params.guidanceScale ?? 7.5,
      seed: params.seed ?? Math.floor(Math.random() * 2147483647),
      // Anime conditioning
      anime_conditioning: params.animeConditioning ?? true,
      // Target pose
      target_pose: params.targetPose ?? "front",
      // Character tracking
      character_id: params.characterId ?? null,
    };
  }

  // ─── Private: fal.ai Custom Execution ───────────────────────────────────

  private async executeFalCustom(
    body: Record<string, unknown>,
    apiKey: string,
    endpointUrl: string,
    timeout: number,
  ): Promise<AdapterResult> {
    // Submit to fal.ai queue
    const submitResponse = await fetch(endpointUrl, {
      method: "POST",
      headers: {
        "Authorization": `Key ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });

    if (!submitResponse.ok) {
      const errText = await submitResponse.text().catch(() => "");
      this.mapAndThrowError(submitResponse.status, errText);
    }

    const submitData = await submitResponse.json() as {
      request_id?: string;
      status_url?: string;
      response_url?: string;
      // Sync response (if endpoint returns immediately)
      images?: Array<{ url: string }>;
      image_url?: string;
    };

    // Check for sync response (some fal endpoints return immediately)
    if (submitData.images?.[0]?.url || submitData.image_url) {
      const imageUrl = submitData.images?.[0]?.url || submitData.image_url!;
      return {
        storageUrl: imageUrl,
        mimeType: "image/png",
        metadata: {
          model: "storymaker_v1",
          provider: "fal_custom",
          seed: body.seed,
          wasColdStart: false,
        },
      };
    }

    // Async: poll for completion
    if (!submitData.request_id || !submitData.status_url) {
      throw new ProviderError("TRANSIENT", "No request_id or status_url in response", this.providerId);
    }

    const startTime = Date.now();
    const pollInterval = 2000;
    const maxWait = timeout;

    while (Date.now() - startTime < maxWait) {
      await new Promise(r => setTimeout(r, pollInterval));

      const statusResp = await fetch(submitData.status_url!, {
        headers: { "Authorization": `Key ${apiKey}` },
        signal: AbortSignal.timeout(10_000),
      });

      if (!statusResp.ok) continue;

      const statusData = await statusResp.json() as { status: string };

      if (statusData.status === "COMPLETED") {
        const resultResp = await fetch(submitData.response_url!, {
          headers: { "Authorization": `Key ${apiKey}` },
          signal: AbortSignal.timeout(10_000),
        });

        if (!resultResp.ok) {
          throw new ProviderError("TRANSIENT", `Failed to fetch result: ${resultResp.status}`, this.providerId);
        }

        const resultData = await resultResp.json() as {
          images?: Array<{ url: string }>;
          image_url?: string;
          seed?: number;
          face_analysis?: {
            face_count: number;
            bbox?: number[];
            embedding?: number[];
            confidence: number;
          };
          timings?: { inference?: number; cold_start?: number };
        };

        const imageUrl = resultData.images?.[0]?.url || resultData.image_url;
        if (!imageUrl) {
          throw new ProviderError("TRANSIENT", "No image URL in completed result", this.providerId);
        }

        return {
          storageUrl: imageUrl,
          mimeType: "image/png",
          metadata: {
            model: "storymaker_v1",
            provider: "fal_custom",
            seed: resultData.seed ?? body.seed,
            wasColdStart: !!resultData.timings?.cold_start,
            faceAnalysis: resultData.face_analysis,
            inferenceTimeMs: resultData.timings?.inference,
            requestId: submitData.request_id,
          },
        };
      }

      if (statusData.status === "FAILED") {
        throw new ProviderError("TRANSIENT", "StoryMaker generation failed on fal.ai", this.providerId);
      }
    }

    throw new ProviderError("TIMEOUT", `StoryMaker timed out after ${maxWait}ms`, this.providerId);
  }

  // ─── Private: RunPod Execution ──────────────────────────────────────────

  private async executeRunPod(
    body: Record<string, unknown>,
    apiKey: string,
    endpointUrl: string,
    timeout: number,
  ): Promise<AdapterResult> {
    // RunPod expects { input: { ... } } wrapper
    const payload = { input: body };

    // Extract endpoint ID from URL or use full URL
    const runUrl = endpointUrl.endsWith("/run") ? endpointUrl : `${endpointUrl}/run`;

    const submitResponse = await fetch(runUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    });

    if (!submitResponse.ok) {
      const errText = await submitResponse.text().catch(() => "");
      this.mapAndThrowError(submitResponse.status, errText);
    }

    const submitData = await submitResponse.json() as { id: string; status: string };
    const jobId = submitData.id;

    if (!jobId) {
      throw new ProviderError("TRANSIENT", "No job ID in RunPod response", this.providerId);
    }

    // Poll for completion
    const statusBaseUrl = endpointUrl.replace(/\/run$/, "");
    const startTime = Date.now();
    const pollInterval = 3000;

    while (Date.now() - startTime < timeout) {
      await new Promise(r => setTimeout(r, pollInterval));

      const statusResp = await fetch(`${statusBaseUrl}/status/${jobId}`, {
        headers: { "Authorization": `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10_000),
      });

      if (!statusResp.ok) continue;

      const statusData = await statusResp.json() as {
        status: string;
        output?: {
          image_url: string;
          seed?: number;
          face_analysis?: {
            face_count: number;
            bbox?: number[];
            embedding?: number[];
            confidence: number;
          };
          inference_time_ms?: number;
        };
        error?: string;
      };

      if (statusData.status === "COMPLETED" && statusData.output) {
        return {
          storageUrl: statusData.output.image_url,
          mimeType: "image/png",
          metadata: {
            model: "storymaker_v1",
            provider: "runpod",
            seed: statusData.output.seed ?? body.seed,
            wasColdStart: (Date.now() - startTime) > 30_000,
            faceAnalysis: statusData.output.face_analysis,
            inferenceTimeMs: statusData.output.inference_time_ms,
            jobId,
          },
        };
      }

      if (statusData.status === "FAILED") {
        throw new ProviderError(
          "TRANSIENT",
          `StoryMaker RunPod job failed: ${statusData.error || "unknown"}`,
          this.providerId,
        );
      }
    }

    throw new ProviderError("TIMEOUT", `StoryMaker RunPod timed out after ${timeout}ms`, this.providerId);
  }

  // ─── Private: Error Mapping ─────────────────────────────────────────────

  private mapAndThrowError(status: number, body: string): never {
    if (status === 429) {
      throw new ProviderError("RATE_LIMITED", `StoryMaker rate limited: ${body}`, this.providerId);
    }
    if (status === 422 || status === 400) {
      throw new ProviderError("INVALID_PARAMS", `StoryMaker invalid params: ${body}`, this.providerId, false, false);
    }
    if (status === 401 || status === 403) {
      throw new ProviderError("UNKNOWN", `StoryMaker auth failed: ${body}`, this.providerId, false, false);
    }
    throw new ProviderError("TRANSIENT", `StoryMaker ${status}: ${body}`, this.providerId);
  }
}

// ─── Utility ────────────────────────────────────────────────────────────────

function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

// ─── Self-Registration ──────────────────────────────────────────────────────

registerAdapter(new StoryMakerAdapter());
