/**
 * Wave 4 Pipeline Wiring — D4 + D8 + D7 Integration
 *
 * This module provides the orchestrator-callable functions that wire
 * D4 Timing Director, D8 Voice Critic, and D7 FX Compositor + Renderer
 * into the production pipeline.
 *
 * Execution order (matching Blueprint stages):
 *   Stage 12: D4 Timing Director → generates X-Sheet
 *   Stage 13: voice_gen → D8 Voice Critic (score + retry loop)
 *   Stage 14: D7 FX Compositor → FX Render Executor
 *
 * Each function follows the same pattern:
 *   1. Gather context from pipeline assets + panel data
 *   2. Call the agent module
 *   3. Return results for orchestrator progress tracking
 *
 * The orchestrator calls these in sequence between existing nodes.
 */
import { pipelineLog } from "../observability/logger.js";
import { getPipelineAssetsByRun, getPanelsByEpisode, getEpisodeById, getDb } from "../db.js";
import { projects } from "../../drizzle/schema.js";
import { eq } from "drizzle-orm";
import { runTimingPipeline, type TimingPipelineOptions, type TimingPipelineResult } from "./d4-timing/timing-pipeline.js";
import { runVoiceCriticPipeline, type VoiceCriticPipelineOptions, type VoiceCriticPipelineResult } from "./d8-voice-critic/voice-critic-pipeline.js";
import { composeFxBatch, type CompositorInput } from "./d7-fx-compositor/fx-compositor.js";
import { renderFxBatch, type FxRenderOptions, type FxRenderResult } from "./d7-fx-compositor/fx-renderer.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PipelineWiringContext {
  pipelineRunId: number;
  episodeId: number;
  userId: number;
  projectId: number;
}

export interface D4WiringResult {
  success: boolean;
  result?: TimingPipelineResult;
  error?: string;
  costUsd: number;
}

export interface D8WiringResult {
  success: boolean;
  result?: VoiceCriticPipelineResult;
  error?: string;
  costUsd: number;
  canProceedToLipSync: boolean;
}

export interface D7WiringResult {
  success: boolean;
  renderResult?: FxRenderResult;
  error?: string;
  costUsd: number;
  clipsRendered: number;
}

// ─── D4 Timing Director Wiring ──────────────────────────────────────────────

/**
 * Wire D4 Timing Director into the pipeline at Stage 12.
 * Generates or loads X-Sheet with user overrides.
 * Non-blocking: timing failures don't halt the pipeline (downstream uses defaults).
 */
export async function wireD4TimingDirector(
  ctx: PipelineWiringContext,
): Promise<D4WiringResult> {
  pipelineLog.info(`[Pipeline Wiring] D4 Timing Director starting (run ${ctx.pipelineRunId})`);

  try {
    const result = await runTimingPipeline({
      pipelineRunId: ctx.pipelineRunId,
      episodeId: ctx.episodeId,
      userId: ctx.userId,
      projectId: ctx.projectId,
    });

    pipelineLog.info(
      `[Pipeline Wiring] D4 complete: ${result.entryCount} entries, ` +
      `source=${result.source}, cost=$${result.costUsd.toFixed(3)}`
    );

    return {
      success: true,
      result,
      costUsd: result.costUsd,
    };
  } catch (err: any) {
    pipelineLog.warn(`[Pipeline Wiring] D4 failed (non-blocking): ${err.message}`);
    return {
      success: false,
      error: err.message,
      costUsd: 0,
    };
  }
}

// ─── D8 Voice Critic Wiring ─────────────────────────────────────────────────

/**
 * Wire D8 Voice Critic into the pipeline after voice_gen (Stage 13).
 * Scores all voice clips and regenerates low-scoring ones.
 * Returns whether the batch can proceed to lip-sync.
 *
 * The retry loop is functional:
 *   D8 scores → low score → regenerate via provider-router with critic feedback →
 *   D8 re-scores → approved clips proceed to lip-sync
 */
export async function wireD8VoiceCritic(
  ctx: PipelineWiringContext,
): Promise<D8WiringResult> {
  pipelineLog.info(`[Pipeline Wiring] D8 Voice Critic starting (run ${ctx.pipelineRunId})`);

  try {
    const result = await runVoiceCriticPipeline({
      pipelineRunId: ctx.pipelineRunId,
      episodeId: ctx.episodeId,
      userId: ctx.userId,
    });

    pipelineLog.info(
      `[Pipeline Wiring] D8 complete: ${result.passCount}/${result.totalClips} passed, ` +
      `${result.totalRetries} retries, canProceed=${result.canProceed}`
    );

    return {
      success: true,
      result,
      costUsd: result.totalCostUsd,
      canProceedToLipSync: result.canProceed,
    };
  } catch (err: any) {
    pipelineLog.warn(`[Pipeline Wiring] D8 failed (non-blocking): ${err.message}`);
    return {
      success: false,
      error: err.message,
      costUsd: 0,
      canProceedToLipSync: true, // Don't block pipeline on D8 failure
    };
  }
}

// ─── D7 FX Compositor + Renderer Wiring ─────────────────────────────────────

/**
 * Wire D7 FX Compositor + Render Executor into the pipeline at Stage 14.
 * Two-phase process:
 *   Phase 1: composeFxBatch() — plan FX based on ekonte tags + genre profile
 *   Phase 2: renderFxBatch() — execute FFmpeg rendering for applicable clips
 *
 * Non-blocking: clips that fail rendering preserve their original URL.
 */
export async function wireD7FxCompositor(
  ctx: PipelineWiringContext,
): Promise<D7WiringResult> {
  pipelineLog.info(`[Pipeline Wiring] D7 FX Compositor starting (run ${ctx.pipelineRunId})`);

  try {
    // Step 1: Gather context — video clips + panel data + project style
    const allAssets = await getPipelineAssetsByRun(ctx.pipelineRunId);
    const videoClips = allAssets.filter(a =>
      (a.assetType === "video_clip" || a.assetType === "synced_clip") && a.panelId
    );

    if (videoClips.length === 0) {
      pipelineLog.info(`[Pipeline Wiring] D7: No video clips found, skipping`);
      return { success: true, costUsd: 0, clipsRendered: 0 };
    }

    const panels = await getPanelsByEpisode(ctx.episodeId);
    const panelMap = new Map(panels.map(p => [p.id, p]));

    // Get project anime style
    const db = await getDb();
    let animeStyle = "shonen";
    let genre: string | null = null;
    if (db) {
      const [proj] = await db.select().from(projects).where(eq(projects.id, ctx.projectId)).limit(1);
      if (proj) {
        animeStyle = (proj as any).animeStyle || "shonen";
        genre = (proj as any).genre || null;
      }
    }

    // Step 2: Build CompositorInput
    const compositorClips = videoClips.map(asset => {
      const panel = panelMap.get(asset.panelId!);
      const meta = (asset.metadata || {}) as any;
      return {
        panelId: asset.panelId!,
        panelNumber: panel?.panelNumber || 0,
        sceneNumber: panel?.sceneNumber || 0,
        clipUrl: asset.url,
        clipDurationSeconds: meta.duration || 5.0,
        sfxTag: panel?.sfx || null,
        visualDescription: panel?.visualDescription || "",
        cameraAngle: panel?.cameraAngle || "medium",
        emotion: (panel as any)?.mood || undefined,
        dialogue: (() => {
          const d = panel?.dialogue as any;
          if (Array.isArray(d)) return d.map((x: any) => x.text || x.line || String(x)).join(". ");
          if (typeof d === "string") return d;
          return undefined;
        })(),
      };
    });

    const compositorInput: CompositorInput = {
      animeStyle,
      genre,
      clips: compositorClips,
    };

    // Step 3: Phase 1 — Compose FX plans
    const fxResult = await composeFxBatch(compositorInput);

    if (!fxResult.plans || fxResult.plans.length === 0) {
      pipelineLog.info(`[Pipeline Wiring] D7: No FX plans generated, skipping render`);
      return { success: true, costUsd: fxResult.totalCostUsd, clipsRendered: 0 };
    }

    const plansWithEffects = fxResult.plans.filter(p => p.hasEffects);
    if (plansWithEffects.length === 0) {
      pipelineLog.info(`[Pipeline Wiring] D7: All clips have no applicable FFmpeg effects`);
      return { success: true, costUsd: fxResult.totalCostUsd, clipsRendered: 0 };
    }

    // Step 4: Phase 2 — Render FX via FFmpeg
    const renderResult = await renderFxBatch({
      pipelineRunId: ctx.pipelineRunId,
      episodeId: ctx.episodeId,
      plans: fxResult.plans,
    });

    const totalCost = fxResult.totalCostUsd + renderResult.totalCostUsd;
    pipelineLog.info(
      `[Pipeline Wiring] D7 complete: ${renderResult.successCount} rendered, ` +
      `${renderResult.failedCount} failed, cost=$${totalCost.toFixed(3)}`
    );

    return {
      success: true,
      renderResult,
      costUsd: totalCost,
      clipsRendered: renderResult.successCount,
    };
  } catch (err: any) {
    pipelineLog.warn(`[Pipeline Wiring] D7 failed (non-blocking): ${err.message}`);
    return {
      success: false,
      error: err.message,
      costUsd: 0,
      clipsRendered: 0,
    };
  }
}
