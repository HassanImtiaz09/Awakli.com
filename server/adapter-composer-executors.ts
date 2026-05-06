/**
 * Wave 6A — Item 1.4-1.5: Composition Executors
 *
 * FalCompositionExecutor: Primary executor via fal.ai's flux-general endpoint.
 * RunPodCompositionExecutor: Cost-optimized alternative for high-volume production.
 *
 * Both implement the AdapterComposer interface from adapter-composer.ts.
 *
 * Per Addendum §5.4:
 * - fal.ai primary (already integrated, lowest integration risk)
 * - RunPod cost-optimized (A100 $1.89-2.49/hr, 40-50% cheaper than Modal/Replicate)
 *
 * @see docs/fal-ai-dora-spike.md for multi-adapter stacking confirmation
 */

import type {
  AdapterComposer,
  CompositionInput,
  CompositionOutput,
  DoRAAdapter,
} from "./adapter-composer";
import {
  resolveBlendWeights,
  resolveIpAdapterWeight,
  injectTriggerWords,
  validateAdapterComposition,
  COMPOSITION_COST_ESTIMATES,
} from "./adapter-composer";

// ─── fal.ai Composition Executor ────────────────────────────────────────────

/**
 * fal.ai-backed composition executor using flux-general endpoint.
 * Supports unlimited LoRA/DoRA adapters + IP-Adapter in single pass.
 *
 * Per spike finding (docs/fal-ai-dora-spike.md):
 * - Endpoint: fal-ai/flux-general
 * - Multi-adapter: loras[] array with individual weight control
 * - IP-Adapter: ip_adapter.image_path[] with weight
 * - DoRA adapters load identically to LoRA at inference (.safetensors format)
 */
export class FalCompositionExecutor implements AdapterComposer {
  readonly provider = "fal";
  private apiKey: string;
  private baseUrl = "https://queue.fal.run";
  private endpoint = "fal-ai/flux-general";
  private pollIntervalMs = 2000;
  private maxPollAttempts = 60;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async compose(input: CompositionInput): Promise<CompositionOutput> {
    const startTime = Date.now();

    // Resolve blend weights
    const weights = resolveBlendWeights(input);
    const ipWeight = resolveIpAdapterWeight(input);

    // Inject trigger words into prompt
    const enhancedPrompt = injectTriggerWords(input.prompt, input.adapters, weights);

    // Build fal.ai request body
    const body: Record<string, unknown> = {
      prompt: enhancedPrompt,
      negative_prompt: input.negativePrompt || "",
      image_size: {
        width: input.width,
        height: input.height,
      },
      num_images: 1,
      seed: input.seed,
      guidance_scale: input.guidanceScale ?? 7.5,
      num_inference_steps: input.numInferenceSteps ?? 28,
      enable_safety_checker: true,
    };

    // Add source image for img2img
    if (input.sourceImageUrl) {
      body.image_url = input.sourceImageUrl;
      body.strength = input.denoisingStrength ?? 0.75;
    }

    // Build loras array — DoRA adapters use same format as LoRA at inference
    const loras: Array<{ path: string; scale: number }> = [];
    for (const adapter of input.adapters) {
      const weight = weights[adapter.id] ?? adapter.defaultWeight;
      if (weight > 0) {
        loras.push({
          path: adapter.weightsUrl,
          scale: weight,
        });
      }
    }
    if (loras.length > 0) {
      body.loras = loras;
    }

    // Add IP-Adapter conditioning if enabled
    if (input.ipAdapterConfig?.enabled && ipWeight > 0 && input.ipAdapterConfig.referenceImageUrls.length > 0) {
      body.ip_adapter = {
        image_path: input.ipAdapterConfig.referenceImageUrls,
        weight: ipWeight,
      };
    }

    // Submit to fal.ai queue
    const submitResponse = await fetch(`${this.baseUrl}/${this.endpoint}`, {
      method: "POST",
      headers: {
        "Authorization": `Key ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });

    if (!submitResponse.ok) {
      const errText = await submitResponse.text().catch(() => "");
      throw new Error(`[FalComposer] Submit failed ${submitResponse.status}: ${errText}`);
    }

    const submitData = await submitResponse.json() as {
      request_id: string;
      status_url: string;
      response_url: string;
    };

    if (!submitData.request_id) {
      throw new Error("[FalComposer] No request_id in submit response");
    }

    // Poll for completion
    let attempts = 0;
    while (attempts < this.maxPollAttempts) {
      await new Promise((r) => setTimeout(r, this.pollIntervalMs));
      attempts++;

      const statusResponse = await fetch(submitData.status_url, {
        headers: { "Authorization": `Key ${this.apiKey}` },
        signal: AbortSignal.timeout(10_000),
      });

      if (!statusResponse.ok) continue;

      const statusData = await statusResponse.json() as { status: string };

      if (statusData.status === "COMPLETED") {
        const resultResponse = await fetch(submitData.response_url, {
          headers: { "Authorization": `Key ${this.apiKey}` },
          signal: AbortSignal.timeout(10_000),
        });

        if (!resultResponse.ok) {
          throw new Error(`[FalComposer] Failed to fetch result: ${resultResponse.status}`);
        }

        const resultData = await resultResponse.json() as {
          images?: Array<{ url: string; content_type?: string }>;
          seed?: number;
          timings?: { inference?: number };
        };

        if (!resultData.images || resultData.images.length === 0) {
          throw new Error("[FalComposer] No images in result");
        }

        const inferenceTimeMs = Date.now() - startTime;
        const actualCost = this.estimateCostUsd(input);

        return {
          imageUrl: resultData.images[0].url,
          actualCostUsd: actualCost,
          provider: "fal",
          providerTaskId: submitData.request_id,
          resolvedWeights: weights,
          ipAdapterUsed: ipWeight > 0,
          metadata: {
            inferenceTimeMs,
            model: this.endpoint,
            seed: resultData.seed,
            adapterCount: loras.length,
            adapterRoles: input.adapters.filter((a) => (weights[a.id] ?? 0) > 0).map((a) => a.role),
            ipAdapterWeight: ipWeight,
          },
        };
      }

      if (statusData.status === "FAILED") {
        throw new Error("[FalComposer] Generation failed");
      }
    }

    throw new Error(`[FalComposer] Timed out after ${attempts} poll attempts`);
  }

  validateComposition(adapters: DoRAAdapter[]): { valid: boolean; errors?: string[]; warnings?: string[] } {
    const result = validateAdapterComposition(adapters);
    return {
      valid: result.valid,
      errors: result.errors.length > 0 ? result.errors : undefined,
      warnings: result.warnings.length > 0 ? result.warnings : undefined,
    };
  }

  estimateCostUsd(input: CompositionInput): number {
    const costs = COMPOSITION_COST_ESTIMATES.fal;
    let cost = costs.basePerGen;
    cost += Math.max(0, input.adapters.length - 1) * costs.perAdapterOverhead;
    if (input.ipAdapterConfig?.enabled) cost += costs.ipAdapterOverhead;
    if (input.width > 1024 || input.height > 1024) cost *= costs.highResMultiplier;
    return Math.round(cost * 1000) / 1000;
  }

  maxAdapters(): number {
    return 10; // fal.ai flux-general supports unlimited, but practical limit ~10
  }

  supportsIpAdapter(): boolean {
    return true;
  }
}

// ─── RunPod Composition Executor ────────────────────────────────────────────

/**
 * RunPod-backed composition executor for cost-optimized production.
 * Uses serverless GPU endpoints with custom inference container.
 *
 * Per Addendum §5.4:
 * - A100 $1.89-2.49/hr, H100 $2.39-2.69/hr
 * - 40-50% cheaper than Modal/Replicate for sustained workloads
 */
export class RunPodCompositionExecutor implements AdapterComposer {
  readonly provider = "runpod";
  private apiKey: string;
  private endpointId: string;
  private baseUrl = "https://api.runpod.ai/v2";
  private pollIntervalMs = 3000;
  private maxPollAttempts = 40;

  constructor(apiKey: string, endpointId: string) {
    this.apiKey = apiKey;
    this.endpointId = endpointId;
  }

  async compose(input: CompositionInput): Promise<CompositionOutput> {
    const startTime = Date.now();

    // Resolve blend weights
    const weights = resolveBlendWeights(input);
    const ipWeight = resolveIpAdapterWeight(input);

    // Inject trigger words into prompt
    const enhancedPrompt = injectTriggerWords(input.prompt, input.adapters, weights);

    // Build RunPod request payload
    const payload = {
      input: {
        prompt: enhancedPrompt,
        negative_prompt: input.negativePrompt || "",
        width: input.width,
        height: input.height,
        num_inference_steps: input.numInferenceSteps ?? 28,
        guidance_scale: input.guidanceScale ?? 7.5,
        seed: input.seed ?? Math.floor(Math.random() * 2147483647),
        // Adapters
        adapters: input.adapters
          .filter((a) => (weights[a.id] ?? 0) > 0)
          .map((a) => ({
            url: a.weightsUrl,
            weight: weights[a.id],
            type: a.type, // "dora" or "lora"
            trigger_word: a.triggerWord,
          })),
        // IP-Adapter
        ip_adapter: ipWeight > 0 && input.ipAdapterConfig?.enabled
          ? {
              images: input.ipAdapterConfig.referenceImageUrls,
              weight: ipWeight,
            }
          : undefined,
        // Source image for img2img
        source_image: input.sourceImageUrl || undefined,
        denoising_strength: input.sourceImageUrl ? (input.denoisingStrength ?? 0.75) : undefined,
      },
    };

    // Submit to RunPod serverless endpoint
    const submitResponse = await fetch(`${this.baseUrl}/${this.endpointId}/run`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    });

    if (!submitResponse.ok) {
      const errText = await submitResponse.text().catch(() => "");
      throw new Error(`[RunPodComposer] Submit failed ${submitResponse.status}: ${errText}`);
    }

    const submitData = await submitResponse.json() as { id: string; status: string };
    const jobId = submitData.id;

    if (!jobId) {
      throw new Error("[RunPodComposer] No job ID in submit response");
    }

    // Poll for completion
    let attempts = 0;
    while (attempts < this.maxPollAttempts) {
      await new Promise((r) => setTimeout(r, this.pollIntervalMs));
      attempts++;

      const statusResponse = await fetch(`${this.baseUrl}/${this.endpointId}/status/${jobId}`, {
        headers: { "Authorization": `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(10_000),
      });

      if (!statusResponse.ok) continue;

      const statusData = await statusResponse.json() as {
        status: string;
        output?: {
          image_url: string;
          seed?: number;
          inference_time_ms?: number;
        };
        error?: string;
      };

      if (statusData.status === "COMPLETED" && statusData.output) {
        const inferenceTimeMs = Date.now() - startTime;
        const actualCost = this.estimateCostUsd(input);

        return {
          imageUrl: statusData.output.image_url,
          actualCostUsd: actualCost,
          provider: "runpod",
          providerTaskId: jobId,
          resolvedWeights: weights,
          ipAdapterUsed: ipWeight > 0,
          metadata: {
            inferenceTimeMs,
            model: `runpod/${this.endpointId}`,
            seed: statusData.output.seed,
            adapterCount: input.adapters.filter((a) => (weights[a.id] ?? 0) > 0).length,
            adapterRoles: input.adapters.filter((a) => (weights[a.id] ?? 0) > 0).map((a) => a.role),
            ipAdapterWeight: ipWeight,
          },
        };
      }

      if (statusData.status === "FAILED") {
        throw new Error(`[RunPodComposer] Job failed: ${statusData.error || "unknown error"}`);
      }
    }

    throw new Error(`[RunPodComposer] Timed out after ${attempts} poll attempts`);
  }

  validateComposition(adapters: DoRAAdapter[]): { valid: boolean; errors?: string[]; warnings?: string[] } {
    const result = validateAdapterComposition(adapters);
    // RunPod has a lower practical adapter limit
    if (adapters.length > 5) {
      result.errors.push("RunPod endpoint supports maximum 5 adapters per composition");
    }
    return {
      valid: result.valid && adapters.length <= 5,
      errors: result.errors.length > 0 ? result.errors : undefined,
      warnings: result.warnings.length > 0 ? result.warnings : undefined,
    };
  }

  estimateCostUsd(input: CompositionInput): number {
    const costs = COMPOSITION_COST_ESTIMATES.runpod;
    let cost = costs.basePerGen;
    cost += Math.max(0, input.adapters.length - 1) * costs.perAdapterOverhead;
    if (input.ipAdapterConfig?.enabled) cost += costs.ipAdapterOverhead;
    if (input.width > 1024 || input.height > 1024) cost *= costs.highResMultiplier;
    return Math.round(cost * 1000) / 1000;
  }

  maxAdapters(): number {
    return 5; // RunPod custom endpoint supports up to 5
  }

  supportsIpAdapter(): boolean {
    return true;
  }
}

// ─── Executor Factory ───────────────────────────────────────────────────────

export type ComposerProvider = "fal" | "runpod";

/**
 * Create an AdapterComposer executor for the given provider.
 * Per Addendum §5.4: fal.ai primary, RunPod cost-optimized.
 */
export function createCompositionExecutor(
  provider: ComposerProvider,
  config: { apiKey: string; endpointId?: string }
): AdapterComposer {
  switch (provider) {
    case "fal":
      return new FalCompositionExecutor(config.apiKey);
    case "runpod":
      if (!config.endpointId) {
        throw new Error("RunPod executor requires endpointId");
      }
      return new RunPodCompositionExecutor(config.apiKey, config.endpointId);
    default:
      throw new Error(`Unknown composer provider: ${provider}`);
  }
}

/**
 * Select the optimal provider based on monthly spend threshold.
 * Per Addendum §5.4: RunPod when monthly spend crosses ~$500/month.
 */
export function selectOptimalProvider(
  monthlySpendUsd: number,
  preferredProvider?: ComposerProvider
): ComposerProvider {
  if (preferredProvider) return preferredProvider;
  // RunPod becomes cost-effective at higher volumes
  return monthlySpendUsd > 500 ? "runpod" : "fal";
}
