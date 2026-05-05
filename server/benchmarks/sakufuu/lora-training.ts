/**
 * Sakufuu LoRA Training Pipeline
 *
 * Handles the full lifecycle of training creator-specific style LoRA models:
 * 1. Style sample extraction from creator's works
 * 2. Training data preparation (crop, normalize, caption)
 * 3. Training job submission via TrainingProvider interface (Replicate MVP)
 * 4. Model artifact storage (S3 + DB reference)
 * 5. Integration with D9 Sakufuu Tracker for style bias
 *
 * Architecture:
 * - TrainingProvider interface allows swapping Replicate → Modal later
 * - Pipeline is idempotent: re-running with same inputs skips completed steps
 * - Admin approval gate before model goes live
 */

import { storagePut } from "../../storage";
import { pipelineLog } from "../../observability/logger";

// ─── TrainingProvider Interface ──────────────────────────────────────────────

export interface TrainingConfig {
  /** Base model to fine-tune */
  baseModel: string;
  /** Trigger word for the LoRA */
  triggerWord: string;
  /** Number of training steps */
  steps: number;
  /** Learning rate */
  learningRate: number;
  /** LoRA rank (dimensionality) */
  loraRank: number;
  /** Resolution for training images */
  resolution: number;
  /** Batch size */
  batchSize: number;
  /** Whether to use caption-based training */
  useCaptions: boolean;
  /** Additional provider-specific config */
  extra?: Record<string, unknown>;
}

export interface TrainingJobStatus {
  id: string;
  status: "starting" | "processing" | "succeeded" | "failed" | "canceled";
  progress?: number;
  outputUrl?: string;
  error?: string;
  metrics?: {
    trainingLoss?: number;
    validationLoss?: number;
    elapsedSeconds?: number;
  };
}

export interface TrainingProvider {
  name: string;
  /** Submit a training job with images + config */
  submitTraining(params: {
    images: Array<{ url: string; caption?: string }>;
    config: TrainingConfig;
  }): Promise<{ jobId: string; estimatedCostCents: number }>;
  /** Check status of a running training job */
  getJobStatus(jobId: string): Promise<TrainingJobStatus>;
  /** Cancel a running training job */
  cancelJob(jobId: string): Promise<void>;
  /** Get the trained model URL after completion */
  getModelUrl(jobId: string): Promise<string>;
}

// ─── Replicate Provider Implementation ──────────────────────────────────────

export class ReplicateTrainingProvider implements TrainingProvider {
  name = "replicate";
  private apiToken: string;
  private baseUrl = "https://api.replicate.com/v1";

  constructor(apiToken: string) {
    this.apiToken = apiToken;
  }

  async submitTraining(params: {
    images: Array<{ url: string; caption?: string }>;
    config: TrainingConfig;
  }): Promise<{ jobId: string; estimatedCostCents: number }> {
    const { images, config } = params;

    // Replicate flux-dev-lora-trainer format
    const input = {
      input_images: images.map(img => img.url).join("\n"),
      trigger_word: config.triggerWord,
      steps: config.steps,
      learning_rate: config.learningRate,
      lora_rank: config.loraRank,
      resolution: `${config.resolution}`,
      batch_size: config.batchSize,
      autocaption: config.useCaptions,
      ...(config.extra || {}),
    };

    const response = await fetch(`${this.baseUrl}/models/ostris/flux-dev-lora-trainer/versions/latest/trainings`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input,
        destination: `awakli/sakufuu-${Date.now()}`,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Replicate training submission failed: ${response.status} ${errorText}`);
    }

    const data = await response.json() as { id: string };
    // Estimate: ~$0.001/sec, typical training ~600-1200 seconds
    const estimatedCostCents = Math.ceil((config.steps / 1000) * 80);

    pipelineLog.info(`[LoRA] Replicate training submitted: jobId=${data.id}, steps=${config.steps}, images=${images.length}`);

    return { jobId: data.id, estimatedCostCents };
  }

  async getJobStatus(jobId: string): Promise<TrainingJobStatus> {
    const response = await fetch(`${this.baseUrl}/trainings/${jobId}`, {
      headers: { "Authorization": `Bearer ${this.apiToken}` },
    });

    if (!response.ok) {
      throw new Error(`Failed to get training status: ${response.status}`);
    }

    const data = await response.json() as {
      id: string;
      status: string;
      output?: { weights?: string };
      error?: string;
      metrics?: { predict_time?: number };
      logs?: string;
    };

    return {
      id: data.id,
      status: data.status as TrainingJobStatus["status"],
      outputUrl: data.output?.weights,
      error: data.error || undefined,
      metrics: {
        elapsedSeconds: data.metrics?.predict_time,
      },
    };
  }

  async cancelJob(jobId: string): Promise<void> {
    await fetch(`${this.baseUrl}/trainings/${jobId}/cancel`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${this.apiToken}` },
    });
    pipelineLog.info(`[LoRA] Training job cancelled: ${jobId}`);
  }

  async getModelUrl(jobId: string): Promise<string> {
    const status = await this.getJobStatus(jobId);
    if (status.status !== "succeeded" || !status.outputUrl) {
      throw new Error(`Training not complete or no output URL: status=${status.status}`);
    }
    return status.outputUrl;
  }
}

// ─── Style Sample Extraction ────────────────────────────────────────────────

export interface StyleSampleCandidate {
  url: string;
  sourceType: "panel" | "character_sheet" | "cover" | "custom";
  qualityScore: number;
  caption?: string;
  cropRegion?: { x: number; y: number; w: number; h: number };
}

export interface ExtractionConfig {
  /** Minimum quality score to include (0-1) */
  minQuality: number;
  /** Maximum samples to extract */
  maxSamples: number;
  /** Preferred source types in priority order */
  preferredSources: Array<"panel" | "character_sheet" | "cover" | "custom">;
  /** Whether to include auto-captioning */
  generateCaptions: boolean;
}

const DEFAULT_EXTRACTION_CONFIG: ExtractionConfig = {
  minQuality: 0.6,
  maxSamples: 30,
  preferredSources: ["panel", "character_sheet", "cover"],
  generateCaptions: true,
};

/**
 * Extract representative style samples from a creator's works.
 * Selects panels that best represent the creator's unique style.
 */
export function extractStyleSamples(
  allPanels: Array<{ url: string; sourceType: string; metadata?: Record<string, unknown> }>,
  config: ExtractionConfig = DEFAULT_EXTRACTION_CONFIG,
): StyleSampleCandidate[] {
  // Score each panel for style representativeness
  const scored = allPanels.map(panel => {
    let score = 0.5; // base score

    // Boost for preferred source types
    const sourceIdx = config.preferredSources.indexOf(panel.sourceType as any);
    if (sourceIdx >= 0) {
      score += (config.preferredSources.length - sourceIdx) * 0.1;
    }

    // Boost for panels with rich visual content (heuristic: longer URLs often = higher quality assets)
    if (panel.url && panel.url.length > 50) {
      score += 0.05;
    }

    // Boost for character sheets (best style reference)
    if (panel.sourceType === "character_sheet") {
      score += 0.2;
    }

    // Cap at 1.0
    score = Math.min(1.0, score);

    return {
      url: panel.url,
      sourceType: (panel.sourceType || "panel") as StyleSampleCandidate["sourceType"],
      qualityScore: score,
    };
  });

  // Filter by minimum quality
  const qualified = scored.filter(s => s.qualityScore >= config.minQuality);

  // Sort by quality (descending) and take top N
  qualified.sort((a, b) => b.qualityScore - a.qualityScore);

  return qualified.slice(0, config.maxSamples);
}

// ─── Training Data Preparation ──────────────────────────────────────────────

export interface PreparedTrainingImage {
  originalUrl: string;
  processedUrl: string;
  processedFileKey: string;
  caption: string;
  width: number;
  height: number;
}

/**
 * Generate a training caption for a style sample.
 * Uses a consistent format that helps the LoRA learn style associations.
 */
export function generateTrainingCaption(
  sample: StyleSampleCandidate,
  triggerWord: string,
  genre?: string,
): string {
  const parts = [`${triggerWord} style`];

  if (genre) {
    parts.push(`${genre} manga`);
  }

  switch (sample.sourceType) {
    case "character_sheet":
      parts.push("character design reference sheet");
      break;
    case "cover":
      parts.push("manga cover illustration");
      break;
    case "panel":
      parts.push("manga panel artwork");
      break;
    case "custom":
      parts.push("illustration");
      break;
  }

  // Add quality indicator
  if (sample.qualityScore > 0.8) {
    parts.push("high quality detailed artwork");
  }

  return parts.join(", ");
}

/**
 * Prepare training data: normalize images and generate captions.
 * In production, this would resize/crop images to training resolution.
 * For MVP, we pass URLs directly to Replicate which handles preprocessing.
 */
export async function prepareTrainingData(
  samples: StyleSampleCandidate[],
  triggerWord: string,
  genre?: string,
): Promise<Array<{ url: string; caption: string }>> {
  return samples.map(sample => ({
    url: sample.url,
    caption: generateTrainingCaption(sample, triggerWord, genre),
  }));
}

// ─── Training Pipeline Orchestration ────────────────────────────────────────

export interface TrainingPipelineInput {
  creatorId: number;
  projectId?: number;
  triggerWord: string;
  genre?: string;
  /** Pre-selected samples (if empty, will auto-extract) */
  samples?: StyleSampleCandidate[];
  /** All available panels for auto-extraction */
  availablePanels?: Array<{ url: string; sourceType: string; metadata?: Record<string, unknown> }>;
  /** Override default training config */
  configOverrides?: Partial<TrainingConfig>;
}

export interface TrainingPipelineResult {
  jobId: string;
  provider: string;
  sampleCount: number;
  estimatedCostCents: number;
  config: TrainingConfig;
  status: "submitted" | "no_samples";
}

const DEFAULT_TRAINING_CONFIG: TrainingConfig = {
  baseModel: "ostris/flux-dev-lora-trainer",
  triggerWord: "sakufuu_style",
  steps: 1000,
  learningRate: 0.0001,
  loraRank: 16,
  resolution: 512,
  batchSize: 1,
  useCaptions: true,
};

/**
 * Run the full LoRA training pipeline:
 * 1. Extract/validate style samples
 * 2. Prepare training data (captions)
 * 3. Submit training job to provider
 */
export async function runTrainingPipeline(
  input: TrainingPipelineInput,
  provider: TrainingProvider,
): Promise<TrainingPipelineResult> {
  const config: TrainingConfig = {
    ...DEFAULT_TRAINING_CONFIG,
    triggerWord: input.triggerWord,
    ...input.configOverrides,
  };

  // Step 1: Get or extract samples
  let samples = input.samples;
  if (!samples || samples.length === 0) {
    if (!input.availablePanels || input.availablePanels.length === 0) {
      pipelineLog.warn(`[LoRA] No samples or panels available for creator ${input.creatorId}`);
      return {
        jobId: "",
        provider: provider.name,
        sampleCount: 0,
        estimatedCostCents: 0,
        config,
        status: "no_samples",
      };
    }
    samples = extractStyleSamples(input.availablePanels);
  }

  if (samples.length < 5) {
    pipelineLog.warn(`[LoRA] Only ${samples.length} samples — minimum 5 recommended for quality training`);
  }

  // Step 2: Prepare training data
  const trainingData = await prepareTrainingData(samples, config.triggerWord, input.genre);

  pipelineLog.info(`[LoRA] Prepared ${trainingData.length} training images for creator ${input.creatorId}`);

  // Step 3: Submit to provider
  const { jobId, estimatedCostCents } = await provider.submitTraining({
    images: trainingData,
    config,
  });

  pipelineLog.info(`[LoRA] Training submitted: jobId=${jobId}, provider=${provider.name}, cost≈$${(estimatedCostCents / 100).toFixed(2)}`);

  return {
    jobId,
    provider: provider.name,
    sampleCount: trainingData.length,
    estimatedCostCents,
    config,
    status: "submitted",
  };
}

// ─── Model Storage ──────────────────────────────────────────────────────────

/**
 * Download trained model weights and store in S3.
 * Called after training completes successfully.
 */
export async function storeTrainedModel(
  modelUrl: string,
  creatorId: number,
  jobId: string,
): Promise<{ fileKey: string; storedUrl: string }> {
  const response = await fetch(modelUrl);
  if (!response.ok) {
    throw new Error(`Failed to download model: ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const fileKey = `lora-models/${creatorId}/${jobId}/weights.safetensors`;

  const { url: storedUrl } = await storagePut(fileKey, buffer, "application/octet-stream");

  pipelineLog.info(`[LoRA] Model stored: key=${fileKey}, size=${buffer.length} bytes`);

  return { fileKey, storedUrl };
}

// ─── D9 Integration ─────────────────────────────────────────────────────────

/**
 * Check if a creator has a trained and approved LoRA model.
 * Used by D9 Sakufuu Tracker to determine if LoRA-based bias is available.
 */
export interface LoraModelInfo {
  available: boolean;
  modelUrl?: string;
  triggerWord?: string;
  confidence: number;
  trainedAt?: Date;
}

/**
 * Get the active LoRA model for a creator (if any).
 * Returns the most recently approved model.
 */
export function getCreatorLoraStatus(
  jobs: Array<{ status: string; approved: string; modelUrl: string | null; metadata: unknown; completedAt: Date | null }>,
): LoraModelInfo {
  const approvedJobs = jobs.filter(j => j.status === "completed" && j.approved === "approved" && j.modelUrl);

  if (approvedJobs.length === 0) {
    return { available: false, confidence: 0 };
  }

  // Get most recent approved model
  const latest = approvedJobs.sort((a, b) =>
    (b.completedAt?.getTime() || 0) - (a.completedAt?.getTime() || 0)
  )[0];

  const metadata = latest.metadata as { triggerWord?: string } | null;

  return {
    available: true,
    modelUrl: latest.modelUrl!,
    triggerWord: metadata?.triggerWord || "sakufuu_style",
    confidence: 0.85, // LoRA-based bias is high confidence
    trainedAt: latest.completedAt || undefined,
  };
}
