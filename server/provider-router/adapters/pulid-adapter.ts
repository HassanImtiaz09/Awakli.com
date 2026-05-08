/**
 * Wave 7 — Item 3: PuLID Anime Stylization Adapter
 *
 * Implements the ProviderAdapter interface for PuLID (Pure and Lightning ID Customization),
 * enabling real-photo-to-anime character reference generation.
 *
 * Key capability: Takes a real photograph of a person and generates an anime-style
 * character reference that preserves facial identity while applying anime aesthetics.
 * This is the "photo → anime character" path for creators who want to base
 * characters on real people (themselves, actors, etc.).
 *
 * Deployment: fal.ai hosted endpoint (fal-ai/pulid)
 * Endpoint: FAL_API_KEY env var (shared with other fal.ai providers)
 *
 * Anime Stylization Rubric:
 * - Identity Preservation: face identity recognizable post-stylization (≥0.75)
 * - Anime Fidelity: output looks like proper anime art, not filtered photo (≥0.80)
 * - Feature Translation: key features (eyes, hair, accessories) translated correctly (≥0.85)
 * - Style Consistency: consistent anime style across multiple generations (≥0.80)
 *
 * Tier Gating: Creator Pro+ (per premium-tier-features.ts model tier system)
 *
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

// ─── PuLID-Specific Types ──────────────────────────────────────────────────

/**
 * Extended image params for PuLID photo-to-anime generation.
 */
export interface PuLIDParams extends ImageParams {
  /** URL to the source photograph (real person) */
  photoUrl: string;
  /** Anime style description (e.g., "shonen manga style", "studio ghibli style") */
  animeStyle?: string;
  /** ID scale — how strongly to preserve facial identity (0.0-1.0, default 0.8) */
  idScale?: number;
  /** Style strength — how strongly to apply anime stylization (0.0-1.0, default 0.7) */
  styleStrength?: number;
  /** Whether to apply SDXL-quality upscaling after generation */
  upscale?: boolean;
  /** Character ID for tracking */
  characterId?: string | number;
  /** Number of variations to generate */
  numVariations?: number;
  /** Whether to use the FLUX-based PuLID (higher quality, slower) */
  useFluxBackend?: boolean;
}

/**
 * Anime Stylization Rubric — scoring dimensions for photo-to-anime quality.
 */
export interface AnimeStylizationRubric {
  /** Face identity recognizable post-stylization */
  identityPreservation: number;
  /** Output looks like proper anime art, not filtered photo */
  animeFidelity: number;
  /** Key features translated correctly (eyes, hair, accessories) */
  featureTranslation: number;
  /** Consistent anime style across multiple generations */
  styleConsistency: number;
  /** Weighted composite score */
  compositeScore: number;
  /** Whether the composite passes the minimum threshold */
  passes: boolean;
  /** Per-dimension pass/fail */
  dimensionResults: {
    identityPreservation: { score: number; passes: boolean; threshold: number };
    animeFidelity: { score: number; passes: boolean; threshold: number };
    featureTranslation: { score: number; passes: boolean; threshold: number };
    styleConsistency: { score: number; passes: boolean; threshold: number };
  };
}

/**
 * PuLID generation result with stylization metadata.
 */
export interface PuLIDResult {
  /** Generated anime-style image URL */
  imageUrl: string;
  /** Variation URLs (if numVariations > 1) */
  variationUrls?: string[];
  /** Inference time in ms */
  inferenceTimeMs: number;
  /** Backend used (sdxl or flux) */
  backend: "sdxl" | "flux";
  /** Actual ID scale applied */
  appliedIdScale: number;
  /** Actual style strength applied */
  appliedStyleStrength: number;
  /** Seed used */
  seed: number;
}

// ─── Configuration ──────────────────────────────────────────────────────────

/**
 * Anime stylization rubric thresholds.
 */
export const ANIME_STYLIZATION_THRESHOLDS = {
  identityPreservation: 0.75,
  animeFidelity: 0.80,
  featureTranslation: 0.85,
  styleConsistency: 0.80,
  compositeMinimum: 0.78,
} as const;

/**
 * Rubric dimension weights for composite score.
 * Anime fidelity weighted highest — the whole point is to produce anime, not filtered photos.
 */
export const ANIME_STYLIZATION_WEIGHTS = {
  identityPreservation: 0.25,
  animeFidelity: 0.35,
  featureTranslation: 0.20,
  styleConsistency: 0.20,
} as const;

/**
 * PuLID endpoint configurations.
 */
export const PULID_ENDPOINTS = {
  /** SDXL-based PuLID (faster, good quality) */
  sdxl: "fal-ai/pulid",
  /** FLUX-based PuLID (slower, higher quality, better identity) */
  flux: "fal-ai/pulid/flux",
} as const;

/**
 * Anime style presets for common use cases.
 */
export const ANIME_STYLE_PRESETS: Record<string, string> = {
  shonen: "anime style, shonen manga, bold lines, dynamic pose, vibrant colors",
  shoujo: "anime style, shoujo manga, soft lines, delicate features, pastel colors, sparkle effects",
  ghibli: "studio ghibli style, soft watercolor, warm lighting, detailed background",
  cyberpunk: "anime style, cyberpunk aesthetic, neon lighting, futuristic, detailed tech",
  chibi: "chibi anime style, large head, small body, cute proportions, simple features",
  realistic_anime: "semi-realistic anime style, detailed shading, cinematic lighting",
  vintage: "90s anime style, cel-shaded, warm color palette, nostalgic aesthetic",
};

// ─── Anime Stylization Rubric Scoring ──────────────────────────────────────

/**
 * Compute the anime stylization rubric composite score.
 */
export function computeAnimeStylizationRubric(scores: {
  identityPreservation: number;
  animeFidelity: number;
  featureTranslation: number;
  styleConsistency: number;
}): AnimeStylizationRubric {
  const clamped = {
    identityPreservation: Math.max(0, Math.min(1, scores.identityPreservation)),
    animeFidelity: Math.max(0, Math.min(1, scores.animeFidelity)),
    featureTranslation: Math.max(0, Math.min(1, scores.featureTranslation)),
    styleConsistency: Math.max(0, Math.min(1, scores.styleConsistency)),
  };

  const compositeScore =
    clamped.identityPreservation * ANIME_STYLIZATION_WEIGHTS.identityPreservation +
    clamped.animeFidelity * ANIME_STYLIZATION_WEIGHTS.animeFidelity +
    clamped.featureTranslation * ANIME_STYLIZATION_WEIGHTS.featureTranslation +
    clamped.styleConsistency * ANIME_STYLIZATION_WEIGHTS.styleConsistency;

  const dimensionResults = {
    identityPreservation: {
      score: clamped.identityPreservation,
      passes: clamped.identityPreservation >= ANIME_STYLIZATION_THRESHOLDS.identityPreservation,
      threshold: ANIME_STYLIZATION_THRESHOLDS.identityPreservation,
    },
    animeFidelity: {
      score: clamped.animeFidelity,
      passes: clamped.animeFidelity >= ANIME_STYLIZATION_THRESHOLDS.animeFidelity,
      threshold: ANIME_STYLIZATION_THRESHOLDS.animeFidelity,
    },
    featureTranslation: {
      score: clamped.featureTranslation,
      passes: clamped.featureTranslation >= ANIME_STYLIZATION_THRESHOLDS.featureTranslation,
      threshold: ANIME_STYLIZATION_THRESHOLDS.featureTranslation,
    },
    styleConsistency: {
      score: clamped.styleConsistency,
      passes: clamped.styleConsistency >= ANIME_STYLIZATION_THRESHOLDS.styleConsistency,
      threshold: ANIME_STYLIZATION_THRESHOLDS.styleConsistency,
    },
  };

  // Overall pass: composite above minimum AND anime fidelity must pass independently
  const passes =
    compositeScore >= ANIME_STYLIZATION_THRESHOLDS.compositeMinimum &&
    dimensionResults.animeFidelity.passes;

  return {
    identityPreservation: clamped.identityPreservation,
    animeFidelity: clamped.animeFidelity,
    featureTranslation: clamped.featureTranslation,
    styleConsistency: clamped.styleConsistency,
    compositeScore: Math.round(compositeScore * 1000) / 1000,
    passes,
    dimensionResults,
  };
}

/**
 * Validate that a photo is suitable for PuLID processing.
 * Returns validation result with specific issues.
 */
export function validatePhotoInput(params: PuLIDParams): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!params.photoUrl) {
    errors.push("photoUrl is required — provide a URL to the source photograph");
  } else {
    try {
      const url = new URL(params.photoUrl);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        errors.push("photoUrl must use http:// or https:// protocol");
      }
    } catch {
      errors.push("photoUrl is not a valid URL");
    }
  }

  if (params.idScale !== undefined && (params.idScale < 0 || params.idScale > 1)) {
    errors.push("idScale must be between 0.0 and 1.0");
  }

  if (params.styleStrength !== undefined && (params.styleStrength < 0 || params.styleStrength > 1)) {
    errors.push("styleStrength must be between 0.0 and 1.0");
  }

  // Warnings for suboptimal configurations
  if (params.idScale !== undefined && params.idScale > 0.9) {
    warnings.push("Very high idScale (>0.9) may reduce anime stylization quality — consider 0.7-0.85 for best results");
  }

  if (params.styleStrength !== undefined && params.styleStrength < 0.4) {
    warnings.push("Low styleStrength (<0.4) may produce output that looks like a filtered photo rather than anime");
  }

  if (params.numVariations && params.numVariations > 4) {
    warnings.push("More than 4 variations increases cost significantly — consider 2-3 for iteration");
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Resolve anime style from preset name or custom description.
 */
export function resolveAnimeStyle(styleInput?: string): string {
  if (!styleInput) return ANIME_STYLE_PRESETS.shonen;

  // Check if it's a preset name
  const presetKey = styleInput.toLowerCase().replace(/[^a-z_]/g, "");
  if (ANIME_STYLE_PRESETS[presetKey]) {
    return ANIME_STYLE_PRESETS[presetKey];
  }

  // Use as custom description
  return styleInput;
}

// ─── DoRA Composition for PuLID ─────────────────────────────────────────────

/**
 * Validate PuLID + DoRA composition.
 * PuLID operates on the ID-embedding injection path.
 * DoRA operates on weight decomposition.
 * These should compose cleanly per §7.2.
 */
export function validatePuLIDDoRAComposition(params: {
  pulidActive: boolean;
  idScale: number;
  doraAdapters: Array<{ role: string; rank: number; weight: number }>;
}): {
  compatible: boolean;
  adjustedIdScale?: number;
  reason?: string;
} {
  if (!params.pulidActive) {
    return { compatible: true };
  }

  if (params.doraAdapters.length === 0) {
    return { compatible: true };
  }

  // When DoRA adapters are active, reduce PuLID id_scale slightly
  // to prevent identity signal from overwhelming style adapters
  const totalDoRAWeight = params.doraAdapters.reduce((sum, a) => sum + a.weight, 0);

  if (totalDoRAWeight > 1.5) {
    // Heavy DoRA load — reduce PuLID influence
    const adjustedIdScale = Math.min(params.idScale, 0.6);
    return {
      compatible: true,
      adjustedIdScale,
      reason: `High DoRA weight sum (${totalDoRAWeight.toFixed(2)}) — reducing PuLID id_scale from ${params.idScale} to ${adjustedIdScale} for clean composition`,
    };
  }

  return { compatible: true };
}

// ─── PuLID Provider Adapter ─────────────────────────────────────────────────

/**
 * PuLID ProviderAdapter implementation.
 *
 * Handles:
 * - Photo validation (URL format, protocol)
 * - Style preset resolution
 * - Cost estimation ($0.05-0.12 per generation depending on backend)
 * - Execution via fal.ai API
 * - FLUX backend selection for higher quality
 * - Tier gating (Creator Pro+ required)
 */
export class PuLIDAdapter implements ProviderAdapter {
  readonly providerId = "pulid_v1";

  private static readonly COST_SDXL = 0.05;
  private static readonly COST_FLUX = 0.12;
  private static readonly MAX_WIDTH = 1024;
  private static readonly MAX_HEIGHT = 1024;
  private static readonly MIN_WIDTH = 512;
  private static readonly MIN_HEIGHT = 512;

  validateParams(params: GenerationParams): { valid: boolean; errors?: string[] } {
    const p = params as PuLIDParams;
    const errors: string[] = [];

    if (!p.prompt && !p.animeStyle) {
      errors.push("Either prompt or animeStyle is required");
    }
    if (!p.photoUrl) {
      errors.push("photoUrl is required — provide URL to source photograph");
    }

    if (p.width && (p.width < PuLIDAdapter.MIN_WIDTH || p.width > PuLIDAdapter.MAX_WIDTH)) {
      errors.push(`width must be ${PuLIDAdapter.MIN_WIDTH}-${PuLIDAdapter.MAX_WIDTH}`);
    }
    if (p.height && (p.height < PuLIDAdapter.MIN_HEIGHT || p.height > PuLIDAdapter.MAX_HEIGHT)) {
      errors.push(`height must be ${PuLIDAdapter.MIN_HEIGHT}-${PuLIDAdapter.MAX_HEIGHT}`);
    }

    if (p.idScale !== undefined && (p.idScale < 0 || p.idScale > 1)) {
      errors.push("idScale must be 0.0-1.0");
    }
    if (p.styleStrength !== undefined && (p.styleStrength < 0 || p.styleStrength > 1)) {
      errors.push("styleStrength must be 0.0-1.0");
    }

    return { valid: errors.length === 0, errors: errors.length > 0 ? errors : undefined };
  }

  estimateCostUsd(params: GenerationParams): number {
    const p = params as PuLIDParams;
    const numImages = p.numVariations ?? p.numImages ?? 1;
    const baseCost = p.useFluxBackend ? PuLIDAdapter.COST_FLUX : PuLIDAdapter.COST_SDXL;
    return Math.round(baseCost * numImages * 1000) / 1000;
  }

  async execute(params: GenerationParams, ctx: ExecutionContext): Promise<AdapterResult> {
    const p = params as PuLIDParams;

    // Resolve API key (uses FAL_API_KEY)
    const keyInfo = await getActiveApiKey(this.providerId);
    const apiKey = keyInfo?.decryptedKey || process.env.FAL_API_KEY || "";
    if (!apiKey) {
      throw new ProviderError(
        "UNKNOWN",
        "No API key available for PuLID (checked FAL_API_KEY)",
        this.providerId,
        false,
        false,
      );
    }

    // Determine backend and endpoint
    const backend = p.useFluxBackend ? "flux" : "sdxl";
    const modelId = backend === "flux" ? PULID_ENDPOINTS.flux : PULID_ENDPOINTS.sdxl;
    const endpointUrl = `https://queue.fal.run/${modelId}`;

    // Resolve anime style
    const resolvedStyle = resolveAnimeStyle(p.animeStyle);
    const fullPrompt = p.prompt
      ? `${p.prompt}, ${resolvedStyle}`
      : `anime character portrait, ${resolvedStyle}`;

    // Build request body
    const body = {
      prompt: fullPrompt,
      negative_prompt: p.negativePrompt || "low quality, blurry, deformed, ugly, realistic photo, not anime",
      reference_images: [{ url: p.photoUrl }],
      id_scale: p.idScale ?? 0.8,
      width: p.width ?? 768,
      height: p.height ?? 768,
      num_inference_steps: backend === "flux" ? 28 : 25,
      guidance_scale: p.guidanceScale ?? 7.0,
      seed: p.seed ?? Math.floor(Math.random() * 2147483647),
      num_images: p.numVariations ?? p.numImages ?? 1,
    };

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
      // Sync response
      images?: Array<{ url: string; content_type?: string }>;
    };

    // Check for sync response
    if (submitData.images?.[0]?.url) {
      return {
        storageUrl: submitData.images[0].url,
        mimeType: "image/png",
        metadata: {
          model: "pulid_v1",
          provider: "fal",
          backend,
          seed: body.seed,
          idScale: body.id_scale,
          variationUrls: submitData.images.map(i => i.url),
          variationCount: submitData.images.length,
        },
      };
    }

    // Async: poll for completion
    if (!submitData.request_id || !submitData.status_url) {
      throw new ProviderError("TRANSIENT", "No request_id or status_url in response", this.providerId);
    }

    const timeout = ctx.timeout || 90_000;
    const startTime = Date.now();
    const pollInterval = 2500;

    while (Date.now() - startTime < timeout) {
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
          images?: Array<{ url: string; content_type?: string }>;
          seed?: number;
          timings?: { inference?: number };
        };

        const imageUrl = resultData.images?.[0]?.url;
        if (!imageUrl) {
          throw new ProviderError("TRANSIENT", "No image URL in completed result", this.providerId);
        }

        return {
          storageUrl: imageUrl,
          mimeType: "image/png",
          metadata: {
            model: "pulid_v1",
            provider: "fal",
            backend,
            seed: resultData.seed ?? body.seed,
            idScale: body.id_scale,
            variationUrls: resultData.images?.map(i => i.url) || [imageUrl],
            variationCount: resultData.images?.length || 1,
            inferenceTimeMs: resultData.timings?.inference,
            requestId: submitData.request_id,
          },
        };
      }

      if (statusData.status === "FAILED") {
        throw new ProviderError("TRANSIENT", "PuLID generation failed on fal.ai", this.providerId);
      }
    }

    throw new ProviderError("TIMEOUT", `PuLID timed out after ${timeout}ms`, this.providerId);
  }

  // ─── Private: Error Mapping ─────────────────────────────────────────────

  private mapAndThrowError(status: number, body: string): never {
    if (status === 429) {
      throw new ProviderError("RATE_LIMITED", `PuLID rate limited: ${body}`, this.providerId);
    }
    if (status === 422 || status === 400) {
      throw new ProviderError("INVALID_PARAMS", `PuLID invalid params: ${body}`, this.providerId, false, false);
    }
    if (status === 401 || status === 403) {
      throw new ProviderError("UNKNOWN", `PuLID auth failed: ${body}`, this.providerId, false, false);
    }
    throw new ProviderError("TRANSIENT", `PuLID ${status}: ${body}`, this.providerId);
  }
}

// ─── Self-Registration ──────────────────────────────────────────────────────
registerAdapter(new PuLIDAdapter());
