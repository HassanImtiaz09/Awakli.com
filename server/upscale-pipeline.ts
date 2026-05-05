/**
 * Image Upscaling Pipeline for Print DPI (Wave 5C Item 2)
 *
 * Provides:
 * 1. UpscaleProvider interface (swappable, same pattern as TrainingProvider)
 * 2. RealESRGANProvider implementation via Replicate API
 * 3. DPI detection module (source DPI analysis per panel)
 * 4. Auto-flag panels below 300 DPI for upscale before PDF generation
 * 5. Integration with D10.M print pipeline (upscale step before page compositor)
 * 6. Quality scoring post-upscale (SSIM comparison)
 */

// ─── Constants ──────────────────────────────────────────────────────────────────

/** Standard print DPI threshold for manga/comic publishing */
export const PRINT_DPI_THRESHOLD = 300;

/** Minimum acceptable DPI for web display */
export const WEB_DPI_THRESHOLD = 72;

/** Maximum upscale factor supported by Real-ESRGAN */
export const MAX_UPSCALE_FACTOR = 4;

/** Supported upscale models */
export const UPSCALE_MODELS = {
  "real-esrgan-x4": {
    name: "Real-ESRGAN x4",
    maxFactor: 4,
    description: "General-purpose 4x upscaler, excellent for anime/manga art",
    replicateModel: "nightmareai/real-esrgan:f121d640bd286e1fdc67f9799164c1d5be36ff74576ee11c803ae5b665dd46aa",
    costPerImageCents: 2, // ~$0.02 per image on Replicate
  },
  "real-esrgan-anime": {
    name: "Real-ESRGAN Anime",
    maxFactor: 4,
    description: "Optimized for anime/illustration upscaling with sharper lines",
    replicateModel: "nightmareai/real-esrgan:42fed1c4974146d4d2414e2be2c5277c7fcf05fcc3a73abf41610695738c1d7b",
    costPerImageCents: 2,
  },
} as const;

export type UpscaleModelId = keyof typeof UPSCALE_MODELS;

/** Default model for manga panels */
export const DEFAULT_UPSCALE_MODEL: UpscaleModelId = "real-esrgan-anime";

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface UpscaleRequest {
  /** URL of the source image to upscale */
  imageUrl: string;
  /** Desired upscale factor (2 or 4) */
  scaleFactor: 2 | 4;
  /** Model to use for upscaling */
  model?: UpscaleModelId;
  /** Whether to apply face enhancement (useful for character close-ups) */
  faceEnhance?: boolean;
  /** Target DPI (used for validation, not directly by the model) */
  targetDpi?: number;
}

export interface UpscaleResult {
  /** URL of the upscaled image */
  outputUrl: string;
  /** Original dimensions */
  originalWidth: number;
  originalHeight: number;
  /** Upscaled dimensions */
  upscaledWidth: number;
  upscaledHeight: number;
  /** Scale factor applied */
  scaleFactor: number;
  /** Processing time in ms */
  processingTimeMs: number;
  /** Cost in cents */
  costCents: number;
  /** Model used */
  model: UpscaleModelId;
}

export interface UpscaleJobStatus {
  status: "queued" | "processing" | "completed" | "failed" | "cancelled";
  progress?: number; // 0-100
  outputUrl?: string;
  error?: string;
}

/**
 * UpscaleProvider interface — swappable provider pattern
 * (same design as TrainingProvider and VectorStoreProvider)
 */
export interface UpscaleProvider {
  name: string;
  /** Submit an upscale job */
  submitUpscale(request: UpscaleRequest): Promise<{ jobId: string; estimatedCostCents: number }>;
  /** Check status of an upscale job */
  getJobStatus(jobId: string): Promise<UpscaleJobStatus>;
  /** Cancel a running upscale job */
  cancelJob(jobId: string): Promise<void>;
  /** Get the upscaled image URL after completion */
  getOutputUrl(jobId: string): Promise<string>;
}

// ─── DPI Detection Module ───────────────────────────────────────────────────────

export interface DpiAnalysis {
  /** Panel ID */
  panelId: number;
  /** Source image dimensions (pixels) */
  sourceWidth: number;
  sourceHeight: number;
  /** Effective DPI at target print size */
  effectiveDpi: number;
  /** Whether this panel meets print DPI threshold */
  meetsPrintDpi: boolean;
  /** Required upscale factor to reach 300 DPI (1 = no upscale needed) */
  requiredUpscaleFactor: number;
  /** Recommended upscale factor (rounded to 2 or 4) */
  recommendedUpscaleFactor: 1 | 2 | 4;
  /** Target print dimensions in inches */
  targetPrintWidthInches: number;
  targetPrintHeightInches: number;
}

export interface PrintSizeSpec {
  /** Print area width in inches (after trim/bleed) */
  widthInches: number;
  /** Print area height in inches (after trim/bleed) */
  heightInches: number;
}

/** Standard manga print sizes (B5 is most common for tankōbon) */
export const MANGA_PRINT_SIZES: Record<string, PrintSizeSpec> = {
  B5: { widthInches: 6.93, heightInches: 9.84 },       // 176mm × 250mm
  A5: { widthInches: 5.83, heightInches: 8.27 },       // 148mm × 210mm
  "US_COMIC": { widthInches: 6.625, heightInches: 10.25 }, // Standard US comic
  "DIGEST": { widthInches: 5.5, heightInches: 8.5 },   // Digest/trade paperback
};

/**
 * Analyze the effective DPI of a panel at a given print size.
 *
 * DPI = pixels / inches
 * For a panel that occupies a fraction of the page, we scale accordingly.
 */
export function analyzePanelDpi(
  panelId: number,
  sourceWidth: number,
  sourceHeight: number,
  printSize: PrintSizeSpec = MANGA_PRINT_SIZES.B5,
  panelFraction: number = 0.5 // Panels typically occupy ~50% of page area
): DpiAnalysis {
  // A panel occupying panelFraction of the page area
  // Approximate: panel width = page width, panel height = page height * fraction
  const targetPrintWidthInches = printSize.widthInches;
  const targetPrintHeightInches = printSize.heightInches * panelFraction;

  // Effective DPI is the minimum of horizontal and vertical DPI
  const horizontalDpi = sourceWidth / targetPrintWidthInches;
  const verticalDpi = sourceHeight / targetPrintHeightInches;
  const effectiveDpi = Math.min(horizontalDpi, verticalDpi);

  const meetsPrintDpi = effectiveDpi >= PRINT_DPI_THRESHOLD;

  // Calculate required upscale factor
  const requiredUpscaleFactor = meetsPrintDpi ? 1 : Math.ceil(PRINT_DPI_THRESHOLD / effectiveDpi);

  // Round to supported factor (1, 2, or 4)
  let recommendedUpscaleFactor: 1 | 2 | 4 = 1;
  if (requiredUpscaleFactor > 1 && requiredUpscaleFactor <= 2) {
    recommendedUpscaleFactor = 2;
  } else if (requiredUpscaleFactor > 2) {
    recommendedUpscaleFactor = 4;
  }

  return {
    panelId,
    sourceWidth,
    sourceHeight,
    effectiveDpi: Math.round(effectiveDpi * 100) / 100,
    meetsPrintDpi,
    requiredUpscaleFactor,
    recommendedUpscaleFactor,
    targetPrintWidthInches,
    targetPrintHeightInches,
  };
}

/**
 * Batch analyze all panels in an episode for DPI compliance.
 * Returns panels that need upscaling, sorted by priority (lowest DPI first).
 */
export function batchAnalyzeDpi(
  panels: Array<{ panelId: number; width: number; height: number }>,
  printSize: PrintSizeSpec = MANGA_PRINT_SIZES.B5,
  panelFraction: number = 0.5
): {
  analyses: DpiAnalysis[];
  needsUpscale: DpiAnalysis[];
  compliant: DpiAnalysis[];
  summary: DpiSummary;
} {
  const analyses = panels.map(p =>
    analyzePanelDpi(p.panelId, p.width, p.height, printSize, panelFraction)
  );

  const needsUpscale = analyses
    .filter(a => !a.meetsPrintDpi)
    .sort((a, b) => a.effectiveDpi - b.effectiveDpi);

  const compliant = analyses.filter(a => a.meetsPrintDpi);

  const summary: DpiSummary = {
    totalPanels: panels.length,
    compliantPanels: compliant.length,
    needsUpscalePanels: needsUpscale.length,
    complianceRate: panels.length > 0 ? compliant.length / panels.length : 1,
    averageDpi: analyses.length > 0
      ? Math.round(analyses.reduce((sum, a) => sum + a.effectiveDpi, 0) / analyses.length)
      : 0,
    lowestDpi: analyses.length > 0
      ? Math.min(...analyses.map(a => a.effectiveDpi))
      : 0,
    highestDpi: analyses.length > 0
      ? Math.max(...analyses.map(a => a.effectiveDpi))
      : 0,
    estimatedUpscaleCostCents: needsUpscale.length * UPSCALE_MODELS[DEFAULT_UPSCALE_MODEL].costPerImageCents,
  };

  return { analyses, needsUpscale, compliant, summary };
}

export interface DpiSummary {
  totalPanels: number;
  compliantPanels: number;
  needsUpscalePanels: number;
  complianceRate: number; // 0-1
  averageDpi: number;
  lowestDpi: number;
  highestDpi: number;
  estimatedUpscaleCostCents: number;
}

// ─── Auto-Flag Logic ────────────────────────────────────────────────────────────

export interface AutoFlagResult {
  panelId: number;
  flagged: boolean;
  reason?: string;
  effectiveDpi: number;
  recommendedAction: "none" | "upscale_2x" | "upscale_4x" | "regenerate";
}

/**
 * Auto-flag panels below print DPI threshold.
 * Panels below 75 DPI are flagged for regeneration (upscaling would degrade too much).
 */
export function autoFlagPanelsForUpscale(
  panels: Array<{ panelId: number; width: number; height: number }>,
  printSize: PrintSizeSpec = MANGA_PRINT_SIZES.B5,
  panelFraction: number = 0.5
): AutoFlagResult[] {
  const MIN_VIABLE_DPI = 75; // Below this, upscaling produces unacceptable artifacts

  return panels.map(p => {
    const analysis = analyzePanelDpi(p.panelId, p.width, p.height, printSize, panelFraction);

    if (analysis.meetsPrintDpi) {
      return {
        panelId: p.panelId,
        flagged: false,
        effectiveDpi: analysis.effectiveDpi,
        recommendedAction: "none" as const,
      };
    }

    if (analysis.effectiveDpi < MIN_VIABLE_DPI) {
      return {
        panelId: p.panelId,
        flagged: true,
        reason: `DPI too low for upscaling (${analysis.effectiveDpi} DPI). Recommend regeneration at higher resolution.`,
        effectiveDpi: analysis.effectiveDpi,
        recommendedAction: "regenerate" as const,
      };
    }

    const action = analysis.recommendedUpscaleFactor === 2 ? "upscale_2x" : "upscale_4x";
    return {
      panelId: p.panelId,
      flagged: true,
      reason: `Below print DPI (${analysis.effectiveDpi} DPI < ${PRINT_DPI_THRESHOLD} DPI). Needs ${analysis.recommendedUpscaleFactor}x upscale.`,
      effectiveDpi: analysis.effectiveDpi,
      recommendedAction: action as "upscale_2x" | "upscale_4x",
    };
  });
}

// ─── Real-ESRGAN Provider Implementation ────────────────────────────────────────

export class RealESRGANProvider implements UpscaleProvider {
  name = "real-esrgan";
  private apiToken: string;
  private baseUrl = "https://api.replicate.com/v1";

  constructor(apiToken: string) {
    this.apiToken = apiToken;
  }

  async submitUpscale(request: UpscaleRequest): Promise<{ jobId: string; estimatedCostCents: number }> {
    const model = request.model || DEFAULT_UPSCALE_MODEL;
    const modelConfig = UPSCALE_MODELS[model];

    const response = await fetch(`${this.baseUrl}/predictions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        version: modelConfig.replicateModel.split(":")[1],
        input: {
          image: request.imageUrl,
          scale: request.scaleFactor,
          face_enhance: request.faceEnhance ?? false,
        },
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Replicate API error: ${response.status} - ${error}`);
    }

    const data = await response.json() as { id: string };
    return {
      jobId: data.id,
      estimatedCostCents: modelConfig.costPerImageCents,
    };
  }

  async getJobStatus(jobId: string): Promise<UpscaleJobStatus> {
    const response = await fetch(`${this.baseUrl}/predictions/${jobId}`, {
      headers: { "Authorization": `Bearer ${this.apiToken}` },
    });

    if (!response.ok) {
      throw new Error(`Replicate API error: ${response.status}`);
    }

    const data = await response.json() as {
      status: string;
      output?: string;
      error?: string;
      logs?: string;
    };

    const statusMap: Record<string, UpscaleJobStatus["status"]> = {
      starting: "queued",
      processing: "processing",
      succeeded: "completed",
      failed: "failed",
      canceled: "cancelled",
    };

    return {
      status: statusMap[data.status] || "processing",
      outputUrl: data.output || undefined,
      error: data.error || undefined,
      progress: data.status === "succeeded" ? 100 : data.status === "processing" ? 50 : 0,
    };
  }

  async cancelJob(jobId: string): Promise<void> {
    await fetch(`${this.baseUrl}/predictions/${jobId}/cancel`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${this.apiToken}` },
    });
  }

  async getOutputUrl(jobId: string): Promise<string> {
    const status = await this.getJobStatus(jobId);
    if (status.status !== "completed" || !status.outputUrl) {
      throw new Error(`Job ${jobId} not completed or no output URL available`);
    }
    return status.outputUrl;
  }
}

// ─── Quality Scoring (SSIM Comparison) ──────────────────────────────────────────

export interface QualityScore {
  /** Structural Similarity Index (0-1, higher is better) */
  ssim: number;
  /** Peak Signal-to-Noise Ratio in dB (higher is better) */
  psnr: number;
  /** Overall quality rating */
  rating: "excellent" | "good" | "acceptable" | "poor";
  /** Whether the upscale meets quality threshold */
  meetsThreshold: boolean;
}

/** SSIM thresholds for quality ratings */
export const QUALITY_THRESHOLDS = {
  excellent: 0.95,
  good: 0.85,
  acceptable: 0.75,
  poor: 0, // Anything below acceptable
};

/**
 * Compute quality score for an upscaled image.
 *
 * In production, this would use actual SSIM computation between
 * the upscaled image and a reference (or the original at matching resolution).
 * For now, we estimate based on upscale factor and source DPI.
 *
 * Higher source DPI → better upscale quality (less hallucination needed).
 */
export function estimateUpscaleQuality(
  sourceDpi: number,
  scaleFactor: 2 | 4,
  model: UpscaleModelId = DEFAULT_UPSCALE_MODEL
): QualityScore {
  // Base SSIM estimate based on source quality and scale factor
  // Higher source DPI means less interpolation needed → better quality
  const dpiRatio = Math.min(sourceDpi / PRINT_DPI_THRESHOLD, 1);

  // Scale factor penalty: 4x upscaling produces more artifacts than 2x
  const scaleFactorPenalty = scaleFactor === 4 ? 0.08 : 0.03;

  // Model bonus: anime-optimized model is slightly better for manga
  const modelBonus = model === "real-esrgan-anime" ? 0.02 : 0;

  // Estimated SSIM
  const baseSSIM = 0.80 + (dpiRatio * 0.15);
  const ssim = Math.min(Math.max(baseSSIM - scaleFactorPenalty + modelBonus, 0), 1);

  // Estimated PSNR (correlated with SSIM but different scale)
  const psnr = 20 + (ssim * 25); // Range: ~20-45 dB

  // Determine rating
  let rating: QualityScore["rating"];
  if (ssim >= QUALITY_THRESHOLDS.excellent) {
    rating = "excellent";
  } else if (ssim >= QUALITY_THRESHOLDS.good) {
    rating = "good";
  } else if (ssim >= QUALITY_THRESHOLDS.acceptable) {
    rating = "acceptable";
  } else {
    rating = "poor";
  }

  return {
    ssim: Math.round(ssim * 10000) / 10000,
    psnr: Math.round(psnr * 100) / 100,
    rating,
    meetsThreshold: ssim >= QUALITY_THRESHOLDS.acceptable,
  };
}

// ─── Print Pipeline Integration ─────────────────────────────────────────────────

export interface UpscalePipelineInput {
  /** Panels to process */
  panels: Array<{
    panelId: number;
    imageUrl: string;
    width: number;
    height: number;
  }>;
  /** Print size specification */
  printSize?: PrintSizeSpec;
  /** Panel fraction of page (default 0.5) */
  panelFraction?: number;
  /** Upscale model to use */
  model?: UpscaleModelId;
  /** Whether to skip panels that would produce poor quality */
  skipPoorQuality?: boolean;
}

export interface UpscalePipelineResult {
  /** Per-panel results */
  results: Array<{
    panelId: number;
    action: "skipped" | "upscaled" | "flagged_regenerate";
    originalDpi: number;
    resultDpi?: number;
    upscaledUrl?: string;
    qualityScore?: QualityScore;
    costCents: number;
  }>;
  /** Summary */
  summary: {
    totalPanels: number;
    upscaled: number;
    skipped: number;
    flaggedForRegeneration: number;
    totalCostCents: number;
    totalProcessingTimeMs: number;
    averageQualityScore: number;
  };
}

/**
 * Run the upscale pipeline for a batch of panels before print PDF generation.
 *
 * This is the integration point with D10.M manga finishing:
 * 1. Analyze DPI of all panels
 * 2. Auto-flag panels below threshold
 * 3. Submit upscale jobs for flagged panels (via UpscaleProvider)
 * 4. Score quality post-upscale
 * 5. Return results for compositor to use upscaled URLs
 */
export async function runUpscalePipeline(
  input: UpscalePipelineInput,
  provider: UpscaleProvider
): Promise<UpscalePipelineResult> {
  const startTime = Date.now();
  const printSize = input.printSize || MANGA_PRINT_SIZES.B5;
  const panelFraction = input.panelFraction || 0.5;
  const model = input.model || DEFAULT_UPSCALE_MODEL;
  const skipPoorQuality = input.skipPoorQuality ?? true;

  // Step 1: Analyze DPI
  const flags = autoFlagPanelsForUpscale(
    input.panels.map(p => ({ panelId: p.panelId, width: p.width, height: p.height })),
    printSize,
    panelFraction
  );

  const results: UpscalePipelineResult["results"] = [];
  let totalCostCents = 0;

  for (const panel of input.panels) {
    const flag = flags.find(f => f.panelId === panel.panelId)!;

    if (flag.recommendedAction === "none") {
      results.push({
        panelId: panel.panelId,
        action: "skipped",
        originalDpi: flag.effectiveDpi,
        costCents: 0,
      });
      continue;
    }

    if (flag.recommendedAction === "regenerate") {
      results.push({
        panelId: panel.panelId,
        action: "flagged_regenerate",
        originalDpi: flag.effectiveDpi,
        costCents: 0,
      });
      continue;
    }

    // Estimate quality before submitting
    const scaleFactor: 2 | 4 = flag.recommendedAction === "upscale_2x" ? 2 : 4;
    const qualityEstimate = estimateUpscaleQuality(flag.effectiveDpi, scaleFactor, model);

    if (skipPoorQuality && !qualityEstimate.meetsThreshold) {
      results.push({
        panelId: panel.panelId,
        action: "flagged_regenerate",
        originalDpi: flag.effectiveDpi,
        qualityScore: qualityEstimate,
        costCents: 0,
      });
      continue;
    }

    // Submit upscale job
    const { jobId, estimatedCostCents } = await provider.submitUpscale({
      imageUrl: panel.imageUrl,
      scaleFactor,
      model,
      faceEnhance: false,
      targetDpi: PRINT_DPI_THRESHOLD,
    });

    // Poll for completion (simplified — in production use webhooks)
    let status = await provider.getJobStatus(jobId);
    const maxWaitMs = 60000; // 1 minute timeout
    const pollInterval = 2000;
    let waited = 0;

    while (status.status !== "completed" && status.status !== "failed" && waited < maxWaitMs) {
      await new Promise(resolve => setTimeout(resolve, pollInterval));
      waited += pollInterval;
      status = await provider.getJobStatus(jobId);
    }

    if (status.status === "completed" && status.outputUrl) {
      const resultDpi = flag.effectiveDpi * scaleFactor;
      totalCostCents += estimatedCostCents;

      results.push({
        panelId: panel.panelId,
        action: "upscaled",
        originalDpi: flag.effectiveDpi,
        resultDpi,
        upscaledUrl: status.outputUrl,
        qualityScore: qualityEstimate,
        costCents: estimatedCostCents,
      });
    } else {
      results.push({
        panelId: panel.panelId,
        action: "flagged_regenerate",
        originalDpi: flag.effectiveDpi,
        costCents: 0,
      });
    }
  }

  const totalProcessingTimeMs = Date.now() - startTime;
  const upscaled = results.filter(r => r.action === "upscaled");
  const qualityScores = upscaled
    .filter(r => r.qualityScore)
    .map(r => r.qualityScore!.ssim);

  return {
    results,
    summary: {
      totalPanels: input.panels.length,
      upscaled: upscaled.length,
      skipped: results.filter(r => r.action === "skipped").length,
      flaggedForRegeneration: results.filter(r => r.action === "flagged_regenerate").length,
      totalCostCents,
      totalProcessingTimeMs,
      averageQualityScore: qualityScores.length > 0
        ? Math.round((qualityScores.reduce((a, b) => a + b, 0) / qualityScores.length) * 10000) / 10000
        : 0,
    },
  };
}

// ─── Admin DPI Coverage Dashboard Helpers ───────────────────────────────────────

export interface ProjectDpiStatus {
  projectId: number;
  projectName: string;
  totalPanels: number;
  compliantPanels: number;
  needsUpscalePanels: number;
  complianceRate: number;
  averageDpi: number;
  lowestDpi: number;
  estimatedUpscaleCostCents: number;
  lastAnalyzedAt?: Date;
}

export interface DpiCoverageDashboard {
  projects: ProjectDpiStatus[];
  globalSummary: {
    totalProjects: number;
    totalPanels: number;
    globalComplianceRate: number;
    totalEstimatedCostCents: number;
    projectsFullyCompliant: number;
    projectsNeedingUpscale: number;
  };
}

/**
 * Build DPI coverage dashboard data from panel analyses.
 */
export function buildDpiCoverageDashboard(
  projectStatuses: ProjectDpiStatus[]
): DpiCoverageDashboard {
  const totalPanels = projectStatuses.reduce((sum, p) => sum + p.totalPanels, 0);
  const totalCompliant = projectStatuses.reduce((sum, p) => sum + p.compliantPanels, 0);
  const totalCost = projectStatuses.reduce((sum, p) => sum + p.estimatedUpscaleCostCents, 0);

  return {
    projects: projectStatuses.sort((a, b) => a.complianceRate - b.complianceRate),
    globalSummary: {
      totalProjects: projectStatuses.length,
      totalPanels,
      globalComplianceRate: totalPanels > 0 ? totalCompliant / totalPanels : 1,
      totalEstimatedCostCents: totalCost,
      projectsFullyCompliant: projectStatuses.filter(p => p.complianceRate === 1).length,
      projectsNeedingUpscale: projectStatuses.filter(p => p.complianceRate < 1).length,
    },
  };
}
