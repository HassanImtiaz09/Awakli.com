/**
 * D7 FX Render Executor — FFmpeg-based visual effects rendering
 *
 * Takes FX plans from composeFxBatch() and executes them:
 *   1. Downloads each clip from S3/CDN to a temp directory
 *   2. Builds FFmpeg filter_complex from the FxSpec[] per clip
 *   3. Runs FFmpeg via execFileAsync (production pattern from video-assembly.ts)
 *   4. Uploads rendered clips to S3 via storagePut
 *   5. Returns rendered clip URLs for the assembly stage
 *
 * Follows the same asset lifecycle as lipSyncNode.ts:
 *   discover upstream assets → download → transform → upload → persist pipeline asset
 *
 * Non-blocking: if FFmpeg fails for a clip, the original clip URL is preserved.
 * Clips with only overlay-based effects (sakura_petals, etc.) are skipped (no FFmpeg filter).
 */
import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { nanoid } from "nanoid";
import { storagePut } from "../../storage.js";
import { createPipelineAsset } from "../../db.js";
import { pipelineLog } from "../../observability/logger.js";
import {
  buildFilterComplex,
  buildFfmpegCommand,
  type ClipFxPlan,
  type FxSpec,
  COST_PER_FX_RENDER,
} from "./fx-compositor.js";

const execFileAsync = promisify(execFile);

// ─── Types ──────────────────────────────────────────────────────────────────

export interface FxRenderOptions {
  /** Pipeline run ID for asset persistence */
  pipelineRunId: number;
  /** Episode ID for asset persistence */
  episodeId: number;
  /** FX plans from composeFxBatch() */
  plans: ClipFxPlan[];
  /** Maximum concurrent FFmpeg processes (default: 2) */
  concurrency?: number;
  /** FFmpeg timeout per clip in ms (default: 60000) */
  timeoutMs?: number;
  /** Whether to persist rendered clips as pipeline assets (default: true) */
  persistAssets?: boolean;
}

export interface FxRenderResult {
  /** Rendered clip URLs (or original URL if rendering failed/skipped) */
  renderedClips: RenderedClipInfo[];
  /** Number of clips successfully rendered */
  successCount: number;
  /** Number of clips that failed (original preserved) */
  failedCount: number;
  /** Number of clips skipped (no FFmpeg-applicable effects) */
  skippedCount: number;
  /** Total cost in USD */
  totalCostUsd: number;
  /** Total processing time in ms */
  totalDurationMs: number;
}

export interface RenderedClipInfo {
  panelId: number;
  panelNumber: number;
  /** Final URL (rendered or original fallback) */
  url: string;
  /** Whether this clip was rendered with FX */
  wasRendered: boolean;
  /** Effects applied (empty if skipped/failed) */
  effectsApplied: string[];
  /** Error message if rendering failed */
  error?: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────

/** Maximum buffer size for FFmpeg stdout/stderr (10MB) */
const MAX_BUFFER = 10 * 1024 * 1024;

/** Default FFmpeg timeout per clip (60s) */
const DEFAULT_TIMEOUT_MS = 60_000;

/** Default concurrency for FFmpeg processes */
const DEFAULT_CONCURRENCY = 2;

// ─── Download Helper ────────────────────────────────────────────────────────

async function downloadClip(url: string, destPath: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed: ${response.status} ${url}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(destPath, buffer);
}

// ─── FFmpeg Execution ───────────────────────────────────────────────────────

async function runFfmpeg(
  inputPath: string,
  outputPath: string,
  filterComplex: string,
  timeoutMs: number,
): Promise<void> {
  // Use argument array for safety (no shell injection)
  const args = [
    "-hide_banner",
    "-y",
    "-i", inputPath,
    "-vf", filterComplex,
    "-c:a", "copy",
    outputPath,
  ];

  await execFileAsync("ffmpeg", args, {
    timeout: timeoutMs,
    maxBuffer: MAX_BUFFER,
  });
}

// ─── Single Clip Renderer ───────────────────────────────────────────────────

async function renderSingleClip(
  plan: ClipFxPlan,
  workDir: string,
  options: {
    pipelineRunId: number;
    episodeId: number;
    timeoutMs: number;
    persistAssets: boolean;
  },
): Promise<RenderedClipInfo> {
  const { pipelineRunId, episodeId, timeoutMs, persistAssets } = options;
  const clipId = `panel-${plan.panelId}-${nanoid(6)}`;

  // Step 1: Check if plan has FFmpeg-applicable effects
  const filterComplex = buildFilterComplex(plan.effects, 5.0); // duration used for timing calc
  if (!filterComplex) {
    return {
      panelId: plan.panelId,
      panelNumber: plan.panelNumber,
      url: plan.clipUrl,
      wasRendered: false,
      effectsApplied: [],
    };
  }

  const inputPath = path.join(workDir, `${clipId}-input.mp4`);
  const outputPath = path.join(workDir, `${clipId}-output.mp4`);

  try {
    // Step 2: Download clip
    await downloadClip(plan.clipUrl, inputPath);

    // Step 3: Get actual duration for accurate filter timing
    let actualDuration = 5.0;
    try {
      const { stdout } = await execFileAsync("ffprobe", [
        "-v", "quiet",
        "-show_entries", "format=duration",
        "-of", "csv=p=0",
        inputPath,
      ]);
      actualDuration = parseFloat(stdout.trim()) || 5.0;
    } catch {
      // Use default duration if ffprobe fails
    }

    // Step 4: Rebuild filter with actual duration
    const accurateFilter = buildFilterComplex(plan.effects, actualDuration);
    if (!accurateFilter) {
      return {
        panelId: plan.panelId,
        panelNumber: plan.panelNumber,
        url: plan.clipUrl,
        wasRendered: false,
        effectsApplied: [],
      };
    }

    // Step 5: Run FFmpeg
    await runFfmpeg(inputPath, outputPath, accurateFilter, timeoutMs);

    // Step 6: Upload rendered clip to S3
    const s3Key = `pipeline/${pipelineRunId}/fx-${clipId}.mp4`;
    const fileBuffer = await fs.readFile(outputPath);
    const { url: renderedUrl } = await storagePut(s3Key, fileBuffer, "video/mp4");

    // Step 7: Persist as pipeline asset (using video_clip type with FX metadata)
    if (persistAssets) {
      await createPipelineAsset({
        pipelineRunId,
        episodeId,
        panelId: plan.panelId,
        assetType: "video_clip",
        url: renderedUrl,
        metadata: {
          panelNumber: plan.panelNumber,
          sceneNumber: plan.sceneNumber,
          hasFx: true,
          fxApplied: plan.effects.map(e => e.fxType),
          fxSource: plan.effects.map(e => e.source),
          originalClipUrl: plan.clipUrl,
          renderDuration: actualDuration,
          renderCostUsd: COST_PER_FX_RENDER,
        } as any,
        nodeSource: "video_gen", // Reuse video_gen since no fx_gen enum exists
      });
    }

    const effectNames = plan.effects.map(e => e.fxType);
    pipelineLog.info(
      `[D7 Render] Panel ${plan.panelId}: rendered ${effectNames.length} effects (${effectNames.join(", ")})`
    );

    return {
      panelId: plan.panelId,
      panelNumber: plan.panelNumber,
      url: renderedUrl,
      wasRendered: true,
      effectsApplied: effectNames,
    };
  } catch (err: any) {
    pipelineLog.warn(
      `[D7 Render] Panel ${plan.panelId}: FFmpeg failed, preserving original — ${err.message}`
    );
    return {
      panelId: plan.panelId,
      panelNumber: plan.panelNumber,
      url: plan.clipUrl,
      wasRendered: false,
      effectsApplied: [],
      error: err.message,
    };
  } finally {
    // Cleanup temp files
    await fs.unlink(inputPath).catch(() => {});
    await fs.unlink(outputPath).catch(() => {});
  }
}

// ─── Batch Renderer (Main Entry Point) ──────────────────────────────────────

/**
 * Render all FX plans that have FFmpeg-applicable effects.
 * This is the main entry point called by the pipeline orchestrator after composeFxBatch().
 *
 * Non-blocking: clips that fail rendering preserve their original URL.
 * Clips with only overlay-based effects are skipped (returned as-is).
 */
export async function renderFxBatch(options: FxRenderOptions): Promise<FxRenderResult> {
  const {
    pipelineRunId,
    episodeId,
    plans,
    concurrency = DEFAULT_CONCURRENCY,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    persistAssets = true,
  } = options;

  const startTime = Date.now();
  const workDir = path.join(os.tmpdir(), `awakli-fx-render-${nanoid(8)}`);
  await fs.mkdir(workDir, { recursive: true });

  pipelineLog.info(
    `[D7 Render] Starting FX render batch: ${plans.length} clips, ` +
    `${plans.filter(p => p.hasEffects).length} with effects`
  );

  const renderedClips: RenderedClipInfo[] = [];
  let successCount = 0;
  let failedCount = 0;
  let skippedCount = 0;
  let totalCostUsd = 0;

  // Filter to only plans that have effects
  const plansWithEffects = plans.filter(p => p.hasEffects);
  const plansWithoutEffects = plans.filter(p => !p.hasEffects);

  // Add plans without effects as-is (skipped)
  for (const plan of plansWithoutEffects) {
    renderedClips.push({
      panelId: plan.panelId,
      panelNumber: plan.panelNumber,
      url: plan.clipUrl,
      wasRendered: false,
      effectsApplied: [],
    });
    skippedCount++;
  }

  // Process plans with effects in batches (respecting concurrency)
  for (let i = 0; i < plansWithEffects.length; i += concurrency) {
    const batch = plansWithEffects.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(plan =>
        renderSingleClip(plan, workDir, {
          pipelineRunId,
          episodeId,
          timeoutMs,
          persistAssets,
        })
      )
    );

    for (const result of batchResults) {
      renderedClips.push(result);
      if (result.wasRendered) {
        successCount++;
        totalCostUsd += COST_PER_FX_RENDER;
      } else if (result.error) {
        failedCount++;
      } else {
        skippedCount++;
      }
    }
  }

  // Cleanup work directory
  try {
    await fs.rm(workDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }

  const totalDurationMs = Date.now() - startTime;
  pipelineLog.info(
    `[D7 Render] Batch complete: ${successCount} rendered, ${failedCount} failed, ` +
    `${skippedCount} skipped, cost=$${totalCostUsd.toFixed(3)}, ${totalDurationMs}ms`
  );

  return {
    renderedClips,
    successCount,
    failedCount,
    skippedCount,
    totalCostUsd,
    totalDurationMs,
  };
}
