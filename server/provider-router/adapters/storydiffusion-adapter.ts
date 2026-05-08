/**
 * Wave 7 — Item 2: StoryDiffusion Intra-Episode Genga Coherence Adapter
 *
 * Implements the ProviderAdapter interface for hvision-nku/StoryDiffusion,
 * a consistent self-attention mechanism that maintains character identity
 * across multiple panels within an episode.
 *
 * Key capability: Attention-sharing pattern for intra-episode consistency.
 * Unlike StoryMaker (single-image identity preservation), StoryDiffusion
 * operates on SEQUENCES of panels, sharing attention layers to maintain
 * character appearance consistency across 4-6 panel batches.
 *
 * Deployment: Replicate API (hvision-nku/storydiffusion)
 * Endpoint: STORYDIFFUSION_ENDPOINT_URL env var (Replicate prediction URL)
 *
 * Coherence Rubric:
 * - Character Consistency: same character recognizable across all panels (≥0.80)
 * - Style Uniformity: art style/line weight consistent across batch (≥0.85)
 * - Pose Diversity: characters in different poses (not just duplicates) (≥0.60)
 * - Background Coherence: scene elements consistent where expected (≥0.70)
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

// ─── StoryDiffusion-Specific Types ─────────────────────────────────────────

/**
 * Extended image params for StoryDiffusion batch panel generation.
 * Operates on sequences of panels rather than single images.
 */
export interface StoryDiffusionParams extends ImageParams {
  /** Array of panel prompts for the batch (4-6 panels per attention window) */
  panelPrompts: string[];
  /** Character description for consistent identity across panels */
  characterDescription: string;
  /** Style description applied uniformly across all panels */
  styleDescription?: string;
  /** Number of panels in this batch (auto-derived from panelPrompts.length) */
  batchSize?: number;
  /** Whether to use photomaker-style identity preservation */
  usePhotomaker?: boolean;
  /** Reference image URL for character identity anchor (optional) */
  referenceImageUrl?: string;
  /** Episode ID for tracking */
  episodeId?: number;
  /** Scene numbers for this batch */
  sceneNumbers?: number[];
  /** Attention-sharing strength (0.0–1.0). Controls how strongly character identity
   *  is shared across panels in the batch. Default: 0.8. Lower values allow more
   *  per-panel variation; higher values enforce stricter consistency. */
  attentionStrength?: number;
}

/**
 * Coherence Rubric — scoring dimensions for intra-episode consistency.
 */
export interface CoherenceRubric {
  /** Character recognizability across all panels in batch */
  characterConsistency: number;
  /** Art style/line weight uniformity across batch */
  styleUniformity: number;
  /** Pose diversity (not just duplicates) */
  poseDiversity: number;
  /** Background/scene element coherence */
  backgroundCoherence: number;
  /** Weighted composite score */
  compositeScore: number;
  /** Whether the composite passes the minimum threshold */
  passes: boolean;
  /** Per-dimension pass/fail */
  dimensionResults: {
    characterConsistency: { score: number; passes: boolean; threshold: number };
    styleUniformity: { score: number; passes: boolean; threshold: number };
    poseDiversity: { score: number; passes: boolean; threshold: number };
    backgroundCoherence: { score: number; passes: boolean; threshold: number };
  };
}

/**
 * StoryDiffusion batch generation result.
 */
export interface StoryDiffusionBatchResult {
  /** Generated panel image URLs (one per panel in batch) */
  panelUrls: string[];
  /** Number of panels successfully generated */
  panelCount: number;
  /** Total inference time for the batch */
  totalInferenceTimeMs: number;
  /** Per-panel inference time average */
  avgInferenceTimePerPanelMs: number;
  /** Whether attention-sharing was active */
  attentionSharingActive: boolean;
  /** Seed used */
  seed: number;
}

// ─── Configuration ──────────────────────────────────────────────────────────

/**
 * Coherence rubric thresholds.
 */
export const COHERENCE_RUBRIC_THRESHOLDS = {
  characterConsistency: 0.80,
  styleUniformity: 0.85,
  poseDiversity: 0.60,
  backgroundCoherence: 0.70,
  compositeMinimum: 0.75,
} as const;

/**
 * Coherence rubric weights for composite score.
 * Character consistency is weighted highest as it's the primary value prop.
 */
export const COHERENCE_RUBRIC_WEIGHTS = {
  characterConsistency: 0.40,
  styleUniformity: 0.25,
  poseDiversity: 0.15,
  backgroundCoherence: 0.20,
} as const;

/**
 * StoryDiffusion deployment configuration.
 */
export interface StoryDiffusionConfig {
  /** Endpoint URL (Replicate prediction API) */
  endpointUrl: string;
  /** Maximum panels per batch (attention window limit) */
  maxBatchSize: number;
  /** Minimum panels per batch (below this, per-panel generation is cheaper) */
  minBatchSize: number;
  /** Timeout per panel in ms */
  timeoutPerPanelMs: number;
  /** Maximum total batch timeout */
  maxBatchTimeoutMs: number;
}

export const DEFAULT_CONFIG: StoryDiffusionConfig = {
  endpointUrl: "", // Set via STORYDIFFUSION_ENDPOINT_URL
  maxBatchSize: 6,
  minBatchSize: 2,
  timeoutPerPanelMs: 30_000,
  maxBatchTimeoutMs: 180_000,
};

// ─── Coherence Rubric Scoring ──────────────────────────────────────────────

/**
 * Compute the coherence rubric composite score.
 * Used to evaluate whether a StoryDiffusion batch maintains
 * sufficient intra-episode consistency for production use.
 */
export function computeCoherenceRubric(scores: {
  characterConsistency: number;
  styleUniformity: number;
  poseDiversity: number;
  backgroundCoherence: number;
}): CoherenceRubric {
  const clamped = {
    characterConsistency: Math.max(0, Math.min(1, scores.characterConsistency)),
    styleUniformity: Math.max(0, Math.min(1, scores.styleUniformity)),
    poseDiversity: Math.max(0, Math.min(1, scores.poseDiversity)),
    backgroundCoherence: Math.max(0, Math.min(1, scores.backgroundCoherence)),
  };

  const compositeScore =
    clamped.characterConsistency * COHERENCE_RUBRIC_WEIGHTS.characterConsistency +
    clamped.styleUniformity * COHERENCE_RUBRIC_WEIGHTS.styleUniformity +
    clamped.poseDiversity * COHERENCE_RUBRIC_WEIGHTS.poseDiversity +
    clamped.backgroundCoherence * COHERENCE_RUBRIC_WEIGHTS.backgroundCoherence;

  const dimensionResults = {
    characterConsistency: {
      score: clamped.characterConsistency,
      passes: clamped.characterConsistency >= COHERENCE_RUBRIC_THRESHOLDS.characterConsistency,
      threshold: COHERENCE_RUBRIC_THRESHOLDS.characterConsistency,
    },
    styleUniformity: {
      score: clamped.styleUniformity,
      passes: clamped.styleUniformity >= COHERENCE_RUBRIC_THRESHOLDS.styleUniformity,
      threshold: COHERENCE_RUBRIC_THRESHOLDS.styleUniformity,
    },
    poseDiversity: {
      score: clamped.poseDiversity,
      passes: clamped.poseDiversity >= COHERENCE_RUBRIC_THRESHOLDS.poseDiversity,
      threshold: COHERENCE_RUBRIC_THRESHOLDS.poseDiversity,
    },
    backgroundCoherence: {
      score: clamped.backgroundCoherence,
      passes: clamped.backgroundCoherence >= COHERENCE_RUBRIC_THRESHOLDS.backgroundCoherence,
      threshold: COHERENCE_RUBRIC_THRESHOLDS.backgroundCoherence,
    },
  };

  // Overall pass: composite above minimum AND character consistency must pass independently
  const passes =
    compositeScore >= COHERENCE_RUBRIC_THRESHOLDS.compositeMinimum &&
    dimensionResults.characterConsistency.passes;

  return {
    characterConsistency: clamped.characterConsistency,
    styleUniformity: clamped.styleUniformity,
    poseDiversity: clamped.poseDiversity,
    backgroundCoherence: clamped.backgroundCoherence,
    compositeScore: Math.round(compositeScore * 1000) / 1000,
    passes,
    dimensionResults,
  };
}

/**
 * Batch panels into attention-window groups.
 * StoryDiffusion attention-sharing works best with 4-6 panels.
 * Panels beyond the window are processed in separate batches.
 */
export function batchPanelsForAttention(
  panels: string[],
  maxBatchSize: number = DEFAULT_CONFIG.maxBatchSize,
): string[][] {
  const batches: string[][] = [];
  for (let i = 0; i < panels.length; i += maxBatchSize) {
    batches.push(panels.slice(i, i + maxBatchSize));
  }
  return batches;
}

/**
 * Validate that a panel sequence is suitable for StoryDiffusion.
 * Returns validation result with specific issues if invalid.
 */
export function validatePanelSequence(params: StoryDiffusionParams): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!params.panelPrompts || params.panelPrompts.length === 0) {
    errors.push("panelPrompts array is required and must contain at least 1 panel");
  }

  if (params.panelPrompts && params.panelPrompts.length < DEFAULT_CONFIG.minBatchSize) {
    warnings.push(`Batch size ${params.panelPrompts.length} is below minimum ${DEFAULT_CONFIG.minBatchSize}. Per-panel generation may be more cost-effective.`);
  }

  if (params.panelPrompts && params.panelPrompts.length > DEFAULT_CONFIG.maxBatchSize * 3) {
    warnings.push(`Large batch (${params.panelPrompts.length} panels) will be split into ${Math.ceil(params.panelPrompts.length / DEFAULT_CONFIG.maxBatchSize)} attention windows.`);
  }

  if (!params.characterDescription) {
    errors.push("characterDescription is required for consistent identity across panels");
  }

  // Check for empty prompts
  if (params.panelPrompts) {
    const emptyPanels = params.panelPrompts.filter(p => !p.trim());
    if (emptyPanels.length > 0) {
      errors.push(`${emptyPanels.length} panel prompt(s) are empty`);
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ─── Endpoint Resolution ────────────────────────────────────────────────────

/**
 * Resolve the active StoryDiffusion endpoint configuration.
 */
export function resolveStoryDiffusionEndpoint(): {
  available: boolean;
  config: StoryDiffusionConfig | null;
  endpointUrl: string | null;
  reason?: string;
} {
  const endpointUrl = process.env.STORYDIFFUSION_ENDPOINT_URL;

  if (!endpointUrl) {
    return {
      available: false,
      config: null,
      endpointUrl: null,
      reason: "STORYDIFFUSION_ENDPOINT_URL not configured. Set to Replicate prediction endpoint (e.g., https://api.replicate.com/v1/predictions).",
    };
  }

  const config: StoryDiffusionConfig = {
    ...DEFAULT_CONFIG,
    endpointUrl,
  };

  return { available: true, config, endpointUrl };
}

// ─── DoRA Composition Validation ────────────────────────────────────────────

/**
 * Validate that StoryDiffusion's attention-sharing pattern doesn't conflict
 * with DoRA weight injection (§7.2 requirement).
 *
 * StoryDiffusion modifies self-attention layers. DoRA modifies weight matrices.
 * These operate on different dimensions and should compose cleanly,
 * but we validate the interaction pattern here.
 */
export function validateDoRAComposition(params: {
  storyDiffusionActive: boolean;
  doraAdapters: Array<{ role: string; rank: number }>;
}): {
  compatible: boolean;
  reason?: string;
  recommendation?: string;
} {
  if (!params.storyDiffusionActive) {
    return { compatible: true };
  }

  if (params.doraAdapters.length === 0) {
    return { compatible: true, recommendation: "StoryDiffusion active without DoRA — full attention-sharing mode" };
  }

  // StoryDiffusion attention-sharing + DoRA weight injection:
  // - Attention layers (Q, K, V projections) are modified by StoryDiffusion
  // - DoRA modifies the same layers via low-rank decomposition
  // - Per §7.2: "StoryDiffusion composes more cleanly with DoRA"
  // - High-rank DoRA (rank > 32) may interfere with attention patterns
  const highRankAdapters = params.doraAdapters.filter(a => a.rank > 32);

  if (highRankAdapters.length > 0) {
    return {
      compatible: true,
      reason: `High-rank DoRA adapters (rank > 32) detected: ${highRankAdapters.map(a => a.role).join(", ")}. May slightly reduce attention-sharing effectiveness.`,
      recommendation: "Consider reducing DoRA rank to ≤32 for optimal StoryDiffusion composition",
    };
  }

  return {
    compatible: true,
    recommendation: `StoryDiffusion + ${params.doraAdapters.length} DoRA adapter(s) — clean composition expected (all rank ≤32)`,
  };
}

// ─── StoryDiffusion Provider Adapter ────────────────────────────────────────

/**
 * StoryDiffusion ProviderAdapter implementation.
 *
 * Handles:
 * - Panel sequence validation (min 2, max 6 per attention window)
 * - Batch splitting for large sequences
 * - Cost estimation ($0.08 per panel in batch, $0.12 for single)
 * - Execution via Replicate API
 * - Fallback to per-panel generation when batch fails
 */
export class StoryDiffusionAdapter implements ProviderAdapter {
  readonly providerId = "storydiffusion_v1";

  private static readonly COST_PER_PANEL_BATCH = 0.08;
  private static readonly COST_PER_PANEL_SINGLE = 0.12;
  private static readonly MAX_WIDTH = 1024;
  private static readonly MAX_HEIGHT = 1024;
  private static readonly MIN_WIDTH = 512;
  private static readonly MIN_HEIGHT = 512;

  validateParams(params: GenerationParams): { valid: boolean; errors?: string[] } {
    const p = params as StoryDiffusionParams;
    const errors: string[] = [];

    if (!p.prompt && (!p.panelPrompts || p.panelPrompts.length === 0)) {
      errors.push("Either prompt or panelPrompts is required");
    }
    if (!p.characterDescription) {
      errors.push("characterDescription is required for identity consistency");
    }

    if (p.width && (p.width < StoryDiffusionAdapter.MIN_WIDTH || p.width > StoryDiffusionAdapter.MAX_WIDTH)) {
      errors.push(`width must be ${StoryDiffusionAdapter.MIN_WIDTH}-${StoryDiffusionAdapter.MAX_WIDTH}`);
    }
    if (p.height && (p.height < StoryDiffusionAdapter.MIN_HEIGHT || p.height > StoryDiffusionAdapter.MAX_HEIGHT)) {
      errors.push(`height must be ${StoryDiffusionAdapter.MIN_HEIGHT}-${StoryDiffusionAdapter.MAX_HEIGHT}`);
    }

    if (p.panelPrompts && p.panelPrompts.length > DEFAULT_CONFIG.maxBatchSize * 5) {
      errors.push(`Maximum ${DEFAULT_CONFIG.maxBatchSize * 5} panels per request (${Math.ceil(p.panelPrompts.length / DEFAULT_CONFIG.maxBatchSize)} batches)`);
    }

    return { valid: errors.length === 0, errors: errors.length > 0 ? errors : undefined };
  }

  estimateCostUsd(params: GenerationParams): number {
    const p = params as StoryDiffusionParams;
    const panelCount = p.panelPrompts?.length || 1;
    const isBatch = panelCount >= DEFAULT_CONFIG.minBatchSize;
    const costPerPanel = isBatch
      ? StoryDiffusionAdapter.COST_PER_PANEL_BATCH
      : StoryDiffusionAdapter.COST_PER_PANEL_SINGLE;
    return Math.round(costPerPanel * panelCount * 1000) / 1000;
  }

  async execute(params: GenerationParams, ctx: ExecutionContext): Promise<AdapterResult> {
    const p = params as StoryDiffusionParams;

    // Check endpoint availability
    const endpoint = resolveStoryDiffusionEndpoint();
    if (!endpoint.available || !endpoint.config || !endpoint.endpointUrl) {
      throw new ProviderError(
        "UNSUPPORTED",
        `StoryDiffusion endpoint not available: ${endpoint.reason}`,
        this.providerId,
        false,
        false,
      );
    }

    // Resolve API key (uses REPLICATE_API_TOKEN)
    const keyInfo = await getActiveApiKey(this.providerId);
    const apiKey = keyInfo?.decryptedKey || process.env.REPLICATE_API_TOKEN || "";
    if (!apiKey) {
      throw new ProviderError(
        "UNKNOWN",
        "No API key available for StoryDiffusion (checked REPLICATE_API_TOKEN)",
        this.providerId,
        false,
        false,
      );
    }

    // Build panel prompts
    const panelPrompts = p.panelPrompts || [p.prompt];
    const batches = batchPanelsForAttention(panelPrompts, endpoint.config.maxBatchSize);

    // Execute batches sequentially (attention windows are independent)
    const allPanelUrls: string[] = [];
    let totalInferenceMs = 0;

    for (const batch of batches) {
      try {
        const batchResult = await this.executeBatch(
          batch,
          p,
          apiKey,
          endpoint.endpointUrl,
          endpoint.config,
        );
        allPanelUrls.push(...batchResult.panelUrls);
        totalInferenceMs += batchResult.inferenceTimeMs;
      } catch (err: any) {
        // Fallback: generate panels individually
        for (const panelPrompt of batch) {
          try {
            const singleResult = await this.executeSinglePanel(
              panelPrompt,
              p,
              apiKey,
              endpoint.endpointUrl,
            );
            allPanelUrls.push(singleResult.url);
            totalInferenceMs += singleResult.inferenceTimeMs;
          } catch (singleErr: any) {
            // Skip failed panel, continue with rest
            allPanelUrls.push("");
          }
        }
      }
    }

    // Return first panel URL as primary result (full batch in metadata)
    const primaryUrl = allPanelUrls.find(u => u) || "";
    if (!primaryUrl) {
      throw new ProviderError("TRANSIENT", "All panels failed to generate", this.providerId);
    }

    return {
      storageUrl: primaryUrl,
      mimeType: "image/png",
      metadata: {
        model: "storydiffusion_v1",
        provider: "replicate",
        panelUrls: allPanelUrls,
        panelCount: allPanelUrls.filter(u => u).length,
        totalPanels: panelPrompts.length,
        totalInferenceTimeMs: totalInferenceMs,
        avgInferenceTimePerPanelMs: Math.round(totalInferenceMs / Math.max(allPanelUrls.length, 1)),
        attentionSharingActive: batches.some(b => b.length >= DEFAULT_CONFIG.minBatchSize),
        batchCount: batches.length,
      },
    };
  }

  // ─── Private: Batch Execution ──────────────────────────────────────────

  private async executeBatch(
    panelPrompts: string[],
    params: StoryDiffusionParams,
    apiKey: string,
    endpointUrl: string,
    config: StoryDiffusionConfig,
  ): Promise<{ panelUrls: string[]; inferenceTimeMs: number }> {
    const body = {
      version: "hvision-nku/storydiffusion",
      input: {
        // StoryDiffusion-specific inputs
        prompt_array: panelPrompts.map(p =>
          `${params.characterDescription}. ${p}. ${params.styleDescription || "anime style, consistent art"}`
        ),
        num_steps: 25,
        style_name: params.styleDescription || "anime_style",
        // Identity preservation
        character_description: params.characterDescription,
        // Generation parameters
        width: params.width ?? 768,
        height: params.height ?? 768,
        guidance_scale: params.guidanceScale ?? 7.5,
        seed: params.seed ?? Math.floor(Math.random() * 2147483647),
        // Attention-sharing configuration (tunable via attentionStrength param)
        sa_mid_strength: params.attentionStrength ?? 0.8,
        sa_out_strength: params.attentionStrength ?? 0.8,
        // PhotoMaker mode (optional)
        use_photomaker: params.usePhotomaker ?? false,
        reference_image: params.referenceImageUrl || undefined,
      },
    };

    const timeout = Math.min(
      config.timeoutPerPanelMs * panelPrompts.length,
      config.maxBatchTimeoutMs,
    );

    // Submit to Replicate
    const submitResponse = await fetch(endpointUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Prefer": "wait",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    });

    if (!submitResponse.ok) {
      const errText = await submitResponse.text().catch(() => "");
      this.mapAndThrowError(submitResponse.status, errText);
    }

    const result = await submitResponse.json() as {
      id: string;
      status: string;
      output?: string[];
      metrics?: { predict_time?: number };
      urls?: { get: string };
    };

    // If synchronous response
    if (result.output && result.output.length > 0) {
      return {
        panelUrls: result.output,
        inferenceTimeMs: (result.metrics?.predict_time ?? 0) * 1000,
      };
    }

    // Async: poll for completion
    if (!result.urls?.get) {
      throw new ProviderError("TRANSIENT", "No prediction URL in response", this.providerId);
    }

    const startTime = Date.now();
    const pollInterval = 3000;

    while (Date.now() - startTime < timeout) {
      await new Promise(r => setTimeout(r, pollInterval));

      const statusResp = await fetch(result.urls!.get, {
        headers: { "Authorization": `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10_000),
      });

      if (!statusResp.ok) continue;

      const statusData = await statusResp.json() as {
        status: string;
        output?: string[];
        metrics?: { predict_time?: number };
        error?: string;
      };

      if (statusData.status === "succeeded" && statusData.output) {
        return {
          panelUrls: statusData.output,
          inferenceTimeMs: (statusData.metrics?.predict_time ?? 0) * 1000,
        };
      }

      if (statusData.status === "failed") {
        throw new ProviderError(
          "TRANSIENT",
          `StoryDiffusion batch failed: ${statusData.error || "unknown"}`,
          this.providerId,
        );
      }
    }

    throw new ProviderError("TIMEOUT", `StoryDiffusion batch timed out after ${timeout}ms`, this.providerId);
  }

  // ─── Private: Single Panel Fallback ────────────────────────────────────

  private async executeSinglePanel(
    panelPrompt: string,
    params: StoryDiffusionParams,
    apiKey: string,
    endpointUrl: string,
  ): Promise<{ url: string; inferenceTimeMs: number }> {
    const body = {
      version: "hvision-nku/storydiffusion",
      input: {
        prompt_array: [`${params.characterDescription}. ${panelPrompt}. ${params.styleDescription || "anime style"}`],
        num_steps: 25,
        style_name: params.styleDescription || "anime_style",
        character_description: params.characterDescription,
        width: params.width ?? 768,
        height: params.height ?? 768,
        guidance_scale: params.guidanceScale ?? 7.5,
        seed: params.seed ?? Math.floor(Math.random() * 2147483647),
        sa_mid_strength: 0.0,  // No attention sharing for single panel
        sa_out_strength: 0.0,
      },
    };

    const submitResponse = await fetch(endpointUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Prefer": "wait",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });

    if (!submitResponse.ok) {
      const errText = await submitResponse.text().catch(() => "");
      this.mapAndThrowError(submitResponse.status, errText);
    }

    const result = await submitResponse.json() as {
      output?: string[];
      metrics?: { predict_time?: number };
      urls?: { get: string };
      status?: string;
    };

    if (result.output?.[0]) {
      return {
        url: result.output[0],
        inferenceTimeMs: (result.metrics?.predict_time ?? 0) * 1000,
      };
    }

    // Poll if async
    if (result.urls?.get) {
      const startTime = Date.now();
      while (Date.now() - startTime < 60_000) {
        await new Promise(r => setTimeout(r, 3000));
        const resp = await fetch(result.urls!.get, {
          headers: { "Authorization": `Bearer ${apiKey}` },
        });
        if (!resp.ok) continue;
        const data = await resp.json() as { status: string; output?: string[]; metrics?: { predict_time?: number } };
        if (data.status === "succeeded" && data.output?.[0]) {
          return { url: data.output[0], inferenceTimeMs: (data.metrics?.predict_time ?? 0) * 1000 };
        }
        if (data.status === "failed") break;
      }
    }

    throw new ProviderError("TRANSIENT", "Single panel generation failed", this.providerId);
  }

  // ─── Private: Error Mapping ─────────────────────────────────────────────

  private mapAndThrowError(status: number, body: string): never {
    if (status === 429) {
      throw new ProviderError("RATE_LIMITED", `StoryDiffusion rate limited: ${body}`, this.providerId);
    }
    if (status === 422 || status === 400) {
      throw new ProviderError("INVALID_PARAMS", `StoryDiffusion invalid params: ${body}`, this.providerId, false, false);
    }
    if (status === 401 || status === 403) {
      throw new ProviderError("UNKNOWN", `StoryDiffusion auth failed: ${body}`, this.providerId, false, false);
    }
    throw new ProviderError("TRANSIENT", `StoryDiffusion ${status}: ${body}`, this.providerId);
  }
}

// ─── Self-Registration ──────────────────────────────────────────────────────
registerAdapter(new StoryDiffusionAdapter());
