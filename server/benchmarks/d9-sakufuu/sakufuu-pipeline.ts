/**
 * D9 Sakufuu Tracker — Pipeline Integration
 *
 * Wires D9 into the production pipeline at two points:
 *
 * 1. PRE-GENERATION (Stage 2): getSakufuuBias() provides style recommendations
 *    for episodes 2+. The bias is passed to D7 FX Compositor (signature FX),
 *    voice generation (voice targets), and video generation (palette/pacing hints).
 *
 * 2. POST-ASSEMBLY (after Stage 16): collectEpisodeMemory() records what was
 *    actually used in this episode for future bias computation.
 *
 * Wave 4.5 hotfix: closes the orphaned-function gap from Wave 4.
 */
import { pipelineLog } from "../../observability/logger.js";
import { getEpisodeById, getEpisodesByProject, getPipelineAssetsByRun, getPanelsByEpisode } from "../../db.js";
import {
  getSakufuuBias,
  collectEpisodeMemory,
  aggregateProjectProfile,
  type SakufuuBias,
  type EpisodeMemory,
  type CollectMemoryInput,
  type GetBiasInput,
  type FxUsageRecord,
  type ColorRecord,
  type VoicePattern,
} from "./sakufuu-tracker.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SakufuuPreGenContext {
  pipelineRunId: number;
  episodeId: number;
  projectId: number;
}

export interface SakufuuPreGenResult {
  bias: SakufuuBias;
  episodeNumber: number;
  priorEpisodeCount: number;
}

export interface SakufuuPostAssemblyContext {
  pipelineRunId: number;
  episodeId: number;
  projectId: number;
  /** FX actually applied by D7 in this run */
  fxResults?: Array<{ type: string; intensity: number }>;
  /** Voice generation results (stability/similarity per character) */
  voiceResults?: Record<string, { stability: number; similarity: number; speed: number; emotion?: string }>;
  /** Panel durations from D4 timing (ms per panel) */
  panelDurations?: number[];
}

export interface SakufuuPostAssemblyResult {
  memoryRecorded: boolean;
  profileUpdated: boolean;
  episodeNumber: number;
  confidence: number;
}

// ─── Pre-Generation: Inject Bias at Stage 2 ─────────────────────────────────

/**
 * Called BEFORE video_gen starts. Retrieves D9 bias for this episode.
 * Returns empty bias for episode 1 (no prior data).
 * Returns data-driven recommendations for episodes 2+.
 */
export async function injectSakufuuBias(ctx: SakufuuPreGenContext): Promise<SakufuuPreGenResult> {
  const { pipelineRunId, episodeId, projectId } = ctx;

  // Get current episode info
  const episode = await getEpisodeById(episodeId);
  if (!episode) {
    pipelineLog.warn(`[D9-Pipeline] Episode ${episodeId} not found, returning empty bias`);
    return { bias: emptyBias(), episodeNumber: 1, priorEpisodeCount: 0 };
  }

  const episodeNumber = episode.episodeNumber;

  // Get all prior episodes for this project
  const allEpisodes = await getEpisodesByProject(projectId);
  const priorEpisodes = allEpisodes.filter(
    (e) => e.episodeNumber < episodeNumber && e.status !== "draft"
  );

  if (priorEpisodes.length === 0) {
    pipelineLog.info(`[D9-Pipeline] Episode ${episodeNumber}: no prior episodes, returning empty bias`);
    return { bias: emptyBias(), episodeNumber, priorEpisodeCount: 0 };
  }

  // Build episode memories from prior episodes' pipeline data
  const episodeMemories = await loadEpisodeMemories(projectId, priorEpisodes);

  const biasInput: GetBiasInput = {
    projectId,
    episodeNumber,
    episodeMemories,
    projectProfile: null, // Compute on-the-fly
  };

  const bias = getSakufuuBias(biasInput);

  pipelineLog.info(
    `[D9-Pipeline] Bias injected for episode ${episodeNumber}: active=${bias.active}, ` +
    `signatureFx=${bias.signatureFx.length}, palette=${bias.suggestedPalette.length} colors, ` +
    `voiceTargets=${Object.keys(bias.voiceTargets).length} characters`
  );

  return {
    bias,
    episodeNumber,
    priorEpisodeCount: priorEpisodes.length,
  };
}

// ─── Post-Assembly: Record Episode Memory ────────────────────────────────────

/**
 * Called AFTER assembly completes. Records what was actually used in this
 * episode so future episodes can benefit from D9 bias.
 */
export async function recordSakufuuMemory(ctx: SakufuuPostAssemblyContext): Promise<SakufuuPostAssemblyResult> {
  const { pipelineRunId, episodeId, projectId, fxResults, voiceResults, panelDurations } = ctx;

  const episode = await getEpisodeById(episodeId);
  if (!episode) {
    pipelineLog.warn(`[D9-Pipeline] Cannot record memory: episode ${episodeId} not found`);
    return { memoryRecorded: false, profileUpdated: false, episodeNumber: 0, confidence: 0 };
  }

  const episodeNumber = episode.episodeNumber;

  // Gather panel data for camera/transition analysis
  const panels = await getPanelsByEpisode(episodeId);
  const cameraAngles = panels.map((p) => (p as any).cameraAngle || "medium");
  const transitions = panels.map((p) => (p as any).transition || "cut");

  // Gather color data from pipeline assets (video thumbnails, etc.)
  const assets = await getPipelineAssetsByRun(pipelineRunId);
  const dominantColors = extractDominantColors(assets);

  const memoryInput: CollectMemoryInput = {
    projectId,
    episodeId,
    episodeNumber,
    fxResults: fxResults || [],
    dominantColors,
    voiceParams: voiceResults || {},
    panelDurations: panelDurations || [],
    cameraAngles,
    transitions,
  };

  const memory = collectEpisodeMemory(memoryInput);

  // Update project profile with new episode data
  const allEpisodes = await getEpisodesByProject(projectId);
  const completedEpisodes = allEpisodes.filter(
    (e) => e.status === "published" || e.status === "review" || e.id === episodeId
  );

  // Load all memories including this new one
  const allMemories = await loadEpisodeMemories(projectId, completedEpisodes);
  allMemories.push(memory);

  // Recompute project profile
  const _profile = aggregateProjectProfile(projectId, allMemories);

  pipelineLog.info(
    `[D9-Pipeline] Memory recorded for episode ${episodeNumber}: ` +
    `confidence=${memory.confidence.toFixed(2)}, fxUsed=${memory.fxUsed.length}, ` +
    `colors=${memory.dominantColors.length}, voices=${Object.keys(memory.voicePatterns).length}`
  );

  return {
    memoryRecorded: true,
    profileUpdated: true,
    episodeNumber,
    confidence: memory.confidence,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function emptyBias(): SakufuuBias {
  return {
    active: false,
    signatureFx: [],
    suggestedPalette: [],
    suggestedTemperature: "neutral",
    voiceTargets: {},
    suggestedPacing: "normal",
    suggestedCameraStyle: {},
    confidence: 0,
    sources: [],
  };
}

/**
 * Load episode memories from prior episodes.
 * In production, this reads from sakufuu_episode_memories table.
 * For now, reconstructs minimal memories from panel/asset data.
 */
async function loadEpisodeMemories(
  projectId: number,
  episodes: Array<{ id: number; episodeNumber: number }>
): Promise<EpisodeMemory[]> {
  const memories: EpisodeMemory[] = [];

  for (const ep of episodes) {
    const panels = await getPanelsByEpisode(ep.id);
    if (panels.length === 0) continue;

    const cameraAngles = panels.map((p) => (p as any).cameraAngle || "medium");
    const transitions = panels.map((p) => (p as any).transition || "cut");

    // Build camera distribution
    const cameraDistribution: Record<string, number> = {};
    const total = cameraAngles.length || 1;
    for (const angle of cameraAngles) {
      const key = angle.toLowerCase();
      cameraDistribution[key] = (cameraDistribution[key] || 0) + 1;
    }
    for (const key of Object.keys(cameraDistribution)) {
      cameraDistribution[key] = Number((cameraDistribution[key] / total).toFixed(3));
    }

    // Build transition preferences
    const transitionPreferences: Record<string, number> = {};
    for (const trans of transitions) {
      const key = trans.toLowerCase();
      transitionPreferences[key] = (transitionPreferences[key] || 0) + 1;
    }
    for (const key of Object.keys(transitionPreferences)) {
      transitionPreferences[key] = Number((transitionPreferences[key] / total).toFixed(3));
    }

    memories.push({
      projectId,
      episodeId: ep.id,
      episodeNumber: ep.episodeNumber,
      fxUsed: [],
      fxSignature: [],
      dominantColors: [],
      colorTemperature: "neutral",
      contrastLevel: "medium",
      voicePatterns: {},
      pacingProfile: "normal",
      avgPanelDurationMs: null,
      cameraDistribution,
      transitionPreferences,
      confidence: panels.length > 5 ? 0.6 : 0.3,
    });
  }

  return memories;
}

function extractDominantColors(assets: Array<{ metadata?: any }>): ColorRecord[] {
  const colors: ColorRecord[] = [];

  for (const asset of assets) {
    const meta = asset.metadata as any;
    if (meta?.dominantColor) {
      const existing = colors.find((c) => c.hex === meta.dominantColor);
      if (existing) {
        existing.weight += 0.1;
      } else {
        colors.push({ hex: meta.dominantColor, weight: 0.1 });
      }
    }
  }

  // Normalize weights
  const totalWeight = colors.reduce((sum, c) => sum + c.weight, 0) || 1;
  for (const c of colors) {
    c.weight = Number((c.weight / totalWeight).toFixed(3));
  }

  return colors.slice(0, 10);
}
