/**
 * D9 · Sakufuu Tracker — Data-Tracking MVP (Wave 4)
 *
 * Tracks per-episode style decisions and provides bias recommendations
 * for episodes 2+ to maintain visual/audio consistency across a series.
 *
 * Wave 4 scope: Data-tracking + bias injection only.
 * Wave 5: Sakufuu Aesthetic LoRA training pipeline.
 * Wave 6: Three-LoRA composition runtime + Prompt-Style Adapter.
 *
 * Three-layer architecture (Wave 4 implements Layers 1+2 only):
 *   Layer 1 — Episode Memory: per-episode style decisions
 *   Layer 2 — Project Memory: aggregated tendencies
 *   Layer 3 — LoRA Training (Wave 5/6): aesthetic model from accumulated data
 */

import { pipelineLog } from "../../observability/logger.js";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface FxUsageRecord {
  type: string;       // AnimeFxType (hikaku, namigarasu, gabre, etc.)
  count: number;
  avgIntensity: number;
}

export interface ColorRecord {
  hex: string;
  weight: number;  // 0-1
}

export interface VoicePattern {
  avgStability: number;
  avgSimilarity: number;
  avgSpeed: number;
  emotionDistribution: Record<string, number>;  // {happy: 0.3, neutral: 0.5, ...}
}

export type TemperatureTendency = "warm" | "neutral" | "cool";
export type ContrastLevel = "low" | "medium" | "high";
export type PacingProfile = "slow" | "normal" | "fast" | "variable";

export interface EpisodeMemory {
  projectId: number;
  episodeId: number;
  episodeNumber: number;
  // FX
  fxUsed: FxUsageRecord[];
  fxSignature: string[];  // top 3 FX types
  // Color
  dominantColors: ColorRecord[];
  colorTemperature: TemperatureTendency;
  contrastLevel: ContrastLevel;
  // Voice
  voicePatterns: Record<string, VoicePattern>;
  pacingProfile: PacingProfile;
  avgPanelDurationMs: number | null;
  // Camera
  cameraDistribution: Record<string, number>;
  transitionPreferences: Record<string, number>;
  // Meta
  confidence: number;
}

export interface ProjectProfile {
  projectId: number;
  signatureFx: Array<{ type: string; frequency: number; avgIntensity: number }>;
  fxDiversityScore: number;
  paletteTendency: ColorRecord[];
  temperatureTendency: TemperatureTendency;
  voiceConsistency: number;
  preferredPacing: PacingProfile;
  cameraStyle: Record<string, number>;
  transitionStyle: Record<string, number>;
  episodesAnalyzed: number;
  confidence: number;
}

export interface SakufuuBias {
  /** Whether bias is active (false for episode 1) */
  active: boolean;
  /** Recommended FX types to prioritize (from project signature) */
  signatureFx: string[];
  /** Recommended color palette */
  suggestedPalette: ColorRecord[];
  /** Recommended color temperature */
  suggestedTemperature: TemperatureTendency;
  /** Voice consistency targets per character */
  voiceTargets: Record<string, { stability: number; similarity: number; speed: number }>;
  /** Recommended pacing */
  suggestedPacing: PacingProfile;
  /** Camera distribution to aim for */
  suggestedCameraStyle: Record<string, number>;
  /** Confidence level (0-1, higher = more data backing) */
  confidence: number;
  /** Source: which layers contributed */
  sources: ("episode_memory" | "project_profile")[];
}

// ─── Episode Memory Collection ──────────────────────────────────────────────

export interface CollectMemoryInput {
  projectId: number;
  episodeId: number;
  episodeNumber: number;
  /** FX usage from D7 compositor results */
  fxResults?: Array<{ type: string; intensity: number }>;
  /** Dominant colors extracted from generated frames */
  dominantColors?: ColorRecord[];
  /** Voice generation params used per character */
  voiceParams?: Record<string, { stability: number; similarity: number; speed: number; emotion?: string }>;
  /** Panel durations from D4 timing */
  panelDurations?: number[];
  /** Camera angles used per panel */
  cameraAngles?: string[];
  /** Transitions used between panels */
  transitions?: string[];
}

/**
 * Collect style decisions from a completed episode and store as Episode Memory (Layer 1).
 * Called after pipeline completion for each episode.
 */
export function collectEpisodeMemory(input: CollectMemoryInput): EpisodeMemory {
  pipelineLog.info(`[D9] Collecting episode memory: project=${input.projectId}, episode=${input.episodeNumber}`);

  // Aggregate FX usage
  const fxMap = new Map<string, { count: number; totalIntensity: number }>();
  for (const fx of input.fxResults ?? []) {
    const existing = fxMap.get(fx.type) ?? { count: 0, totalIntensity: 0 };
    existing.count++;
    existing.totalIntensity += fx.intensity;
    fxMap.set(fx.type, existing);
  }
  const fxUsed: FxUsageRecord[] = Array.from(fxMap.entries())
    .map(([type, { count, totalIntensity }]) => ({
      type,
      count,
      avgIntensity: Math.round(totalIntensity / count),
    }))
    .sort((a, b) => b.count - a.count);

  const fxSignature = fxUsed.slice(0, 3).map(f => f.type);

  // Determine color temperature from dominant colors
  const colorTemperature = classifyTemperature(input.dominantColors ?? []);
  const contrastLevel = classifyContrast(input.dominantColors ?? []);

  // Aggregate voice patterns
  const voicePatterns: Record<string, VoicePattern> = {};
  for (const [character, params] of Object.entries(input.voiceParams ?? {})) {
    voicePatterns[character] = {
      avgStability: params.stability,
      avgSimilarity: params.similarity,
      avgSpeed: params.speed,
      emotionDistribution: params.emotion ? { [params.emotion]: 1.0 } : { neutral: 1.0 },
    };
  }

  // Pacing from panel durations
  const avgPanelDurationMs = input.panelDurations?.length
    ? Math.round(input.panelDurations.reduce((a, b) => a + b, 0) / input.panelDurations.length)
    : null;
  const pacingProfile = classifyPacing(avgPanelDurationMs);

  // Camera distribution
  const cameraDistribution = buildDistribution(input.cameraAngles ?? []);

  // Transition preferences
  const transitionPreferences = buildDistribution(input.transitions ?? []);

  // Confidence based on data completeness
  let dataPoints = 0;
  if (input.fxResults?.length) dataPoints++;
  if (input.dominantColors?.length) dataPoints++;
  if (Object.keys(input.voiceParams ?? {}).length) dataPoints++;
  if (input.panelDurations?.length) dataPoints++;
  if (input.cameraAngles?.length) dataPoints++;
  if (input.transitions?.length) dataPoints++;
  const confidence = Math.min(1.0, dataPoints / 6);

  const memory: EpisodeMemory = {
    projectId: input.projectId,
    episodeId: input.episodeId,
    episodeNumber: input.episodeNumber,
    fxUsed,
    fxSignature,
    dominantColors: input.dominantColors ?? [],
    colorTemperature,
    contrastLevel,
    voicePatterns,
    pacingProfile,
    avgPanelDurationMs,
    cameraDistribution,
    transitionPreferences,
    confidence,
  };

  pipelineLog.info(`[D9] Episode memory collected: ${fxUsed.length} FX types, confidence=${confidence.toFixed(2)}`);
  return memory;
}

// ─── Project Profile Aggregation (Layer 2) ──────────────────────────────────

/**
 * Aggregate multiple episode memories into a project-level profile.
 * Called after each new episode memory is stored.
 */
export function aggregateProjectProfile(
  projectId: number,
  episodeMemories: EpisodeMemory[]
): ProjectProfile {
  pipelineLog.info(`[D9] Aggregating project profile: project=${projectId}, episodes=${episodeMemories.length}`);

  if (episodeMemories.length === 0) {
    return emptyProjectProfile(projectId);
  }

  // Aggregate FX across episodes
  const fxAgg = new Map<string, { totalCount: number; totalIntensity: number; episodes: number }>();
  for (const mem of episodeMemories) {
    for (const fx of mem.fxUsed) {
      const existing = fxAgg.get(fx.type) ?? { totalCount: 0, totalIntensity: 0, episodes: 0 };
      existing.totalCount += fx.count;
      existing.totalIntensity += fx.avgIntensity * fx.count;
      existing.episodes++;
      fxAgg.set(fx.type, existing);
    }
  }
  const signatureFx = Array.from(fxAgg.entries())
    .map(([type, { totalCount, totalIntensity, episodes }]) => ({
      type,
      frequency: episodes / episodeMemories.length,
      avgIntensity: Math.round(totalIntensity / totalCount),
    }))
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, 5);

  // FX diversity: Shannon entropy normalized
  const totalFxTypes = fxAgg.size;
  const maxPossibleTypes = 12; // approximate total anime FX types
  const fxDiversityScore = Math.min(1.0, totalFxTypes / maxPossibleTypes);

  // Aggregate colors
  const colorAgg = new Map<string, number>();
  for (const mem of episodeMemories) {
    for (const c of mem.dominantColors) {
      colorAgg.set(c.hex, (colorAgg.get(c.hex) ?? 0) + c.weight);
    }
  }
  const totalColorWeight = Array.from(colorAgg.values()).reduce((a, b) => a + b, 0) || 1;
  const paletteTendency = Array.from(colorAgg.entries())
    .map(([hex, weight]) => ({ hex, weight: weight / totalColorWeight }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 8);

  // Temperature tendency (majority vote)
  const tempCounts = { warm: 0, neutral: 0, cool: 0 };
  for (const mem of episodeMemories) tempCounts[mem.colorTemperature]++;
  const temperatureTendency = (Object.entries(tempCounts).sort((a, b) => b[1] - a[1])[0][0]) as TemperatureTendency;

  // Voice consistency: std dev of stability across episodes per character
  const voiceConsistency = computeVoiceConsistency(episodeMemories);

  // Pacing (majority vote)
  const pacingCounts: Record<string, number> = {};
  for (const mem of episodeMemories) {
    pacingCounts[mem.pacingProfile] = (pacingCounts[mem.pacingProfile] ?? 0) + 1;
  }
  const preferredPacing = (Object.entries(pacingCounts).sort((a, b) => b[1] - a[1])[0][0]) as PacingProfile;

  // Camera style (average distributions)
  const cameraStyle = averageDistributions(episodeMemories.map(m => m.cameraDistribution));
  const transitionStyle = averageDistributions(episodeMemories.map(m => m.transitionPreferences));

  // Confidence increases with more episodes (logarithmic)
  const confidence = Math.min(1.0, Math.log2(episodeMemories.length + 1) / Math.log2(10));

  return {
    projectId,
    signatureFx,
    fxDiversityScore,
    paletteTendency,
    temperatureTendency,
    voiceConsistency,
    preferredPacing,
    cameraStyle,
    transitionStyle,
    episodesAnalyzed: episodeMemories.length,
    confidence,
  };
}

// ─── Bias Injection (Stage 2) ───────────────────────────────────────────────

export interface GetBiasInput {
  projectId: number;
  episodeNumber: number;
  /** Existing episode memories for this project */
  episodeMemories: EpisodeMemory[];
  /** Pre-computed project profile (or null to compute on-the-fly) */
  projectProfile?: ProjectProfile | null;
}

/**
 * Get D9 bias recommendations for a new episode.
 * Returns empty/inactive bias for episode 1.
 * Returns data-driven recommendations for episodes 2+.
 */
export function getSakufuuBias(input: GetBiasInput): SakufuuBias {
  const { projectId, episodeNumber, episodeMemories, projectProfile } = input;

  // Episode 1: no-op (no data to base recommendations on)
  if (episodeNumber <= 1 || episodeMemories.length === 0) {
    pipelineLog.info(`[D9] Episode ${episodeNumber}: no bias (first episode or no history)`);
    return emptyBias();
  }

  pipelineLog.info(`[D9] Computing bias for episode ${episodeNumber} from ${episodeMemories.length} prior episodes`);

  // Compute or use provided project profile
  const profile = projectProfile ?? aggregateProjectProfile(projectId, episodeMemories);

  // Build bias from project profile (Layer 2) + recent episode memory (Layer 1)
  const recentMemory = episodeMemories
    .sort((a, b) => b.episodeNumber - a.episodeNumber)[0];

  // Signature FX: from project profile
  const signatureFx = profile.signatureFx.map(f => f.type);

  // Palette: blend project tendency with recent episode
  const suggestedPalette = profile.paletteTendency.length > 0
    ? profile.paletteTendency
    : recentMemory.dominantColors;

  // Voice targets: from most recent episode (character-specific)
  const voiceTargets: Record<string, { stability: number; similarity: number; speed: number }> = {};
  for (const [character, pattern] of Object.entries(recentMemory.voicePatterns)) {
    voiceTargets[character] = {
      stability: pattern.avgStability,
      similarity: pattern.avgSimilarity,
      speed: pattern.avgSpeed,
    };
  }

  // Determine sources
  const sources: ("episode_memory" | "project_profile")[] = [];
  if (episodeMemories.length >= 1) sources.push("episode_memory");
  if (episodeMemories.length >= 2) sources.push("project_profile");

  const bias: SakufuuBias = {
    active: true,
    signatureFx,
    suggestedPalette,
    suggestedTemperature: profile.temperatureTendency,
    voiceTargets,
    suggestedPacing: profile.preferredPacing,
    suggestedCameraStyle: profile.cameraStyle,
    confidence: profile.confidence,
    sources,
  };

  pipelineLog.info(`[D9] Bias computed: ${signatureFx.length} signature FX, confidence=${bias.confidence.toFixed(2)}, sources=${sources.join("+")}`);
  return bias;
}

// ─── Helper Functions ───────────────────────────────────────────────────────

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

function emptyProjectProfile(projectId: number): ProjectProfile {
  return {
    projectId,
    signatureFx: [],
    fxDiversityScore: 0,
    paletteTendency: [],
    temperatureTendency: "neutral",
    voiceConsistency: 0,
    preferredPacing: "normal",
    cameraStyle: {},
    transitionStyle: {},
    episodesAnalyzed: 0,
    confidence: 0,
  };
}

export function classifyTemperature(colors: ColorRecord[]): TemperatureTendency {
  if (colors.length === 0) return "neutral";

  let warmScore = 0;
  let coolScore = 0;

  for (const { hex, weight } of colors) {
    const rgb = hexToRgb(hex);
    if (!rgb) continue;
    // Warm: red/orange/yellow dominant
    if (rgb.r > rgb.b) warmScore += weight;
    // Cool: blue/green dominant
    if (rgb.b > rgb.r) coolScore += weight;
  }

  if (warmScore > coolScore * 1.3) return "warm";
  if (coolScore > warmScore * 1.3) return "cool";
  return "neutral";
}

export function classifyContrast(colors: ColorRecord[]): ContrastLevel {
  if (colors.length < 2) return "medium";

  const luminances = colors.map(c => {
    const rgb = hexToRgb(c.hex);
    if (!rgb) return 0.5;
    return 0.2126 * rgb.r / 255 + 0.7152 * rgb.g / 255 + 0.0722 * rgb.b / 255;
  });

  const maxL = Math.max(...luminances);
  const minL = Math.min(...luminances);
  const range = maxL - minL;

  if (range > 0.6) return "high";
  if (range < 0.3) return "low";
  return "medium";
}

export function classifyPacing(avgDurationMs: number | null): PacingProfile {
  if (avgDurationMs === null) return "normal";
  if (avgDurationMs < 3000) return "fast";
  if (avgDurationMs > 8000) return "slow";
  return "normal";
}

export function buildDistribution(items: string[]): Record<string, number> {
  if (items.length === 0) return {};
  const counts: Record<string, number> = {};
  for (const item of items) {
    const normalized = item.toLowerCase().replace(/[_\s]+/g, "_");
    counts[normalized] = (counts[normalized] ?? 0) + 1;
  }
  const total = items.length;
  const dist: Record<string, number> = {};
  for (const [key, count] of Object.entries(counts)) {
    dist[key] = Math.round((count / total) * 100) / 100;
  }
  return dist;
}

function computeVoiceConsistency(memories: EpisodeMemory[]): number {
  if (memories.length < 2) return 0.5;

  // Collect all characters across episodes
  const characterStabilities: Record<string, number[]> = {};
  for (const mem of memories) {
    for (const [char, pattern] of Object.entries(mem.voicePatterns)) {
      if (!characterStabilities[char]) characterStabilities[char] = [];
      characterStabilities[char].push(pattern.avgStability);
    }
  }

  if (Object.keys(characterStabilities).length === 0) return 0.5;

  // Average std dev across characters (lower std dev = higher consistency)
  let totalStdDev = 0;
  let charCount = 0;
  for (const stabilities of Object.values(characterStabilities)) {
    if (stabilities.length < 2) continue;
    const mean = stabilities.reduce((a, b) => a + b, 0) / stabilities.length;
    const variance = stabilities.reduce((a, b) => a + (b - mean) ** 2, 0) / stabilities.length;
    totalStdDev += Math.sqrt(variance);
    charCount++;
  }

  if (charCount === 0) return 0.5;
  const avgStdDev = totalStdDev / charCount;
  // Map: stdDev 0 → consistency 1.0, stdDev 0.5 → consistency 0.0
  return Math.max(0, Math.min(1, 1 - avgStdDev * 2));
}

function averageDistributions(distributions: Record<string, number>[]): Record<string, number> {
  if (distributions.length === 0) return {};

  const allKeys = new Set<string>();
  for (const dist of distributions) {
    for (const key of Object.keys(dist)) allKeys.add(key);
  }

  const result: Record<string, number> = {};
  for (const key of Array.from(allKeys)) {
    const values = distributions.map(d => d[key] ?? 0);
    result[key] = Math.round((values.reduce((a, b) => a + b, 0) / distributions.length) * 100) / 100;
  }
  return result;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const match = hex.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  if (!match) return null;
  return {
    r: parseInt(match[1], 16),
    g: parseInt(match[2], 16),
    b: parseInt(match[3], 16),
  };
}
